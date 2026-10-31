# EPIC-P19 — Loop / Dark Factory: securesight-factory und aSPARK-Factory als wählbare Loops

**Status:** Gebaut (2026-10-28, Auftrag von Jan): Contract, Core, beide Connectors (`packages/loops/*`), Auswahl, Kopf-Abzeichen und Loop-Panel.
**Offen:** die manuelle Abnahme (echtes Repo mit Token, wartende Frage am Handy, K1 gesamt); ein Loop ohne Eintrag in `loops[]` bleibt sichtbar, gesperrt und begründet ·
**Phase:** P19 · **Dauer:** 2–3 Agenten-Wochen · **Abhängigkeit:** fachlich keine (baut auf P15 Modus-/Steuermuster,
P17 Resume-Referenzen und Worker-Marker auf). Präzedenz wie P13/P14/P17: unabhängiges Epic neben offenen Abnahmen.
P18 (Desktop-Workspace) ist seit 2026-10-27 gemergt, das Gating ist damit kein Hindernis mehr. Offen bleibt die Bestätigung des ADR.

Auslöser: Wunsch von Jan vom 2026-10-27: „Neben Host, Adapter, Model und Mode eine weitere
Auswahldimension Loop / Dark Factory, mehrere austauschbare Implementierungen, zuerst
securesight-harnez (mit Hermes als Orchestrator) und aSPARK-Factory.“
**Umbenennung (Jan, 2026-10-27):** Der Loop heißt `securesight-factory`. `securesight-harnez` bleibt der Name des Harness-Adapters im Hub.
Analyse: [docs/loop-analyse-2026-10-27.md](../docs/loop-analyse-2026-10-27.md).

## 1. Ziel

Am Handy und am PC lässt sich beim Start einer Session ein **Loop** wählen. Der Hub
verbindet sich über einen `LoopConnector` mit dem Loop-System, zeigt dessen Zustand,
Fortschritt, Gates und Fragen als normale Session mit Verlauf, nimmt Freigaben vom
Handy entgegen und steuert den Loop (pausieren, fortsetzen, Betriebsart). Zwei
Implementierungen liegen bei: `aspark-factory` (MQTT) und `securesight-factory`
(CLI und Dateien, Orchestrator `self` oder `hermes`). Weitere Loops kommen als Paket
dazu, ohne den Hub zu ändern.

## 2. Scope (In / Out)

**In:**
- **Contract** `@ancientvoid/contracts/loops` (`LoopConnector`, `LoopCapabilities`, `LoopSpec`,
  `LoopControl`), `SessionSpec.loop`, Spalte `sessions.loop_id`, Event `session.loop`;
  Testkit-Suite `runLoopContractTests()`.
- **Core-Modul `loops`:** Registry aus `hub.config.json` (`loops[]`), `loopAsAdapter()`,
  Recovery (K7), Gesundheitsstatus je Loop.
- **Hub-Routen:** `GET /api/loops` (Fähigkeiten, Gesundheit, ohne Secrets). Start über
  `POST /api/sessions` mit `loop`. Policy „Mensch ja, Agent nein“ für Start,
  Betriebsart, `workNext`, Fortsetzen.
- **Loop `aspark-factory`:** MQTT-Leitstand-Client (`info`, `state`, `progress`, `stats`,
  `report`, `ask`; `answer`, `command`).
- **Loop `securesight-factory`:** `supervisor-status`, Notify-Dateien, Transcript-Bus,
  `progress show`; Orchestrator `self | hermes` (Hermes: Zustand lesen, v1 ohne Start).
- **PWA:** Zeile „Loop“ im Start-Formular, Optionen aus Fähigkeiten, Session-Kopf-Abzeichen,
  Loop-Panel, Freigaben mit Quellenkennzeichnung, Bestätigungsdialog für `dark`/`a`.
- **Messläufe** K1/K2/K7/K9 und Doku `docs/loops.md`, Matrix-Eintrag in `README.md`/`docs/adapters.md`.

**Out:** Loops, die der Hub selbst treibt (`agents: "hub"`, „Ralph im Hub“), Kind-Sessions
(ein aSPARK-Ticket je Hub-Session), „Immer erlauben“-Regeln, Anlegen von MQTT-Nutzern
oder Lines (das bleibt `factoryctl`), Änderungen am Repo `securesight-harnez` (künftig `securesight-factory`) oder
`aSPARK-Factory`, Loop-Marktplatz, Multi-Host-Loops (Fleet bleibt ADR-0017).

## 3. Design-Details

- **Struktur nach ADR-0020:** Fachlogik `packages/core/src/modules/loops/` (öffentlich nur
  über `index.ts`), Verträge `packages/contracts/src/loops/`, Routen
  `apps/hub/src/modules/loops/loops.routes.ts`, PWA `apps/pwa/src/features/loops/`,
  Implementierungen `packages/loops/<name>/`. `npm run check:arch` bekommt die Regel
  „`packages/loops/*` importiert nur `@ancientvoid/contracts`“.
- **aSPARK-Abbildung** (Analyse §3.4): `ask.permission` → `requestToolPermission`,
  `ask.question` → `AskUserQuestion` mit `ToolQuestion[]`. Antwort nur `allow`/`deny`
  einmalig. `state`/`info` → `loop.state`/`loop.info`. `progress` → `loop.progress` und
  Plan-Anzeige. `report` → Blob + `loop.report`. Last Will `offline` → `loop.broken`.
- **harnez-Abbildung** (Analyse §2.4): Transcript-Arten 1:1 auf Event-Typen,
  `supervisor-status` Exit 3 → Push „human_hold“, Exit 4/5 → `loop.broken`. Der Hub liest
  `mode` aus `supervisor-status` und nimmt ihn nie an.
- **Recovery (K7):** `session.loop` + `loop.cursor` im JSONL. aSPARK: Wiederverbinden und
  retained Nachrichten gegen den Cursor abgleichen. harnez: Transcript ab `seq`
  weiterlesen, Dateizustand neu lesen.
- **Secrets:** nur Konfiguration, nie Event, nie API, nie Log (Leak-Test).
- **Test ohne fremdes System:** Connector-Logik gegen einen **injizierten** MQTT-Client
  bzw. gegen Fixtures (aufgezeichnet, anonymisiert, secret-gescannt). E2E mit echtem
  Mosquitto läuft nur, wenn Docker da ist, und skippt sonst sichtbar (Muster ADR-0002).

## 4. Aufgaben

- [x] **T19.1 — Loop-Contract und Testkit.** *Erledigt 2026-10-28:* `contracts/loops` (`LoopConnector`, `LoopCapabilities`, `LoopSpec`,
  `LoopInfo`), `loop` im Start-Body, `runLoopContractTests()` und `fake-loop` im Testkit. K5, K7.
- [x] **T19.2 — Core-Modul `loops`.** *Erledigt 2026-10-28:* `LoopRegistry`, `loopAsAdapter` (Snapshot mit Startvorgabe und Cursor
  unter `data/loops/`, Recovery daraus), `loops[]` in der Config, Laden per `loadLoops`. Event `session.loop` und Spalte `loop_id` sind
  entfallen: die Zuordnung steckt im Adapter-Namen `loop:<id>`. K7.
- [x] **T19.3 — Hub-Route und Policy.** *Erledigt 2026-10-28* (Audit-Event bei Betriebsartwechsel gehört zu T19.4/T19.5). `GET /api/loops`, Start mit `loop`, Policy-Operationen,
  Audit-Event bei Betriebsartwechsel. `check:arch`-Regel.
- [x] **T19.4 — Loop `aspark-factory`.** *Erledigt 2026-10-28* (Paket `@ancientvoid/loop-aspark-factory`, einzige Abhängigkeit `mqtt`):
  MQTT-Leitstand-Client, Fragen und Antworten (permission und question), Befehle gegen `commands[]`, `loop.broken` bei
  Last Will, `v≠1`, kaputtem JSON und Brokerverlust, Berichte >2 KB als Blob (K5), beantwortete Fragen im Cursor (K7).
  Getestet gegen einen echten Mosquitto (11 Tests, Skip wenn er fehlt). Die Anleitung für den Hub-MQTT-Nutzer
  (Nutzer + ACL, Zugangsdaten via `passwordEnvFile`, Auswahl, Vorab-Check) liegt seit 2026-10-29 in
  [`docs/aspark-factory-mqtt.md`](../docs/aspark-factory-mqtt.md). K1, K9 messen wir erst gegen eine laufende Linie.
- [x] **T19.5 — Loop `securesight-factory`.** *Erledigt 2026-10-28* (Paket `@ancientvoid/loop-securesight-factory`, keine Fremdabhängigkeit):
  Supervisor-Status per `execFile` (Exit 3 → `loop.hold`, 4/5 → `loop.broken`), Notify-Dateien, Transcript mit Byte-Cursor je Datei
  (ab Start, halbe Zeile wartet, ≤200 Zeilen je Durchlauf), `progress.json`, Orchestrator `self | hermes` (Hermes nur lesend,
  Option `epic`). Der Hub schreibt nichts ins Projekt (Test vergleicht das Verzeichnis vorher/nachher), jeder Befehl wird abgelehnt.
  Getestet gegen ein Temp-Projekt mit kleinem Python-Stand-in für `betrieb.py` (9 Tests). Fortsetzen bleibt ein Tipp in MR 4. K2, K7, K9 messen wir erst gegen das echte Projekt.
- [x] **T19.6 — PWA.** *Erledigt 2026-10-28:* Zeile „Loop“ im Start-Formular (Optionen aus den Fähigkeiten, gesperrt mit Grund),
  Kopf-Abzeichen „Loop · Name · Betriebsart“ (Störung/Halt/Pause vorn), Loop-Panel (Fortschritt, Gate, Halt, Störungen,
  Eskalationen, Statistik, Bericht, Pause/Weiter, Betriebsart mit Bestätigung bei Außenwirkung). Der Zustand wird nur aus den
  `loop.*`-Ereignissen gefaltet (`deriveLoopView`, 5 Unit-Tests); Specs in `loops.spec.ts` (5 Tests). Fragen laufen über die
  bestehende Freigaben-Ansicht. K10, AC-P8-5.
- [x] **T19.7 — Messläufe und Doku.** *Erledigt 2026-10-28:* [Messlauf](../docs/messlauf/2026-10-28-p19-loops.md) (K2, K9, K7, K1-Maschinenanteil),
  `docs/loops.md`, ADR-Nachtrag. `loop.hold`, `loop.broken` und `loop.notify` lösen Benachrichtigungen aus. K1 gesamt (Push, Biometrie)
  und echte Läufe (neues Repo mit Token, wartende Frage) sind offen und stehen als manuelle Abnahme im Messlauf.
- [x] **T19.8 — Repo anbinden (Nachtrag).** Onboarding im Contract (`LoopOnboarding`, `onboard()`), Route `POST /api/loops/:id/onboard`
  (Policy `loops.onboard`), aSPARK geht `factoryctl new` selbst durch (Token über stdin), Formular „Neues Repo anbinden“ in der
  Startauswahl; Leitstand-Passwort aus `factory.env`; `.factory/` nach der Umbenennung von securesight; Hermes-Freigaben im Panel.

## 5. Acceptance Criteria

- **AC-P19-1 (K1):** Eine `ask` eines Stand-in-aSPARK-Brokers erscheint am Handy, wird
  beantwortet, und die Antwort liegt am Broker: p95 < 5 s (Push → Biometrie → Antwort).
  Unbekannte oder späte Antworten ändern nichts und werden als „bereits beantwortet“ gezeigt.
- **AC-P19-2 (K2):** Der Transcript-Bus einer harnez-Session erscheint live bei 30 ev/s,
  kein Frame-Lag > 200 ms. `human_hold` löst eine Benachrichtigung in < 60 s aus.
- **AC-P19-3 (K7):** Hub-Neustart während eines laufenden Loops: Zustand 100 % identisch,
  < 3 s, keine doppelten und keine fehlenden Ereignisse (Cursor-Prüfung).
- **AC-P19-4 (K9):** Eine unbekannte Schema-Version bzw. ein Last Will `offline` bzw.
  `supervisor-status` Exit 4 ergibt `loop.broken` mit Grund in < 60 s. Alle anderen Sessions
  laufen ungestört.
- **AC-P19-5:** Loop `keiner` verhält sich exakt wie vorher. `layout.spec.ts` und alle
  Mobile-Specs bleiben grün.
- **AC-P19-6 (Kapselung):** `check:arch` schlägt bei einem Import aus `@ancientvoid/core`/`@ancientvoid/server`
  in `packages/loops/*` fehl. Kein Secret in Events, API-Antworten und Logs (Leak-Test).
- **AC-P19-7 (Orchestrator):** Die Hermes-Wahl ist Konfiguration des Loops (Start-Formular →
  `session.loop` → Connector). Ein Stand-in liefert Ralph-State-Dateien, die Oberfläche zeigt
  Fortschritt und `user-gates`.
- **AC-P19-8 (Außenwirkung):** Ein Agenten-Token kann weder Loops starten noch Betriebsart
  wechseln noch fortsetzen (Policy-Test).

## 6. Premortem

1. **Formatbruch im Loop-System.** Andreas ändert das MQTT-Schema (aktuell 0.8.0, Pull Requests im
   Tagestakt), Jan ändert das harnez-Dateiformat. *Mitigation:* `v`/`schema_version` wird
   geprüft, Unbekanntes wird zu `loop.broken` (nie still verworfen), Fixtures sind aus echten
   Läufen, AC-P19-4.
2. **Zwei Leitstände antworten gleichzeitig** (`factoryctl`-TUI, ESP32-Leitstand, Hub). *Mitigation:*
   Der Loop nimmt die erste Antwort, die Oberfläche zeigt die Frage als erledigt, sobald die
   retained `ask` geräumt ist. Antwort-Idempotenz über die `id`.
3. **Der Hub löst ungewollt Außenwirkung aus** (Merge in `dark`, Commit in `a`).
   *Mitigation:* Policy „Mensch ja, Agent nein“, Bestätigungsdialog, Audit-Event, kein
   „Immer erlauben“, `dark` ist nie Voreinstellung.
4. **Prompt-Injection über Fragen, Berichte oder Transcript.** *Mitigation:* alles als Daten
   (Markdown nur als Daten-AST), keine Interpretation als Befehl, Tool-Input roh anzeigen.
5. **Begriffsverwirrung „Mode“** (Adapter-Modus, harnez a/b, aSPARK-Modus). *Mitigation:* Feld heißt
   „Betriebsart“, Werte sind providereigen, harnez-Modus wird gelesen, nie angenommen
   (AGENTS.md und Hermes-Doku widersprechen sich dort).
6. **Hermes driftet zur Arbeit** (bekannter Live-Fehler in harnez v1). *Mitigation:* v1 beobachtet
   nur und startet Hermes nicht. Ein späterer Start nutzt den dokumentierten „niemals selbst
   arbeiten“-Prompt, Ergebnis wird in einem ADR-Nachtrag festgehalten.
7. **Scope-Creep zu „Ralph im Hub“.** *Mitigation:* `agents: "hub"` bleibt reserviert, nicht gebaut.
8. **Neue Abhängigkeit `mqtt`** bringt Wartungslast. *Mitigation:* nur im Paket des Loops, hinter
   einer dünnen Schnittstelle, die im Test injiziert wird.

## 7. Definition of Done

- Alle AC grün mit Beleg. `npm run gate` grün (typecheck, lint, check:commits, check:arch,
  check:adapter-matrix, Tests, E2E), jede neue UI-Funktion mit Spec in `e2e/specs/`.
- Beide Loops sind in `hub.config.json` registrierbar und in der PWA **erreichbar** (nicht nur
  technisch fertig), die Matrix in `README.md` führt sie.
- `docs/loops.md` beschreibt Einrichtung (MQTT-Nutzer, Pfade, Hermes-Wahl) ohne Secrets.
- Messläufe unter `docs/messlauf/` mit Prüfstand, Datum, Commit, Streuung.
- Die fremden Repos sind unverändert (Prüfung: `git status` dort sauber gegenüber dem
  Ausgangsstand).
- `retro` am Ende, Abschnitt in dieser Datei.

## Retro

Stand 2026-10-28 · Commits `^ F core/loops/pwa … (EPIC-P19 T19.1–T19.8)`, MR !236, !238, !239, !240 und der Nachtrag-MR · Messlauf: [2026-10-28-p19-loops.md](../docs/messlauf/2026-10-28-p19-loops.md)

AK-Matrix: 3 🟢 / 5 🟡 / 0 🔴 / 0 ⚪

```text
AC-P19-1: 🟡 teilweise
  Beleg: aspark.test.ts „Rückfrage (permission) …“, „Rückfrage (question) …“, „… dieselbe Frage nur einmal“; Messlauf K1 (42 ms / 58 ms)
  Bemerkung: Maschinenanteil und Einmaligkeit belegt; Push + Biometrie am Handy (p95 < 5 s gesamt) nicht gemessen; „bereits beantwortet“ als eigene Anzeige gibt es nicht.
AC-P19-2: 🟡 teilweise
  Beleg: securesight.test.ts „K2: 30 Transcript-Zeilen …“ (p95 41 ms, 60-s-Lauf); „Exit 3 …“ (10,3 s); notifications.test.ts „Loop-Benachrichtigungen“
  Bemerkung: Connector und Benachrichtigung erfüllt; der Weg bis in den Browser ist hier nicht neu gemessen (P18: p95 91 ms).
AC-P19-3: 🟢 erfüllt
  Beleg: loops.spec.ts „K7: Hub-Neustart mitten im Loop …“ (724 ms, nichts doppelt, nichts fehlt); aspark.test.ts „K7: nach dem Neustart …“
AC-P19-4: 🟡 teilweise
  Beleg: aspark.test.ts „Last Will (offline), v≠1 und kaputtes JSON …“ (0 ms); securesight.test.ts „unbekanntes Schema …“, „Exit 3/4/5“; Messlauf K9 (13 s bei Standardtakt)
  Bemerkung: Grund und Zeit belegt; „alle anderen Sessions ungestört“ hat keinen eigenen Test (die Störung ist ein Ereignis der eigenen Session).
AC-P19-5: 🟢 erfüllt
  Beleg: loops.spec.ts „ohne Loop startet die Session wie bisher“; gesamtes E2E-Gate grün (232 bestanden, 2 übersprungen)
AC-P19-6: 🟡 teilweise
  Beleg: `.dependency-cruiser.cjs` Regel `loops-only-contracts` (`npm run check:arch` grün); loops.test.ts „GET /api/loops …“; loops.spec.ts „Neues Repo anbinden“ (kein Token in Ereignissen); aspark.test.ts „… Token geht nur über stdin“
  Bemerkung: die Regel ist nicht durch einen absichtlich verbotenen Import als rot belegt; kein Log-Leak-Test.
AC-P19-7: 🟡 teilweise
  Beleg: securesight.test.ts „Orchestrator hermes liest den Zustand …“ (inkl. `user_gates`); loop-view.test.ts „Hermes: Freigaben …“
  Bemerkung: Stand-in und Panel belegt; die Wahl im Start-Formular hat keinen eigenen E2E-Test.
AC-P19-8: 🟢 erfüllt
  Beleg: loops.test.ts „ein Agenten-Token … nicht starten“ und „AC-P19-8: … Betriebsart … nicht wechseln und nicht fortsetzen“; Policy-Operationen `loops.start`, `loops.onboard` (nur Mensch)
```

Premortem: 2 eingetreten (1, 5) / 6 nicht eingetreten

- **Eingetreten (1):** securesight benannte sich während der Arbeit um (Iteration 0055: `.harnez/` → `.factory/`); der Connector liest beide Orte (`securesight.test.ts` „nach der Umbenennung …“), unbekannte Schemata werden `loop.broken`.
- **Eingetreten (5):** die echte Betriebsart von securesight ist `a`, die von aSPARK `autonomous`/`dark`: Werte bleiben providereigen (`Messlauf: Echte Systeme`).
- Nicht eingetreten: 2 (nicht live geprüft), 3 (Policy + Bestätigung, AC-P19-8), 4, 6, 7, 8.

Erkenntnisse:

1. Echte Systeme zeigten, was Stand-ins nicht zeigten: retained Zustände aller alten aSPARK-Sessions fluteten den Verlauf, und mehrere Sessions je Linie machten „den“ Fortschritt mehrdeutig — Beleg: Lauf gegen den lokalen Broker, `aspark.test.ts` „… Abgeschlossene Sessions … bleiben still“, `loop-view.test.ts` „bei mehreren Sessions …“.
2. Eine Störung braucht eine Quelle, sonst „heilt“ jede fremde Nachricht sie — Beleg: `aspark.test.ts` „Last Will …“ (Störungen je Topic, `loop.recovered` je Quelle).
3. K7 verlangt, dass nicht nur Leseposition, sondern auch „schon Gemeldetes“ im Cursor liegt — Beleg: `securesight.test.ts` „K7 …“, E2E „K7: Hub-Neustart …“.
4. Der Hub kann `factoryctl` ohne Terminal bedienen (Token über stdin, eigene Sitzung) — Beleg: Probelauf gegen die echte `factoryctl` mit ungültigem Token (HTTP 401, nichts angelegt), `aspark.test.ts` „Repo anbinden über factoryctl“.

Action Items:

- AI-P19-1: Handy-Abnahme K1 gesamt (Push, Biometrie, Antwort am Broker) und „bereits beantwortet“-Anzeige — zurück als: nächste Epic-Aufgabe (manuelle Abnahme).
- AI-P19-2: Negativtest für `loops-only-contracts` (verbotener Import → rot) und ein Log-Leak-Test — zurück als: nächste Epic-Aufgabe.
- AI-P19-3: E2E für die Orchestrator-Wahl im Start-Formular (securesight, hermes + Epic) — zurück als: nächste Epic-Aufgabe.
- AI-P19-4: eigener MQTT-Nutzer mit enger ACL statt `leitstand`, sobald der Broker nicht mehr nur lokal erreichbar ist — zurück als: ADR (Nachtrag 2026-10-28, Frage 2).

Artefakt: epics/EPIC-P19-loop-dark-factory.md ## Retro
