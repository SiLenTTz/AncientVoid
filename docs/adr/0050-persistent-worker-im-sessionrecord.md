# ADR-0050: Persistente Worker im SessionRecord vermerken

**Status:** angenommen (2026-11-06) · **Bezug:** ADR-0013, ADR-0014, BUG-0092, EPIC-P28

## Kontext

`adapter.recover()` wird von der K7-Recovery für jede nicht-stopped Session
aufgerufen, damit ein Adapter einen beim Hub-Crash weiterlaufenden Prozess
adoptieren kann (ADR-0014). Der Hub konnte vor diesem ADR nicht
unterscheiden, ob vor dem Crash überhaupt ein Prozess lief: `persistentWorker`
war ein reiner In-Memory-Flag der LiveSession. Zwei Folgen:

1. **BUG-0092:** Der dummy-Adapter (Vorlage für K7-Lasttests) startete in
   `recover()` bedingungslos eine neue Generation — auch für Sessions, deren
   Zug per Auto-Stop beendet war. Unter Parallellast des Alltagshosts fiel
   der K7-Recovery-Test wiederholt an der Journal-Grenze auf; tiefer liegt
   der Produktfehler, dass eine beendete Session nach dem Restart einfach
   weiterliefe (Kosten, Doppelarbeit).
2. Der Dummy meldete das Zug-Ende nie über `ctx.turn("idle")` (ADR-0013),
   sodass der persistierte Status „working" lautete, obwohl der Zug beendet
   war — der Hub rief `recover()` also nachvollziehbar, aber auf Basis einer
   Unwahrheit auf.

## Entscheidung

1. **`SessionRecord.persistentWorker` (additiv, default `false`)**: Der Hub
   persistiert das Flag bei `spawnWorker({persistent})` und bei Adoption
   eines persistenten Prozesses. Kein neuer Zustandskanal — der Record wird
   ohnehin persistiert und ist K7-rekonstruierbar.
2. **Recovery-Regel in `SessionManager.recoverOne()`**: `adapter.recover()`
   wird nur aufgerufen, wenn vor dem Crash ein Zug offen war
   (`working|starting|waiting_approval`) **oder** `persistentWorker` gesetzt
   ist. Für `idle` und `parked` ohne persistenten Prozess wird die Session
   wiederhergestellt (Journal/Status), als steuerbar gemeldet und auf einen
   neuen Prompt über den normalen steer/reopen-Pfad gewartet.
3. **adapter-dummy meldet `ctx.turn("idle")` beim Auto-Stop** — wie echte
   Adapter es tun (ADR-0013). Damit ist der persistierte Status wahr, und
   beendete dummy-Züge laufen nach einem Crash nicht mehr an.

## Konsequenzen und Nachweis

- ACP-artige Adapter mit langlebigem Prozess bleiben geschützt: Ihre
  Sessions tragen `persistentWorker` im Record, die Adoption über
  `recover()` läuft unverändert — auch im Zustand `idle` zwischen Zügen.
- Integrationstest „BUG-0092: nach Recovery läuft für beendete Züge keine
  Generation mehr" ist ohne die Änderung rot (10-ms-Intervall beweist das
  Ablaufen innerhalb eines festen Fensters), mit ihr grün; die bestehenden
  K7-/Recovery-/Interrupt-Suiten (36 Tests) bleiben grün, der T5.10-Test
  prüft die Skill-Kette nach Recovery über den start-Wrapper (gleicher
  fachlicher Anspruch, realistischer Transport).
- Contract-Änderung ausschließlich additiv (optional mit Default);
  `npm -w @ancientvoid/contracts test` deckt die Schema-Erweiterung ab.
