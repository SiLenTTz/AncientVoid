# ADR-0072 — Automationen: einen unklaren Start menschlich auflösen

**Status:** akzeptiert · **Betrifft:** EPIC-P41 §8 Punkt 1, Contracts automations, Core/Hub/PWA/hubctl · **Ergänzt:** [ADR-0065](0065-automations-abschluss-und-run-vorlagen.md)

## Kontext

ADR-0065 lässt einen nicht eindeutig abgeschlossenen Claim als `unknown` stehen
und das Überlappungsbudget belegen, „bis zu einer belegten Auflösung“. Für einen
`unknown` mit Session- oder Run-Referenz liefert der Abgleich diese Auflösung.
Ohne Referenz (Absturz zwischen Claim und Dispatch, unsicherer Dispatch-Fehler)
gibt es keinen: Der Plan bleibt mit `maxParallel = 1` für alle Termine und
Generationen blockiert, bis jemand das Journal von Hand korrigiert.
`AutomationService.settle` existiert, ist aber von außen nicht erreichbar.

## Entscheidung

- Neuer Ergebniswert `abandoned` in `AutomationOutcome`: „vom Menschen
  aufgegeben, tatsächliches Ergebnis unbekannt“. Er ist kein Erfolg und kein
  Fehlschlag; ein `failed` wäre erfunden (Premortem 3).
- `POST /api/automations/:id/resolve` mit `AutomationResolveBody`
  `{ claimKey, note }` (Notiz 1–300 Zeichen, Pflicht). Policy-Operation
  `automations.manage` — Mensch und Flotte, Agenten `deny`; keine neue Zeile in
  der Policy-Tabelle.
- Zulässig nur für einen Claim dieser Automation im Zustand `unknown` **ohne**
  `sessionId`/`runId`. Mit Referenz bleibt der Abgleich zuständig (sonst könnte
  ein späteres Ergebnis die Hand-Entscheidung überschreiben); andere Zustände
  ergeben `409`.
- Die Auflösung ist ein gewöhnlicher `claim_update` im Journal: Zustand
  `settled`, Ergebnis `abandoned`, `detail` = „manuell aufgegeben: <Notiz>“.
  Damit gibt sie das Budget frei und ist aus Journal + Snapshot rekonstruierbar
  (K7). Kein Replay, kein neuer Start — wer neu starten will, nutzt Run-now.
- Bedienung: hubctl `automations resolve <id> <claimKey> --note …` und in der
  PWA eine Taste am `unknown`-Eintrag im Verlauf (offline gesperrt).

## Folgen

`abandoned` ist eine additive Contract-Erweiterung; alle mitgelieferten Clients
werden gemeinsam aktualisiert, ältere zeigen den Rohwert als Text (ADR-0065).
Wer auflöst, steht nur in der Notiz und im Hub-Log, nicht als eigenes Feld —
für einen Solo-Hub reicht das; ein Mehrnutzer-Hub bräuchte ein Actor-Feld.
Der echte Absturz zwischen Claim und Dispatch ist als E2E-Drill belegt
(`SIGKILL` während einer langsamen Vorprüfung).
