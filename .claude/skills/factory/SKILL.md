---
name: factory
description: Orchestrator-Skill des Factory-Workflows (aus dem Harness-Template): Status lesen, Stories zerlegen, Bahn A/B wählen, verify-Gates und Abnahme gegen das PRD. Aktiv bei factory-Aufträgen, Spiel-/UI-Projekten mit PRD und .factory/.
---

# Factory im Projekt

Du bist der Orchestrator. Du arbeitest im Projektwurzelverzeichnis mit dem Factory-Workflow.
Der Skill wird von `factory init` aus dem Harness-Template erzeugt und enthaelt keine
Annahmen ueber den Ablageort des Harness.

**Oberstes Ziel:** ein vollstaendiges, LAUFFAEHIGES Produkt in bester Qualitaet — nicht
Module, die irgendwann zusammenpassen sollen. Das Produkt muss nach jeder Story startbar
und spielbar/benutzbar sein.

## Status lesen (immer zuerst)

```bash
factory init --status          # Intake-Zustand
factory progress show          # Stories, erledigt/gesamt, aktueller Schritt
cat .factory/verify/latest.json 2>/dev/null   # letztes Spielbarkeits-Urteil
git log --oneline | head -15
```

Ist Arbeit angefangen, setze sie fort (kein Neustart, keine Rueckfrage).

## Heartbeat (Pflicht — das Leitwerk zeigt den aktiven Lauf daran an)

Melde JEDEN Schrittwechsel, damit der Mensch den aktiven Lauf sofort findet:

```bash
factory progress now --story s2 --task s2-1 --phase bauen --note "Fadenkreuz + Schuss"
factory progress done s2-1 --note "verify gruen"
```

Phasen: `planen` `test` `bauen` `verifizieren` `review` `fixen` `doku` `warten` `fertig`.
Aufruf mindestens bei jedem Phasen-/Task-Wechsel und alle ~10 Minuten bei langen Schritten.

## Ablauf

1. **Intake klaeren:** bei `status: clarify` oder offenen kritischen Fragen zuerst Antworten
   dokumentieren (`factory clarify ask|answer`). Im Modus a triffst du sinnvolle Annahmen
   selbst, dokumentierst sie und machst weiter — nie auf den Menschen warten.
2. **Epic-Zerlegung (PFLICHT, vor dem ersten Task):** Der PRD wird NIEMALS als ein Task
   abgearbeitet. Zerlege in Stories (vertikale, abnahmbare Scheiben) und diese in kleine
   Tasks. Dokumentiere in `.factory/stories.md` im Format
   `- [ ] s2-1 Kurztitel — Akzeptanzkriterium` (Checkbox = Fortschritt, wird von
   `factory progress done` abgehakt). Keine PRD-Anforderung weglassen oder verwaessern.
3. **REIHENFOLGE-REGEL (Walking Skeleton zuerst):**
   - **S0 Geruest:** Projekt-Setup (Build-Tool, Sprache strict, Framework, Test-Runner,
     Linter, Playwright, npm-Skripte `dev build test lint typecheck preview e2e`). Danach
     `factory verify --phase scaffold` GRUEN (Seite rendert). Vitest nur auf Unit-Tests
     richten, sonst scheitern Playwright-Specs im Unit-Lauf.
   - **S1 Spielbarer Kern (vertikaler Schnitt, so duenn wie moeglich):** Start ->
     Interaktion -> Ergebnis mit EINER Zielart, EINEM Level, Platzhalter-Optik.
     `factory verify` inkl. E2E-Roundtrip GRUEN. Erst DANN geht es in die Breite.
   - **Danach inkrementell:** jede Story erweitert das laufende Produkt und endet mit
     `factory verify` gruen. Reine Logik-Module entstehen IM Rahmen des Features, das sie
     nutzt — nie auf Vorrat ("12.000 Zeilen Logik, aber kein Spiel" ist der Fehlerfall).
   - **Zum Schluss:** Polish-/Art-Pass, Performance, Abnahme gegen ALLE PRD-Kriterien.
4. **Zwei Bahnen — waehle je Task bewusst:**
   - **Bahn A — Executor** (`factory task new` + `factory run`): reine, deterministische
     Logik mit rotem Test. Task klein halten: EIN Modul, <= 3 Dateien, ~150-400 Zeilen.
     Orakel = vorher committeter roter Test. Bahn-A-Tests liegen in `tests/` (node:test),
     Vitest-Tests in `src/**/*.test.ts`. Der Executor laeuft im Container OHNE
     Netz/Browser — er kann nichts ausser Logik belegen. Grosse Integrationsaufgaben
     NIE als ein Executor-Task: erst Teilmodule, dann duenne Verdrahtung.
   - **Bahn B — Direktbau** durch dich (und Subagents): Geruest, Szenen, Rendering, Audio,
     UI/HUD, Assets, Verdrahtung. Hier gilt `factory verify` statt Orakel-Test. Du darfst
     committen, wenn `factory verify` gruen ist (eine Intention je Commit).
5. **Tasks anlegen (Bahn A):** `factory task new <story>-<nr> --test <suite>:<ziel> --goal "..."
   --allow <pfad>`; bei anspruchsvoller Logik `--kind projekt-visuell` (Opus), sonst Standard
   (Sonnet). Vertraege liegen in `.factory/contracts/*.json`. Ausfuehren: `factory run
   <name>` — das letzte stdout-JSON ist das Urteil. Bei `fail`: Ursache im Lauf-Report
   (`.factory/laeufe/<lauf>/report.md`) lesen, Vertrag praezisieren oder Task kleiner
   schneiden, neuer Name (`<name>-v2`) — nie dieselbe Anweisung blind wiederholen.
6. **Nach JEDER Story (Pflicht):** `factory verify` muss gruen sein; UI-/Optik-Stories:
   E2E-Roundtrip + Screenshots (`.factory/evidence/screens/*.png`) selbst ANSEHEN und
   kritisch gegen Design/PRD bewerten; unabhaengiges Review durch einen frischen Subagent
   (Opus) gegen PRD-Kriterien und Diff, Befunde abarbeiten; `factory progress done
   <story>`; Commit; naechste Story.
7. **Abnahme (vor jeder Fertig-Meldung):** `factory verify --phase final` (Typen, Lint,
   Tests, Build, Smoke, E2E) + ein Acceptance-Subagent in frischem Kontext prueft JEDES
   PRD-Kriterium einzeln mit Beleg (Test, Screenshot, Messung). Erst wenn alles belegt
   ist: `factory progress now --phase fertig`. "PRD 100 %" ohne Beleg ist verboten.

## Modellwahl (Balance aus Qualitaet, Tempo, Kosten)

| Aufgabe | Modell |
| --- | --- |
| Zerlegung, Architektur, Vertraege/rote Tests, Review, Abnahme, schwierige Fehlersuche | Opus (`opus`) |
| Umsetzung (Bahn B, Szenen, UI, Logik), Standard-Executor-Tasks | Sonnet (`sonnet`) |
| Suche, Status, Doku, Formatierung, mechanische Aenderungen | Haiku (`haiku`) |

- Subagents ueber das Agent-Tool starten und `model` explizit setzen; unabhaengige Teile
  PARALLEL (eine Nachricht, mehrere Agent-Aufrufe). Parallele Subagents duerfen nicht
  dieselben Dateien aendern.
- Scheitert ein Task zweimal, eskaliere eine Stufe hoeher statt zu wiederholen.
- Jeder Subagent bekommt einen vollstaendigen Auftrag (Ziel, Dateien, Akzeptanz,
  Verify-Befehl); er kennt den Chat nicht.

## Autonomie (Modus a, `.factory/config.json: "modus": "a"`)

- NIE anhalten, um Fortfahren oder Merge zu erfragen. Nach gruenem Gate: committen/mergen
  und naechsten Schritt. Halte nur bei einem echten Blocker an (kein Zugriff,
  widerspruechliche Vorgaben) und schreibe ihn mit `factory progress note` auf.
- Abbruch/Usage-Limit: beim naechsten Start Status lesen und am gespeicherten Stand
  weitermachen (`factory progress show`), nicht neu beginnen.
- Kontext voll? Stand in `.factory/stories.md` + `factory progress` sichern.
  Nichts davon haengt an deinem Gedaechtnis.
- Lange Kommandos (Build, E2E) im Hintergrund starten und Ergebnisse pollen statt zu blockieren.

## Visuelle Goal-Gates (Game-/UI-Projekte) — Pflicht

Logik-Gruen reicht NICHT. Belegt sein muessen (vor jedem Merge von UI-Arbeit, spaetestens
vor Abnahme): kompletter E2E-Browserroundtrip (ueber `npm run e2e`); Screenshots aller
Zustaende nach `.factory/evidence/screens/` und selbst betrachten; Content-Assertions
(kein Einfarb-Screen, Sprites sichtbar, HUD-Werte aendern sich); Spielt-sich-wirklich-Test
(mind. eine volle Runde mit echten Eingaben, Score-/Rundenende pruefen); Konsole
fehlerfrei, keine 404-Ressourcen.

## Qualitaets-Massstab fuer sichtbare Software — PFLICHT

Der Massstab ist: "Wuerde das ein Mensch als polishiertes Indie-Produkt erkennen?" — nicht
"laeuft die Logik durch". Rendering mit Tiefebenen, atmosphere, Animation — keine
fillRect-Bloecke als "Art"; Typo-Hierarchie, Buttons mit Hover/Active/Focus, lesbares HUD;
Game Feel (Shake, Hitstop, Partikel, prozedurale Sounds); Polish-Pass als eigene Story NACH
funktionaler Fertigkeit. Fuer ein Spiel dieser Groesse sind >= ~2000 Zeilen
Render-/Art-/UI-Code realistisch; deutlich weniger ist ein Warnsignal.

## Regeln

- Markdown-Import ist kein fertiger Scope und keine Ausfuehrungsfreigabe.
- Keine geheimen Werte in Aufgaben, Fragen, Tasks, Logs.
- Keine breiten `pkill`-Muster (nur eigene Prozesse beenden, z.B. ueber gespeicherte PIDs).
- Dev-/Preview-Server immer auf freien Port, nach Gebrauch beenden.
- Doku/Laufberichte duerfen an Haiku delegiert werden (schreibt `.factory/evidence/doku.md`).
- Details: `.factory/workflow.md` und `.factory/config.json`.
