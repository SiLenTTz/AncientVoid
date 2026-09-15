---
id: BUG-0008
slug: heartbeat-false-error-after-normal-turn
status: done
severity: S1
area: core
instance: dev
commit: ""
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/8"
epic: EPIC-P1
created: 2026-09-15
reporter: "Claude Sonnet 5 (Session 012Ga2NDi683xR9E63StoN7T)"
---

# BUG-0008 — Heartbeat marks a successfully-completed turn as `status: error`

## Gesehen

Beim ersten echten End-to-End-Lauf (AI-P1-1 aus der EPIC-P1-Retro: nie
zuvor mit einem echten `claude`- oder `codex`-Prozess getestet, nur mit
`dummy`) — echter Hub, echter Token, echte Session gegen den lokalen
`claude`-CLI:

1. Session erstellt, `claude` fügt real eine Funktion hinzu, schreibt einen
   Test, führt ihn aus — alles erfolgreich, `total_cost_usd` korrekt als
   `costUsd: 0.091278` übernommen.
2. ~44 Sekunden nach erfolgreichem Abschluss (`codex: turn complete` bzw.
   das claude-Äquivalent): `GET /api/sessions/<id>` zeigt
   `"status": "error"`, Event `adapter.down` erscheint im Stream — obwohl
   nichts fehlgeschlagen war.

Reproduziert identisch mit `codex` (zweiter echter Lauf, `multiply()`
erfolgreich hinzugefügt, `codex: turn complete` ohne Fehler, Status
trotzdem später `error`).

Ein dritter, verwandter Fund im selben Lauf: ein `codex`-Versuch mit einem
nicht unterstützten Modell (`gpt-5.3-codex` unter ChatGPT-Account-Login)
schlug **echt** fehl (`turn.failed`, Prozess-Exit-Code 1) — wurde aber
_nicht_ als `down`/`error` sichtbar, weil die Session zuvor durch dieselben
Events bereits als `degraded` markiert war und `status()` `degraded` vor
`healthy` prüfte. Ein echter Ausfall blieb dadurch für den Heartbeat
unsichtbar (`runHeartbeat` reagiert nur auf `down`/`broken`, nie auf
`degraded`).

## Erwartet

Eine Session, deren letzter Turn erfolgreich abgeschlossen wurde, bleibt
`status: working` (bzw. wird von einer zukünftigen Aufgabe in einen
"idle/wartet auf nächsten Prompt"-Zustand überführt — das ist eine separate
Lücke, siehe unten) — sie wird nicht als `error` markiert, nur weil der
zugrunde liegende CLI-Prozess (der bei `claude -p`/`codex exec` **pro
Turn** neu gestartet wird) planmäßig beendet ist.

## Repro

1. Echten Hub starten mit `claude`- und `codex`-Adapter in
   `hub.config.json` (beide CLIs real installiert und authentifiziert).
2. Echte Session anlegen (`POST /api/sessions`), reales Prompt, z. B.
   "Add a subtract(a,b) function and a test".
3. Warten bis `codex: turn complete` / das claude-Äquivalent im Event-Stream
   erscheint (Session hat real und erfolgreich gearbeitet).
4. ≥30s warten (ein Heartbeat-Tick, `DEFAULT_HEARTBEAT_MS`).
5. `GET /api/sessions/<id>` erneut abfragen.

**Ergebnis (vor dem Fix):** `status: "error"`, `adapter.down`-Event im
Stream, obwohl die Session gerade erfolgreich einen Task erledigt hat.

**Häufigkeit:** deterministisch — jeder abgeschlossene Turn eines
One-Shot-Adapters (`claude`, `codex`) löst das aus, kein Zufall.

## Logs

```text
{"seq":22,"type":"system","summary":"claude: turn complete — $0.0913","costUsd":0.091278}
{"seq":23,"type":"system","summary":"adapter.down","costUsd":null}
```

`GET /api/sessions/e70bfdda-...` unmittelbar danach: `"status": "error"`.

## Eingrenzung

`packages/adapter-claude/src/index.ts` und `packages/adapter-codex/src/index.ts`,
je in `attach()`s `proc.onExit(...)`-Handler (vor dem Fix):

```ts
proc.onExit((code) => {
  meta.healthy = false;   // <- unconditional, auch bei code === 0
  ...
});
```

Beide Kommentare direkt daneben beschrieben das korrekte Modell bereits
richtig ("claude -p is one-shot: every turn's process exits by design, not
just on error") — der Code handelte nur nicht danach. `T1.9`s Heartbeat-Test
(`packages/core/test/sessionmanager.test.ts`) nutzt einen eigens gebauten
Inline-Adapter mit binärem `healthy`/`down` ohne One-Shot-Exit-Semantik —
deshalb blieb das unentdeckt, bis ein echter Adapter real lief.

Zusätzlich, nur `packages/adapter-codex/src/index.ts`s `status()`:

```ts
if (meta.degraded) { return { state: "degraded", ... }; }   // <- vor healthy geprüft
return { state: meta.healthy ? "healthy" : "down", ... };
```

Einmal `degraded` gesetzt, blieb `status()` für den Rest der Session
permanent bei `"degraded"` hängen — auch nach einem späteren echten Absturz
(`healthy` wurde nie mehr erreicht). Der Heartbeat (`down`/`broken`-only)
sah diesen Fall dadurch nie.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/adapter-claude/test/adapter.test.ts` ("status() reflects process exit") | testete genau das jetzt falsche Verhalten — erwartete `"down"` nach einem sauberen Exit |
| Unit | `packages/adapter-codex/test/adapter.test.ts` (gleichnamiger Test) | dito |

Kein Test deckte den One-Shot-Exit-vs-Heartbeat-Zusammenhang mit einem
*echten* Adapter ab — nur mit dem synthetischen T1.9-Testadapter.

## Fix

1. `onExit`: `meta.healthy = false` nur noch bei abnormalem Exit
   (`code !== 0 && code !== null`), nicht mehr unconditional — dieselbe
   Bedingung, die bereits für das Event-Emit genutzt wurde.
2. `attach()`: `meta.healthy = true` beim Start jedes NEUEN Prozesses
   zurückgesetzt (nicht nur in `start()`, auch in jedem `steer()`-Resume) —
   sonst würde ein einzelner fehlgeschlagener Turn die Session für immer
   auf `down` einfrieren, selbst nach einem späteren erfolgreichen Turn.
3. `adapter-codex`s `status()`: `healthy`-Prüfung jetzt vor `degraded` —
   ein echter Absturz wird gemeldet, auch wenn die Session zuvor als
   degraded markiert wurde.

Zwei alte Tests korrigiert (sie prüften das jetzt falsche Verhalten), drei
neue Tests ergänzt: sauberer Exit bleibt `healthy` (claude + codex),
abnormaler Exit meldet weiterhin korrekt `down` (claude + codex), und ein
abnormaler Exit meldet `down` auch nach vorherigem `degraded` (codex).

## Bekannte, bewusst nicht behobene Anschlusslücke

Auch mit diesem Fix bleibt `SessionRecord.status` nach einem sauber
abgeschlossenen Turn für immer `"working"` — es gibt aktuell **keinen**
Übergang zu einem "idle/wartet auf nächsten Prompt"-Zustand für
One-Shot-Adapter (nur `starting`→`working`→`stopping`/`stopped`/`error`
werden je gesetzt, nie zurück zu `idle`). Das ist kein Symptom dieses Bugs
mehr (die Session zeigt jetzt wenigstens nicht mehr fälschlich `error`),
aber ein echtes Modell-Loch für die "wartet auf dich"-Badge-Logik des
Dashboards — als eigenes Action Item vorgemerkt, nicht Teil dieses Fixes.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` — behoben in `packages/adapter-claude/src/index.ts` und
      `packages/adapter-codex/src/index.ts`, 5 neue/korrigierte Tests, alle
      Gates grün (91/91 Tests), live gegen echten `claude` erneut
      verifiziert (Session blieb `working` über einen vollen
      Heartbeat-Zyklus hinweg, statt nach ~44s auf `error` zu kippen).
