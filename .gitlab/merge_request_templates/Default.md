## Was & Warum

<!-- Ein bis drei Sätze: welches Epic-Task/Bug, welches Verhalten ändert sich. -->

## Test-Nachweis

<!-- Reale Kommandos + Ergebnis, kein "sollte funktionieren". -->

```text
npm test
npm run lint
npm run typecheck
```

## Fail-closed-Review-Checkliste (T2.10, EPIC-P2 §4)

Jeder neue Code-Pfad, der **externen State ändert** (Dateisystem, SQLite,
Netzwerk-Aufruf, Prozess-/Worker-Spawn, WebAuthn/Approval-Entscheidung),
muss durch eine der drei Approval-Klassen laufen — oder die Ausnahme wird
hier ausdrücklich benannt, nicht stillschweigend übergangen.

- [ ] **Klassifiziert**: jede neue externe Zustandsänderung ist `read`
  (frei), `write` (Bestätigung) oder `destructive` (WebAuthn) zugeordnet —
  oder als bewusste Ausnahme mit Begründung hier genannt:
  <!-- Ausnahme + Begründung, falls zutreffend -->
- [ ] **Fail-closed bei Timeout/Fehler**: ein Timeout oder unbekannter
  Fehlerzustand auf diesem Pfad endet in Ablehnung/Stopp, nie in
  stillschweigendem Fortfahren (ADR-0007s Timeout-Semantik als Vorbild).
- [ ] **Fail loud** (AGENTS.md Regel 6): ein unbekannter/fehlgeschlagener
  Zustand wird als sichtbares Event oder Status geführt, nie still
  gedroppt.
- [ ] **Contracts-Änderung?** Falls `packages/contracts/**` betroffen ist:
  ADR in `docs/adr/` vorhanden (AGENTS.md Regel 1). Falls nicht betroffen:
  n/a.
- [ ] **K7-Recovery**: falls neuer persistenter State eingeführt wurde,
  hat er einen Recovery-Pfad nach einem harten Neustart (AGENTS.md Regel 4).
- [ ] **Kein Secret im Diff**: `git diff origin/main...HEAD | grep "^+"`
  wurde gegen Token/Key/Passwort-Muster geprüft (`pr-review`-Skill Gate E).

## Future-Fragility (eine Zeile pro Punkt, „nicht betroffen" zählt)

- Contract-Bruch ohne ADR:
- Adapter importiert `@ancientvoid/core`/`@ancientvoid/server` oder umgeht `AdapterContext`:
- Event-Payload > 4 KB ohne `ctx.blob()` (K5):
- Neuer State ohne Recovery-Pfad (K7):
- Stiller Drop unbekannter Provider-Events statt `system`-Event:
