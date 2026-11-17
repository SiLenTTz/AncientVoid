---
id: BUG-0204
slug: ubergrosser-aenderungs-diff-faellt-wegen-maxbuffer-komplett-raus
status: offen
severity: S2
area: hub
instance: pc
commit: ""
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

## Nächster Arbeitsschritt (nicht Teil dieses Berichts)

1. `maxBuffer` pro Commit-Diff deckeln **und** den Einzelfehler abfangen: betroffener Commit
   bekommt `files: []` plus einen echten Befund-Text statt eines Gesamtfehlers.
2. Obergrenze für die Zahl der Commits im View existiert schon (`MAX_COMMITS`, 200) — die
   Größenobergrenze pro Commit fehlt.
3. Test in `apps/hub/test/modules/sessions/diff.test.ts` mit einem Commit, dessen Patch das
   Limit überschreitet (rot-dann-grün).

## Betriebsnotiz zu dieser Session

Die Basis `3aef99e5` (lokales `main`, unrelated history) macht den Session-Diff von
`18830ec6-…` von Haus aus astronomisch. Solange der Live-Zweig lokal gepflegt wird, ist das
erwartbar; auf dem Handy sichtbar wird der Reiter für diese Session erst nach 1. oder nachdem
die Session-Basis auf einen Vorfahren der GitHub-Linie gesetzt wird.

## Nummer

Vorherige: BUG-0203 (Wurzel-Commit im Bereich). Nächste freie Nummer: **0205**.
