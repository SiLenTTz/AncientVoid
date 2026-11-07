# E2E-Gate (Playwright)

Stand: 2026-09-23 · Einführung: EPIC-P5 · Kommando: `npm run test:e2e`

Das E2E-Gate prüft jede Oberfläche und jeden Arbeitsablauf der PWA gegen
einen **echten Hub-Prozess**. Es ist ein Epic-Gate: Ein Epic gilt erst als
abgeschlossen, wenn `npm run gate` lokal und der Job `e2e` in der Pipeline
grün sind (siehe [`epics/README.md`](../epics/README.md), Gating).

**Kontingent-Ausnahme (T12.6, präzisiert durch P28):** Meldet GitLab
`ci_quota_exceeded`, bevor Jobs gestartet wurden, darf ein vollständiges
lokales `npm run gate` als Merge-Evidenz dienen. Der MR muss den lokalen Lauf
mit Branch/Commit, Ergebnis und sichtbaren Skips verlinken und den fehlenden
Remote-Lauf nennen. Ein fehlgeschlagener Quoten-Job wird dabei nie als grüner
CI-Lauf ausgegeben. Sobald Runner oder Kontingent wieder verfügbar sind, gilt
das normale Remote-Gate wieder. Seit [ADR-0049](adr/0049-selbstverwalteter-ci-runner.md)
laufen die Pipelines auf dem eigenen Projekt-Runner `av-docker` und sind nicht
mehr kontingentabhängig; die Ausnahme gilt damit nur noch bei echten
Runner-/GitLab-Ausfällen — der Ausfallpfad dafür steht im
[CI-Runbook](ci-runbook.md), inklusive lokalem Container-Repro.

## Was echt ist und was nachgebaut

| Teil | Im Gate | Warum |
|---|---|---|
| Hub | echter Prozess `apps/hub/src/main.ts`, eigene Konfig | derselbe Boot-Pfad wie in Produktion (Config → DB → Adapter → Recovery → HTTP/WS) |
| PWA | frischer Build aus `apps/pwa/dist`, Chromium | `globalSetup` baut vor jedem Lauf neu, nie ein altes Bundle |
| Adapter | echte `@ancientvoid/adapter-dummy` und `@ancientvoid/adapter-opencode` | Adapter-, Worker- und Resume-Code läuft unverändert |
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
| `PLAN` | To-do-Liste über `todowrite`, 1 von 4 erledigt (Fortschritt/ETA) |
| `KONTINGENT` | z.ai-Fehler „Usage limit reached for 5 hour … reset at …“, Exit 1 |
| `SERVERFEHLER` | OpenCodes „UnknownError: Unexpected server error“ (echte Zeile vom 2026-09-23), Exit 1 |
| `--session <id>` | setzt die Session fort, Antwort endet auf `(fortgesetzt)` |
| `--agent plan --` | Prompt-Optimierer für „Verbessern“ |

## Aufbau

```text
playwright.config.ts          Projekte: mobile (Pixel 7, alle Specs), tablet (800×1280 Touch, nur @tablet), desktop (nur @desktop)
e2e/support/hub.ts            TestHub: start, kill, restart, api, events, until
e2e/support/fixtures.ts       Fixtures hub, hubOptions, app; jeder Test scheitert bei pageerror
e2e/support/global-setup.ts   baut die PWA
e2e/support/bin/              nachgebaute CLIs
e2e/specs/*.spec.ts           Specs nach Bereich
```

## Laufen lassen

```bash
npx playwright install chromium     # einmalig
npm run test:e2e                    # ganze Suite, alle Projekte
npx playwright test e2e/specs/steer.spec.ts --project=mobile
npx playwright test --repeat-each=3 # Flacker-Suche vor einem MR mit neuen Specs
npx playwright show-report          # HTML-Bericht mit Trace, Screenshot, Video der Fehlschläge
npm run gate                        # typecheck + lint + vitest + E2E
```

Fehlt Chromium, scheitert der Lauf laut. Es gibt kein stilles Überspringen.

**In einem Hub-Session-Worktree** (`data/worktrees/<id>/`) fehlen eigene
`node_modules/@ancientvoid/*`. Node fände dann die Pakete des Haupt-Checkouts, und
der E2E-Hub liefe mit dem Code von `main` (BUG-0069). `test:e2e` und `gate`
brechen deshalb vorher mit `check:workspace-links` ab.
`node scripts/check-workspace-links.mjs --fix` setzt die Links auf den Worktree.

## Auf dem echten Handy (`npm run test:phone`)

Dieselben Specs laufen im Chrome eines per `adb` verbundenen Android-Handys (Projekt `phone`). Der Test-Hub
bleibt auf dem PC (nie dein Hub, nie deine Sessions); sein Port erscheint per `adb reverse` auf dem Handy als
`http://127.0.0.1:PORT`. Jeder Test öffnet einen eigenen Tab und schließt ihn wieder, bestehende Tabs bleiben
unberührt.

```bash
npm run test:phone                       # alle Specs der Liste PHONE_SPECS (playwright.config.ts)
npm run test:phone -- e2e/specs/steer.spec.ts
npm run test:phone -- --portrait         # stellt die Drehung nur für den Lauf auf Hochformat und danach zurück
```

Voraussetzungen: USB-Debugging oder drahtloses Debugging an, `adb devices` zeigt das Handy, Bildschirm an und
entsperrt (das Skript entsperrt nichts), Chrome installiert. **Hochformat:** im Querformat hat die Seite nur
~450 px Höhe; das Skript bricht dann ab, außer mit `--portrait`. Stirbt die DevTools-Verbindung mitten im Lauf
oder dreht das Gerät ins Querformat, endet der Lauf sofort (BUG-0055), statt jeden weiteren Test 15 s warten zu lassen. Bei mehreren Browsern auf dem Handy steuert es
ausschließlich den Socket, dessen `Android-Package` wirklich `com.android.chrome` ist (der Socket
`chrome_devtools_remote` ohne Zahl gehört oft Brave oder Edge). Das Skript ändert keine Handy-Einstellungen
(außer `--portrait`, danach wiederhergestellt) und installiert nichts.

Was auf dem Handy anders ist (und warum die Fixture es ausgleicht, `e2e/support/phone.ts`):

| Eigenheit | Ausgleich |
|---|---|
| Playwright setzt neuen Tabs ein Desktop-Fenster (1280×720) auf | `Emulation.clearDeviceMetricsOverride`; echte Größe z. B. 448×875 CSS-px, Pixeldichte 3 |
| Offene Bildschirmtastatur verschiebt die sichtbare Fläche (≈ 350 px); Klickkoordinaten liegen daneben | vor Klicks wird eine offene Tastatur per Zurück-Taste geschlossen (gemessen: bei geschlossener Tastatur trifft derselbe Klick) |
| Service Worker liefern nach einem Hub-Stopp den letzten Stand | `Network.setBypassServiceWorker` (wie `serviceWorkers: "block"` der anderen Projekte) |

Nicht auf dem Handy (sichtbar übersprungen oder nicht in der Liste): Mikrofon-Tests (Berechtigungsdialog),
Offline-Test (Service Worker), Kamera/QR, Push, zweiter Hub oder zweiter Browserkontext, Querformat-Spec
(ändert die Fenstergröße).

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
| Navigation | `navigation` | Dock (Medien statt Voice), Kopfzeile, Direktlinks, Status-Seite mit Fähigkeiten, Theme bleibt, Einstellungen |
| Werkzeugfläche | `tool-pane` | Detailspalte am Desktop, Kacheln bleiben gemountet (WebSocket-Zähler, Entwurf), Esc, Handy ohne Fläche |
| Einstellungen | `settings-layout` | sechs Gruppen, zwei gleich breite Spalten, fluchtende Bedienelemente, Handy einspaltig, Schalter, Theme |
| Sessions | `session` | Anlegen per UI, Gruppierung, Verlauf-Filter, Karten, Längenlimit, Bericht, Diff, Suche, Provider-Absturz |
| Steuern | `steer` | Antwort, Stop, Weiter mit derselben Provider-Session, Doppeltipp, zwei Geräte, abgelehnte Antwort |
| Handoff | `handoff` | PC → Handy → PC (live und nach Stop), gleiche native ID und gleiches Arbeitsverzeichnis |
| Unterbrechung | `interrupted-session` | Worker-Ausfall, Abbruchbericht, natives Fortsetzen, Archivieren, fehlende Deklaration, Hub-Neustart, Auto-Resume, unbekannter Status; Mobile + Desktop |
| Neustart | `recovery` | Kill -9 mit exakter Event-Sequenz, gestoppte Session nach Neustart, Fortsetzen nach Kill zwischen Zügen, Übernahme eines laufenden Zugs unter tmux, geplanter Neustart ohne Stop, Arbeit bleibt erhalten |
| Gefunden, Inventar | `discovery` | 20 Sessions binnen 10 s (AC-P5-1), Dedup, Subagent, unbekanntes Format, „Mehr laden“, Harness-Inventar |
| Links, Attach, Native-Open | `deeplink` | Deep-Link nach Reload, unbekannter Link, Attach nur mit laufendem tmux-Worker, Terminal-Befehl nur zwischen Zügen, Kopieren in die Zwischenablage, Worktree-Pfad, „Ins Projekt übernehmen“ |
| Layout | `layout` | letzte Nachricht nie unter der Steuerung, Steuerung aus-/einblendbar |
| Meldungen | `notifications` | Kontingent/Serverfehler als rote Karte oben rechts und im Chat, Weiter nach Fehler, Zug fertig, Glocke, Hub weg/wieder da |
| Fortschritt | `progress` | Plan-Fortschritt mit Restzeit, ohne Plan nur Laufzeit, Kontingent-Zeile |
| Arbeitsplatz | `workspace` | Archiv, Freigaben (ja/nein), Budget, Verbessern, Empfehlung, Skill-Kette, Diktat, Sprachbefehl „stopp“ |

### Bewusst offen (`test.fixme`)

| Test | Grund |
|---|---|
| Skill-Picker-Overlay | nur für Claude freigeschaltet, braucht einen nachgebauten `claude`-CLI |
| Offline-Neuladen | BUG-0015 (K10) |

Nicht im Gate: Passkey-Registrierung und biometrische Freigabe (WebAuthn)
sind nur bis „Passkey registrieren“ sichtbar geprüft. Echte Provider und
echte Geräte bleiben manuelle Abnahme (AC-P5-2).

## Live-Smoke nach jedem Epic

Nach dem Neustart der echten Hubs (`scripts/hub.sh stop && scripts/hub.sh start`,
Peers per `scripts/fleet-deploy.sh`) läuft `npm run test:live` gegen den laufenden Hub:
Übersicht, Flotte, Status, Bericht und Code-Suche einer vorhandenen Session,
Einstellungen ohne sichtbaren Schlüssel. **Nur lesend:** Es startet keine Session
und entscheidet nichts. Das Gerätetoken ist temporär und wird am Ende widerrufen
(`scripts/test-live.sh`).
