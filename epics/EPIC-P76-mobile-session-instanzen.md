# EPIC-P76 — Separate mobile Session-Instanzen

**Status:** Planungsentwurf (20.11.2026), Umsetzung gesperrt · **Phase:** P76 · **Dauer:** 0,5–1 Agenten-Woche Evaluation + 1–2 Umsetzung bei tragfähigem Web-Pfad · **Tracker:** noch nicht angelegt
**Abhängigkeit:** [P75](EPIC-P75-adapterspezifische-modellkataloge.md) Exit grün vor Implementierungsstart; keine fachliche Kopplung an dessen Modellkatalog. Basis: P8/P18/P34/P43, ADR-0053/0068. Der ausdrückliche Planungsauftrag erlaubt den Entwurf vor grünen Vorgängern, keine Umsetzung. P30/P31 bleiben On hold. [P32](EPIC-P32-mobile-client-entscheidung.md) bleibt vertagt; dieses Epic erteilt kein Go für eine native Shell.

## 1. Ziel

Aus der mobilen Sessionansicht lässt sich dieselbe Hub-Session in einer eigenen
Ansicht öffnen. Wo nachgewiesen unterstützt, erhält sie eine separate installierte
Web-App und einen eigenen Eintrag im OS-App-Switcher. Session A, Session B und
die AncientVoid-Übersicht bleiben unterscheidbar und nach Prozessende korrekt
zugeordnet. Ein Browser-Tab erfüllt den App-Switcher-Wunsch nicht und wird als
Alternative bezeichnet. PRD §9: K2/K5/K7/K10; Approvals dürfen K1 nicht verschlechtern.

## 2. Scope (In / Out)

**In:** Bestandsanalyse Desktop-Popout, versionsbezogener Plattform-Spike,
Aktion in der mobilen Sessionansicht, stabiler Sessionlink, optionaler
Installationsablauf pro Session, Navigation, Lifecycle/Offline/Recovery,
sichtbare Fallbacks, Tests und Plattformhinweise.

**Out:** neue Hub-Session/Worker beim Öffnen, Sessionkopien, automatische
Installation, garantierte Hintergrundausführung, erzwungenes OS-Fokussieren,
native Android-/iOS-App oder App-Store, neue Push-Infrastruktur,
Multi-Account-Isolation. Keine ungeprüfte Zusage „ein Klick = neue App-Karte“.

## 3. Design-Details

### 3.1 Belegter Desktop-Bestand — Code-Sichtung 20.11.2026

- `apps/pwa/src/features/windows/protocol.ts`: `WindowTarget` enthält
  `sessionId` und optional `hostId`; `popoutUrl` bildet eine Route mit
  `?window=1` und Hash. Identität ist Ziel plus Host, nicht Sessiontitel.
- `windows.ts:openPopout` öffnet per `window.open(..., "_blank", ...noopener...)`.
  Erfolg wird über `hello` binnen 3 s festgestellt (Rückgabewert kann mit
  `noopener` null sein). Bereits registrierte Ziele erhalten eine Fokusanfrage.
- `BroadcastChannel("ancientvoid.windows")`: hello/heartbeat/bye, 3-s-Heartbeat,
  10-s-TTL; Hauptfenster optional. `PopoutShell.tsx` lädt selbst Daten, bietet
  Rückgabe und schreibt nicht den Workspace des Hauptfensters. `main.tsx`
  entfernt die Kachel erst nach geöffnetem/fokussiertem Ergebnis.
- `apps/pwa/public/manifest.webmanifest`: eine App, `start_url: /`,
  `display: standalone`, keine explizite `id`, kein `launch_handler` und kein
  sessionspezifisches Manifest. `index.html` verlinkt dieses Manifest fest.

**Folgerung aus dem Code:** Ein anderer Hash/`window=1` erzeugt heute keine
eigene installierte App-Identität. Der Desktop-Handschlag beweist eine geladene
Seite, weder eine separate OS-Karte noch erfolgreichen Fokus. Auf Mobilgeräten
kann fehlendes Lebenszeichen auch Suspension bedeuten; „Pop-up blockiert“ wäre
dann eine unbelegte Diagnose. Desktopverhalten als Regression schützen.

### 3.2 Belegte Plattformmöglichkeiten und offene Gerätefragen

Offizielle Quellen, abgerufen 20.11.2026; kein eigener Gerätemesslauf:

| Plattform / Mechanismus | Belegt | Noch zu prüfen / Grenze |
|---|---|---|
| iOS/iPadOS Home-Screen-Web-App | [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) beschreibt standalone Apps mit App-Switcher-Vorschau sowie mehrere Installationen; ab 16.4 fließen Name und Manifest-ID in deren Identität ein. | Nutzer installiert bewusst über Home-Screen-Ablauf. Aktuelle Versionen, Session-start_url, getrennte Karten für A/B, Persistenz und erneute Anmeldung am Gerät prüfen. Kein automatisches Öffnen einer zweiten installierten Kopie zugesagt. |
| Chromium Manifest-ID | [Chrome-Dokumentation](https://developer.chrome.com/docs/capabilities/pwa-manifest-id) beschreibt unterschiedliche IDs als verschiedene Apps, Unterstützung seit Chrome 96. | Eigene ID ist Voraussetzung, kein Beweis für Android-Taskverhalten; WebAPK/Shortcut, OEM und Browser unterscheiden. Bestehende berechnete Haupt-App-ID vor jeder Migration ermitteln. |
| Mehrere PWAs auf derselben Origin | [Google web.dev](https://web.dev/articles/building-multiple-pwas-on-the-same-domain) dokumentiert gemeinsame Speicher/Berechtigungen und Probleme überlappender Scopes, insbesondere Installationsangebote und Link-Capture. | Haupt-App umfasst heute `/`: Session-App wäre verschachtelt. Installation bei bereits installierter Haupt-App muss funktionieren oder explizit manueller/Fallback-Pfad gelten. Keine Auth-Isolation ableiten. |
| `launch_handler` / `navigate-new` | [Chrome Navigation Management](https://developer.chrome.com/docs/capabilities/pwa-navigation-management) beschreibt neue/alte App-Fenster; die neue Capture-Version ab Chrome 139 wird für Windows/macOS/Linux genannt. | Daraus folgt keine Android-/iOS-Mehrinstanzgarantie. Nur nach Feature-/Gerätenachweis optional einsetzen. |
| Browser-Tab / Link | Vorhandener Popout kann ein weiteres Browsing Context anfordern. | Browser bestimmt Fenster/Tab, Blockierung und OS-Gruppierung. Immer „Im Browser-Tab öffnen“ nennen, keine eigene App-Karte versprechen. |

**Arbeitsannahme:** Installierbare Session-Einstiege sind der aussichtsreichste
Web-Pfad; `window.open` allein reicht nicht. **Offen:** Welche Android-Version /
Chrome-Version und iOS-Version als unterstützt gelten, ob die Installation neben
der Haupt-App möglich bleibt, und welche Auth-/Speichergrenzen real auftreten.
T76.1 erstellt eine Evidenzmatrix `supported | unsupported | not_run` mit Datum,
OS/Browser/Installationsart, A/B-Switcher-Karten und Restore-Beleg. Emulation beweist
keine OS-Karten. Ohne Gerät: `not_run`, keine Freigabe des entsprechenden Claims.

### 3.3 Geplanter Ablauf — abhängig vom Plattform-Exit

1. In jeder mobilen Sessionansicht liegt die erreichbare Aktion „Separat öffnen“.
   Dialog erklärt den verfügbaren Weg: eigene Session-App installieren/öffnen
   oder Browser-Tab. Die Quellansicht bleibt erhalten, bis der Nutzer navigiert;
   kein automatisches mobiles Detach aufgrund eines Heartbeats.
2. Kandidat für stabile Installationsseiten: gleicher vertrauenswürdiger
   Hub-Origin, `/session-app/<host-key>/<session-id>/`, eigener Manifestpfad und
   stabile `id`/`start_url`/enger `scope` pro Session. Host-key ist eine validierte
   Fleet-ID, keine beliebige Ziel-URL. Pfad ist Entwurf, per ADR festzulegen.
   Manifest-ID darf nicht nur im Hash liegen; Titeländerung ändert keine Identität.
3. Einstieg lädt Sessionhülle und genau dieses Manifest bereits vor dem
   Installationsangebot. Hub-SPA-Fallback und `public/sw.js` müssen direkte
   Pfadaufrufe/Offline-Reload bedienen, Assets absolut adressieren. Manifest und
   Einstieg dürfen nicht versehentlich für eine andere Session gecached werden.
   Bestehende Haupt-App nicht durch globale Manifest-Umschaltung umbenennen.
4. Noch nicht installiert: explizite Nutzerinstallation mit Namen „AV · <Titel>“
   und erkennbarem Host/Sessionkürzel; iOS-Anleitung über Browser/Teilen-Menü,
   Chromium-Angebot nur falls verfügbar, sonst Browser-Menü erklären. Kein
   `beforeinstallprompt` voraussetzen. Danach Start über das Home-Screen-Icon;
   erst der Plattformbeleg erlaubt die Aussage „im App-Switcher wechseln“.
5. Bereits installiert: Sessionlink anbieten. Kann der Browser die richtige App
   nicht nachweislich adressieren, zum zugehörigen Icon anleiten oder Tab öffnen.
   Kein zuverlässiges Installationsinventar oder Fremdfenster-Fokus voraussetzen.
6. Sessionhülle zeigt Titel, Host und Zustand, Navigation innerhalb der Session
   bleibt gebunden. „Zur Übersicht“ ist ein expliziter Link; Zurück/OS-Geste führt
   nicht still in eine andere Session. „Schließen“ als Anleitung/Navigation, wenn
   `window.close()` nicht erlaubt ist. Archivierte/gelöschte Session zeigt ihren
   Zustand plus Übersicht-Link; niemals auf zuletzt aktive fremde Session fallen.

**Alternativen bei negativem Spike:** Sofort nutzbarer Session-Tab mit stabiler
URL und Titel; manuell installierter Home-Screen-Einstieg nur bei Nachweis, dass
er eine Web-App und kein bloßes Lesezeichen ist; sonst bestehender interner
Sessionwechsel. Separate Origins könnten Scope-Konflikte lösen, erfordern aber
TLS/DNS/Pairing-/Storage-Konzept und gehören als spätere Entscheidung außerhalb
dieses Epics. Native Android-Tasks wären ein neuer Go-Entscheid in P32.
Ein No-go darf die Evaluation abschließen, gilt nicht als gelieferte separate App.

### 3.4 Zustand, Isolation und Wiederherstellung

Instanzidentität: Hub-Origin + Host-ID + Session-ID. URL enthält keine Tokens,
Credentials oder Promptdaten. Vorhandene Auth-/Fleet-Routen bleiben maßgeblich;
bei fehlender Anmeldung zuerst bestehendes Pairing, danach zum gebundenen Ziel.
Neu installierte iOS-Kopien dürfen nicht auf geteilte Browseranmeldung vertrauen.
Kein automatischer Token-Transfer per URL oder BroadcastChannel.

Separate Ansicht bedeutet weitere Clientansicht derselben Session, keine zweite
Session-Datenbank. K7: JSONL+Snapshot rekonstruiert Hubzustand; der stabile Einstieg
rekonstruiert die Ansichtsbindung ohne Hauptfenster/BroadcastChannel. Lokale
Projektionen/Entwürfe nach Host/Session und gegebenenfalls Instanz versionieren,
mit bestehender Entwurfslogik abstimmen; kein globales „zuletzt aktive Session“
als Ersatz für den Link. Lokales Löschen/Uninstall kann gemeinsame Daten betreffen,
niemals Hub-Session oder Haupt-App bewusst mitlöschen.

Bei `pageshow`/Sichtbarkeit/Reconnect Projektionsstand und Eventcursor abgleichen;
keine doppelt gesendeten Prompts/Approvals beim Resume. Hintergrund-TTL bedeutet
„unbekannt/suspendiert“, nicht „geschlossen“. BroadcastChannel ist optionale
Optimierung; keine Korrektheitsbedingung und keine neue dauerhafte Wahrheit.
K10: pro gebundener Session letzte Projektion mit Zeitstempel/offline; fehlt sie,
sichtbarer Offlinezustand statt falscher Daten/White-Screen. K2: begrenzter Tail,
Hintergrundarbeit reduzieren; K1: bestehende Approval-Latenz nicht verschlechtern.

Gemeinsame URL-/Instanz-/Lifecycle-Verträge zuerst in `@ancientvoid/contracts`,
sofern Hub und PWA sie teilen; ADR für neue Contracts bzw. persistente Quellen,
Migration und Recovery. UI in `features/windows`/`features/session`, dünne Routen
und bei Bedarf Core-Modul gemäß ADR-0020. Adapter bleiben unberührt und sehen
nur `AdapterContext`. K5: kleine validierte Meldungen ≤ 4 KB, große Diagnosen als
Blob; keine Tail-/Sessionkopien über Window-Nachrichten.

## 4. Aufgaben (Checkliste T76.n)

- [ ] **T76.1 — Vorbedingungen und Plattform-Spike.** P75-Exit prüfen; Desktopablauf und aktuelle Geräte-/Browser-Versionen erfassen; zwei Sessions plus Haupt-App auf Android/Chrome und iOS/Safari installieren/wechseln/restarten. Ergebnis/Blocker je Plattform, kein automatisches Go aus Dokumentation. K2/K7/K10.
- [ ] **T76.2 — Entscheidung/ADR.** Pro Plattform Web-Pfad oder benannter Fallback; ID/Scope, Routen, Haupt-App-Kompatibilität, Auth, Speicher und Recovery festlegen. Ungeklärte Scope-/Installationskonflikte blockieren den App-Pfad. K5/K7/K10.
- [ ] **T76.3 — Session-Einstieg.** Nur bei positivem Spike Session-HTML/Manifest/SW-Pfad und gebundene Ansicht umsetzen; Start/Reload ohne Hauptfenster, falsche Host-/Session-IDs und fehlende Auth sichtbar behandeln. K7/K10.
- [ ] **T76.4 — Mobile Aktion und Navigation.** Sessionaktion, Installation/Öffnen/Tab-Fallback, Titel/Host, Zurück/Übersicht/Archivzustand zugänglich machen; Desktop-Popout erhalten. K1/K2/K10.
- [ ] **T76.5 — Lifecycle und Regressionen.** Suspend/Resume, fehlender Kanal, Offline, Cache-Versionen, Hauptfenster zu, parallele Eingaben und Uninstall testen; kleine Nachrichten und keine zweite Session/Worker nachweisen. K2/K5/K7/K10.
- [ ] **T76.6 — Freigabematrix und Menschen-Abnahme.** Plattformhinweise mit Evidenz, bekannte Grenzen und Testanleitungen; nur reine menschliche Restabnahmen mit Herkunft/Schritten nach P000 verschieben. Ungeklärte Agentenarbeit/Architektur bleibt hier offen. K1/K7/K10.

## 5. Acceptance Criteria (AC-P76-k)

1. **AC-P76-1:** Plattformmatrix unterscheidet belegte Fähigkeit, Annahme und `not_run`. Ein positiver App-Pfad benötigt A/B als getrennte Switcher-Karten neben der Haupt-App, korrekte Session beim Wechsel und Kaltstart; OS/Browser-Version und Installationsart stehen am Beleg. Negativbefund benennt Alternative, kein Erfolgsetikett für Tabs.
2. **AC-P76-2:** Mobile Sessionaktion erreichbar; ohne Unterstützung/Installation klarer Installations- oder Tab-Ablauf. Abbruch/fehlendes hello entfernt keine Quellansicht und erzeugt keine falsche Blockierungsdiagnose.
3. **AC-P76-3:** A/B auf zwei Hosts mit gleicher Session-ID bleiben getrennt; Umbenennen ändert Bindung nicht. Haupt-App geschlossen, Reload und Prozessneustart führen zur gebundenen Session oder benanntem Auth/Offline/Archivfehler. Keine Tokens in Links/Manifest/Meldungen.
4. **AC-P76-4:** Öffnen erzeugt weder zusätzliche Hub-Session noch Worker. Zwei Ansichten zeigen denselben Zustand; Wiederaufnahme nach Suspension sendet keinen Prompt und kein Approval doppelt. Fehlender BroadcastChannel beeinträchtigt keine Zuordnung.
5. **AC-P76-5:** Cache-/Storage-Fälle zeigen ausschließlich passende Projektionen mit Zeitstempel; Offline-Erststart ohne Cache ist verständlich. Hub-Restore bleibt K7-konform (100 %, < 3 s), Meldungen K5-konform. Desktop-Popout/Recall und bestehende Haupt-App-Installation bleiben funktionsfähig.
6. **AC-P76-6:** Automatisierte A/B-Tails bei 30 Events/s halten K2 (< 200 ms Frame-Lag); vorhandener Approval-Pfad hält K1 (p95 < 5 s) im zugehörigen Nachweis. Gerätesuspension/OS-Karten werden zusätzlich real geprüft, nicht aus Playwright abgeleitet.

**Teststrategie:** bestehende `e2e/specs/windows.spec.ts` für Desktopregression;
geplant `e2e/specs/mobile-session-instances.spec.ts` für mobile Aktion, A/B,
Installationsabbruch, Reload/Auth/Offline ohne Kanal (mehrere Browserkontexte).
Gezielte PWA-Unitfälle für URL-/Instanzbindung und Cache-Schlüssel;
`apps/pwa/test/public-sw.test.ts` erweitern. Neue gezielte Hub-Route-Tests für
Session-Manifest, Pfadvalidierung, Cacheheader und kein Sessionstart, falls Route
nötig. Positive/negative Fixtures rot-dann-grün. Reale Switcher-/Kill-/Uninstall-
Matrix auf Pixel/Android und iPhone/iPad als Gerätebeleg; fehlendes Gerät ist
`not_run`. Reine spätere Menschen-Abnahme nach P000, erforderlicher technischer
Spike bleibt Implementierungsgate und darf nicht als Restabnahme verschwinden.

## 6. Premortem (Failure-Modi + Mitigation)

| Failure-Modus | Frühes Signal | Mitigation / Nachweis |
|---|---|---|
| Alle Links öffnen dieselbe PWA-Karte | B verdrängt A; Installation wird nicht angeboten | Zwei-Session-Spike bei bereits installierter Haupt-App, stabile ID/Scope; nur belegt unterstützten Pfad anbieten, sonst Tab-Fallback. |
| Suspension sieht wie geschlossenes Fenster aus | Heartbeat fehlt nach Appwechsel | Lifecycle-Revalidierung, TTL nur Hinweis; kein Detach/Autofokus daraus. |
| Wiederöffnung zeigt zuletzt aktive falsche Session | globaler Workspace überschreibt Einstieg | Bindung aus stabiler URL, hostbezogene Cache-/Entwurfsschlüssel; A/B/Kaltstart-Test. |
| Neue Installation startet ohne Anmeldung/offline leer | Browser funktioniert, Session-App nicht | Bestehendes Pairing mit Rückkehrziel, eigene Offlineanzeige; keine Token-URL. |
| Verschachtelte Apps stören Haupt-App oder teilen ungewollt Storage | Icon/Manifest ersetzt; Uninstall löscht lokalen Cache | Haupt-App-ID unverändert, Manifest-/SW-Cachetests, Geräteprüfung und verständlicher Hinweis zu gemeinsamen lokalen Daten. |
| Mehrere Clients duplizieren Aktionen oder Last | zwei Prompts nach Resume; Tail laggt | Keine Wiederholung beim Lifecycle-Refresh, bestehende Idempotenz nutzen, K1/K2-Regression mit zwei Ansichten. |

## 7. Definition of Done

Alle anwendbaren AC mit automatisiertem Beleg; App-Switcher-Claims ausschließlich
für positiv belegte Plattformen. Reiner No-go-Exit als solcher dokumentiert,
ohne Implementierungserfolg zu behaupten; Entscheidungstor bleibt offen, solange
der technische Pfad ungeklärt ist. Erreichbare Aktion und verständliche Fallbacks,
ADR/Contracts/Recovery geprüft, Tracker in Statuszeile nachgetragen; Defekt-PRs
mit `Fixes #`, Epic-Issues vor Abschluss sichten.
Gezielte Tests rot-dann-grün, Lint/Typecheck/PWA-Build grün; jede UI-Funktion/jeder
Ablauf mit Spec in `e2e/specs/`. Vor Epic-Abschluss `npm run gate` lokal grün auf
ausdrücklichen Auftrag; GitHub `verify` auf Abschluss-PR sowie volle K8-/E2E-Evidenz
gemäß aktuellem `docs/ci-runbook.md` (Nightly). Umgebungsrot/Skips nie als Pass.
Reine menschliche Restabnahmen nach
[P000](EPIC-000-testsuite-fuer-menschen.md) mit Herkunft, Gerät, Vorgehen und Messlatte;
hier „nach P000 verschoben“ vermerken. Keine Abnahme in diesem Planungsauftrag ausgeführt.
