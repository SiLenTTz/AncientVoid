---
id: BUG-0129
slug: vault-ordnerwahl-symlink-ordner-fehlen
status: done
severity: S3
area: core
instance: dev
commit: "efaa952"
forge: ""
epic: "EPIC-P49"
created: 2026-11-11
reporter: "Nutzer"
---

# BUG-0129 — Vault-Ordnerwahl listet vorhandene Ordner nicht (Symlinks) und bietet weder Pfad-Eingabe noch Vorschläge

## Gesehen

Im Ordner-Picker des Knowledge Vault (`#/notizen` → Erstöffnen) fehlen vorhandene Ordner. Konkret: `/home/silenttz/SiLenT_Tz`
ist ein Symlink auf `projects/private/SiLenT_Tz` und erscheint beim Durchstöbern des Homes **nicht** in der Ordnerliste —
damit ist `/home/silenttz/SiLenT_Tz/Vault` nicht erreichbar. Es gibt keine manuelle Pfad-Eingabe und keine Vorschlagsliste;
ein getippter Pfad wie `/home/silenttz/SiLenT_Tz/Vault` kann gar nicht eingegeben werden. Nicht existierende Pfade
führen beim Server zu rohen ENOENT-500ern statt einer klaren Meldung.

## Erwartet

- Ordner, die Symlinks auf Verzeichnisse sind, erscheinen im Picker (und in der Vorschlagsliste) wie echte Ordner.
- Auswahl über drei Wege: Folder-Picker (Navigation), manuelle Pfad-Eingabe mit sichtbarer Validierung, Vorschlagsliste
  aller verfügbaren Ordner (mit `/home/silenttz/SiLenT_Tz/Vault` korrekt als Unterordner).
- Ungültige/nicht existierende Pfade melden sich sichtbar (fail loud), nie still.

## Repro

Voraussetzung: Hub läuft; im Home liegt `SiLenT_Tz -> projects/private/SiLenT_Tz` (Symlink auf Ordner), darin `Vault/`.

1. `#/notizen` öffnen → Picker erscheint.
2. Startpunkt Home öffnen.

**Ergebnis nach Schritt 2:** Liste zeigt echte Ordner, aber nicht `SiLenT_Tz` (Node-Dirent meldet Symlinks als
`isSymbolicLink()`, nicht `isDirectory()`).

**Häufigkeit:** immer (strukturabhängig: jede per Symlink erreichte Ordner-Struktur).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `efaa952` |
| Node-Version | 26.7.0 |
| Dateisystem | btrfs |
| Repro-Weg | PWA / Node (`readdirSync("/home/silenttz",{withFileTypes:true})` → `SiLenT_Tz: isDirectory()===false`) |

## Logs

```text
$ node -e '…readdirSync("/home/silenttz",{withFileTypes:true}).find(e=>e.name==="SiLenT_Tz")'
{ isDirectory: false, isSymbolicLink: true }   # lstat: symlink -> projects/private/SiLenT_Tz
lrwxrwxrwx … /home/silenttz/SiLenT_Tz -> projects/private/SiLenT_Tz
lrwxrwxrwx … /home/silenttz/Vault -> SiLenT_Tz/Vault
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/modules/vault/vault.test.ts` (browse/folders/setRoot mit Symlinks) | rot |
| Integration | `apps/hub/test/modules/vault/vault.integration.test.ts` (`/api/vault/folders`, 404 statt 500) | rot (Route fehlt) |
| E2E | `e2e/specs/vault.spec.ts` (Pfad-Eingabe + Vorschlagsliste) | rot (UI fehlt) |

## Ursache (nach Analyse)

`packages/core/src/modules/vault/store.ts:68` — `readdir(…, {withFileTypes:true}).filter(e => e.isDirectory())`
verwirft Symlink-auf-Ordner, weil Dirents den Typ des Links melden, nicht des Ziels. Dazu fehlen `folders()`
(Vorschlagsliste) und eine klaren 404/422-Meldungen für nicht existierende Pfade in `setRoot`/`browse`.
