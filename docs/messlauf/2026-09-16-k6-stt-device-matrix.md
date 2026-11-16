# Messlauf — K6 Spracherkennung: Geräte-Fähigkeits-Matrix (T1.5-7)

**Messlatte:** AC-P1.5-8 (K6) — "20 Diktate ... Transkript in ≤ 1,5 s bei
mindestens 90 % der Läufe."

## Prüfstand

| Feld | Wert |
|---|---|
| Datum | 2026-09-16 |
| Commit | dieser Commit |
| Getestetes Gerät | Omarchy (Entwicklungsmaschine), Linux 7.1.9-arch1-2 |
| Browser | Chromium 151.0.7922.173 (Arch-Linux-Paket, **nicht** Google Chrome) |
| Messwerkzeug | Playwright (echter Chromium-Prozess, `--use-fake-ui-for-media-stream`) |

## Was hier real geprüft wurde

Die `SpeechRecognition`/`webkitSpeechRecognition`-Konstruktoren **existieren**
in diesem Chromium — aber ein echter Aufruf von `.start()` liefert **nie**
ein Ergebnis, nie einen Fehler und nie ein `end` innerhalb von 5 s (erster
Test, roher API-Aufruf ohne die App-eigene Fehlerbehandlung). Über die
tatsächliche `Composer`-Komponente (mit dem in T1.5-7 gebauten
Timeout/Fehlerpfad) endet ein Versuch stattdessen in einem sichtbaren
Fehlertext ("Spracherkennung fehlgeschlagen.") statt in einem für immer
hängenden "höre zu…"-Zustand.

**Ursache (öffentlich bekanntes Verhalten, nicht spekuliert):**
Open-Source-Chromium-Builds fehlt der Google-API-Schlüssel, den diese API
braucht, um den echten Spracherkennungsdienst zu erreichen — nur das
offizielle Google-Chrome-Binary hat ihn eingebaut. Das ist eine
Eigenschaft **dieser Entwicklungsmaschine**, keine Aussage über echte
Mobilgeräte.

## Geräte-Fähigkeits-Matrix

| Gerät/Browser | API vorhanden | Erkennung funktioniert | Geprüft |
|---|---|---|---|
| Omarchy / Chromium 151 (Arch-Paket) | ja | **nein** (kein API-Schlüssel) | echt, diese Session |
| Handy / Chrome (Android) | erwartet ja | **unverifiziert** | noch nicht getestet |
| Handy / Safari (iOS) | erwartet ja (eigene Dictation-Engine) | **unverifiziert** | noch nicht getestet |

## Was das nicht sagt — K6-Messung bewusst nicht durchgeführt

Die eigentliche K6-Messung (20 echte Diktate, Latenz Aufnahmeende →
Transkript, ≥ 90 % unter 1,5 s) **braucht eine echte Stimme an einem
echten Mikrofon** — das kann von hier aus nicht erzeugt werden (kein
Audio-Eingabegerät in dieser Umgebung, kein Mensch, der spricht). Diese
Messung ist bewusst auf den geplanten Live-Test auf dem tatsächlichen
Handy des Nutzers verschoben, nicht übersprungen oder durch eine
synthetische Ersatzzahl vorgetäuscht.

**Was stattdessen real verifiziert wurde** (strukturelle Korrektheit, ohne
echte Stimme messbar):
- Mic-Button-Klick startet Erkennung, zeigt sichtbaren „höre zu…"-Zustand
  mit Datenschutz-Hinweis (Playwright, echter Chromium, Screenshot).
- Ein hängender/fehlschlagender Erkennungsversuch endet sichtbar in einer
  Fehlermeldung, nicht in einem für immer blockierten Zustand (echter
  Timeout-/Fehlerpfad ausgelöst und beobachtet, nicht nur Code gelesen).
- Ein Browser ganz ohne die API (simuliert durch Entfernen der
  Konstruktoren vor dem Laden) zeigt den deaktivierten Button mit
  erklärendem Tooltip statt eines stillen No-Op (Playwright, Screenshot).
- Transkript landet immer im editierbaren Feld, nie automatisch
  abgesendet (Code-Pfad: `onChange`, kein `submit()`-Aufruf in `speech.ts`
  oder `Composer.tsx`).

**Nächster Schritt:** sobald der Nutzer die PWA auf dem echten Handy
öffnet, dort den fachbegriffslastigen Testsatz (git, diff, worktree,
JSONL, tool_use, Codex, Claude, tmux, MCP) 20× diktieren und die
tatsächliche Latenz + Erfolgsquote hier nachtragen.
