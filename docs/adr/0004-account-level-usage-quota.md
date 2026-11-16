# ADR-0004 — Kontingent-/Quoten-Modell: Account-Ebene, nicht Session-Ebene

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/event.ts`,
`packages/contracts/src/adapter.ts`, `packages/core/src/sessionmanager.ts`,
T1.5-2 (`EPIC-P1.5-control-center-ux.md`)

## Kontext

T1.5-1 (dieses ADR) ist laut EPIC-P1.5 harte Vorbedingung für T1.5-2 — kein
Code vorher. Der Nutzer benutzt ausschließlich Coding-Subscriptions
(claude, codex), keine nutzungsabhängige API-Abrechnung; die Frage, die er
tatsächlich beantwortet haben will, ist nicht „wie viel hat diese Session
gekostet" (das beantwortet `costUsd`, ADR-0003 schon), sondern „wie viel
meines Kontingents ist verbraucht, wann laufe ich ins Limit".

**Ground Truth, live aus dem echten `claude`-Stream erfasst (Session
012Ga2NDi683xR9E63StoN7T, 2026-09-15):**

```json
{"type":"rate_limit_event","rate_limit_info":{
  "status":"allowed","resetsAt":1789473600,"rateLimitType":"five_hour",
  "overageStatus":"rejected","overageDisabledReason":"out_of_credits",
  "isUsingOverage":false,
  "unifiedWindows":{
    "five_hour":{"utilization":0.43,"resetsAt":1789473600},
    "seven_day":{"utilization":0.28,"resetsAt":1789891200}}},
  "uuid":"…","session_id":"…"}
```

`packages/adapter-claude/src/normalize.ts:55-58` mappt das heute auf ein
unbeschriftetes `system`-Event (`payload.info` roh, kein Feld, kein
Endpunkt, keine Anzeige) — die Daten existieren bereits, sie werden nur
verworfen.

**Zusätzlich real geprüft (diese Session, gegen die echten CLIs, nicht aus
Doku-Erinnerung):**

- `claude auth status --json` liefert Konto-Identität (`subscriptionType`,
  `email`, `orgId` …), aber **keine** Kontingent-Zahl — es gibt keinen
  On-Demand-Abfrageweg außerhalb eines laufenden Turns. `rate_limit_event`
  ist die einzige Quelle.
- `codex login status` liefert nur die Zeile „Logged in using ChatGPT",
  kein `--json`, keine Kontingent-Angabe. Die realen `codex exec --json`-
  Captures (`packages/adapter-codex/test/fixtures/`) enthalten **kein**
  Quota-/Rate-Limit-Ereignis irgendeiner Form. codex hat für dieses
  Kontingent-Modell schlicht keine Datenquelle — bestätigt, nicht vermutet.

**Die entscheidende architektonische Eigenschaft:** Ein `claude`-Login teilt
sein Fünf-Stunden- und Sieben-Tage-Kontingent über **alle** Sessions, die
diesen Login benutzen. Zwei parallele Sessions haben zwei getrennte
`costUsd`-Summen (ADR-0003, korrekt session-skopiert), aber **ein**
gemeinsames Kontingent. Ein Feld auf `SessionRecord` würde das falsch
darstellen: Session A zeigt 43 %, Session B zeigt ebenfalls 43 %, obwohl es
dieselbe Zahl ist — und ein Dashboard, das (wie bei `costUsd`,
`packages/pwa/src/Dashboard.tsx:57`) gewohnheitsmäßig über Sessions
summiert, würde 86 % anzeigen, wo real 43 % verbraucht sind. Das ist
Premortem-Risiko 2 aus `EPIC-P1.5-control-center-ux.md`.

## Abgewogene Optionen

1. **Neue optionale Adapter-Methode `usage?(): Promise<UsageQuota | null>`.**
   Verworfen: setzt einen On-Demand-Abfrageweg voraus, den weder `claude`
   noch `codex` real anbieten (siehe oben) — die Methode müsste bei jedem
   Aufruf entweder auf einen zwischengespeicherten Wert zurückfallen (dann
   ist die Methode nur eine Fassade über genau den Cache, den Option 3
   ohnehin braucht) oder eine Fähigkeit vortäuschen, die nicht existiert.
2. **`HealthReport` um einen optionalen Kontingent-Teil erweitern**, weil
   T1.9s Heartbeat `status(handle)` ohnehin alle 30 s pollt. Verworfen:
   `HealthReport` ist an ein `SessionHandle` gebunden — eine
   Pro-Prozess/Pro-Session-Antwort. Ein account-weiter Wert dort
   anzuhängen hieße, dass jede einzelne Session ihres Adapters denselben
   Wert redundant zurückgibt, und der Heartbeat müsste ihn pro Session neu
   „entdecken", obwohl er sich nicht pro Session ändert. Falscher
   semantischer Ort für eine Account-Eigenschaft.
3. **Hub-seitiger Cache, gespeist aus dem Event-Strom, mit einem neuen
   optionalen Feld auf `EmittedEvent`/`NormalizedEvent`** (exakt das
   Muster von ADR-0003s `costUsd`). Akzeptiert — siehe Entscheidung.

## Entscheidung

### Contract-Änderung (klein, additiv, rückwärtskompatibel)

`packages/contracts/src/event.ts` bekommt zwei neue Exporte plus ein neues
optionales Feld auf `NormalizedEvent`/`EmittedEvent`:

```ts
export const UsageWindow = z.object({
  /** Adapter-definierter Fenster-Bezeichner, z.B. "five_hour", "seven_day".
   *  Freier String, kein Enum — künftige Adapter (zai, swarm, local-llm)
   *  haben mit Sicherheit andere Fenster (täglich, monatlich, Guthaben-Topf
   *  ohne Reset). Die PWA übersetzt bekannte IDs, zeigt unbekannte roh. */
  id: z.string().min(1),
  /** 0.0-1.0 — Anteil des Fensters, der verbraucht ist. */
  utilization: z.number().min(0).max(1),
  /** ISO-8601. Für einen Guthaben-Topf ohne Reset: weit in der Zukunft
   *  oder das Feld schlicht sehr groß — niemals weggelassen, da "wann
   *  läuft es ab" sonst stillschweigend zu "nie" würde. */
  resetsAt: z.string().min(1),
});
export type UsageWindow = z.infer<typeof UsageWindow>;

export const UsageQuota = z.object({
  windows: z.array(UsageWindow).min(1),
  /** Kann das Konto über die Fenster hinaus (kostenpflichtig) weiterlaufen?
   *  Deckt den API-Guthaben-Teil der Nutzerfrage ab ("wann 0$ erreicht").
   *  Undefined = unbekannt, NICHT "nein". */
  overageAvailable: z.boolean().optional(),
  /** Menschlich lesbarer Grund, falls Overage blockiert ist (z.B. das real
   *  beobachtete "out_of_credits"). */
  overageBlockedReason: z.string().optional(),
});
export type UsageQuota = z.infer<typeof UsageQuota>;
```

Auf `NormalizedEvent` (und damit `EmittedEvent`, das per `.omit()` davon
ableitet):

```ts
/** Optionale Konto-Kontingent-Momentaufnahme (ADR-0004). Trägt
 *  Account-Daten huckepack auf einem Event, WEIL das der einzige Weg ist,
 *  wie ein Adapter sie überhaupt erfährt (kein On-Demand-Abfrageweg bei
 *  claude/codex) — wird vom Hub NICHT pro Session akkumuliert oder
 *  persistiert (siehe unten), sondern als jeweils letzter bekannter Wert
 *  pro Adapter-Id gecacht. */
usageQuota: UsageQuota.optional(),
```

### `AdapterCapabilities` — neues `usage: boolean`

```ts
/** Adapter kann grundsätzlich ein Kontingent melden (auch wenn eine
 *  einzelne Session nie eins sieht) — dieselbe Ehrlichkeitsregel wie bei
 *  `reasoning`/`cost` (T1.11): "kann in Prinzip", nicht "ist auf jedem
 *  Event garantiert befüllt". */
usage: boolean;
```

`claude`: `usage: true` (verifiziert, siehe Ground Truth oben).
`codex`: `usage: false` (verifiziert fehlend, kein Vermuten). Die PWA zeigt
für `usage: false` sofort und ohne Wartezeit „unbekannt (Adapter meldet
kein Kontingent)" statt auf ein Event zu warten, das nie kommt.

### Hub-seitiger Cache — kein neuer State in `SessionRecord`/SQLite

`SessionManager.emitEvents()` (`packages/core/src/sessionmanager.ts`)
bekommt neben der bestehenden `costUsd`-Akkumulation einen zweiten,
unabhängigen Pfad: trägt ein Event ein `usageQuota`, wird
`this.usageByAdapter.set(session.record.adapter, { quota: event.usageQuota,
observedAt: new Date().toISOString() })` aktualisiert — eine reine
In-Memory-`Map<adapterId, {quota, observedAt}>`, **keine** SQLite-Spalte,
**kein** Feld auf `SessionRecord`. „Zuletzt beobachtet gewinnt", unabhängig
davon, welche Session den Wert gemeldet hat — es ist derselbe
Konto-Zustand, egal durch welches Fenster er beobachtet wurde.

**Bewusst nicht K7-persistiert.** Anders als `SessionRecord`-Felder
überlebt dieser Cache einen Hub-Neustart nicht — das ist kein Verstoß
gegen AGENTS.md Regel 4 (State braucht einen Recovery-Pfad), weil es kein
Zustand ist, der *rekonstruiert* werden müsste: die nächste aktive Session
desselben Adapters liefert innerhalb ihres ersten Turns einen frischen
Wert, und ein veralteter Wert aus der Zeit vor dem Neustart wäre ohnehin
potenziell falsch. Dieser Kommentar gehört wortgleich an die
Cache-Implementierung, damit ein späterer Leser das nicht für eine
übersehene K7-Lücke hält.

Ein neuer Lese-Endpunkt (`GET /api/adapters/:id/usage`, Detailausgestaltung
Teil von T1.5-2) liefert `{ quota: UsageQuota | null, observedAt: string |
null }` — `null` heißt „noch keine Meldung von diesem Adapter", nicht 0 %
(Premortem-Risiko 3).

## Konsequenzen

- Contract-Änderung ist additiv und rückwärtskompatibel — bestehende
  Adapter/Clients, die `usageQuota` ignorieren, sind unbetroffen (exakt wie
  ADR-0003s `costUsd`-Einführung).
- `packages/adapter-claude/src/normalize.ts`s `rate_limit_event`-Case wird
  in T1.5-2 von der generischen `system`-Payload auf `usageQuota` +
  `unifiedWindows` → `windows[]`-Mapping umgestellt; `payload.info` roh
  bleibt zusätzlich erhalten (Debug-Wert), ist aber nicht mehr die einzige
  Quelle.
- `AdapterCapabilities.usage` ist ein **Breaking Change am Interface**
  (neues Pflichtfeld) — jeder bestehende Adapter (`dummy`, `claude`,
  `codex`) muss seinen `capabilities()`-Rückgabewert in T1.5-2 anpassen;
  betroffene Tests (`identity + capabilities are honest` in allen drei
  Adapter-Testsuiten) müssen mitgezogen werden.
- Kein neues SQLite-Schema, keine Migration — der Cache ist Prozessspeicher.
- README-Status-Matrix und `docs/adapters.md` brauchen eine neue Spalte
  „Kontingent" (T1.5-11, DoD-Teil, nicht Teil dieses ADR).
- Ein Adapter, der `usageQuota` fälscht oder übertreibt, verfälscht die
  Anzeige — dieselbe bereits akzeptierte Angriffsflächen-Einschätzung wie
  bei `costUsd` (ADR-0003, Adapter-Output ist Daten, nie Instruktion).

## Nachtrag 2026-09-24 — codex liefert doch ein Kontingent (T7.2)

„codex: verifiziert nicht vorhanden“ galt für `codex exec`. `codex app-server`
(0.156.1) beantwortet `account/rateLimits/read` und meldet
`account/rateLimits/updated`: ein 5-Stunden- (`primary`, 300 min) und ein
7-Tage-Fenster (`secondary`, 10080 min) mit `usedPercent` und `resetsAt`.
Im Standardmodus `app-server` ist `capabilities().usage` deshalb `true`; die
Fenster werden zu `five_hour`/`seven_day` (`app-server-events.ts quotaOf`,
ohne Reset-Zeit kein Fenster).
