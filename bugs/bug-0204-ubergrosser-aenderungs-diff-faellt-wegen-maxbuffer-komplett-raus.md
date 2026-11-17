---
id: BUG-0204
slug: ubergrosser-aenderungs-diff-faellt-wegen-maxbuffer-komplett-raus
status: done
severity: S2
area: hub
instance: pc
commit: "fix/0204-grosser-diff-teilausweis"
forge: ""
epic: ""
---

# Ein zu großer Änderungsdiff fällt komplett raus (maxBuffer), statt teilweisbar zu sein

## Symptom (live gemessen, 17.11.2026 nach dem Fix von BUG-0203)

Reiter **Änderungen** der Session `18830ec6-…` auf dem produktiven Hub:

```
git diff fehlgeschlagen: stdout maxBuffer length exceeded
```

Gemessene Zähler im Browser: `dateien 0 · commitzweige 0 · hunks 0 · zeilen 0`. Der
`sha^`-Fatal von BUG-0203 ist weg (Nachweis: die Meldung hat sich geändert) — jetzt kippt
derselbe View an der Größe.

## Ursache (gemessen)

`apps/hub/src/modules/sessions/diff.ts` diffelt pro Commit mit festen
`maxBuffer`-Grenzen (`4 MB` Numstat, `8 MB` Patch) und wirft bei Überschreiten eine
Ausnahme, die der Aufrufer als Fehler des **gesamten** Diffs deutet.

Diese Session ist ein Extremfall, aber ein echter: ihre Basis ist `3aef99e5` — die Spitze des
**lokalen `main`**, die mit der GitHub-Linie nichts zu tun hat (zwei getrennte Geschichten
seit der GitLab-/GitHub-Umstellung). Der Bereich `3aef99e5..HEAD` umfasst deshalb die
komplette GitHub-Geschichte: Hunderte Commits, tausende Datei-Diffs. Genau solche Bereiche
entstehen immer, wenn eine Session-Basis nicht Vorfahr des Zweiges ist.

## Erwartung / Ist

Erwartet: große Diffs werden **teilbar** dargestellt — pro Commit begrenzt, mit ausdrücklichem
Hinweis („mehr als N Dateien/Bytes — „ganzer Hunk“ zum Nachladen“), die übrigen Commits
bleiben lesbar. Ist: ein einziger überlimitscher Commit löscht den ganzen View.

## Behoben

`commitFiles` in `apps/hub/src/modules/sessions/diff.ts` zaehlt zuerst die geaenderten Zeilen
aus dem Numstat und laedt den Patch erst, wenn `COMMIT_DIFF_MAX_LINES` (4 000) nicht
ueberschritten ist. Darueber: `oversize: { files, changedLines }` als Teilbefund, die
uebrigen Commits bleiben vollstaendig. Scheitert schon die Dateiliste (z. B. maxBuffer),
steht `oversize: { files: null, changedLines: null }` da — nie wieder ein Gesamtausfall.
Die Oberflaeche zeigt den Befund unter dem Commit-Kopf (`diff-oversize`, Warnton):
„1 Datei, 4.500 geänderte Zeilen — Patch bewusst nicht geladen (zu groß für diese Ansicht)“.

## Rot-dann-gruen

- Hub (`apps/hub/test/modules/sessions/diff.test.ts`, echtes Git-Repo): neue Fallgruppe mit
  kleinem + 6 000-Zeilen-Commit + anschliessendem kleinem Commit. Vorher
  `expected [ { path: 'riesig.txt', …(4) } ] to deeply equal []` — **1 failed | 14 passed**;
  nachher **15 passed**.
- PWA-Helfer `oversizeNote` (`diff-lines.test.ts`): 2 neue Faelle (Zaehlen, und „ohne Zahlen
  ehrlich“). `npx vitest run apps/pwa/test/features/session` **79 passed** (12 Dateien).
- E2E (`e2e/specs/diff-markierungen.spec.ts`, zweiter Fall): `.diff-oversize` mit
  „1 Datei, 4.500 geaenderte Zeilen“, wahrend der kleine Commit daneben vollstaendig
  lesbar bleibt — **2 passed** (8,7 s).

## Gleichzeitig geschliffen (Sichtbarkeit)

- Segmente als Chips mit Inset-Ring (kein Versatz in der Monospace-Spalte), Mint/Rosé als
  Textfarbe am Segment, Durchstreichung nur 1 px in Rosé-Tönung, `+`/`−` in der
  Vorzeichen-Spalte mitfaerbigt (Zeichen selbst unveraendert).
- Legende als echte Erklaerung mit Chips `+ neu` / `− entfernt` plus Satz „markiert ist nur,
  was sich wirklich aendert“; die Erklaerung selbst wird nicht durchgestrichen.
- Screenshot-Review: Segmente, Fallback (Zeile ersetzt) und Teilbefund jeweils angesehen.
## Nummer

Vorherige: BUG-0203 (Wurzel-Commit im Bereich). Nächste freie Nummer: **0205**.
