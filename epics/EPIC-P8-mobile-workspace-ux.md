# EPIC-P8 — Einfacher und zuverlässiger mobiler Arbeitsplatz

**Status:** Planungsentwurf, Umsetzung blockiert · **Phase:** P8 · **Dauer:** 1–2 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P7 grün; alte K10-/Push-Blocker aus G0 behoben.

Planungsauftrag vom 2026-09-21; kein Umsetzungsstart und keine Behauptung eines
grünen Vorgänger-Gates. Scope, Evidenz und bestehende Restarbeiten:
[Audit](../docs/remote-control-audit-2026-09-21.md), [Index](README.md).

## 1. Ziel

Das Handy wird zum täglichen Arbeitsplatz: sofort sehen, was Aufmerksamkeit
braucht, sicher antworten, zwischen Geräten wechseln und Netzunterbrechungen
überstehen. Bestehendes Design vereinfachen. PRD §6, K1/K2/K3/K5/K7/K10;
Audit G09/G10/G16 und §5.

## 2. Scope (In / Out)

**In:** Informationsarchitektur, verständliche Session-Karten, Inbox, Deep Links,
Entwürfe, Push, Offline-/Update-UX, Bedienhilfen und kleine QoL-Funktionen.
**Out:** neue fachliche Provider-Fähigkeiten und eigenes zweites Aktionssystem.
BUG-0015/P1-Push bleiben Vorgängerarbeit, hier deren erweiterte Produktabnahme.

## 3. Design-Details

Übersicht mit „Braucht dich“, „Aktiv“, „Zuletzt“; Aufgabentitel, Host/Projekt,
letzte Aktion statt Ereignisnummer als Hauptinformation. Chat und Änderungen
primär, Debug-Verlauf/Bericht/Suche in Details. Einstellungen nachgeordnet,
Eingabe/Sprache im Daumenbereich. Desktop nutzt Liste+Detail.

Serverseitige Session-Metadaten und Draft-Sync benötigen Contract/ADR und
Recovery. Lokale Entwürfe an Host/Session/Gerät binden, Offline-Draft ist kein
ungeprüfter Versandauftrag. Read-Cursor für „seit letztem Besuch“; bestehende
Filterpräferenz weiterhin gerätespezifisch. Idempotente Eingaben aus P5 nutzen.

Push nur als Hinweis mit opaker Ereignis-ID; Inhalt nach Auth laden, keine
Secrets/Prompts auf Lockscreen. VAPID/Subscription-Rotation und Deduplizierung,
Mute/Ruhezeiten, Inbox als kanonische Quelle. Web-Push benötigt externe
Push-Infrastruktur und ist somit explizit konfigurierbarer Egress, kein
Tailscale-WS-Ersatz bei garantiert null Egress. Apple dokumentiert Home-Screen-
Installation und Interaktion für die Push-Erlaubnis: [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

Cache-Stand am Speicherzeitpunkt erfassen; Gerät/Identität/Host isolieren,
bei Abmelden/Revoke bereinigen. Offline Shell auch nach Reload sichtbar,
Schreibaktionen offline sperren/als Entwurf halten. Reconnect räumt stale-State
auf. Versioniertes PWA-Update darf Draft/Session-Link nicht verlieren.

## 4. Aufgaben

- [ ] **T8.1 — Übersicht und Navigation.** UI-Funde aus Audit §5 umsetzen: Titel, letzte Aktion, Host, Braucht-dich, aktive/archivierte Sessions, stabile URLs und Browser-Zurück. K1/K2/K10.
- [ ] **T8.2 — Offline, Auth und Updates.** K10-Abnahme erweitern: Reload/offline-first-open mit vorhandenem Cache, korrekter Datenzeitpunkt, Tokenwechsel ohne Datenvermischung, Reconnect und SW-Upgrade. K7/K10.
- [ ] **T8.3 — Benachrichtigungsprodukt.** P1-Push-Basis um Inbox, ruhige Zeiten, Deduplizierung, richtigen Deep-Link, Endpoint-Rotation und sichtbaren Zustellstatus ergänzen; echte Hintergrund-/Lockscreen-Tests. K1/K10.
- [ ] **T8.4 — Composer und Kontinuität.** Dauerhafte Entwürfe, Sync-Konflikte, Leseposition, Anhang-Teilen, Copy, Antwortvorlagen und letzte Projekt-/Harness-Auswahl; keine erneute Ausführung beim Reload. K5/K7/K10.
- [ ] **T8.5 — Layout und Accessibility.** Composer-/Tab-/Dock-Stapel verkleinern; Stop absetzen; responsive Desktop-Liste; Fokus/Screenreader/Reduced-Motion/Touch-Ziele und echte Bildschirmtastatur prüfen. K1/K2.
- [ ] **T8.6 — QoL und Messlauf.** Pins, Umbenennen, Archiv, neuer-Inhalt-Marker, Fehlermeldung mit Retry, nur verfügbare Voice-Beispiele; fünf Kernaufgaben mit 20 Sessions mobil messen. K1/K2/K10.

## 5. Acceptance Criteria

- **AC-P8-1:** 20 Sessions auf drei Hosts: jede wartende Anfrage in ≤ 2 Taps öffnen; zwei ähnliche Sessions anhand Titel/Host/letzter Aktion in ≤ 5 s unterscheiden.
- **AC-P8-2 (K10):** Online laden → Flugmodus → App schließen/neuladen: letzter Stand mit ursprünglichem Zeitstempel sichtbar; keine erneute Token-Eingabe nötig, keine offline ausgeführte Mutation. Reconnect stellt aktuellen Zustand her.
- **AC-P8-3:** Auf Nutzer-Handy und einem zweiten Browserprofil: Hintergrund-/Lockscreen-Push für Approval/Fehler, korrekter Deep-Link, keine Duplikate. OS-verweigerte Zustellung bleibt sichtbar; kein garantierter Push bei abgeschaltetem Netz behauptet.
- **AC-P8-4:** Entwurf über Navigation, Reload, Update und zweiten Client erhalten; Konflikt löst keine stille Überschreibung aus. Abmelden/Tokenwechsel zeigt keine Daten des vorherigen Gerätezugs.
- **AC-P8-5:** 390×844 ohne Tastatur: ≥ 50 % nutzbare Höhe für Session-Inhalt; mit realer Tastatur Senden/Mikro erreichbar. 200%-Text, Tastaturfokus und Screenreader bestehen die fünf Kernflows.
- **AC-P8-6:** K2-Lastlauf mit neuer Oberfläche grün, jede angezeigte Aktion tatsächlich erreichbar; Desktop ab 1280 px mit nutzbarer Liste+Detail.

## 6. Premortem

1. **Weniger Tabs verstecken Kernfunktionen:** fünf Aufgaben vor/nach Umbau vergleichen, Details in einem zusätzlichen Tap.
2. **Push signalisiert erledigte Anfrage:** Entscheidung beim Öffnen neu laden, Deduplizierung und Inbox-Status.
3. **Offline-Draft wird versehentlich versendet:** Draft/queued/submitted/executed getrennt, Senden bleibt bewusste Aktion.
4. **SW-Update vernichtet Kontext:** Version-/Reload-Test mit offenem Draft und gültigem Session-Link.

## 7. Definition of Done

Alle ACs mit benannten Tests/Messläufen belegt, Vorgänger-Gate geschlossen;
`npm test`, `npm run lint`, `npm run typecheck` grün, PWA-Build bei UI-Änderungen,
Last-/Gerätetests gemäß AC. Contracts first; Adapter-/Event-/Worker-Änderungen
mit ADR. K5-Blob-Grenze, K7-Recovery, AdapterContext-Isolation und Fail-loud
nachgewiesen. Jede Funktion in Config, API/CLI und passender UI tatsächlich
registriert/erreichbar; Capability-/Support-Matrix ehrlich aktualisiert.
Premortem im Abschlussreview gegenprüfen, offene Pflicht-ACs blockieren Abschluss.
Commit/MR gemäß Repo-Workflow; kein lokaler Merge nach main.
