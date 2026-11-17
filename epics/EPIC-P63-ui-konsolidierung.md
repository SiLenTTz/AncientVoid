# EPIC-P63 — UI-Konsolidierung: standardisiertes Design-System, Token-Treue, CSS-Hygiene

**Status:** Planungsentwurf · **Phase:** P63 · **Dauer:** 3–4 Wochen (je Aufgabe ein Branch/PR) · **Abhängigkeit:** P43 grün (Exit 2026-11-11); quer zu P61/P62 wie P50–P53

Befundgrundlage: [`docs/2026-11-16_ui-styling-audit.md`](../docs/2026-11-16_ui-styling-audit.md) (B1–B7).
Regelwerk: [`docs/design-system.md`](../docs/design-system.md) — wird in T63.10 zum
verbindlichen Vertrag umgebaut. Abschnitt 8 ist die Übergabe an umsetzende Agents.

## 1. Ziel

Nach P63 gibt es **ein** Design-System, das drei Eigenschaften hat:

1. **Standardisiert:** Jede Farbe, Größe, Ebene, jeder Abstand und jede
   Bewegung kommt aus einem Token in `00-tokens.css`; jede Oberfläche wird aus
   den Bausteinen in `apps/pwa/src/shared/ui/` zusammengesetzt. Es gibt keine
   zweite Quelle.
2. **Wartbar:** Jede CSS-Regel hat genau einen Ort; jede Klasse im TSX hat eine
   Regel oder einen dokumentierten Zweck. Ratchet-Tests in `npm test` erzwingen
   das — nicht Review-Disziplin.
3. **Überall einsetzbar:** Tokens und Bausteine funktionieren in Dark/Light,
   bei Skala 0,85–1,3, auf Handy/Tablet/PC, in Popout-Fenstern und in
   Plugin-Panels (P44) ohne Sonderfall. Eine neue Ansicht braucht nur Tokens,
   Bausteine und das Rezept in `design-system.md` — keine neue Farbe, keine
   neue Breakpoint-Zahl, keinen neuen `z-index`.

Messlatten: K2 (Tail ohne Frame-Lag) darf sich nicht verschlechtern;
AC-P43-4 (Kontrast ≥ 4,5:1) gilt in beiden Themen für alle Flächen.

## 2. Scope

**In**

- Token-Architektur in drei Schichten (Primitiv → Semantik → Komponente) in
  `00-tokens.css`, Light-Pendant vollständig.
- Geister-Tokens und Fremd-Fallbacks entfernen (BUG-0187); hartkodierte Farben
  auf Tokens/`color-mix()`.
- Leitern für `z-index`, Breakpoints, Schriftgrößen, Abstände; `em`-Ketten auflösen.
- Bausteine `Button`, `Chip`, `Card`, `Sheet`, `EmptyState` in `shared/ui/`
  neben den vorhandenen `Field`/`Select`/`Switch`/`Segmented`/`StatusDot`.
- Doppelte Selektoren zusammenführen, Dateipräfixe eindeutig, tote Regeln löschen,
  Klassen ohne Regel entscheiden.
- Globaler `:focus-visible`-Ring; Inline-Styles auf Custom Properties.
- Ratchet-Tests für alle Invarianten; `design-system.md` als Vertrag mit Rezept.
- Zerlegung von `SessionTail.tsx` (ohne Verhaltensänderung).

**Out**

- Neue Features, neue Ansichten, neues visuelles Konzept (bleibt P43/P43.5).
- Plugin-Themes (P44), Mehrsprachigkeit (P61), Public-Guide-Screenshots (P62).
- CSS-Framework, Tailwind, CSS-in-JS, Build-Schritt-Änderungen, Storybook.
- Hub-/Contract-Änderungen (reines PWA-Epic; `check:arch` bleibt unberührt).

## 3. Design-Details

### 3.0 Token-Architektur (`00-tokens.css`, neu; `01-base.css` behält Reset + Elementregeln)

| Schicht | Beispiel | Regel |
|---|---|---|
| Primitiv | `--void-violet-500: #b58cff`, `--gray-900: #08090b` | Nur hier stehen Hex-Werte. Nie direkt in Komponenten verwendet. |
| Semantik | `--bg`, `--bg-elev`, `--fg-dim`, `--accent`, `--ok`, `--err`, `--border` | Verweisen auf Primitive; **das** Vokabular für alle Regeln. `[data-theme="light"]` überschreibt nur diese Schicht. |
| Komponente | `--btn-bg`, `--chip-pad`, `--card-radius` | Verweisen auf Semantik; nur dort, wo ein Baustein pro Variante parametrisiert wird. |

Neue semantische Tokens (heute fehlend, aber überall gebraucht): `--border`,
`--border-strong`, `--bg-hover`, `--bg-active`, `--fg-on-accent`,
`--shadow-sheet`. Abgeleitete Flächen (`--ok` 15 % auf `--bg-elev` u. ä.) über
`color-mix(in srgb, …)`, nie als neuer Hex-Wert.

Leitern (ebenfalls in `00-tokens.css`):

- `--z-base 1 · --z-sticky 10 · --z-dock 20 · --z-overlay 50 · --z-sheet 60 · --z-toast 200 · --z-popout 210`.
- Breakpoints als dokumentierte Konstanten: `phone ≤ 639`, `tablet ≤ 1023`,
  `desktop ≥ 1280`, `short ≤ 520 Höhe`; Orientierungs-/Hover-Queries bleiben.
- Schrift nur `--text-xs/sm/md/lg/xl`; Abstand nur `--space-1…6` (neu `--space-6: 32px`).

### 3.1 Token-Treue

- Fehlende Tokens aus BUG-0187 (`--bg-card`, `--danger`, `--bad`, `--panel`,
  `--bg-panel`, `--mono`) werden **nicht** nachgetragen, sondern auf das
  semantische Vokabular gemappt (`--bg-elev`, `--err`, `--font-mono`); `--border`
  wird als echtes Token eingeführt (3.0).
- Werte für Syntax-Highlighting und Graph-Kinds werden Primitive mit
  semantischem Alias (`--code-keyword`, `--graph-doc`), inkl. Light-Pendant.
- Test `apps/pwa/test/css-tokens.test.ts`: (a) jedes `var(--x` ist definiert
  (CSS oder `appearance.ts`/`ui-scale.ts`), (b) kein `#hex`/`rgb(`/`hsl(`
  außerhalb `00-tokens.css`, (c) kein `var(--x, <wert>)`-Fallback, (d) kein
  `z-index` außerhalb der Leiter, (e) keine `px`/`em`-Schriftgröße außerhalb
  `00-tokens.css`, (f) nur erlaubte `@media`-Ausdrücke. Ratchet: Startwerte =
  Ist in `apps/pwa/test/css-ratchet.json`, dürfen nur sinken.

### 3.2 Bausteine (`apps/pwa/src/shared/ui/`)

- `Button` (`variant: primary|subtle|danger|link`, `size: sm|md`, `icon`),
  `Chip` (`tone: neutral|ok|warn|err|info`, `onRemove`), `Card` (`padding`,
  `elevated`), `Sheet` (Overlay mit Backdrop, Fokusfalle via
  `overlay-focus.ts`, Esc), `EmptyState` (Icon, Text, Aktion).
- Vorhandene `Field`/`Select`/`Switch`/`Segmented` ziehen von `shared/forms.tsx`
  nach `shared/ui/` um (Re-Export aus `forms.tsx` bleibt eine Phase lang).
- Jeder Baustein: eine CSS-Datei `apps/pwa/src/app/styles/ui/<name>.css`,
  Klassenpräfix `ui-<name>`, Komponenten-Tokens nur dort. Keine Props für
  freie Farben; Varianten sind die einzige Stellschraube.
- Migration: die 192 `btn`-, 48 `chip`-, 25 `card`-, 65 `empty`- und
  6 `overlay-sheet`-Verwendungen wandern ansichtsweise auf die Bausteine;
  Ratchet `ui-primitives.test.ts` zählt rohe `className="btn…"` herunter.

### 3.3 Dateiordnung

- Ein Selektor, eine Datei. Zusammenführung zugunsten der fachlich näheren
  Datei; `01-base.css` enthält nur Reset und Elementregeln.
- `23-workspace-runtime.css` wird umnummeriert; `index.css` bleibt alleinige
  Import-Liste. Test: Präfixe eindeutig, jede Datei importiert, keine Datei
  ohne Import.

### 3.4 Klassen ↔ Regeln

- Klassen ohne Regel: Regel schreiben oder in `data-testid` umbenennen, wenn
  nur Tests sie brauchen. Test: Menge „Klasse im TSX ohne Regel“ ist leer
  (Allowlist nur für dynamische Präfixe `hljs-`, `layout-`, `graph-dot-`,
  `kind-`, `git-`, `gate-`, `ui-`).
- Tote Regeln werden gelöscht, nicht auskommentiert.

### 3.5 Fokus und Inline-Styles

- Globaler Ring in `01-base.css`: `:focus-visible { outline: 2px solid
  var(--accent); outline-offset: 2px }`; Komponenten entfernen eigene Ringe,
  außer sie brauchen `inset` (Allowlist mit Begründung).
- Inline-`style` nur für echte Laufzeitwerte (`--lane`, `--line`, Picker-Hue);
  alles Statische in CSS. Ratchet zählt `style={{` herunter.

### 3.6 Komponenten-Zerlegung

- `SessionTail.tsx` in `SessionTail` (Rahmen), `TailList` (virtualisierte
  Liste), `TailControls` (Leiste) mit bestehenden Props; kein neuer State-Store.
  K2-Messlauf vor/nach (Skill `messlauf`) als Beleg.

### 3.7 `design-system.md` als Vertrag

Umbau in fünf feste Abschnitte: **Tokens** (Tabelle aus `00-tokens.css`
generiert, Script `scripts/design-tokens-doc.mjs`, Frischhalte über
`check:context`), **Leitern**, **Bausteine** (Props-Tabelle je Baustein),
**Rezept für eine neue Ansicht** (10 Zeilen: Datei anlegen, Präfix, Bausteine,
Tokens, Spec), **Verbote mit Test-Verweis**. Historische Abschnitte (P1.6,
P43-Teilschritte) wandern nach `docs/2026-11-16_design-system-herkunft.md`.

## 4. Aufgaben

Reihenfolge ist verbindlich: Messung vor Änderung, CSS-only vor TSX, größtes
Risiko zuletzt. Jede Aufgabe: Branch `feat/p63-t<n>-<slug>`, `npm run gate`,
PR nach `main`, Self-Merge nach grüner CI, Checkbox hier im selben PR abhaken.

- [x] **T63.0** Ratchet-Tests `css-tokens.test.ts`, `ui-primitives.test.ts` mit Ist-Startwerten in `css-ratchet.json`; `tokens.test.ts` um unbekannte-Token-Prüfung erweitern (rot ohne Fix, BUG-0187). K2-Messlauf als Referenz. Messlatte: AC-P43-4, K2.
- [x] **T63.1** `00-tokens.css` mit drei Schichten und Leitern anlegen; bestehende Tokens aus `01-base.css` verschieben; `--border`, `--bg-hover`, `--bg-active`, `--fg-on-accent`, `--border-strong`, `--shadow-sheet`, `--space-6` einführen; Light-Pendant vollständig; `tokens.test.ts` prüft Kontrast aller semantischen Paare.
- [x] **T63.2** BUG-0187 fixen: Geister-Tokens in `11-report-and-diff`, `29-workplace`, `30-files` auf Semantik mappen; Light-/Dark-Screenshots der drei Flächen in `e2e/specs/themes.spec.ts`.
- [x] **T63.3** Hartkodierte Farben in `11`, `30`, `32`, `22`, `23`, `29`, `25`, `34` und Rest auf Tokens/`color-mix()`; Syntax-/Graph-Farben als Primitive mit Alias; Ratchet (b)/(c) auf 0.
- [x] **T63.4** `z-index`-Leiter, Breakpoint-Stufen, Schrift-/Abstandsskala durchziehen; `em`-Ketten auflösen; Ratchet (d)/(e)/(f) auf 0; `breiten.spec.ts` bei Skala 0,85/1/1,3 grün.
- [x] **T63.5** Doppelte Selektoren zusammenführen, Präfix `23-` auflösen, tote Regeln löschen; Test „ein Selektor, eine Datei“ und „jede Datei importiert“; Screenshot-Vergleich der betroffenen Ansichten.
- [x] **T63.6** 77 Klassen ohne Regel entscheiden (Regel oder `data-testid`); Test mit Allowlist leer.
- [x] **T63.7** Bausteine `Button`, `Chip`, `Card`, `EmptyState` in `shared/ui/` mit eigener CSS; `Field`/`Select`/`Switch`/`Segmented` umziehen; Unit-Tests je Baustein (Varianten, Tastatur, `aria`).
- [x] **T63.8** `Sheet` als Baustein; Overlays (`overlay-sheet`, `nyx-window`, `modal`, `more-backdrop`) darauf migrieren; `fokus.spec.ts` (Tab-Reihenfolge Dock → Inhalt → Composer, Fokusfalle, Esc).
- [x] **T63.9** Migration der rohen `btn`/`chip`/`card`/`empty`-Klassen ansichtsweise auf Bausteine (ein PR je Feature-Ordner, Ratchet `ui-primitives` auf 0); globaler `:focus-visible`-Ring; Inline-Styles auf Custom Properties.
- [ ] **T63.10** `design-system.md` zum Vertrag umbauen (3.7), Token-Tabelle generiert, Rezept, Verbote mit Test-Verweis; Herkunft ausgelagert; `check:context` grün.
- [ ] **T63.11** `SessionTail.tsx` zerlegen; K2-Messlauf vorher/nachher in `docs/` dokumentiert. Optional bei K2-Verschlechterung (Premortem 3).
- [ ] **T63.12** Abnahme auf Handy (adb), Tablet-Projekt, PC, Popout-Fenster in beiden Themen; Retro (Skill `retro`), Allowlist-Wachstum bewertet.

## 5. Acceptance Criteria

- **AC-P63-1:** `css-tokens.test.ts` grün mit 0 undefinierten Tokens, 0 Hex/RGB/HSL außerhalb `00-tokens.css`, 0 Fallback-Werten, 0 `z-index`/Schriftgrößen/Media-Queries außerhalb der Leitern.
- **AC-P63-2:** Light- und Dark-Screenshots von Diff-Review, Dateien-Schublade, Arbeitsort, Graph, Loops, Settings zeigen keine Fremdfarbe; Kontrast ≥ 4,5:1 für alle semantischen Paare (`tokens.test.ts`).
- **AC-P63-3:** Jeder Klassen-Selektor existiert in genau einer Datei; jede TSX-Klasse hat eine Regel oder steht auf der Allowlist; `index.css` importiert alle Dateien mit eindeutigem Präfix.
- **AC-P63-4:** `ui-primitives.test.ts` grün mit 0 rohen `btn`/`chip`/`card`/`empty`/`overlay-sheet`-Klassen in `features/`; jeder Baustein hat Unit-Test und Props-Tabelle in `design-system.md`.
- **AC-P63-5:** `fokus.spec.ts` grün auf Handy/Tablet/PC-Projekten; sichtbarer Ring auf jedem fokussierbaren Element; Fokusfalle in `Sheet`.
- **AC-P63-6:** K2-Messlauf nach T63.11 nicht schlechter als Referenz aus T63.0.
- **AC-P63-7:** `funktionsinventar.spec.ts` unverändert grün — kein Funktionsverlust.
- **AC-P63-8:** Ein nach dem Rezept in `design-system.md` angelegter Probe-Screen (`e2e/fixtures/ds-probe/`, nicht geroutet) besteht alle Ratchet-Tests ohne Allowlist-Eintrag — Beleg für „überall einsetzbar“.

## 6. Premortem

1. **Zusammenführen von Selektoren ändert die Kaskade und bricht Layouts still.** Mitigation: T63.5 nur mit Playwright-Screenshot-Vergleich (`toHaveScreenshot`) der betroffenen Ansichten; pro PR höchstens fünf Selektoren.
2. **Ratchet-Tests werden mit Allowlist-Einträgen umgangen.** Mitigation: Allowlist nur für dynamische Präfixe, jeder Eintrag mit Kommentar und Datei-Verweis; T63.12 bewertet Allowlist-Wachstum; Wachstum > 0 ohne Begründung blockiert die Retro.
3. **`SessionTail`-Zerlegung verschlechtert K2.** Mitigation: Referenzmessung in T63.0; Props-Identität mit `useMemo`; bei Verschlechterung Zerlegung zurücknehmen, Epic bleibt abschließbar (T63.11 optional).
4. **Globaler Fokus-Ring kollidiert mit Overlays/Popouts (`overlay-focus.ts`).** Mitigation: Ring nur `:focus-visible`, nie `:focus`; `fokus.spec.ts` testet Overlay-Öffnen/Schließen und Popout-Fenster.
5. **Baustein-Migration (T63.9) wird zur Großbaustelle und kollidiert mit P61/P62 in denselben TSX-Dateien.** Mitigation: ein PR je Feature-Ordner, CSS-only-Aufgaben zuerst; vor jedem TSX-PR `git fetch` und offene PRs auf Überschneidung prüfen; Baustein-API vor Migration eingefroren (T63.7 gemergt).
6. **Token-Umbau bricht P43.5-Presets (`--code-scale`, `--preset-border`, `--radius`, `--device-background`).** Mitigation: diese Namen bleiben unverändert und stehen in `00-tokens.css` als Preset-Eingänge markiert; `presets.test.ts` bleibt grün.

## 7. Definition of Done

- `npm run gate` lokal grün; GitHub-Actions-Lauf (`verify`, `k8`, `e2e`) auf dem Abschluss-PR grün; rote CI allein wegen Umgebung wird benannt, nie als Pass gezählt.
- Jede neue UI-Funktion/jeder Ablauf mit Spec in `e2e/specs/` (`themes.spec.ts`, `fokus.spec.ts`).
- AC-P63-1…8 mit Beleg in der Retro-Tabelle; BUG-0187 geschlossen.
- `docs/design-system.md` ist der Vertrag (3.7) und über `check:context` frischgehalten; `docs/funktionsinventar.md` unverändert oder mit begründeter Änderung.
- Erreichbarkeit: Ratchet-Tests laufen in `npm test`; Bausteine sind aus `shared/ui/index.ts` exportiert und im Rezept genannt.

## 8. Übergabe an umsetzende Agents

Dieser Abschnitt reicht, um ohne Gesprächsverlauf zu starten.

1. **Lesen (in dieser Reihenfolge):** `AGENTS.md`, dieses Epic, das Audit
   `docs/2026-11-16_ui-styling-audit.md`, `docs/design-system.md`,
   `bugs/bug-0187-*.md`. Skills: `gates`, `git-workflow`, `write-tests`,
   `bugfix` (für T63.2), `messlauf` (T63.0/T63.11), `retro` (T63.12).
2. **Stand prüfen:** `git fetch`, `gh pr list --search P63`, Checkliste in
   Abschnitt 4 — nächste unabgehakte Aufgabe nehmen. Nie zwei TSX-Aufgaben
   parallel (Premortem 5).
3. **Pro Aufgabe:** Branch `feat/p63-t<n>-<slug>` von `main`; zuerst den
   Ratchet-Wert in `css-ratchet.json` senken (Test rot), dann umsetzen (grün);
   `npm run gate`; PR-Titel in Commit-Notation (`^ F pwa: …` bzw.
   `. d docs: …`), PR-Body mit Test-Belegen; Checkbox im selben PR abhaken;
   `gh pr merge --merge --delete-branch` nach grüner CI.
4. **Nie:** neue Hex-Werte außerhalb `00-tokens.css`, neue `z-index`-Zahlen,
   neue Breakpoints, Allowlist-Einträge ohne Kommentar, `!important` (außer
   Select-Pfeil in `01-base.css`), Verhaltensänderungen an Funktionen aus
   `docs/funktionsinventar.md`.
5. **Bei Unsicherheit:** Entscheidung als Frage in den PR-Body, Aufgabe nicht
   blockieren; Scope-Fragen an den Nutzer, nicht selbst erweitern.
6. **Gate-Hinweise:** E2E dauert ~20 min; `npm run gate` nie parallel zu
   `npm run test:phone` (BUG-0120). Commit-Zusammenfassung ≤ 100 Zeichen.
