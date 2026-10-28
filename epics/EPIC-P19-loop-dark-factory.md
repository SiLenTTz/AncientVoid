# EPIC-P19 — Loop / Dark Factory: securesight-factory und aSPARK-Factory als wählbare Loops

**Status:** Gerüst gebaut (2026-10-28, Auftrag von Jan): Katalog, `GET /api/loops`, Policy `loops.start`, Auswahl im Start-Formular.
**Offen:** die Connectors T19.4/T19.5 (brauchen die Fremdsysteme) und alles danach; bis dahin sind beide Loops sichtbar, gesperrt und begründet ·
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
- **Contract** `@uacc/contracts/loops` (`LoopConnector`, `LoopCapabilities`, `LoopSpec`,
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
  „`packages/loops/*` importiert nur `@uacc/contracts`“.
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

- [~] **T19.1 — Loop-Contract und Testkit.** *Teilweise (2026-10-28):* `contracts/loops` (`LoopSpec`, `LoopInfo`) und `loop` im
  Start-Body. Offen: `LoopConnector`, `SessionSpec.loop`, `runLoopContractTests()`. K5, K7.
- [~] **T19.2 — Core-Modul `loops`.** *Teilweise:* `LoopRegistry` (Katalog, `markConnected`, Prüfung der Startauswahl). Offen: `loopAsAdapter`, Spalte `loop_id`, Recovery. Registry, `loopAsAdapter`, Spalte `loop_id`,
  Event `session.loop`/`loop.cursor`, Recovery. K7.
- [x] **T19.3 — Hub-Route und Policy.** *Erledigt 2026-10-28* (Audit-Event bei Betriebsartwechsel gehört zu T19.4/T19.5). `GET /api/loops`, Start mit `loop`, Policy-Operationen,
  Audit-Event bei Betriebsartwechsel. `check:arch`-Regel.
- [ ] **T19.4 — Loop `aspark-factory`.** MQTT-Leitstand-Client, Fragen und Antworten, Befehle,
  `loop.broken`. Dokumentierte Anleitung für den Hub-MQTT-Nutzer (nicht ausgeführt). K1, K5, K7, K9.
- [ ] **T19.5 — Loop `securesight-factory`.** Supervisor-Status, Notify, Transcript, Progress,
  Orchestrator `self | hermes` (Hermes lesend), Fortsetzen als Tipp. K2, K7, K9.
- [~] **T19.6 — PWA.** *Teilweise:* Zeile „Loop“ im Start-Formular, Optionen aus den Fähigkeiten, gesperrt mit Grund (Spec `loops.spec.ts`). Offen: Kopf-Abzeichen, Loop-Panel, Bestätigungsdialog. Auswahl-Flow, Fähigkeiten-getriebene Optionen, Kopf-Abzeichen,
  Loop-Panel, Bestätigungsdialog. E2E-Specs. K10, AC-P8-5 (Mobil unverändert).
- [ ] **T19.7 — Messläufe und Doku.** K1/K2/K7/K9 nach Skill `messlauf`, `docs/loops.md`,
  Matrix-Eintrag.

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
- **AC-P19-6 (Kapselung):** `check:arch` schlägt bei einem Import aus `@uacc/core`/`@uacc/server`
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
