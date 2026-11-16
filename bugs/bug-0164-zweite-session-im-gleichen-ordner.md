---
id: BUG-0164
slug: zweite-session-im-gleichen-ordner
status: done
severity: S2
area: core
instance: dev
commit: "3aef99e5"
forge: ""
epic: ""
created: 2026-11-16
reporter: Pi-Session 2026-11-16 (Nutzerbericht + Browser-Repro)
---

# BUG-0164 — Zweite Session im selben Ordner ist ohne Git eine Sackgasse

## Gesehen

Der Start einer zweiten Session in einem Ordner, in dem schon eine Session
steht, wird blockiert: Karte „Hier schreibt bereits eine andere
AncientVoid-Session (…) Erst beenden oder „Eigener Worktree“ wählen“,
serverseitig „In diesem Projekt schreibt bereits eine andere
AncientVoid-Session (…). Erst beenden oder einen eigenen Worktree wählen.“
Der empfohlene Ausweg ist bei einem Ordner ohne `.git` **deaktiviert**
(Karte „Eigener Worktree“ ausgegraut, „Nicht möglich: kein Git-Projekt“) —
es bleibt kein Weg. Nutzerbericht: er wolle „in einem Ordner mehrere Sessions
anlegen“ können.

## Erwartet

Mehrere Sessions pro Ordner sind möglich, weil ohne Git kein Worktree als
Trennung existiert: explicit wählbar (Stand bleibt die alleinige
Schreiber-Sitzung), mit ehrlichem Warnhinweis, dass mehrere Sessions
gleichzeitig in denselben Dateien schreiben. Beenden als einziger Ausweg und
ein nicht wählbarer Worktree sind keine Lösung.

## Repro

Voraussetzung wie in BUG-0161 (`plain-ordner` ohne `.git`, Adapter dummy).

1. „Neue Session“, Pfad `<temp>/projects/plain-ordner`, „Starten“ → Session
   `55edb95c` entsteht, Arbeitsort „Projekt direkt“.
2. „Neue Session“ erneut öffnen, derselbe Pfad, „Starten“.

**Ergebnis nach Schritt 2:** keine zweite Session; Formular zeigt beide
Meldungen (Karte + Formular), die Worktree-Karte ist deaktiviert. Screenshot
`block-neue-session.png` (Retina nicht committet).

**Befund in Kais laufender Instanz** (`data/hub.db`, read-only): genau eine
Session pro Projekt (`E:\coding\AncientVoid`, `E:\Coding\qwen 4`,
`C:\Users\KaiFe\Documents\hardwareauswahl`, `/coding`), und
`checkout_leases` hält Einträge für Sessions im Status `idle`
(`acquired_at` 2026-11-14 und 2026-11-16T07:12) — ein Ordner ist also auch
durch eine ruhende Session belegt.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Scratch-Hub Port 62883 + Kais Instanz `127.0.0.1:7373` (nur gelesen) |
| Commit | `3aef99e5` |
| Node-Version | v24.18.0 |
| Adapter | dummy (Scratch) / pi (Kais Instanz) |
| Repro-Weg | PWA (agent-browser) + SQLite-Read-only-Prüfung |

## Logs

```text
PWA, zweiter Start desselben Pfads:
  [role=alert] Hier schreibt bereits eine andere AncientVoid-Session (55edb95c).
               Erst beenden oder „Eigener Worktree“ wählen.
  [role=status] In diesem Projekt schreibt bereits eine andere
                AncientVoid-Session (55edb95c). Erst beenden oder einen
                eigenen Worktree wählen.
GET /api/sessions -> 1 Session (55edb95c, status "working", workspaceMode "direct")
data/hub.db (read-only, Kais Instanz):
  checkout_leases: checkout_id "E:\Coding"          session 8fbe5be1 …
  checkout_leases: checkout_id "E:\Coding\qwen 4"    session fd9da61d …
  zugehörige sessions: status "idle"
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/checkout-lease.test.ts` | grün — erzwingt die Exklusivität als Vertrag |
| Integration | `packages/core/test/session-manager.integration.test.ts` | grün — zweite Session wird erwartet abgelehnt |
| E2E | `e2e/specs/neue-session.spec.ts` (neu) | fehlt |

Bestehende Tests sichern die Exklusivität bewusst (ADR-0057). Eine
Auflockerung ist eine **Verhaltensänderung mit Vertragsbezug** (Arbeitsort,
`checkout_leases`) → ADR nötig, Stand: Default bleibt Allein-Schreiber,
Mehrfach-Schreiber wird explicit eingeschaltet.

## Eingrenzung

`packages/core/src/modules/workspace/checkout.ts:48-86`
(`CheckoutLeaseStore.acquire`, unique auf `checkout_id`) und
`packages/core/src/modules/sessions/session-manager.ts:770-771` (Start wirft)
sowie `:792-793`, `:809-818` (`heldBy` in der Vorschau).
UI-Seite: `apps/pwa/src/features/new-session/WorkplaceChoice.tsx` (blockiert
bei `heldBy`, Worktree-Karte `disabled` wenn `!worktreePossible`).

## Fix (`61b0198e` (ADR-0077))

Git-Checkouts bleiben
Allein-Schreiber; Ordner ohne `.git` bekommen nach ausdruecklicher Bestaetigung
(`SessionSpec.confirmSharedFolder`) eine Mit-Nutzerschaft in der neuen Tabelle
`checkout_tenants` (Migration 33). `workplacePreview` meldet `holders[]`, Resume
holt die Mit-Nutzerschaft zurueck, `stop`/`archive` loeschen sie. Die PWA zeigt
Warnung + Ueberschreibhinweis + Haken statt einer Sackgasse, und deaktivierte
`.btn` sehen jetzt deaktiviert aus.

## Tests

`workplace-mode.test.ts`: ohne Bestaetigung abgewiesen (eine Session), mit
Bestaetigung zwei direkte Sessions + Tenant-Zeile + `holders`; Git-Projekt bleibt
gesperrt auch mit Bestaetigung; Stop der Mit-Nutzung entfernt die Zeile und laesst
die Primaer-Lease. Live: zwei Sessions (5bb46b05, 6cb0b175) in `plain-ordner`,
beide `working`.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` mit ADR (Mehrfach-Schreiber opt-in) — auf diesem Branch
