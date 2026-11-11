# ADR-0065 — Automationen: Ergebnisabgleich, unveränderliche Run-Vorlagen und Recovery

**Status:** akzeptiert · **Betrifft:** EPIC-P41, Contracts automations, Core/Hub/PWA/hubctl

## Entscheidung

- `AutomationHistoryEntry` ist der gemeinsame HTTP-/Journal-Vertrag. `unknown`
  bezeichnet einen Start ohne belegtes Ergebnis; es ist kein Erfolg und keine
  Aufforderung zum Replay. Bestehende Journalzeilen bleiben lesbar.
- Session-Ergebnisse werden aus persistierten `session.turn_end`-Events gelesen,
  Run-Ergebnisse vom bestehenden P40-Orchestrator. Ein Eigentümer betreibt den
  Orchestrator; Routen und Automationen teilen dieselbe Instanz. Polling führt
  Ergebnisse auch nach Neustart nach und gibt das Überlappungsbudget frei.
- `target.templateId` bezeichnet einen vorhandenen P40-Run. Bei Anlage/Änderung
  friert der Hub dessen Startauftrag (Ziel, Rahmen und Plan) als SHA-256-Blob ein.
  `templateBlobSha256` bindet die menschliche Freigabe an genau diesen Inhalt;
  spätere Änderungen der Quelle ändern keine aktivierte Automation. Große Pläne
  bleiben außerhalb der Definition (K5). Kein zweiter Coordinator.
- Vor Dispatch werden Host, Generation und Definitionsrevision nach dem
  Precheck erneut geprüft. Disable/Enable invalidiert einen laufenden Precheck.
  Run-now ist eine eigene UUID-Operation und verschiebt keinen Kalendercursor.
- Kalendercursor liegen generationengebunden im Journal/Snapshot. Langer Ausfall
  erzeugt einen zusammengefassten Missed-Bereich (`missedThroughUtc`) und
  höchstens einen zulässigen Catch-up. Kein synchrones Aufrollen jedes einzelnen
  Minutentermins. Claim und Cursor werden vor Dispatch dauerhaft geschrieben.
- Nicht eindeutig abgeschlossene Claims werden nach Recovery sichtbar `unknown`;
  bekannte Dispatch-Referenzen werden geprüft, niemals erneut gestartet. Unknown
  belegt das Überlappungsbudget bis zu einer belegten Auflösung.
- PWA-Offline-Projektionen bleiben nach Host und Gerätetoken getrennt, tragen
  einen Abrufzeitpunkt und erlauben keine Mutation. Fehler bleiben sichtbar.

## Folgen

Zusätzliche Zustände/Skip-Gründe und optionale History-/Run-Target-Felder sind
additive Contract-Erweiterungen. Alte Clients zeigen unbekannte Werte als Text;
alle mitgelieferten Clients werden gemeinsam aktualisiert. Journal und Snapshot
bleiben die einzige State-Quelle; große Inhalte sind referenzierte Blobs.
Ein neuer Epic-Exit braucht Tests für echte Folgeausführung und Run-Dispatch,
Recovery ohne Replay, Precheck-Rennen, DST/Grace und Offline-Reload.
