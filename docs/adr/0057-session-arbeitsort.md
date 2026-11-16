# ADR-0057 — Session-Arbeitsort: eigener Worktree oder Projekt direkt

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/sessions/session.ts`,
`packages/core/src/modules/workspace/checkout.ts`, `SessionManager`,
`apps/hub/src/modules/sessions/`, `apps/pwa/src/features/new-session/`, EPIC-P38 (T38.1–T38.6)

## Kontext

Bisher entschied allein der Hub: Git-Projekt ⇒ eigener Worktree (T2.1), sonst
Fallback ins Projekt. Der Nutzer konnte nicht wählen und nirgends sehen, wo die
Session schreibt; „kein Worktree“ war nicht im Record belegt, sondern nur als
Systemevent `session.no_worktree_isolation`. Ein Worktree isoliert Git-Dateien,
**keine** Prozess-/Netzwerkrechte — die Harness-Sandbox/der Permission-Mode
(ADR-0033) ist ein eigener Begriff.

## Bestandsmatrix (T38.1)

| Startpfad | Arbeitsort bisher | Jetzt (`workspaceMode`) | Lease |
|---|---|---|---|
| create, Git, ohne Angabe | Worktree | `worktree` (Standard unverändert) | nein |
| create, Nicht-Git, ohne Angabe | Projekt (Event) | `direct`, sichtbarer Fallback | nein |
| create `workspaceMode: "direct"` | – | `direct`, kanonischer Checkout | **ja** |
| create `workspaceMode: "worktree"` auf Nicht-Git | stiller Fallback | **Fehler vor Spawn** | – |
| adopt (ohne Fork) | Projekt | `direct` (Origin-Verzeichnis) | nein¹ |
| adopt `adoptFork` | Worktree | `worktree` | nein |
| mirror | – (läuft nichts) | `unknown`, in der UI ohne Badge | – |
| Loop / Factory-Treiber (`workInProject`) | Projekt | `direct` | nein¹ |
| Fleet | zeigt nur Sessions an; Start läuft über die API des Ziel-Hubs | gleiche API | dort |
| Resume/„Weiter“ | Worktree wird ggf. neu angelegt | `direct` legt **nie** einen Worktree an, erwirbt die Lease neu | ja |

¹ Loop/Factory/Übernahme arbeiten konstruktionsbedingt im Projekt des
Loop-Systems bzw. am Ursprung der Session; eine Lease würde bestehende,
bewusst parallele Läufe brechen. Sie sind in der Matrix als `direct` belegt,
aber nicht exklusiv — Grenze ausdrücklich dokumentiert, kein neuer Umfang.

## Entscheidung

1. **Contract.** `SessionSpec.workspaceMode?: "worktree" | "direct"`,
   `confirmDirty?: boolean`; `SessionRecord.workspaceMode: "worktree" |
   "direct" | "unknown"` und `workspaceBaseline`. Ohne Angabe gilt der
   bisherige Standard (Worktree) — additiv, kein Breaking Change.
2. **Migration (DB 30).** `worktree_sha IS NOT NULL` belegt `worktree`. Alles
   andere bleibt `NULL` ⇒ `unknown` („Arbeitsort ungeklärt“ in der UI); nichts
   wird geraten, kein stiller Fork oder direct-Fallback bei Resume.
3. **Kanonischer Checkout.** `realpath` der Git-Toplevel-Ebene (Nicht-Git:
   realpath des Ordners). Symlinks und Unterordner führen auf denselben
   Schlüssel; ein weiterer Worktree desselben Repos ist ein eigener Checkout.
4. **Writer-Lease.** Tabelle `checkout_leases` (SQLite, überlebt SIGKILL):
   höchstens ein aktiver AV-Schreiber pro direktem Checkout, mit monotoner
   Generation. Ein Eigentümer, der gestoppt/Fehler/unterbrochen/archiviert ist,
   wird beim nächsten Erwerb abgelöst (Recovery vor Freigabe). Stop, Archiv,
   Löschen geben nur die Lease frei (Tombstone, Generation zählt weiter).
   Externe Editoren/CLIs sind nicht sperrbar — die UI sagt das und zeigt Drift.
5. **Dirty-Start.** Ungesicherte Änderungen ⇒ Start nur mit `confirmDirty`.
   Die Baseline (HEAD, Branch, Dirty-Pfade, gekappt) wird im Record
   festgehalten; der Session-Diff nimmt die Start-HEAD als Basis und markiert
   Dirty-Pfade als „vor Start geändert“. Nie stash/reset/commit.
6. **Cleanup-Guard.** Alle Worktree-Pfade (`tidyWorktree`, `teardown`,
   `apply`, `remove`, `ensureWorkdir`) hängen an `worktreeSha !== null` bzw.
   `workspaceMode !== "direct"`; für `direct` laufen weder Include-Kopie,
   Worktree-Apply/Remove/Prune noch ein P29-Teardown ohne ausdrückliche
   Freigabe. Archiv/Stop/Löschen berühren das Projekt nie.
7. **Sichtbarkeit.** `GET /api/workspace/preview?project=` (read-only, hinter
   `projectRoots`), `GET /api/sessions/:id/workplace` (Modus, Pfad, Drift,
   Lease-Generation), PWA: zwei Karten + Badge, hubctl `sessions`/`show`.

## Folgen

- Sandbox ist weiter ein getrenntes Feld (`permissionMode`); die UI erklärt
  das neben der Wahl und bewirbt den Worktree nie als OS-Isolation.
- Browser, Orchestrator und Scheduler (P39–P41) nutzen denselben Vertrag
  (`create` mit `workspaceMode`) und erben damit die Lease.
- Nicht gelöst (bewusst): Exklusivität gegenüber Nicht-AV-Schreibern;
  Lease-Übernahme zwischen Hubs (Fleet) — jede Lease gilt pro Hub.
