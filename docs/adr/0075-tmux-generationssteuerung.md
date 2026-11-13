# ADR-0075 — Tmux-Worker generationsicher steuern: Pane-ID statt wiederverwendbarem Namen

**Status:** akzeptiert · **Betrifft:** BUG-0157 ([#65](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/65)), `packages/workers/src/tmux.ts`, `WorkerInfo` (additiv) · **Bezug:** ADR-0037 (Worker-Marker), ADR-0014 (Adoption), K7

## Kontext

Beendet ein Worker und eine neue Generation startet unter demselben
tmux-Sessionnamen, zielen Kill, Write und Exit-Cleanup des alten Handles auf
den Namen — sie treffen den Nachfolger. Das verzögerte Exit-Cleanup hat
dieselbe Namensbindung; Wiederanläufe können dadurch abbrechen. Log/Offset/
FIFO lagen ebenfalls unter dem Namen, sodass Generationen einander
Dateien streitig machten. (Issue #65 nennt dafür den Entwurfsnamen
„ADR-0074" — diese Nummer gehört inzwischen dem Aktivitätsregister; dieses
ADR hier ist die ausgereifte Fassung jenes Entwurfs.)

## Entscheidung

1. **Unveränderliche Pane-ID als Steuerziel.** `track()` merkt sich beim
   Spawn `#{pane_id}`; `kill` (SIGTERM wie SIGKILL), `write` (send-keys),
   Status (`pane_dead`, `pane_pid`) adressieren `%<paneId>`. Ein totes Ziel
   heißt „unsere Pane ist weg" — auch wenn unter dem Namen ein Nachfolger
   läuft.
2. **kill-session nur bei nachgewiesener Pane-Zugehörigkeit.** Das
   Exit-Cleanup (und SIGKILL) listet die Panes der Session und killt nur,
   wenn UNSERE Pane noch darin ist. Einer Nachfolger-Generation gehört der
   Name dann unbehelligt.
3. **Dateien je Generation.** Log/Offset/FIFO leben unter
   `<name>.<workerId-8>.log[.in|.offset]`. `<name>.log` bleibt als
   Latest-Symlink für den bisherigen Diagnosepfad erhalten.
4. **Marker `@ancientvoid_log`** (Session-Option, mit in `list()`
   übertragen) nennt den Generationspfad; `adopt()` bevorzugt ihn und
   behält die Legacy-Fallbacks (Name, Umbenennungs-Heuristik) bei.
5. **Vertrag additiv:** `WorkerInfo.log?: string`. Kein bestehendes Feld
   ändert Bedeutung; alte Runner ohne Marker laufen über die Fallbacks
   weiter (K7: Adoption überlebt den Upgrade-Pfad).

## Konsequenzen

- Alte Handles können Nachfolger neither killen noch beschreiben noch deren
  Exit als eigenen feiern; der alte `paneDead`-Poll erkennt sein eigenes
  Ende auch unter laufendem Nachfolger (kein Zombie-Handle mehr).
- Diagnosepfad `data/logs/<name>.log` zeigt weiter die aktuelle Generation.
- Test: „an old worker handle cannot terminate a successor with the same
  session name" (rot vor Fix, grün danach) in `packages/workers/test/tmux.test.ts`.

## Alternativen (verworfen)

- **Namen pro Generation suffigieren:** zerstört Diagnosepfad, `attach` und
  Legacy-Adoption; Symlink-Lösung hält beides.
- **Kein Cleanup nach Exit:** lässt Husk-Sessions zurück (heutiger Grund
  für kill-session).
- **PID als Ziel:** Prozesse recyceln PIDs; Pane-IDs sind innerhalb des
  tmux-Servers eindeutig und stabil.
