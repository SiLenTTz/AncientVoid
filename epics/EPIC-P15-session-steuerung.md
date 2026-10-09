# EPIC-P15 — Session-Steuerung: Modus, Modell, Pause, Queue, Sync, Titel

**Status:** in Arbeit (2026-10-09) · **Phase:** P15 · **Dauer:** 1–2 Agenten-Wochen · **Abhängigkeit:** fachlich keine offene (P7 Tool-Parität, P8 Mobiler Arbeitsplatz abgeschlossen); P12-Abnahmen laufen parallel und blockieren hier nichts.

Auslöser: Rückmeldungen von Jan aus dem Betrieb am 2026-10-08/09 — Auto Mode soll überall
Standard sein, Modell und Modus sollen pro Session in der App wählbar sein, Nachrichten
sollen sich in eine Queue legen lassen, eine laufende Session soll sich pausieren lassen,
Eingaben vom Handy sollen am PC sichtbar sein (und umgekehrt), und die vielen Sessions
sollen sich an klaren Titeln unterscheiden lassen. Die drei UI-Fehler (Springen, verdeckte
Nachrichten, Flackern) sind als BUG-0043 bis BUG-0045 bereits behoben.

## 1. Ziel

Eine Session lässt sich vom Handy aus so steuern, wie man es am PC täte: Modus und Modell
wählen und wechseln, laufende Züge anhalten, weitere Nachrichten vormerken — und was auf
einem Gerät passiert, steht auf dem anderen. Die Übersicht zeigt die relevanten Sessions
mit Titeln, an denen man sie erkennt.

## 2. Scope (In / Out)

**In:** Modus-/Modell-Contract (ADR-0033), Claude-Adapter, Hub-Default `auto`, Oberfläche für
Modus und Modell, sichtbarer Pause-/Stop-Knopf (`park`/`resume` existieren), Hub-seitige
Nachrichten-Queue je Session, Sync der Eingaben zwischen Handy und PC, bessere Titel
(Heuristik, KI-Kurztitel, Titel für übernommene Sessions), relevante Sessions zuerst.

**Out:** Modus-/Modellwechsel für Provider mit langlebigem Prozess (ACP, Codex-App-Server),
solange deren Protokoll es nicht trägt; Änderungen am Event-Contract außer additiven Feldern;
Zeit-Retention für Sessions.

## 3. Design-Details

- **ADR-0033** legt Modus/Modell fest: additive `HarnessFeatures` (`permissionModes`,
  `modelSwitch`), `SteerInput { kind: "configure" }`, Spalte `sessions.permission_mode`,
  Event `session.configured`, Hub-Default `defaultPermissionMode` (`auto`).
- Live geprüft gegen claude 2.1.288: `--model` und `--permission-mode` greifen auch bei
  `--resume`; die frühere Regel „Modell nie bei Resume“ ist damit überholt.
- Queue und Pause bleiben Hub-seitig, damit sie für alle Provider gleich wirken und nach
  einem Neustart wiederherstellbar sind (K7: persistierte Queue-Einträge + Event je Eintrag).
- Titel: deterministisch zuerst (kein Modell nötig), KI-Titel danach über die vorhandene
  `assistant`-Konfiguration, nur einmal pro Session und nie über einen manuell gesetzten Titel.

## 4. Aufgaben

- [x] **T15.1 — Modus-/Modell-Contract, Claude, Hub-Default `auto`.** ADR-0033, `configure`-Steer, Feature-Gate, Migration 22, `session.configured`, Claude `--permission-mode`/`--model` bei jedem Spawn. K7.
- [x] **T15.2 — Oberfläche für Modus und Modell.** Knöpfe in der Session-Steuerung; Auswahl nur aus dem, was der Adapter meldet; Modus bei „Neue Session“. K10 (mobil bedienbar).
- [ ] **T15.3 — Pause-/Stop-Knopf und Queue.** Sichtbarer Pause/Weiter-Knopf; Nachrichten während eines laufenden Zugs werden vorgemerkt und der Reihe nach gesendet; Queue anzeigen, einzelne Einträge streichen. K7.
- [ ] **T15.4 — Sync Handy ↔ PC.** Eingaben und Entwurf erscheinen auf dem jeweils anderen Gerät. K7/K10.
- [ ] **T15.5 — Titel.** Heuristik, KI-Kurztitel (`titleSource`), Titel für übernommene Sessions. K10.
- [ ] **T15.6 — Relevanz in der Übersicht.** Zuletzt aktive zuerst, ältere Leerlauf-Sessions eingeklappt. K10.

## 5. Acceptance Criteria

- **AC-P15-1:** Eine neue Claude-Session startet mit `--permission-mode auto`, ohne dass etwas gewählt wurde; `defaultPermissionMode: "manual"` stellt das Nachfragen wieder her.
- **AC-P15-2:** Modus und Modell einer laufenden und einer beendeten Session lassen sich ändern; der nächste Zug nutzt sie. Ein Adapter ohne diese Fähigkeit lehnt mit Grund ab.
- **AC-P15-3:** Der Wechsel steht als Event im Verlauf und überlebt einen Hub-Neustart.
- **AC-P15-4:** Eine Nachricht während eines laufenden Zugs geht nicht verloren und nicht doppelt raus.
- **AC-P15-5:** Eine Eingabe am Handy ist am PC-Client sichtbar, ohne die Session neu zu öffnen.

## 6. Premortem

1. **Auto Mode lässt den Agenten mehr tun, als gewollt.** Mitigation: konfigurierbarer Default, Wechsel pro Session in der App, Hub-Gatekeeper bleibt für alles zuständig, was den Hub erreicht; ADR nennt das Risiko.
2. **Provider ohne Modus-Konzept bekommen eine Auswahl, die nichts bewirkt.** Mitigation: Oberfläche zeigt nur, was `features` meldet; `configure` wird vor dem Adapter abgelehnt; Matrix-Prüfer vergleicht Doku und Code.
3. **Queue sendet doppelt oder verliert Nachrichten bei Neustart.** Mitigation: Eingabe-ID je Eintrag (bestehender Dedup-Pfad), Persistenz mit Recovery, Test mit Neustart mitten in der Queue.
4. **Der Sync überschreibt einen Entwurf, den jemand gerade tippt.** Mitigation: bestehender Revisions-/Lease-Pfad (`inputRevision`, `writerLease`) wird genutzt, nicht umgangen.
5. **KI-Titel kosten oder halluzinieren.** Mitigation: nur lokales Modell, einmal pro Session, Heuristik als Rückfall, manueller Titel hat Vorrang.

## 7. Definition of Done

- Tests + Lint + Typecheck grün; `npm run gate` grün (CI-Job `e2e` nur lokal belegbar, solange die Quota fehlt — `docs/testing-e2e.md`).
- Jede neue UI-Funktion hat einen Spec in `e2e/specs/`; `npm run check:arch` und `npm run check:adapter-matrix` grün.
- Contract-Änderungen sind in ADR-0033 begründet; kein TODO ohne Epic-Referenz.
- Erreichbar: Knöpfe in der PWA, Provider-Abdeckung in `docs/harness-matrix.md`.
