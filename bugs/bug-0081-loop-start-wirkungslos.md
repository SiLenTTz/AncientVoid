# BUG-0081 — Loop-Start im neuen Session-Dialog „tut nichts"

- **Gemeldet:** 2026-10-30, Nutzer (Handy, echter Hub, Loops aSPARK-Factory/securesight-factory)
- **Status:** gefixt (MR folgt)
- **Komponente:** PWA `apps/pwa/src/features/loops/` + `new-session/CreateSession.tsx`

## Beobachtet

„Es passiert nichts wenn ich auf Start drücke wenn ich einen loop ausgewählt
habe." Kein Fehler, keine Navigation — nur ein kleiner grauer Text (`.loop-block`,
`dim`) irgendwo über dem Start-Knopf, auf dem Handy überlesbar.

Live am echten Hub (Port 7373, Playwright gegen die echte PWA) reproduziert,
drei Fallen mit deaktiviertem Start:

1. **Risky Betriebsart** (aSPARK `dark`/`autonomous`): Häkchen „Außenwirkung
   bestätigen" nötig — Bestätigung erscheint mitten im Formular, der Grund
   steht nur dim am Knopf (`Betriebsart „dark“ braucht deine Bestätigung`).
2. **Anbindungs-Formular „+neu“** (aSPARK *Art*, securesight *Betriebsmodus*/*Provider*):
   Pflicht-Selects **zeigen** ihre erste Wahl an (`LoopPicker.tsx`,
   `value={onboard.values[f.key] ?? f.choices?.[0]?.value ?? ""}`), der
   Zustand bleibt aber leer — `loopBlocker` (loop-form.ts) prüft
   `onboard.values[f.key]` und meldet „… fehlt“, obwohl das Dropdown gefüllt
   aussieht. Nutzerfüllung bringt nichts, solange er das Select nicht selbst
   anfasst.
3. Im selben Formular fehlt danach der Projektpfad — der oben im Dialog
   längst gewählt ist (separate Eingabe, hier nicht mitgefixt: brauchte eine
   Contract-Erweiterung `prefill: "project"` + ADR).

Erwartet: Der Start-Knopf nennt den Grund laut und erkennbar; angezeigte
Select-Vorgaben gelten als gewählt.

## Root-cause

- `apps/pwa/src/features/loops/LoopPicker.tsx:136` (Onboard-Selects): Anzeige
  fällt auf `choices[0]` zurück, Zustand `onboard.values[f.key]` bleibt `""`.
- `apps/pwa/src/features/new-session/CreateSession.tsx` (Blocker-Ausgabe):
  `class="dim loop-block"` — Grund optisch entkoppelt vom deaktivierten Knopf.

## Fix

- `loop-form.ts`: `onboardSelectDefaults()` — Pflicht-Selects ohne Wert
  bekommen ihre erste Wahl in den Zustand, sobald das Formular offen ist
  (Effekt im LoopPicker). Eigene Wahl wird nie überschrieben.
- Blocker wird `class="loop-block warn"` + `role="alert"` (CSS 22-loops.css).
- E2E-Deckung rot-vorher/grün-nachher: `e2e/specs/loops.spec.ts`
  „Anbindungs-Formular: Pflicht-Selects gelten als gewählt …“; Fake-Loop
  (`packages/adapters/testkit/src/fake-loop.ts`) hat dafür ein Pflicht-Select
  „Art“ bekommen (spiegelt die echten Connectors).

## Verwandt

- Minimale Eingaben: die Loop-Auswahl wird jetzt zusätzlich gemerkt wie
  Host/Adapter/Projekt (T8.4-Familie) — separater Feature-Commit im selben MR.
