# E2E-Gate (Playwright)

Stand: 2026-09-23 · Einführung: EPIC-P5 · Kommando: `npm run test:e2e`

Das E2E-Gate prüft jede Oberfläche und jeden Arbeitsablauf der PWA gegen
einen **echten Hub-Prozess**. Es ist ein Epic-Gate: Ein Epic gilt erst als
abgeschlossen, wenn `npm run gate` lokal und der Job `e2e` in der Pipeline
grün sind (siehe [`epics/README.md`](../epics/README.md), Gating).

## Was echt ist und was nachgebaut

| Teil | Im Gate | Warum |
|---|---|---|
| Hub | echter Prozess `packages/server/src/main.ts`, eigene Konfig | derselbe Boot-Pfad wie in Produktion (Config → DB → Adapter → Recovery → HTTP/WS) |
| PWA | frischer Build aus `packages/pwa/dist`, Chromium | `globalSetup` baut vor jedem Lauf neu, nie ein altes Bundle |
| Adapter | echte `@uacc/adapter-dummy` und `@uacc/adapter-opencode` | Adapter-, Worker- und Resume-Code läuft unverändert |
| Worker | `ProcessRunner`, pro Test umschaltbar auf `TmuxRunner` | tmux läuft auf einem **eigenen** tmux-Server (`TMUX_TMPDIR`) |
| Provider-CLI | [`e2e/support/bin/opencode`](../e2e/support/bin/opencode) | spricht dasselbe `run --format json`-Protokoll, ohne Cloud und Kosten |
| Suche | [`e2e/support/bin/qmd`](../e2e/support/bin/qmd) | eigener Index je Test, der echte qmd-Index bleibt unberührt |
| Projekte | zwei Git-Repos `alpha`, `beta` in einem Temp-Ordner | Worktrees, Diff, Skills und Suche laufen gegen echtes git |
| Discovery | leere `claudeDir`/`cursorUserDir` im Temp-Ordner | liest nie das echte `~/.claude` |
| Token | `hubctl token issue` gegen die Test-DB | derselbe Weg wie beim Einrichten eines Geräts |

Jeder Test bekommt einen **eigenen Hub** (Port, Daten, Projekte, Token,
tmux-Server). Tests teilen keinen Zustand und laufen parallel. Ein Hub
startet in etwa einer Sekunde.

### Stichworte für den nachgebauten `opencode`

| Im Prompt | Verhalten |
|---|---|
| — | Denkschritt, `read`-Tool, Antwort `Antwort auf: … · Session ses_e2e_… · cwd …`, Kosten `$0.0012` |
| `LANGSAM` | Zug bleibt 60 s offen (Stop, Attach, Kill) |
| `FEHLER` | Prozess endet mit Code 3 |
| `LIMIT` | Ende am Längenlimit, nur Denken |
| `GROSS` | Tool-Ergebnis über 2 KB |
| `DATEI` | legt `e2e-change.txt` im Arbeitsverzeichnis an |
| `WARTE<n>` | antwortet erst nach n Sekunden (Zug überlebt einen Hub-Kill) |
| `--session <id>` | setzt die Session fort, Antwort endet auf `(fortgesetzt)` |
| `--agent plan --` | Prompt-Optimierer für „Verbessern“ |

## Aufbau

```text
playwright.config.ts          Projekte: mobile (Pixel 7, alle Specs), desktop (nur @desktop)
e2e/support/hub.ts            TestHub: start, kill, restart, api, events, until
e2e/support/fixtures.ts       Fixtures hub, hubOptions, app; jeder Test scheitert bei pageerror
e2e/support/global-setup.ts   baut die PWA
e2e/support/bin/              nachgebaute CLIs
e2e/specs/*.spec.ts           Specs nach Bereich
```

## Laufen lassen

```bash
npx playwright install chromium     # einmalig
npm run test:e2e                    # ganze Suite, beide Projekte
npx playwright test e2e/specs/steer.spec.ts --project=mobile
npx playwright test --repeat-each=3 # Flacker-Suche vor einem MR mit neuen Specs
npx playwright show-report          # HTML-Bericht mit Trace, Screenshot, Video der Fehlschläge
npm run gate                        # typecheck + lint + vitest + E2E
```

Fehlt Chromium, scheitert der Lauf laut. Es gibt kein stilles Überspringen.

## Einen Test ergänzen

1. Spec im passenden Bereich anlegen oder erweitern. Titel auf Deutsch,
   Bezug in Klammern (`AC-P5-4`, `T5.10`, `BUG-0017`).
2. `app` für einen angemeldeten Browser, `page` + `hub` für den Token-Weg.
   Hub-Varianten per `test.use({ hubOptions: { runner: "tmux" } })`.
3. Zustand, der nicht Teil des Tests ist, über `hub.createSession()` /
   `hub.api()` herstellen. Den Teil, um den es geht, über die UI klicken.
4. Warten nur über `expect(...)` und `hub.until(...)`, nie über feste Pausen.
5. Neue Funktion, die der nachgebaute CLI nicht kann: Stichwort ergänzen und
   in der Tabelle oben eintragen.
6. `--repeat-each=3` lokal, dann erst committen.
7. Eine bekannte Lücke wird `test.fixme("<Bug/Task>: <erwartetes Verhalten>")`,
   nie ein gelöschter oder abgeschwächter Test.

## Abdeckung

| Bereich | Spec | Abgedeckt |
|---|---|---|
| Anmeldung | `auth` | Token-Eingabe, falsches Token, Reload, Klartext, Token wechseln |
| Navigation | `navigation` | Dock, Status-Seite mit Fähigkeiten, Theme bleibt, Einstellungen, Voice-Sheet |
| Sessions | `session` | Anlegen per UI, Gruppierung, Verlauf-Filter, Karten, Längenlimit, Bericht, Diff, Suche, Provider-Absturz |
| Steuern | `steer` | Antwort, Stop, Weiter mit derselben Provider-Session, Doppeltipp, zwei Geräte, abgelehnte Antwort |
| Handoff | `handoff` | PC → Handy → PC (live und nach Stop), gleiche native ID und gleiches Arbeitsverzeichnis |
| Neustart | `recovery` | Kill -9 mit exakter Event-Sequenz, gestoppte Session nach Neustart, Fortsetzen nach Kill zwischen Zügen, Übernahme eines laufenden Zugs unter tmux |
| Gefunden, Inventar | `discovery` | 20 Sessions binnen 10 s (AC-P5-1), Dedup, Subagent, unbekanntes Format, „Mehr laden“, Harness-Inventar |
| Links, Attach, Native-Open | `deeplink` | Deep-Link nach Reload, unbekannter Link, Attach nur mit laufendem tmux-Worker, Terminal-Befehl nur zwischen Zügen, Kopieren in die Zwischenablage |
| Arbeitsplatz | `workspace` | Archiv, Freigaben (ja/nein), Budget, Verbessern, Empfehlung, Skill-Kette, Diktat, Sprachbefehl „stopp“ |

### Bewusst offen (`test.fixme`)

| Test | Grund |
|---|---|
| Skill-Picker-Overlay | nur für Claude freigeschaltet, braucht einen nachgebauten `claude`-CLI |
| Offline-Neuladen | BUG-0015 (K10) |

Nicht im Gate: Passkey-Registrierung und biometrische Freigabe (WebAuthn)
sind nur bis „Passkey registrieren“ sichtbar geprüft. Echte Provider und
echte Geräte bleiben manuelle Abnahme (AC-P5-2).
