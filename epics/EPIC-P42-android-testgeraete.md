# EPIC-P42 — Android-Testgeräte und Emulator in der PWA

**Status:** Umsetzung (Branch `feat/p42-android-testgeraete`) · **Umsetzung:** freigegeben am 2026-11-11 · **Phase:** P42
**Dauer:** 0,5–1 Spike + 2–4 Umsetzung Agenten-Wochen (grobe Schätzung, ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P41 mit nachweislich grünen Exit-Kriterien; wirksame Vorgänger-Abnahmen bleiben bindend.

Quelle: [Orca-Vergleich](../docs/2026-11-08_orca-vs-ancientvoid.md) und [Planungsgrundlage mit Übernahmeregister](../docs/2026-11-08_orca-epic-planung.md).
**Planungsauftrag 08.11.2026:** Nutzer beauftragt diese Epics ausdrücklich vor Abschluss der Vorgänger. Das erlaubt Planung, keine Implementierung und keine Aufhebung des Epic-Gatings. Vor T42.1 aktuellen Code-/Test-/Abnahmestand prüfen; historische Überschriften reichen nicht.
**Umsetzungsauftrag 11.11.2026:** Nutzer beauftragt die Umsetzung ausdrücklich auf eigenem Branch und erteilt den ausdrücklichen Installationsauftrag für Android SDK/Emulator (T42.1) — Installation auf `/mnt/data/toolchain/` (ADR-0067 §10). Epic-Gating P41 bleibt bindend; dieser Branch dokumentiert den P42-Stand für sich.

## 1. Ziel

Eine Android-Testumgebung in AV auswählen, sichtbar bedienen und für reproduzierbare App-/PWA-Tests einsetzen. Viewport-Emulation aus P39 und echtes Android klar unterscheiden. K1/K2/K5/K7/K8/K10; K6 nur bei tatsächlichem Audio-/STT-Test.

## 2. Scope (In / Out)

**In:** Host-Check für Android SDK/KVM/ADB, ausdrücklich ausgewählter AVD, Emulatorstart/-stopp, Screenshot/Frame-Ansicht, Tap/Swipe/Text/Rotate, Browser-PWA-Test, APK-Installation nur aus ausgewähltem Artefakt, begrenzte Logs/Accessibility-Tree.
**Out:** iOS-Simulator auf Linux, ungefragte SDK-/Image-Downloads, physisches Haupt-Handy fernsteuern, Desktop-Companion/Sprachausgabe ersetzen, Emulatorlauf als Pixel-/Push-/Biometrie-Abnahme zählen.

## 3. Design-Details

### 3.1 Machbarkeit und Stufen
Spike prüft SDK/KVM/Hardware auf tatsächlichem AV-Host, Bootzeit, RAM und nutzbare PWA-Übertragung. Falls Hardware fehlt: konkrete Voraussetzung und blockierten Implementierungsstart dokumentieren, kein grüner Feature-Exit. Android zuerst. Minimaler Frame-Pfad (Screenshots/MJPEG) vor optional H.264/scrcpy; Codec-/Browser-Support messen, nicht aus Electron übernehmen. K1/K2/K8 müssen auch bei Emulatorlast halten. iOS nur möglicher späterer Mac-Backend-Auftrag.

### 3.2 Architektur und Besitz
Verträge `contracts/src/devices/`, `core/modules/devices`, Hub `modules/devices/`, PWA `features/devices/`. Emulator-/ADB-Calls über registrierte Worker-Aktionen mit argv/Fristen, keine freie `adb shell`-Route. Geräte-ID/AVD/Host/Session und Eigentümergeneration, eine aktive Steuerungslease je Gerät. Nur AV-eigene Emulatoren stoppen; fremdes physisches Gerät braucht gesonderte Nutzerwahl und liegt zunächst außerhalb des Scopes. Agenten greifen über registrierte Testoperationen zu, niemals Companion-Input. P39-Browserdienst und Device-Dienst teilen Artefaktbezüge, nicht automatisch Profile/Steuerung.

### 3.3 Reproduzierbare Tests
Gewählte Systemimage-/API-Version, Auflösung, Orientierung, App-Build-SHA, Permissions und Startzustand am Lauf festhalten. Ein Reset kann Testdaten löschen und braucht konkrete Freigabe; kein pauschales Wipe beim Öffnen des Panels. PWA im Emulator-Chromium öffnen; Push/Lockscreen/Berechtigungen nur soweit nachweisbar. APK von referenziertem Session-Artefakt mit Hash; keine fremden URL-Downloads durch Agenten. Logs/Tree maskieren/begrenzen und als Blobs referenzieren.

### 3.4 Wiederanlauf und Grenzen
Nach Hub-Neustart Gerät nur anhand belegter Eigentümerschaft adoptieren, Input nicht wiederholen. Auflösung/Rotation pro Frame-Version mit Input verknüpfen; alte Klicks verweigern, statt falschen Punkt zu treffen. Stream-Disconnect stoppt laufende Gesten. Fremdes Offline/Unauthorized-Gerät wird verständlich erklärt. P12/P16 reale Handy-Abnahmen bleiben offen, auch wenn AVD-Test grün ist. Voidwarden bleibt separat und muss für Device-Tests nicht laufen.

### Orca-Referenzen und Übernahmegrenzen

Alle Links auf Commit `bdeb388d75120b6e36dd619291286de0cc9aae02`. Einstufung ist eine geprüfte Port-Hypothese, keine behauptete fertige AV-Kompatibilität. Vor Übernahme Imports/Lizenz/Tests/Strip-Type-Tauglichkeit erneut prüfen; keine großen Orca-Subsysteme blind kopieren.

| Quelle | Verwendung in AV |
|---|---|
| [src/main/emulator/android/adb-devices.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/emulator/android/adb-devices.ts) | Guter kleiner Port-Kandidat: Parser und argv-Helfer weitgehend eigenständig; unbekannte Zustände nach AV fail loud. |
| [src/main/emulator/android/adb-devices.test.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/emulator/android/adb-devices.test.ts) | Mit Parser portierbare Testfälle; eigene Negativfälle und Worker-Grenze ergänzen. |
| [src/main/emulator/android/android-input-mapping.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/emulator/android/android-input-mapping.ts) | Port-Kandidat für Koordinaten/Keys, EmulatorError-Abhängigkeit entfernen; NaN/Nullgröße/Rotation ergänzen. |
| [src/main/emulator/backends/emulator-backend.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/emulator/backends/emulator-backend.ts) | Capability-/Backend-Vorbild, keine freie exec-Methode in AV übernehmen. |
| [src/main/emulator/android/scrcpy-stream-session.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/emulator/android/scrcpy-stream-session.ts) | Streaming-Referenz mit großem Abhängigkeitsbaum; keine Copy-and-paste-Zusage. |

## 4. Aufgaben (Checkliste T42.m)

- [x] **T42.1** Host-/SDK-/KVM-Spike und ADR zu Android-Backend, Frame-Codecs, Eigentümer und Ressourcenlimits; erforderliche Downloads nur auf ausdrücklichen Installationsauftrag. **K1/K2/K7/K8**.
  *Umgesetzt 2026-11-11:* SDK/JDK auf `/mnt/data/toolchain/` (bestehende Installation, AV-eigenes AVD-Home `av-avd`, AVD `av-test` Pixel 6/API 35); Spike-Messwerte (Boot 45 s, Frame 1,1 s/92 KB, Tap 0,26 s, Baum 4,2 s, RSS ~3,9 GB) und alle Entscheidungen in [ADR-0067](../docs/adr/0067-android-testgeraete.md). Ehrlicher Host-Check: `DeviceCapabilities` mit Gründen (Unit-testbar, sichtbar in PWA/hubctl).
- [x] **T42.2** Device-/Action-/Frame-/Test-Contracts und ADB-Inventarparser mit unauthorized/offline/unbekannt testen; ownershipgesicherter AVD-Start/-Stop. **K5/K7**.
  *Umgesetzt:* `contracts/src/devices/devices.ts`; Parser-Port aus Orca `bdeb388d` mit eigenen Negativfällen (`packages/core/test/modules/devices/adb.test.ts`: unauthorized/offline/„no permissions“/unknown); Eigentum über pid+argv+`ANCIENTVOID_DEVICE_OWNER`-Marker, Adoption/Stop nur mit Nachweis (`device-service.test.ts`); Stop fremder/physical → 403.
- [x] **T42.3** PWA-Ansicht/Popout, Größen-/Rotationsversionen und Inputlease; Drift/Disconnect/fremdes Gerät verweigern. **K1/K2/K10**.
  *Umgesetzt:* `apps/pwa/src/features/devices/` (Panel + Popout `#/geraete`), Lease mit Generation, Eingaben an `geometryVersion` gebunden (Rotation → 409 auf altem Bild, Unit- und E2E-geprüft); Lease-Ruhe (Disconnect) → Reaper gibt frei; physische/fremde Geräte sichtbar, unbedienbar.
- [x] **T42.4** PWA-/APK-Testablauf mit Artefakt-Hash, gezielten Input-/Permission-Aktionen und begrenzten Logs/Tree bauen. **K5/K7**.
  *Umgesetzt:* `DeviceTestRun` mit Umgebungsnachweis (AVD/API/Fingerprint/Auflösung/Orientierung), registrierte Schritte inkl. `expectText` über Accessibility-Baum; APK-Installation nur aus sha256-adressiertem Anhang mit erneuter Hash-Prüfung; Logs ≤ 128 KB maskiert, Baum ≤ 512 KB — alles Byte-Antworten, nie Events.
- [x] **T42.5** Recovery/Ownership/CPU-/RAM-/Streamquotas und Testjob-Abbruch mit echten Emulatorprozessen prüfen. **K7/K8**.
  *Umgesetzt:* Journal-Folding mit Adoption/`unknown`-Läufen (Unit-Tests mit Prozess-Fakes); Quotas max. 1 Emulator (`devices.maxEmulators`), Boot-Frist 180 s, Lease-IDLE 45 s; Abbruch zwischen Schritten (`aborted`) getestet. *Echte Emulatorprozesse:* `device-real.test.ts` (env-ge gated) + E2E-Abnahme mit `ANCIENTVOID_E2E_ANDROID=1` (Boot/Frame/Tap/Logs/Baum/PWA-im-Chrome); RSS-Nachweis ~3,9 GB im ADR.
- [x] **T42.6** `e2e/specs/android-device.spec.ts` für Panel/API plus gesonderte echte Android-Abnahme; fehlendes SDK/KVM sichtbar skip/blockiert und nie Pass; Gate/PWA-Build. **K1/K2/K5/K7/K8/K10**.
  *Umgesetzt:* Spec prüft den blockierten Zustand als Verhalten (kein stilles Grün), Agent-403, physical-403; echte Abnahme (Start→ready→Frame→Lease→Drift-409→Logs/Baum→PWA-Test im Emulator-Chrome→Stop) nur mit `ANCIENTVOID_E2E_ANDROID=1`, sonst sichtbarer Skip mit Grund.

## 5. Acceptance Criteria (AC-P42-k)

- **AC-P42-1:** Ein auf dem Zielhost gestarteter AVD ist in der PWA sichtbar und bedienbar; Boot-/Ressourcen-/Codec-Nachweis liegt vor. → *Beleg: echte Abnahme am 11.11.2026 grün (`ANCIENTVOID_E2E_ANDROID=1`, 4/4 Tests): Boot 32 s, Frame nach ready 1,3 s, API 35; Spike-Messwerte + RSS ~3,9 GB in ADR-0067; PNG-Standbild-Pfad statt Codec-Matrix dokumentiert und begründet.*
- **AC-P42-2:** PWA-Test und eine gezielte App-/Permission-Aktion sind auf echtem AVD belegt, samt API/Build/Startzustand. → *Beleg: echte Abnahme öffnet die PWA im Emulator-Chrome (inkl. First-Run-Beendigung über Baum-Taps) und erwartet „Verbinden“ im Accessibility-Baum — `passed`; DeviceTestRun.env hält AVD/API/Fingerprint/Auflösung/Orientierung fest; Permission-Aktion (`pm grant/revoke`) im Vertrag + Unit-Test.*
- **AC-P42-3:** Kein unbekanntes/physisches Gerät wird automatisch gesteuert oder beendet; Lease-/Generation-Konflikte werden verweigert. → *Beleg: Unit- (stop blocked/404, lease busy/conflict) und E2E-Tests (physical-403, Agent-403).*
- **AC-P42-4:** Veralteter Frame/Rotation und Disconnect führen nicht zu falschen/replayten Eingaben. → *Beleg: Geometrie-Version → 409 (Unit+E2E); Eingaben nie wiederholt — nach Neustart keine Lease-Wiederherstellung, `unknown`-Läufe mit „nichts wird wiederholt“ (Unit-Test); Lease-IDLE beendet Steuerung.*
- **AC-P42-5:** Hub-Restart erhält Lauf/Artefakte und prüft Ownership vor Adoption; Eventpayloads bleiben ≤4 KB. → *Beleg: Journal-Folding/Adoption nur mit Marker (Unit-Tests); Frames/Logs/Bäume sind nie Events (K5 by construction); Vertrags-Grenzen als Konstanten.*
- **AC-P42-6:** AVD-Nachweis ist klar von P12/P16 Pixel-, Biometrie-, Push- und realer Mobilnetz-Abnahme getrennt. → *Beleg: echte Abnahme separat env-ge gated (nicht `phone`-Projekt); ADR §Konsequenzen.*

## 6. Premortem (Failure-Modi + Mitigation)

1. Emulator bringt Hub zum Stillstand → Host-Spike, Ressourcenlimit und Lastbudget vor Featurefreigabe.
2. Falsches Gerät wird bedient → stabile Host/Serial/Generation-Lease, Haupt-Handy außerhalb MVP.
3. Rotation verschiebt Tap → Frame-/Geometrieversion an Input binden.
4. SDK fehlt, Test gilt trotzdem grün → sichtbarer Skip/blockierter Hardware-Nachweis und echter AVD-Exit.

## 7. Definition of Done

Alle T42.* und AC-P42-* mit aktueller Evidenz, Vorgänger-Exit ausdrücklich grün. `npm run gate` und PWA-Build grün; Pipeline-Job `e2e` grün bzw. Infrastrukturfall nach `docs/ci-runbook.md` nachgezogen, niemals als Pass gezählt. Jede neue UI-Funktion/jeder Ablauf hat einen Spec in `e2e/specs/`; benötigte echte Browser-/Provider-/Geräte-Nachweise separat, Skip ≠ Pass. Neue APIs/Tools/Ansichten sind registriert, in Hub/PWA/hubctl erreichbar und dokumentiert. ADR vor Contract-Änderung, K5/K7/K8 entsprechend Scope nachgewiesen; keine offene TODO ohne Epic-Bezug. Übernommene Orca-Teile mit Commit/Pfad/Hash/Lizenz/Änderungsnotiz und eigenen Tests gemäß Planungsgrundlage.

## 8. Planungsvertiefung 2026-11-10 (Evidenz; ändert Gating nicht)

Planungsauftrag ohne Implementierung. Befunde am tatsächlichen Stand (main @ 7db654d, P40 gemerged; P41 offen auf `feat/p41-automationen`, T41.1–T41.3, kein MR):

### 8.1 Host-Snapshot (AV-Host, 2026-11-10)

- **KVM nutzbar:** `/dev/kvm` vorhanden (crw-rw-rw-), 16 Virtualisierungs-Flags, RAM 31 Gi total / ~10 Gi verfügbar. Hardware-Voraussetzung für den T42.1-Spike erfüllt; Emulatorlast braucht dennoch CPU-/RAM-Limit und Lastbudget (Premortem 1).
- **adb 37.0.1** standalone unter `~/.local/bin/adb` — `adb devices -l` läuft ohne SDK.
- **Fehlt:** `ANDROID_HOME`/SDK-Verzeichnis, `sdkmanager`, `avdmanager`, `emulator`-Binary, AVDs, `scrcpy`. **Konsequenz:** T42.1 blockiert bis zum ausdrücklichen Installationsauftrag (SDK-Manager + System-Image; Epic §3.1 „keine ungefragten Downloads"). Kein grüner Feature-Exit ohne echten AVD-Boot (Premortem 4). `ffmpeg` vorhanden (falls MJPEG/H.264-Transcode im Frame-Pfad nötig wird — nach Spike messen).

### 8.2 Orca-Port-Hypothesen am Commit bdeb388 verifiziert

- **Lizenz: MIT** (LICENSE, Copyright 2026 Lovecast Inc.) — Port mit Quellenangabe zulässig; `package.json` hat kein eigenes license-Feld, LICENSE-Datei ist maßgeblich.
- **[adb-devices.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/emulator/android/adb-devices.ts) (99 Zeilen, null Imports):** bestätigt als bester Port-Kandidat. Parser für `devices -l` inkl. zweizeiligem `no permissions`-Token, `parseWmSize`, `isBootCompleted` plus argv-Helfer (`adbShellArgs(serial, cmd)` etc. — genau das argv-only-Muster, keine Shell-Strings). Unbekannte Zustände bleiben offener String-Typ → AV-seitig fail loud abbilden. Test-Datei (22 Zeilen, nur vitest + eigene Exports) direkt portierbar; eigene Negativfälle ergänzen.
- **[android-input-mapping.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/emulator/android/android-input-mapping.ts) (64 Zeilen, 1 Import `EmulatorError`):** Port ok nach Ersetzen des Fehlertyps. **Nachgewiesene Lücken:** `toPixel(NaN, d)` liefert NaN (beide Vergleiche false), `toPixel(x, 0)` klemmt auf `max = -1` — die Epic-Forderung „NaN/Nullgröße ergänzen" ist konkret: Input-Zuordnung muss Frame-Geometrie > 0 validieren und sonst die Aktion verweigern (fail loud, AC-P42-4).
- **[emulator-backend.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/emulator/backends/emulator-backend.ts):** in Orca-Subsysteme verdrahtet (`emulator-gesture-sender`, `emulator-failure-copy`) — nur Capability-Vorbild, keine Übernahme; AV bekommt keine freie exec-Methode.
- **[scrcpy-stream-session.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/emulator/android/scrcpy-stream-session.ts) (310 Zeilen, ≥12 Imports:** `@orca/process-host`, `h264-sps-picture-size`, `relay-frame-buffer`, `android-command-runner`, `android-sdk-discovery`, `emulator-probe` …):** bestätigt „großer Abhängigkeitsbaum". MVP-Eigenbau des minimalen Frame-Pfads (`adb exec-out screencap` → JPEG/Blob, seq-nummeriert) statt Port; H.264/scrcpy erst nach gemessenem Codec-/Browser-Befund (Epic §3.1).

### 8.3 AV-Anknüpfungspunkte (Bestand, main @ 7db654d)

- **Kein `devices/`-Bestand** in `packages/contracts/src/`, `packages/core/src/modules/`, `apps/hub/src/modules/`, `apps/pwa/src/features/` — alle vier Schichten neu, Verortung nach ADR-0020 wie im Epic §3.2.
- **P39-Browser als Struktur- und Frame-Vorbild:** `BROWSER_FRAME_QUALITY=60`, `BROWSER_FRAME_MIN_INTERVAL_MS=120`, Viewport-Presets, Limits für Kontexte/Artefakte/Schritte/Timeouts, Frames als `{ data: Buffer; seq: number }` (browser-service.ts:356). Die `seq`-Versionierung ist das Muster für „Input an Frame-/Geometrieversion binden, alte Klicks verweigern" (AC-P42-4) — Devices übernimmt die Limit-Disziplin mit eigenen Konstanten, keine Wiederverwendung der Browser-Contracte.
- **Registrierte argv-Aktionen mit Frist:** Workspace-Runtime (P29) betreibt bereits `argv`+`timeoutMs`+readiness für setup/services/teardown (packages/core/test/modules/workspace/) — das AV-eigene Muster, an dem sich Emulator-/ADB-Worker-Aktionen orientieren; weiterhin keine freie `adb shell`-Route (Epic §3.2).
- **Ergebnis-Semantik:** P41-Contract-Entwurf (Branch) führt getrennte Skip-Gründe und „dispatched ≠ succeeded" — für Device-Aktionen und Testabläufe analog übernehmen (AC-P42-2/3).
- **E2E:** `e2e/specs/browser-workspace.spec.ts` und `orchestration.spec.ts` als Vorbild für `android-device.spec.ts`; fehlendes SDK/KVM muss sichtbar skippen/blockieren (T42.6, Skip ≠ Pass).

### 8.4 Für T42.1 mitzubringende Entscheidungen (offen)

1. Installationsauftrag: SDK-Pfad, System-Image/API-Level, AVD-Definition (Auflösung, API) — Nutzerentscheidung, Epic §3.1.
2. Frame-Codec: MJPEG/Screencap-Polling vs. H.264/scrcpy — erst nach Spike-Messung auf dem Host (8.1) entscheiden.
3. Ownership-/Lease-Felder (Host/Serial/Generation) und Ressourcenlimits (CPU/RAM/Stream-Quota) im ADR festlegen, bevor Contracts entstehen (T42.1 → T42.2).
4. Bindung an P41-Exit: P41 T41.4–T41.6 offen; P42-Implementierungsstart bleibt gesperrt bis Vorgänger-Exit ausdrücklich grün (§ Kopf, AGENTS.md Gating).
