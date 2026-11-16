# ADR-0062 — Repo-Graph: Dateibeziehungen als Contract und erweiterte Popout-Ziele

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/graph/`,
`packages/core/src/modules/graph/`, `apps/hub/src/modules/graph/`,
`apps/pwa/src/features/graph/`, `apps/pwa/src/features/windows/protocol.ts`, EPIC-P48 (Auftrag 10.11.2026)

## Kontext

Der Nutzer will sehen, wie gut ein Repo verdrahtet ist: Dateien als Knoten,
Import-/Verweisbeziehungen als Kanten, tote Dateien erkennbar, Dateien mit
Diagnose-Fehlern rot — pulsierend im Chat-Fenster, herauslösbar wie der Chat.
Im Hub existiert kein Import-Scanner (geprüft 10.11.2026); P46 liefert
Tree/Range/Raw und trust-geprüfte tsc/JSON-Diagnosen. Das Fensterprotokoll
(ADR-0053) kennt nur Session- und Tool-Seiten als Ziele — Datei-Tabs lassen
sich nicht herauslösen (offener Rest aus T46.8).

## Entscheidung

1. **Graph-Contract additiv** in `packages/contracts/src/graph/graph.ts`:
   `GraphReport` (Knoten mit Gruppe/Grad/Einstiegs-Heuristik, Kanten mit Art,
   ehrliche `meta`-Zahlen inkl. `truncated`), `GraphDiagnosis` (Quellen mit
   je ehrlichem Zustand, Fehlerzählung je Datei) und `graphGroupOf()` als
   eine Quelle der Wahrheit für Hub und PWA. Keine Änderung an Adapter-/
   Event-/Worker-Verträgen; der Graph ist eine HTTP-Antwort, kein
   Adapter-Event (K5 greift nicht — Byte-Budget trotzdem begrenzt).
2. **Aufzählung über git**: `git ls-files --cached --others
   --exclude-standard` (Arbeitsstand: tracked + untracked, ignoriertes und
   `node_modules`/`dist` fallen über .gitignore raus); Fallback: readdir-Walk
   mit festen Ausschlüssen (`.git`, `node_modules`, dataDir), in `meta`
   benannt. Caps: `GRAPH_MAX_FILES = 4000` Knoten, `GRAPH_SCAN_MAX_BYTES =
   512 KiB` pro Datei für die Kantensuche (größere zählen als Knoten ohne
   ausgehende Kanten). Überschreitung → `meta.truncated`, nie still gekürzt.
3. **Kanten sind Verweise, keine Semantik**: relative `import`/`export …
   from`/`require`/dynamische Imports (TS/JS-Familie), Markdown-Links und
   Referenz-Links, CSS `@import`/`url()`, HTML `src`/`href`, Python-Importe
   best effort (relative Pfade). Auflösung mit Erweiterungs- und
   `index.*`-Probe; unauflösbare Spezifikatoren erzeugen keine Phantomknoten,
   sondern zählen in `meta.unresolved`. Kein ts-morph/Madge, kein Parser-Bau —
   Regex gegen den Quelltext, als „Verweis“ deklariert.
4. **Diagnose-Überlagerung nur auf Anfrage**: `POST /api/graph/diagnose`
   läuft tsc **einmal pro tsconfig** (Wiederverwendung von Locks/parseTsc aus
   dem Diagnose-Modul, trust-geprüft wie P46: ohne Freigabe Zustand
   `untrusted`, tsc startet nicht) plus JSON-Syntax über alle JSON-Knoten.
   Zustände ehrlich wie P46; Lint ist nicht konfiguriert und wird nie als
   Fehlerfreiheit gezeigt. Kein Ergebnis-Caching (expliziter Klick, tsc-Lock
   serialisiert).
5. **Zielwahl und Schutz wie Code-Routen**: `session=` (Worktree via
   `workdirOf`) oder `project=` (nur innerhalb `projectRoots`), realpath-
   Containment, `.git` gesperrt, dataDir ausgeschlossen (BUG-0014-Muster).
   `GET /api/graph` und die Diagnose folgen der Code-Routen-Policy; Remote/
   Fleet ist bewusst nicht fleet-routbar (lokal zuerst, wie Diagnosen).
6. **Popout-Ziele additiv (ADR-0053-Erweiterung)**: `WindowTarget` wächst um
   `{kind:"graph", sessionId, hostId?}` und `{kind:"file", sessionId, hostId?,
   path}` mit eigenen Hash-Routen (`#/sessions/<id>/graph`,
   `#/sessions/<id>/datei/<path>`). Popout-Fenster laden ihre Daten selbst per
   HTTP (bestehendes Muster); Kanal, Token-außerhalb-der-URL und TTL bleiben
   unverändert. Alte Hashes bleiben auflösbar. Damit geht der offene
   Popout-Rest aus P46 T46.8 (Datei-Tabs herauslösen) hier auf.

## Alternativen

- **ts-morph/Madge für exakte AST-Kanten**: zusätzliche schwere Dependency,
  falsches Gefühl von Exaktheit für md/css/html ohnehin nicht erreichbar —
  abgelehnt; Upgrade-Pfad bleibt offen (Contract ändert sich nicht).
- **Graph als Adapter-Event streamen**: kein Adapter beteiligt, K5-Limit
  (4 KB) ungeeignet — HTTP-Antwort mit Caps ist richtig.
- **tsc pro Knoten**: N × bis 120 s für einen Klick — stattdessen einmal pro
  tsconfig mit bestehendem Lock.
- **Eigene Diagnose-Pipeline**: würde P46-Zustände duplizieren — Wiederverwendung.

## Folgen

- Der Graph zeigt den Arbeitsstand, nicht HEAD; Commits ändern ihn nicht
  sofort. Kanten sind Verweise (ein Kommentar-Import erzeugt eine Kante) —
  deklariert, nicht versteckt.
- Große Repos werden sichtbar gekappt (`truncated`); die PWA zeigt das Banner.
- K7 unberührt: Graph/Diagnose sind zustandslos, nichts wiederherzustellen.
- P48 dokumentiert die Übernahme des T46.8-Popout-Rests in EPIC-P46 nach.
