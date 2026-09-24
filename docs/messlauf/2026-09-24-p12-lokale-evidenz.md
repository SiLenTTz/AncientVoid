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

Nach ausdrücklicher Nutzerfreigabe wurde der lokale Hub am 2026-09-24 erneut
sauber gestoppt. Verifiziert: PID-Datei und Port 7373 geschlossen, SQLite-WAL
und SHM entfernt. `/tmp/uacc-hub.log` war Modus `0600` und wurde nach dem Stop
mit `shred -u -n 1` entfernt. Der Hub bleibt für den Gerätewechsel bewusst aus.
Das bestehende Tokenarchiv unter
`/home/silenttz/.config/uacc/rotated-2026-09-24/device-tokens.txt` ist
vorhanden, nicht leer und Modus `0600`; die Tokens wurden nicht ein zweites
Mal rotiert, damit die noch einzuspielenden Client-Tokens gültig bleiben (Stand
dieser damaligen Prüfung).

Bei einer späteren Metadatenprüfung wurden die Klartextwerte des Archivs
versehentlich in einer internen Werkzeugausgabe angezeigt. Beide betroffenen
Gerätetokens (`diag`, `pixel`) wurden deshalb nochmals widerrufen und frisch
ausgestellt; das geschützte Archiv wurde ersetzt und blieb Modus `0600`. Die
Tokenliste führt beide Labels aktiv, bislang ohne Nutzung. Die neuen Werte
müssen noch auf die Clients übertragen und dort geprüft werden. Die lokalen
Fleet-Daten führen `evox2` und `silenttz-server` mit frischen Kopplungszeiten
vom 2026-09-24; eine erneute Rotation war daher nicht nötig. Eine aktuelle
SSH-Prüfung von `evox2` scheiterte an der Host-Authentifizierung, sodass der
Remote-Dienstzustand in diesem Schritt nicht live bestätigt wurde.

Für den Gerätewechsel wurde der Hub vorübergehend wieder gestartet; die PWA
war über die Tailnet-Adresse erreichbar. Die ADB-Verbindung zum Fairphone 6
brach während der Bedienung ab. Als das Gerät wieder sichtbar war, zeigte es
den gesperrten Sperrbildschirm und Flugzeugmodus. Es wurde nicht entsperrt oder
umkonfiguriert; kein Token wurde eingegeben. Der Hub wurde danach sauber
gestoppt und das temporäre Log entfernt. Dabei zeigte sich, dass die alte
Startumleitung unter Benutzer-umask ein Log mit Modus `0644` anlegen konnte
(BUG-0029). `hub.sh` setzt nun `umask 077` und erzwingt Modus `0600`; erneuter
Start bei umask `0022` ergab Modus `0600` und Health 200. Der Hub ist wieder
aus, Port/PID/WAL/SHM sind frei, und `/tmp/uacc-hub.log` ist entfernt.

Offen bleiben das Einspielen und Prüfen der aktuellen lokalen Tokens auf den
Geräten. Der Scan belegt die Journals seit dem jeweiligen verfügbaren Zeitraum,
nicht gelöschte oder bereits rotierte Alt-Logs. Das Repository wird in diesem
Task nicht öffentlich geschaltet.

## T12.9 — Modellbetrieb neben Halogen

Direkte, hostkey-geprüfte SSH-Verbindung zu `evox2` über dessen Tailscale-IP
und den hinterlegten Alias. Vor dem Eingriff: `halogen-server`,
`halogen-live-proxy` und `halogen-waechter` aktiv, `uacc-llama` inaktiv,
`uacc-stt` aktiv, 56 GiB RAM verfügbar. Das über die Desktop-Datei gestartete
`halogen-starten.sh` liegt unter
`/srv/securesight.ai/Desktop-Admin/Model Inference/`; es stoppt
`qwen35-122b-server`, `bunker-llama`, `bunker-llama-router` und alle Prozesse
namens `llama-server`, bevor es Halogen/Proxy/Wächter startet. Deshalb ist
`uacc-llama` ein expliziter Folgeschritt.

`systemctl --user start --no-block uacc-llama` wurde danach ausgeführt. Live
geprüft: Halogen-Units und Proxy blieben aktiv; zwei `llama-server`-Prozesse;
`uacc-llama` aktiv; `GET /health` HTTP 200; authentifiziertes
`GET /v1/models` HTTP 200 mit Modellkennung `qwen3-coder`. Nach dem Laden
meldete evox2 89 GiB belegt und 34 GiB verfügbar von 123 GiB Unified Memory.
Es wurden keine Modellserver gestoppt. Auf dem Home-Dateisystem sind 53 GiB
frei (94 % belegt), relevant für T12.11-Modellartefakte.

## T12.2 — STT-Backend unter Parallelität

Das synthetische Piper-E2E-Diktat `e2e/live/fixtures/diktat-npm-test.webm`
(3,81 s) wurde in 16-kHz-Mono-WAV konvertiert und 20-mal parallel direkt an den lokalen
`uacc-stt`-Dienst auf evox2 geschickt. 20/20 Antworten waren HTTP 200 mit
nichtleerem Text. End-to-End am Backend: p50 2,81 s, p90 4,95 s, p95 5,24 s,
Maximum 5,53 s; alle Requests endeten in 5,57 s. Das liegt über der
2-s-Schwelle, ist aber nur ein synthetischer Backend-Baseline-Lauf: Hub-
Verarbeitung, PWA-Teiltranskripte, 20 persistente Sessions und echte Geräte
waren nicht beteiligt. Es schließt AI-P10-3 oder T12.10 nicht.

## T12.3 — Isolierter Backup-/Restore-Rundlauf

Mit einem separaten Loopback-Hub und einem privaten temporären Datadir wurde
eine Dummy-Session angelegt, bis 65 Events gewartet und anschließend gestoppt.
`hubctl backup create` erzeugte ein 7.442-Byte-Archiv mit Modus `0600`;
`hubctl backup restore` stellte es in ein neues Datadir wieder her. Der
gestartete Restore-Hub meldete Health 200; die Session blieb `stopped`, alle
65 Events und der Sentinel-Text waren vorhanden. Testschlüssel, Token, Archiv
und Datadir wurden danach entfernt. Diese Messung belegt den isolierten
Funktionspfad.

Am 2026-09-24 wurde danach das Produktiv-Datadir bei gestopptem Hub und ohne
aktive tmux-Worker gesichert. Ein einzelner verwaister FIFO unter
`data/workers/…log.in` blockierte zunächst die Spezialdatei-Prüfung. Es gab
keinen tmux-Worker; der `/proc/*/fd`-Scan fand keinen offenen Handle auf die
FIFO-Inode. Sie enthält keine
gespeicherten Logdaten; nur dieser FIFO-Eintrag wurde entfernt. Das
AES-256-GCM-Archiv `~/.local/share/uacc/backups/uacc-2026-09-24.uaccbak` ist
852.537 Byte groß und hat Modus `0600`; die Schlüsseldatei
`~/.config/uacc/backup.key` liegt separat mit Modus `0600` auf einem anderen
Dateisystem als das Datadir. Der Restore in ein temporäres neues Datadir
bestand Entschlüsselungs-, SQLite-Integritäts- und Referenzprüfungen
(`integrity_check: ok`), enthielt 7 Sessions und 713 summierte `last_seq`-
Werte. Wiederhergestelltes Datadir, DB, Sessions-Verzeichnis und Config hatten
erwartete Modi `0700`/`0600`. Der temporäre Restore wurde entfernt; das
verschlüsselte Produktivarchiv bleibt erhalten. Den Restore-Hub habe ich
nicht gestartet, da die darin gespeicherte ACP-Session im Produktivdatadir
`error` ist und beim Start kein Provider-Worker ungefragt wiederbelebt werden
soll. Das belegt Backup und Restore-Integrität, nicht die Recovery dieses
ACP-Laufs. ENOSPC, Retention und Produktiv-Recovery sind weiterhin offen.

## BUG-0030 — Private Hub-Daten

Live vor dem Fix: `data` war `0755`, `hub.db` sowie vorhandene WAL/SHM waren
`0644`; das SQLite-Schema führt `fleet_peers.token` als Klartextfeld. Keine
Credentialwerte wurden gelesen. Der Datadir wurde sofort auf `0700`, DB und
vorhandene Seitendateien auf `0600` gesetzt. Der Hub-Start erzwingt jetzt
private Datadir-Rechte; `HubDatabase` legt DB/WAL/SHM unter temporärer umask
`0077` an und korrigiert bestehende Dateien. Restore begrenzt alle
wiederhergestellten Verzeichnisse auf `0700` und reguläre Dateien auf `0600`
(ausführbare Dateien `0700`). Vor dem Fix scheiterten beide neuen
Permission-Regressionstests; danach bestanden Core-/Backup-Tests 16/16 und der
Typecheck. Vollständiges Gate steht noch aus.

## Produktiver ACP-Recovery-Vorfall während der Reproduktion

Am 2026-09-24 um 17:11:56 UTC schlug die Erzeugung einer temporären Testconfig
fehl; der danach gestartete Hub fiel auf die Repo-Config und den Produktiv-
Datadir zurück. Der Hub wurde nach rund 20 s sauber mit SIGINT gestoppt. Die
Events enthalten `session.recovery_failed`; der tmux-Worker ist nicht mehr
vorhanden. Der zugehörige Worktree blieb erhalten (`README.md` geändert,
`index.html` untracked). Es wurde keine neue Session gestartet. Der spätere
Der erste Backup-Versuch wurde durch die verwaiste FIFO
`data/workers/uacc-821b0ec8-6e5b-4238-ab27-7dc8ad5c62cc.log.in` abgewiesen.
Nach Bestätigung, dass kein Prozess sie geöffnet hielt, wurde nur die FIFO
entfernt; sie enthielt keine gespeicherten Daten. Der Worktree mit den
uncommitteten Änderungen (`README.md` geändert, `index.html` neu) blieb
unverändert und erhalten. Der Hub bleibt aus.

## T12.11 — Vision-Modell und P10.5-Medienpfad

Auf evox2 wurden das offizielle `ggml-org/Qwen2.5-VL-3B-Instruct-GGUF`
Q4_K_M-Modell (1.929.901.056 Byte, SHA-256
`d02fe9b69ad8cadbbd228e387667af66612c44bed29ffc8eb1e7caf9ac486c12`) und
der Q8_0-mmproj (844.757.728 Byte, SHA-256
`980c9b2f78c04e6cff93d277ada09e768394f112d75db3b4e9dea8a69f9fb904`)
geladen. Beide Dateien sowie beide API-Schlüssel haben Modus `0600`; der
schlüsselgeschützte Dienst `uacc-vision` ist auf Tailnet-IP `:8095` aktiv.
`GET /v1/models` wurde ohne Schlüssel mit HTTP 401 und mit Schlüssel mit
HTTP 200 beantwortet.
UACC-Text, STT, Halogen-Server, Live-Proxy und Wächter blieben aktiv. Nach
dem Vision-Modellstart standen 29 GiB von 123 GiB Unified Memory verfügbar;
im Home-Dateisystem blieben 51 GiB frei.

Die lokale Hub-Config wurde mit geschütztem Vorher-Backup um `media.vision`
ergänzt (`qwen-vl`, `apiKeyFile: ~/.config/uacc/vision.key`) und auf
`maxFrames: 30` gesetzt. `HubConfig`-Parsing war erfolgreich. Für die
Stichprobe extrahierte FFmpeg 30 gleichmäßig verteilte JPEGs aus
`packages/core/test/fixtures/media/slides.mp4` (18 s, 469.636 Byte). Die
Kontaktbogen-Prüfung bestätigte drei Folien mit exakt diesen Titeln: „Kapitel
1 Installation“, „Kapitel 2 Tests mit npm“ und „Kapitel 3 Worktree pruefen“.
30/30 Modellantworten nannten die passende Folie und den sichtbaren Text;
Antwortzeit p50 0,78 s, p95 1,52 s, Maximum 1,53 s. Das ist eine kleine,
synthetische Stichprobe, kein Qualitätsnachweis für reale Videos.

Zusätzlich lief der bestehende `MediaJobs`-Pfad mit dieser lokalen Config,
Cloud-Freigabe aus, durch: 3 Szenen-Keyframes extrahiert, 3/3 mit Qwen-VL
beschrieben und per Tesseract gelesen. Das Job-Egress protokollierte nur den
eigenen Endpunkt `100.65.133.28:8095`; STT und Summary wurden mangels ihrer
Konfiguration übersprungen. Quelldatei und Testdatenbank lagen in einem
temporären Verzeichnis und wurden nach dem Lauf entfernt. Eine echte
Harness-Session und ein Video > 20 min bleiben Teil der P12/T12.4-Abnahme.

## Lokales Gate nach P12-Evidenzänderungen

`npm run gate` am Branch `feat/p12-backup-restore`: Typecheck, Lint,
Commit-Notation, Architekturprüfung und Adapter-Matrix grün; 104 Vitest-
Dateien / 637 Tests grün; Playwright 151 bestanden, 2 sichtbar übersprungen.
Ein erster Gesamtlauf hatte einen E2E-Timeout beim erneuten Freigeben nach dem
Not-Stopp; derselbe Fall bestand isoliert und in fünf Wiederholungen, danach
bestand auch das vollständige Gate. Das ist lokales Gate-Evidenz; GitLab CI
hatte zuletzt `ci_quota_exceeded`, bevor Remote-Jobs starteten.

## T12.1 — Fresh-Clone-Installation

`feat/p12-backup-restore` Commit `f86e790` wurde in ein privates Verzeichnis
unter `/dev/shm` geklont. Auf Node 26.7 liefen `npm ci` und der PWA-Build
erfolgreich. Mit frischer Beispielconfig und neuem tmpfs-Datadir startete der
Hub auf separatem Loopback-Port; `/api/health`, Token-Ausgabe sowie
`hubctl health` und `hubctl adapters` funktionierten. Der Hub wurde mit
Exitcode 0 gestoppt; Klon, Token, Testdaten und Config wurden entfernt. Dies
prüft einen frischen lokalen Installationspfad, aber kein anderes OS/einen
anderen Benutzerkontext, kein Telefon-Pairing oder persistenten
Produktivdaten-Update.

Ein separater Update-/Rollback-Rundlauf wurde im isolierten Worktree zwischen
altem Stand `d5433d0` und P12-Stand `ce156ff` durchgeführt: die alte Instanz
erzeugte eine Dummy-Session mit 65 Events und Sentinel; die aktualisierte
Instanz las dieselben Daten; anschließend stellte der Rollback wieder auf den
alten Hub-Stand zurück. Health war HTTP 200, Sessionstatus und Events samt
Sentinel blieben erhalten. Der temporäre Worktree wurde entfernt. Dies belegt
ein isoliertes Schema-/Daten-Update und Rollback, aber keine Migration der
Produktivinstanz und kein Telefon-Pairing.

Am selben Tag bestätigte der echte OpenCode-ACP-Adapter mit Qwen3-Coder auf
evox2 die Toolfreigabe im separaten Mess-Hub: Shell-Anfrage erschien nach
12,6 s als `waiting_approval`; Allow führte ausschließlich
`echo live-ok > erlaubt.txt` im privaten Test-Worktree aus. Der Deny-Lauf
lehnte `touch verboten.txt` ab; die Datei wurde nicht angelegt. Danach war
der isolierte Hub-Port geschlossen, der eigene tmux-Socket beendet und das
Probeverzeichnis entfernt. Ein erster lokaler Qwen-Lauf bestätigt zusätzlich
Toolfehlerbehandlung (fehlende Datei sichtbar, ohne Verlust des Turns). Das
prüft echten ACP-Transport und Modell, aber kein Telefon-UI und keine
Claude-Code-Freigabe.

Der Live-Versuch für den Claude-Code-Provider-Freigabepfad (CLI 2.1.280,
Sonnet) wurde am selben Datum vor dem ersten Tool-Aufruf vom Provider
abgelehnt: `weekly limit`, `overageStatus=rejected`,
`overageDisabledReason=out_of_credits`. Die Session erhielt kein
Permission-Event, legte keine Testdateien an und meldete `$0.0000`; der
Provider nannte den Reset am 2026-09-27 um 10:00 Europe/Berlin. Die Abnahme
bleibt offen und muss nach dem Reset wiederholt werden.

Nach diesem Messlauf bestand `npm run gate` am Commit `160ea99`: Typecheck,
Lint, Commit-Notation, Architekturprüfung, Adapter-Matrix und 104 Vitest-
Dateien / 637 Tests grün; Playwright 151 bestanden, 2 sichtbar übersprungen.

## T12.2 — K8 lokaler Wiederholungslauf

`npm run loadtest` am Stand `6b1bcb0`: 20 Dummy-Sessions × 30 ev/s × 10 s,
6.083 Events, 603 ev/s aggregiert, RSS am Ende 169 MB; alle Sessions lagen
über dem 90-%-Minimum und alle gezählten Live-Events waren im EventStore
persistiert (`K8 PASSED`). Das ist der isolierte In-Process-Kernpfad; der
Fleet-HTTP-Lauf steht separat oben. Es belegt keinen 24-h-Dauerlauf oder
Sprachlast.
