# P41-Übergabeprüfung und P42-Voraussetzungen — 10.11.2026

## Stand und Herkunft

Die Codex-Übergabe startete in `ancientvoid/cdf0fa85-7a18-4251-bb58-ef120cb93964`
auf P40 (`7db654d`), ohne lokalen Diff. Die uncommittierten P41-T41.5/T41.6-Dateien
lagen im Worktree `dea0bdbe-1cb0-4801-a09c-3c28f7daf900` (`feat/p41-automationen`).
Die 15 geänderten/neuen Dateien wurden unverändert in den Übergabe-Worktree
kopiert; der Quell-Worktree blieb unberührt. Die bereits auf `origin/main`
liegenden P41-T41.1–T41.4-Änderungen wurden per Fast-forward übernommen
(`8f25ef7`). Keine erneute Implementierung dieser Aufgaben.
Beim Abschlussabgleich stand `origin/main` auf `2cefb78`; die zusätzlichen
Commits gegenüber `8f25ef7` ändern ausschließlich P45-Dokumentation und deren
Übersichtszeile, keinen Laufzeitcode.

Fehlende Lockfile-Abhängigkeiten (insbesondere Mermaid) blockierten zunächst
Typecheck, Build und E2E. Ein lokales `npm ci --ignore-scripts` stellte die
Abhängigkeiten wieder her. Der erste Sandbox-Testlauf und ein durch dessen
Cache-Konflikt abgebrochener Lauf gelten ausdrücklich nicht als Nachweis.

## Laufender Hub und Provider

Am 10.11.2026 um 20:44 UTC: Dienst `active/running`, Startzeit 18:01:26 UTC.
`GET http://127.0.0.1:7373/api/health`: `ok=true`, Datenbank und EventStore gesund,
Heap 90 MiB bei 4192 MiB Limit, RSS 208 MiB. Kein Neustart im Rahmen dieser Prüfung.
Das ist eine Momentaufnahme, keine Abnahme sämtlicher vorhandener Sessions.
Die Health-Antwort zählte 138 gespeicherte Sessions: 1 working, 68 idle,
34 error, 34 stopped, 1 waiting_approval. Die Fehler-Sessions sind damit
nicht pauschal als repariert oder wiederaufgenommen belegt.
Der Dienststart liegt vor dem Commit-Zeitpunkt des neuesten `main`-Commits
(`8f25ef7`, 19:51:25 UTC). Ein aktueller Arbeitsbaum belegt damit nicht, dass
der laufende Node-Prozess bereits diesen Stand geladen hat. Kein Claim
„laufender Hub auf neuestem Stand“ und kein Deployment des unvollständigen P41.

Host-Prüfung außerhalb der Netzwerksandbox: HTTPS auf
`https://api.z.ai/api/coding/paas/v4/models` antwortete ohne Anmeldedaten mit
HTTP 401 (TLS ca. 0,19 s). DNS/TLS zum öffentlichen Endpoint funktionieren
aktuell. Kein authentifizierter Modellaufruf und keine Aussage zu Quota,
Modellzugang oder dem historischen maki-Ausfall. Der DNS-Fehler innerhalb
der Sandbox war kein Nachweis eines Host-Ausfalls.

Abschließende Host-Prüfung gegen 21:30 UTC: gleicher Hub-PID 1925794,
weiterhin `active/running`, Datenbank/EventStore/Speicher gesund, Heap 43 MiB,
RSS 178 MiB. ZAI-Endpunkt erneut HTTP 401 ohne Token (TLS ca. 0,05 s).

## Reparierte Befunde

^- BUG-0115: `AutomationService.create()` übernahm `enabled=true`; Neuanlage
  wird jetzt serverseitig deaktiviert gespeichert.
^- BUG-0116: `update()` speicherte Definitionen ohne Hash-/Blob-Abgleich.
  Prompt und Blob werden jetzt vor dem Journal-Update geprüft. Ungültige
  Änderungen lassen die vorherige Definition samt Freigabe unverändert.

Drei Regressionstests wurden vor dem Fix rot ausgeführt; alle zehn
Service-Tests sind nach dem Fix grün. Ein zusätzlicher positiver Test
belegt die Übergabe eines gültigen Ersatzprompts an den Launcher.

^- BUG-0117: Der zusätzliche Dock-Eintrag überlastete mobile Breiten. Der
  Browser-Repro zeigte eine Schaltflächenbreite von nur 42 px und überlappende
  Beschriftungen. Mindestbreite 44 px, Umbruch der Beschriftung und internes
  horizontales Scrollen halten alle Ziele erreichbar. Derselbe Test ist nach
  dem Fix dreimal grün (412 px Breiten-/Beschriftungsgrenzen, 320 px Einstellungen
  öffnen, kein horizontaler Seitenüberlauf).

## Requirements-Review (pr-review)

**Auftrag: REQUEST CHANGES für einen P41-Epic-Abschluss.** Die übernommenen
Tests belegen einen Session-Startauftrag, keinen vollständigen P41-Exit.

| Anforderung | Befund |
|---|---|
| AC-P41-1: Harness/Run und Ergebnis | Session-Dispatch vorhanden; Run-Ziele bei POST explizit HTTP 501. `settle()` ist nicht mit Session-/Run-Ergebnissen verbunden. Dispatched-Claims bleiben damit offen und blockieren Folgeausführungen bei `maxParallel=1`. |
| AC-P41-2: DST/Grace/Vorschau | Uhrtests und Engine vorhanden; endgültiger Exit braucht die vollständige Matrix, kein Schluss allein aus dem Minutentakt-E2E. |
| AC-P41-3: Crash/unsicherer Start | Claim-Journal/Dedupe vorhanden; E2E prüft sauberen SIGTERM-Restart, keinen Crash unmittelbar zwischen Claim und Dispatch. |
| AC-P41-4: getrennte Gründe | Fehlende Precheck-ID als Negativprobe vorhanden; nicht alle Auth-/Quota-/Lease-/Timeout-Pfade sind live belegt. |
| AC-P41-5: Disable/Run-now | Oberfläche und API vorhanden; Disable/Änderung während eines laufenden Prechecks wird vor Dispatch noch nicht erneut geprüft. |
| AC-P41-6: Recovery/offline | Journal/Restart-Nachweis vorhanden; datierte Offline-Projektion und deaktivierte Offline-Aktionen fehlen in der neuen Ansicht. |
| T41.5: Editor | Formular besitzt Update-Code, aber `setEditing` wird ausschließlich mit `null` aufgerufen; vorhandene Definitionen sind in der PWA nicht zum Bearbeiten erreichbar. CLI besitzt keinen Update-Befehl. |
| T41.6: vollständige Nachweise | Gate/Build/K8 getrennt unten; grüne Smoke-Tests ersetzen keine fehlenden Anforderungen. |

Die sechs Dimensionen getrennt:

1. **Requirements:** REQUEST CHANGES für den Epic-Exit (AC-Matrix oben).
2. **Architektur:** Die neuen UI-/CLI-Aufrufer verwenden bestehende HTTP-Routen; die Fixes ändern keine Contracts oder Adapter. `check:arch` grün. Das HTTP-Verlaufsformat ist allerdings separat in Core (`ClaimState`), PWA und hubctl typisiert; ein gemeinsamer stabiler Contract fehlt noch (Contracts-first, P41 offen).
3. **Edge Cases:** Neuanlage-Freigabe und Prompt-Update korrigiert; Precheck-Disable-/Generationsrennen und langfristiges Catch-up-Budget bleiben offen.
4. **Qualität:** Zwischenstand, kein vollständiger Editor; History-Fehler dürfen nicht als leere Daten verkauft werden (offen).
5. **Determinismus:** Service-Regressionen rot → grün, Uhrtests in der vollständigen Unit-Suite grün; drei Wiederholungen der drei neuen Automations-E2E grün.
6. **Future-Fragility:** siehe fünf Einzelpunkte unten.

**Handwerk:** Die hier reparierten Service-Pfade verwenden vorhandene
Contracts; neue Tests kreuzen den Service-/Launcher-Port. Bekannte übrige
Architektur-/Edge-/Determinismusfragen bleiben P41-Arbeit und werden nicht
als erledigt umetikettiert. History-Abruffehler werden in der PWA derzeit
als leerer Verlauf dargestellt; Poll-Erfolg kann Operationsfehler löschen.
Der Scheduler enumeriert alle verpassten Termine seit dem letzten Claim bzw.
`createdAtUtc` synchron; ein begrenztes Recovery-/Tick-Budget für lange
Ausfallzeiten ist noch nicht nachgewiesen. Der K8-Lauf unten misst die
Session-Eventlast, nicht zusätzlich eine große Schedule-/Catch-up-Menge.

**Future-Fragility (fünf Pflichtpunkte):**

1. Kein Contract-Bruch durch die Fixes; keine Contract-/Event-/Worker-Änderung.
2. Keine Adapteränderung oder Umgehung von `AdapterContext`.
3. Kein neuer Eventpayload; Prompt bleibt ein SHA-Verweis mit separatem Blob (K5).
4. Kein neuer State; Definition und Blob bleiben im vorhandenen Journal-/Snapshot-/Blob-Pfad (K7). Ein abgelehntes Update schreibt keine neue Definition.
5. Kein neuer Provider-Parser. Fehlerhafter Prompt wird laut abgelehnt. Die erwähnte PWA-History-Fehlerunterdrückung bleibt offen.

## P42 bleibt blockiert

P41 ist kein nachweislich grüner Vorgänger-Exit. Darüber hinaus fehlen am
Host `ANDROID_HOME`/SDK, `sdkmanager`, `avdmanager`, Emulator und AVDs.
`adb` und `/dev/kvm` sind vorhanden; nutzbarer KVM-Zugriff/Boot-/Codec-/Lastnachweis
ist in dieser Prüfung nicht erbracht. Kein physisches Gerät wurde gesteuert.

EPIC-P42 §2/§3.1 verlangt einen ausdrücklichen Installationsauftrag für
SDK-/Image-Downloads. Dieser wurde angefragt; ohne Antwort keine Installation.
Die Planungsvertiefung aus Commit `6525850` liegt bereits im separaten
P42-Planungsbranch vor und wurde nicht erneut erstellt. T42.1–T42.6 bleiben offen.

## Gates

Der erste vollständige E2E-Lauf meldete einen echten Regressionsbefund in
`navigation.spec.ts:46`: erwartete Dock-Liste mit sieben Einträgen, tatsächlich
acht einschließlich „Automationen“. Die strenge Listen-/Reihenfolge-Assertion
wurde um den neuen Eintrag ergänzt. Kein Test wurde entfernt, gelockert oder
geskippt. Der rote Lauf wurde gestoppt; das komplette Gate wird danach neu
ausgeführt. Die übrigen gezielt gelesenen Dock-Erwartungen enthielten keine
weitere festgeschriebene alte Liste.

- `npm run loadtest`: **PASS**, 20 Sessions, 6101 Events in 10,2 s (~599/s), kein Verlust, RSS 170 MiB.
- `npm test` im abschließenden Gate: **PASS**, 231 Dateien / 1660 Tests.
- Typecheck, Lint, Workspace-Links, Commit-Notation, Architektur, Namens- und Adapter-Matrixchecks: **PASS**. Typecheck/Lint wurden nach den Fixes zusätzlich separat grün geprüft.
- Vollständiges `npm run gate`: **PASS** (Exit 0), 1660 Unit-/Integrationstests und **448 E2E-Pässe / 2 Skips** in 18,9 min E2E-Laufzeit. Die zwei bestehenden mobilen Handoff-Duplikate sind bewusst geskippt, da derselbe Spec beide Formfaktoren im Desktop-Projekt selbst steuert; dort sind die beiden Fälle bestanden. Skips zählen nicht als Pässe oder Geräte-Abnahmen.
- Secret-Scan aller 27 geänderten/neuen Dateien: **PASS**, keine Funde.
- Automations-E2E `--project=mobile --repeat-each=3`: **PASS**, 9/9 in 5,3 min.
- PWA-Build: **PASS**, im Global-Setup der Automations- und vollständigen E2E-Läufe frisch gebaut.
- Dock-Regressionsnachweis `--repeat-each=3`: **PASS**, 3/3 nach rotem Repro; zusätzlich im Gesamtlauf bestanden.
- Abschließender Typecheck/Lint nach Ergänzung des Dock-Tests: **PASS**.

Kein P41-/P42-Abschluss, keine Geräte-Abnahme, kein Produktiv-Deployment durch
vorhandene oder zukünftige grüne Gates impliziert.

## Nachtrag 11.11.2026

Die AC-Matrix und die Future-Fragility-Punkte oben beschreiben den Stand vom
10.11.2026 (`8f25ef7`) und bleiben als Befund stehen. Run-Ziele, Ergebnis-
abrechnung, Editor, Precheck-Revisionsprüfung, History-Contract und
Offline-Projektion wurden danach per ADR-0065 umgesetzt; der aktuelle Abgleich
mit Nachweisen und den verbleibenden Resten steht in
[EPIC-P41 §8](../epics/EPIC-P41-automationen.md#8-stand-und-exit-lücken-abgleich-11112026).
