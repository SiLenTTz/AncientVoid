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

## Nicht Teil dieses Stands (EPIC-P46 bleibt offen)

- **T46.1** Monaco-Spike und Bundle-/RAM-Budgets; **T46.7** Syntaxfarben,
  Go-to, Diagnosen (JSON, TS/JS, Python) samt Fehlerliste — der Viewer zeigt
  Klartext und behauptet keine Fehlerfreiheit.
- **T46.6-Rest:** Markdown/Mermaid/HTML-Preview, JSON/CSV-Struktur, Notebook,
  Office, Archive. Für alles Nicht-Gerenderte gelten Text/Hex/Download.
- **T46.8** P36-Quellenpaket, Offline-Bereichsstatus; **Remote-Hosts:** `/api/code`
  ist nicht in `FLEET_ROUTABLE`; Dateien anderer Hosts sind noch nicht
  erreichbar (Sidebar bietet nur lokale Sessions/Projekte an).
- **Pixel-Abnahme** und K2/K8-Messungen mit vielen Dateien.

## Folgen

- Contract-Erweiterung additiv; `CodeFile`-Clients unberührt.
- Revalidierung per Polling kostet einen `readdir`+`git`-Aufruf je geöffnetem
  Ordner alle 5 s nur bei sichtbarem Tab; ein späterer Watcher kann es ersetzen.
