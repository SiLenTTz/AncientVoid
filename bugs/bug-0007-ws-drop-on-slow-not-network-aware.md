---
id: BUG-0007
slug: ws-drop-on-slow-not-network-aware
status: done
severity: S2
area: server
instance: dev
commit: ""
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/7"
epic: EPIC-P1
created: 2026-09-15
reporter: "Claude Sonnet 5 (Session 012Ga2NDi683xR9E63StoN7T)"
---

# BUG-0007 — `dropped:true` reagiert nicht auf echtes gedrosseltes Netz, Events verschwinden ohne Signal

## Gesehen

Bei der Verifikation von AC-P1-3 ("Drop-on-slow greift nachweisbar bei
gedrosseltem Netz", T1.10) wurde `packages/server/src/ws.ts` gegen ein
echtes gedrosseltes Netz getestet (Playwright CDP
`Network.emulateNetworkConditions`, echter Chromium, 20kbit/s Downlink,
500ms Latenz — kein simuliertes In-Process-Backpressure-Szenario). Der
Dummy-Adapter lief mit der normalen K2-Rate (30 ev/s), keiner künstlichen
Überlast.

Ergebnis: `dropped:true` erschien in **keiner** der 62 empfangenen
Nachrichten, obwohl `highWater` bereits bei 488 lag — der Client hatte also
nachweislich hunderte Events nie erhalten, ohne dass ihm das je signalisiert
wurde.

## Erwartet

Laut EPIC-P1 AC-P1-3 soll ein Client, der unter einem gedrosselten Netz ins
Hintertreffen gerät, das über `dropped:true` erfahren und per
`{type:"resync", since}` wieder aufholen — "kein stiller Datenverlust".

## Repro

Skript: `/tmp/claude-1000/.../scratchpad/k2-throttle-check.mjs` (Session-
Scratchpad, nicht Teil des Repos — Kernlogik unten):

1. Echten Hub-Server starten (`createHubApp`, echter HTTP/WS-Listener).
2. Dummy-Adapter-Session bei 30 ev/s anlegen.
3. Echten Chromium via Playwright starten, CDP-Session öffnen,
   `Network.emulateNetworkConditions({downloadThroughput: 2500, uploadThroughput: 2500, latency: 500})`.
4. Im Browser ein echtes `WebSocket` zum Tail-Endpoint öffnen, `hello`
   senden, 15s lang alle eingehenden `events`-Nachrichten sammeln.

**Ergebnis:** 62 Batches/Events empfangen, letzter `highWater` 488,
`dropped` in jeder Nachricht `false`.

**Häufigkeit:** deterministisch reproduziert (1 Lauf, klarer struktureller
Befund — kein Flake).

## Logs

```text
[throttle] batches received: 62, events received: 62
[throttle] max inter-batch gap: 601ms
[throttle] dropped:true ever seen: false
[throttle] last few batches: [{"n":1,"highWater":484,...,"dropped":false},
  {"n":1,"highWater":485,...,"dropped":false}, ..., {"n":1,"highWater":488,...,"dropped":false}]
```

## Eingrenzung

`packages/server/src/ws.ts:61-70` — `dropped` wird ausschließlich gesetzt,
wenn der **in-process** Puffer-Array (`buffer`, im `subscribe`-Callback)
`MAX_WS_BUFFER` (100) überschreitet:

```ts
const unsubscribe = sessions.subscribe(sessionId, (events) => {
  if (buffer.length + events.length > MAX_WS_BUFFER) {
    buffer = [...buffer, ...events].slice(-MAX_WS_BUFFER);
    dropped = true;
  } else {
    buffer.push(...events);
  }
  void flush();
});
```

`flush()` (`ws.ts:37-59`) ruft `socket.send()` auf und wartet dann nur auf
`setImmediate` (Event-Loop-Yield) — **nicht** auf tatsächliche Zustellung.
`socket.send()` reiht die Daten in den Node-internen/OS-Sendepuffer ein und
kehrt sofort zurück, unabhängig davon, wie langsam die tatsächliche
Netzwerkstrecke ist. `socket.bufferedAmount` (das echte Backpressure-Signal
der `ws`-Bibliothek) wird an keiner Stelle in dieser Datei gelesen.

Deshalb bleibt `buffer` bei normaler Produktionsrate (30/s) praktisch immer
leer — der Puffer läuft nie über den Zähler-Schwellwert, weil der Server
den eigentlichen Netzwerk-Engpass gar nicht sieht. Der tatsächliche
Datenverlust im Repro entsteht vermutlich weiter unten im Stack (OS-
Socket-Puffer, Browser-WS-Implementierung oder das CDP-Throttling selbst
verwirft Frames) — für den Client ist das nicht von einem stillen
Serverfehler zu unterscheiden, weil kein `dropped`-Flag je gesetzt wird.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| — | keiner | Kein bestehender Test hätte das gefangen — `ws.test.ts` (falls vorhanden) simuliert nur In-Process-Overload, nie echtes Netzwerk-Throttling. |

## Fix

`packages/server/src/ws.ts`: `flush()` prüft jetzt vor jedem `send()`
`socket.bufferedAmount` gegen `MAX_WS_BUFFERED_BYTES` (64KB). Ist die
Schwelle überschritten, wird die Warteschlange auf das letzte Event
kollabiert, `dropped=true` gesetzt und die Schleife verlassen (kein
weiteres Anreichern einer bereits verstopften Leitung) — der nächste
`flush()`-Aufruf (ausgelöst vom nächsten Event) versucht es erneut, sobald
`bufferedAmount` wieder gesunken ist. Damit reagiert der Drop-Mechanismus
jetzt auf zwei unabhängige Signale: In-Process-Pufferzahl (`MAX_WS_BUFFER`,
bestehend) UND tatsächliche Sende-Rückstauung (`bufferedAmount`, neu).

Für die Testbarkeit wurde die anonyme Route-Handler-Funktion in
`registerWs()` als benannte, exportierte Fabrik `createTailHandler(sessions)`
extrahiert (`registerWs` ruft sie jetzt nur noch auf) — `packages/server/src/index.ts`
unverändert, da `registerWs`s Signatur gleich bleibt.

## Tests (nach Fix)

| Ring | Befehl / Datei | Ergebnis |
|---|---|---|
| Unit | `packages/server/test/ws.test.ts` (neu, 2 Tests) | grün |

Test 1 fakt einen Socket mit `bufferedAmount = 1_000_000` (über der
64KB-Schwelle), der nach 100ms auf `0` zurückfällt (simuliert ein
Netzwerk, das sich erholt) — Session/Adapter/EventStore sind echt, nur die
Transportschicht ist gefakt (echtes Throttling ist in CI nicht
deterministisch steuerbar). Erwartung: mindestens ein `dropped:true`.
Test 2: `bufferedAmount` bleibt `0` — erwartet: nie `dropped:true`.

**Ohne Fix rot, mit Fix grün — verifiziert:** `git stash` auf `ws.ts` allein
ergab (mangels Export) einen anderen Fehler; gezielt nur die neue
`if (socket.bufferedAmount > MAX_WS_BUFFERED_BYTES)`-Prüfung entfernt (Export
erhalten) ließ genau Test 1 mit `expected false to be true` scheitern — der
Test beweist die behobene Lücke, nicht nur die Umstrukturierung.

Volle Gates (`npm test`, `npm run lint`, `npm run typecheck`): alle grün
(84/84 Tests).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` — behoben: `socket.bufferedAmount`-Prüfung in `flush()`,
      Regressionstest `packages/server/test/ws.test.ts`, Handler zu
      `createTailHandler()` extrahiert für Testbarkeit.
