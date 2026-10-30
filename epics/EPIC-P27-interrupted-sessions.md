# EPIC-P27 — Unterbrochene Sessions: sichtbar, bewertbar, fortsetzbar

**Status:** offen · **Phase:** P27 · **Dauer:** ~1 Agenten-Woche · **Abhängigkeit:** fachlich keine offene zu P26 (läuft parallel daneben — Präzedenz P13/P14/P17); baut auf P5-Recovery, P15-Steuerung (`park`/`resume`, Archive) und P17-Resume-Referenzen ([ADR-0036](../docs/adr/0036-resume-referenzen-im-adapter-contract.md)) auf.

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
(`turn.end { reason: "interrupted" }`) für korrekten Endreport/Digest;
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
- **Offener Zug:** bei Interrupt wird `turn.end { reason: "interrupted" }`
  emittiert, damit Digest/ReportPane den Zug abschließen — kein Fake-„done",
  sondern ehrlicher Abbruch-Grund im Report.

### 3.3 Weitermachen / Archivieren (PWA + Server)

- Chat-Banner bei `interrupted`: Grund, Zeitpunkt, letzter Zug; Buttons
  **[Weitermachen]** **[Archivieren]** (Archiv: bestehende Route).
- `POST /api/sessions/:id/resume`: Hub prüft die ADR-0036-Deklaration —
  deklariert → native Resume-Aufruf (argv aus dem Contract, nie aus
  Agent-Output, PRD §8.5-Grenze); nicht deklariert → ehrlicher Hinweis
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

- [ ] **T27.1** Ist-Analyse-Verifikation per Test: K7-Restore über `working` +
  totem Worker (heute: bleibt `working`) — roter Test als Anker, Aussage in
      ADR-0044 fixieren. Messlatte: K7.
- [ ] **T27.2** ADR-0044 + Contract: Status `interrupted`, Event
  `session.interrupted`, Transitions, `resume.auto` (optional), PWA/hubctl-
      Defensive-Regel für unbekannte Status. Messlatte: K5 (Event-Payload).
- [ ] **T27.3** Core-Erkennung: `worker_exit`/`hub_restart`/`adapter_down` +
  `turn.end(interrupted)` + Report/Digest-Abschluss; Unit- + Integrationstests
  (BUG-0072/74/75-Szenarien als Fixtures). Messlatte: K7, K8 (kein
      Durchsatz-Rückschritt).
- [ ] **T27.4** Server-Route `/resume` + Policy (Mensch ja/Agent nein) +
  hubctl-Anzeige/Doku. Messlatte: K1-Geist (API-Latenz unauffällig).
- [ ] **T27.5** PWA: Banner, Buttons Weitermachen/Archivieren,
  Übersichts-Badge, Fail-loud bei unbekanntem Status. Messlatte: K2, K10.
- [ ] **T27.6** E2E `e2e/specs/interrupted-session.spec.ts`: Kill → Banner →
  Weitermachen (dummy, `resume.auto`) und Archivieren; Endreport zeigt
  `turn.end(interrupted)`. Deterministische Kill-Route statt SIGKILL-Rennen
  (BUG-0077-Lektion). Gates voll grün.

## 5. Acceptance Criteria (AC-P27-k)

1. Ein hart gekillter Worker (kein Stop-Kommando) führt zu Status
   `interrupted` mit Grund `worker_exit`; der offene Zug endet mit
   `turn.end { reason: "interrupted" }`; Endreport/Digest schließen korrekt
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
