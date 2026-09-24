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

## K8-Lauf

Aufruf: `npm run loadtest` (20 Dummy-Sessions × 30 Ereignisse/s × 10 s,
In-Process `SessionManager` + `EventStore`, keine HTTP- oder Fleet-Weiterleitung).

| Messwert | Ergebnis |
|---|---:|
| Ereignisse | 6.080 |
| Aggregat | 603 Ereignisse/s |
| RSS am Ende | 169 MB |
| Verlorene/gap-behaftete Sessions | 0 |

Ergebnis: `K8 PASSED`. Der Lauf belegt die lokale Event-Pipeline; er ersetzt
nicht AI-P6-3 (30 Ereignisse/s über zwei Hosts) oder AI-P10-3 (20 Sessions
unter Sprachlast).

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

Der lokale Gate- und K8-Beleg schließt keine Pflichtzelle aus P12 T12.4/T12.5.
Insbesondere bleiben echte Geräte, 24-Stunden-Lauf, Zwei-Host-Fleet-Last,
Wiederherstellungslatenz auf Produktivdatengröße, ein echter ENOSPC-Lauf
sowie die Hyprland-0/50-Messung getrennt offen.

## T12.7 — Credential-Rotation und Logbereinigung

- Der lokale Hub (PID 662613) wurde per `SIGTERM` sauber heruntergefahren;
  PID-Lock sowie SQLite-WAL/SHM waren danach entfernt.
- Die beiden lokalen Gerätetokens `diag` und `pixel` wurden ersetzt. Die neuen
  Einmalwerte liegen in `/home/silenttz/.config/uacc/rotated-2026-09-24/device-tokens.txt`
  (Modus `0600`); der neue `pixel`-Token wurde erfolgreich an
  `GET /api/adapters` geprüft. Werte sind nicht in Git oder Messlauf gelandet.
- `/tmp/uacc-hub.log` wurde nach dem Stop mit `shred -u -n 1` entfernt; der
  Remote-Host `silenttz-server` hatte kein gleichnamiges Log.
- `silenttz-server` wurde per einmaligem Invite neu gekoppelt. `/api/fleet`
  meldete anschließend `omarchy`, `evox2` und `silenttz-server` als erreichbar.
  Das Evox2-Credential selbst ist noch alt: HTTP ist erreichbar, aber SSH und
  Tailscale-SSH sind hier nicht verfügbar; Invite-Erstellung auf Evox2 braucht
  dessen Adminzugriff. Remote-Logs dort konnten damit nicht geprüft werden.
- `gitleaks dir` und `gitleaks git` meldeten dieselben zwei Treffer in
  Test-Fixtures (`attachments/extract.test.ts`, `push.test.ts`): ein gemockter
  Provider-API-Key sowie Testdaten für Push-Auth, keine produktiven Zugangsdaten.
  Die Scans fanden keine weiteren Treffer.

Offen bleiben Evox2-Rotation/Logprüfung und das Einspielen der neuen lokalen
Tokens auf den Geräten. Das Repository wird in diesem Task nicht öffentlich
geschaltet.
