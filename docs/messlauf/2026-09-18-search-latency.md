# Messlauf — Sprachsuche-Latenz (T3.8, EPIC-P3 §3)

**Datum:** 2026-09-18 · **Commit:** `4e8981f` · **Messlatte:** keine eigene
K-Nummer in PRD §9 (K6 ist STT-Latenz, nicht Suche) — dieser Messlauf
dokumentiert die reale Zahl, damit sie in `packages/server/src/search.ts`s
Doc-Kommentar und dem Epic zitierbar ist, ohne eine nicht existierende
Messlatte zu erfinden.

## Umgebung

- Node v26.7.0, Linux 7.1.9-arch1-2 x86_64 (Maschine sonst in Ruhe)
- `qmd` (npm `@tobilu/qmd`) v2.8.3, real installiert, mit real bereits
  lokal gecachtem Embedding-Modell `embeddinggemma-300M-Q8_0.gguf`
  (`~/.cache/qmd/models/`) — kein Modell-Download während der Messung
- Test-Collection: eine eigens für diesen Messlauf angelegte
  `qmd collection` über `AncientVoid`s eigene `**/*.md`-Dateien (5 Dokumente,
  18 Chunks, danach wieder entfernt — kein Rest im echten Nutzer-Index)
- Query: `"worktree isolation approval"` (real, gegen echten Repo-Inhalt
  passend)

## Kommando

```bash
qmd search "worktree isolation approval" -c ancientvoid-messlauf --format json -n 5 --full-path
qmd query $'lex: worktree isolation approval\nvec: worktree isolation approval' -c ancientvoid-messlauf --format json -n 5 --full-path --no-rerank
qmd query "worktree isolation approval" -c ancientvoid-messlauf --format json -n 5 --full-path
```

Gemessen mit Bashs eingebautem `time` um jeden Aufruf.

## Rohzahlen (n=3 bzw. n=2, Sekunden, real gemessen)

| Modus | Läufe | Median |
|---|---|---|
| `qmd search` (BM25, kein LLM) | 0.139, 0.131, 0.133 | **0.133s** |
| `qmd query` mit explizitem `lex:`+`vec:`-Dokument, `--no-rerank` (**gewählter Default in `search.ts`**) | 3.145, 3.259, 3.175 | **3.175s** |
| `qmd query <text>` (Standard: Auto-Expansion + Reranking) | 30.908, 3.293 | n/a — siehe unten |

## Was das nicht sagt

- **Der 30.9s-Ausreißer im dritten Modus wird nicht weggemittelt.** Zwei
  Läufe, ein Faktor-9-Unterschied — vermutlich ein Kaltstart-Kosten für
  ein zusätzliches Modell (Query-Expansion nutzt laut `qmd status` ein
  eigenes `qmd-query-expansion-1.7B`-Modell, das beim ersten Aufruf dieser
  Session noch nicht geladen war). Mit n=2 ist das keine belastbare
  Streuungsaussage — der Modus wird deshalb in `search.ts` ohnehin nicht
  verwendet, genau wegen dieser Unvorhersehbarkeit.
- **`--no-rerank`-Hybridmodus (gewählter Default) ist stabil** (3.15-3.26s,
  geringe Streuung über 3 echte Läufe) — aber ~3s ist immer noch spürbar
  langsamer als ein "tippen und sofort Ergebnisse sehen"-Gefühl. Die
  PWA-UX (noch nicht gebaut) muss das als "Suche läuft…"-Zustand zeigen,
  nicht als Live-Suggest.
- **Nur eine Query, eine Collection-Größe (5 Dokumente) gemessen.** Eine
  größere, reale Codebasis (Hunderte Dateien) würde die BM25-Suche kaum
  verlangsamen (Index-basiert), könnte aber die Embedding-Suche im
  Hybrid-Modus messbar beeinflussen (mehr Kandidaten-Vektoren) — nicht
  gemessen, ehrlich offen.
- **Kein Netzwerk-Faktor gemessen hier** — die Egress-Freiheit (kein
  externer Call) ist separat, real via Proxy-Poisoning verifiziert in
  `packages/server/test/search.test.ts`, nicht Teil dieses Latenz-Messlaufs.

## Konsequenz für `search.ts`

`searchProject()` verwendet den mittleren Modus (expliziter `lex:`+`vec:`-
Query-Dokument, `--no-rerank`) als einzigen, festen Suchpfad — die
±3s-Latenz ist real, klein genug für eine "tippen, kurz warten, Ergebnis
sehen"-mobile-UX, und um einen Faktor 10 verlässlicher als der
Auto-Expand-Modus.
