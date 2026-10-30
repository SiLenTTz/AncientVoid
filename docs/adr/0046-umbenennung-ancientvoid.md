# ADR-0046 — Umbenennung des Produkts in „AncientVoid“

**Status:** akzeptiert · **Betrifft:** Anzeigename in PWA/Manifest/Doku/CLI-Texten,
Branding-Assets (`apps/pwa/public`) · **Messlatten-Bezug:** K7 (bestehende Datadirs
und Tokens bleiben nutzbar)

## Kontext

Das Produkt hieß „UACC“ (Unified AI-Agent Command Center) bzw. „mobile-hub“ und
bekommt den Namen **AncientVoid** samt eigener Bildwelt (Alien-Cube-Logos). Der
alte Name steckt an zwei sehr verschiedenen Stellen: als *Produktname* in Texten
und als *technischer Bezeichner* (Paketscope, Env-Variablen, Storage-Keys, Pfade,
Service-Namen, Repo-URL).

## Entscheidung

1. **Umbenannt wird jeder sichtbare Produktname**: UI-Texte, `<title>`,
   Web-App-Manifest (`name`, `short_name`, `description`), Favicon/Icons,
   `README`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/`, `epics/`, CLI-Hilfetexte,
   Notification-Titel. Alte Beschreibungstexte wie „Unified AI-Agent Command
   Center“ entfallen; AncientVoid ist kein Akronym.
2. **Bewusst NICHT umbenannt (dokumentierte Ausnahmen)** — Bezeichner sind kein
   Produktname, ihre Umbenennung bricht laufende Installationen:
   - npm-Scope `@uacc/*` und Paketverzeichnisse (öffentlicher Contract-Import,
     ADR-Pflicht laut AGENTS.md Regel 1),
   - Env-Variablen `UACC_*`,
   - Persistenz-Bezeichner: Datadir-Inhalte, `uacc_session`/`uacc_owner`-Cookies,
     localStorage-Keys `uacc.*`, `.uacc-hub.pid`, `*.uaccbak`, `uacc.token`,
     systemd-Unit `uacc-hub.service`, Hostname `uacc.local`,
   - Repo-/Verzeichnisname `mobile-hub` und GitLab-URLs (Remote-Umbenennung ist
     nach außen wirksam und braucht eine eigene Freigabe),
   - historische Einträge (`bugs/`, `docs/messlauf/`, Epic-Retros, Commit-Historie),
     soweit sie Namen als Fakt zitieren.
3. **Migrationspfad**, falls die Bezeichner später folgen: neue Namen additiv
   einführen (`ANCIENTVOID_*` als Alias mit Vorrang, alter Name als Fallback,
   Cookie/Storage-Keys lesend migrieren), alte erst nach einem Release entfernen.
   Das ist ein eigenes Epic mit Contract-ADR, nicht Teil dieser Umbenennung.
4. **Prüfung:** `grep -rIiE 'uacc|mobile-hub'` darf außerhalb der Ausnahmen aus
   Punkt 2 keinen Produktnamen mehr treffen; ein E2E-Spec belegt Titel, Manifest
   und Icons.

## Branding-Assets

Logo ist der grüne Cube (`gruen_02`), passend zum dunklen Theme; Szenenartwork
nur als verkleinerte WebP/JPEG-Datei. Quellordner wird nur gelesen; keine
Roh-Originale im Repo. Maskable-Icons erhalten die Sicherheitszone (Motiv ≈ 70 %
auf schwarzem Grund), da die Originale bis nahe an den Rand reichen.

## Konsequenzen

- Bestehende Datadirs, Tokens, Cookies, Service-Units bleiben unverändert gültig.
- Im Quelltext bleibt `uacc` als Bezeichner sichtbar; das ist gewollt und hier
  begründet.
