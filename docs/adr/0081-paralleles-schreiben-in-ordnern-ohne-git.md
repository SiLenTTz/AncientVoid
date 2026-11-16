# ADR-0081 — Paralleles Schreiben in Ordnern ohne Git

**Status:** angenommen · **Datum:** 2026-11-16

## Kontext

BUG-0174: „Neue Session“ war in einem Ordner, in dem schon eine Session
läuft, blockiert — und der vorgeschlagene Ausweg („Eigener Worktree“) ist bei
einem Ordner ohne Git deaktiviert. Damit gab es genau für die
Nutzerkonstellation, die ohne Git/GitLab lokal arbeitet, keinen Weg, mehrere
Sessions im selben Ordner zu starten.

[ADR-0057](0057-arbeitsort-pro-session.md) §3 begründet den
Allein-Schreiber pro direktem Checkout mit Git-Metadaten: Baseline
(HEAD/Branch/Dirty), Drift-Erkennung und Worktree-Trennung setzen `.git`
voraus. Für einen Ordner ohne `.git` liefert `checkoutState()` nichts davon —
`head`, `branch` und `dirty` sind leer. Die exklusive Lease schützte dort also
nur die Abwesenheit von Metadaten, nicht den Inhalt.

## Entscheidung

- **Git-Checkouts bleiben Allein-Schreiber.** Die Regel aus ADR-0057 §3
  unverändert; `confirmSharedFolder` changeiert dort nichts. Der ehrliche Ausweg
  bleibt der projekt-eigene Worktree.
- **Ordner ohne `.git` dürfen mehrere schreibende Sessions haben**, aber nur
  nach ausdrücklicher Bestätigung derselben Nutzerin/desselben Nutzers:
  `SessionSpec.confirmSharedFolder: true` (additiv,
  [contracts](../../packages/contracts/src/sessions/session.ts)). Ohne das Feld
  bleibt der Start sichtbar abgewiesen — nie still gedroppt (Fail-loud).
- **Die exklusive Lease bleibt, wie sie ist.** Zusätzlich beschreibt die neue
  Tabelle `checkout_tenants (checkout_id, session_id, acquired_at)`
  (Migration 34) die Mit-Nutzerschaft. Der Primär-Inhaber der Lease wird nicht
  abgelöst; Mit-Nutzer holen sich keine Lease.
- `workplacePreview` meldet `holders: string[]` (Primär-Lease + Mit-Nutzer).
  `heldBy` bleibt aus Kompatibilitätsgründen stehen. Die PWA zeigt daraus eine
  Warnung mit Überschreibhinweis und einen Bestätigungs-Haken statt einer
  Sackgasse.
- **Resume:** eine Mit-Nutzung holt sich über `claimDirectCheckout` ihre
  Mit-Nutzerschaft zurück, nicht die exklusive Lease. `stop`/`archive` löschen
  die Tenant-Zeile — die Tabelle ist die K7-Wahrheit über Mit-Nutzerschaft nach
  Neustart.

## Folgen

- Zwei Agenten in demselben Nicht-Git-Ordner können sich gegenseitig
  überschreiben. Das ist sichtbar bestätigt, nicht ausgeschlossen; AncientVoid
  sperrt weiterhin weder externe Editoren noch CLIs.
- Dirty-Baseline, Drift-Anzeige und Worktree-Angebot bleiben Git-only; für
  Nicht-Git-Ordner gibt es diese Sicherheit nicht und die UI behauptet sie auch
  nicht.
- `checkout_tenants` wächst nur, solange Sessions schreiben; Aufräumen passiert
  beim Freigeben derselben Session.

## Abgewogen

- *Lock-Datei im Zielordner*: hätte externe Editoren einbezogen, aber fremde
  Setups (Windows, Read-only-Medien) und Leichen nach `SIGKILL` neu erfunden —
  der EventStore ist bereits die Naht (K7).
- *Worktree für Nicht-Git erfinden* (Copy-on-Start): verdoppelt Ordner, ohne
  dass Nutzerin oder Nutzer es bestellt hätte.
