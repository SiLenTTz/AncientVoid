# ADR-0039 — Session an einen anderen Provider übergeben

**Status:** akzeptiert · **Betrifft:** `packages/core/src/modules/handover/`, `SessionManager.handover*`,
`apps/hub/src/modules/sessions/handover.routes.ts`, PWA `features/session/Handover.tsx`, EPIC-P21 T21.2

## Kontext
Login abgelaufen, Rate-Limit oder Kontingent erschöpft stoppen einen Lauf (ADR-0015 benennt den Fehler). Bisher half nur, am PC
neu anzumelden oder die Aufgabe von Hand in eine neue Session zu kopieren.

## Entscheidung
1. **Neue Session statt Umschalten.** Ein Adapter-Prozess wird nie auf einen anderen Provider „umgebogen“ (Resume-Referenzen, ADR-0036,
   sind providerspezifisch). `POST /api/sessions/:id/handover` startet eine **neue** Session im selben Projekt beim gewählten Adapter/Modell.
2. **Kontext = erzeugter Text, nicht der ganze Verlauf.** `buildHandoverPrompt` (rein, aus dem Event-Strom, K7): Auftrag, letzte Eingabe,
   letzte drei Antworten, Werkzeug-Zählung, Grund. ≤ 3500 Zeichen (K5), Schlüssel werden geschwärzt. Die Änderungen liegen im Arbeitsverzeichnis,
   der Text verweist auf `git status`/`git diff`.
3. **Nie still.** `GET …/handover` liefert den Vorschlag, die PWA zeigt Ziel, Modell (nur bei `modelChoice: "start"`) und den
   **editierbaren** Text; gestartet wird erst mit „Übergeben“.
4. **Verlinkt.** Beide Sessions erhalten ein Event: `session.handover_out` (Ziel) und `session.handover_in` (Quelle). Kein Contract-Schema ändert sich,
   es sind neue `system`-Event-Arten.
5. **Nur Menschen.** Agenten-Tokens (Policy „approve“) bekommen 403.

## Folgen
Banner erscheint bei `auth`, `rate_limit`, `quota`, `network`, `server`, solange nach dem Fehler keine Antwort und kein neuer Prompt kam.
Automatische Provider-Wahl und Übernahme von Anhängen sind bewusst nicht Teil (Out of Scope P21).
