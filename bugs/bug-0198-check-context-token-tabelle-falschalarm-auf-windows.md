# BUG-0198 — `check:context` meldet auf Windows „Token-Tabelle veraltet“, obwohl nichts veraltet ist

- **Status:** done
- **Schicht:** repo (Doku-Frischhalte `design-tokens-fresh`, EPIC-P63 T63.10)
- **Schwere:** S3 — der Gate-Lärm ist falsch, auch ärgerlich: er zwingt bei jedem Checkout zu
  `docs:design-tokens`, und dieser „Fix“ schreibt LF-Zeilen in ein CRLF-Dokument

## Beobachtung

Auf Windows, direkt nach einem Branch-Wechsel (git `core.autocrlf=true`, Arbeitsverzeichnis
damit CRLF):

```
check:context: [design-tokens-fresh] docs/design-system.md — Token-Tabelle veraltet — npm run docs:design-tokens
```

Beobachtet hintereinander beim Merge auf `fix/pwa-projektname-windows` (17.11.2026, zweimal)
und auf `bug/inventar-g19-s04-nach-design-system`. Nach dem verlangten
`npm run docs:design-tokens` war der Check grün — **ohne dass sich am Dateiinhalt etwas änderte**
(`git diff` leer). Das ist ein Fehlalarm, kein Drift.

## Ursache

`scripts/design-tokens-doc.mjs` baut das Markertableau mit `lines.join("\n")` (LF) und
`applyToDoc` ersetzt den Markerbereich mit diesem LF-Stück. `--check` vergleicht byte-genau
(`next !== doc`). In einem CRLF-Arbeitsverzeichnis (213 CRLF-Zeilen, 0 LF-Zeilen in
`docs/design-system.md` nach frischem Checkout) ist `next` damit **immer** verschieden — das
Dokument gilt per Konstruktion als veraltet. Der „Fix“ schreibt daraufhin LF-Zeilen mitten in
ein CRLF-Dokument (gemischte Zeilenenden), bis zufällig der gesamte Markerbereich LF ist und
der Check durchgeht. Auf Linux-Checkout-CIs (LF) tritt es nicht auf.

## Fix

`applyToDoc` richtet die Zeilenenden des erzeugten Tableaus an denen des Dokuments aus
(`doc.includes("\r\n") ? "\r\n" : "\n"`) und ersetzt als **Funktion** statt als String —
damit können `$&`-artige Tokenwerte nicht als Ersetzungsreferenz der
`String.replace`-Sprache gelesen werden.

## Nachweis (rot vor grün, gleicher Dateizustand)

```
git stash push -- scripts/design-tokens-doc.mjs
node scripts/design-tokens-doc.mjs --check   → exit 1, „Token-Tabelle veraltet“
git stash pop
node scripts/design-tokens-doc.mjs --check   → exit 0
node scripts/design-tokens-doc.mjs           → keine Arbeitsverzeichnis-Änderung (git status leer)
                                               CRLF-Zeilen 213, LF-only 0  (keine Mischung)
npm run check:context                        → OK (1926 Dateien)
```

Neue Probe `scripts/design-tokens-doc.test.mjs` (5 Fälle, in Tier A): LF-Dokument
unverändert, **CRLF-Dokument unverändert** (vor dem Fix rot), keine gemischten Zeilenenden,
CRLF- und LF-Fassung unterscheiden sich nur in den Zeilenenden, `$&` im Tokenwert bleibt
Text. Vor dem Fix: 4 von 5 rot (der LF-Fall grün). Nach dem Fix: 5 grün.

## Nummer

**0198** (0196 = Windows-Projektpfad auf PR-Zweig #93, 0197 = Inventar G19/S04).
