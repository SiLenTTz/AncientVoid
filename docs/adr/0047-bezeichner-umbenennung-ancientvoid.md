# ADR-0047 — Technische Bezeichner folgen der AncientVoid-Umbenennung

**Status:** akzeptiert · **Superseded:** [ADR-0046](0046-umbenennung-ancientvoid.md)
Punkt 2 (dokumentierte Bezeichner-Ausnahmen) · **Messlatten-Bezug:** K7 (lokale
Migration statt Beibehaltung alter Namen)

## Kontext

ADR-0046 (2026-10-31, nachts) benannte nur den Anzeigename um und beließ alle
technischen Bezeichner (`@uacc/*`, `UACC_*`, Cookie/Storage-Keys, Pfade,
Service-Namen) mit der Begründung, deren Umbenennung breche laufende
Installationen. Nutzerauftrag desselben Tages (2026-10-31, ausdrücklich nach
Vorlage des Konflikts): **„komplett, wirklich alles“** — die Solo-Installation
gehört dem Nutzer, ein Re-Login am Handy ist akzeptiert, und der halbe Rename
(Anzeigename neu, Bezeichner alt) hinterlässt zwei Namen im Code.

Zusätzlicher Auslöser: Die systemd-Unit `uacc-hub.service` verwies weiter auf
den alten Repo-Pfad `…/arbeitsbaeume/mobile-hub`; nach der Verzeichnis-Umbenennung
wäre jeder Neustart gebrochen. Die Gelegenheit wird genutzt, Bezeichner und
Pfade in einem Zug konsistent zu machen.

## Entscheidung

1. **Alle technischen Bezeichner werden auf `ancientvoid` umgestellt**, eine
   Verhaltensänderung in einem Zug (Scope-Resize, kein gestaffeltes Alias-Release
   wie in ADR-0046 Punkt 3 skizziert — Solo-Produkt, kein externer Konsument):
   - npm-Scope `@uacc/*` → `@ancientvoid/*` (Paketnamen, Imports, Lockfile,
     `hub.config.example.json`), Root-Paketname `mobile-hub` → `ancientvoid`
     (npm-Namen sind kleingeschrieben).
   - Env-Variablen `UACC_*` → `ANCIENTVOID_*` (u. a. `ANCIENTVOID_CONFIG`).
   - Persistenz/Client: Cookies `uacc_session`/`uacc_owner` →
     `ancientvoid_session`/`ancientvoid_owner`, localStorage-Keys `uacc.*` →
     `ancientvoid.*` (u. a. `ancientvoid.token`), Datadir-Lock
     `.uacc-hub.pid` → `.ancientvoid-hub.pid`.
   - Service/Scripte: Unit `uacc-hub.service` → `ancientvoid-hub.service`,
     Starter `scripts/uacc-hub-app` → `scripts/ancientvoid-hub-app`,
     Companion-Bin `uacc-companion` → `ancientvoid-companion` (Socket
     entsprechend), Konfig-Verzeichnis `~/.config/uacc/` → `~/.config/ancientvoid/`.
   - Worktree-Branches neuer Sessions: `uacc/<sessionId>` → `ancientvoid/<sessionId>`
     (bestehende `uacc/*`-Worktrees bleiben bis zum Hub-Cleanup unberührt).
   - MCP: Server-/Toolnamen `uacc`/`mcp__uacc__*` → `ancientvoid`/`mcp__ancientvoid*`.
   - Header `X-UACC-*` → `X-AncientVoid-*` (Header sind case-insensitiv,
     Server/Service-Worker/Tests werden konsistent geändert).
   - Prosa und Historie (`bugs/`, `docs/messlauf/`, Epics): `UACC`/`mobile-hub`
     → `AncientVoid`, kleingeschriebene Bezeichner entsprechend.
2. **Bewusst NICHT umbenannt (bleiben aus ADR-0046):**
   - GitLab-Projektpfad und -URLs (`SiLenT_Tz/mobile-hub`): nach außen
     wirksam, eigenständige Freigabe; GitLab leitet nach einer UI-Umbenennung
     um, dann können die Strings folgen.
   - Der Wortlaut von ADR-0046 selbst (historischer Zusammenhang; Punkt-2-Liste
     zitiert die damals alten Namen als Fakt).
3. **Lokale Migration (gleicher Zug, dokumentierter Ablauf):**
   Dienst stoppen → `hub.config.json` (untracked) auf `@ancientvoid/*`-Module
   und `~/.config/ancientvoid/`-Pfade umstellen → `~/.config/uacc` nach
   `~/.config/ancientvoid` verschieben → Unit-Datei ersetzen (neuer Name,
   neuer Repo-Pfad, `ANCIENTVOID_CONFIG`) → `daemon-reload`, enable+start →
   Health-Check. Altlasten (`.uacc-hub.pid` im Datadir) löschen; das Handy
   meldet sich neu an (Client-Keys heißen anders).
4. **In Kauf genommene Brüche, sichtbar dokumentiert:** Re-Login/-Token am
   Handy; externe Verweise auf `mcp__uacc__permission` (z. B.
   `--permission-prompt-tool` in Claude-Settings) müssen auf
   `mcp__ancientvoid__permission` umgestellt werden; `fleet-deploy.sh`-Ziele
   erwarten künftig `ancientvoid-*`-Pfade auf den Hosts.

## Prüfung

`git grep -I -n 'uacc\|UACC\|mobile-hub'` trifft außerhalb der Ausnahmen aus
Punkt 2 nur noch historisch bewusst Belassenes; `npm run gate` grün;
E2E belegt Titel, Manifest und Anmelden (neue Cookie-Namen).
