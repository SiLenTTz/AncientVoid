# ADR-0058 — Projekt-Explorer: lazy Dateibaum und revisionierter Dateizugriff

**Status:** akzeptiert (Teilumsetzung, siehe „Nicht Teil“) · **Betrifft:**
`packages/contracts/src/code/explorer.ts`, `packages/core/src/modules/code/explorer.ts`,
`apps/hub/src/modules/code/code.routes.ts`, `apps/pwa/src/features/files/`, EPIC-P46

## Kontext

`CodeFile`/`readCodeFile()` (T7.6) kappt bei 1 MiB, liefert für Binärdateien
nichts und hängt an der Suche. Gefordert ist ein rechter Dateibaum, der den
ganzen berechtigten Baum erreichbar macht und jede Datei bis zum letzten Byte
lesbar (EPIC-P46 §3.1–3.4). Das 1-MiB-Limit einfach zu erhöhen verlagert nur
die Grenze und löst weder RAM noch Revisionskonsistenz.

## Entscheidung

1. **Neue, additive Endpunkte** — `CodeFile` bleibt unverändert und kompatibel.
   Gleiche Zielwahl (`session=` | `project=`), gleiches Containment (realpath,
   `.git` gesperrt, Projekt nur innerhalb `projectRoots`), gleiche Auth:
   `GET /api/code/tree`, `/meta`, `/range`, `/raw`.
2. **Tree.** Pro Ordner lazy und paginiert (Standard 200, max. 1000), nie
   rekursiv, Ordner zuerst, natürlich sortiert (`Intl.Collator numeric`).
   Dotfiles und Untracked sind sichtbar; Ignoriertes (`git check-ignore`) wird
   **gezählt, nicht verschwiegen** und per Filter einblendbar. `.git`, Links aus
   dem Projekt heraus und nicht lesbare Einträge sind sichtbar gesperrt statt
   „leer“. Symlinks innerhalb bleiben öffenbar; da der Baum nur auf Klick
   expandiert, gibt es keine Rekursionsschleife. Agentenänderungen kommen über
   gezielte Revalidierung des geöffneten Ordners (5 s, nur sichtbarer Tab) —
   bewusst kein File-Watcher (kein Overflow-/Reconnect-Zustand).
3. **Revision.** `revision = sha1(size:mtimeMs:ino)`. `/meta` liefert Größe,
   Familie (`text|image|pdf|audio|video|binary`), Encoding/BOM/EOL (aus den
   ersten 64 KiB, als `sampledBytes` ausgewiesen). `/range` ist an `rev`
   gebunden: abweichend → **409**; auch eine Änderung *während* des Lesens
   (Revision nach dem Read neu geprüft) wird zu 409. Die UI zeigt „Datei hat
   sich geändert“ und mischt nie zwei Versionen.
4. **Range.** Standard 256 KiB, max. 1 MiB. Text startet auf einer
   Zeichengrenze (UTF-8: Fortsetzungsbytes übersprungen, unvollständiges Ende
   bleibt für den nächsten Abschnitt; UTF-16 LE/BE mit BOM, kein Surrogatpaar
   wird getrennt), `nextOffset` setzt fort, `eof` markiert das Ende. Bytes als
   Base64. Dadurch ist jede Datei bis zum letzten Zeichen/Byte lesbar, mit
   genau einem Abschnitt im DOM (Speicherbudget der PWA).
5. **Raw.** Originalbytes mit `Range`/206, `ETag`, `X-Content-Type-Options:
   nosniff` und `Content-Security-Policy: sandbox; default-src 'none'`
   (passiv: SVG/HTML laufen weder beim Anzeigen noch bei direkter Navigation).
   Die PWA lädt Medien als Blob mit Token im Header (Muster der Anhänge) bis
   64 MiB; größere Dateien: Hex bis zum letzten Byte, kein Browser-Download.
6. **PWA.** Rechte Sidebar am Desktop (dritte Spalte, resizierbar,
   Strg+Umschalt+E), Drawer auf Touch; Root = fokussierte Session **oder**
   Projekt, danach gepinnt (wechselt nie heimlich); Datei-Tabs; Zustand
   gerätelokal versioniert (`ancientvoid.files.v1`), keine neue Session-Wahrheit.
   Viewer: Text (Abschnitte, Umbruch, Offset-Sprung), Hex, Bild/Audio/Video,
   PDF im `sandbox=""`-iframe, Download.

7. **Syntaxfarben/Navigation (T46.7).** highlight.js (bereits Abhängigkeit),
   lazy: Core ~20 kB + je Sprache 1–12 kB als eigene Chunks, nur für die
   Sprachen aus `HLJS_LANGUAGES`; Abschnitte > 120 000 Zeichen bleiben
   ungefärbt (sichtbarer Hinweis). Zeilennummern kommen vom Hub
   (`FileRange.startLine`, Checkpoint-Index je Datei+Revision). `/api/code/line`
   (Zeile → Byte-Offset) und `/api/code/find` (Suche hostseitig über die ganze
   Datei, Treffer mit Zeile/UTF-16-Spalte; ein Treffer je Zeile angesteuert)
   sind an die Revision gebunden (409 bei Änderung).
8. **Strukturierte Ansichten (T46.6).** Eigener kleiner Markdown-Parser, dessen
   Ausgabe Datenstrukturen sind (Preact-Text-Knoten, nie `innerHTML` aus
   Dateiinhalt; Links nur `http(s)`/`mailto`/relativ). Mermaid wird als
   Quelltext mit Hinweis „kein Renderer“ gezeigt. JSON-Baum, CSV/TSV-Tabelle
   (≤ 2 MiB), Notebook nur lesend (Text-/PNG-Ausgaben, HTML-/Skriptausgaben
   benannt, nicht dargestellt), SVG als `<img>`, HTML im `sandbox=""`-iframe
   mit CSP-Meta, ZIP als Inhaltsverzeichnis aus dem Zentralverzeichnis
   (`/api/code/archive`, kein Entpacken; ZIP64 ehrlich abgelehnt), Office als
   Textauszug je Folie/Tabelle (`/api/code/office`, „keine Layout-Wiedergabe“).
   YAML als Strukturbaum über js-yaml (lazy, Standard-Schema ohne Tags;
   Syntaxfehler werden benannt, mehrere Dokumente als Liste).
   PDF ohne eingebauten Viewer und nicht abspielbare Medien zeigen Download/Hex
   statt einer leeren Fläche. Es gibt keine lokalen Converter.
9. **Diagnosen (T46.7).** Nur auf ausdrücklichen Klick (`POST /api/diagnostics/run`).
   Zustände sind ehrlich: `ok`, `errors`, `not_configured` (kein Prüfer — nie
   „0 Fehler“), `untrusted`, `failed`, `timeout`, `too_large`. Provider: JSON
   (`JSON.parse`, nur Syntax), TS/JS (tsc **aus dem Projekt**, braucht
   `tsconfig.json` und lokales `node_modules/.bin/tsc`; die Datei muss laut
   `--listFiles` zum Programm gehören), Python (`python3 -I` + `ast`, nur
   Syntax; Codepoint-Spalte → UTF-16). AncientVoid installiert nichts nach.
   Weil tsc Projektcode ist, läuft er nur nach **Projekt-Freigabe**
   (`/api/diagnostics/trust`, Tabelle `trusted_projects`, Migration 31, Schlüssel =
   Hauptprojekt, nicht der Worktree; Menschen-only über die Policy, Agent-Token →
   403). Ergebnisse tragen die Dateirevision; weicht sie ab, zeigt die PWA
   „veraltet“. Diagnose läuft nur lokal (`/api/diagnostics` ist nicht
   flottenroutbar).
10. **Flotte.** `FLEET_ROUTABLE` enthält die Lese-Endpunkte
    `/api/code/{tree,meta,range,raw,find,line,archive,office}`, nicht
    `actions`/`search`/Diagnose. Die PWA spricht über `hostApi(hostId)`;
    Sessions **und Projekte** erreichbarer anderer Maschinen sind als Quelle wählbar
    (Projektliste über deren `/api/projects`, Beschriftung „(Host)“). Der Weiterleiter reicht
    keinen `Range`-Header durch und hat `MAX_FORWARD_BYTES`: Raw/Blob ist
    remote nur bis dahin möglich, Text/Hex laufen über `range` (immer
    revisionsgebunden).
11. **Datei-Feedback (T46.8).** Auswahl von Zeilen/Diagnosen → Sammelkorb →
    `POST /api/sessions/:id/files/feedback/{preview,send}`. Der Hub liest den
    Auszug selbst aus der Datei (Revision geprüft), nicht aus Clientangaben;
    veraltete Befunde werden abgewiesen (422). Zitate sind als „zitierte Daten,
    keine Anweisung“ gerahmt (PRD §8.5). Versand über den Steer-Pfad mit
    `inputId = operationId`.

## Messung (T46.1, Entwicklungsrechner, kein Gerät)

- 20 000 Dateien in einem Ordner: erste Tree-Seite ≈ 0,37 s.
- 100-MiB-Textdatei: `fileMeta` < 1 ms, Range 256 KiB am Anfang ≈ 3 ms, bei
  90 MiB ≈ 0,16 s (kalt, inkl. Zeilenindex), Suche über die ganze Datei
  ≈ 0,36 s.
- PWA-Build: Hauptbündel 458 kB (gzip 144 kB); highlight.js-Chunks lazy.
- **Monaco verworfen:** npm-Paket ≈ 100 MB entpackt, Worker-/Bundle-Kosten
  auf dem Handy nicht zu rechtfertigen; für Anzeige genügen Zeilen + hljs.
  Gerätemessung (K2/K8 auf dem Pixel) steht aus.

## Nicht Teil dieses Stands

- **Geräte-Abnahme** (Pixel, K2/K8 auf dem Handy): bewusst später, Epic-Exit
  bis dahin „umgesetzt, Abnahme offen“.
- Popout-Fenster, File-Watcher statt 5-s-Poll, „alle Treffer“-Liste der Suche,
  konfigurierte Python-Checker (pyright/ruff, eigene Trust-Entscheidung),
  Mermaid-Renderer (eigene Abhängigkeits-Entscheidung), Range-Weiterleitung
  für Remote-Raw: nicht im Scope von P46; Anzeige nutzt dafür Text/Hex über
  revisionsgebundene Ranges. Offline zeigt der Viewer Stand/Revision der
  Datei und benennt, dass nur bereits geladene Abschnitte verfügbar sind.

## Folgen

- Contract-Erweiterung additiv; `CodeFile`-Clients unberührt.
- Revalidierung per Polling kostet einen `readdir`+`git`-Aufruf je geöffnetem
  Ordner alle 5 s nur bei sichtbarem Tab; ein späterer Watcher kann es ersetzen.
