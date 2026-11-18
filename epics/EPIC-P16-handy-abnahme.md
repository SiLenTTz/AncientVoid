# EPIC-P16 — Handy-Abnahme der E2E-Specs

**Status:** abgeschlossen 2026-11-18 (Code + automatisierte Tests grün) — Menschen-Abnahme nach P000 verschoben · abgeschlossen mit Restabnahmen in [EPIC-P35 Endabnahme-Block](EPIC-P35-harness-paritaet-fortsetzen-provider.md) (T16.5 zweiter Origin und T16.8 → T35.10) · **Phase:** P16 · **Dauer:** 0,5–1 Agenten-Woche · **Abhängigkeit:** P15-Code liegt (ADR-0034-Entscheidung offen). P12-Geräteabnahme (T12.4) ist offen; dieser Epic wiederholt sie nicht, er hält fest, was der automatische Lauf auf dem Pixel 9 Pro XL am 2026-10-09 gesehen hat. Umsetzung startet nicht, bevor P12-Exit und die ADR-0034-Entscheidung geklärt sind — die Datei ist die Liste, kein Freibrief.

Auslöser: Volllauf der PWA auf dem echten Handy (Chrome, `adb`/CDP, Test-Hub
auf dem PC, nie der persönliche Hub). Kernliste Hochformat: 51 bestanden,
5-mal dieselbe Anmeldung, 4 bewusst übersprungen. Ein früherer Volllauf verlor
die DevTools-Verbindung. Eine Zusatzliste (82 Tests) lief an; das Gerät lag
gegen Ende im Querformat, diese Fehlschläge zählen nicht als Hochformat-Befund.

## 1. Ziel

Dieselben Abläufe, die das Playwright-Gate im Pixel-7-Profil prüft, laufen auf
dem eigenen Handy durch, ohne dass ein stiller Token-Schirm, ein toter
DevTools-Socket oder ein aus dem Bild geschobenes Feld als „alles grün“
durchgeht. Was nur ein Mensch prüfen kann (Flugmodus, Sperrbildschirm-Push,
TalkBack, echte Stimme), bleibt bei T12.4 und wird hier nicht als erledigt
behauptet.

Messlatten: K10 (Offline) ist auf dem Handy ausdrücklich nicht gelaufen
(Service Worker ist im Handy-Lauf abgeschaltet). K1–K9 wurden in diesem Lauf
nicht neu gemessen.

## 2. Scope (In / Out)

**In:** Die drei gesehenen Defekte BUG-0054, BUG-0055, BUG-0056. Die Lücken
der Handy-Liste (zweiter Hub, zweiter Browser, Mikrofon-Dialog, Querformat
über die echte Drehung). Der Lauf soll abbrechen, wenn das Gerät das
Hochformat verlässt oder der Socket stirbt, statt dutzende Tests rot zu
färben.

**Out:** Produktfixes in diesem Dokument (die schreibt `bugfix`). Die
menschliche Matrix aus T12.4 (Push im Sperrbildschirm, Flugmodus, 200 % Text,
TalkBack, Teilen-Menü, WAN, Fachbegriff-Diktat). Ein zweites Häkchen für
BUG-0043 bis BUG-0053, die auf diesem Stand schon behoben sind.

## 3. Design-Details

Gemessen am 2026-10-09, Pixel 9 Pro XL, Chrome 154, Commit `8661491`,
`npm run test:phone`.

**Kernliste, Hochformat (60 Tests, 8,5 min):** 51 bestanden, 4 übersprungen
(drei Diktat-Tests wegen des Mikrofon-Dialogs, Offline wegen des blockierten
Service Workers), 5 fehlgeschlagen. Alle fünf scheitern vor dem Ablauf an der
Überschrift „AncientVoid“: die Token-Seite steht da, das Feld ist gefüllt, kein
Fehlertext (BUG-0054). Dieselben Abläufe sind im selben Lauf sonst grün.

**DevTools (ein Volllauf von drei):** nach den ersten Tests Timeout
`connectOverCDP` 15 s, danach 51 Fehlschläge ohne App (BUG-0055). Der Socket
ohne Nummer auf dem Gerät gehört Brave, nicht Chrome.

**Zusatzliste (82 Tests, 21,1 min):** 53 bestanden, 28 fehlgeschlagen. Zu
Beginn Hochformat, am Ende `ROTATION_90`. Als Produktbefund im Hochformat
bleibt: nach „Letzte Commits“ hat „Code durchsuchen“ den Viewport-Anteil 0
(BUG-0056). Der Rest dieser 28 ist keiner neuer Defekt, bis er im Hochformat
isoliert ist:

| Beobachtung | Einordnung |
|---|---|
| `setInputFiles` / `fill`: „Target page … has been closed“ | Seite weg, gehäuft; Querformat-Drehung oder Dateidialog. Kein eigener Produktfehler isoliert. |
| Fokuswechsel tippt trotzdem „geheim“ ins neue Fenster | Die Vorschau zeigte das neue Ziel schon vor dem Tipp (`focusMs: 30`). Auf dem schnellen Desktop gewinnt der Tipp das Rennen, auf dem Handy die Vorschau. Spec-Timing, kein verweigertes Tippen. |
| „Session links wählen“ fehlt | Spec verlangt ≥ 1280 px. Das Handy hat die echte Breite (~448 CSS-px), nachdem die Fixture das Desktop-Fenster von Playwright entfernt. |
| „Antworten…“ fehlt, Beobachter-Hinweis fehlt | Steuerung eingeklappt (`Steuerung einblenden`). Der Hinweis „nur beobachten“ und „Beobachtung beenden“ hängen im eingeklappten Dock (`SessionTail.tsx`, nur bei `!controlsHidden`). Im Querformat so vorgesehen (BUG-0053); im Hochformat nicht erneut isoliert. |
| `.push-status` fehlt nach dem Einschalten | Der Test stubbt `Notification.permission`. Auf dem Gerät erschien kein Status-Text. Nicht isoliert (kein Berechtigungsdialog bedient). |
| `viewportSize()` ist `null` | Playwright kennt die Größe nach `clearDeviceMetricsOverride` nicht. Der Test liest `width` von `null`. |
| Anhang-Chip `slides.video.md` fehlt | Composer im selben Lauf nicht da (eingeklappte Steuerung). |

**Nicht auf dem Handy gelaufen**, weil `adb reverse` nur den Port des
Test-Hubs veröffentlicht oder ein zweiter Browser nötig ist: `fleet`,
`handoff`, `drafts`, `messlauf-p8`. `querformat` setzt die Fenstergröße per
API; die echte Drehung macht das nicht.

## 4. Aufgaben

- [x] **T16.1 — Token-Seite erklärt das Nein.** BUG-0054. Liegt ein Token vor
  und die Übersicht öffnet nicht, steht der Grund da. K10 (Anmeldung ist die
  Tür zum Offline-Stand).
- [x] **T16.2 — Toter Socket ist ein Laufabbruch.** BUG-0055. `test:phone`
  beendet den Lauf, wenn `connectOverCDP` scheitert, und zählt die folgenden
  Tests nicht als Produktfehler.
- [x] **T16.3 — Code-Suche bleibt im Bild.** BUG-0056. Nach einer Aktion ist
  „Code durchsuchen“ im Viewport. Auf dem Handy im Hochformat erneut sehen.
- [x] **T16.4 — Hochformat fest halten.** Bricht der Lauf ab, wenn das Gerät
  ins Querformat dreht (oder `--portrait` stellt um und stellt danach zurück —
  das Skript kann das, der Zusatzlauf nutzte es nicht). Sonst sind Layout-Rot
  und Produkt-Rot nicht zu trennen.
- [ ] **T16.5 — Zweiter Origin auf dem Handy.** Fleet, Handoff, Entwürfe, → nach P000 verschoben
  Messlauf P8 brauchen einen zweiten Port oder einen zweiten Browser. `adb
  reverse` kennt bisher nur den Test-Hub. K8 (mehrere Sessions) bleibt dort
  ungesehen.
- [x] **T16.6 — Specs, die die echte Fläche nicht kennen.** `layout-desktop`
  nicht auf dem Phone-Projekt. `viewportSize() === null` nicht als Breite
  lesen. Querformat über die Geräte-Drehung, nicht über `setViewportSize`.
- [x] **T16.7 — Eingeklapptes Dock behält die einzige Aktion.** „Beobachtung
  beenden“ und der Hinweis „nur beobachten“ sind bei eingeklappter Steuerung
  nicht im Baum. Im Hochformat isolieren; wenn es nur das Querformat ist, den
  Hinweis außerhalb des Klappbereichs legen.
- [ ] **T16.8 — Menschliche Restmatrix nicht hier abhaken.** T12.4 bleibt der → nach P000 verschoben
  Ort für Flugmodus, Sperrbildschirm-Push, TalkBack, 200 % Text, Teilen-Menü,
  echte Stimme, WAN.

## 5. Acceptance Criteria

- **AC-P16-1:** Ein Hochformat-Lauf der Kernliste auf dem Pixel hat keinen
  Fehlschlag an der Token-Seite (BUG-0054). Die fünf Abläufe aus Lauf 9, die
  dort abbrachen, sind im Volllauf grün.
- **AC-P16-2:** Stirbt der DevTools-Socket, endet `npm run test:phone` mit
  einem Satz und ohne eine Kette von 15-Sekunden-Timeouts (BUG-0055).
- **AC-P16-3:** `e2e/specs/code.spec.ts` ist auf dem Handy im Hochformat grün,
  einschließlich `toBeInViewport` für „Code durchsuchen“ (BUG-0056).
- **AC-P16-4:** Ein Lauf, der im Querformat ankommt, startet nicht (oder dreht
  nur mit `--portrait` und stellt zurück). Die Kernliste bleibt die Specs, die
  ohne zweiten Browser, ohne Mikrofon-Dialog und ohne Desktop-Breite auskommen.

## 6. Premortem

1. **Querformat-Rot wird als Produktfehler behoben.** Der Zusatzlauf lag am
   Ende bei `ROTATION_90`; eingeklappte Steuerung und „page closed“ kamen
   danach. Gegenmittel: T16.4, und kein Fix für BUG-0056, der nur im
   Querformat auftritt — deshalb AC-P16-3 ausdrücklich im Hochformat.
2. **Die Token-Seite ist nur ein liegengebliebenes Test-Token.**
   `signIn` überschreibt ein vorhandenes `localStorage`-Token nicht; ein
   wiedervergebener `127.0.0.1`-Port kann ein altes Token zeigen. Wer nur die
   Fixture leert, übersieht eine stumme 401 in `main.tsx`. Gegenmittel: die
   Ursache in BUG-0054 ist offen; der Fix muss beide Pfade nennen.
3. **Die Phone-Liste schluckt Desktop-Specs und das Gate wird dauerhaft rot.**
   `layout-desktop` und `viewportSize()` passen nicht auf die echte Fläche.
   Gegenmittel: die Liste in `playwright.config.ts` bleibt die Kernspecs;
   T16.6 erweitert sie nicht blind.
4. **Drahtloses `adb` macht den Lauf unbrauchbar und jemand nimmt ihn ins
   CI auf.** Ein toter Socket hat 51 Tests rot gefärbt. Gegenmittel: T16.2
   vor jedem CI-Job `phone`. Bis dahin bleibt das Projekt lokal.

## 7. Definition of Done

- BUG-0054, BUG-0055, BUG-0056 zu und im Hochformat auf dem Pixel nachgestellt.
- `npm run test:phone` auf der Kernliste im Hochformat ohne die drei
  Fehlermuster; übersprungene Diktat- und Offline-Tests bleiben als solche
  sichtbar, nicht als bestanden.
- `npm run gate` grün, Pipeline-Job `e2e` grün. Neue UI aus T16.1/T16.3/T16.7
  hat eine Spec in `e2e/specs/`. Das Phone-Projekt ist erreichbar über
  `npm run test:phone` (Skript und `docs/testing-e2e.md`).
- T12.4 bleibt offen; dieser Epic hakt es nicht ab.
