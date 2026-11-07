# EPIC-P35 — Harness-Parität: Fortsetzen, Erkennung, Provider-Modularität

**Status:** offen · **Phase:** P35 · **Dauer:** 2–3 Agenten-Wochen · **Abhängigkeit:** P34-Implementierungs-Exit grün (T34.1–T34.12, Gate 07.11.2026). Die offene Live-Abnahme AC-P34-13 wird gemeinsam mit der P35-Abnahme in einem Termin gemacht (Präzedenz P1.5/P1.6: nicht zwei Abnahmen auf Oberflächen, die sich gerade ändern). P30 wartet damit zusätzlich auf P35.

**Auftrag:** Jan, 07.11.2026 (Nutzermeldung mit Screenshot): „Session fortsetzen
macht immer noch regelmäßig Probleme"; Popout-Fenster „nimmt nicht die ganze
Fläche ein und hat Ränder"; „Ich hatte eigentlich Codex ausgewählt" (gestartet
ist claude); Inventar-Tabelle mit sechs unbelegten/fehlenden Zellen. Auftrag:
Stand scannen, alle Harnesses mit Custom- oder eigenem Provider sauber
betreiben, alles so modular, dass neue Provider/Modelle nach Belieben
einbindbar sind.

## 1. Ziel

Jede Zelle der Harness-Matrix ist entweder mit Live-Beleg belegt oder ehrlich
begründet — kein „gebaut, unbelegt", das im Fehlerfall wie ein Defekt wirkt.
Konkret: „Weitermachen" funktioniert nach Unterbrechung überall dort, wo das
CLI es hergibt (und sagt sonst warum); die gewählte Harness-/Treiber-Kombination
wird tatsächlich gestartet; das Popout füllt das Fenster; Modell- und
Provider-Anbindung folgt einem einheitlichen, config-getriebenen Muster, auf
dem P30 (Plugin-Distribution) und P31 (kuratierter ACP-Katalog) aufbauen.
Messlatten: K7 (Recovery), K2 (Tail auch im Popout), K5, fail loud im K9-Sinne.

## 2. Scope (In / Out)

**In:** Popout-Vollfläche (P34-Rest); Start-Korrektheit Adapter/Treiber bei
Loop-Starts; `resume`-Deklarationen mit `hub` und Live-Beleg je CLI;
Resume-Fehlerursachen sichtbar (Provider-Kategorie); Discovery-Lücken belegen
oder begründen; `HARNESS_CATALOG`/Inventar/Doku synchron; Modell-Katalog- und
Custom-Provider-Muster als Contract-Standard (aus dem ACP-Adapter
verallgemeinert); Nutzung/Kontextfenster-Anzeige konfigurierbar (ADR-0032).

**Out:** Plugin-Distribution, Lifecycle und Remote-Code (P30); kuratierte
neue ACP-Provider mit Probe (P31); neue native Adapter; Auto-Installation von
CLIs; Emulation von Resume, wo das CLI keinen promptlosen Continue kennt
(codex `exec resume` braucht einen Prompt — ehrlich bleiben, kein Fake-Flag).

## 3. Design-Details

### 3.1 Befund Popout-Ränder (T35.1)

BUG-0103 entfernte die 680-px-`#app`-Beschränkung für `.popout-shell`
(`27-popout.css` `#app:has(.popout-shell)`). Übrig blieb die Lesespalte:
`.popout-tile { padding-inline: max(12px, calc((100% - 1200px) / 2)) }`
(`27-popout.css:37`, übernommen aus `.tile-grid.layout-1 > .tile`,
`02-layout.css:228`). Auf einem großen Fenster entstehen dadurch breite
Ränder links/rechts — genau der berichtete Fehler. Ziel: das eigene Fenster
nutzt die ganze Fläche; Umbruch statt Ränder (globale Overflow-Regeln,
`01-base.css`). Die `popout-bar` (Kopfzeile mit Rückkehr-Knopf) bleibt —
sie ist Funktion, nicht Rand.

### 3.2 Befund „gewählter Harness startet nicht" (T35.2)

- `CreateSession.tsx:223`: `...(startLoop ? { loop: startLoop } : { adapter })`
  — mit Loop wird die gewählte Treiber-Adapter-ID **nicht** gesendet; nur der
  `factoryRun`-Pfad (T26.5) trägt sie explizit (`api.factoryStart`).
- `CreateSession.tsx:188–190`: securesight-factory setzt still jeden Treiber
  außer claude/maki auf claude zurück (ADR-0048-Treiberwahl) — ohne Hinweis.
- `LAST_KEY` wird erst bei Submit geschrieben (`CreateSession.tsx:231`);
  eine getroffene, nicht abgeschickte Auswahl geht bei Remount verloren
  (Verwandte: BUG-0078, BUG-0096).
Regel: Die Auswahl ist either/or — sie erreicht den Server unverändert, oder
die Abweichung steht sichtbar mit Grund da (fail loud), bevor gestartet wird.

### 3.3 Resume-Systematik (T35.3/T35.4)

`resumeNow` (`session-manager.ts:1198`) verlangt `resume.hub === true` und
`ref === "native"`; sonst „Dieser Adapter kann nicht nativ fortsetzen" bzw.
disabled Button (`canResume`). Deklarationslage:

| Adapter | `capabilities().resume` | `start({args:{resumeSessionId}})` | Folge |
|---|---|---|---|
| claude | `ref: native`, kein `hub` | implementiert, promptlos idle (ADR-0040) | „Weitermachen" verweigert |
| codex | `ref: native`, kein `hub` | nur mit Prompt (`exec resume`), kein promptloser Continue | dito; ehrlich begründen |
| opencode (direkt) | `ref: native`, kein `hub` | implementiert (`--session`, Zeile 210/254) | „Weitermachen" verweigert |
| pi | keine Deklaration | implementiert (`--session <file>`) | dito |
| copilot | keine Deklaration | implementiert (`-r <id>`) | dito |
| hermes | `ref: native`, kein `hub` | `--resume <sid>` (P13, live belegt) | „Weitermachen" verweigert |
| ACP: maki/omp | `hub: true` (BUG-0101) | `session/load` (ADR-0041, live) | funktioniert |
| ACP: dsh/copilot/opencode/custom | keine | unbelegt | ehrlich disabled |
| aider/cursor | keine | nicht vorhanden | begründen (cursor: IDE-UI) |

Die Maschinerie (ADR-0036/0044, InterruptedBanner, `POST …/resume`) ist fertig
— der Flotte fehlt die belegte Opt-in-Deklaration. Je Adapter: `hub: true`
setzen **mit** dokumentiertem Live-Beleg (Hub-Neustart mitten im Lauf →
„Weitermachen" → Zug läuft auf derselben native Session weiter); ohne Beleg
bleibt es aus. Für codex prüfen, ob `codex exec resume <id> "<noop>"` oder
ein äquivalent promptloses Weiterfahren existiert; wenn nein: Deklaration
bleibt ohne `hub` und der Grund steht in der Inventar-Zelle.

### 3.4 Discovery-Lage (T35.5/T35.6)

`HARNESS_CATALOG` (`core/src/modules/harness/inventory.ts`): discovery
`missing` bei codex, opencode, copilot, dsh; resume `missing` bei aider,
cursor; `implemented-unverified` bei claude, codex, pi, copilot, dsh. Vorbild
fürs Schließen: claude-clip (JSONL-Scan) und ADR-0041 (pi/maki/omp-Scans mit
Titel, Übernahme, Verlaufs-Import). Je Kandidat zuerst Layout prüfen
(codex: `~/.codex/sessions`; opencode: Storage-Verzeichnis; copilot/dsh:
Dockersitz der CLI) — existiert kein stabiles On-Disk-Layout, bleibt die
Zelle `missing` **mit** Begründung in `evidence` (ein Satz, warum nicht).
Parser strikt: unbekanntes Format → Event/Status, nie still (K9-Geist);
Fixtures aufgezeichnet, anonymisiert, secret-gescannt (P1-Regel).

### 3.5 Provider-/Modell-Modularität (T35.7/T35.8)

Der ACP-Adapter trägt das beste Muster: `preset | command | env | envFiles |
model | modelsCommand | contextWindows | startupTimeoutMs`
(`acp/src/index.ts`, `AcpConfig`) — neue Modelle/Provider ohne Codeänderung,
Schlüssel nie in der Config (`envFiles`). Native Adapter haben je eigene
Pfade (claude Katalog, codex `--model`, pi/opencode `--model`). P35 verallgemeinert:

- **Modell-Katalog als Contract-Muster:** die ACP-Mechanik
  (`modelsCommand` → Liste, `pickModel`-Semantik „kein Match → sichtbar
  ablehnen statt still falschem Modell", ADR-0018/0033) wird für alle
  Adapter deklarativ; native Adapter liefern ihre Kataloge ohne Codeänderung.
  ADR nötig (Contract-Erweiterung) — inkl. Kontextfenster/Nutzung (ADR-0032),
  damit „Tokens unbekannt · Kontext unbekannt" verschwindet, wo die CLI es
  hergibt.
- **Custom-Provider-Registration ohne Code:** dokumentierte generische
  Registration (Vorlage in `docs/adapters.md`): eigenes Label, command/env/
  envFiles, Modellwahl, Timeouts — gegen ein echtes Custom-Entry getestet
  (Testkit-Suite grün). Das ist der Konfig-Pfad, den P30 als Distribution und
  P31 als kuratierter Katalog weiterführen; P35 legt das Contract-Fundament,
  baut aber keine zweite Katalog-Wahrheit.

### 3.6 Regeln

Contracts first: jede Änderung an `AdapterCapabilities`/`HarnessCatalogEntry`
braucht ein ADR. Adapter sehen nur `AdapterContext`; `providerErrorEvent`
(ADR-0015) für Resume-/Startfehler des Providers. `npm run check:arch` grün.
Kein Haken ohne zugehörige Evidenz (Beleg oder begründetes missing).

## 4. Aufgaben (Checkliste T35.m)

- [x] **T35.1** Popout-Vollfläche: 1200-px-Lesespalte aus dem Popout entfernen
  (`.popout-tile`/`02-layout.css:228`-Entsprechung), Umbruch statt Ränder,
  kein horizontaler Scroll; E2E misst Fenster- vs. Kachelbreite. Messlatte K2.
  *Abgeschlossen 07.11.2026 (BUG-0104):* `.popout-tile` mit festem `padding-inline: 12px`;
  E2E `windows.spec.ts` misst computed Padding (≤ 12) und `scrollWidth ≤ innerWidth` —
  ohne Fix rot (120 px bei 1440-px-Fenster).
- [x] **T35.2** Start-Korrektheit: Loop-Start sendet den gewählten Treiber
  (oder weist ihn vor dem Start sichtbar zurück mit Grund — nie stiller
  claude-Reset `CreateSession.tsx:189`); Adapter-Auswahl überlebt Remount
  (Draft-Merkung). E2E in `factory.spec.ts`/`modus-modell.spec.ts`.
  *Abgeschlossen 07.11.2026 (BUG-0105):* Treiber-Ersetzung als `role="status"`-Hinweis,
  eigene Auswahl löscht ihn; `setAdapter` schreibt die Wahl sofort in
  `ancientvoid.newSession.last`. E2E rot-grün in beiden Specs. Der Onboarding-Pfad
  (Loop ohne Factory-Start) erstellt weiter nur den Beobachter — Treiber-Wahl dort
  ohne Wirkung ist P26-Design, nicht Stillstand.
- [x] **T35.3** Resume-Deklarationen + Live-Belege: claude, opencode, pi,
  copilot, hermes `resume` um `hub: true` ergänzen, je mit dokumentiertem
  Beleglauf (Hub-Neustart → „Weitermachen" → Zug läuft weiter); codex und
  ACP-Presets ohne promptlosen Continue ehrlich ohne `hub` mit Grund in der
  Zelle. Testkit-Suite (resume-argv/hub-Prüfung) grün. Messlatte K7.
  *Code abgeschlossen 07.11.2026:* Alle fünf deklarieren `hub: true`; opencode/copilot/hermes
  haben dafür den promptlosen Idle-Pfad in `start()` bekommen (kein Spawn, sichtbares
  Übernahme-Event), copilot liest `args.resumeSessionId` erstmals. Live-Rauchtest der
  Idle-Adoption gegen echte Sessions (claude: 201 importierte Events, pi: 7, kein
  Provider-Aufruf). **Live-Belege 07.11.2026 (Ring auf Scratch-Hub, Port 7390):** je
  Harness Zug 1 merkt Codewort → Worker-Kill mitten im Zug 2 → `interrupted` →
  „Weitermachen“ → Zug 3 fragt ab — claude **KIESEL-7** ✅, opencode **NEBEL-11** ✅,
  pi **QUARZ-3** ✅ (pi führt den abgebrochenen Zug zuerst zu Ende — CLI-Queue,
  danach antwortet es aus dem Kontext), copilot **LAVA-9** ✅, hermes **DELTA-5** ✅.
  Katalog-Zellen daraufhin auf `verified` gehoben. Zusätzlich live belegt: die
  Copilot-Übernahme aus der Erkennung (Adoption „remember the number 42“ →
  Antwort „42“) — `unsupportedResume` im Scanner freigeschaltet.
- [x] **T35.4** Resume-Robustheit: `session.resume_failed` trägt
  Provider-Kategorie (`classifyProviderError`); doppelter „Weitermachen"-Klick
  startet keinen zweiten Provider-Prozess (Steer-Queue-Serialisierung,
  BUG-0017-Muster; Wait-Pinning ADR-0037); Negativtest vorhanden.
  *Abgeschlossen 07.11.2026:* Erkennbare Provider-Ursachen → zusätzliches
  `provider.error`-Event (ADR-0015-Form), interne Fehler bleiben ohne Kategorie
  (Integrationstests für beide). Doppelklick-Schutz war bereits gegeben (Resume läuft
  durch die serialisierte Steer-Queue; Status-Gate verweigert die zweite Runde) —
  bestehende Tests decken es.
- [x] **T35.5** Discovery: Layout-Prüfung + Scan oder begründetes `missing`
  für codex, opencode, copilot, dsh (Vorlage claude-clip/ADR-0041); Übernahme
  mit Verlaufs-Import für mindestens zwei der vier, falls Layout existiert;
  Formatbruch fail loud mit Test. Fixtures anonymisiert.
  *Abgeschlossen 07.11.2026:* copilot-Scanner neu (`~/.copilot/session-store.db`, SQLite
  read-only; live 12 Sessions; Übernahme unbelegt → nur beobachtet, Codex-Maßstab).
  codex/opencode-Scanner existierten schon (T34.8/P5) und sind live gegen die echten
  Stores verifiziert (55 Rollouts/488 Sessions). dsh begründet `missing`: Sessions als
  `session.v4.jsonl.zstd` — kein `node:zstd`, keine nativen Module, kein Decoder.
  Übernahme aus der Erkennung bleibt Vorbehalt des Live-Nachweises (siehe T35.3).
- [x] **T35.6** Inventar & Doku synchron: `HARNESS_CATALOG`-Zellen aus den
  Belegen aktualisieren (Version + Datum + Kurzverweis), Inventar-Tabelle der
  PWA zeigt den Beleg-Kurzvermerk, `docs/harness-matrix.md` und
  `docs/adapters.md` auf demselben Stand.
  *Abgeschlossen 07.11.2026:* codex/opencode/copilot discovery → verified (mit Datum
  und Menge), Hermes als eigene Zeile ergänzt (Discovery+Resume verified), dsh-Grund
  aktualisiert, Resume-Zellen um den hub-Stand ergänzt. `docs/adapters.md` erklärt
  `hub: true` samt Idle-Regel. E2E-Inventar-Erwartung aktualisiert.
- [ ] **T35.7** Modell-/Nutzungs-Contract: ADR für die Verallgemeinerung von
  `modelsCommand`/`pickModel`-Semantik/Kontextfenster (ADR-0032-Muster) auf
  alle Adapter; native Adapter ohne Codeänderung katalogfähig; keine stille
  Ersatzmodell-Auswahl. Messlatte K5 (Events ≤ 4 KB).
- [ ] **T35.8** Custom-Provider ohne Code: generische Registration dokumentiert
  (Label, command, env/envFiles, model, Timeouts — ACP-`AcpConfig` als
  Vorlage), Beispiel-Entry in der Doku, Testkit-Grün gegen ein echtes
  Custom-Entry; Abgrenzung zu P30/P31 im ADR festgehalten.
- [ ] **T35.9** Abschluss: `npm run gate` grün, Specs komplett, Live-Abnahme
  durch Jan (Desktop + Pixel) gemeinsam mit AC-P34-13, `epics/README.md`
  aktualisiert, Retro angehängt.

## 5. Acceptance Criteria (AC-P35-k)

- **AC-P35-1:** Ein Session- und ein Werkzeug-Popout füllen das Fenster
  vollständig (keine seitliche Lesespalte, keine horizontalen Scrollbalken);
  E2E prüft die Geometrie; K2-Messlauf unverändert grün.
- **AC-P35-2:** Startet der Nutzer Harness X (auch als Factory-Treiber oder
  mit gemerktem Draft), startet Harness X — oder die Oberfläche begründet die
  Abweichung vor dem Start. Ein stiller Reset kommt nicht mehr vor; E2E rot
  auf dem alten Verhalten.
- **AC-P35-3:** „Weitermachen" nach Hub-Neustart ist live belegt für claude,
   opencode, pi, maki, omp (je ein dokumentierter Lauf, native Session bleibt
   dieselbe); Harnesse ohne promptlosen Continue zeigen den ehrlichen Grund
  statt eines toten Knopfs; Adapter-Suiten grün.
- **AC-P35-4:** Von den vier Discovery-Lücken (codex, opencode, copilot, dsh)
  sind mindestens zwei belegt (Scan + Übernahme + Import) oder begründet
  `missing`; ein Formatbruch im Scan wird als Status/Event sichtbar (Test).
- **AC-P35-5:** Ein neuer Provider bzw. ein neues Modell ist über Config
  eingebunden (Doku-Beispiel + Testkit-Grün + ein Live-Rauchtest), ohne
  Änderung an Adapter-Quellcode.
- **AC-P35-6:** `npm run gate` grün; jede neue UI-Funktion/jeder Ablauf hat
  einen Spec in `e2e/specs/`; `HARNESS_CATALOG`, Inventar-Tabelle und
  `docs/harness-matrix.md` zeigen denselben ehrlichen Stand.
- **AC-P35-7:** Live-Abnahme durch Jan (Desktop + Pixel) gemeinsam mit
  AC-P34-13 erfolgt; Retro im Epic vermerkt.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Beleg-Stau:** Live-Belege je CLI-Version (fünf Resume-Läufe, Discovery-
   Handschliffe) überfordern die Epik-Dauer und werden durch Unit-Tests
   „ersetzt". → Belegläufe sind kleine dokumentierte Einzelläufe
   (messlauf-Format, je ≤ 15 min); CI deckt nur Mechanik; ohne Beleg wird
   keine Zelle aufgewertet — „grün durch Testdouble" ist verboten.
2. **Layout-Churn:** Ein CLI wechselt still sein Session-Format (codex rollt
   JSONL-Schema), der Scan liefert Müll. → Parser versioniert und strikt;
   unbekannte Zeilen/Struktur → Status/Event statt stiller Teilmenge;
   Fixtures je Formatversion; Discovery-Fehler tauchen in der Inventar-Zelle
   auf.
3. **Doppel-Resume zerstört die native Session:** Zwei „Weitermachen"-Klicks
   oder Resume gegen einen noch laufenden Worker starten zwei Prozesse auf
   derselben Provider-Session (Sperre/Verlust). → Resume läuft durch die
   serialisierte Steer-Queue, vorheriger Worker wird sicher abgeräumt
   (ADR-0037 Wait-Pinning, Interrupt-Controller), Negativtest
   Doppelklick + Resume-gegen-laufend.
4. **Zwei Wahrheiten über Provider:** P35-Contract und P30/P31-Katalog
   beschreiben dasselbe doppelt und driften auseinander. → ADR grenzt scharf:
   P35 macht die Bestandsflotte deklarativ (Contract + Config-Muster), P30
   liefert Distribution/Lifecycle, P31 kuratiert neue ACP-Provider mit Probe;
   P31 (T31.1-Matrix) zeigt explizit auf das P35-Ergebnis.
5. **Vollfläche unleserlich:** Ohne Lesespalte laufen diffs/Logs in
   Bildschirmbreite. → Umbruch regelt der Tail (globale Overflow-Regeln,
   Code-Blöcke behalten eigene Breitenbegrenzung), nicht der Fensterrand;
   E2E mit langem Codeblock prüft Umbruch statt Scrollen.

## 7. Definition of Done

Alle AC-P35-1–7 grün; `npm run gate` grün (typecheck, lint, test, e2e, arch);
Pipeline-Job `e2e` auf dem Abschluss-MR grün oder nach `docs/ci-runbook.md`
nachgezogen; jede neue Funktion/jeder Ablauf mit Spec in `e2e/specs/`;
`HARNESS_CATALOG`, PWA-Inventar, `docs/harness-matrix.md`, `docs/adapters.md`
auf gleichem Stand; ADRs für Contract-Änderungen; Live-Abnahme (gemeinsam mit
AC-P34-13) durch Jan; `epics/README.md` aktualisiert; Retro angehängt.
