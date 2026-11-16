# Orca-Impulse: Epic-Planung und gezielte Codeübernahme

**Stand:** 08.11.2026 · **Auftrag:** Epics planen, keine Features implementieren.
**Bestandsbasis:** AncientVoid `0134f5b5a83550a836047122a49b9cc9274aebe3`, Orca `bdeb388d75120b6e36dd619291286de0cc9aae02` (1.4.214).
Quelle: [Vergleich mit Code-Evidenz](2026-11-08_orca-vs-ancientvoid.md).
**Remote-Nachgleich:** `origin/main` `08b92402736940e3c924133d1dee344977079801` enthält inzwischen Commit-Abschnitte im Diff (AC-P2-1) und Secret-Scan-Nachzüge. P36 berücksichtigt Commit-SHA/uncommitteten Scope; die vorhandene Gliederung ist keine neue Aufgabe. Der Erstreport bleibt historisch auf seiner genannten Basis.

## 1. Nutzerentscheidungen und offene Fragen

Auftrag vom 08.11.2026: Diff-Feedback und GitLab-Kontext sind gewünscht. Im Folgeauftrag desselben Tages fordert der Nutzer zusätzlich eine rechte Projekt-Datei-Sidebar, vollständige Dateiansichten unabhängig vom Format sowie Syntax-Highlighting und Fehlererkennung wie in VS Code; dieser bisher nicht abgedeckte Scope wird P46. Ein eigener Browser in AV soll Tests und visuelles Feedback ermöglichen; bei Session-Erstellung soll zwischen isolierter Arbeit und echtem Projekt gewählt werden können. Hermes soll als Orchestrator unterschiedliche Harnesses/Provider steuern können. Automationen, Android-Emulator, Plugins und sauberere UI mit mehr Styling sollen als neue Epics aufgenommen werden. Orca-Quellen sollen konkrete Wiederverwendung erleichtern und unnötige Recherche/Tokenaufwand sparen.

Festgelegt:

- **PWA bleibt** primärer Client. Kein Electron-/React-Native-Umbau aus dieser Planung.
- **Voidwarden bleibt separat**, einschließlich Companion und Sprachausgabe. Kein zweiter neuer AV-Companion; vorhandene P11-/ADR-0031-Pfade nicht ungefragt entfernen oder migrieren.
- **„Sandbox“ wird präzisiert:** eigener Git-Worktree vs. Projekt direkt ist der Arbeitsort; Harness-/OS-Sandbox ist eine getrennte Fähigkeit. P38 plant zwei verständliche Radiokarten statt einer missverständlichen Checkbox.
- **Vorhandene Zustellung zuerst auditieren/verfeinern.** Keine neue Chat-Engine; P36 enthält den begrenzten Audit und übergibt reproduzierbare Fehler an den Bugfix-Workflow.
- **Neue Epics dürfen jetzt geplant werden.** Der ausdrückliche Nutzerauftrag erlaubt die Planung vor grünen Vorgängern; er erlaubt weder Implementierungsstart noch das Abhaken offener Abnahmen.

Offen bleibt **Zugang ohne Tailscale/Account-Anmeldung**. P45 plant nur Evaluation und Nutzerentscheid. Kein Account, Relay, öffentliches Deployment oder Freischalten eines Ports ist hier beauftragt. Ein Account ersetzt keinen Netzwerktransport.

## 2. Bestand und Doppelplanung

| Bestand | Was bereits bezahlt ist | Umgang in dieser Planung |
|---|---|---|
| P29 / ADR-0051 | Manifest, Setup/Teardown, Include, Services, Ports, Preview, Recovery | P38 erweitert Arbeitsort, P39 ergänzt echte Browserengine; Runtime nicht duplizieren |
| P34/P35 | Fenster, Fonts/Farbe, Discovery, Resume/Modellkonfiguration; gemeinsame Live-Abnahme offen | P43 baut auf belegtem Bestand auf; offene AC bleiben unter ihren IDs |
| P30 | Adapter-/Sink-Installation mit Hash und Contract-Testkit | Zusätzliche Orca-Referenzen; P44 ergänzt UI-/Theme-Gattungen später |
| P31 / P35 | Provider-Katalog und konfigurierbare Harness-/Modelldaten | P40 nutzt Capability-Wahrheit, keine zweite Providerliste |
| P32 | Mobile-Bedarfsevaluation und optionale native Shell | Nutzerpräferenz PWA ergänzen; native Umsetzung ohne späteren konkreten Nutzerentscheid gesperrt |
| P19/P26 | Externe Loops, Factory-Treiber/Beobachter, Hermes-Orchestrator bereits vorgesehen | T40.1 entscheidet vorhandene externe Steuerung vs. hub-owned Erweiterung anhand echter Schnittstellen |
| P15/P27 | Persistente Queue, interrupted, Resume | P36 auditieren, bestehende Garantien erhalten; kein Bug aus Codelektüre erfinden |
| P11 / Voidwarden | Vorhandene definierte Desktop-Aktionen / separate neue Companion-Lösung laut Nutzer | Keine Companion-/TTS-Neuimplementierung und keine ungefragte Migration |

Der Bericht korrigiert ältere, heute überholte Aussagen der ersten Paseo-Analyse; insbesondere Diffs, Code-/Symbolsuche, Worktrees und selbstverwaltete CI sind kein fehlendes Grundfundament mehr. Historische Gate-Zahlen sind keine aktuellen Produktabnahmen.

## 3. Neue Epics und Abhängigkeiten

Die bestehende Kette **P27 → P28 → P29 → P34 → P35 → P30 → P31 → P32 → P33** bleibt bestehen. Diese Planung hängt **P36 → P37 → P38 → P46 → P39 → P40 → P41 → P42 → P43 → P44 → P45** an. P46 wird auf den Folgeauftrag zwischen P38 und P39 eingefügt; bestehende Nummern bleiben stabil. Reihenfolge ist Planungsstand, keine Startfreigabe; Umpriorisierung wird später ausdrücklich dokumentiert. Keine stillschweigende Ausnahme vom Epic-Gating.

**Umpriorisierung 2026-11-08 (Nutzerentscheid Jan):** P30 und P31 laufen nach
P36; P32 ist mit dem Evaluations-Exit „vertagt" abgeschlossen
([Entscheidungsdokument](2026-11-08_p32-evaluations-exit.md)). Gültige Kette
ab P35: **P35 → P32 (Evaluations-Exit) → P33 → P36 → P30 → P31 → P37 → …**
Live-Abnahmen bleiben gebündelt im Endabnahme-Block (EPIC-P35 §8).

P32/P33 dürfen nur mit ausdrücklich dokumentiertem gültigem Evaluations-/Umsetzungs-Exit passieren. Die Präferenz PWA schließt allein weder P32 noch P33 ab. P36 verlangt P33-Exit und dessen wirksame Vorgänger; offene AC-P34-13/AC-P35-7 bleiben bindend. Es gibt keine Abnahme durch Schweigen.

| Epic | Ergebnis | Fachliche Basis zusätzlich zum linearen Vorgänger | Grober Umfang (Agenten-Wochen) |
|---|---|---|---|
| [P36 — Diff-Review](../epics/EPIC-P36-diff-review-feedback.md) | Notizen, Sammelauftrag, veraltete Anker, vorhandene Zustellung auditieren | P2/P15/P27 | 1–2 |
| [P37 — GitLab-Kontext](../epics/EPIC-P37-gitlab-review-ci.md) | Issues/MRs/CI/Threads und gezielte Rückgabe an Agenten | P28/P36 | 2–3 |
| [P38 — Session-Arbeitsort](../epics/EPIC-P38-session-arbeitsort.md) | Worktree oder Projekt direkt, sichtbare Wahl und Ownership | P14/P29 | 1–2 |
| [P46 — Projekt-Explorer/Dateiansicht](../epics/EPIC-P46-projekt-explorer-dateiansicht.md) | Rechte Sidebar, vollständige Source/Preview/Hex-Ansichten, Sprachdiagnosen | P38, vorhandene Code-/Attachment-Pfade | 3–5 |
| [P39 — Browser](../epics/EPIC-P39-browser-testarbeitsplatz.md) | Host-Chromium in PWA, Tests/Artefakte und Design-Auswahl | P29/P36/P38/P46 | 3–5 |
| [P40 — Hermes-Orchestrierung](../epics/EPIC-P40-hermes-orchestrierung.md) | Aufgaben/Versuche/Fragen, gemischte Harnesses, klare Lifecycle-Autorität | P19/P26/P31/P35/P38/P39 | 3–5 |
| [P41 — Automationen](../epics/EPIC-P41-automationen.md) | Zeitpläne, Precheck, Historie, genau ein zuständiger Scheduler | P38/P40 | 2–3 |
| [P42 — Android-Testgeräte](../epics/EPIC-P42-android-testgeraete.md) | AVD, Ansicht/Input und reproduzierbare Android-Tests | P39, Hardware-/SDK-Spike | 0,5–1 + 2–4 |
| [P43 — UI/Styling](../epics/EPIC-P43.5-darstellungs-presets-quellenchips.md) | Aufgeräumte Flows, Quellenübergabe, Navigation, Presets/Layouts — seit 10.11.2026 aufgeteilt: UX-Teil in [P43](../epics/EPIC-P43-ux-next-level.md), Rest in P43.5 | P18/P34/P35/P36–P42 | 2–3 |
| [P44 — UI-Plugins](../epics/EPIC-P44-plugin-panels-themes.md) | Panels/Themes über P30-Lifecycle, enger Bridge-Vertrag | P30/P43 | 2–3 |
| [P45 — Zugangsevaluation](../epics/EPIC-P45-zugang-ohne-tailnet-evaluation.md) | Varianten mit/ohne Tailnet vergleichen, expliziter Entscheid | Fleet/Auth/Recovery-Bestand | 0,5–1; Implementierung separat |

Schätzungen sind Größenordnungen ohne Vorgänger-Restarbeit, Installationen und reale Abnahmen. Sie sind keine Termin- oder Tokenersparnis-Garantie. Browser/Emulator enthalten technische Spikes mit eigenem Machbarkeitsnachweis; dessen Scheitern ist kein gebautes Feature.

## 4. Warum ein eigener Browser zur PWA passt

Die PWA ist Oberfläche, Chromium läuft als verwalteter Prozess auf dem AV-Ausführungshost. Das ermöglicht echte Browserkontexte, Playwright-Assertions und DOM-/Style-Auswahl auch ohne Electron-App. Anzeige per begrenztem Frame-/Screenshot-Stream, Eingabe über authentifizierte registrierte Operationen. Ein Browserframe in der PWA ist eine Fernansicht auf diesen Browser, keine neue Engine im Handy.

P29s iframe-Preview bleibt für einfache Services sinnvoll. Sie wird nicht durch Entfernen der Sandbox und Öffnen eines beliebigen Proxy-Ziels zum „Browser“ umetikettiert. P39 prüft Bandbreite, Eingabelatenz, Lesbarkeit und Hostlast auf Desktop/Pixel. Getrennte Cookies/Storage, definierte Testziele, kein öffentlicher CDP-Port und keine Nutzung persönlicher Browserprofile sind Teil des Designs. Browserausfall darf Session-Restore/Not-Stopp nicht blockieren.

Android-Emulator ist eine andere Fähigkeit als mobiles Chromium-Viewport. P42 führt Android-API, App-Build und Gerätestartzustand als Nachweis. Reale Pixel-/Push-/Biometrie-Abnahmen P12/P16 werden dadurch nicht ersetzt.

### Nachtrag: Dateibaum/Viewer/Diagnosen (P46)

Der aktuelle `CodeFile`-Contract lädt höchstens 1 MiB und liefert Binärdateien ohne Anzeige; `CodePane` ist suchorientiert und lädt bei abgeschnittenem Inhalt nicht den Rest. Der Highlighting-Bestand in anderen Views ist keine vollständige Dateiansicht. P46 ergänzt daher explizit die rechte Sidebar für alle berechtigten Projektdateien, revisioniertes Nachladen bis EOF, Code-/Dokument-/Medien-Viewer und vollständigen Byte-/Hex-Fallback für unbekannte Formate. Sidebar/Viewer sind zunächst lesend; keine implizite Autosave-/Dateimutationsfunktion.

„Wie VS Code“ wird durch konkrete Abnahmen ersetzt: Syntaxfarben plus JSON-Parserfehler, tatsächliche TS/JS-Projektdiagnose, Python-Checker und Fehlerliste mit revisionsgenauer Navigation. Orcas Monaco-Doku empfiehlt für Typechecker/Linter Terminals; diese AV-Diagnosefläche ist zusätzlicher Nutzerumfang. Monaco ist ein Desktop-Kandidat, keine zugesagte Voll-IDE. Die [offizielle README](https://github.com/microsoft/monaco-editor) erklärt fehlenden Mobile-Support und fehlende allgemeine VS-Code-Extension-Kompatibilität; deshalb Desktop/Pixel-Spike und schlanker mobiler Fallback mit derselben Diagnose-API. P39 bleibt zuständig für aktiven Browser/Testablauf, P43 für Gestaltung und P44 für spätere optionale Viewer-Erweiterungen.

## 5. Was sich aus Orca tatsächlich übernehmen lässt

Alle Referenzen sind auf [Commit bdeb388d75120b6e36dd619291286de0cc9aae02](https://github.com/stablyai/orca/tree/bdeb388d75120b6e36dd619291286de0cc9aae02) gepinnt. Lokaler Analyse-Checkout war `/tmp/ancientvoid-orca-review-20261108`; er ist kein Bestandteil oder Voraussetzung des Repos. Links und das Hashregister unten erlauben spätere gezielte Wiederbeschaffung. Nicht unbesehen die dann aktuelle main lesen.

**Einstufung:**

- **Port-Kandidat:** kleiner gelesener Parser/Typ/Helfer oder Testfall. Könnte nach Anpassung übernommen werden; noch kein Kompatibilitäts-/Lizenz-/Sicherheitsnachweis für AV.
- **Referenz:** gekoppeltes Subsystem. Modell/Invarianten/Testfälle übernehmen, AV-Implementierung entlang eigener Contracts bauen.
- **Produktreferenz:** UX/Zielverhalten ansehen; kein kopierfertiger Code.

| Thema | Enger Einstiegspunkt im Orca-Checkout | Einschätzung / konkrete Anpassung |
|---|---|---|
| Diff-Notizen | `src/shared/diff-comment-types.ts` | Kleiner Typ-Port; Session-/Diff-Bezug, ISO-Zeit und Recovery auf AV umstellen |
| Review-Persistenz | `src/renderer/src/store/slices/diff-comments/diff-comment-persistence.ts` | Nur Write-Reihenfolge/Rollback-/Host-Besitz als Referenz; Orca-Zustand-Store nicht einführen |
| GitLab | `src/main/gitlab/merge-request-review-mutations.ts` | glab-Argumente/Fehlerfälle übernehmen; Connection-/ProjectRef-Graph durch AV-Modul ersetzen |
| Browserauswahl | `src/main/browser/element-grab/grab-guest-element-context-script.ts` | Selector-/Style-Kern portierbar; benötigt Foundation/STYLE_PROPS/BUDGET/Secret-Maskierung und geprüftes Playwright-Instrumentieren |
| Browser-Payload | `src/main/browser/element-grab/browser-grab-payload.ts` + gleichnamiger Test | Budgets/Maskierung als Testvorlage; AV Blob-/Attachment-Contract nutzen |
| Orchestrierung | `src/main/runtime/orchestration/db/tasks/task-store.ts` und `task-status-transition.ts` | Fachinvarianten portieren; keine zweite Orca-SQL-Wahrheit neben AV-JSONL |
| Dispatch-Tests | `src/main/runtime/rpc/orchestration-task-dispatch-invariant.test.ts` | Szenarien aktiver/staler Versuche im eigenen Hub-Testharness nachbilden |
| Kalender | `src/shared/automation-schedule-parsing.ts`, `automation-schedule-occurrences.ts`, DST-Tests | Kandidat für gezielten Port, aber mehrere Hilfsimporte; eigenes begrenztes Cron-/DST-Verhalten bleibt maßgeblich |
| Android-Inventar | `src/main/emulator/android/adb-devices.ts` + Test | Eigenständiger Parser/argv-Helfer, bester kleiner direkter Kandidat; unbekannte Formate nach AV fail loud |
| Android-Input | `src/main/emulator/android/android-input-mapping.ts` | Koordinaten/Key-Mapping mit eigener Fehlerklasse und zusätzlichen NaN-/Rotations-/Dimensions-Tests |
| Plugins/Themes | `src/shared/plugins/manifest/plugin-manifest-fields.ts`, `src/shared/plugins/artifacts/plugin-theme-artifact.ts` | Kleine API-/Schema-Ideen, nicht Orcas großes generiertes Manifest kopieren; AV-Whitelist/Version/IDs |
| Kontrast | `src/shared/terminal-themes/terminal-contrast-correction.ts` | Nur mit zwei Hilfsimporten sinnvoll; keine Terminalwerte als AV-Accessibility-Garantie behandeln |
| Relay/Accounts | `cloud/README.md`, Relay-Vertrag, Pairing-Tests | Evaluations-/Betriebsreferenz; nicht kurzfristig kopierfertiger Accountdienst |

Jedes Epic enthält zusätzliche direkt verlinkte Einstiege und Übernahmegrenzen. Dokumentation von Orca ist keine Live-Verifikation einer AV-Fähigkeit. Insbesondere Terminal-Emulation unter `src/main/daemon/emulation/` nicht mit Android-Emulator verwechseln; „Worktree checkpoints“ sind Statusnotizen, keine Dateisnapshots.

### 5.1 Arbeitsrezept für spätere Implementierung

1. Epic-AC, AV-Bestand und seine genannten Quellen lesen. Nur die verlinkten Orca-Dateien und direkten Imports/zugehörigen Tests nachladen; bei zusätzlichen Abhängigkeiten bewusst stoppen und Port gegen Eigenbau bewerten.
2. Upstream-Commit, Pfad und SHA-256 im Hashregister gegenprüfen. Den engsten reinen Kern auswählen; keine Electron-/React-/Zustand-/IPC-/Store-Kaskade nur für einen Helfer übernehmen.
3. Kopieren erst nach Prüfung von Datei-/Unterordner-Lizenz, fremden Artefakten und importierten Paketen. Orcas Root-Lizenz ist MIT mit `Copyright (c) 2026 Lovecast Inc.`. Bei übernommenen wesentlichen Teilen Copyright/Erlaubnistext erhalten und eine flache `docs/third-party-notices.md` beim ersten tatsächlichen Port anlegen; hier noch kein Fremdcode importiert. Logos/Marketingbilder/Systemimages nicht unter pauschaler Root-Lizenzannahme übernehmen. [Gepinnte Root-Lizenz](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/LICENSE).
4. AV-Pfad nach Fach bestimmen, Contracts/ADR vor geteiltem Verhalten. `.ts`-Imports, strip-taugliche Syntax, ISO-UTC, eigene Error-/Blob-/Worker-/Policy-Grenzen. Keine Hub-Interna in Adaptern, keine Parameter-Properties/Enums/Namespaces aus Orca mitschleppen.
5. Im Notice/Commit dokumentieren: Originalpfad/Commit/Hash, übernommener Ausschnitt, Anpassungen und abgedeckte Tests. Bestehende Testfälle nur als Start, AV-Negativfälle K5/K7/Ownership/Fail-loud ergänzen. Kein grüner Test aus Orca ist automatisch ein grüner AV-Test.
6. Änderung klein halten und nach den Repo-Gates verifizieren. Bei hohem Kopplungsgrad Verhalten/Invarianten als Referenz nutzen und den AV-Kern selbst schreiben. Ersparnis besteht in weniger Suche und bekannten Fehlerfällen, nicht garantiert weniger Implementierungsaufwand.

### 5.2 Fixierter Quellenindex (SHA-256)

Das folgende Register wurde aus dem analysierten Checkout erzeugt. Es belegt die Identität der gelesenen Referenzdateien, keine ausgeführten Orca-Tests. Eine Implementierung darf es um bewusst ausgewählte weitere Dateien ergänzen.

| Pfad im Orca-Checkout | SHA-256 |
|---|---|
| [LICENSE](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/LICENSE) | `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3` |
| [cloud/README.md](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/cloud/README.md) | `b71b7a100f6c90002d19578b563cd0f6c07ade0f1d24387affbc1bfe1cf6ae98` |
| [cloud/packages/relay-contract/package.json](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/cloud/packages/relay-contract/package.json) | `8aecb74b91bf1c5614ce4cac65de03cc12e980987422a69bf837535443ebb661` |
| [docs/site/content/docs/agents/native-chat.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/agents/native-chat.mdx) | `b6fe4864e22dae3eb36e8b5c3312e0225f392085a7a1509deb9bdfc14fd56390` |
| [docs/site/content/docs/browser/design-mode.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/browser/design-mode.mdx) | `4e6c8d177cd228a44840b823e7f6051348d6f09de3e9e5d5a1bd7577f55679f1` |
| [docs/site/content/docs/editing/file-explorer.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/editing/file-explorer.mdx) | `0b2ee9b882e3684fcf60d45401fad659e199be09d13c21cf42c44953758388a4` |
| [docs/site/content/docs/editing/monaco.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/editing/monaco.mdx) | `e026133b8eb1ebb9ef08516cb44bd349aa0d81a214e2e77a9396ca9ce394b220` |
| [docs/site/content/docs/editing/viewers.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/editing/viewers.mdx) | `e7a2cf2a408b576af371679904d9a6d73c883c50d783276982a42961e1a8119b` |
| [docs/site/content/docs/model/orca-yaml.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/model/orca-yaml.mdx) | `cbdd61b8422d24dd193524ea1c4f40e8453c44eff08231476e3d4aff81b9b985` |
| [docs/site/content/docs/model/quick-open.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/model/quick-open.mdx) | `1d837363803c5fdda58c43cc82dd4286ab8dc938471a36526c7231001496096f` |
| [docs/site/content/docs/model/worktrees.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/model/worktrees.mdx) | `e62d90317c541c1f429fba9c2d403600b1246986ea935e1cdd1c59ffa3280f42` |
| [docs/site/content/docs/remote-servers.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/remote-servers.mdx) | `58a87913f5fda710795580a17ffa0d2ddfb0ef67c55d32d52409117893b50e00` |
| [docs/site/content/docs/review/github.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/review/github.mdx) | `54f3b55275e15cfd2610e96d16969f7d13e936142ee2f17a17ca3caf033cd45d` |
| [src/main/automations/service.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/automations/service.ts) | `0a21dc6dbea5c7a1cba41edacca41f8b7ded508ca3812c8f0effc00020ebe4d6` |
| [src/main/browser/element-grab/browser-grab-payload.test.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/browser/element-grab/browser-grab-payload.test.ts) | `2922fd5813f1a2b639b80078ea7699cca9c78bf24e71aa95a6d8a20d5b08605c` |
| [src/main/browser/element-grab/browser-grab-payload.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/browser/element-grab/browser-grab-payload.ts) | `5939d3fe85b2ce9ce69578bc3e8894a97dbf35ed956d81a7ce6419b387bd8914` |
| [src/main/browser/element-grab/grab-guest-element-context-script.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/browser/element-grab/grab-guest-element-context-script.ts) | `8b91de9228b46204e6297f305fb2f1e9c0c6ab713c03f25a6670414b76bc11d9` |
| [src/main/emulator/android/adb-devices.test.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/emulator/android/adb-devices.test.ts) | `8ea34aad46fc71c0646b99a3e78f2548bff1f4136af5f7821fb054c898c97c97` |
| [src/main/emulator/android/adb-devices.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/emulator/android/adb-devices.ts) | `c18b228c96d31906d17d9a634b630dce1c7c056e6dc009e38fa3bda41de6cd2f` |
| [src/main/emulator/android/android-input-mapping.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/emulator/android/android-input-mapping.ts) | `20719cd867f67079306910c60023becf9a4bf62c3cbdfef5ffe54ef9f74e4207` |
| [src/main/emulator/android/scrcpy-stream-session.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/emulator/android/scrcpy-stream-session.ts) | `571c280a6f1fd6b66f644594d8750c7b10388b96708bcaaa5fc373f2190d8f68` |
| [src/main/emulator/backends/emulator-backend.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/emulator/backends/emulator-backend.ts) | `9d980ac038ad338d1fb01f465f3bc879b665751c009d7d2bab1746d8124cf1ab` |
| [src/main/gitlab/merge-request-review-mutations.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/gitlab/merge-request-review-mutations.ts) | `872e8f6202d014bae95fa7636749e078170914f7f5620d8ccab82431ca149307` |
| [src/main/native-chat/agent-session-journal/queued-messages/journal-unsent-send-hold.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/native-chat/agent-session-journal/queued-messages/journal-unsent-send-hold.ts) | `9ceb8ec597db6c554c585e6e489181300f39b20dada1696adb58e04b3d02804e` |
| [src/main/plugins/panels/plugin-frame-theme-snapshot.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/plugins/panels/plugin-frame-theme-snapshot.ts) | `7af98068fe9e0ece6d2b1bf4261087543889da0eed3357ad08c1ca1792c79bf4` |
| [src/main/plugins/plugin-manifest-file.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/plugins/plugin-manifest-file.ts) | `b4224ff621cb6e49049e734a6402b4e616f833c7414bc74a6451af8be18bcb4d` |
| [src/main/runtime/browser-host/reconciliation/browser-host-page-reconciliation-orchestration.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/runtime/browser-host/reconciliation/browser-host-page-reconciliation-orchestration.ts) | `29fd237e2b3b471af9f42138fa0cf93e89137ef5eb6f6f84f4399845f2f07612` |
| [src/main/runtime/orchestration/db/schema/create-core-tables-sql.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/runtime/orchestration/db/schema/create-core-tables-sql.ts) | `1a8669563395a5caf2cc117edb6d6f3d584f6702b3225210c9e7e23a6ad1ea82` |
| [src/main/runtime/orchestration/db/tasks/task-status-transition.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/runtime/orchestration/db/tasks/task-status-transition.ts) | `b2a15b8375b877f6361a806bed0175a1bdffb18d66f2ad85d17985a4bf073912` |
| [src/main/runtime/orchestration/db/tasks/task-store.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/runtime/orchestration/db/tasks/task-store.ts) | `522a206919bd2779f7d63cdfc4ed055e92c0c0b9d112093dfb151f5802e00048` |
| [src/main/runtime/rpc/orchestration-task-dispatch-invariant.test.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/runtime/rpc/orchestration-task-dispatch-invariant.test.ts) | `6f2f29e51f75ce545523acf7ff50b2761d4314406dc33531e9e0b4f34a0f6c1a` |
| [src/main/runtime/rpc/server/pairing/device-registry-save-race.test.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/runtime/rpc/server/pairing/device-registry-save-race.test.ts) | `20f168a1db1f9abf44a23138896424b9130aca61f65e91e60653d8d2ebec1260` |
| [src/main/source-control/hosted-review-creation-gitlab-self-hosted.test.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/source-control/hosted-review-creation-gitlab-self-hosted.test.ts) | `b02567c918c23a6f817b673b4e1043a7566acca25b1913a7db79c2b345e8320b` |
| [src/renderer/src/components/right-sidebar/file-explorer/panel/FileExplorer.tsx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/renderer/src/components/right-sidebar/file-explorer/panel/FileExplorer.tsx) | `f9be4405fb2d9ecfb3b46fe70d8e8501c485d97f6acb89a62421df0aacdca9ef` |
| [src/renderer/src/store/slices/diff-comments/diff-comment-persistence.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/renderer/src/store/slices/diff-comments/diff-comment-persistence.ts) | `908d21f9d814114fadf1f20314bbdc66225cb32b25fc84349dd56f3af211e208` |
| [src/shared/automation-schedule-dst.test.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/automation-schedule-dst.test.ts) | `db9419b49b305cb82630d57913abcc9e422ed8cec744f6ad301d86f0f5043568` |
| [src/shared/automation-schedule-occurrences.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/automation-schedule-occurrences.ts) | `c30f9aaa9a322e36d300a42f18151cf4793b46cce315a9a3bf259d3fb2897c0f` |
| [src/shared/automation-schedule-parsing.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/automation-schedule-parsing.ts) | `31600605e50d013e6840b843daa94320b315509c943d891174cad4cb437af774` |
| [src/shared/diff-comment-types.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/diff-comment-types.ts) | `9ed52e7b43f83f82638b9879a2ce26debd7b8e226703b4c00a9bf98d4ddd1b07` |
| [src/shared/editor-language/editor-language-detect.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/editor-language/editor-language-detect.ts) | `0d8590a61c7cd49042032eabbd9e93db54f98ba1ac01b044d1483c22f28e1770` |
| [src/shared/file-name-sort.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/file-name-sort.ts) | `a7b5afd462cc44f9563227d01849de73875b07043043091637fe70acbb49cac6` |
| [src/shared/filesystem-entry-types.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/filesystem-entry-types.ts) | `7cc930c3d1efa45e830a1fd9b04d064aab113d0ca578246882d4d4a45969952e` |
| [src/shared/plugins/artifacts/plugin-theme-artifact.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/plugins/artifacts/plugin-theme-artifact.ts) | `f4acd1da36752b964cc0fd2d9b4b95bb2f7e9322ee34d3a5604311a69493cbb9` |
| [src/shared/plugins/capabilities/plugin-capabilities.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/plugins/capabilities/plugin-capabilities.ts) | `866e8281bfcee3391591cd8ea3455580c555a76dee650a1ad668a8784e7cae53` |
| [src/shared/plugins/manifest/plugin-manifest-fields.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/plugins/manifest/plugin-manifest-fields.ts) | `4eaab11a766e35bb7a782d175f33dee64de98342f0bcd865a79f49059a30cf6e` |
| [src/shared/terminal-themes/terminal-contrast-correction.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/terminal-themes/terminal-contrast-correction.ts) | `fd216fc4a74988908f2dda968bdc35f6658e699bebadcda18bd32e552fc3adcb` |

## 6. Zurückgestellte oder bereits abgedeckte Orca-Ideen

| Idee | Entscheidung in diesem Auftrag |
|---|---|
| Vollständige Desktop-IDE/Dateimutationen | Nicht geplant; P46 ergänzt ausdrücklich Source-/Formatviewer und Diagnosen in der PWA, Monaco als Desktop-Kandidat mit mobilem Fallback |
| Native Mobile-App | Kein neuer Auftrag, PWA bleibt; P32 nur bei später belegtem Bedarf und Nutzer-Go |
| Mehr Providerlogos | P31/P35; Fähigkeiten je Harness nachweisen |
| Hersteller-Account/Cloudpflicht | Nicht entschieden; nur P45-Evaluation |
| Companion/TTS/Allgemeines Computer Use | Voidwarden separat, keine neue AV-Implementierung |
| Account-Rotation/Mehraccount-Credentialverwaltung | Kein belegter Bedarf, bestehende Quotas/Handover nutzen |
| Hibernation | Erst Idle-Ressourcen messen, keine pauschale Auto-Resume-Änderung |
| GitHub/Linear/Jira/Bitbucket/Azure-Parität | GitLab zuerst, weitere Provider nur nach echtem Bedarf |
| iOS-Simulator | Nicht auf Linux versprechen; gesonderter Mac-Bedarf nötig |
| Öffentliche Plugin-Registry/Marketplace | P30/P44 lokal/gepinnt; Distribution später separat |
| Mehr Themes/Layouts | P43/P44, vorhandene Akzent-/Fontwahl nicht erneut als neu zählen |

## 7. Review und Abschluss dieses Planungsauftrags

Auftrag ist erfüllt, wenn elf vollständige Epic-Entwürfe (sieben Abschnitte, konkrete Tasks/AC/Premortem/DoD), Index, P30/P32-Abgleich und belastbare Übernahmereferenzen vorliegen. Keine Implementierung, neue aktive Config oder voreilige Architektur-ADR. Browser, Dateibaum/Viewer/Diagnosen, Direct-Modus und Hermes erhalten explizite Ownership-/Recovery-/Befugnisgrenzen. Reale Abnahmen und offene Nutzerentscheidungen bleiben offen.

Vor Commit die repo-weit geforderten `npm test`, `npm run lint`, `npm run typecheck`; Dokumentationslinks/Schema/Quellpfade separat prüfen. Das bestätigt die Verträglichkeit der Planung mit dem heutigen Repo, nicht die Fertigstellung der geplanten Funktionen. Bei späterer Implementierung gilt pro Epic das volle Gate inkl. E2E, tatsächlicher Infrastruktur-/Provider-/Gerätenachweise und Skip ≠ Pass.
