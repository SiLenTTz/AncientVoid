# EPIC-P53 — Projektdokumentation und One-Command-Setup (README, Screenshots, Setup-Wizard)

**Status:** abgeschlossen 11.11.2026 (Retro unten) · **Phase:** P53 · **Dauer:** 1,5–2,5 Agenten-Wochen (grobe Schätzung)
**Abhängigkeit:** keine fachliche offene — Quer-Epic (Präzedenz P50–P52), betrifft nur Doku,
Setup-Skript und Agenten-Skills, keine Laufzeit-Architektur. Nutzerauftrag vom 11.11.2026.

Quelle: Nutzerauftrag vom 11.11.2026: README und Screenshots auf echten Stand bringen,
One-Command-Setup je Repo, beides als Epic in beiden Repos dokumentiert, damit AncientVoid
und VoidWarden perfekt zusammenspielen. Nutzervorgabe zum Wizard: **„Der erste Schritt der
Installation ist, den ersten Provider anzubinden"** — so kann ein dedizierter Wizard-Agent
bei Problemen helfen und die Installation für jeden Nutzer zu 100 % erfolgreich machen.
Schwester-Epic: VoidWarden P14 (`EPIC-P14-projektdoku-setup-wizard`
im separaten, nicht öffentlichen VoidWarden-Repo). Beide Repos bleiben eigenständig; das gemeinsame
Installations-/Zusammenspiel-Konzept wird in beiden READMEs und beiden Epics symmetrisch
referenziert (Kaskade: zuerst AncientVoid-Hub, dann VoidWarden-Companion/Kiosk).

## 1. Ziel

Ein frischer Nutzer (oder Agent) versteht aus der README in zwei Minuten, was AncientVoid
ist, was davon heute wirklich funktioniert (Ist-Stand mit Belegen, nicht Werbetext), was
geplant ist (Roadmap) — und sieht die Oberfläche in echten Screenshots. Und er kommt mit
**einem Befehl** (`./setup.sh` bzw. `npm run setup`) vom frischen Klon zum laufenden Hub
**mit angebundenem ersten Provider**; ein dedizierter Wizard-Agent (Skill `setup-wizard`)
führt bei Problemen durch die Diagnose. Messlatten-Bezug: keiner der K1–K10-Werte misst
Onboarding — referenziert sind stattdessen PRD §8 (Sicherheit: keine Secrets in Config,
Tokens nur als Hash/Datei) und die Ehrlichkeitsklausel der Adapter-Matrix (Status nur mit
Beleg — gilt sinngemäß für jede README-Aussage).

## 2. Scope (In / Out)

**In:**

- **README-Überarbeitung:** Zweck (Was ist AncientVoid), Ist-Stand nach Epics/PRD mit
  Verweis auf [`docs/funktionsinventar.md`](../docs/funktionsinventar.md) und
  [`docs/onboarding.md`](../docs/onboarding.md) §0 (Fertig-Tabelle), Roadmap
  (aktueller Stand der Planungskette P30–P52 mit klarer Markierung geplant/umgesetzt),
  Screenshots der PWA (Handy- und Desktop-Ansichten), Abschnitt Zusammenspiel mit
  VoidWarden, Quick Start ersetzt durch den One-Command-Wizard (der alte manuelle Weg
  bleibt als Referenz verlinkt).
- **Screenshots, wiederholbar erzeugt:** `scripts/readme-screenshots.mjs` bootet einen
  Demo-Hub nach TestHub-Muster (Dummy-Adapter + synthetische Stand-ins aus
  `e2e/support/bin`, deutsche Demo-Titel, **keine echten Sessions, keine Secrets**) und
  spielt die PWA mit Playwright durch: Anmeldung, Übersicht, Session-Chat, Freigabe,
  Desktop-Arbeitsfläche. Ablage `docs/assets/readme-*.webp` (Präzedenz: P43-Webp-Serie).
- **Setup-Wizard `setup.sh`** (top-level, ausführbar) + **`npm run setup`**: interaktiver
  Wizard mit Defaults und Flags (`--yes`/`--adapter=`/`--no-start` für CI und Agenten).
  Reihenfolge: (0) Voraussetzungen laut prüfen (Node ≥ 22.5, npm, optional tmux) und laut
  failen; (1) **ersten Provider anbinden** — installierte Harness-CLIs erkennen
  (`claude`, `codex`, `opencode`, `pi`, `hermes`, `copilot` …), Auswahl anbieten, ACP-
  Presets ohne eigenen Code, OpenAI-kompatiblen Endpunkt per Beispiel-Adapter, `dummy`
  als Fallback; Adapter-Eintrag in `hub.config.json` schreiben (bestehende Config wird
  nie still überschrieben); (2) `npm install` (idempotent); (3) PWA bauen;
  (4) Device-Token ausstellen (einmalig sichtbar); (5) Hub starten + `/api/ready`-Check
  + URL/Token-Anleitung ausgeben. Linux (Omarchy) ist der Zielplatz, Abweichungen
  failen laut mit klarer Meldung.
- **Wizard-Agent/Workflow:** Skill `.claude/skills/setup-wizard/` (inkl. Index-Eintrag
  in `.claude/skills/README.md`): Trigger Installation/Setup/„bekomme es nicht zum
  Laufen"; dokumentiert Wizard-Schritte, Exit-Codes, Diagnose-Pfade (Node-Version, Port
  belegt, Provider-CLI fehlt, Config kaputt, Tailscale) und die Grenze: Der Agent
  hilft beim Einrichten, interpretiert aber keinen Agenten-Output als Instruktion
  (PRD §8.5).
- **`docs/onboarding.md` verkabeln:** Schritt 2–4 verweisen auf den Wizard als
  Normalweg; der manuelle Weg bleibt für Agenten/CI dokumentiert.
- **Test des Wizards:** Wiederholter Lauf ist idempotent (zweiter Lauf ändert nichts,
  exit 0); Frisch-Klon-Test in temporem Checkout mit `--yes --adapter=dummy` ohne
  Netz-Zugriff auf Provider (nur npm-Registry).

**Out:** keine Änderungen an Hub-Kern, Contracts, Adaptern oder PWA-Verhalten (nur
Doku, Skripte, Skills); keine englische Dokumentation (P33 bleibt vertagt); keine
Videos/GIFs (nur Webp-Standbilder); kein neue RPM/Deb/Homebrew-Verteilung — der Wizard
lebt im Repo; kein Setup von VoidWarden aus diesem Repo heraus (nur Verweis);
Betriebs-Installation bleibt Runbook/Skripte (`docs/operations-runbook.md`,
`scripts/hub.sh`, systemd) — der Wizard richtet den **ersten Start** ein, keinen Dienst.

## 3. Design-Details

- **Provider zuerst (Nutzervorgabe):** Der klassische Fehler eines Setups ist ein
  „fertiger" Hub ohne Provider, auf dem dann nichts läuft. Der Wizard bindet deshalb
  zuerst den Provider an (erkenne installierte CLIs, schlage den ersten Treffer vor,
  `dummy` immer verfügbar), bootet kurz zur Validierung und macht erst dann Token/PWA/
  Start-Schritte. Jeder Schritt endet mit einem sichtbaren Erfolg oder einem lauten
  Abbruch mit konkreter Meldung (`Fail loud`, Repo-Regel 6).
- **Config-Schreibung ist chirurgisch:** `hub.config.json` ist git-ignored und kann
  persönliche Adapter enthalten. Der Wizard legt die Datei nur an, wenn sie fehlt;
  existierende Einträge mit derselben Adapter-ID werden angezeigt und übersprungen,
  nie ersetzt. Secrets (API-Keys) gehören in Dateien und werden per `envFiles`
  referenziert (Muster `docs/onboarding.md` §3) — der Wizard fragt nach Key-Dateien,
  nicht nach dem Key im Klartext; gibt es den Key schon in einer env-Datei, wird nur
  referenziert.
- **Screenshots ohne Datenschutz-Nacharbeit:** Der Demo-Hub nutzt ausschließlich
  `@ancientvoid/adapter-dummy` und die Stand-ins aus `e2e/support/bin` in einem
  temporären Datenverzeichnis — dieselbe Isolation wie das E2E-Gate
  ([`docs/testing-e2e.md`](../docs/testing-e2e.md)): nichts erreicht Cloud-Provider,
  `~/.claude`, tmux-Sessions oder den echten Hub des Nutzers. Deutsche, augenfällige
  Demo-Titel („Demo: Freigabe warten") machen Screenshots selbsterklärend.
  `npm run check:secrets` läuft über den Diff.
- **Wizard-Skill statt eingebautem Support:** Ein Agent-Skill ist die Repo-konforme
  Form des Hilfs-Workflows (wie `bugfix`/`gates`); er hält Diagnose-Pfade und
  Lösungen aktuell, weil er im selben Commit-Pfad gepflegt wird wie `setup.sh`.
  Der Skill nennt explizit, was der Wizard **nicht** tut (keine Dienste, kein
  Force-Push auf Configs, keine Interpretation von Agenten-Output).
- **Zusammenspiel mit VoidWarden (gemeinsames Konzept, hier die AncientVoid-Seite):**
  Kaskade — (1) AncientVoid `./setup.sh` richtet Hub + ersten Provider + Device-Token
  ein; (2) für VoidWarden wird zusätzlich ein `agent:voidwarden`-Token (read-only) und
  optional ein `display:<name>`-Token (Freigaben) ausgestellt — der Wizard bietet das
  als optionalen Schritt an (`hubctl token issue voidwarden --agent`); (3) im
  VoidWarden-Repo übernimmt dessen `./setup.sh` den Rest (Companion + Web-Kiosk).
  Beide READMEs zeigen dasselbe Diagramm (Hub → Companion → Kiosk/Board). Keine
  Laufzeitabhängigkeit zwischen den Repos außer der HTTP-API und
  `@ancientvoid/contracts`.
- **Roadmap-Abschnitt ehrlich:** Trennung nach dem Muster der Epic-Index-Tabelle:
  umgesetzt (mit MR/Epic-Verweis), in Umsetzung, geplant (Planungsentwurf,
  Umsetzung gesperrt). Keine Statuszeile ohne Datum.

## 4. Aufgaben (Checkliste)

- [x] **T53.1 — Epic und Index.** Diese Datei + Zeile in `epics/README.md`
  (eigener Branch/MR vor der Umsetzung, damit andere Agenten das Epic sehen).
  *AC:* Epic existiert auf `main`, Index verlinkt. *Test:* Review.
  **Belegt:** [MR !379](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/379), gemerged 11.11.2026.
- [x] **T53.2 — Screenshots-Skript + Assets.** `scripts/readme-screenshots.mjs`
  (Demo-Hub, Playwright, Webp nach `docs/assets/readme-*.webp`); Ansichten:
  Anmeldung, Übersicht (Handy), Session (Handy), Freigabe, Desktop-Arbeitsfläche.
  *AC:* `node scripts/readme-screenshots.mjs` läuft grün durch und erzeugt die
  Dateien reproduzierbar (zweiter Lauf identische Menge). *Test:* Skript-Lauf +
  `npm run check:secrets`. Messlatten: keine (Doku).
  **Belegt:** Skript-Lauf grün (5 Webp: login/start/session/freigabe-412,
  desktop-1280), Login-Shot mit leerem Token-Feld; `check:secrets` grün.
- [x] **T53.3 — Setup-Wizard.** `setup.sh` + `npm run setup` nach §2/§3; Flags
  `--yes`, `--adapter=<id>`, `--no-start`, `--no-pwa`; Exit-Codes dokumentiert
  (Skript-Kopf). *AC:* Frisch-Klon-Test `--yes --adapter=dummy` grün; zweiter Lauf
  idempotent; fehlende Voraussetzungen (Node < 22.5 simuliert) failen laut mit
  klarer Meldung. *Test:* manueller Frisch-Klon-Lauf + Negativprobe in der CI-artigen
  Umgebung. Messlatten: PRD §8 (kein Secret in Config/Log).
  **Belegt:** Frisch-Klon-Lauf 11.11.2026 mit `--port=7390` (produktiver Hub auf
  7373 unberührt): Hub ready, PWA 200, nur dummy-Adapter aktiv; 2./3. Lauf ohne
  Config-Änderung (SHA unverändert) und ohne Zweittoken; Negativprobe Node 18 →
  exit 2 mit Meldung. Zusätzlich gebaut: `--port`-Flag, `HUB_LOCAL=1` in
  `scripts/hub.sh` (lokaler Daemon trotz systemd-Unit), Override-Hinweis bei
  ererbtem `ANCIENTVOID_CONFIG` (Agent-in-Hub-Session-Fall).
- [x] **T53.4 — Wizard-Agent/Skill.** `.claude/skills/setup-wizard/SKILL.md` +
  Index-Eintrag; Trigger, Diagnose-Pfade, Grenzen (PRD §8.5), Verweis auf
  `docs/onboarding.md` und `docs/operations-runbook.md`. *AC:* Skill lädt, Index
  verlinkt, deckt alle Wizard-Exit-Codes ab. *Test:* Review gegen setup.sh.
- [x] **T53.5 — README-Überarbeitung.** Zweck, Screenshots (T53.2), Ist-Stand,
  Roadmap, VoidWarden-Abschnitt, One-Command-Quick-Start. *AC:* Jede Ist-Aussage hat
  einen Belegverweis (Epic/Funktionsinventar/Runbook); Screenshots eingebunden;
  Setup-Abschnitt nennt `./setup.sh` und den manuellen Weg. *Test:* Review +
  Link-Check. Messlatten: keine (Doku).
- [x] **T53.6 — Onboarding-Verkabelung.** `docs/onboarding.md` §2–4 verweisen auf
  den Wizard als Normalweg (menschlich), manuell bleibt für CI/Agenten. *AC:* Verweis
  vorhanden, Widerspruchsfreiheit zu README. *Test:* Review.
- [x] **T53.7 — VoidWarden-Gegenstück.** Prüfen, dass VoidWarden P14 (Schwester-Epic)
  dieselbe Kaskade gegenseitig beschreibt; Token-Schritt des Wizards mit
  VoidWarden-Setup-Test gegengelesen (agent:-Token lesbar, display:-Token decide
  analog `scripts/test-hub.mjs` dort). *AC:* Beide Epics/READMEs nennen dieselbe
  Kaskade ohne Widerspruch. *Test:* Cross-Review.
  **Belegt (11.11.2026):** VoidWarden P14 umgesetzt ([MR !55](https://gitlab.com/SiLenT_Tz/voidwarden/-/merge_requests/55));
  Cross-Review: Kaskade identisch (AV `./setup.sh [--voidwarden]` → VW `./setup.sh`),
  Token-Befehle identisch (`token issue voidwarden --agent`, `token issue web-1
  --display`), Diagramm-Aussagen symmetrisch (agent: lesen, display: Freigaben,
  keine Abhängigkeit außer HTTP-API + contracts); VW-Kaskadenlauf mit echtem
  agent:-Token gegen Demo-Hub grün (Kiosk 200). Kein Widerspruch gefunden.

## Retro (11.11.2026, Abschluss)

Alle sieben Aufgaben erledigt; ACs mit Beleg:

- **AC-P53-1 ✓** README mit datiertem Ist-Stand (Belegverweise auf
  Funktionsinventar/`epics/README.md`), Roadmap, Screenshots; Links geprüft.
- **AC-P53-2 ✓** Frisch-Klon-Protokoll (Setup-Log im MR !380): Hub ready, PWA 200,
  Device-Token einmalig sichtbar, dummy-Provider aktiv.
- **AC-P53-3 ✓** Idempotenz per Config-SHA über drei Läufe belegt; Negativprobe
  Node 18 → exit 2.
- **AC-P53-4 ✓** Screenshots nur aus Demo-Betrieb; Login-Shot mit leerem Feld;
  `check:secrets` 0 Treffer.
- **AC-P53-5 ✓** Skill `setup-wizard` im Index, deckt Exit-Codes 2–5.
- **AC-P53-6 ✓** Cross-Review T53.7 (siehe oben), VoidWarden P14 abgeschlossen.

**Erkenntnisse:** (1) Der Demo-Hub aus der E2E-Infrastruktur ist der richtige
Weg für Screenshots — reproduzierbar und secret-frei; das Skript ist der
Beleg, kein Handwerk. (2) Agenten, die selbst in einer Hub-Session laufen,
ererben `ANCIENTVOID_CONFIG` — der Wizard überschreibt das für seinen Start
laut und sichtbar (Premortem-Modus 3 war real). (3) Nebenbefund des
Zusammenspiels: VoidWarden BUG-0009 (Approval-Format) — ohne die gemeinsame
Screenshot-Kaskade wäre der blind geblieben; der Stack-Test ist genau das
gewollte Zusammenspiel-Artefakt. **Action Items:** Frisch-Klon-Test bei der
nächsten Setup-Änderung wiederholen (liegt an T14.6-Rest in VoidWarden
mit dran); Screenshots bei P43-Fertigstellung neu erzeugen (Skript läuft
weiterhin).

## 5. Acceptance Criteria

- **AC-P53-1** README zeigt Zweck, Ist-Stand (datiert, mit Belegverweisen), Roadmap
  und Screenshots; jede verlinkte Quelle existiert. Messlatten: keine (Doku);
  Ehrlichkeitsklausel der Adapter-Matrix sinngemäß.
- **AC-P53-2** `./setup.sh` (bzw. `npm run setup`) führt auf einem frischen Linux-Klon
  (Omarchy) in einem Durchlauf zu: laufender Hub (`/api/ready` 200), gebauter PWA,
  ausgestelltem Device-Token (einmalig sichtbar) und mindestens einem angebundenen
  Provider. Messlatten: PRD §8.
- **AC-P53-3** Der Wizard ist idempotent: zweiter Lauf verändert eine bestehende
  `hub.config.json` nicht und endet mit exit 0. Fail loud: jede fehlende
  Voraussetzung endet mit eindeutiger Fehlermeldung und Exit-Code ≠ 0.
- **AC-P53-4** Screenshots entstehen ausschließlich aus synthetischem Demo-Betrieb
  (Dummy/Stand-ins, tempore Daten); `npm run check:secrets` ist über dem Diff grün;
  keine echten Session-Inhalte in `docs/assets/`. Messlatten: PRD §8.5-Daten-Grenze.
- **AC-P53-5** Der Wizard-Skill existiert, ist im Skill-Index verlinkt und deckt die
  Wizard-Exit-Codes/Diagnose-Pfade ab.
- **AC-P53-6** Das Zusammenspiel mit VoidWarden ist in README und diesem Epic
  beschrieben und mit VoidWarden P14 gegengelesen (dieselbe Kaskade, keine
  Widersprüche).

## 6. Premortem (Failure-Modi + Mitigation)

1. **Screenshots enthalten versehentlich reale Session-Daten oder Tokens** (Bildschirm
   des Entwicklungsrechners, echter Hub auf 7373, gespeichertes Browser-Profil).
   *Mitigation:* Screenshots entstehen nur aus dem Demo-Hub-Skript mit temporärem
   Datenverzeichnis und frischem Browser-Kontext (kein localStorage-Erbstand);
   `check:secrets` über den Diff; Review-Vorschrift: Token-Eingabefeld zeigt nie einen
   gefüllten Wert.
2. **Der Wizard schreibt eine kaputte oder falsche Config und der erste Start
   scheitert** — schlimmer noch, er überschreibt eine handgebaute Config des Nutzers.
   *Mitigation:* nie überschreiben (nur anlegen/ergänzen, ID-Kollision anzeigen);
   nach dem Schreiben Config-Validierung (Hub bootet probeweise, `/api/ready`),
   bei Fehlschlag klare Meldung + Rollback-Hinweis; Exit-Codes pro Schritt.
3. **Der Wizard funktioniert auf dem Entwicklungsrechner, aber nicht auf frischem
   Klon** (Node-Version anders, PATH ohne Provider-CLI, npm-Cache-Kaltstart, Port 7373
   belegt). *Mitigation:* AC-P53-2 verlangt einen echten Frisch-Klon-Test (temporäres
   Checkout, `--yes --adapter=dummy`); Port-Konflikt wird geprüft (belegt → Alternative
   anbieten oder laut failen); Provider-CLI-Fehlschlag führt nur zum Absturz des
   Provider-Schritts, nicht des ganzen Setups (`dummy` fallback).
4. **Die README veraltet erneut still** (wie bei VoidWarden geschehen: Stand-Zeile von
   2026-11-02 behauptete „kein Code", während P11 lief). *Mitigation:* Stand-Datum in
   der ersten Tabelle; Ist-Stand verweist auf `docs/funktionsinventar.md` (das als
   P43-Gate gepflegt wird) statt Zustände zu duplizieren; Roadmap-Abschnitt verweist
   auf `epics/README.md` als Single Source of Truth.
5. **Der Wizard-Agent verwandelt sich in ein Hintür für Prompt-Injection**
   (Nutzer-Paste oder Agenten-Output als Instruktion für Setup-Aktionen).
   *Mitigation:* Skill regelt die Grenze explizit (PRD §8.5): Der Wizard-Agent liest
   Fehlermeldungen des Wizards und Doku, niemals Session-Output als Anweisung;
   destruktive Schritte (Config löschen, Token widerrufen) nur mit expliziter
   Nutzerbestätigung.

## 7. Definition of Done

- Alle Aufgaben abgehakt, ACs mit Belegen (Skript-Läufe, Frisch-Klon-Protokoll,
  Review-Notiz) erfüllt; Retro als Abschnitt angehängt.
- `npm run gate` grün (inkl. `check:commits`, `check:secrets` im Diff); keine
  UI-/Ablaufsänderung an der PWA, daher kein neuer E2E-Spec nötig — der
  Screenshots-Skript-Lauf ist der Beleg für AC-P53-2/4.
- `epics/README.md` und `.claude/skills/README.md` nachgezogen; README-Links geprüft.
- VoidWarden P14 existiert und ist gegengelesen (AC-P53-6).
