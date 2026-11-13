---
id: BUG-0159
slug: nyx-fab-feedback-blende-steht-dauerhaft
status: fixed
severity: S3
area: pwa
instance: local
commit: "f079676"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/457"
epic: "P10"
created: 2026-11-13
reporter: "Nutzerreport (mündlich): Tooltipp am Voice-FAB bleibt stehen"
---

# BUG-0159 — Die Feedbackblende des Nyx-Voice-FAB steht dauerhaft

## Gesehen

Nach mindestens einer abgeschlossenen Sprachaufnahme bleibt die Blende über dem
FAB (`.nyx-fab-toast`, z. B. „lokal · whisper-e2e · x,x s“) dauerhaft
sichtbar — auch lange nach dem Ende der Aufnahme, im Ruhezustand.

## Erwartet

Die Blende soll während der Aufnahme (bzw. des Erkennungslaufs) sichtbar sein
und das abgeschlossene Feedback (Erfolg wie Fehler, AC-P10-5 „endet sichtbar“)
nur für
ein Feedbackfenster stehen bleiben, danach automatisch verschwinden.

## Repro

Voraussetzung: Hub mit lokaler STT (im Test: Stand-in-Server aus
`e2e/specs/voice-local.spec.ts`), Session mit Composer, Fake-Mikro.

1. Composer-Feld fokussieren, FAB tippen → Aufnahme startet, Blende zeigt „Aufnahme …“.
2. FAB erneut tippen → Aufnahme endet, Erkennung läuft, Text landet im Feld,
   Blende zeigt das Feedback („lokal · … · x,x s“).
3. Warten (deutlich länger als ein plausibles Feedbackfenster).

**Ergebnis nach Schritt 3:** Die Blende ist immer noch da (vor dem Fix); erwartet: weg.
**Häufigkeit:** immer (jede abgeschlossene Aufnahme hintert `info`/`error` persistent).

Reproduziert via Test: `e2e/specs/voice-local.spec.ts` —
„Feedbackblende blendet nach dem Ende automatisch aus …“ (rot vor dem Fix,
Playwright mobile- Projekt, 2026-11-13).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (Test-Hub) |
| Commit | `main` zum Repro-Zeitpunkt |
| Node-Version | 22.18+ (vitest/Playwright-Stand des Repos) |
| Adapter | opencode (E2E-Fake-CLI) |
| Repro-Weg | PWA (Playwright Chromium) |

## Logs

Keine Server-Logs betroffen — reiner PWA-State.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | — (Logik hängt an Preact-Hook-State, kein DOM freies Modul) | — |
| E2E | `e2e/specs/voice-local.spec.ts` (neuer Fall BUG-0159) | rot ohne Fix, grün mit Fix |
| Contract (`adapter-testkit`) | | nicht betroffen |

## Eingrenzung

`apps/pwa/src/features/stt/use-push-to-talk.ts`: `info`/`error` werden nach
dem Aufnahmeende nie geleert (nur beim nächsten Start). `NyxFab.tsx` rendert
die Blende allein an der Bedingung `recording || listening || error || info ||
partial` — damit bleibt sie nach dem ersten Feedback für alle Zeit stehen.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` — Fix im selben MR (Auto-Ausblendung nach Feedbackfenster)
