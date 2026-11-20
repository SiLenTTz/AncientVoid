# Epic-Status im Datenbaum (`npm run epics:status`)

**Art:** referenz

`scripts/epic-status.mjs` liest `epics/EPIC-P*.md` (plus `EPIC-000-*` als Sortierplatz) (nur Lesezugriff, Inhalte
werden nie verändert) und hebt jede Epic-Datei mit offenen Punkten im
Datenbaum farblich hervor (gelb/fett); Dateien ohne offene Punkte und
Nicht-Epic-Dateien (PRD, `README.md`) bleiben in normaler Farbe.

```
npm run epics:status            # Baum mit Farbe (TTY) bzw. ohne (Pipe)
npm run epics:status -- --json  # maschinenlesbar, für Editor-/Tool-Integration
npm run epics:status -- --plain # nie Farbcodes
npm run epics:status -- --epics <dir> # anderes Verzeichnis (Tests)
npm run check:epics  # Gate-Modus: meldet Status-/Checklisten-Drift mit Exit 1
```

`NO_COLOR` wird respektiert; `--color` erzwingt Farbe auch in Pipes.

## Erkennungsregeln

Eine Epic-Datei gilt als **offen**, sobald eine dieser Regeln greift. Die
Regel-IDs stehen in Ausgabe, JSON und Legende — jede Markierung ist damit
auf ihren Grund zurückführbar.

| ID | Regel | Beispiel aus dem Korpus |
|---|---|---|
| **S1** | Statustext nennt „offen“, „teilweise“ oder „bis auf“. Der Statustext ist der Wert der Zeile `**Status:** …` **bis zum ersten ` · `** — danach folgen Phase/Dauer/Abhängigkeit. | „Code abgeschlossen, **Geräteabnahme offen** (T35.10)“ (P0); „Roll-out **teilweise**“ (P20); „**bis auf** die Entscheidung in ADR-0034“ (P15) |
| **S2** | Der Statustext beginnt *nicht* mit Abschluss-Vokabular: `abgeschlossen`, `Code abgeschlossen`, `umgesetzt`, `Exit grün`, `grün`, `Fertiggestellt`. Konservativ (Fail-loud): nur ein ausdrücklicher Abschluss schließt; „Planungsentwurf“, „in Umsetzung“, „Umsetzung (Branch …)“, „Gebaut …“, „offen“, „Evaluations-Exit ‚vertagt‘“ … bleiben offen. | „**Planungsentwurf** · Umsetzung: gesperrt“ (P30–P31, P44, P54–P56); „**Umsetzung** (Branch …)“ (P42); „**Gebaut** (2026-10-28 …)“ (P19) |
| **C1** | Mindestens eine offene Markdown-Checkbox `- [ ]`, deren **Zeile keinen Delegationsvermerk** enthält („verschoben nach …“ oder „nach P<n>“). Delegierte Zeilen leben sichtbar im Ziel-Epic weiter und halten die Quelldatei nicht offen. | T12.4 in P12 (9 offene Checkboxen); P9/P10/P11 haben delegierte Zeilen („→ verschoben nach P12 T12.4“) und zählen daher nicht |
| **C2** | Expliziter `TODO:`-Marker (Doppelpunkt). | aktuell keine im Korpus |

### Sync-Gate (`check:epics`) — die Spiegelregeln K1/K2

Anzeige ist kostenlos; als Gate (in `gate` und CI) verlangt `--check`
beide Richtungen der Übereinstimmung — Statuszeile und Checkliste müssen
nach denselben Regeln zusammenpassen:

| ID | Regel |
|---|---|
| **K1** | Checkliste benutzt und vollständig abgearbeitet (nur erledigte oder delegierte Punkte, kein `TODO:`), aber der Statustext schließt nicht und nennt keinen Grund fürs Offensein (Planung, Entscheidung, On hold, Sperrung, Progress wie „in Umsetzung“) → Statuszeile (und `epics/README`) synchronisieren. |
| **K2** | Statustext im Abschluss-Vokabular, aber die Checkliste hat noch offene Punkte ohne Delegationsvermerk. |

Der Fall, der diesen Gate erzeugt hat: Epics wurden faktisch abgeschlossen
(Checkboxen grün, Retro geschrieben), Statuszeile und README aber nicht
nachgezogen — oder umgekehrt. Geschlossen wird ein Epic im Vokabular
**„abgeschlossen“**; Delegationen gehen per Vermerk in die Zeile und
Physisch nach `EPIC-000` (Menschen-Abnahme) oder ins Ziel-Epic.

### Bewusste Nicht-Signale (vermeiden False Positives)

- **🟡 teilweise / 🔴 in Retro-Blöcken:** Geschlossene Epics (z. B. P7)
  dokumentieren in ihrer Retro historische 🟡/🔴. Die Emojis sind daher kein
  Offen-Marker; der aktuelle AC-Zustand steckt in Statustext und Checkboxen.
- **DoD-Prosa:** „Kein TODO ohne Epic-Referenz“ (Definition of Done) enthält
  das Wort TODO, aber ohne Doppelpunkt — C2 greift nicht.
- **Negationen hinter ` · `:** „fachlich **keine offene**“ steht in der
  Abhängigkeits-Spalte, nicht im Statustext (S1 wertet nur das erste Segment).
- **Wortgrenzen:** „offene“/„offenbar“ (Komposita/Adverb) treffen auf
  `\boffen\b` nicht.
- **„Umsetzung“ ≠ „umgesetzt“:** Substantiv (Prozess läuft) vs. Partizip
  (fertig) — S2 unterscheidet beides bewusst über Präfix.

### Bekannte, gewollte Semantik

- Reste, die der Statustext ausdrücklich an ein anderes Epic übergibt
  („… Live-Abnahme am Handy → EPIC-P35 T35.16“, P22/P24/P36), lassen die
  Quelldatei geschlossen; das Ziel (P35) ist markiert. Verzichtet eine
  Datei auf das Wort „offen“ (P22), während die README es nachträgt, folgt
  der Baum der Datei — Änderungen an Epic-Inhalten sind tabu, die README
  paraphrasiert nur.
- P16 hält zwei nicht-delegierte, offene Checkboxen (T16.5/T16.8), deren
  Erledigung im Status an P35 gebündelt wird — C1 markiert P16 dennoch
  offen, weil die Zeilen selbst keinen Delegationsvermerk tragen.

## Pflege

- **Neues Status-Vokabular:** Vokabular-Listen (`OPEN_STATUS_CONTAINS`,
  `CLOSED_STATUS_PREFIXES`) liegen am Kopf von `scripts/epic-status.mjs`.
  Jede Erweiterung braucht einen Testfall in `scripts/epic-status.test.mjs`
  (jede Regel findet ihr gepflanztes Fixture — verschwindet sie, schlägt der
  positive Fall).
- **Kein Build-Schritt:** reines Node-ESM (`.mjs`), wie alle Skripte unter
  `scripts/` direkt lauffähig (Node ≥ 22.5).
- **Editor-/Explorer-Anbindung:** `--json` liefert `summary`, `rules` und je
  Datei `open`, `reasons` (Regel-IDs) und `counts` — stabiler Konsum für
  eigene Viewer (Datei-Explorer-Overlay, maki-Plugin o. Ä.), ohne die
  Erkennungslogik zu duplizieren.
