# EPIC-P34 — Arbeitsfläche: klare Navigation, schöne Einstellungen, bessere Session-Erkennung, eigene Fenster

**Status:** Planungsentwurf vom 06.11.2026, Umsetzung nicht gestartet · **Phase:** P34 · **Dauer:** 2–3 Agenten-Wochen · **Abhängigkeit:** fachlich keine; baut auf P18 (Kacheln), P20 (Zoom, Einstellungen), P22/P24 (Erkennung), P23 (Desktop-Navigation). Präzedenz wie P13/P14/P17–P23: eigenständiges UI-Epic neben der Kette P29 → P33. **Der Start braucht Jans ausdrückliche Freigabe**, weil P29 noch läuft und P33 nicht abgeschlossen ist; die Freigabe wird hier mit Datum eingetragen.

Auslöser: Wunsch von Jan vom 06.11.2026.

> Voice im Side-Menü ist überflüssig, Medien gehört ins Side-Menü, PC in die Einstellungen. Die Einstellungen sehen unschön aus: bessere Struktur, symmetrischer, einfach zu nutzen. Akzentfarbe per Modal wie in GIMP, Schriftgröße und -art mit direkter Vorschau. Die Session-Erkennung funktioniert nicht wirklich gut und wirkt unsymmetrisch und gestaucht. Einzelne Chat-Kacheln als neue Fenster aus der App ziehen, um mehrere Bildschirme in Sessions und Tools zu verwandeln.

## 1. Ziel

Die Navigation enthält nur noch, was gebraucht wird. Einstellungen und Erkennung nutzen am Desktop die volle Fläche und folgen einem einheitlichen, symmetrischen Raster. Akzentfarbe, Schriftart und Schriftgröße sind pro Gerät wählbar und sofort sichtbar. Die Erkennung zeigt die echten Projekte statt Rauschen und findet auch Codex und Hermes. Jede Session und jedes Werkzeug kann als eigenes Fenster auf einen anderen Bildschirm wandern und wieder zurück.

Messlatten: K1 (Freigabe auch im eigenen Fenster), K2 (flüssiger Tail über mehrere Fenster), K7 (Fensterzustand nach Reload wiederherstellbar), K8 (Hub-Last bleibt im Rahmen), K9/R9.7 (nichts still verwerfen, unbekannt statt geraten), K10 (Schriften und Farben auch offline).

### Ist-Aufnahme (`origin/main` 69f834b, 06.11.2026)

Die Befunde stammen aus dem Code und aus Zählungen auf diesem Rechner. Screenshots aus der laufenden App fehlen noch und entstehen in T34.2 als Vorher-Beleg.

| Thema | Befund | Beleg |
|---|---|---|
| **Gestaucht (Hauptursache)** | Am Desktop rendert `App` alle Seiten in der Listenspalte: Einstellungen, Entdeckt, Medien, PC und Status haben höchstens 420 px, daneben bleiben die Kacheln. Das Problem ist also zuerst das Layout, nicht nur das Styling. | `main.tsx` (`aside.split-list`), `.split` in `02-layout.css` |
| Navigation | `GlobalDock` wird nur von `App` gerendert und ist auf dem Handy die untere Leiste, am Desktop die linke. Eine Änderung wirkt also auf beide. Voice öffnet dort das globale Sheet; die Voice-Taste im Composer der Session ist davon getrennt. | `Dock.tsx`, `App.tsx`, `SessionTail.tsx` |
| Einstellungen | Vier lose Karten nacheinander, nur eine mit Überschrift; Schalter als Knopf mit „an“/„aus“; Inhalte ohne Zusammenhang gemischt. | `Settings.tsx`, `App.tsx` |
| Akzentfarbe | Gute Ausgangslage: Das CSS nutzt `var(--accent)` und `color-mix`, kein fest verdrahtetes Amber außerhalb der Token-Definition. `--accent-ink` muss aber zur gewählten Farbe passen. | `01-base.css`, `git grep` |
| Schriftart | Der Fließtext verwendet `--font-mono`, dasselbe Token wie Code und Diff. Eine proportionale Schrift würde also auch Diffs zerstören. Die Schriften kommen von Google Fonts; das widerspricht local-first und K10. | `01-base.css`, `17-code.css`, `index.html` |
| Schriftgröße | 135 feste `font-size: …px` im CSS und 25 inline in TSX, kein einziges `rem`. Einfaches Ändern der Wurzelgröße wirkt deshalb nicht. Der vorhandene Zoom skaliert per CSS `zoom` das ganze Layout, also auch Abstände. | `app/styles/*`, `ui-scale.ts` |
| Erkennung: Rauschen | 122 von 165 Claude-Projektordnern liegen unter `/tmp`, davon 108 `harnez-exec-*`-Kopien mit zusammen 125 Transkripten. | Zählung `~/.claude/projects` |
| Erkennung: falsche Gruppen | Der Ordnername wird nur per exaktem Treffer auf bekannte Projekte zurückübersetzt. 16 Worktree-Ordner erscheinen deshalb als eigene Projekte mit langem Rohnamen. Dabei steht `cwd` in den Transkriptzeilen. | `unMungeProject`, `groups.ts`, Stichprobe |
| Erkennung: Lücken | Es gibt keine Quelle für Codex (55 Rollouts auf diesem Rechner) und Hermes (`~/.hermes/sessions` vorhanden). P22 hatte beides bewusst ausgelagert. | `apps/hub/src/main.ts`, P22 §2 |
| Erkennung: Karte | Ungleiche Höhen, weil Vorschau, Chips und Aktionen je nach Status fehlen; die volle ID liegt als Chip im Blickfeld; `Spiegeln` steht außerhalb der Aktionszeile. | `Discovery.tsx` |
| Kachel-Zustand | `Workspace` ist reine, getestete Logik, „mehrere Browserfenster synchron halten“ war in P18 ausdrücklich Out. | `tiles.ts`, P18 §2 |

## 2. Scope (In / Out)

**In:**
- Voice aus dem `GlobalDock`, Medien ins `GlobalDock`, PC in die Einstellungen, Kopfzeile entschlackt.
- Werkzeugfläche am Desktop: Einstellungen, Entdeckt, Medien, PC und Status nutzen die Detailspalte.
- Einstellungen neu: feste Gruppen, gemeinsames Zeilenraster, echte Schalter.
- Akzentfarbe mit Farbwähler-Modal nach GIMP-Art, Schriftart und -größe mit Live-Vorschau, alles pro Gerät und je Theme, selbst ausgelieferte Schriften.
- Erkennung: Gruppierung nach echtem Projekt, Rauschfilter, Scanner für Codex und Hermes, neues Kartendesign.
- Eigene Fenster: Session (samt Reiter Chat/Diff/Code/Bericht) und Werkzeugseiten; Knopf, Ziehgeste und Rückkehr; Wiederherstellen nach Reload.
- `docs/design-system.md` um die neuen Bausteine und Tokens ergänzen.

**Out:**
- Komplettes Redesign anderer Seiten (die neuen Bausteine dürfen später wandern).
- Freie Theme-Editoren für Status-Farben: `--ok`, `--warn` und `--err` bleiben semantisch fest.
- Synchronisierung der Darstellung zwischen Geräten: sie bleibt eine Gerätevorliebe wie Theme und Zoom.
- Eigene Schriftdateien hochladen.
- Native Desktop-App (Electron/Tauri) oder Fenster auf anderen Rechnern.
- Mehr als vier Kacheln je Fenster; eigene Fenster auf Handy oder Tablet unter 1280 px.
- Transkript-Volltextsuche in der Erkennung (wie P22).
- Entfernen der Voice-Taste im Composer und des Voice-Sheets innerhalb einer Session.

## 3. Design-Details

### 3.1 Navigation (T34.1)

```text
Vorher  Dock: Übersicht · Neue Session · Entdeckt · Voice · Einstellungen
        Kopf: ✦ · Medien · PC · Status · ●
Nachher Dock: Übersicht · Neue Session · Entdeckt · Medien · Einstellungen
        Kopf: ✦ · Status · ●
```

Medien übernimmt den Platz von Voice, die untere Leiste am Handy behält also fünf Einträge. Die Hash-Routen `#/medien` und `#/pc` sowie die Sprachbefehle in `commands/parse.ts` bleiben bestehen, damit Lesezeichen und „öffne PC“ weiter funktionieren. PC wird in den Einstellungen unter „Geräte“ eingebettet. Das globale `VoiceSheet` in `App.tsx` entfällt samt `onVoice`; `navigation.spec.ts` wird angepasst, die Composer-Tests bleiben unverändert.

### 3.2 Werkzeugfläche am Desktop (T34.2)

```text
┌─Rail─┬─Liste (bis 420 px)─┬─Detail──────────────────────────┐
│  ⌂   │ Sessions           │ Einstellungen               [×] │
│  +   │ …                  │ volle Breite, Kacheln bleiben   │
│  ⌕   │                    │ darunter gemountet              │
└──────┴────────────────────┴─────────────────────────────────┘
```

Ab 1280 px zeigt die Detailspalte die Werkzeugseite, die Liste bleibt die Sessionliste. **Die Kacheln werden nur verborgen, nicht ausgehängt**, sonst würden WebSockets neu verbinden und ungesendete Entwürfe flackern. `×`, Esc, Zurück oder das Öffnen einer Session schließen die Fläche. „Neu“ und „Freigaben“ bleiben vorerst in der Liste, damit sich der K1-Weg nicht ändert. Das Handy bleibt unverändert.

### 3.3 Einstellungen (T34.3)

Am Desktop zwei gleich breite Spalten, am Handy eine. Jede Gruppe ist eine Karte mit Überschrift. Alle Zeilen teilen sich dasselbe Raster: links Titel und einzeiliger Hinweis, rechts das Bedienelement in fester Breite und rechtsbündig. Neue Bausteine: `SettingsSection`, `SettingRow`, `Switch`.

```text
┌ Darstellung ───────────────────┐  ┌ Geräte ────────────────────────┐
│ Theme            [Dunkel|Hell] │  │ PC-Eingabe          verbunden ›│
│ Akzentfarbe           [■ #…] › │  │ Benachrichtigungen        [ ●] │
│ Schriftart     [JetBrains Mono]│  │ Pinch-Zoom                [ ●] │
│ Schriftgröße      [−] 100 % [+]│  ├ Flotte ────────────────────────┤
│ Zoom              [−] 100 % [+]│  │ Hosts                        3 ›│
│ Schimmer Kontextleiste    [● ] │  ├ Dienste ───────────────────────┤
├ Vorschau ──────────────────────┤  │ Gemini                  aktiv ›│
│ Mini-Chat mit Akzent und Code  │  ├ Sicherheit & Verbindung ───────┤
│                                │  │ Passkey · Token · Adresse      │
└────────────────────────────────┘  └────────────────────────────────┘
```

Die Vorschau bleibt am Desktop beim Scrollen sichtbar. Längere Inhalte (Flotte, Push-Geräte, PC-Einrichtung) klappen innerhalb ihrer Gruppe auf, statt das Raster zu sprengen. „Auf Standard zurücksetzen“ gilt nur für die Darstellung.

### 3.4 Darstellung als reiner Zustand (T34.4)

`apps/pwa/src/app/appearance.ts` folgt dem Muster von `theme.ts` und `ui-scale.ts`: Parsen und Validieren sind rein und getestet, Anwenden passiert vor dem ersten Paint in `main.tsx`.

```ts
interface Appearance {
  accent: { dark: string | null; light: string | null }; // #rrggbb, null = Standard
  fontUi: FontId;
  fontCode: FontId;
  fontScale: number; // 0.85–1.3
}
```

- **Je Theme eine Akzentfarbe:** das dunkle Amber ist auf Weiß schlecht lesbar. Das Modal bearbeitet die Farbe des aktiven Themes.
- **`--accent-ink`** wird nach WCAG-Kontrast berechnet (dunkel oder hell, was besser lesbar ist).
- **Fail loud:** Kaputte Werte im `localStorage` führen zum Standard. Kontrast unter 3:1 zu `--bg-elev` oder Nähe zu `--ok`/`--warn`/`--err` zeigt einen Hinweis, blockiert aber nicht.
- **Fenster-Sync:** Das `storage`-Ereignis überträgt Änderungen sofort in alle offenen Fenster (Voraussetzung für §3.8).

### 3.5 Farbwähler-Modal (T34.5)

Einfach, aber effizient wie in GIMP, ohne neue Abhängigkeit:

```text
┌ Akzentfarbe · Dunkel ─────────────────────┐
│ ┌───────────────────────┐ ┌─┐  Neu  ████  │
│ │                       │ │ │  Alt  ████  │
│ │  Sättigung/Helligkeit │ │H│             │
│ │            ○          │ │u│  H [ 29 ]°  │
│ │                       │ │e│  S [ 76 ]%  │
│ └───────────────────────┘ └─┘  V [100 ]%  │
│ Hex [#ff9a3c]   R [255] G [154] B [ 60]   │
│ ● ● ● ● ● ● ● ●  zuletzt: ● ● ● ●         │
│ ⚠ wenig Kontrast      [Abbrechen] [Übern.]│
└───────────────────────────────────────────┘
```

Fläche und Farbton-Leiste funktionieren mit Maus, Touch (Pointer Events) und Pfeiltasten. Die App färbt sich während der Auswahl live ein. „Alt“ per Klick oder Abbrechen und Esc stellen den Ausgangswert exakt wieder her; gespeichert wird erst beim Übernehmen. Die Umrechnung HSV/RGB/Hex ist rein und per Rundlauf-Test abgesichert. Fokus bleibt im Modal, am Handy ist es ein Vollbild-Sheet.

### 3.6 Schrift (T34.6)

**Token trennen:** neues `--font-ui` für Fließtext und Bedienung; `--font-mono` gilt nur noch für Code, Diff und Terminal. Standardwert von `--font-ui` bleibt JetBrains Mono, damit sich ohne Wahl nichts ändert.

**Zwei Auswahlfelder:** Oberfläche und Code. Jeder Eintrag ist in seiner eigenen Schrift gesetzt, die Wahl wirkt sofort. Kuratierte Liste, jeweils unter freier Lizenz gebündelt und damit offline verfügbar: JetBrains Mono, IBM Plex Mono, Inter, Atkinson Hyperlegible; dazu System-Sans und System-Mono ohne Download. Orbitron bleibt die Markenschrift und ist nicht wählbar. Der Google-Fonts-Link in `index.html` entfällt.

**Größe:** Alle 160 Fundstellen (135 CSS, 25 inline) gehen per Codemod auf `calc(Npx * var(--font-scale, 1))`; die Abstände bleiben fix. Eine mechanische Umstellung lässt sich getrennt prüfen, Standard 100 % muss pixelgleich bleiben. Felder behalten mindestens 16 px, damit Safari nicht beim Fokus zoomt (bestehende Regel in `01-base.css`). Schriftgröße und Zoom bleiben getrennte Regler: die Größe ändert nur Text, der Zoom alles.

### 3.7 Session-Erkennung (T34.7–T34.9)

**Daten zuerst, sonst wird nur das Falsche schöner:**

1. **Echtes Projekt:** `cwd` aus dem Transkript hat Vorrang vor dem Ordnernamen. Fehlt es, bleibt der Rohname sichtbar (R9.7).
2. **Worktrees bündeln:** Sessions aus `…/data/worktrees/<id>` und `git worktree`-Pfaden landen beim Hauptprojekt, mit Worktree als Nebeninfo. Unbekannt bleibt eigene Gruppe, nie geraten.
3. **Rauschen einklappen, nicht löschen:** Pfade unter `/tmp` und Fabrik-Kopien (`harnez-exec-*`) sowie Subagenten stehen standardmäßig in einer eigenen Gruppe „Temporär & Automatisch (n)“; der Zähler bleibt sichtbar, die Suche findet sie weiter. Subagenten hängen an ihrer Hauptsession statt als gleichrangige Karte.
4. **Codex und Hermes:** read-only Scanner nach dem Muster von `pi-family.ts`, jeweils mit Titel, Vorschau und `live`. Fortsetzen wird nur angeboten, wenn das Resume-Argument belegt ist (ADR-0036); sonst „nur beobachtet“. Unbekannte Formate erscheinen als `unsupported-format`.
5. **`live` prüfen:** das 90-s-mtime-Fenster gegen echte Fälle messen, falsche Treffer als Testfall festhalten.

Änderungen an `DiscoveredSession` brauchen ein ADR (Fortschreibung von ADR-0040).

**Kreative Vorschläge fürs Design** (alle mit vorhandenen Tokens, Leitstand-Charakter bleibt):

| Variante | Idee | Einschätzung |
|---|---|---|
| **A: Signal-Deck** (Empfehlung) | Kopf mit vier Kennzahl-Kacheln, die zugleich Filter sind; gleich hohe Karten im Raster, links eine Signalkante je Zustand, aktive Sessions pulsieren dezent. | Löst „unsymmetrisch“ direkt, passt zu Status-Glow, am Handy einspaltig |
| B: Zeitachse | Vertikale Spur nach Heute/Gestern/Woche, Karten hängen als Knoten daran. | Schön für „was lief zuletzt“, aber Projekte treten zurück |
| C: Radar | Live-Sessions als Punkte im Radar, darunter die Liste. | Maximaler Blickfang, wenig Nutzen und Risiko für K2 und Barrierefreiheit |

```text
┌──────────┬──────────┬──────────┬──────────┐   Variante A
│ ● LIVE 2 │ FORTSETZ.│ BEOBACHT.│ HUB      │   Kennzahlen = Filter
│          │       41 │       18 │        9 │
└──────────┴──────────┴──────────┴──────────┘
[⌕ Suchen …]   Claude · Codex · Hermes · pi · opencode
▾ AncientVoid · 12 · zuletzt vor 2 min
┌────────────────────┐ ┌────────────────────┐
┃ Titel, höchstens   │ │ Titel, höchstens   │   Alle Karten gleich hoch:
┃ zwei Zeilen        │ │ zwei Zeilen        │   Titel 2 / Vorschau 2 / Meta 1 /
┃ Letzte Nachricht … │ │ Letzte Nachricht … │   Aktionen 1, fehlende Teile
┃ claude · vor 1 min │ │ codex · vor 3 h    │   behalten ihren Platz.
┃ [Als Kopie forts.]⋯│ │ [Fortsetzen]      ⋯│
└────────────────────┘ └────────────────────┘
```

Status steht als Signalkante und kurzes Etikett, nie nur als Farbe. ID, Fork und Harness wandern ins `⋯`-Menü mit „ID kopieren“. Alle Aktionen liegen in derselben Zeile. Die Bewegung folgt `prefers-reduced-motion`. T34.9 startet mit einem klickbaren Mock zur Auswahl durch Jan; Variante A ist der Standard, falls keine andere gewählt wird.

### 3.8 Eigene Fenster (T34.10–T34.12)

**Bedienung:** Jede Kachel bekommt neben `×` ein `⧉` („in eigenem Fenster öffnen“); zusätzlich lässt sich die Kachel am Griff aus dem App-Fenster ziehen. In der Liste trägt die Session das Abzeichen „⧉ eigenes Fenster“; ein Klick darauf holt das Fenster nach vorn, statt die Session doppelt zu öffnen. Das Fenster bietet „In die App zurück“. Werkzeuge öffnen sich aus der Werkzeugfläche ebenso per `⧉`.

**Technik:**

- **URL:** `/?window=1#/sessions/<id>` beziehungsweise `#/hosts/<host>/sessions/<id>` und `#/status`. Damit wird die bestehende Hash-Route wiederverwendet. **Das Token steht nie in der URL**, es liegt bereits im gemeinsamen `localStorage`.
- **Schlanke Hülle:** `PopoutShell` rendert `SessionTail` oder die Werkzeugseite ohne Dock, Liste und Kachel-Tasten. Sie schreibt nie `ancientvoid.workspace` und nie den Hash des Hauptfensters.
- **Zustand:** `Workspace` bekommt `detached: TileRef[]`; `tiles.ts` bleibt rein, `parseWorkspace` akzeptiert alte Stände ohne das Feld.
- **Abstimmung:** `BroadcastChannel("ancientvoid.windows")` mit `hello`, `heartbeat`, `bye`, `focus`, `return`. Das Hauptfenster bleibt optional: Fenster laufen auch weiter, wenn es geschlossen wird, und melden sich beim nächsten Start wieder an.
- **`noopener` als Vorschlag:** Fenster mit Opener-Beziehung teilen sich meist den Haupt-Thread, ein voller Tail würde dann alle ausbremsen (K2). Ohne Fenster-Handle wird die Abstimmung ausschließlich über den Kanal geführt, und ein blockiertes Pop-up wird über ein ausbleibendes `hello` erkannt. Der Spike entscheidet das.
- **Entwürfe:** Die vorhandene Entwurfsablage gilt je Session; das Abzeichen verhindert zwei Composer auf derselben Session im Normalfall, das `storage`-Ereignis deckt den Rest.

**Vorab-Spike (T34.10), weil die Plattform die Geste begrenzt:**

| Frage | Risiko | Fallback |
|---|---|---|
| Popup nach langem Zug | `window.open` braucht eine frische Nutzeraktion; das Maus-Loslassen zählt nach Spezifikation nicht, und die Aktion vom Drücken läuft nach wenigen Sekunden ab | Fehlermeldung mit Knopf „Fenster öffnen“ an der Abwurfstelle |
| Hyprland/Wayland | Das Programm darf seine Fensterposition meist nicht setzen; `left/top` werden ignoriert und Koordinaten außerhalb des Fensters können fehlen | Ablage übernimmt der Compositor, Fensterregel dokumentiert; `⧉` funktioniert immer |
| Bildschirmwahl | Window-Management-API nur in Chromium und mit Berechtigung | Ohne Erlaubnis öffnet das Fenster am Standardplatz |
| Mehrere Fenster wiederherstellen | Normalerweise ein Popup je Klick | Leiste „3 Fenster wiederherstellen“ öffnet sie nacheinander |

Der Spike läuft in Chromium auf Hyprland (Jans System) und in Firefox. Sein Ergebnis steht im ADR, bevor die Ziehgeste gebaut wird. **Der `⧉`-Knopf ist die zugesicherte Funktion; die Ziehgeste kommt obendrauf, soweit die Plattform sie zulässt.**

## 4. Aufgaben

Ein Branch je Aufgabe. Reihenfolge: T34.1 und T34.2 zuerst, weil alle anderen auf der Fläche aufbauen. T34.7–T34.9 und T34.10–T34.12 können danach parallel laufen.

- [ ] **T34.1** Navigation: Voice aus dem Dock und globales `VoiceSheet` raus, Medien mit neuem Icon ins Dock, Kopfzeile bereinigen, PC-Zugang in die Einstellungen. Routen und Sprachbefehle bleiben. `navigation.spec.ts`, `desktop.spec.ts`, `media.spec.ts`.
- [ ] **T34.2** Werkzeugfläche am Desktop inklusive Vorher-/Nachher-Screenshots; Kacheln bleiben gemountet. Neuer Spec: WebSocket und Entwurf überleben das Öffnen der Einstellungen. Messlatte: K2.
- [ ] **T34.3** Einstellungen neu: Gruppen, Raster, `SettingsSection`/`SettingRow`/`Switch`; Fleet-, Push-, Gemini- und PC-Inhalte eingegliedert. Spec für Raster (gleiche Spaltenbreite am Desktop, einspaltig am Handy, kein horizontales Scrollen).
- [ ] **T34.4** `appearance.ts`: Zustand, Validierung, Kontrast, Anwenden vor dem ersten Paint, `storage`-Sync. Unit-Tests inklusive kaputter Werte.
- [ ] **T34.5** Farbwähler-Modal: Fläche, Farbton, Hex/RGB/HSV, Alt/Neu, Vorgaben, zuletzt benutzt, Tastatur, Abbrechen stellt exakt wieder her. Unit-Rundlauf plus E2E (Live-Farbe, Reload, beide Themes).
- [ ] **T34.6** Schrift: Token-Trennung (`--font-ui`), Schriftdateien bündeln und Google-Link entfernen, Codemod (160 Stellen), Auswahl und Größe mit Vorschau. E2E: Diff bleibt bei proportionaler UI-Schrift monospace; Offline-Lauf (K10); 100 % bleibt optisch gleich.
- [ ] **T34.7** Erkennung Daten: `cwd`, Worktree-Bündelung, Gruppe „Temporär & Automatisch“, Subagenten an der Hauptsession, `live` gemessen. ADR (Fortschreibung ADR-0040), Fixtures anonymisiert. Messlatten: K7, K9, R9.7.
- [ ] **T34.8** Scanner für Codex und Hermes, in `apps/hub/src/main.ts` registriert, Fixtures aufgezeichnet, anonymisiert und secret-gescannt. Resume nur mit Beleg (ADR-0036). Scan-Zeit mit den echten Mengen gemessen.
- [ ] **T34.9** Erkennung Design: klickbarer Mock, Wahl durch Jan, Umsetzung mit gleich hohen Karten, Kennzahl-Filtern, Provider-Chips, `⋯`-Menü. `discovery.spec.ts` erweitert.
- [ ] **T34.10** Fenster-Grundlage: Spike, ADR (Fensterprotokoll, `noopener`, Recovery), `PopoutShell`, `⧉`-Knopf für Kacheln und Werkzeuge, `detached` in `tiles.ts`, Abzeichen in der Liste, Rückkehr. E2E mit zwei Playwright-Seiten.
- [ ] **T34.11** Ziehgeste aus der Kachel im vom Spike belegten Umfang, Fallback sichtbar; optional Bildschirmwahl per Window-Management-API.
- [ ] **T34.12** Robustheit: Heartbeat und Absturzerkennung, Wiederherstellen nach Reload, blockierte Pop-ups melden, Offline-Verhalten. Messlauf K2 mit vier Fenstern (Skill `messlauf`), K1 im eigenen Fenster.
- [ ] **T34.13** Abschluss: `docs/design-system.md` ergänzen, `npm run gate`, Abnahme durch Jan am Desktop und am Pixel, Retro.

## 5. Acceptance Criteria

- **AC-P34-1:** Das Dock enthält auf Desktop und Handy Übersicht, Neue Session, Entdeckt, Medien, Einstellungen. Die Kopfzeile enthält weder Medien noch PC. PC ist aus den Einstellungen erreichbar, `#/pc` und `#/medien` funktionieren weiter, die Voice-Taste im Composer ebenfalls.
- **AC-P34-2:** Am Desktop nutzen Einstellungen, Entdeckt, Medien, PC und Status die volle Detailbreite. Beim Öffnen und Schließen baut keine Kachel ihre WebSocket-Verbindung neu auf, und ein angefangener Entwurf bleibt erhalten.
- **AC-P34-3:** Die Einstellungen zeigen die Gruppen aus §3.3 in zwei gleich breiten Spalten (ab 1280 px) und einspaltig am Handy; alle Bedienelemente einer Spalte fluchten; bestehende Funktionen (Passkey, Token, Push, Flotte, Gemini) sind weiter erreichbar.
- **AC-P34-4:** Der Farbwähler ändert die Akzentfarbe live per Fläche, Farbton und Hex/RGB/HSV. Abbrechen oder Esc stellt exakt den alten Wert wieder her; Übernehmen übersteht einen Reload; Dunkel und Hell behalten eigene Werte; Text auf der Akzentfläche erreicht mindestens 4,5:1; Status-Farben bleiben unverändert.
- **AC-P34-5:** Schriftart und -größe wirken sofort in der Vorschau und in der App. Code und Diff bleiben bei proportionaler UI-Schrift monospace. Die gebündelten Schriften laden offline, ohne Anfrage an einen Fremd-Host; 100 % ist optisch gleich zum Stand vorher.
- **AC-P34-6:** Fixtures mit Worktree, `/tmp`-Kopie und Subagent werden richtig eingeordnet: Worktree beim Hauptprojekt, Temporäres eingeklappt mit korrektem Zähler und per Suche auffindbar, nichts geht verloren. Ohne `cwd` bleibt der Rohname stehen.
- **AC-P34-7:** Codex- und Hermes-Sessions dieses Rechners erscheinen mit Titel oder ehrlichem „Ohne Titel“. Fortsetzen erscheint nur mit belegtem Resume; ein unbekanntes Format wird als solches angezeigt.
- **AC-P34-8:** Karten einer Zeile sind unabhängig vom Inhalt gleich hoch, bei 390, 1280 und 2560 px Breite ohne horizontales Scrollen; Status ist auch ohne Farbe erkennbar.
- **AC-P34-9:** `⧉` öffnet Session und Werkzeug in einem eigenen Fenster mit live laufendem Tail, das Token steht nicht in der URL. Die Kachel wird frei, die Liste zeigt das Abzeichen, ein Klick darauf öffnet keine zweite Instanz, und „Zurück“ legt die Session wieder in eine Kachel.
- **AC-P34-10:** Ein blockiertes Pop-up oder eine abgebrochene Ziehgeste verliert keine Kachel und meldet sich sichtbar. Ein abgestürztes Fenster gibt seine Session innerhalb von 10 s wieder frei.
- **AC-P34-11:** Nach einem Reload des Hauptfensters bleiben offene Fenster zugeordnet; nach einem Browser-Neustart bietet die App die Wiederherstellung an. Änderungen an Theme, Akzent und Schrift erreichen alle Fenster ohne Reload.
- **AC-P34-12:** Vier Fenster mit je 30 Events/s halten K2 ein (Messlauf abgelegt), eine Freigabe im eigenen Fenster hält K1 ein. Der bestehende K8-Lauf bleibt grün.
- **AC-P34-13:** Live-Abnahme durch Jan: Fenster auf einem zweiten Bildschirm unter Hyprland, Einstellungen und Erkennung am Desktop und am Pixel. **Bis dahin offen, nicht als grün zu zählen.**

## 6. Premortem

1. **Die Werkzeugfläche bricht bestehende Abläufe.** `App`-Seiten hängen an der Listenspalte; `onOpen`, Hash-Routen, P23-Markierung und BUG-0099 greifen ineinander. *Mitigation:* T34.2 kommt früh als eigener MR, Handy-Zweig bleibt unberührt, `navigation`, `workspace`, `handoff` und `discovery` sind Pflicht-Specs.
2. **Der Schrift-Codemod ändert unbemerkt das Layout.** 160 Stellen, feste Höhen in Dock und Kacheln, Handy-Regel für 16 px. *Mitigation:* Codemod als rein mechanischer Commit mit Standard 100 %, Vergleichs-Screenshots zentraler Seiten, Stichprobe bei 85 % und 130 %, Grenzwerte der Skala eng halten.
3. **Eine freie Akzentfarbe macht die App unlesbar oder täuscht Status vor.** Grün als Akzent sieht aus wie „working“, Rot wie ein Fehler. *Mitigation:* berechnetes `--accent-ink`, sichtbare Warnung, ein Klick zurück auf Standard, Status nie nur über Farbe (AC-P34-8).
4. **Die Ziehgeste funktioniert ausgerechnet unter Hyprland nicht.** Wayland und Popup-Regeln könnten sie verhindern. *Mitigation:* Spike vor dem Bau, `⧉` als Zusage, Fallback sichtbar; AC-P34-9 hängt nicht an der Geste.
5. **Mehrere Fenster bremsen sich aus oder laufen auseinander.** Gemeinsamer Haupt-Thread, doppelte Composer, Fenster überschreibt `workspace`. *Mitigation:* `noopener` nach Spike, `PopoutShell` schreibt nie den Workspace, Messlauf mit vier Fenstern als AC, Kanal mit Heartbeat statt Fenster-Handle.
6. **Verwaiste Fenster-Einträge nach Absturz.** Die Session bliebe dauerhaft als „eigenes Fenster“ markiert und wäre unerreichbar. *Mitigation:* Heartbeat-Timeout gibt frei; `detached` ist nur ein Hinweis und wird beim Start gegen echte `hello`-Antworten abgeglichen (K7).
7. **Die Erkennung versteckt etwas Wichtiges oder wird langsam.** Der Rauschfilter könnte echte Arbeit in `/tmp` verschlucken, 1 670+ Transkripte plus Codex und Hermes kosten Zeit. *Mitigation:* einklappen statt filtern, Zähler und Suche bleiben, Scan-Zeit in T34.8 gemessen, Cache nach mtime und Größe wie bei Claude.
8. **Falsches Fortsetzen bei neuen Scannern.** Ein geratenes Resume-Argument könnte fremde Sessions verändern oder doppelte Schreiber erzeugen. *Mitigation:* nur belegte Resume-Wege, sonst „nur beobachtet“; `blockedByLive` bleibt.
9. **Konflikte mit laufenden Branches.** P29 („mobiler Zugang“) und andere fassen ebenfalls die PWA an. *Mitigation:* kleine MRs je Aufgabe, jeweils frisch von `main`; der Codemod direkt vor dem Merge neu erzeugt statt rebased.

## 7. Definition of Done

- `npm run gate` grün, Pipeline-Job `e2e` grün; jede neue UI-Funktion und jeder Ablauf hat einen Spec in `e2e/specs/`. Fehlende Browser-Fähigkeiten skippen sichtbar und zählen nicht als Pass.
- ADRs für die Änderung an `DiscoveredSession` und für das Fensterprotokoll liegen vor.
- `docs/design-system.md` beschreibt neue Tokens und Bausteine; `npm run check:arch` bleibt grün.
- **Erreichbarkeit:** Farbwähler, Schrift, PC und Medien sind ohne URL-Kenntnis erreichbar; Codex- und Hermes-Scanner sind in `main.ts` registriert; der `⧉`-Knopf ist in jeder Kachel sichtbar.
- Messlauf K2 mit vier Fenstern abgelegt, K1 und K8 belegt, Hub auf der Flotte neu ausgerollt.
- Live-Abnahme AC-P34-13 durch Jan erfolgt, `epics/README.md` aktualisiert, Retro angehängt.
