# EPIC-P50 — Zoom-robuste Flächen: Fenster scrollen nie, bei jedem UI-Zoom

**Status:** offen · **Phase:** P50 · **Dauer:** ~1 Agenten-Woche (grobe Schätzung)
**Abhängigkeit:** keine fachliche offene — Bugfix-Klasse quer zur Kette (Präzedenz P13/P14/P17). Basis sind die geschlossenen Zoom-Bugs BUG-0097/0098/0099/0102/0112 und die offenen BUG-0112-Vettern BUG-0113.

Quelle: Nutzermeldung vom 10.11.2026 („Im Chat-Fenster zwei Scrollbars; die für die
gesamte Seite dürfte nie da sein — explizit nur Listen, Chat und einzelne
Komponenten scrollen") und der Repo-Scan vom selben Tag: Das Muster
`calc(<dvh> / var(--ui-zoom, 1))` wurde nach jedem Zoom-Bug einzeln
nachgetragen (8 Stellen teilen korrekt), aber nie flächendeckend
verifiziert — 3 Stellen fehlen (BUG-0112 behoben, BUG-0113 offen), und die
meisten Flächen haben keinen E2E-Nachweis unter Zoom ≠ 100 %.

## 1. Ziel

Bei jedem UI-Zoom (70–200 %, EPIC-P20) und jeder Schriftgröße
(85–130 %, EPIC-P34) gilt die Nutzerregel durchgehend: **html/body und
jedes eigene Fenster scrollen nie** — nur Listen, Chatverlauf und
Einzelkomponenten (Schubladen, Panels, Modals, Composer) scrollen intern,
und jede fensterfüllende Fläche füllt das Fenster exakt (±1 px). Messlatte
K2 bleibt unberührt (Layout, kein Frame-Lag); die Regel selbst ist die
Qualitätsinvariante aus BUG-0097/0099/0102/0112.

## 2. Scope (In / Out)

**In:** Audit sämtlicher `dvh`/`vh`-Regeln mit Fensterbezug in
`apps/pwa/src/app/styles/` (heute: 02, 05, 10, 11, 14, 18, 21, 25, 27, 30,
31) gegen das Divisions-Muster; Fix BUG-0113 (Dateien-Schublade 85dvh,
Browser-Panel top 4dvh, `100vw`-Breite); harte Nicht-Scroll-Garantien
(`html:has(…) { overflow: hidden }`, BUG-0099-Nachtrag-2-Muster) für die
mobile Session-Hauptroute (`#app > .session-live`) und die Popout-Arten
Graph/Datei/Vault/Werkzeug/Browser (Session-Popout seit BUG-0112); eine
E2E-Zoom-Matrix, die die Invariante über Flächen × Zoomstufen sichert.

**Out:** Änderungen an der Zoom-Mechanik selbst (`ui-scale.ts`, EPIC-P20
bleibt), Nebenseiten-Neulayout (Einstellungen/Status/Medien als
Shell-Spalten — folgt mit P43 Arbeitsfläche/Styling, dort T43-Umfeld),
Desktop-Companion (P11), Pinch-Zoom-Verhalten.

## 3. Design-Details

### 3.1 Das Muster

Unter `html { zoom }` sind `100dvh`/`vh`/`vw` **Layout-Pixel** und werden
beim Rendern mit dem Zoom multipliziert. Korrekt (Stand 10.11.2026):
`02-layout.css:73/:202` (Dashboard-Shell, `.split`),
`10-voice-and-dock.css:115` (`.dock-stack`), `11-report-and-diff.css:298`,
`14-notifications.css:104 f.`, `18-commands.css:14 f.`,
`21-icon-rail.css:162`, `31-custom-models.css:18`. Fehlend:
`27-popout.css:5` (mit BUG-0112 behoben), `30-files.css:6` und `:87`
(BUG-0113, offen). Inhalte-`max-height` ohne Fensterbezug (z. B.
`max-height: 40vh` in Code-Vorschauen) bleiben ungeteilt zulässig, solange
der umgebende Container die Fensterinvariante hält.

### 3.2 Harte Garantien vor Messung

JS-Messung (`SessionTail.tsx` measure-Effect) bleibt für die Chat-Höhe
führend; die CSS-Garantie `overflow: hidden` auf `html`/`body` pro Route
macht die Nutzerregel aber von Mess-Rundungen unabhängig — ein Fehler von
±1 px führt zu Clipping statt Seiten-Scrollbar (beides falsch, aber nur
eines verletzt die Invariante sichtbar und fällt damit auf). Gilt bereits:
Dashboard (BUG-0099 Nachtrag 2), Session-Popout (BUG-0112). Neu: mobile
Session-Hauptroute; geprüft: Graph/Datei/Vault/Werkzeug-Popouts erben die
Popout-Regel.

### 3.3 E2E-Zoom-Matrix

Eine Spec (`e2e/specs/zoom-flaechen.spec.ts`), parametrisiert über
`ancientvoid.uiScale` ∈ {70, 100, 130, 200} und Flächen ∈ {Übersicht,
Session mobil, Session-Popout, Dateien-Schublade}: assert
`scrollingElement.scrollHeight <= clientHeight+1` und Shell-Unterkante ==
`window.innerHeight ± 1`. Vorbild: BUG-0097-Fall in
`session-scroll.spec.ts`, BUG-0112-Fall in `windows.spec.ts`.

## 4. Aufgaben (Checkliste T50.m)

- [ ] **T50.1** Audit: alle `dvh`/`vh`/`vw`-Regeln mit Fensterbezug tabellieren (Datei:zeile, geteilt/ungeteilt, Fläche); Tabelle in diesem Epic nachtragen. **Invariante BUG-0097/0112**.
- [ ] **T50.2** BUG-0113 fixen: `.files-sidebar.drawer` (85dvh) und `.browser-panel` (top 4dvh, `100vw`) durch `--ui-zoom` teilen; E2E rot-dann-grün (Schubladen-Kopf bei Zoom 130 % sichtbar). **Invariante**.
- [ ] **T50.3** Harte Garantie mobile Session-Hauptroute (`html:has(#app > .session-live)`, Nachtrag-2-Muster); Nachbarfälle (Verlauf-Filter, Queue, Approval) gegenprüfen. **Invariante**.
- [ ] **T50.4** E2E-Zoom-Matrix (3.3) bauen und einmal über alle Stufen fahren; Auffälligkeiten als Bugs anlegen (ein Verhalten = eine Datei). **K2-Rand, Invariante**.
- [ ] **T50.5** Dokumentation: Muster + Garantie-Regel in `docs/` festhalten (Verweis von `ui-scale.ts`-Kommentar), BUG-0113/0112-Status nachziehen. **Fail-loud/DoD**.

## 5. Acceptance Criteria (AC-P50-k)

- **AC-P50-1:** Bei uiScale 70/100/130/200 und fontScale 85/130 ist auf Übersicht, Session (mobil + Desktop-Kachel + Popout) und Dateien-Schublade `scrollingElement.scrollHeight <= clientHeight+1`; jede Shell-Unterkante liegt bei `window.innerHeight ± 1`.
- **AC-P50-2:** Die Audit-Tabelle (T50.1) ist vollständig im Epic dokumentiert; jede Zeile trägt Fix-Verweis oder Begründung, warum ungeteilt zulässig ist.
- **AC-P50-3:** BUG-0113 ist done mit rot-dann-grün-E2E; die Schubladen-Steuerleiste bleibt bei Zoom 130 % vollständig im Fenster.
- **AC-P50-4:** Die Zoom-Matrix läuft im Gate (mobile + desktop-Projekt) und deckt mindestens die Flächen aus 3.3 ab.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Divisions-Welle bricht Layouts ohne Zoom-Bezug** (Inhalts-Maxima wie `40vh` sind absichtlich ungeteilt) → T50.1 trennt Fensterfüller von Inhaltslimiten; nur Fensterfüller werden geteilt, jede Änderung einzeln verifiziert.
2. **`overflow: hidden` versteckt erreichbaren Inhalt** (Queue/Approval/Handover unter dem Dock) → Garantie nur auf Routen mit interner Scrollfläche; Nachbarfälle in T50.3 explizit gegengeprüft; Messung (BUG-0053-Floor 48 px) bleibt.
3. **Zoom-Matrix wird flaky** (runde Pixel, asynchrone Messung) → Toleranz ±1 px, assertions nach stabilem Zustand (Events geflossen), Vorbild session-scroll.spec; kein Retry, kein Skip.
4. **Neue Flächen (P43/P48-Reste) again ohne Teilung** → Muster in `docs/` + Verweis in `ui-scale.ts`; Zoom-Matrix als Pflicht-Erweiterung für jede neue fensterfüllende Fläche (DoD ab P43).

## 7. Definition of Done

Alle T50.* und AC-P50-* mit Evidenz. `npm run gate` grün (inkl.
`test:e2e`), PWA-Build grün; Zoom-Matrix-Spec in `e2e/specs/` neu.
BUG-0113 done, BUG-0112 verweist auf T50.4-Matrix. Muster-Doku in `docs/`
(flach) mit Verweis aus `ui-scale.ts`. Pipeline-Job `e2e` grün bzw. nach
`docs/ci-runbook.md` nachgezogen, nie als Pass gezählt. Kein TODO ohne
Epic-Bezug.
