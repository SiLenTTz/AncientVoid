---
id: BUG-0043
slug: verlauf-springt-nach-unten-beim-lesen
status: done
severity: S2
area: pwa
instance: prod
commit: ""
forge: ""
epic: "P1.5"
created: 2026-10-08
reporter: jan
---

# BUG-0043 — Verlauf springt nach unten, während man weiter oben liest

## Gesehen

Im Sessions-Screen „springt“ die Ansicht. Gemessen mit Playwright (Pixel 7,
laufende Dummy-Session): Wer den Verlauf auf Position 200 scrollt, steht nach
2,5 s auf Position 6690 — jedes neue Event reißt die Liste nach unten.

## Erwartet

Wer unten ist, wird mit neuen Events nach unten geführt. Wer weiter oben liest,
bleibt dort.

## Repro

1. Laufende Session öffnen, „Verlauf“ → „Debuggen“, bis > 30 Events da sind.
2. Mit dem Mausrad/Touch nach oben scrollen.
3. Auf neue Events warten.

**Ergebnis nach Schritt 3:** Position springt ans Ende.

**Häufigkeit:** immer, solange Events eintreffen.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Produktiv-Hub, Handy-PWA |
| Commit | `a1ebc9d` |
| Repro-Weg | E2E (Playwright, Pixel 7) |

## Logs

```text
SCROLL {"before":200,"after":6690,"countBefore":43,"countAfter":93}
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/session-scroll.spec.ts` „BUG-0043 … oben liest“ | rot ohne Fix |
| E2E | dasselbe, „… wer unten ist, bleibt unten“ | grün (Schutz vor Überkorrektur) |

## Eingrenzung

`apps/pwa/src/features/session/SessionTail.tsx`: der Effekt auf `[events, activeTab]`
rief bei jeder Änderung `scrollTo(scrollHeight)` auf, ohne die Leseposition zu
prüfen. Fix: `stickRef` — nach oben lösen nur Nutzereingaben (Rad, Touch, Taste),
weil auch Layout-Änderungen scroll-Ereignisse auslösen.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Fix in derselben MR

## Nachtrag 05.11.2026 — verzögerte Scroll-Meldung (CI-Abschluss P27)

Im GitLab-Job 17778072745 trat der Fehler erneut auf; die Regression ist
lokal mit zurückgehaltenen Scroll-Meldungen reproduziert: Trotz tatsächlichem
Wheel nach oben zieht das nächste Event die Liste auf Position 4339 statt
unter 260. Vor Fix roter E2E `nach oben drehen ... vor der Scroll-Meldung`.

Ursache: `onWheel` markierte nur die Uhrzeit; `stickRef` blieb bis zur späteren
Scroll-Meldung aktiv. Ein vorher eintreffendes neues Event konnte deshalb
weiter ans Ende scrollen. Der Wheel nach oben löst das Mitlaufen jetzt sofort;
das normale Scroll-Signal aktiviert es beim Erreichen des Endes wieder.
Keine Grenzwerte oder bestehenden Assertions geändert. Die Fault-Injection
hält ausschließlich im Test die Scroll-Benachrichtigung zurück; Eingabe und
Browser-Scroll bleiben echte Playwright-/Browser-Aktionen.

Verifiziert: Desktop-/Timeout-/Scroll-Specs gemeinsam dreifach 36/36; voller
gemeinsamer Arbeitsbaum-Gate der CI-Blocker-Fixes grün (1152 Unit-/Integration,
285 E2E-Pässe, zwei bekannte Mobile-Handoff-Skips mit grünen Desktop-Läufen).
