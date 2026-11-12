# Referenz: hubctl

**Art:** referenz

> Generiert von `scripts/gen-reference.mjs` (`npm run docs:reference`) aus der `usage()`-Ausgabe von `apps/hubctl/src/cli.ts`.
> Nicht von Hand bearbeiten — `npm run check:context` scheitert bei veraltetem Stand.

```text
hubctl — AncientVoid reference client

Usage:
  hubctl health
  hubctl adapters
  hubctl sessions                         includes interrupted/unknown status as text
  hubctl discover
  hubctl inventory
  hubctl show <sessionId>
  hubctl events <sessionId> [afterSeq]
  hubctl tail <sessionId> [-f]             includes session.interrupted and its reason
  hubctl token issue <label> [--agent|--display [--answer-questions]] [--db <hub.db>]   (--agent: label agent:<label>, writes need approval; --display: label display:<label>, reads and decides write approvals only)
  hubctl token list [--db <hub.db>]
  hubctl token revoke <label> [--db <hub.db>]
  hubctl fleet invite [--db <hub.db>]     one-time code for another hub to pair (10 min)
  hubctl fleet peers [--db <hub.db>]      hubs this one is paired with
  hubctl workers list                     verwaiste ancientvoid-Worker anzeigen (lokal, BUG-0034)
  hubctl workers prune                    verwaigte ancientvoid-Worker entfernen (lokal)
  hubctl worktrees [--db <hub.db>]        Session-Worktrees mit Zustand und Größe (lokal, EPIC-P14)
  hubctl worktrees prune [--apply] [--db <hub.db>]   saubere Worktrees beendeter/archivierter Sessions; Trockenlauf ohne --apply
  hubctl workspace <sessionId>                      Workspace-Phase/Services (EPIC-P29)
  hubctl workspace logs <sessionId> <serviceId>     Service-Logs (gekürzter Schwanz)
  hubctl workspace retry <sessionId>                menschlicher Retry nach fehlgeschlagenem Setup
  hubctl workspace preview <sessionId> <serviceId>  Preview-URL mit 5-Minuten-Ticket
  hubctl browser <sessionId>                        Browser-Status/Ziele/Console (EPIC-P39, nur Lesen)
  hubctl browser tests <sessionId>                  Testläufe mit Status (EPIC-P39)
  hubctl devices                                    Android-Geräte: SDK/KVM, Inventar, AVDs, Leases (EPIC-P42, nur Lesen)
  hubctl devices tests <serial>                     Geräte-Testläufe mit Status (EPIC-P42)
  hubctl automations list                           geplante Läufe mit nächstem Termin und letztem Ergebnis (EPIC-P41)
  hubctl automations show <id>                      Definition und Verlauf (Claims, Session-/Run-Verweise)
  hubctl automations create <definition.json> [prompt.txt]   legt deaktiviert an; Session-Ziele brauchen den Prompt
  hubctl automations update <id> <patch.json> [prompt.txt]  Änderungen speichern, neue Freigabe nötig
  hubctl automations preview <id>                    nächste Termine mit Ortszeit und UTC
  hubctl automations enable <id>                    Aktivierung = menschliche Freigabe (Generation bleibt)
  hubctl automations disable <id>                   stoppt zukünftige Termine, laufende Arbeit unverändert
  hubctl automations run-now <id>                   eigener Lauf jetzt; Ergebnis kommt aus der referenzierten Ausführung
  hubctl automations resolve <id> <claimKey> --note <text>  unklaren Start ohne Referenz aufgeben, gibt den Plan frei (ADR-0072)
  hubctl backup create --config <hub.config.json> --out <file> --key-file <file>
  hubctl backup restore --archive <file> --data-dir <empty-dir> --config-out <file> --key-file <file>
  hubctl backup prune --dir <archive-dir> --keep <count> [--apply]   preview unless --apply

Env:
  ANCIENTVOID_URL   hub base url (default http://127.0.0.1:7373)
  ANCIENTVOID_TOKEN device token
```
