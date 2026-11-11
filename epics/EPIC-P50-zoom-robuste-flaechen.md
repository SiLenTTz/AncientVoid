# EPIC-P50 — Zoom-robuste Flächen: Fenster scrollen nie, bei jedem UI-Zoom

**Status:** in Arbeit (T50.1–T50.5 umgesetzt, T50.6 offen) · **Phase:** P50 · **Dauer:** ~1 Agenten-Woche (grobe Schätzung)
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
`21-icon-rail.css:162`, `31-custom-models.css:18`. Fehlten:
`27-popout.css:5` (BUG-0112) und `30-files.css:6`/`:87` (BUG-0113) —
beide behoben; die vollständige Tabelle samt weiteren Befunden steht in §3.4. Inhalte-`max-height` ohne Fensterbezug (z. B.
`max-height: 40vh` in Code-Vorschauen) bleiben ungeteilt zulässig, solange
der umgebende Container die Fensterinvariante hält.

### 3.2 Harte Garantien vor Messung

JS-Messung (`SessionTail.tsx` measure-Effect) bleibt für die Chat-Höhe
führend; die CSS-Garantie `overflow: hidden` auf `html`/`body` pro Route
macht die Nutzerregel aber von Mess-Rundungen unabhängig — ein Fehler von
±1 px führt zu Clipping statt Seiten-Scrollbar (beides falsch, aber nur
eines verletzt die Invariante sichtbar und fällt damit auf). Gilt bereits:
Dashboard (BUG-0099 Nachtrag 2), Session-Popout (BUG-0112), seit T50.3 die
mobile Session-Hauptroute (`02-layout.css`); geprüft: Graph/Datei/Vault/Werkzeug-Popouts erben die
Popout-Regel.

### 3.3 E2E-Zoom-Matrix

Eine Spec (`e2e/specs/zoom-flaechen.spec.ts`), parametrisiert über
`ancientvoid.uiScale` ∈ {70, 100, 130, 200} und Flächen ∈ {Übersicht,
Session mobil, Session-Popout, Dateien-Schublade}: assert
`scrollingElement.scrollHeight <= clientHeight+1` und Shell-Unterkante ==
`window.innerHeight ± 1`. Vorbild: BUG-0097-Fall in
`session-scroll.spec.ts`, BUG-0112-Fall in `windows.spec.ts`.

### 3.4 Audit-Tabelle (T50.1, Stand 11.11.2026, Basis `efaa952`)

Vollständiger Scan: `rg '[0-9.]+(dvh|vh|vw)\b' apps/pwa/src/app/styles` plus Inline-Styles in `apps/pwa/src` (je Treffer eine Zeile; Kommentarzeilen ausgenommen). Spalte „Zoom“: **geteilt** = durch `var(--ui-zoom, 1)` geteilt; **zulässig** = ungeteilt mit Begründung; **Befund** = ungeteilt und fensterbezogen, Fix-Verweis. Größte Zoomstufe ist 200 % (`SCALE_MAX`) — jedes ungeteilte Maß **≤ 50 vh/vw** bleibt dabei ≤ 100 % des Fensters und ist deshalb ohne Teilung zulässig (Regel R50).

**A — Fensterfüller und fensterbegrenzte Flächen, geteilt (Muster erfüllt)**

| Datei:Zeile | Regel | Fläche | Zoom |
|---|---|---|---|
| `02-layout.css:73` | `.app-page:has(> .dashboard)` Höhe | Übersicht (Handy) | geteilt |
| `02-layout.css:211` | `.split` Höhe | Dashboard-Shell / PC-Kacheln | geteilt |
| `10-voice-and-dock.css:115` | `.dock-stack` max-height | Dock | geteilt |
| `11-report-and-diff.css:298` | `.diff-files` max-height | Diff-Dateiliste | geteilt |
| `14-notifications.css:19, :102, :104, :105` | Glocke/Panel `right`/`width`/`max-height` | Benachrichtigungen | geteilt |
| `18-commands.css:14, :15` | Befehlspalette Breite/Höhe | Befehlspalette | geteilt |
| `21-icon-rail.css:136` | `.split` Höhe − 28 px (Statusleiste) | PC-Shell | geteilt |
| `27-popout.css:8` | `.popout-shell` Höhe | eigenes Fenster | geteilt (BUG-0112) |
| `30-files.css:7` | `.files-sidebar.drawer` Höhe | Dateien-Schublade | geteilt (**T50.2**, BUG-0113) |
| `30-files.css:87` | `.browser-panel` `top` und `width` | Browser-/Geräte-Panel | geteilt (**T50.2**, BUG-0113) |
| `31-custom-models.css:18` | Dialog max-height | Eigene Modelle | geteilt |
| `41-tablet.css:62` | `.session-strip` max-height | Tablet-Streifen | geteilt |

**B — Befund: fensterbezogen und ungeteilt → [BUG-0122](../bugs/bug-0122-overlay-hoehen-ohne-ui-zoom-teilung.md)**

| Datei:Zeile | Regel | Fläche | Zoom |
|---|---|---|---|
| `05-composer.css:31–33` | `.composer.expanded` Eingabe `75vh`/`75dvh`, min `50vh` | Composer maximiert | Befund |
| `09-skill-picker.css:26` | Skill-Blatt `70vh` | Skill-Auswahl | Befund |
| `11-report-and-diff.css:515, :516` | `review-send-dialog` `92vw`/`85vh` | Review-Dialog | Befund |
| `12-search.css:139` | `.file-viewer` `85vh` | Datei-Blatt | Befund |
| `25-color-picker.css:30, :31` | `.color-dialog` `96vw`/`94dvh` | Farbwähler | Befund |
| `28-forge.css:205, :206` | `fp-trace-dialog` `94vw`/`85vh` | Forge-Trace | Befund |
| `16-fleet.css:14` | `.fleet-qr` `min(220px, 70vw)` | Fleet-QR | Befund |
| `26-discovery.css:265` | Hinweis `min(80vw, 320px)` | Entdeckt | Befund |
| `27-popout.css:151` | Schwebeleiste `min(92vw, 720px)` | Popout-Leiste | Befund |

Nicht in diesem Epic gefixt: jeder Fix braucht eine eigene Matrix-Zeile (§3.3), Premortem 1. Das Bündel ist als BUG-0122 offen.

**C — Inhaltslimits, ungeteilt zulässig**

| Datei:Zeile | Regel | Begründung |
|---|---|---|
| `02-layout.css:259` | `.split-placeholder` `margin-top: 30vh` | ≤ 50 vh (R50); reiner Abstand |
| `05-composer.css:17` | Eingabefeld `min(26rem, 60vh)` | im Dock; `.dock-stack` (10:115) hält die Fensterinvariante und scrollt selbst |
| `05-composer.css:160, :167` | Anhang-Vorschau `45vh` | ≤ 50 vh (R50) |
| `07-approvals.css:88` | `.tool-input` `30vh` | ≤ 50 vh (R50) |
| `07-approvals.css:116` | `.session-approvals` `55vh`, `overflow: auto` | im Dock; `.dock-stack` begrenzt (BUG-0098) |
| `08-session-events.css:137` | Select `max-width: 46vw` | ≤ 50 vw (R50) |
| `11-report-and-diff.css:534` | `40vh` | ≤ 50 vh (R50) |
| `12-search.css:168` | `scroll-margin: 40vh` | kein Layoutmaß |
| `16-fleet.css:30` | `50vh` | ≤ 50 vh (R50) |
| `17-code.css:199`, `22-loops.css:63`, `28-forge.css:181`, `40-turns.css:170` | `40vh` | ≤ 50 vh (R50) |
| `19-media.css:172` | `50vh` | ≤ 50 vh (R50) |
| `21-icon-rail.css:134` | `.status-focus` `45vw` | ≤ 50 vw (R50) |
| `28-forge.css:220` | Trace-Text `60vh`, scrollt | liegt im Trace-Dialog (Befund B hält die Fläche) |
| `30-files.css:43, :44, :84` | Medien/PDF/HTML `70vh`/`70vh`/`60vh` | in der scrollenden Schublade/Sidebar (30:7 geteilt) |
| `30-files.css:67` | `.diag-list` `30vh` | ≤ 50 vh (R50) |
| `33-vault.css:31`, `34-orchestration.css:38, :53` | `32vh`/`30vh`/`32vh` | ≤ 50 vh (R50) |
| `39-devices.css:9, :15` | Geräte-Bild `56dvh`, Baum `40dvh` | im `.browser-panel` (30:87 geteilt, `overflow: auto`) |
| `SessionTail.tsx:1010` | `max-height` Chat | geteilt durch `--ui-zoom`; Fallback `60vh` nur vor der ersten Messung |
| `main.tsx:78` | `margin-top: 20vh` | ≤ 50 vh (R50), Anmeldekarte |

## 4. Aufgaben (Checkliste T50.m)

- [x] **T50.1** Audit: alle `dvh`/`vh`/`vw`-Regeln mit Fensterbezug tabellieren (Datei:zeile, geteilt/ungeteilt, Fläche); Tabelle in diesem Epic nachtragen (§3.4). **Invariante BUG-0097/0112**. *Erledigt 11.11.2026: 12 geteilte Zeilen, 9 Befunde (BUG-0122), Rest zulässig nach Regel R50.*
- [x] **T50.2** BUG-0113 fixen: `.files-sidebar.drawer` (85dvh) und `.browser-panel` (top 4dvh, `100vw`) durch `--ui-zoom` teilen; E2E rot-dann-grün (Schubladen-Kopf bei Zoom 130 % sichtbar). **Invariante**.
- [x] **T50.3** Harte Garantie mobile Session-Hauptroute (`html:has(#app > .session-live)`, Nachtrag-2-Muster); Nachbarfälle (Verlauf-Filter, Queue, Approval) gegenprüfen. **Invariante**.
- [x] **T50.4** E2E-Zoom-Matrix (3.3) bauen und einmal über alle Stufen fahren; Auffälligkeiten als Bugs anlegen (ein Verhalten = eine Datei). **K2-Rand, Invariante**. *Erledigt 11.11.2026: `zoom-flaechen.spec.ts`, Zoom 70/100/130/200 × Schrift 85/100/130 über Übersicht, Session mobil, Kachel PC, Popout, Schublade, Browser-Panel — alle grün; die Garantie-Prüfung T50.3 ist ebenfalls dort.*
- [x] **T50.5** Dokumentation: Muster + Garantie-Regel in `docs/` festhalten (Verweis von `ui-scale.ts`-Kommentar), BUG-0113/0112-Status nachziehen. **Fail-loud/DoD**. *Erledigt 11.11.2026: [`docs/zoom-robuste-flaechen.md`](../docs/zoom-robuste-flaechen.md), Verweis aus `ui-scale.ts`; BUG-0113 done, BUG-0112 verweist auf die Matrix.*
- [ ] **T50.6** *(aus P43 AI-P43-4)* `breiten.spec.ts` auf Werkzeugseiten und Formulare ausdehnen; Querschnitts-Specs früh in Umbau-Aufgaben mitlaufen lassen. **K2**.

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
