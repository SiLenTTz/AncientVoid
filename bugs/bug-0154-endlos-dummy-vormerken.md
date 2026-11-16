---
id: BUG-0154
slug: endlos-dummy-vormerken
status: done
severity: S2
area: setup
instance: dev
commit: "493fcfa"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/63"
epic: "P57"
created: 2026-11-13
reporter: TTFS-Messlauf (P57 T57.10)
---

# BUG-0154 — Endlos-Dummy: „Vormerken" statt Senden, erste Nachricht erreicht nie den Verlauf

## Gesehen

Der Wizard konfiguriert den Übungsadapter ohne `autoStopAfterEvents`
(Adapter-Default 0 = endlos). Die Dummy-Session läuft deshalb dauerhaft
„working" — die PWA zeigt in diesem Zustand als einzigen Sende-Knopf
**Vormerken** (`SessionTail.tsx:1331–1339`: „Läuft ein Zug, ersetzt Vormerken
den Senden-Knopf"). Eine vorgemerkte Nachricht wird gequeued und erscheint
erst im Verlauf, wenn der Zug endet — der Zug endet nie. Der Tutorial-Schritt
§7 („Nachricht senden, sie erscheint im Verlauf", M5 der TTFS-Route) ist auf
einer Frischinstallation damit unerreichbar.

## Erwartet

Der Übungsagent beruhigt sich nach endlicher Anzahl Events; danach wird der
Knopf zu **Weiter** (stopped) bzw. **Senden** und die gesendete Nachricht
erscheint als eigenes Event im Verlauf.

## Repro

Voraussetzung: frischer Wizard-Klon (`./setup.sh --yes --adapter=dummy`), PWA,
Token, Probe-Session (T57.9).

1. Session öffnen, einige Sekunden den Event-Strom laufen lassen.
2. Eingabefeld „Antworten…" antippen, Nachricht eintippen.

**Ergebnis nach Schritt 2:** Der einzige Primärknopf heißt „Vormerken"; nach
dem Tippen erscheint die Nachricht nur unter „Vorgemerkt", nie im Verlauf
(beobachtet bis Event #526, Messlauf-Läufe 9–11, 13.11.2026).

**Häufigkeit:** immer auf Frischinstallation (E2E unaffected: TestHub
konfiguriert `dummyAutoStop` begrenzt).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | frischer Wizard-Klon (Messlauf, temp) |
| Commit | `493fcfa` (Messlauf-Läufe 9–11) |
| Node-Version | v26.7.0 |
| Adapter | dummy (`eventsPerSecond: 5`, autoStop 0) |
| Repro-Weg | PWA (Playwright, Pixel-7-Viewport) |

## Logs

Messlauf-Fehler-Dump (Lauf 11, `failure.txt`, Auszug):

```text
"composer": "composer",
textarea: { ph: "Antworten…", value: "TTFS-Lauf 1: erste Steuerung vom Handy" },
Buttons: Pause/Stop/… — kein „Senden", kein „Weiter", nur „Vormerken"-Pfad;
Tail: „Letzter Auftrag: dummy user #526" (Strom läuft weiter)
```

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/erststart.spec.ts` | grün — deckt M5-Nachrichtenversand nicht ab (nur Erfolgssignal/Freigabe) |
| Messlauf | `scripts/messlauf-ttfs.mjs` | rot (M5, Läufe 9–11) — der ehrliche Frischinstallations-Pfad |

**Fix (mit diesem Bug landend):** `setup.sh` setzt `autoStopAfterEvents: 40`
für den Wizard-Dummy; Tutorial §7 nennt den Knopfnamen ehrlich (Weiter/
Vormerken). Ein E2E, das den Nachrichtenversand aus einer gestoppten
dummy-Session heraus belegt, bleibt offen (bugfix/Nachlauf).

## Eingrenzung

`setup.sh` (adapter_json dummy) × `packages/adapters/dummy/src/index.ts:39`
(Default 0) × `apps/pwa/src/features/session/SessionTail.tsx:1331–1348`
(Knopf-Logik). Produktfrage (Default endlos vs. begrenzt) gehört zum
Setup-Wizard-Kontext (P53-Nacharbeit); der Fix hier betrifft nur den
Wizard-Default, nicht den Adapter.

## Fix

Behoben mit `b8824949` (P57 T57.10): Der Wizard trägt den Übungsagenten mit
`autoStopAfterEvents: 40` ein (`setup.sh`, `adapter_json dummy`) — der Zug
endet, „Senden“ statt „Vormerken“, die erste Nachricht erreicht den Verlauf.
Tutorial angepasst. Status nachgezogen am 15.11.2026 (Commit in `HEAD` per
`git merge-base --is-ancestor` belegt).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] Fix landet im T57.10-MR; E2E-Lücke als Nachlauf notiert
