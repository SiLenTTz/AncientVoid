# Messlauf P12 — lokale Gates und K8

**Datum:** 2026-09-24 · **Branch:** `feat/p12-backup-restore` ·
**Host:** Omarchy, Node 26 · **Zweck:** T12.2/T12.6 und Regressionen der
lokalen Änderungen. Das ist keine Geräte- oder Fleet-Abnahme.

## Lokales Gate

`npm run gate` lief vollständig gegen echte lokale Hub-Prozesse und Chromium:

- Typecheck, Lint, Commit-Notation, Architekturgrenzen und Adapter-Matrix: grün.
- Vitest: 104 Testdateien, 637 Tests bestanden.
- Playwright: 151 bestanden, 2 übersprungen; beide Skips sind im Testreport
  sichtbar. `test-results/.last-run.json` meldete `passed`, keine Fehlschläge.
- Backup/Restore/Retention: 8/8; Datadir-Lock: 5/5; EventStore: 9/9.
- AC-P8-4 Tokenwechsel: 3/3 gezielte Playwright-Wiederholungen.

Der GitLab-Remote-Lauf ist aktuell nicht ausführbar: Pipeline
[#2878277157](https://gitlab.com/SiLenT_Tz/mobile-hub/-/pipelines/2878277157)
auf `main` wurde am 2026-09-24 mit `ci_quota_exceeded` beendet; `verify` und
`e2e` starteten jeweils mit Laufzeit 0. Gemäß T12.6 gilt in diesem Fall das
vollständige lokale `npm run gate` mit MR-Evidenz als Merge-Evidenz. Das ist
kein grüner Remote-CI-Lauf.

Nach T12.1-Lifecycle-Korrektur und Ergänzung des Fleet-K8-Messskripts erneut
ausgeführt: `npm run gate` exit 0; Vitest 104 Testdateien/637 Tests, Playwright
151 bestanden und 2 sichtbare Skips.

## K8-Lauf

Aufruf: `npm run loadtest` (20 Dummy-Sessions × 30 Ereignisse/s × 10 s,
In-Process `SessionManager` + `EventStore`, keine HTTP- oder Fleet-Weiterleitung).

| Messwert | Ergebnis |
|---|---:|
| Ereignisse | 6.097 |
| Aggregat | 604 Ereignisse/s |
| RSS am Ende | 169 MB |
| Verlorene/gap-behaftete Sessions | 0 |

Ergebnis: `K8 PASSED`. Dieser Lauf belegt die lokale Event-Pipeline; der
separate Zwei-Host-Lauf für AI-P6-3 folgt direkt darunter. AI-P10-3 (20
Sessions unter Sprachlast) bleibt offen.

## K8 über zwei Fleet-Hosts (AI-P6-3)

`UACC_TOKEN=<home device token> node scripts/messlauf-p12-fleet-k8.mjs`
startete zwei isolierte Sidecar-Hubs mit temporären Datadir-Pfaden und je zehn
Dummy-Sessions bei 30 Ereignissen/s. Der Heim-Hub leitete Anlegen und Lesen
über die Fleet-API weiter. Nach dem Lauf wurden Sessions gestoppt, Peers
entfernt, Token auf den Sidecars widerrufen und temporäre Hubs/Daten entfernt.

| Host | Sessions | persistierte Events | min. WebSocket-Events im Messfenster je Session | Sequenzlücken |
|---|---:|---:|---:|---:|
| evox2 | 10 | 3.234 | 302 | 0 |
| silenttz-server | 10 | 3.209 | 301 | 0 |
| **Summe** | **20** | **6.443** | **301** | **0** |

Ergebnis: PASS, im gemeinsamen 10-Sekunden-Fenster kamen mindestens 301 Events
je Session über WebSocket an (AC-Mindestwert 270). Alle Events waren
persistiert, ohne Sequenzlücken. Nachkontrolle: nur die drei ursprünglichen Fleet-Peers sind
erreichbar; auf beiden Zielhosts waren weder Sidecar-Datadir noch Port 7441
mehr vorhanden.

## Eingabe-Tokenwechsel

Der AC-P8-4-E2E-Test wartet jetzt direkt auf die geschützte Antwort von
`GET /api/adapters` (bis 30 s) und prüft HTTP 200, bevor er die UI-Umschaltung
prüft. Bei einer Antwortzeit über 5 s hängt er eine Zeitmessung an den
Playwright-Test. Drei gezielte Wiederholungen waren grün (3/3, je ca. 4 s).
Das macht den Fehlerort sichtbar und beseitigt den bisherigen 10-s-
Erwartungs-Timeout, beweist aber keinen dauerhaften API-Latenzwert.

## Backup/Restore und Retention

Der Testlauf deckt vollständigen verschlüsselten Restore, falschen Schlüssel,
manipulierten Ciphertext, Geheimnisverbergung, aktive Hub-/tmux-Sperren und
Retention-Vorschau/Löschung ab. Ein `RLIMIT_FSIZE`-Schreiblimit erzwingt einen
Dateischreibfehler: das unvollständige Archiv und der Backup-Lock werden
aufgeräumt. Das ist ein deterministischer Fehlerpfadtest, keine Messung auf
einem tatsächlich vollen Dateisystem (`ENOSPC`). Session-lokale Event-Blobs
werden beim expliziten Löschen einer Session mit entfernt. Token-Widerruf ist
bereits durch `packages/core/test/platform/db.test.ts` und die Fleet-Tests
abgedeckt.

## Offen

Die lokalen und isolierten Zwei-Host-K8-Belege schließen keine weiteren
Pflichtzellen aus P12 T12.4/T12.5. Insbesondere bleiben echte Geräte,
24-Stunden-Lauf, Wiederherstellungslatenz auf Produktivdatengröße, echter
ENOSPC-Lauf sowie die Hyprland-0/50-Messung getrennt offen.

Zusätzlicher Restore-Lauf am lokalen echten Datadir (nach sauberem Stop,
verschlüsseltes Temp-Archiv, Restore in einen neuen Temp-Pfad): 1.408.668 Byte
Datadir, 582.494 Byte Archiv, Backup 298 ms, Restore inklusive Integritäts-
und Referenzprüfung 281 ms. Die Testartefakte wurden entfernt. Diese kleine
Bestandsgröße belegt den End-to-End-Pfad, ersetzt aber keinen Lauf auf
Produktivdatengröße.

## T12.1 — Live-Konfiguration und Lifecycle

- Omarchy-Claude läuft jetzt ohne `--dangerously-skip-permissions` mit
  `permissionPrompts: "hub"`; OpenCode wurde vom `--auto`-CLI-Adapter auf den
  ACP-Preset `opencode` mit nativen Hub-Freigaben umgestellt. Die bisherige
  lokale Konfiguration liegt außerhalb des Repos unter
  `/home/silenttz/.config/uacc/config-backups/` (Modus `0600`); die aktive
  `hub.config.json` ist ebenfalls Modus `0600`. Die getrackte Beispielconfig
  enthält keine Bypass-Flags.
- Neustart hat 7 gespeicherte Sessions wiederhergestellt (0 Fehler). Der
  authentifizierte Adapter-Endpunkt meldet für `claude` und `opencode`
  `toolGate=native`; der aktuelle `pixel`-Token wurde geprüft. Alle drei
  Fleet-Peers meldeten `reachable`.
- `scripts/hub.sh stop` beendete zuvor nur den gespeicherten Shell-Prozess und
  ließ den Hub-Node-Prozess weiterlaufen. Das Skript stoppt jetzt die
  isolierte Prozessgruppe mit SIGTERM und wartet auf deren Ende. Stop → Port
  geschlossen → PID-Sperre frei → Start → Health 200 wurde live geprüft.
- Der vollständige Fresh-Clone-/Pairing-/Provider-Installationslauf und die
  nativen Freigaben mit echten Provider-Toolaufrufen bleiben in T12.4 offen.

## T12.7 — Credential-Rotation und Logbereinigung

- Der lokale Hub (PID 662613) wurde per `SIGTERM` sauber heruntergefahren;
  PID-Lock sowie SQLite-WAL/SHM waren danach entfernt.
- Die lokalen Gerätetokens `diag` und `pixel` wurden ersetzt. Bei einer
  späteren Statusprüfung wurden deren Werte einmal in einer internen
  Tool-Ausgabe sichtbar; beide wurden daraufhin widerrufen und erneut rotiert.
  Die aktuellen Einmalwerte liegen geschützt unter
  `/home/silenttz/.config/uacc/rotated-2026-09-24/device-tokens.txt` (Modus
  `0600`). Der aktuelle `pixel`-Token muss noch auf den Clients eingespielt
  und anschließend geprüft werden.
- `/tmp/uacc-hub.log` wurde nach dem Stop mit `shred -u -n 1` entfernt; der
  Remote-Host `silenttz-server` hatte kein gleichnamiges Log. Der neu
  gestartete Log liegt mit Modus `0600` vor.
- `silenttz-server` wurde per einmaligem Invite neu gekoppelt. `/api/fleet`
  meldete anschließend `omarchy`, `evox2` und `silenttz-server` als erreichbar.
  Nachdem SSH-Zugriff verfügbar wurde, wurden beide Peers (`silenttz-server`,
  `evox2`) am 2026-09-24 mit neuen Einmal-Einladungen gekoppelt; damit wurden
  ihre alten `fleet:omarchy`-Credentials ersetzt. Der Fleet-Logscan meldete
  für `omarchy`, `silenttz-server` und `evox2` null unmaskierte `token=`-Werte
  und null Treffer auf bekannte Tokens.
- `gitleaks dir` und `gitleaks git` meldeten dieselben zwei Treffer in
  Test-Fixtures (`attachments/extract.test.ts`, `push.test.ts`): ein gemockter
  Provider-API-Key sowie Testdaten für Push-Auth, keine produktiven Zugangsdaten.
  Die Scans fanden keine weiteren Treffer.

Offen bleiben das Einspielen und Prüfen der aktuellen lokalen Tokens auf den
Geräten. Der Scan belegt die Journals seit dem jeweiligen verfügbaren Zeitraum,
nicht gelöschte oder bereits rotierte Alt-Logs. Das Repository wird in diesem
Task nicht öffentlich geschaltet.
