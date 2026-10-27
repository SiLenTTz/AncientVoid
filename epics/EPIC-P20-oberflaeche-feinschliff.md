# EPIC-P20 — Oberflächen-Feinschliff: Vollbreite-Diff, Zoom, Einstellungen-Zugang, schimmernde Kontextleiste

**Status:** offen · **Phase:** P20 · **Dauer:** 3–4 Agenten-Tage · **Abhängigkeit:** fachlich keine. Es baut auf dem
Kachel-Arbeitsplatz aus P18 auf (Kontextleiste je Kachel, Diff in der Kachel). Präzedenz wie P13/P14/P17/P18: unabhängiges
Epic neben offenen Abnahmen.

Auslöser: Wunsch von Jan vom 2026-10-27. „Am Desktop wird viel Platz verschwendet, vor allem im Diff-Screen. Die App sollte
die komplette Breite nutzen. Zoomen mit Strg + Mausrad oder Strg +/− oder die Schriftgröße ändern. Ein Einstellungen-Icon
neben der Glocke. Prüfen, welche Einstellungen sinnvoll wären. Die Kontextanzeige als schimmernde Leiste.“

## 1. Ziel

Auf dem Desktop füllt jede Ansicht die verfügbare Fläche, am deutlichsten der Diff. Die ganze Oberfläche lässt sich
stufenlos vergrößern und verkleinern (Tastatur, Mausrad, Einstellungen). Einstellungen sind mit einem Tipp neben der
Glocke erreichbar. Der Kontext einer Session wird als Leiste gezeigt, die Füllstand und Zustand auf einen Blick lesbar macht.
Die Handy-Ansicht bleibt in Aufbau und Höhe unverändert.

Ist-Aufnahme (2026-10-27, `feat/p18-desktop-workspace`):

| Wunsch | Stand |
|---|---|
| Volle Breite | P18 T18.1 hebt den 1680-px-Deckel des Splits auf (noch nicht gemergt). **Befund Diff-Screen:** (1) eine einzelne Kachel ist für Chat auf 1200 px Zeilenlänge begrenzt, das gilt auch für den Diff; (2) das Dock mit Antwortfeld bleibt auf dem Diff-Tab voll offen und nimmt rund 40 % der Kachelhöhe; (3) die Dateiliste steht über dem Code statt daneben. Die Nebeneinander-Ansicht der Hunks gibt es schon (Querformat ab 640 px). |
| Zoom | nur der Pinch-Zoom-Schalter (`app/zoom.ts`, viewport-Meta). Kein Strg+Rad, kein Strg+/−, keine Skala. |
| Einstellungen-Icon | fehlt. Einstellungen erreicht man nur über das untere Dock. |
| Kontext-Anzeige | reine Textzeile `Σ … Tokens · Kontext 1 % · frei … von …` (`.run-tokens`). |

## 2. Scope (In / Out)

**In:**
- **Diff und Lese-Tabs:** In einer Desktop-Kachel haben Diff, Bericht, Suche und Code keinen Breitendeckel, das Dock klappt dort
  weg (ein Tipp bringt es zurück), im Diff steht die Dateiliste klebend neben dem Code mit Sprung zur Datei. Mobil unverändert.
- **UI-Zoom:** Skala 70–200 % in 10-%-Schritten pro Gerät (`localStorage`), per Strg+Mausrad, Strg+`+`/`=`/`−`/`0` und
  Einstellungen. Layouthöhen (Tail, Kacheln, Dock) bleiben korrekt.
- **Einstellungen-Icon** neben der Glocke (Mobil, Desktop-Liste, Kachel-Ansicht).
- **Einstellungen prüfen:** Abschnitt „Darstellung“ (Zoom, Animation der Kontextleiste) und eine begründete Empfehlungsliste
  weiterer Einstellungen (nur die Liste, die Umsetzung erst nach Rücksprache).
- **Kontextleiste:** schimmernde Leiste mit Füllstand, Schwellen (80 % / 95 %), „unbekannt“-Zustand, Zahlen im Tooltip und
  Text, `prefers-reduced-motion` respektiert.
- **Ausrollen:** Hub auf allen Systemen der Flotte mit dem Stand von `main` neu starten.

**Out:** Neue Provider-Zahlen (Kontextgröße je Modell bleibt ADR-0032), Themes über Hell/Dunkel hinaus, freies Ziehen von
Kachelgrößen (P18 Out), Änderungen am Server, Umsetzung weiterer Einstellungen aus der Empfehlungsliste.

## 3. Design-Details

- **Struktur (ADR-0020):** `apps/pwa/src/app/ui-scale.ts` (Skala, Tastatur, Mausrad), `apps/pwa/src/features/session/ContextBar.tsx`
  (Leiste, im Feature-Modul, weil sie `run-stats.ts` nutzt und `shared` nichts aus `features` importieren darf), Diff in `apps/pwa/src/features/session/DiffPane.tsx`, Einstellungen in `apps/pwa/src/features/settings/`,
  Zahnrad neben der Glocke in `features/notifications/Notifications.tsx`. Kein Server-Code.
- **Zoom-Technik:** CSS-Eigenschaft `zoom` auf `<html>` und eine Variable `--ui-zoom`. Viewport-Höhen werden durch die Skala
  geteilt (`calc(100dvh / var(--ui-zoom))`), sonst wachsen Layouts über den Bildschirm. Die Höhenmessung in `SessionTail`
  (`tailMaxHeight`) wird mit Skala 150 % geprüft. Die Browser-eigene Zoomung wird für Strg+Rad/±/0 abgefangen, damit nicht
  doppelt skaliert wird. Der Pinch-Zoom-Schalter bleibt unverändert.
- **Kontextleiste:** reines CSS (animierter Verlauf auf der gefüllten Fläche, `transform`/`background-position`, keine
  JavaScript-Animation), `role="meter"` mit `aria-valuenow`/`-min`/`-max`/`-valuetext`. Zustände: normal, warn (≥ 80 %), err
  (≥ 95 %), unbekannt (gestreifte, ruhige Fläche mit Text „Kontext unbekannt“). Bei `prefers-reduced-motion` oder
  abgeschalteter Einstellung steht der Schimmer still.
- **Messlatte:** Die Animation darf K2 nicht verschlechtern. Der Vier-Kachel-Lauf (`scripts/k2-tiles.mjs`) wird mit Leiste
  wiederholt.

## 4. Aufgaben

- [ ] **T20.1 — Diff und Lese-Tabs in voller Breite und Höhe.** Kein 1200-px-Deckel für Lese-Tabs, Dock klappt in der Kachel weg,
  Dateiliste neben dem Code (klebend, mit Sprung). E2E-Spec misst Breite, Höhe und Verhalten, auch das Handy (gestapelt wie zuvor).
  AC-P8-5.
- [ ] **T20.2 — UI-Zoom.** `ui-scale.ts`, Strg+Rad, Strg+`+`/`−`/`0`, Anzeige der Stufe, Höhenkorrektur. Unit-Tests der Skala,
  E2E bei 150 % und 70 %.
- [ ] **T20.3 — Einstellungen-Icon.** Zahnrad neben der Glocke, Mobil, Liste, Kachel-Ansicht, Tastaturbedienung und Name.
- [ ] **T20.4 — Einstellungen: Darstellung und Empfehlungen.** Abschnitt „Darstellung“ (Zoom-Regler, Animation), Empfehlungsliste
  in `docs/einstellungen-empfehlungen.md`.
- [ ] **T20.5 — Schimmernde Kontextleiste.** `ContextMeter`, Schwellen, unbekannt, reduced-motion, in Session-Kopf und Kachel.
  K2-Wiederholung.
- [ ] **T20.6 — Ausrollen.** MRs gemergt, Hubs aller Flotten-Hosts neu gestartet, Stand je Host geprüft (`/api/health`,
  Commit), Test-Hinweise.

## 5. Acceptance Criteria

- **AC-P20-1:** Auf 2560 × 1440 nutzt der Diff-Screen ≥ 90 % der Kachelbreite (Dateiliste + Code) und ≥ 75 % der Kachelhöhe als
  Lesefläche (E2E misst beides). Der Vorher-Wert wird vor der Änderung mit demselben Spec gemessen und im Abschlussbericht genannt.
- **AC-P20-2:** Strg+Mausrad, Strg+`+`, Strg+`−`, Strg+`0` und der Regler ändern die Skala von 70 bis 200 %. Reload behält sie.
  Tail, Dock und Kacheln liegen bei 70, 100 und 150 % vollständig im Bild (keine Seitenscrollbalken, Eingabefeld sichtbar).
- **AC-P20-3:** Ein Zahnrad steht neben der Glocke und öffnet die Einstellungen, auf Mobil, in der Desktop-Liste und mit
  Tastatur.
- **AC-P20-4:** Die Kontextleiste zeigt Füllstand in Prozent, wechselt bei 80 % auf Warn und bei 95 % auf Fehler, zeigt ohne
  Provider-Zahl ausdrücklich „unbekannt“ und steht bei `prefers-reduced-motion` still.
- **AC-P20-5 (K2):** Vier Kacheln zu je 30 ev/s mit Leiste: kein Frame-Lag über 200 ms.
- **AC-P20-6:** `layout.spec.ts` (Inhaltsanteil ≥ 50 % auf 390 × 844) und alle Mobile-Specs bleiben grün.
- **AC-P20-7:** Nach dem Ausrollen meldet `/api/health` auf jedem Host denselben `main`-Commit.

## 6. Premortem

1. **CSS-`zoom` bricht Höhen.** `100dvh`, `getBoundingClientRect` und Sticky-Elemente verhalten sich unter `zoom` anders.
   *Mitigation:* Höhen durch `--ui-zoom` teilen, E2E bei 70/100/150 %, Screenshot-Sichtprüfung vor dem Commit.
2. **Doppeltes Zoomen** (Browser und App). *Mitigation:* Strg+Rad und Strg+`+`/`−`/`0` werden abgefangen. Ein Hinweis in den
   Einstellungen nennt, dass die Browser-Zoomung dafür ersetzt ist.
3. **Schimmer kostet Leistung** bei vier Kacheln. *Mitigation:* nur `transform`/`opacity`, kein Layout, `will-change` sparsam,
   K2-Wiederholung (AC-P20-5), Abschalter.
4. **Diff-Umbau verschlechtert Mobil.** *Mitigation:* Zwei-Spalten-Layout nur ab 1280 px, Mobil-CSS unberührt, AC-P20-6.
5. **Ausrollen trifft einen Host, der nicht erreichbar ist** oder dessen Checkout schmutzig ist. *Mitigation:* je Host Stand
   prüfen, bei Abweichung nicht erzwingen, sondern melden (kein Force, keine Überschreibung lokaler Änderungen).
6. **Unmerged Stand wird ausgerollt.** *Mitigation:* Ausrollen nur von `main` nach Merge der MRs (T20.6), nie von einem Branch.

## 7. Definition of Done

- Alle AC grün mit Beleg. `npm run gate` grün (inklusive `check:workspace-links`, `check:arch`). Jede neue UI-Funktion hat
  einen Spec in `e2e/specs/`.
- Erreichbar: Zahnrad, Zoom-Kürzel und Leiste sind ohne Konfiguration da. Die Zoom-Kürzel stehen in den Einstellungen.
- Mobile-Specs unverändert grün (AC-P20-6).
- Hubs aller Flotten-Hosts laufen auf demselben Stand (AC-P20-7), belegt im Abschlussbericht.
- `retro` am Ende, Abschnitt in dieser Datei.
