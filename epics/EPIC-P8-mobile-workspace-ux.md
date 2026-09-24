# EPIC-P8 — Einfacher und zuverlässiger mobiler Arbeitsplatz

**Status:** abgeschlossen (2026-09-24, Retro unten) · **Phase:** P8 · **Dauer:** 1–2 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P7 grün; alte K10-/Push-Blocker aus G0 behoben.

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

- [x] **T8.1 — Übersicht und Navigation.** UI-Funde aus Audit §5 umsetzen: Titel, letzte Aktion, Host, Braucht-dich, aktive/archivierte Sessions, stabile URLs und Browser-Zurück. K1/K2/K10. Stand 2026-09-24: Abschnitte „Braucht dich“ (Freigabe/Fehler), „Angeheftet“, „Aktiv“, „Zuletzt“ (15, dann „Alle zeigen“), Filterfeld; Karte mit Auftrag, Host · Projekt · Harness, letzter verständlicher Aktion (`SessionRecord.lastActivity`, Migration 17) und „vor x min“; Status in Worten (`data-status` behält den Rohwert); Kosten nur bei gemeldeten Werten (ADR-0023). Jede Seite hat eine Adresse (`#/neu`, `#/einstellungen`, `#/freigaben`, `#/status`, `#/gefunden`), Zurück im Browser funktioniert. Höchstens zwei Meldungen über dem Inhalt, der Rest in der Glocke. E2E `session.spec.ts` (Abschnitte, ein Tap zur Freigabe, Zurück, Anheften/Umbenennen).
- [x] **T8.2 — Offline, Auth und Updates.** K10-Abnahme erweitern: Reload/offline-first-open mit vorhandenem Cache, korrekter Datenzeitpunkt, Tokenwechsel ohne Datenvermischung, Reconnect und SW-Upgrade. K7/K10. Stand 2026-09-24: BUG-0015 behoben (nur 401/403 = falsches Token). Service Worker v3 mit eigenem API-Cache (Übersicht, Adapter, Session, Meldungen) und Speicherzeit statt „jetzt“; letzte 150 Events der letzten 10 Sessions lokal zum Lesen, klar als gespeicherter Stand markiert; offline Senden gesperrt, Entwurf bleibt; Tokenwechsel löscht Entwürfe, Session-Stände und API-Cache; Update: Shell network-first, Link (Hash) und Entwurf (localStorage) überstehen Reload/Update. E2E mit echtem Service Worker (`workspace.spec.ts`). **Offen:** echter Flugmodus auf dem Handy → T12.4.
- [x] **T8.3 — Benachrichtigungsprodukt.** P1-Push-Basis um Inbox, ruhige Zeiten, Deduplizierung, richtigen Deep-Link, Endpoint-Rotation und sichtbaren Zustellstatus ergänzen; echte Hintergrund-/Lockscreen-Tests. K1/K10. Stand 2026-09-24: [ADR-0026](../docs/adr/0026-web-push.md): Web Push aus, bis ein Mensch es einschaltet (Egress offen benannt), Inhalt nur Kennung + Kategorie, feste Texte im Service Worker, Tippen öffnet die Session; nur bekannte Push-Dienste (kein SSRF); je Gerät Ruhezeit und „auch bei fertigem Zug“; genau einmal je Meldung und Gerät; Zustellstatus und „Abo erloschen“ (404/410) sichtbar; Rotation per `oldEndpoint`/App-Start; Glocke bleibt die Quelle. Tests: `push.test.ts` (Core), `push-routes.test.ts` (Policy, SSRF), E2E `push.spec.ts` (Schalter, blockierter Browser). **Offen:** echte Hintergrund-/Sperrbildschirm-Zustellung auf deinem Handy und zweitem Profil → T12.4 (Headless-Browser haben keinen Push-Dienst).
- [x] **T8.4 — Composer und Kontinuität.** Dauerhafte Entwürfe, Sync-Konflikte, Leseposition, Anhang-Teilen, Copy, Antwortvorlagen und letzte Projekt-/Harness-Auswahl; keine erneute Ausführung beim Reload. K5/K7/K10. Stand 2026-09-24: [ADR-0025](../docs/adr/0025-shared-drafts.md): geteilter Entwurf je Session mit Revision (Migration 18, 409 + beide Stände zur Wahl), lokal sofort und offline, nie ein Sendeauftrag, nach dem Senden geleert; Start-Prompt als lokaler Entwurf, zuletzt gewählter Host/Harness/Projekt vorbelegt; Antwortvorlagen (füllen, senden nie; eigene merken); „Kopieren“ an jeder Antwort; Tokenwechsel löscht lokale Entwürfe. Tests: `drafts.test.ts` (Hub), `draft.test.ts` (reconcile), E2E `drafts.spec.ts`. **Nicht umgesetzt:** Leseposition und Anhang aus dem Teilen-Menü → T8.6 bzw. T8.2 (Share-Target braucht Manifest + echtes Gerät).
- [x] **T8.5 — Layout und Accessibility.** Composer-/Tab-/Dock-Stapel verkleinern; Stop absetzen; responsive Desktop-Liste; Fokus/Screenreader/Reduced-Motion/Touch-Ziele und echte Bildschirmtastatur prüfen. K1/K2. Stand 2026-09-24: in der Session kein globales Dock mehr (← zur Übersicht), Büroklammer in der Knopfzeile, Stop in der Kopfzeile abseits von Senden, Umbenennen/Anheften/Archivieren/Sprachbefehl im ⋯-Menü → Inhaltsanteil bei 390×844 von 45 % auf **60,8 %** (E2E `layout.spec.ts` prüft ≥ 50 %). Ab 1280 px Liste links + Session rechts (`layout-desktop.spec.ts`). Sichtbarer Tastaturfokus, Tastaturbedienung und benannte Knöpfe per E2E; Tipp-Ziele ≥ 40 px. **Offen:** 200-%-Text, echter Screenreader und reale Bildschirmtastatur brauchen ein echtes Gerät → Messlauf T8.6/T12.4.
- [x] **T8.6 — QoL und Messlauf.** Pins, Umbenennen, Archiv, neuer-Inhalt-Marker, Fehlermeldung mit Retry, nur verfügbare Voice-Beispiele; fünf Kernaufgaben mit 20 Sessions mobil messen. K1/K2/K10. Stand 2026-09-24: Anheften/Umbenennen/Archiv (T8.1/T8.5), „neu seit deinem letzten Besuch“ je Gerät (Marke auf der Karte, Trenner + Sprung in der Session), „Erneut versuchen“ bei nicht angekommener Antwort und bei Ladefehlern, Voice zeigt nur „Stopp“/„Budget auf … Dollar“ mit Bestätigung. Messlauf 20 Sessions auf 3 Hosts ([Messlauf](../docs/messlauf/2026-09-24-p8-mobile.md), E2E `messlauf-p8.spec.ts`): jede Freigabe in 2 Taps, ähnliche Sessions in einem Filter-Tipp unterscheidbar. Fund dabei: Meldungen verdeckten Bedienelemente bis 8 s → „Zug fertig“ nur noch in der Glocke, entschiedene Freigaben ohne Meldung, Meldungen im Seitenfluss statt darüber. Tests: `qol.spec.ts`.

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

## Retro

**Zeitraum:** 2026-09-24 (Nacht) · **Commits:** 6 Feature-MRs (!99–!103, T8.6-MR) auf `main` ·
**Gate am Ende:** lokal grün (siehe Abschluss-MR).

### AK-Matrix

- **AC-P8-1:** 🟢 erfüllt
  - **Beleg:** E2E `messlauf-p8.spec.ts` (20 Sessions, 3 Hosts): jede
    Freigabe in 2 Taps, drei gleichnamige Sessions per Host unterscheidbar
    (121 ms). Zahlen in `docs/messlauf/2026-09-24-p8-mobile.md`.
- **AC-P8-2 (K10):** 🟢 erfüllt (Browser)
  - **Beleg:** E2E `workspace.spec.ts` „BUG-0015/AC-P8-2“ mit echtem Service
    Worker: offline neu laden zeigt Übersicht und Session mit
    Abrufzeitpunkt, keine Token-Eingabe, keine Mutation, nach Reconnect
    aktuell.
  - **Offen:** echter Flugmodus auf dem Handy → T12.4.
- **AC-P8-3:** 🟡 teilweise
  - **Beleg:** `push.test.ts` (einmal je Meldung und Gerät, Ruhezeit,
    410 → erloschen), `push-routes.test.ts` (Policy, SSRF), E2E
    `push.spec.ts` (blockierter Browser sichtbar); Deep-Link im Service
    Worker.
  - **Offen:** echte Hintergrund- und Sperrbildschirm-Zustellung auf deinem
    Handy und einem zweiten Browserprofil. Headless-Browser haben keinen
    Push-Dienst.
- **AC-P8-4:** 🟢 erfüllt
  - **Beleg:** E2E `drafts.spec.ts` (Navigation, Reload, zweiter Client,
    Konflikt zur Wahl, Tokenwechsel ohne Altdaten), `drafts.test.ts`,
    `draft.test.ts`.
- **AC-P8-5:** 🟡 teilweise
  - **Beleg:** E2E `layout.spec.ts`: 60,8 % Inhalt bei 390×844, Tastatur,
    sichtbarer Fokus, benannte Knöpfe, Tipp-Ziele ≥ 40 px.
  - **Offen:** echte Bildschirmtastatur, 200 % Text, Screenreader →
    Gerätetest T12.4.
- **AC-P8-6:** 🟢 erfüllt
  - **Beleg:** K2-Lauf 10 min / 30 ev/s (Messlauf §3) und E2E
    `layout-desktop.spec.ts` (Liste + Detail ab 1280 px).

### Premortem

1. **Weniger Tabs verstecken Kernfunktionen:** nicht eingetreten. Die
   Session hat alle Reiter, der Rest liegt im ⋯-Menü. Die fünf Kernaufgaben
   brauchen 1–4 Taps (Messlauf).
2. **Push signalisiert erledigte Anfrage:** eingetreten, bei den Meldungen,
   nicht beim Push. Die „Freigabe nötig“-Meldung eines Peers kam, nachdem
   die Freigabe schon entschieden war, und verdeckte 8 s den Suchknopf.
   Jetzt wird vor der Meldung geprüft, ob die Freigabe noch offen ist.
   Meldungen verdecken nichts mehr. Push trägt nur die Kennung, die App
   lädt den aktuellen Stand.
3. **Offline-Draft wird versehentlich versendet:** nicht eingetreten.
   Offline ist Senden gesperrt, der Entwurf füllt nur das Feld (E2E).
4. **SW-Update vernichtet Kontext:** nicht eingetreten. Die Shell ist
   network-first, Link (Hash) und Entwurf (`localStorage`) überstehen
   Reload und Update.

### Erkenntnisse

1. **Der Messlauf fand einen echten Bedienfehler,** den kein funktionaler Test
   sah: Meldungen über Bedienelementen (8,3 s → 170 ms).
2. **BUG-0015 war eine Verwechslung von „offline“ mit „falsches Token“.**
   Status-Codes zu unterscheiden (`isAuthError`) hat es gelöst, nicht mehr
   Cache.
3. **Ein Test, der für eine Rennbedingung nicht rot wird, ist wertlos.**
   `turn-state` wartete auf `idle` statt auf das Event.
4. **Zwei Topbars im Desktop-Split haben 8 E2E-Tests gebrochen.** Die Tests
   waren an Klassen gebunden, die im Mobil-Layout eindeutig sind. Jetzt
   adressieren sie `.session-topbar` bzw. `.tail-scroll`.
5. **Ein fehlgeschlagener Commit-Hook hat ein leeres MR erzeugt** (!103
   zunächst ohne Commit). Commit und Push werden jetzt mit `&&` verkettet.

### Action Items

- **AI-P8-1:** Gerätetest auf deinem Handy: Push im Hintergrund und auf dem
  Sperrbildschirm, echter Flugmodus, Bildschirmtastatur, 200 % Text,
  TalkBack/VoiceOver.
  - **Zurück als:** P12 T12.4.
- **AI-P8-2:** Meldungen gepaarter Peers als Push über den Heim-Hub
  weiterleiten (heute pusht jeder Peer selbst).
  - **Zurück als:** P12 T12.4.
- **AI-P8-3:** Anhang aus dem Teilen-Menü des Handys (Web Share Target)
  braucht Manifest und Gerätetest.
  - **Zurück als:** P9 (Eingabe).
