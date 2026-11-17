# BUG-0196 — PWA zeigt unter Windows den vollen Projektpfad statt des Projektnamens

- **Status:** done
- **Schicht:** pwa (Karten, Session-Kopf, Kacheln, Discovery, Dateien, Git, Medien, Nyx, Fenster, Statusleiste)
- **Schwere:** S2 — auf jedem Windows-Hub sichtbar. Statt `alpha` steht
  `C:\Users\<name>\…\projects\alpha` auf jeder Karte, inklusive Benutzername.
  Das ist unleserlich und gibt in Screenshots den Heimatpfad preis.

## Beobachtung

Fund beim Aufnehmen der README-Bilder am 17.11.2026, Windows 11, Demo-Hub
(`e2e/support/hub.ts`, Projekte unter `%TEMP%`). Auf Desktop- und Tablet-Karten
stand `<Rechner> · C:\Users\<name>\AppData\Local\Temp\ancientvoid-e2e-…\projects\alpha · claude`,
im Kachelkopf derselbe Pfad abgeschnitten. Unter Linux steht dort `alpha`. Die
Rohbilder wurden gelöscht und nie committet.

## Ursache

Der Hub meldet `session.project` als absoluten Pfad seines Betriebssystems.
Die PWA leitete den Anzeigenamen an 20 Stellen mit `project.split("/").pop()`
ab, z. B. `apps/pwa/src/features/overview/Dashboard.tsx:93` und
`apps/pwa/src/features/session/SessionTail.tsx:965`. Ein Windows-Pfad
enthält kein `/`, also blieb der ganze Pfad übrig. Gleiches Muster wie
[BUG-0175](bug-0175-projektfilter-vergleicht-slash-pfade.md) im Core.

## Fix

Neue gemeinsame Funktion `apps/pwa/src/shared/project-name.ts`
(`projectName`, `projectTail`), die an `/` und `\` trennt und abschließende
Trenner ignoriert. Alle Projektpfad-Stellen nutzen sie, und die zwei lokalen
Kopien (`Dashboard.tsx`, `discovery/groups.ts`) sind entfernt. Repo-relative
Dateipfade (Suche, Galaxie, Routen) bleiben unverändert, denn der Hub liefert
sie mit `/`.

**Hub-Seite:** Eine zweite Aufnahme zeigte den Pfad weiter, nach einer
Freigabe in der Benachrichtigung. Dieselbe Ursache saß in Core und Hub:
`notifications.ts:15` (Benachrichtigungs- und Web-Push-Titel, also auch auf
dem Sperrbildschirm des Handys), `approval-flow.ts:59` (Start-Freigabe),
`session-manager.ts:1011` (Manifest-Freigabe), `commands/resolve.ts:15`
(„Starte … in Projekt X“ fand unter Windows kein Projekt),
`factory.routes.ts:71` (Lauf-Label) und `stt.routes.ts:51`
(STT-Vokabular). Dort steht jetzt die Standardbibliothek: `win32.basename`
trennt an `/` und `\` und ignoriert Endtrenner.

Bewusst nicht Teil dieses Fixes sind Stellen mit Dateipfaden statt
Projektnamen (`discovery/codex.ts:147`, `graph/scan.ts`,
`adapter-claude-clip`). Sie sind eigene Prüffälle für Windows.

## Beleg

- `apps/pwa/test/features/discovery/groups.test.ts`: „names Windows project
  paths by their last segment“. Rot vor dem Fix (Gruppenname
  `C:\Users\demo\repos\website`), grün danach.
- `apps/pwa/test/shared/project-name.test.ts`: POSIX, Windows, UNC, gemischte
  Trenner, abschließende Trenner, leere Eingabe.
- `packages/core/test/modules/notifications/windows-project-name.test.ts`:
  Titel „alpha · Session unterbrochen“. Rot vor dem Fix (voller Pfad im
  Titel), grün danach.
- Live: Die README-Demoaufnahme (`scripts/readme-demo.mjs`) prüft vor jedem
  Bild den sichtbaren Text gegen Rechnername, Benutzer- und Home-Pfad. Sie
  schlug zweimal an (Karten, dann Benachrichtigung) und läuft mit beiden Fixes
  durch.
- Kein E2E-Fall: Die E2E-Suite läuft auf Linux-Runnern mit POSIX-Pfaden und
  könnte den Windows-Fall dort nicht zeigen. Der Beleg liegt deshalb auf
  Unit-Ebene an der gemeinsamen Funktion.
