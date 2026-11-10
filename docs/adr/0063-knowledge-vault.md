# ADR-0063 — Knowledge Vault: Notizen-Tab mit Ordnerwahl und Markdown-Editor

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/vault/`, `packages/core/src/modules/vault/`,
`apps/hub/src/modules/vault/`, `apps/hub/src/modules/code/code.routes.ts`,
`apps/pwa/src/features/vault/`, `apps/pwa/src/app/route.ts`, EPIC-P49 (Auftrag 10.11.2026)

## Kontext

Der Nutzer will Notizen (Knowledge Vault) in der App organisieren: neuer Tab in der
Seitennavigation, beim ersten Öffnen Zielordner wählen, neue Dateien anlegen (nur
`.md`), alle Dokumente sehen/anschauen, Markdown dort editieren und speichern,
Fenster herauslösbar. Der Hub hat bewusst **keinen** Datei-Schreibpfad (ADR-0058:
Projekt-Dateien read-only); Einstellungen leben im SettingsStore (SQLite), während
`projectRoots` eine Config-Datei mit Restart ist.

## Entscheidung

1. **Eigene, eng begrenzte Schreibfläche** `packages/core/src/modules/vault/`:
   Root wird im SettingsStore-Key `vault.root` gespeichert (sofort wirksam, kein
   Restart). Schreiben ausschließlich `.md`, ≤ 1 MiB, atomar via Temp-Datei +
   Rename im selben Verzeichnis, mit Revision-Guard (409 bei geänderter Datei,
   gleiches Revision-Schema wie der Projekt-Explorer). Anlegen nur mit
   Namens-Regex und ohne Überschreiben bestehender Dateien.
2. **Containment wie Code-Explorer** (realpath beidseitig gegen den Vault-Root,
   `.git` gesperrt, Symlinks nach außen blockiert). Der Root wird über einen
   serverseitigen Verzeichnis-Browser gewählt — Startpunkte sind `projectRoots`
   und das Home-Verzeichnis des Hub-Prozesses; jede Navigation ist containment-
   geprüft, es gibt keine frei eingebbaren Pfade. dataDir des Hubs und `.git`
   werden abgelehnt.
3. **Dateiansicht über das Code-Modul**: `target()` der Code-Routen erhält das
   additive Ziel `vault=1` (Root = konfigurierter Vault-Root; 422 ohne
   Konfiguration). Damit liefert der etablierte Projekt-Explorer (tree/meta/
   range/raw/find, Viewer-Matrix, Revision-Guard) die Ansicht — kein zweiter
   Viewer. Der Markdown-Editor bleibt Vault-eigen (Textfeld + Vorschau über den
   bestehenden Markdown-Renderer + explizites Speichern; kein Autosave).
4. **Policy**: Alle Vault-Routen lehnen agenten-initiierte Requests ab
   (`policy.decision === "approve"` → 403, Präzedenz Diagnose-Trust); die
   Root-Wahl braucht zusätzlich `settings.manage`. Vault-Pfade erscheinen nicht
   in Events/Telemetrie.
5. **Navigation**: `ListPage "vault"` (Slug `notizen`) mit Dock-Item;
   Datei-Deep-Link `#/notizen/datei/<path>`; Popout-Ziel
   `{kind:"vault", path?}` additiv im Fensterprotokoll (ADR-0053/0062-Muster),
   Fenster lädt selbst per HTTP.
6. **K7**: Notizen sind gewöhnliche Dateien im gewählten Ordner — der Hub hält
   keinen zweiten Zustand; der ungespeicherte Editor-Inhalt lebt nur im Fenster
   bis Speichern/Verwerfen. Offline: Lesen nur aus letzter Antwort, Speichern
   gesperrt und ehrlich benannt.

## Alternativen

- **Projekt-Schreibpfad allgemein öffnen** — widerspricht ADR-0058 und würde die
  Angriffsfläche aller Repos öffnen; abgelehnt.
- **projectRoots als Vault-Root missbrauchen** — Config-Datei + Restart + falsche
  Semantik (Projekte ≠ Notizen); abgelehnt.
- **Eigenes Viewer-Rendering im Vault** — zweite Viewer-Codebasis (P48-Premortem 5);
  das `vault=1`-Ziel liefert die P46-Matrix ohne Kopie.
- **Autosave/Offline-Sync** — halber Server-State und Konfliktversprechen; hier
  bewusst explizites Speichern mit Revision-Guard.

## Folgen

- Der Vault ist eine Menschenfläche: Agenten sehen ihn nicht über die API.
- Der gewählte Ordner gehört dem Nutzer (z. B. ein Obsidian-Vault); AncientVoid
  schreibt nur `.md`-Dateien dorthin und legt nichts außerhalb an.
- Dateien anderer Typen sind sicht- und lesbar (Viewer-Matrix), aber nicht
  editierbar.
- `vault=1` erweitert das Code-Modul additiv; Contracts/Verhalten der übrigen
  Ziele bleiben unverändert.
