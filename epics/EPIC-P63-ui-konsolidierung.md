# EPIC-P63 — UI-Konsolidierung: Token-Treue, CSS-Hygiene, Fokus-System

**Status:** Planungsentwurf · **Phase:** P63 · **Dauer:** 2–3 Wochen (je Aufgabe ein Branch/PR) · **Abhängigkeit:** P43 grün (Exit 2026-11-11); quer zu P61/P62 wie P50–P53

Befundgrundlage: [`docs/2026-11-16_ui-styling-audit.md`](../docs/2026-11-16_ui-styling-audit.md) (B1–B7).
Regelwerk: [`docs/design-system.md`](../docs/design-system.md).

## 1. Ziel

Die PWA sieht in jedem Thema, jeder Skala und auf jedem Gerät aus **einem
Guss** aus, und neue UI-Arbeit wird billiger: jede Farbe, Größe, Ebene und
jeder Abstand kommt aus einem Token; jede CSS-Regel hat genau einen Ort; jede
Klasse im TSX hat eine Regel oder einen dokumentierten Zweck. Das wird durch
Ratchet-Tests erzwungen, nicht durch Review-Disziplin. Messlatte: K2 (Tail
ohne Frame-Lag) darf sich nicht verschlechtern; AC-P43-4 (Kontrast ≥ 4,5:1)
gilt in beiden Themen für alle Flächen.

## 2. Scope

**In**

- Geister-Tokens und Fremd-Fallbacks entfernen (BUG-0177).
- Hartkodierte Farben in `app/styles/` auf Tokens/`color-mix()` zurückführen.
- Token-Leitern für `z-index`, Breakpoints, Schriftgrößen; `em`-Ketten auflösen.
- Doppelte Selektoren zusammenführen, Dateipräfix `23-` eindeutig machen.
- Ungenutzte CSS-Regeln löschen; Klassen ohne Regel entscheiden (Regel oder
  `data-testid`).
- Globaler `:focus-visible`-Ring; Inline-Styles auf Custom Properties.
- Ratchet-Tests (Unit) für alle genannten Invarianten.
- Zerlegung von `SessionTail.tsx` in Darstellung/Zustand (ohne Verhaltensänderung).

**Out**

- Neue Features, neue Ansichten, neues visuelles Konzept (bleibt P43/P43.5).
- Plugin-Themes (P44), Mehrsprachigkeit (P61), Public-Guide-Screenshots (P62).
- CSS-Framework, Tailwind, CSS-in-JS, Build-Schritt-Änderungen.

## 3. Design-Details

### 3.1 Token-Treue

- Fehlende Tokens werden **nicht** nachgetragen; Stellen mit `--border`,
  `--bg-card`, `--danger`, `--bad`, `--panel`, `--bg-panel`, `--mono` wechseln
  auf `--bg-chip`, `--bg-elev`, `--err`, `--font-mono`.
- Hartkodierte Farben: `color-mix(in srgb, var(--token) N%, transparent)`;
  bleibt ein Wert nötig (Syntax-Highlighting, Graph-Kinds), wandert er als
  Token nach `01-base.css` mit Light-Pendant.
- Neuer Test `apps/pwa/test/css-tokens.test.ts`: (a) jedes `var(--x` ist
  definiert, (b) kein `#hex`/`rgb(` außerhalb `01-base.css`, (c) kein
  `var(--x, <wert>)`-Fallback. Ratchet: Startwert = Ist, sinkt pro Aufgabe auf 0.

### 3.2 Leitern

- `--z-base 1 · --z-sticky 10 · --z-dock 20 · --z-overlay 50 · --z-sheet 60
  · --z-toast 200 · --z-popout 210`. Keine freien Zahlen.
- Breakpoints als Custom-Media-Kommentar in `01-base.css` dokumentiert und auf
  vier Stufen begrenzt: `phone ≤ 639`, `tablet ≤ 1023`, `desktop ≥ 1280`,
  `short ≤ 520 Höhe`. Orientierungs- und Hover-Queries bleiben.
- Schriftgrößen nur `--text-*`; `em` nur für Icon-zu-Text-Verhältnisse.

### 3.3 Dateiordnung

- Ein Selektor, eine Datei. Zusammenführung zugunsten der fachlich näheren
  Datei; `01-base.css` enthält nur Reset, Tokens, Elementregeln.
- `23-workspace-runtime.css` → `23b-…` oder Umnummerierung; `index.css`
  bleibt alleinige Import-Liste. Test: Präfixe eindeutig, jede Datei importiert.

### 3.4 Klassen ↔ Regeln

- Klassen ohne Regel: entweder Regel schreiben oder in `data-testid`
  umbenennen, wenn nur Tests sie brauchen. Test: Menge „Klasse im TSX ohne
  Regel“ ist leer (Allowlist für dynamische Präfixe `hljs-`, `layout-`,
  `graph-dot-`, `kind-`, `git-`, `gate-`).
- Tote Regeln werden gelöscht, nicht auskommentiert.

### 3.5 Fokus und Inline-Styles

- Globaler Ring in `01-base.css`: `:focus-visible { outline: 2px solid
  var(--accent); outline-offset: 2px }`; Komponenten entfernen eigene Ringe,
  außer sie brauchen `inset`.
- Inline-`style` nur für echte Laufzeitwerte (`--lane`, `--line`, Hue des
  Pickers); alles Statische in CSS.

### 3.6 Komponenten-Zerlegung

- `SessionTail.tsx` in `SessionTail` (Rahmen), `TailList` (virtualisierte
  Liste), `TailControls` (Leiste) mit bestehenden Props; kein neuer State-Store.
  K2-Messlauf vor/nach (Skill `messlauf`) als Beleg.

## 4. Aufgaben

- [ ] **T63.0** Ratchet-Test `css-tokens.test.ts` mit Ist-Startwerten anlegen; `tokens.test.ts` um unbekannte-Token-Prüfung erweitern (rot ohne Fix, BUG-0177). Messlatte: AC-P43-4.
- [ ] **T63.1** BUG-0177 fixen: Geister-Tokens in `11-report-and-diff`, `29-workplace`, `30-files` ersetzen; Light-Theme-Screenshot der drei Flächen in `e2e/specs/themes.spec.ts`.
- [ ] **T63.2** Hartkodierte Farben in `11`, `30`, `32`, `22`, `23`, `29`, `25`, `34` auf Tokens/`color-mix()`; Ratchet auf 0.
- [ ] **T63.3** `z-index`-Leiter und Breakpoint-Stufen einführen; Test auf freie Zahlen/fremde Queries.
- [ ] **T63.4** Schriftgrößen auf `--text-*`; `em`-Ketten auflösen; `breiten.spec.ts` bei 0,85/1/1,3 Skala grün.
- [ ] **T63.5** Doppelte Selektoren zusammenführen, Präfix `23-` auflösen; Test „ein Selektor, eine Datei“.
- [ ] **T63.6** 77 Klassen ohne Regel entscheiden (Regel oder `data-testid`), ~40 tote Regeln löschen; Test mit Allowlist.
- [ ] **T63.7** Globaler `:focus-visible`-Ring, lokale Ringe entfernen; Inline-Styles auf Custom Properties; Tastatur-Spec `fokus.spec.ts` (Tab-Reihenfolge Dock → Inhalt → Composer).
- [ ] **T63.8** `SessionTail.tsx` zerlegen; K2-Messlauf vorher/nachher dokumentiert.
- [ ] **T63.9** `docs/design-system.md` um Leitern, Datei-Regel und Ratchet-Tests ergänzen; Abnahme + Retro (Skill `retro`).

Jede Aufgabe: eigener Branch `feat/p63-t<n>-…`, `npm run gate`, PR nach `main`.
Reihenfolge T63.0 zuerst (Messung vor Änderung), T63.8 zuletzt (größtes Risiko).

## 5. Acceptance Criteria

- **AC-P63-1:** `css-tokens.test.ts` grün mit 0 undefinierten Tokens, 0 Hex/RGB außerhalb `01-base.css`, 0 Fallback-Werten.
- **AC-P63-2:** Light- und Dark-Theme-Screenshots von Diff-Review, Dateien-Schublade, Arbeitsort, Graph, Loops zeigen keine Fremdfarbe; Kontrast ≥ 4,5:1 (`tokens.test.ts`).
- **AC-P63-3:** Kein `z-index` außerhalb der Leiter; höchstens 4 Breiten-/Höhen-Breakpoints; keine `px`/`em`-Schriftgröße außerhalb `01-base.css`.
- **AC-P63-4:** Jeder Klassen-Selektor existiert in genau einer Datei; jede TSX-Klasse hat eine Regel oder steht auf der Allowlist; `index.css` importiert alle Dateien mit eindeutigem Präfix.
- **AC-P63-5:** `fokus.spec.ts` grün auf Handy/Tablet/PC-Projekten; sichtbarer Ring auf jedem fokussierbaren Element.
- **AC-P63-6:** K2-Messlauf nach T63.8 nicht schlechter als vorher (Protokoll in `docs/`).
- **AC-P63-7:** `funktionsinventar.spec.ts` unverändert grün — kein Funktionsverlust.

## 6. Premortem

1. **Zusammenführen von Selektoren ändert die Kaskade und bricht Layouts still.** Mitigation: T63.5 nur mit Playwright-Screenshot-Vergleich (`toHaveScreenshot`) der betroffenen Ansichten vor/nach; pro PR höchstens fünf Selektoren.
2. **Ratchet-Tests werden mit Allowlist-Einträgen umgangen.** Mitigation: Allowlist nur für Präfixe dynamischer Klassen, jeder Eintrag mit Kommentar und Datei-Verweis; Retro prüft Allowlist-Wachstum.
3. **`SessionTail`-Zerlegung verschlechtert K2 (Re-Render-Kaskade).** Mitigation: Messlauf vorher als Pflicht in T63.0-Nähe; Props-Identität mit `useMemo` beibehalten; bei Verschlechterung Zerlegung zurücknehmen, Epic trotzdem abschließbar (T63.8 optional markiert).
4. **Globaler Fokus-Ring kollidiert mit Overlays/Popouts (`overlay-focus.ts`).** Mitigation: Ring nur `:focus-visible`, nie `:focus`; `fokus.spec.ts` testet Overlay-Öffnen/Schließen und Popout-Fenster.
5. **Parallel laufende P61/P62 berühren dieselben TSX-Dateien.** Mitigation: Aufgaben, die TSX ändern (T63.6, T63.7, T63.8), nach Absprache in Reihenfolge; CSS-only-Aufgaben zuerst.

## 7. Definition of Done

- `npm run gate` lokal grün; GitHub-Actions-Lauf (`verify`, `k8`, `e2e`) auf dem Abschluss-PR grün; rote CI allein wegen Umgebung wird benannt, nie als Pass gezählt.
- Jede neue UI-Funktion/jeder Ablauf mit Spec in `e2e/specs/` (`themes.spec.ts`, `fokus.spec.ts`).
- AC-P63-1…7 mit Beleg in der Retro-Tabelle; BUG-0177 geschlossen.
- `docs/design-system.md` beschreibt Leitern und Ratchet-Tests; `docs/funktionsinventar.md` unverändert oder mit begründeter Änderung.
- Erreichbarkeit: Ratchet-Tests laufen in `npm test` (nicht nur lokal).
