# EPIC-P51 — Vault-Erreichbarkeit & Tastatur-first

**Status:** teilweise umgesetzt (T51.1–T51.2: Vault-Unterbau; T51.3–T51.10 offen) · **Phase:** P51 · **Dauer:** 2–3 Agenten-Wochen (grobe Schätzung)
**Abhängigkeit:** keine fachliche offene — Nutzerauftrag vom 11.11.2026, quer zur
Kette (Präzedenz P47–P50). Baut auf P49 (Vault), P18/P34 (Kachel-Kürzel,
Arbeitsfläche) auf; hebt keine offenen Abnahmen auf.

Quelle: Nutzermeldungen vom 11.11.2026 mit Code-Recherche:

1. **Vault-Ordner unsichtbar/nicht erreichbar.** Ordner-Symlinks erscheinen
   weder im Picker noch in der Dateiliste: `readdir(..., { withFileTypes: true })`
   liefert für Symlinks auf Verzeichnisse `isDirectory() === false`
   (`packages/core/src/modules/vault/store.ts:68` Browse, `:91` Liste). Pfade
   außerhalb von `projectRoots` + Hub-`HOME` werden mit 422 abgelehnt
   (`store.ts:41/:66`) — der Picker nennt keinen Grund. Eine manuelle
   Pfad-Eingabe existiert nicht (ADR-0063: „keine frei eingebaren Pfade",
   Premortem 1).
2. **Benachrichtigungsglocke am PC nicht im Eck.** Mit geöffneter Liste hängt
   sie oben rechts *in der Listenspalte* (`apps/pwa/src/app/styles/14-notifications.css:175-179`),
   nicht im Fenstereck; der Eck-Modus (`.notif-bell.corner`) ist nur bei
   eingeklappter Liste aktiv.
3. **Keine durchgängige Tastaturbedienung.** Kürzel sind über 7 Dateien
   verstreut (ui-scale, CommandBar, TileWorkspace, FilesLayer, ToolPane,
   Composer, Approvals), es gibt keine Registry, kein `?`-Cheat-Sheet (offen in
   T43.6), kein Esc/Fokus-Rückgabe in CommandBar/VoiceSheet/SkillPicker/
   Benachrichtigungs-Panel, keine globalen View-Wechsel-Kürzel und keine
   Pfeil-Navigation in den Hauptlisten. Das Setting „Tastenkürzel an/aus" ist
   bereits als Prio-B-Empfehlung dokumentiert (`docs/einstellungen-empfehlungen.md:49`).
4. **Omarchy/Super-Key.** Hyprland konsumiert gebundene SUPER-Kombos, bevor
   die App sie sieht; eine Web-App kann Compositor-Grabs nicht abfangen.
   Ungebundene Super-Kombos erreichen die PWA (`metaKey`); der
   `pass`-Dispatcher kann gezielt Kombos an ein Fenster durchreichen
   (Hyprland-Wiki, Binds/Dispatchers). Seit P18 offen: Alt+1–4 kollidiert
   potenziell mit Firefox-Tab-Wechsel.

**Nutzerentscheide (Abstimmung 11.11.2026):**

- **Vault:** Jeder Ordner ist wählbar — Guards bleiben (Policy
  `settings.manage`, Agenten-403, realpath, `.git`/`dataDir` gesperrt);
  Startpunkt-Zwang für die Root-Wahl entfällt; ADR-0063 wird ergänzt.
- **Ein Epic** (P51) für alle drei Themen; ?-Cheat-Sheet aus T43.6 hierher
  gezogen (braucht die Registry ohnehin).
- **Super-Key:** Alt/Basis-Tasten-Schema (kein Super als AV-Standard) +
  dokumentierter optionaler Hyprland-`pass`-Snippet statt unmöglichem
  Grab-Override aus der PWA.
- **Hinweis-Overlay:** nur bei Aktionen, für die ein Shortcut existiert
  (~2 s, unten); Klicks ohne Shortcut bleiben still.

## 1. Ziel

1. **Jeden vorhandenen Ordner als Vault nutzen können** — per Browser-Klick
   oder eingegebenem Pfad, Symlink-Ordner inklusive; Ablehnungen (`.git`,
   `dataDir`, fehlende Rechte) mit Klartext-Grund statt stiller 422.
2. **Glocke am PC immer oben rechts im Fenstereck** (wie auf dem Handy
   spaltenbündig unverändert).
3. **AncientVoid komplett ohne Maus bedienen können** — zentrale
   Shortcut-Registry, fehlende Kürzel (Esc/Fokus, View-Wechsel,
   Listen-Navigation), `?`-Cheat-Sheet, lernendes Hinweis-Overlay unten mit
   Settings-Schalter, und eine dokumentierte, kollisionsfreie Koexistenz mit
   Omarchy/Hyprland und Firefox.

## 2. Scope (In / Out)

**In:**

- Core `VaultStore`: Ordner-Symlinks in `browse()` und `list()` sichtbar
  (stat-basiert, Cycle-Schutz), `setRoot` ohne Startpunkt-Zwang (Guards
  bleiben), Picker zeigt `VaultError`-Meldungen.
- PWA `VaultPicker`: freie Pfad-Eingabe mit Validierung und Klartext-Fehlern;
  Browse-Startpunkte um den aktuellen Vault-Root ergänzen.
- ADR-0063-Ergänzung (Root-Wahl-Regel neu: Pfad-Eingabe erlaubt, Guards
  unverändert, Begründung).
- Glocke/Panel: am PC (≥1280 px) immer Eck-Position (`.corner`-Muster,
  `--ui-zoom`-sicher), Handy unverändert.
- Shortcut-Registry `apps/pwa/src/shared/shortcuts/`: deklarativ (id, combo,
  scope, Beschreibung, Handler), ein zentraler keydown-Listener,
  Konflikt-Unit-Test, `aria-keyshortcuts`; Migration aller 7 Streustellen
  Verhalten 1:1.
- Neue Kürzel: Esc + Focus-Trap + Fokus-Rückgabe in allen Overlays/Panelen;
  globale View-Wechsel-Kürzel; Pfeil-/Roving-Navigation in Dock, Session-Liste
  und Vault-Liste; `?`-Cheat-Sheet (kontextabhängig, Registry-getrieben).
- Setting „Shortcut-Hinweise anzeigen/an" (`localStorage`, device-lokal,
  Standard: an) + Bottom-Hinweis-Overlay: Klick auf ein Element mit
  registriertem Shortcut zeigt die Kombination unten mittig (~2 s,
  `.copy-flash`-Muster); ohne Shortcut still.
- Omarchy-Koexistenz: Kollisions-Audit AV-Kürzel × Omarchy-Defaults ×
  Firefox-Defaults (inkl. Alt+1–4-Punkt aus P18) als Tabelle in `docs/`;
  optionaler Hyprland-`pass`-Snippet dokumentiert; Cheat-Sheet zeigt die
  freie/kollidierende Belegung.

**Out:** Desktop-Companion/native Global-Hotkeys (P11), Shortcut-Remapping
durch den Nutzer (Registry bleibt codeseitig), Rest von P43 (Tablet-Zweispalter,
Zustandssprache, Schnellsuche — T43.6-„?"-Anteil geht an P51), Vault-Suche
(P49-Original bleibt minimal), automatisches Schreiben von Host-Konfiguration
(Snippet ist Doku, keine Fernkonfiguration), Screenreader-Vollabnahme (bleibt
T43.9).

## 3. Design-Details

### 3.1 Vault-Erreichbarkeit

- **Symlinks:** Nach `readdir(withFileTypes)` werden Einträge mit
  `stat()`/`realpath()` nachgeprüft statt nur `e.isDirectory()` —
  Ordner-Symlinks erscheinen in Browse und Liste. Schutz bleibt:
  `assertInside` (realpath beidseitig) blockt Ausbrüche aus dem Root
  weiterhin; `list()` bekommt ein Besucht-Set über Realpfade gegen
  Symlink-Zyklen, `VAULT_MAX_LIST`-Cap bleibt.
- **Root-Wahl ohne Startpunkt-Zwang:** `setRoot()` validiert weiter
  (existiert, Verzeichnis, realpath, nicht `.git`, nicht `dataDir`), aber
  nicht mehr `withinStartpoints`. Browse bleibt bei den Startpunkten als
  Einstieg (UX), ergänzt um den aktuellen Vault-Root als weiteren Startpunkt.
- **Pfad-Eingabe:** Textfeld im Picker → `PUT /api/vault/root`; Fehlerfälle
  zeigt der Picker als Klartext (`VaultError.message` existiert bereits):
  nicht vorhanden, kein Verzeichnis, `.git`, Hub-`dataDir`, keine Rechte.
- **ADR-0063-Ergänzung:** Abschnitt Root-Wahl — „keine frei eingebaren Pfade"
  wird ersetzt durch „Pfad-Eingabe erlaubt für Menschen
  (`settings.manage`); dieselben Guards wie Browse; Agenten bleiben zentral
  403". Begründung: lokaler Single-User-Hub, Originär-Auftrag; das
  Schutzziel (Angriffsfläche) bleibt über Policy + Guards erhalten.
- **Policy unverändert:** zentrale Wand `/api/vault*` → `settings.manage`,
  Agenten-403 (P49-T49.3), keine Vault-Pfade in Events/Telemetrie.

### 3.2 Glocke im Eck

Auf breiten Viewports (≥1280 px) läuft `NotificationCenter` immer mit
`corner`-Variante (fixed, `safe-area + 8px`, `right`-Formel mit
`100vw / var(--ui-zoom, 1)` wie heute — Zoom-Sicherheit ist E2E-gesichert);
die `.split-list`-Absolute-Positionierung entfällt, Panel folgt der Glocke.
Handy (<1280 px) bleibt spaltenbündig wie heute. Die
`.toast-stack`-Vorhalte („for bell AND gear", `14-notifications.css:49`) wird
mitbereinigt — ein Zahnrad existiert nicht.

### 3.3 Shortcut-Registry

- `apps/pwa/src/shared/shortcuts/registry.ts`: Einträge
  `{ id, combo, description, scope, when?, handler }`, Combos normalisiert
  („Ctrl+K", „Alt+1", „?"); ein zentraler window-keydown-Dispatcher in
  fester Reihenfolge: Overlay/Modal > Kontext > Global; Eingabefelder
  (INPUT/TEXTAREA/contentEditable) schlucken Buchstaben-Kürzel.
- Migration Verhalten 1:1: ui-scale (Ctrl+±/0), CommandBar (Ctrl+K, Esc),
  TileWorkspace (Alt+1–4, Alt+Shift+1–4, Alt+L, Alt+W), FilesLayer
  (Ctrl+Shift+E), ToolPane (Esc) — bestehende E2E
  (workspace-tiles/commands/oberflaeche/session/tool-pane/windows) bleiben
  unberührt grün. Composer-/Approvals-Inline-Handling (1–9, ↑/↓, Enter)
  bleibt lokal — sie sind Eingabe-Interaktion, keine globalen Kürzel; sie
  werden trotzdem im Registry-Katalog geführt (Doku/`?`), mit Ausführungsort.
- Unit-Test: keine doppelte Combo im selben Scope (Fail loud bei Konflikt).
- `aria-keyshortcuts` auf Elemente mit festem Kürzel; Tooltips
  (`title`) kommen aus der Registry statt handgeschriebener Hints
  (ersetzt u. a. die TileWorkspace-Hinweiszeile `TileWorkspace.tsx:132`
  gemäß Design-Review 2026-11-10).

### 3.4 Hinweis-Overlay + Setting

- Persistenz device-lokal: `localStorage["ancientvoid.shortcutHints"]`,
  Standard an (Lernphase); Schalter in den Einstellungen neben
  Erscheinungsbild (Muster `SettingRow` + `role="switch"`).
- Auslösung: interaktive Elemente tragen `data-shortcut="<registry-id>"`;
  ein Capture-Phase-Click-Listener prüft Registry + Setting → Pill unten
  mittig (`.copy-flash`-Muster: `pointer-events: none`, `role="status"`,
  ~2 s, maximal eine gleichzeitig, über dem Dock, nie über dem Composer).
- Nur Aktionen mit existierendem Shortcut zeigen einen Hinweis; Klicks ohne
  Shortcut bleiben still (Nutzerentscheid).

### 3.5 Omarchy-/Firefox-Koexistenz

- Audit-Tabelle `docs/tastatur-kollisionen.md`: jede AV-Combo ×
  Omarchy-Default-Bind (Hyprland) × Browser-Default (Firefox: Alt+1–9
  Tab-Wechsel, Ctrl+W, …) × Chromium-E2E-Relevanz. Ergebnis: AV-Default-Schema
  kollidiert nicht mit Omarchy-Defaults; Firefox-Risiken werden je Kürzel
  benannt (Alt+1–4: P18-offener Punkt — Ausweich-Kürzel dokumentieren,
  Entscheidung mit Jan falls Verhalten geändert werden muss).
- Optionaler Snippet (Doku, kein Auto-Write):
  `bind = SUPER, <key>, pass, class:^(<AV-Fensterklasse>)$` — reicht gebundene
  Super-Kombos gezielt ans AV-Fenster durch. Ehrliche Grenze dokumentiert:
  Compositor-Grabs sind aus der PWA nicht abfangbar; „Super für AV" heißt
  immer: Host-Konfiguration + ungebundene Kombos.
- `?`-Cheat-Sheet zeigt dieselbe Datenquelle (Registry), inkl. Hinweis, wo
  Kombos im Browser/WM belegt sind.

## 4. Aufgaben (Checkliste T51.m)

- [x] **T51.1** ADR-0063-Ergänzung (Root-Wahl ohne Startpunkt-Zwang, Pfad-Eingabe, Guards/Policy unverändert) vor Verhaltens-Merge; Contracts unverändert prüfen (Fehler laufen über `VaultError.message`). **K7**.
- [x] **T51.2** Core `VaultStore`: Symlink-Ordner in `browse()`/`list()` (stat/realpath, Besucht-Set, Cap bleibt), `setRoot` ohne Startpunkt-Zwang; Unit-Tests: Symlink-Ordner sichtbar, Symlink-Zyklus terminiert, Ausbruch weiterhin blockt, `.git`/`dataDir`-Ablehnung mit Grund. **K7**.
- [ ] **T51.3** Picker: Pfad-Eingabefeld + Klartext-Fehler, Startpunkte + aktueller Root; E2E rot-dann-grün: Vault außerhalb der Startpunkte per Pfad wählbar, Symlink-Ordner erscheint, Ablehnungsgrund sichtbar. **K1**.
- [ ] **T51.4** Glocke/Panel am PC ins Fenstereck (`.corner` immer bei wide), `.toast-stack`-Vorhalte bereinigen; notifications.spec um Eck-Assertion (Liste offen + eingeklappt, Zoom 130 %) erweitern. **K2**.
- [ ] **T51.5** Shortcut-Registry bauen + Migration der 7 Streustellen (Verhalten 1:1, bestehende E2E grün), Konflikt-Unit-Test, `aria-keyshortcuts`/Tooltips aus Registry. **K1/K2**.
- [ ] **T51.6** Tastatur-Lücken schließen: Esc + Focus-Trap + Fokus-Rückgabe (CommandBar, VoiceSheet, SkillPicker, Benachrichtigungs-Panel), View-Wechsel-Kürzel (Kandidaten `Alt+←`, `Alt+Pos1`; endgültig nach T51.9-Audit), Roving-Pfeil-Navigation in Dock/Session-Liste/Vault-Liste; je Kürzel ein E2E. **K1**.
- [ ] **T51.7** `?`-Cheat-Sheet (Registry-getrieben, kontextabhängig, nicht in Eingabefeldern); ersetzt die TileWorkspace-Hinweiszeile; in EPIC-P43 T43.6 als hierher gezogen vermerken. **K2**.
- [ ] **T51.8** Setting „Shortcut-Hinweise" + Bottom-Overlay (nur bei existierendem Shortcut, ~2 s, nicht blockierend); E2E: Hinweis erscheint/verschwindet, ohne Shortcut still, Setting aus → gar nichts, Composer bleibt frei. **K1/K10**.
- [ ] **T51.9** Omarchy-/Firefox-Kollisions-Audit (Tabelle in `docs/`, Alt+1–4-Punkt aus P18 klären), Hyprland-`pass`-Snippet-Doku, Cheat-Sheet-Anbindung. **Fail-loud**.
- [ ] **T51.10** Abnahme: `npm run gate` grün, manuelle Firefox-/Omarchy-Prüfung am Gerät (Alt-Kürzel live), Live-Abnahme Vault-Pfad mit echtem Ordner außerhalb der Startpunkte, Retro. **K1/K2/K10**.
- [ ] **T51.11** *(aus P43 AI-P43-1)* Schnellsuche um Inventar-Sprungziele erweitern oder bewusst begrenzen und im Inventar dokumentieren — AC-P43-1 Closeout deckt nur Sessions/Projekte/Dateien/Werkzeuge/Befehle. **K2**.

### Teilumfang T51.1–T51.2 (11.11.2026)

Auf separatem Branch `feat/p51-vault-store`: ADR-0063 fortgeschrieben,
Root-Wahl ohne Startpunkt-Zwang, aktueller Root als zusätzlicher
Browse-Einstieg, Ordner-Symlinks mit Realpfad-Besucht-Set und bestehendem
Datei-Cap. `.git`, Hub-`dataDir`, Traversal und Symlink-Ausbrüche bleiben
geprüft; ungültige Root-Wahl lässt den gespeicherten Root unverändert.
Contracts und Policy bleiben unverändert, kein neuer persistenter Zustand (K7).

Nachweise: `packages/core/test/modules/vault/vault.test.ts` und
`apps/hub/test/modules/vault/vault.integration.test.ts` (21 Tests, einschließlich
Root-Rekonstruktion, Zyklus/Alias, Cap, Fehlergründe und Agenten-403).
Die neuen Verhaltensfälle wurden gegen den ursprünglichen Store rot geprüft.
Der Rechte-Test ist unter UID 0 sichtbar geskippt, weil root die Dateirechte
übergehen kann; im lokalen Lauf als normaler Nutzer wird er ausgeführt.

**Abgrenzung:** Keine Picker-/Glocken-/Shortcut-Änderung, keine vollständige
AC-P51-1/2- oder Geräte-Abnahme. T51.3–T51.10 bleiben auf Nutzerwunsch bis zur
Zusammenführung der parallelen Arbeiten offen. `npm run gate` grün (Exit 0):
1808 Unit-/Integrationstests bestanden, 4 Tests und 1 Suite geskippt;
496 E2E-Fälle bestanden, 3 geskippt (21,7 min). Skips zählen nicht als Pässe.
Der erste Gesamtlauf wurde wegen eines fehlenden lokalen TypeScript-Links
gestoppt; nach Dependency-Reparatur ohne Code-/Teständerung ist derselbe
Einzelfall und anschließend das komplette Gate grün. Details stehen in der MR.

## 5. Acceptance Criteria (AC-P51-k)

- **AC-P51-1:** Jeder existierende Ordner des Hosts ist als Vault-Root wählbar — per Klick im Browser oder eingegebenem Pfad, auch außerhalb von `projectRoots`/`HOME` und als Symlink-Ziel; `.git` und Hub-`dataDir` werden weiter abgelehnt, Agenten-Tokens bleiben 403 (Unit/Integration/E2E-Belege).
- **AC-P51-2:** Ordner-Symlinks erscheinen in Browse und Dateiliste; Symlink-Zyklen terminieren (Besucht-Set, Cap ehrlich); Ablehnungen zeigt der Picker als Klartext.
- **AC-P51-3:** Am PC (≥1280 px) sitzen Glocke und Panel in jedem Layoutzustand oben rechts im Fenstereck (E2E-Bounding-Box, auch bei UI-Zoom ≠ 100 %); am Handy bleibt die spaltenbündige Position.
- **AC-P51-4:** Alle globalen Kürzel laufen über die Registry (kein Streu-keydown außer Eingabe-Interaktion); doppelte Combos im selben Scope failen als Testfehler; die bestehenden Kürzel verhalten sich unverändert (bestehende E2E ohne Anpassung grün).
- **AC-P51-5:** Jedes Overlay/Panel (CommandBar, VoiceSheet, SkillPicker, Benachrichtigungen, Cheat-Sheet) ist per Esc schließbar und gibt den Fokus an das auslösende Element zurück (E2E).
- **AC-P51-6:** `?` zeigt die Kürzel des aktuellen Kontexts aus der Registry; mit aktivem Setting „Shortcut-Hinweise" zeigt jeder Klick auf ein Element mit Kürzel den Hinweis unten (~2 s, nicht blockierend), Klicks ohne Kürzel bleiben still, Setting aus → kein Overlay.
- **AC-P51-7:** Die Kollisions-Tabelle liegt in `docs/`; das AV-Standard-Schema kollidiert nicht mit Omarchy-Default-Binds; Firefox-Risiken sind je Kürzel benannt (inkl. Alt+1–4-Entscheid); der Hyprland-`pass`-Snippet ist dokumentiert mit der ehrlichen Grenze (Compositor-Grabs nicht überhebbar).

## 6. Premortem (Failure-Modi + Mitigation)

1. **Symlink-Following wird Recurse-/Loop-Bombe** (Vault verlinkt in sich selbst oder auf Riesen-Verzeichnisse) → Besucht-Set über Realpfade in `list()`, `VAULT_MAX_LIST`-Cap + `truncated` bleibt, Unit-Test mit Zyklus; Browse bleibt eine Ebene pro Request.
2. **Pfad-Freiheit öffnet Angriffsfläche** (Root auf `/etc`, Agenten schreiben Root um) → Policy-Wand unverändert (`settings.manage`, Agenten zentral 403), Guards `.git`/`dataDir`/realpath bleiben, ADR-0063-Ergänzung vor Merge, Integrations-Gegenprobe Agent-403 für die neue Freiheit.
3. **Registry-Migration ändert Alt-Kürzel nebenbei** (Muskelgedächtnis bricht, E2E-Churn) → Verhalten 1:1 als eigene Aufgabe (T51.5) getrennt von neuen Kürzeln (T51.6); bestehende Specs dürfen nicht angefasst werden; keine stillen Umbenennungen — Alt+1–4 bleibt, bis T51.9 eine dokumentierte Entscheidung mit Jan trifft.
4. **Hinweis-Overlay nervt oder verdeckt** (Pill über Composer/Dock, flackert bei jedem Klick) → `pointer-events: none`, max. eine Pill, ~2 s, unten mittig über dem Dock; E2E prüft Nicht-Blockade des Composers; Setting sofort auffindbar in den Einstellungen; Standard an, aber nie ohne Shortcut zeigen (Nutzerentscheid).
5. **Super-Key-Erwartung wird überschätzt** („AV fängt Super ab" geht technisch nicht — Grab liegt beim Compositor) → Epic verspricht keine Grab-Übernahme: Alt-Schema + ungebundene Kombos + `pass`-Snippet-Doku; Grenze steht explizit in Doku und Cheat-Sheet.
6. **Eck-Glocke kollidiert mit Zoom/Formel-Randfällen** (UI-Zoom >100 % schiebt sie raus — bekannter Fund von 2026-10-30) → bestehende Zoom-Formel (`100vw / --ui-zoom`) übernehmen, E2E-Bounding-Box bei 130 %/200 % in T51.4, notifications.spec erweitern statt neu erfinden.

## 7. Definition of Done

Alle T51.* und AC-P51-* mit Evidenz. `npm run gate` grün (inkl. `test:e2e`),
PWA-Build grün. Neue Specs: Vault-Pfad/Symlink-Fälle in `e2e/specs/vault.spec.ts`,
Glocken-Eck-Assertionen in `notifications.spec.ts`, Shortcut-Registry/Overlay/`?`
in neuer `e2e/specs/shortcuts.spec.ts`. ADR-0063-Ergänzung vor Verhaltens-Merge;
Kollisions-Doku `docs/tastatur-kollisionen.md` flach in `docs/`. EPIC-P43
T43.6-Vermerk („?"-Übersicht hierher gezogen) und `epics/README.md` aktualisiert.
Pipeline-Job `e2e` grün bzw. nach `docs/ci-runbook.md` nachgezogen, nie als
Pass gezählt. K7 durchgehalten: Vault bleibt dateibasiert ohne zweiten
Hub-State. Kein TODO ohne Epic-Bezug.
