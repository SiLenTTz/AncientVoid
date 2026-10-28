# Status-System-Konzept — robuster gegen falsch-positive „Fehler"

*Kurzkonzept, 2026-10-28. Anlass: BUG-0008 (Exit-0 als Fehler), BUG-0076
(pi: stale `healthy=false` nach gescheitertem Turn). Beide behoben; dieses
Dokument bewertet das zugrunde liegende Modell und schlägt weitere Schritte
vor. Keine dieser Änderungen ist umgesetzt — Vorschläge V1–V6 mit Aufwand
und Contract-Bezug.*

## 1. Ist-Zustand und seine Schwächen

Der Lauf-/Session-Status ist **ein** Feld (`SessionStatus`: idle, starting,
working, waiting_approval, parked, stopping, stopped, error) auf dem
`SessionRecord` (`packages/contracts/src/sessions/session.ts`). Drei
verschiedenartige Dinge fließen darin zusammen:

1. **Lebenszyklus** (starting → working → idle → stopped),
2. **Health** des Adapter-Prozesses (`runHeartbeat`,
   `session-manager.ts:231`: `down|broken` → `error`),
3. **Outcome** eines Turns (fehlgeschlagener Exit, Provider-Fehler).

Daraus entstehen die beobachteten Falsch-Positive-Klassen:

| Klasse | Beispiel | Status |
|---|---|---|
| Evidenz falsch gelesen | Exit 0 = planmäßiges Turn-Ende wurde als Absturz gewertet | BUG-0008, behoben |
| Zustand altert nicht aus | `healthy=false` überdauert den Prozess, reuse durch Folgeturn | BUG-0076, behoben (pi) |
| Eine Beobachtung = Fehler | einzelner Health-Check-Blip (throw/down) latcht sofort `error` | offen (Design: fail loud) |
| Konflation | `degraded` maskierte echten Ausfall | BUG-0008 Teil 3, behoben |

Die PWA zeigt `status` 1:1 („Fehler", `apps/pwa/src/shared/status.ts`), die
Statusleiste zählt `error` mit („… Fehler", `StatusBar.tsx:32`) — jede
Falsch-Positive oben ist direkt sichtbar.

## 2. Wie vergleichbare Systeme es modellieren

- **OpenAI Runs API**: `status` (queued, in_progress, requires_action,
  cancelling, cancelled, failed, completed, incomplete, expired) ist rein
  deskriptiv; der *Fehler* ist ein separates `last_error {code, message}`
  plus `incomplete_details {reason}`. „Approvals are paused runs, not new
  turns" — Warten ist ein Zustand, kein Fehler.
- **Airflow** zerlegt Fehler in Zustände: `failed` vs. `up_for_retry`
  (fehlgeschlagen, Versuche übrig → nicht terminal!) vs. `upstream_failed`
  vs. `skipped` — die *Kategorie* bestimmt, ob terminal und was als Nächstes
  sinnvoll ist.
- **Kubernetes**: `phase` (few, high-level, explizit *nicht* eine
  Zusammenfassung aller Beobachtungen) getrennt von `conditions`
  (unabhängige Beobachtungen wie Ready) und probes. Liveness-Probes haben
  `failureThreshold`: erst **N konsekutive** Misserfolge lösen die Reaktion
  aus; `Unknown` (Diagnose selbst fehlgeschlagen) löst *nichts* aus.
- **Alerting** (Google SRE, Grafana): Single-Messung ≠ Alarm; Bedingungen
  müssen über ein Fenster gehalten sein (retest window / `for:`), gegen
  Flapping gibt es explizite Recover-Fenster. Ziel-Größen: Precision,
  Recall, Detektionszeit, Reset-Zeit.

Gemeinsames Muster: **Zustand deskriptiv halten, Fehler als strukturierte
Nebeninformation, Beobachtung ≠ Evidenz, transiente Beobachtungen
debounce, harte Evidenz sofort.**

## 3. Vorschläge

### V3 — Heartbeat: Evidenz sofort, Beobachtung debounced (core-intern, kein Contract-Bruch)

`runHeartbeat` unterscheidet zwei Quellen:

- **Evidenzbasiert** (sofort `error`, fail loud): Prozess-Exit ≠ 0/null,
  RPC-/Append-Fehler, `broken` mit `detail` — Fakten, die der Adapter
  beobachtet hat, nicht rät.
- **Beobachtungsbasiert** (debounced): `status()` wirft (Heute: → `broken`
  → sofort `error`) oder meldet `down` ohne harten Befund (z. B. Loop-
  Adapter bei Broker-Reconnect). Erst nach `failureThreshold` (z. B. 2)
  **konsekutiven** Ticks `error`; Zähler resetet bei jedem gesunden Tick.
  Ein einzelner Blip wird als `degraded`-Event sichtbar (fail loud bleibt:
  es ist im Stream, nur nicht terminal).

Aufwand: klein (SessionManager + Test). K9 bleibt erfüllt, weil
Cursor-Clip-Breakage evidenzbasiert ist (sofort, < 60 s).

### V1 — `lastError` statt sticky error-Only (Contract → ADR nötig)

`SessionRecord.lastError: { category, code, message, at } | null` analog
OpenAI `last_error`: `error`-Status bleibt für „aktueller Zustand
fehlerhaft", aber *was* schiefging ist strukturiert ablesbar statt nur aus
Events zu rekonstruieren. K7: aus JSONL-Events ableitbar (Recovery-Pfad:
beim Rehydrate aus dem letzten error-Event füllen — kein neuer
Wahrheitsspeicher, nur Cache). K5: einige Bytes.

### V2 — Fehlerkategorien (Contract → ADR nötig, zusammen mit V1)

`provider` (Quota, Rate-Limit, Provider-Down), `worker` (Exit ≠ 0,
Timeout), `hub` (Append-Fehler, Recovery gescheitert), `user`
(abgebrochen). Kategorie entscheidet über UI-Text und sinnvolle nächste
Aktion („Limit erhöhen" vs. „nochmal senden" vs. „Hub-Log lesen") — Airflow-
Manier. Vorhandene Events (`provider.error`, `session.start_failed`,
`adapter.down`, …) liefern die Kategorie mit; `notificationFor` kann sie
übernehmen.

### V4 — Turn-Outcome als Messgröße konsistent nutzen (core-intern)

TurnMetrics (`runs/derive.ts`) kennt schon `outcome: ok|error`. Regel
festschreiben: **Turn fehlgeschlagen ≠ Session tot** (ADR-0015). Ein
fehlgeschlagener Turn setzt künftig `working → idle` + `lastError`, nicht
`error` — `error` bleibt Adapter-/Hub-Zuständen vorbehalten (Prozess weg,
nicht fortsetzbar). Das ist die größte Verhaltensänderung und braucht die
V3/V1-Grundlage; bis dahin bleibt der Status quo (fehlschlagender Turn →
`error`, nächster Prompt → `working`) korrekt und getestet.

### V6 — PWA: „Fehler" nur bei echtem Handlungsbedarf (pwa-intern)

Dashboard gruppiert `waiting_approval` und `error` gemeinsam als „braucht"
(`Dashboard.tsx:84`) — richtig. Ergänzen: Karte zeigt Kategorie-Badge
(`lastError.category`, sobald V1), Statusleiste trennt „braucht dich"
(waiting_approval) von „Fehler" (error). Kein Contract-Bruch.

### V5 — Warnungs-Regeln festschreiben (Doku, kein Code)

- stderr ist Warn-Log, nie error-Event (Ist-Zustand in allen Adaptern —
  alsInvariant festhalten, z. B. in `docs/adapters.md`).
- `degraded` ist informativ und verdeckt nie `down` (BUG-0008-Regel).
- Signale (SIGTERM/SIGKILL, Exit `null`) sind planmäßige Beendigung, kein
  Fehler (BUG-0008-Regel; tmux-Runner meldet Exit-Code `null`).

## 4. Bewertung gegen die Messlatten (PRD §9)

| ID | Wirkung | Einschätzung |
|---|---|---|
| K1 | keine neue Runde im Approve-Pfad | unberührt |
| K2 | kein zusätzliches Event pro Frame; Blip-Event einmalig | unberührt |
| K3 | Diff unberührt | unberührt |
| K4 | MCP unberührt | unberührt |
| K5 | `lastError` ≈ 100 B im Record/Event-Payload | eingehalten |
| K6 | Sprachsuche unberührt | unberührt |
| K7 | `lastError` aus JSONL rekonstruierbar (Cache, kein SSOT) — Recovery-Pfad Pflicht | eingehalten, Test gefordert |
| K8 | Heartbeat-Debounce reduziert Last unter 20 Sessions (weniger error-Events) | eingehalten/verbessert |
| K9 | evidenzbasierte Fehler bleiben sofort sichtbar (< 60 s); nur beobachtungsbasierte debounced (2×30 s = 60 s worst case, K9 betrifft evidenzbasierte Clip-Breakage) | eingehalten |
| K10 | Anzeige unberührt | unberührt |

## 5. Reihenfolge

1. **V3** (Debounce im Heartbeat) — kleinster Schritt, größter Effekt auf
   Falsch-Positive-Klasse „ein Blip = Fehler". Core-only, Test-first.
2. **V1+V2** (lastError + Kategorien) — ein ADR, ein Contract-Change,
   Grundlage für V6.
3. **V6** (PWA-Anzeige) — danach.
4. **V4** (Turn-Outcome ≠ Session-error) — letzter Schritt, braucht die
   anderen; Verhaltensänderung mit E2E-Begleitung.

BUG-0008/BUG-0076 haben die Klassen „Evidenz falsch gelesen" und
„Zustand altert nicht aus" bereits geschlossen; V3–V6 schließen die
verbleibende Klasse „Konflation" strukturell ab.
