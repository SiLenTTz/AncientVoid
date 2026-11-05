# EPIC-P27 — Unterbrochene Sessions: sichtbar, bewertbar, fortsetzbar

**Status:** abgeschlossen (05.11.2026); Code über MR !293 gemergt, alle AC lokal belegt · **Phase:** P27 · **Dauer:** ~1 Agenten-Woche · **Abhängigkeit:** fachlich keine offene zu P26 (läuft parallel daneben — Präzedenz P13/P14/P17); baut auf P5-Recovery, P15-Steuerung (`park`/`resume`, Archive) und P17-Resume-Referenzen ([ADR-0036](../docs/adr/0036-resume-referenzen-im-adapter-contract.md)) auf.

Auslöser: Betrieb 2026-10-28/30 — Hub-Abstürze (BUG-0074/0075) und Worker-Tötung
bei Hub-Neustart (BUG-0072) haben laufende Agenten-Sessions hart unterbrochen.
Folge: Der Nutzer musste den Zustand manuell nachfragen („Und alles sauber neu
gestartet?", 2026-10-30); die PWA zeigte weder Grund noch ordentlichen Abschluss,
und ein Fortsetzen war nur über Umwege (neue Nachricht an `stopped`/`parked`)
möglich. Auftrag: unterbrochene Sessions transparent und handhabbar machen —
bevorzugt automatische Wiederaufnahme, mindestens explizite
Weitermachen-/Archivieren-Optionen im Chat.

## 1. Ziel

Eine unterbrochene Session ist auf einen Blick als solche erkennbar (Grund,
Zeitpunkt, letzter Zug), ihr offener Zug wird ordentlich abgeschlossen (der
Endreport stimmt — kein hängender „läuft noch"), und der Nutzer kann direkt im
Chat **Weitermachen** (natives Resume gemäß ADR-0036-Deklaration) oder
**Archivieren** wählen. Automatische Wiederaufnahme nur dort, wo der Adapter
sie deklarativ sicher anbietet — nie auf Vermutung.

## 2. Scope (In / Out)

**In:** Statuswert `interrupted` + System-Event `session.interrupted` mit Grund
(`worker_exit` · `hub_restart` · `adapter_down`); Turn-Abschluss bei Interrupt
(`session.turn_end { reason: "interrupted" }`) für korrekten Endreport/Digest;
Chat-Banner mit Grund + Buttons Weitermachen/Archivieren; Übersichts-Badge;
Server-Route `POST /api/sessions/:id/resume` mit Mensch-ja/Agent-nein-Policy;
hubctl-Anzeige; optionaler Contract-Schalter `resume.auto` (additiv); E2E-Spec
für den Unterbrechungs-Ablauf.

**Out:** Auto-Resume ohne Adapter-Deklaration (Sicherheit vor Bequemlichkeit);
Änderungen am Worker-/Adapter-Contract über das additive Maß hinaus; Archiv-
Automatik/Retention; Loop-/Factory-Sessions (P19/P26); Hintergrund-Heilung
trotz „falschem“ altem Status in historischen Daten (Migration nur lesend).

## 3. Design-Details

### 3.0 Ist-Analyse (2026-10-30, Stand `main` f63dde2)

- **Status-Enum** `SESSION_STATUSES = idle|starting|working|waiting_approval|parked|stopping|stopped|error`
  — es gibt **keinen** Unterbrechungs-Zustand
  (`packages/contracts/src/sessions/session.ts:7`). Ein hart gekillter Agent
  ist nicht von einem fehlerhaften unterscheidbar.
- **Adapter-Health:** `report.state down|broken` → `setStatus("error")` +
  System-Event `adapter.down` (`packages/core/src/modules/sessions/session-manager.ts:231`).
  Prozess-Exit und Health werden bereits unterschieden (ebd. 204–220), aber
  beide münden in `error` — „abgeschnitten" vs. „kaputt" geht verloren.
- **K7-Recovery:** JSONL+Snapshot-Replay existiert (session-manager.ts:79,
  `< 3 s Restore`), klassifiziert aber nicht: Eine beim Hub-Absturz `working`
  persistierte Session bleibt nach Restore `working`, obwohl ihr Worker tot
  ist — der Chat zeigt einen toten „läuft noch"-Zustand (genau der manuelle
  Nachfrage-Grund). In T27.1 per Test verifizieren und verankern.
- **PWA:** Aktionen `stop`, `resume` (nur `parked`, zwischen Zügen),
  `archive` existieren (`apps/pwa/src/shared/api.ts:864–870`); der
  Senden-Button wird nur bei `stopped|parked` zu „Weiter"
  (`apps/pwa/src/features/session/SessionTail.tsx:977`). Für `error`/Interrupt
  gibt es **keine** Fortsetzungs- oder Archiv-Affordanz, kein Banner, keinen
  Grund. `ReportPane` zeigt den Endreport — dessen Korrektheit nach hartem
  Interrupt ist ungeprüft (offener Zug ohne `turn.end`).
- **Resume-Referenzen:** ADR-0036 deklariert je Harness
  `resume: { argv, ref: "native"|"token" }` (`apps/pwa/src/shared/api.ts:329`) —
  der Baustein für „Weitermachen" existiert im Contract, wird aber heute für
  die Fortsetzung nach Interrupt nicht genutzt.
- **hubctl:** gibt `s.status` roh aus (`apps/hubctl/src/cli.ts:102`) — ein
  neuer Statuswert fließt ohne Anpassung ehrlich durch.

### 3.1 Statusmodell (ADR-0044, additiv)

- `SESSION_STATUSES` + `"interrupted"`; `VALID_TRANSITIONS`
  (`packages/core/src/modules/sessions/session-state.ts:163`) erweitern:
  `working|waiting_approval|parked|starting → interrupted` (Interrupt-Gründe),
  `interrupted → working` (Resume), `interrupted → stopped` (Archiv/Stop),
  `interrupted → error` (Resume versucht und fehlgeschlagen — fail loud).
- System-Event `session.interrupted { reason, since?, lastTurnId? }` — K5:
  Payload ≤ 4 KB, keine Blobs nötig.
- Additiv nur: alte Clients sehen einen unbekannten Status. Defensive Regel
  für PWA/hubctl: unbekannter Status rendert als Status-Text-Banner, nie als
  Crash/White-Screen (K10-Geist).

### 3.2 Interrupt-Erkennung (Core)

- **Worker-Exit ohne Stop-Kommando** und ohne terminalen Status →
  `interrupted (worker_exit)`: Der Agent wurde abgeschnitten, er hat nicht
  versagt.
- **`adapter.down/broken` ohne vorliegendes Agent-Fehlerereignis** →
  `interrupted (adapter_down)`; mit vorliegendem Fehlerereignis bleibt es
  `error` (Fail loud, Ursache sichtbar).
- **Hub-Restart (K7):** Restore erkennt persistiertes `working|starting` +
  toten Worker → `interrupted (hub_restart)`; `parked|waiting_approval`
  bleiben unberührt (keine Über-Klassifikation).
- **Offener Zug:** bei Interrupt wird `session.turn_end { reason: "interrupted" }`
  emittiert, damit Digest/ReportPane den Zug abschließen — kein Fake-„done",
  sondern ehrlicher Abbruch-Grund im Report.

### 3.3 Weitermachen / Archivieren (PWA + Server)

- Chat-Banner bei `interrupted`: Grund, Zeitpunkt, letzter Zug; Buttons
  **[Weitermachen]** **[Archivieren]** (Archiv: bestehende Route).
- `POST /api/sessions/:id/resume`: Hub prüft die ADR-0036-Deklaration —
  mit `hub:true` und `ref:native` deklariert → nativer Resume-Aufruf über
  `Adapter.start({ args: { resumeSessionId } })` ohne neuen Prompt
  (ADR-0044-Konkretisierung vom 05.11.2026; argv/Stream bleiben beim Adapter); nicht deklariert → ehrlicher Hinweis
  „Dieser Adapter kann nicht nativ fortsetzen" + Option „Neue Nachricht mit
  Kontext" statt stiller Fehlleitung.
- Policy: nur Mensch darf Resume auslösen (kein Agent-Self-Resume) —
  Analogie zur ADR-0043-Steuer-Allowlist.
- Übersicht: Zune/Badge „unterbrochen" einschließlich Sortierung in
  „Braucht dich".

### 3.4 Automatische Wiederaufnahme — nur deklarativ sicher

Default **aus**. Auto-Resume nur, wenn der Adapter `resume.auto: true`
deklariert (neues optionales Feld, additiv) **und** die Config es erlaubt.
In P27: Feld + Policy-Gerüst + Aktivierung ausschließlich für `dummy` zu
Testzwecken. „Falls sicher machbar" heißt hier: machbar nur mit Deklaration,
sonst UI-Weg — kein Raten über halbfertige Dateischreibeszustände hinweg.

### 3.5 hubctl

`sessions` listet `interrupted` ehrlich (Fließt automatisch), `tail` zeigt
das `session.interrupted`-Event im Verlauf; Doku im CLI-Help.

## 4. Aufgaben (Checkliste T27.m)

- [x] **T27.1** Ist-Analyse-Verifikation per Test: K7-Restore über `working` +
  totem Worker (heute: bleibt `working`) — roter Test als Anker, Aussage in
      ADR-0044 fixieren. Messlatte: K7.
- [x] **T27.2** ADR-0044 + Contract: Status `interrupted`, Event
  `session.interrupted`, Transitions, `resume.auto` (optional), PWA/hubctl-
      Defensive-Regel für unbekannte Status. Messlatte: K5 (Event-Payload).
- [x] **T27.3** Core-Erkennung: `worker_exit`/`hub_restart`/`adapter_down` +
  `session.turn_end(interrupted)` + Report/Digest-Abschluss; Unit- + Integrationstests
  (BUG-0072/74/75-Szenarien als Fixtures). Messlatte: K7, K8 (kein
      Durchsatz-Rückschritt).
- [x] **T27.4** Server-Route `/resume` + Policy (Mensch ja/Agent nein) +
  hubctl-Anzeige/Doku. Messlatte: K1-Geist (API-Latenz unauffällig).
- [x] **T27.5** PWA: Banner, Buttons Weitermachen/Archivieren,
  Übersichts-Badge, Fail-loud bei unbekanntem Status. Messlatte: K2, K10.
- [x] **T27.6** E2E `e2e/specs/interrupted-session.spec.ts`: Kill → Banner →
  Weitermachen (dummy, `resume.auto`) und Archivieren; Endreport zeigt
  `session.turn_end(interrupted)`. Deterministischer Worker-Abbruch im Testadapter statt SIGKILL-Rennen
  (BUG-0077-Lektion). Lokales Gate vollständig grün.

## 5. Acceptance Criteria (AC-P27-k)

1. Ein hart gekillter Worker (kein Stop-Kommando) führt zu Status
   `interrupted` mit Grund `worker_exit`; der offene Zug endet mit
   `session.turn_end { reason: "interrupted" }`; Endreport/Digest schließen korrekt
   ab (Beleg: Integrationstest).
2. Hub-Restart über `working`-Sessions: nach Restore sind alle Sessions
   korrekt klassifiziert (`interrupted (hub_restart)` bzw. unangetastet
   `parked|waiting_approval`), Restore weiter < 3 s (K7-Beleg).
3. Chat zeigt bei `interrupted` Banner mit Grund + Weitermachen/Archivieren;
   beide Aktionen funktionieren nachvollziehbar (E2E-Spec, dummy-Adapter).
4. Adapter ohne Resume-Deklaration: ehrliche Meldung, kein stiller Fallback
   (fail loud), Archivieren funktioniert trotzdem.
5. `hubctl sessions`/`tail` zeigen `interrupted` bzw. das Event.
6. Auto-Resume feuert ausschließlich bei `resume.auto`-Deklaration + Config-
   Freigabe (Test: ohne beides bleibt alles manuell).
7. Unbekannter Statuswert in PWA/hubctl: sichtbares Banner/Text, kein
   White-Screen.
8. `npm run gate` grün inkl. neuem E2E-Spec; keine K5-/K7-Verletzung
   (EventStore-Enforcement + Recovery-Test grün).

## 6. Premortem (Failure-Modi + Mitigation)

1. **„Alles wird interrupted"** — Adapter sterben aus hundert Gründen; die
   Grenze zu `error` verwässert, echte Fehler verschwinden in der Masse. →
   Grund ist Pflichtfeld; `adapter_down` nur ohne vorliegendes
   Agent-Fehlerereignis; fehlgeschlagenes Resume geht fail-loud nach `error`.
2. **Resume erzeugt Doppelarbeit/halbe Zustände** — der Agent hatte Dateien
   halb geschrieben, ein naiver Neustart verhebt. → Auto nur mit Deklaration;
   sonst menschlicher Klick mit sichtbarem letztem Zug; Resume-argv aus dem
   Contract, nicht aus Agent-Output (PRD §8.5).
3. **Contract-Bruch für alte Clients** — unbekannter Statuswert crasht PWA/
   hubctl älterer Version. → Streng additiv; Defensive-Rendering-Regel als
   AC-7; ADR-0044 dokumentiert die Versionsgrenze.
4. **K7-Regression durch Fehlklassifikation** — der Restore verschiebt auch
   gesunde `parked`/`waiting_approval` nach `interrupted`. → Klassifikation
   nur für `working|starting` + nachweislich toten Worker; Integrationstest
   mit echtem Hub-Restart als Anker (T27.1).
5. **E2E-Flake durch Kill-Timing** — SIGKILL-Rennen werden zum zweiten
   BUG-0077. → deterministische Test-Kill-Route/Adapter-Hook; bei Fehlschlag
   Trace sofort sichern (Repro-Anleitung aus BUG-0077 übernommen).

## 7. Definition of Done

- Alle AC mit Beleg (Test-/E2E-Output) grün; Erfüllung in dieser Datei
  vermerkt.
- `npm run gate` grün; jeder neue UI-Ablauf hat einen Spec in `e2e/specs/`
  ([`docs/testing-e2e.md`](../docs/testing-e2e.md)).
- ADR-0044 gemerged **vor** dem Contract-Merge (contracts first); Contract-
  Änderung ausschließlich additiv.
- Erreichbarkeit: PWA-Chat + Übersicht, `hubctl`, ADR-0044 und — falls
  Statusmatrix betroffen — README-Anpassung.
- Keine neue State-Quelle ohne Recovery-Pfad (K7): `interrupted` folgt
  allein aus JSONL-Events, ist replaybar.
- Retro (`retro`-Skill) nach Abschluss.

## Umsetzung und Review vom 05.11.2026

ADR-0044 war mit Status/Transitions und `resume.hub`/`resume.auto` bereits
vorhanden. Die Umsetzung konkretisiert natives Resume über den Adapter-Start
(ohne neuen Prompt), statt einen Anzeige-Befehl ohne Stream-Parser zu spawnen.
Produktive Adapter bleiben ohne Hub-Resume-Opt-in. Handbuch:
[Unterbrochene Sessions](../docs/interrupted-sessions.md).

### AC-Nachweise

| AC | Beleg |
|---|---|
| AC-P27-1 | `interrupted-session.integration.test.ts`: `worker exit completes a cut-off turn` (kurzlebig/persistent), `an explicit agent/provider error remains error`; `session.turn_end` genau einmal, Laufmesswert `error`, kein Erfolgshinweis, Digest mit Abbruchgrund |
| AC-P27-2 | dieselbe Suite: `dead workers after restart are classified within K7` (< 3000 ms), echte offene Tool-Freigabe + `parked` unverändert; `restart completes an interruption whose final turn_end was not written` (Journal-Reparatur ohne Seq-Lücke/Duplikat); bestehender tmux-Marker-Recovery-Test |
| AC-P27-3 | `e2e/specs/interrupted-session.spec.ts`: Worker-Verlust → Banner → Bericht → Weitermachen → erneuter Verlust → Archivieren; echter Hub, eigene Daten, Dummy mit echtem Worker, Mobile + Desktop |
| AC-P27-4 | Core: `undeclared resume stays interrupted with an honest refusal`; E2E `ehrliche Meldung, Archivieren funktioniert trotzdem`; fehlende Provider-ID startet keinen neuen Lauf |
| AC-P27-5 | `apps/hubctl/test/interrupted.integration.test.ts`: echte CLI-Prozesse gegen lokalen HTTP-Testserver (`sessions`, `tail`), Status und Grund sichtbar |
| AC-P27-6 | Core-Matrix Config × Deklaration, fehlendes Hub-Opt-in im Testkit rot; E2E `Dummy läuft nur mit deklarierter und konfigurierter Freigabe weiter`; Agent über beide HTTP-Eingänge 403 (Policy-Test) |
| AC-P27-7 | E2E `unbekannter Status bleibt als Text sichtbar`, CLI-Integration mit `future_status`; keine uncaught PWA-Exceptions (Fixture-Gate) |
| AC-P27-8 | `npm run gate` am Code `28fb33d`: 1181 Unit-/Integrationstests, 295 E2E-Pässe, zwei bestehende Mobile-Handoff-Skips (Desktop-Gegenstücke grün); Typecheck/Lint/Links/Commits/Architektur/Matrix und PWA-Build grün. CI-Kontingentfehler separat unter P28 erfasst; Skips sind keine Pässe |

### Verhaltenspräzisierungen

- Erwartete Worker-Exits nach explizitem Pause-Signal unterbrechen nicht; ein
  neuer Worker bekommt eine neue Lebensdauer. Abgebrochene Kontexte können
  weder Events noch Turn-Wechsel in den fortgesetzten Zug schreiben.
- Die gespeicherte Queue bleibt nach Interrupt erhalten und wartet auf einen
  menschlichen Folgeauftrag; erst nach dessen Zugende wird sie abgearbeitet.
- Der Digest wird am beendeten Journal-Abschnitt eingefroren, auch bei
  gleichzeitigem Auto-Resume. Die PWA beginnt Zeit/Plan des fortgesetzten Zugs
  bei `session.resumed`; sie übernimmt keinen alten Fortschritt als aktuellen.
- `waiting_approval` mit echter offener Freigabe bleibt erhalten. Verwaiste
  Freigabeanzeigen werden weiterhin nach BUG-0048 geheilt.

### Review (pr-review, sechs Dimensionen)

1. Requirements: alle acht AC lokal belegt (Matrix oben); der CI-Exit gehört zu P28, nicht zur P27-DoD.
2. Architektur: gemeinsame Interrupt-Typen und Actor-Policy in Contracts;
   ADR-0044 konkretisiert die Opt-in-Semantik. Fachlogik im Sessions-Modul,
   HTTP im Sessions-Routenmodul, Banner im Session-Feature.
3. Edges: geplanter Stop/Pause, unerwarteter Exit, expliziter Provider-Fehler,
   Neustart mit lebendem/totem Worker, doppelte Resume-Eingabe, fehlende ID,
   Resume-Fehler, alte Kontexte, unvollständiger Journal-Abschluss getestet.
4. Qualität: vorhandener Adapter-Start/Steer-/EventStore-Pfad bleibt die Naht;
   kein zweiter CLI-Parser und kein Shell-Template-Interpreter.
5. Determinismus: erste neue Core-Suite 12 rot / 1 grün vor Implementierung;
   Testkit-Negativproben und Resume-Zeitanzeige ebenfalls rot-dann-grün.
   Neue E2Es dreifach geprüft; Test-Hook liegt ausschließlich in `e2e/support`.
6. Future-Fragility: Contract additiv + ADR; Adapter bleiben auf AdapterContext
   beschränkt; kleine Interrupt-Payloads + bestehendes K5-Enforcement; Zustand
   aus Journal/Snapshot, einschließlich Reparatur eines fehlenden Turn-Endes;
   unbekannte Provider-Ausfälle bleiben sichtbar, bewusst abgebrochene alte
   Kontexte schreiben nicht in einen neuen Lauf.

### Lokaler Abschlussnachweis

Code-Stand: `28fb33dba83e44133b71cbb218a662f6fb3b5715`.
ADR-Präzisierung zuvor gemergt: [!292](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/292).
Implementierung: [!293](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/293),
gemergt als `db39814ed6b8500c9c6f6f4326e563a184fd4109`.

- Finales `npm run gate`: Exit 0; 170 Testdateien / 1181 Tests bestanden;
  E2E 295 bestanden / zwei bestehende Mobile-Handoff-Skips, deren Desktop-Läufe
  bestanden. Die P27-Specs haben keine Skips. PWA-Build im globalSetup grün;
  Typecheck, Lint, Links, Commits, Architektur und Adapter-Matrix grün.
- Neue Specs dreifach: 30/30 bestanden (fünf Fälle × Mobile/Desktop × drei Läufe).
- K8: `npm run loadtest`, 20 × 30 Events/s × 10 s; 6100 Events ohne Verlust,
  ~599 Events/s aggregiert, 143 MB RSS. Kein reduziertes Limit.
- `npm run check:commits` nach den abschließenden Code-Commits erneut grün.
  Der erste Code-Commit trägt `@`, weil dessen voller E2E-Lauf noch lief;
  der finale Korrektur-Commit `28fb33d` trägt nach dem grünen Gate `^`.
- Die früheren roten Repros wurden behoben und im finalen Gate geprüft,
  nicht durch Retries oder reduzierte Assertions als grün gewertet.

### Externer CI-Befund für P28

Die MR-Pipeline [3033543422](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3033543422)
prüfte den finalen Code-SHA `28fb33d`. Sowohl
[verify 17784041304](https://gitlab.com/SiLenT_Tz/AncientVoid/-/jobs/17784041304)
als auch [e2e 17784041305](https://gitlab.com/SiLenT_Tz/AncientVoid/-/jobs/17784041305)
scheiterten mit `ci_quota_exceeded`. Der frühere E2E-Job
[17780335324](https://gitlab.com/SiLenT_Tz/AncientVoid/-/jobs/17780335324)
hatte denselben Infrastrukturfehler. Die Runner-Abfrage ergab ausschließlich
Shared-Runner, keinen eigenen Projekt-Runner. Kein solcher Job zählt als Pass.

Nach AGENTS.md blockiert dieser externe Fehler den lokal belegten Merge nicht.
P27 fordert in seiner DoD das lokale Gate; der zusätzliche grüne Pipeline-Job
ist ein Exit von **P28**. Die zunächst angenommene zusätzliche P27-CI-Sperre
war eine falsche Zuordnung und wurde beim Abschluss korrigiert. Es wurden
weder Merge-Regeln geändert noch Credits gekauft oder Runner registriert.
Kapazitätsentscheidung und belastbare CI-Wiederholungen gehen nach P28.

### Abschlussnachprüfung der Laufgenerationen

Drei zusätzliche Negativproben waren vor der Korrektur rot (18/21 grün),
danach alle 21 gezielten Core-Integrationstests grün:

- Ein älterer abgeschlossener Interrupt darf einen neu begonnenen, erneut
  unterbrochenen Resume-Zug nicht verdecken. Recovery ordnet Marker und
  Turn-Ende der aktuellen Start-/Resume-Grenze zu und ergänzt genau einmal.
- Nach Stop/Weiter beginnt der Worker-Zähler bei null. Ein verspäteter Exit
  der abgebrochenen alten Generation kann weder zählen noch den neuen Lauf
  offen halten; der neue saubere Exit führt wieder nach `idle`.
- Archivieren einer unterbrochenen Session übernimmt den authentifizierten
  Akteur bis in das `session.stopped`-Audit-Ereignis.

Vor dem erneuten P27-Abschluss wurden bestehende CI-Blocker separat korrigiert:
[!294](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/294) (BUG-0089,
konfiguriertes eigenes Fleet-Label),
[!295](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/295) (BUG-0090,
Desktop-Auftrag erst nach Ausführung prüfen),
[!296](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/296) (BUG-0091,
Timeout-Probe wartet auf den vorherigen Turn-Abschluss),
[!297](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/297) (BUG-0043,
Mausrad löst Mitlaufen vor verzögertem Scroll-Signal).
Jeder Fix hat einen roten Repro, eine eigene MR und Post-Merge-Branch-Cleanup;
keine Limits, Retries oder Skip-Regeln wurden entschärft.

## Retro (05.11.2026)

AC-P27-1 bis AC-P27-8: **8 erfüllt**, jeweils mit Testbeleg in der obigen
AC-Matrix; maßgeblich ist der finale Code `28fb33d` mit vollständigem lokalen
Gate. ADR !292 wurde vor dem Contract-/Runtime-Merge !293 gemergt. Runbook,
CLI-Hilfe und README verlinken den Ablauf; Journal/Snapshot bleiben die einzige
persistente Zustandsquelle.

Erkenntnisse und Premortem-Abgleich:

1. Die Grenze zwischen Abbruch und Provider-Fehler bleibt prüfbar: die Tests
   `an explicit agent/provider error remains error` und die geplante
   Pause-/Stop-Abgrenzung sichern Premortem 1 ab.
2. Native Fortsetzung braucht eine echte Adapter-Naht: ADR-0044 / !292 und
   die Opt-in-Matrix verhindern geratenes Auto-Resume (Premortem 2).
3. Unbekannter Status bleibt sichtbar; CLI-Integration und Browser-Spec
   belegen die defensive Darstellung (Premortem 3).
4. Eine ältere Unterbrechung verdeckte im roten Repro einen neuen offenen
   Resume-Zug. `28fb33d` repariert genau dessen Journal-Grenze; 21 gezielte
   Integrationstests sichern K7 ab (Premortem 4 konkret eingetreten).
5. Die neuen Worker-Abbruch-Specs liefen 30/30 ohne Timing-Skips
   (Premortem 5 nicht eingetreten). Bestehende andere E2E-Rennen wurden über
   !295/!296/!297 separat behoben; CI-Kapazität bleibt davon unabhängig.

Action Items:

- **AI-P27-1:** Quota-/Job-Befunde in das Gate-Inventar übernehmen — Ziel:
  [P28 T28.1](EPIC-P28-reproduzierbare-ci.md); konkrete Job-IDs stehen oben.
- **AI-P27-2:** Isolierte Ausführung samt Host-/Kostenentscheidung und drei
  vollständigen CI-Nachweisen herstellen — Ziel: P28 T28.2/T28.5. Keine
  externe Einrichtung ohne die dort verlangte Betriebsentscheidung.
