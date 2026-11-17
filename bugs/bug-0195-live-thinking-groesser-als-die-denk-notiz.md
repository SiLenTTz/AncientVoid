# BUG-0195 — das live übertragene Denken war größer und kastiger als das Denken sonst in der App

- **Status:** done
- **Schicht:** pwa (Chat-Ansicht, Live-Streaming ADR-0083)
- **Schwere:** S3 — inhaltlich richtig, aber die Live-Darstellung sah aus wie ein anderes,
  wichtiges Ding; das Denken wurde dadurch beim Zuschauen überhöht

## Beobachtung

Nutzerfund (17.11.2026, Handy/PWA): „das Streamen das thinkings wird immer so vergrößert
angezeigt … mach das genauso wie das thinking sowieso in der App angezeigt wird“.

Gemessen im Playwright-Harness (`live-streaming.spec.ts`, berechnete Styles):

```text
Live-Denken  [data-testid=chat-live-thinking]  fontSize 15px · italic · fg-dim · Rand 2px links · Akzent-Grund
Denk-Notiz   .turn-note.thinking               fontSize 12px · italic · fg-dim · kein Rand   · keine Grundfläche
```

Dazu kam eine uppercase-Zeile „denkt“ über dem Text. Das live übertragene Denken war also
**größer, eingerahmt und hinterlegt** — alles Merkmale, die das Denken sonst nicht hat.

## Erwartet

Eine live eingehende Denk-Zeile sieht aus wie eine Denk-Notiz in derselben Ansicht — sonst
entsteht der Eindruck, das Denken sei wichtiger als die Antwort.

## Ursache

`ChatTurns` baute für die Live-Blase eine eigene Struktur (`chat-live` + `chat-live-part
thinking`) und `49-live-stream.css` setzte dafür `font-size: calc(15px * …)` plus
Rahmen/Grund des Live-Kastens. Die persistente Darstellung nutzt `40-turns.css`
(`.turn-note` = `--text-sm`, `--fg-dim`; `.thinking` = kursiv) — zwei unabhängige
Definitionen derselben Sache.

## Fix

Die Live-Zeile trägt jetzt **dieselben Klassen** wie die Notiz (`turn-note thinking`), die
Live-Blase bekommt nur den Abstand (`chat-live-note`). Der Akzent-Kasten bleibt um die
Antwort („antwortet“), wo er hingehört. Damit ist die Gleichheit strukturell erzwungen,
nicht als zweite CSS-Definition nachgezogen.

## Mitgeprüft: läuft der Chat mit?

Nachgemessen (4 s Fenster mit **nur** Frames, Blöcke um 4000 ms verzögert, 20 Frames/s,
Viewport 390 × 420, Chat > 80 px über der Kante): der untere Rand der Live-Blase blieb
innerhalb des Scroll-Containers (`scrollBoundingClientRect.bottom − bubble.bottom ≥ −4 px`),
und der Container blieb in der Anheft-Schwelle der App (`scrollHeight − clientHeight −
scrollTop ≤ 48`, `scrollTop > 0`). **Ein Mitroll-Fehler war nicht reproduzierbar** — die
Höhen-Beobachtung in `SessionTail` (ResizeObserver + Restore-Poll) zieht den Container mit,
wenn die Blase wächst. Damit das so bleibt, steht die Messung jetzt als Test in
`live-streaming.spec.ts` („die Live-Blase wächst und der Chat bleibt am Fuß“).

## Nachweis

- Rot vor dem Fix: `Expected { fontSize: "12px" … } / Received { fontSize: "15px" … }`
  (ebenso `borderLeft` 0 px vs 2 px, Grund `rgba(0,0,0,0)` vs Akzentmischung).
- Grün nach dem Fix: `live-streaming.spec.ts` — „Live-Denken hat dieselbe Schrift wie eine
  Denk-Notiz im Chat“ und der Mitroll-Fall; mit `typewriter.spec.ts` zusammen **7 passed,
  1 skipped** (Claude-Fall, auf Windows übersprungen).
- `apps/pwa/test` 464 passed / 69 Dateien, `typecheck` und `lint` Exit 0.
- Sichtprüfung: Screenshot `test-results/live-thinking.png` (Denk-Zeile klein, dimmt, kursiv
  mit Cursor; Antwort im Akzent-Kasten).

## Neue Testquelle

`liveThinkingFrames` am Dummy-Adapter (Standard `false`, damit bestehende Frame-Zählungen
gelten bleiben) liefert denk-Frames — die deterministische Grundlage für diesen Test.
