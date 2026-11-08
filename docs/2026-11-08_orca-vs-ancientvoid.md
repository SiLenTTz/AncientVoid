# Orca und AncientVoid: Vergleich und Entscheidungsgrundlage

**Historischer Erstreport:** Die anschließenden Nutzerentscheidungen und neuen Epics stehen in der [Planungsgrundlage](2026-11-08_orca-epic-planung.md). Dieser Vergleich hält den Stand vor diesem Folgeauftrag fest.

Stand: 08.11.2026. Auftrag: Repository-Scan, detaillierter Vergleich und Bewertung möglicher Verbesserungen; noch keine neuen Epics und keine Implementierung.

**Empfehlung:** AncientVoid weiterentwickeln. Orca ist ein ernst zu nehmendes Vorbild für einen vollständigen Entwicklungsarbeitsplatz. AncientVoid besitzt bereits einen beträchtlichen Teil des technischen Fundaments und passt besonders gut zum gewünschten selbst kontrollierten, mobilen Hub. Der größte nächste Nutzen liegt darin, Ergebnisse besser prüfen und zurückspielen zu können: Diff-Kommentare, GitLab/MR/CI-Kontext und anschließend visuelles Feedback. Einen Orca-Nachbau mit eigener Electron-IDE, Browser-Engine und nativer App würde ich daraus nicht ableiten.

## 1. Untersuchung und Aussagegrenzen

Orca wurde als vollständiger flacher Checkout gelesen, nicht nur anhand der README. Referenz: [`bdeb388d75120b6e36dd619291286de0cc9aae02`](https://github.com/stablyai/orca/tree/bdeb388d75120b6e36dd619291286de0cc9aae02), letzter Commit im Checkout 07.11.2026, 23:00 UTC, Paketversion 1.4.214. AncientVoid: lokaler Stand `0134f5b5a83550a836047122a49b9cc9274aebe3`, unveränderter sauberer Arbeitsbaum beim Scan.

Geprüft wurden Architektur, Paketabhängigkeiten, Produktdokumentation, repräsentative Implementierungspfade und Tests für Review, GitLab, Browser-Kontext, Orchestrierung, Automationen, Persistenz, Chat-Zustellung, Plugins und Mobile. Bei AncientVoid zusätzlich PRD, Epic-Index, aktuelle P29/P34/P35-Nachweise, P30–P33-Planung, Contracts, Workspace-/Session-/Code-/Diff-Implementierung und Testinventar. Ein Repo-Poster des Diff-Reviews wurde visuell angesehen. Das ist keine interaktive Produktabnahme.

Evidenzklassen:

- **Code:** Verhalten ist in gelesener Implementierung nachvollziehbar.
- **Dokumentiert:** Projekt beschreibt es; für diesen Report kein eigener Live-Lauf.
- **Historisch belegt:** AncientVoid dokumentiert einen datierten Gate-/Mess-/Live-Lauf; hier nicht wiederholt.
- **Plan:** vorhandener Epic, keine fertige Funktion.
- **Bewertung:** Schlussfolgerung für den eigenen Bedarf, keine gemessene Produkteigenschaft.

Keine Orca-Abhängigkeiten installiert, keine fremden Setup-Skripte ausgeführt, keine laufende AncientVoid-Instanz verändert. Keine Test-Suite neu ausgeführt; deshalb kein aktueller Grün-Claim und kein Performance-, Sicherheits- oder Stabilitätsranking aus bloßer Codelektüre. Beim ursprünglichen Vergleich wurden keine Branches, Commits, MRs oder Epics angelegt. Der Report wurde anschließend für die ausdrücklich beauftragte Epic-Planung nach docs/ übernommen; neuer Auftrag und Änderungen stehen in der Planungsgrundlage.

## 2. Was Orca tatsächlich ist

Orca ist inzwischen eine umfangreiche Entwicklungsumgebung für parallele Agenten. Die Desktop-Oberfläche verbindet Agenten, Terminals, Editor, Browser, Dateiansichten, Reviews und Aufgaben. Dazu kommen eine Node-Server-Laufzeit, SSH-/Remote-Varianten, Mobile und optionale Cloud-Dienste. Es ist deshalb sachlich falsch, Orca auf einen Terminal-Wrapper zu reduzieren. Ebenso falsch wäre die Annahme, alle beworbenen Agenten hätten dieselbe strukturierte Integration.

Der Stack kombiniert TypeScript, Electron, React/Zustand, Monaco, Terminal-Komponenten und native Erweiterungen. `node-pty` und `@parcel/watcher` gehören zu den Laufzeitabhängigkeiten; Mobile verwendet Expo/React Native. Wichtig: Auch Orca verwendet im geprüften SQLite-Wrapper **`node:sqlite`**. Das ist kein exklusives AncientVoid-Merkmal. Orcas Build- und Auslieferungskette ist allerdings wesentlich umfangreicher als AncientVoids Server ohne Build-Schritt. [Paketdefinition](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/package.json), [SQLite-Wrapper](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/sqlite/sync-database.ts), [Mobile-Paket](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/mobile/package.json).

Die breite CLI-Unterstützung läuft über Terminals; strukturierter Chat ist eine zusätzliche, agenten- und hostabhängige Integration. Laut Dokumentation gibt es strukturierten Chat für Claude, Codex, Grok, OpenCode, Pi, OMP und Antigravity. WSL/SSH verwenden weiterhin terminalbasierten Chat. Chat↔CLI-Wechsel ist für unterstützte Sessions angeboten; daraus folgt keine universelle Live-Übernahme jedes laufenden Prozesses. Die Quellcode-Funktion für den Oberflächenwechsel prüft explizit getrennte Chat- und CLI-Ziele. [Chat-Dokumentation](https://www.onorca.dev/docs/agents/native-chat), [Eligibility-Code](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/renderer/src/components/right-sidebar/ai-vault/session-actions/ai-vault-session-surface-switch.ts).

## 3. AncientVoid heute: deutlich mehr als Monitoring

Die eigene README enthält noch einen alten September-Status, der P5–P12 pauschal als nicht umgesetzt beschreibt. Der aktuelle Code und Epic-Index sind weiter. Auch die erste Paseo-Vergleichsanalyse enthält überholte oder bereits korrigierte Aussagen, etwa fehlende Diffs, Quellcodesuche, Worktrees und eine kaputte CI. Solche Aussagen sind für die heutige Entscheidung unbrauchbar.

Nachvollziehbar vorhanden:

- EventStore mit JSONL/Snapshots, Eventsequenzen und Blob-Auslagerung; Verträge und Adapter-Testkit.
- Native Adapter und ACP, unterschiedliche belegte Fähigkeiten, Tool-Freigaben und Rückfragen je nach Harness.
- Discovery, Session-Identität, Fortsetzen und unterbrochene Sessions.
- Fleet/Home-Hub, Device-Tokens, Actor-Policy, Passkeys und Approval-Operationen.
- Worktree-Isolation, Apply-/Hygiene-Pfade, Diff-Ansicht mit Hunks und Größenbegrenzung.
- Lokale Text-/Symbolsuche und Codeansicht; registrierte Aktionen für Tests/Git/Tools.
- Workspace-Manifest mit Setup/Teardown, Include-Dateien, Services, Ports, Readiness, Recovery und Preview.
- Kacheln, separate Browserfenster, Einstellungen, lokale Sprache, Anhänge, Entwürfe und Prompt-Queue.
- Loop-Connectoren und Factory-Anbindung.

**Code vorhanden bedeutet weiterhin nicht vollständig abgenommen.** P34 und P35 haben offene gemeinsame Nutzer-Abnahmen; P12/P16 enthalten reale Geräte-/Provider-Restpunkte. P30 Plugins, P31 Katalog, P32 Mobile-Entscheidung und P33 englischer Einstieg sind Planung. P29 und P28 tragen jüngere Abschlussnachweise. Im P35-Dokument sind 1.350 Unit-Tests und 368 E2E-Pässe für den damaligen Abschlusslauf dokumentiert; das ist historische Evidenz, kein in diesem Report neu ermitteltes Resultat.

Lokale Quellen: `epics/README.md`, `epics/EPIC-P29-worktree-workspace-runtime.md`, `epics/EPIC-P34-arbeitsflaeche-und-fenster.md`, `epics/EPIC-P35-harness-paritaet-fortsetzen-provider.md`, `docs/harness-matrix.md`, `packages/contracts/src/workspace/manifest.ts`, `apps/pwa/src/features/code/CodePane.tsx`, `apps/pwa/src/features/session/DiffPane.tsx`.

## 4. Direkter Funktionsvergleich

| Bereich | Orca am geprüften Stand | AncientVoid am geprüften Stand | Bedeutung für die Entscheidung |
|---|---|---|---|
| Produktfokus | Umfassender Agenten-Arbeitsplatz | Eigener Hub für mobiles Steuern, Überblick und Audit | Unterschiedlicher Umfang, erhebliche Überschneidung |
| Agenten | Breiter Terminal-Katalog, strukturierter Chat für Teilmenge | Native/ACP-Adapter, Capability-Matrix, Live-Belege je Fähigkeit | Anzahl der Logos ist kein Paritätsmaß |
| Subscription-Nutzung | Eigene CLI-Anmeldungen/Abos, Account-Funktionen | Vorhandene CLI-Anmeldungen; Quotas wo verfügbar | Kein grundsätzlicher Wechselgrund |
| Worktrees | Erstklassiges Produktkonzept, Projektdefaults, Copy/Share, verschachtelte Workspaces | Worktree pro Session; P29 mit Manifest/Setup/Services/Ports | Zentrale technische Basis bereits vorhanden |
| Workspace-Modell | Mehrere Agenten/Oberflächen in einem Workspace | Session als Hauptobjekt, typischerweise eigener Worktree | Gemeinschaftlich beschreibbarer Workspace wäre echte Architekturänderung |
| Codeprüfung | Editor, umfangreiche Diffs, Inline-Notizen an Agenten | Codeansicht/Suche, Datei-/Hunk-Diffs | Orcas Feedbackschleife ist klar weiter |
| GitLab/GitHub | Issues, Hosted Reviews, Review-Kommentare, Checks | Git-Aktionen/Apply und externe Factory-Gates, keine vergleichbare native Forge-Fläche im gelesenen Bestand | Sehr relevante neue Lücke |
| Browser | Eigener Browser, Profile, DOM-/Style-Kontext, Mobile-Ansicht | P29-Service-Preview | Preview ist wertvolle Basis, kein Browser-Äquivalent |
| Mobile | Expo-App für iOS/Android, Beta, Terminal/Chat/Source Control | Preact-PWA; Geräteabnahmen teilweise offen | Orca hat mehr native Integration; eigener Bedarf entscheidet P32 |
| Multi-Host | Remote Server, SSH und weitere Laufzeitvarianten | Fleet/Home-Hub | Grundbedarf bereits abgedeckt; nicht nochmals als neues Feature planen |
| Wiederanlauf | Session-Restore, Chat-Journal, Zustell-/Queue-Recovery, langlebige Laufzeit | JSONL/Snapshot, Worker-Marker, interrupted, native Resume je Fähigkeit | Beide investieren ernsthaft; keine pauschale Stabilitätswertung |
| Orchestrierung | Runs, Tasks, Dispatches, Mailbox, Gates; experimentell | Externe Loop-Systeme über Connectoren, Factory-Treiber/Beobachter | Andere Zuständigkeit; kein kleiner UI-Import |
| Zeitpläne | Eingebauter Scheduler mit Verlauf und Prechecks | Kein gleichwertiger allgemeiner Hub-Scheduler im gescannten Bestand | Später sinnvoll, wenn keine externe Factory zuständig ist |
| Erweiterbarkeit | Ausgebautes Plugin-System für UI/Editor/Themes usw. | Dynamische Adapter/Sinks; Distribution/Lifecycle in P30 geplant | Bestehendes P30 stärken statt duplizieren |
| Bedienfluss | Eng verbundene Ansichten und Kontextübergaben | Viele Bausteine vorhanden, weniger durchgängige Übergaben | Wahrscheinlich größter subjektiver Qualitätshebel |
| Governance | Eigene Trust-, Auth-, Permission- und E2EE-Mechanismen | Explizite Actor-/Approval-/Contract-Regeln und Messlatten | AV passt gut zu eigener Kontrollpräferenz; Sicherheitsranking wäre unbelegt |
| Distribution | Desktop-Builds, Mobile-Auslieferung, Update-Infrastruktur | Eigener Node-/PWA-Betrieb und Runbooks | Orcas großer Produktvorsprung kostet auch Wartung |

## 5. Die wertvollsten Orca-Ideen im Detail

### 5.1 Diff-Kommentare als präziser Auftrag

Orcas Review ist mehr als eine schöne Diff-Ansicht: Kommentare hängen an Datei und Zeile beziehungsweise Bereich, werden gespeichert und lassen sich gesammelt an einen ausgewählten Agenten übergeben. Der Kommentarvertrag kennt unter anderem Scope, Pfad, ausgewählten Text, Diff-Identität und Sendezeit. Der Persistenzcode serialisiert Schreibvorgänge, damit ältere UI-Stände keine neueren Kommentare überschreiben. [Kommentarvertrag](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/diff-comment-types.ts), [Persistenz](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/renderer/src/store/slices/diff-comments/diff-comment-persistence.ts).

AncientVoids `DiffPane.tsx` bietet Datei-/Hunk-Navigation, Unified/Split und Nachladen. Im gelesenen Pfad fehlt die entsprechende Kommentieren→Sammeln→an Agenten schicken-Schleife. Das ist eine echte Erweiterung vorhandener Infrastruktur.

Eigene Variante: Kommentare an Session, Basis-/Diff-Identität, Datei und Bereich binden; nach verändertem Diff einen veralteten Bezug sichtbar machen; ausgewählte Kommentare als einen belegbaren Folgeauftrag senden. Kein Versprechen perfekter Zeilenverfolgung im ersten Schritt. Große Kontexte als Blob (K5), Notizen aus Journal/Snapshot wiederherstellbar (K7), mobiles Diff-Fenster weiter begrenzt (K3), Feedback mit vorhandener Prompt-/Approval-Policy versenden.

Bewertung: hoher Alltagsnutzen bei mittlerem Umfang. Das wäre mein erster neuer Funktionskandidat.

### 5.2 GitLab, MR und CI mit der Session verbinden

Orca unterstützt tatsächlich GitLab; es ist nicht auf das prominent beworbene GitHub beschränkt. Es gibt Implementierung für MR-Notizen und Inline-Diskussionen über `glab`, Hosted-Review-Erstellung und Tests für selbst gehostetes GitLab. Die Produktdokumentation beschreibt auch Job-Traces und Child-/Bridge-Pipelines. GitHubs „Fix broken checks“ sollte trotzdem nicht unbesehen als identischer GitLab-Funktionsumfang gezählt werden. [GitLab-Mutationen](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/gitlab/merge-request-review-mutations.ts), [Self-hosted-Test](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/source-control/hosted-review-creation-gitlab-self-hosted.test.ts), [Forge-Dokumentation](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/review/github.mdx).

Für AncientVoid passt eine GitLab-zuerst-Variante unmittelbar zum eigenen Prozess: Session/Branch mit MR und Issue verknüpfen; Status, Diskussionen und fehlgeschlagene Jobs anzeigen; ausgewählte Rückmeldungen mit SHA/Job-ID an den Agenten geben; später MR-Entwurf aus dem Sessionkontext erstellen.

P28 baut die ausführende CI-Infrastruktur, nicht diese Produktfunktion. Factory-Gates zeigen externe Laufzustände, ersetzen ebenfalls keine allgemein nutzbare MR-/Review-Verbindung. Der Merge bleibt eine echte GitLab-MR-Operation; lokales `git merge` wäre kein Ersatz für den Repo-Workflow. Externe Logs/Kommentare bleiben Daten und dürfen nicht selbst Befugnisse erzeugen. K5/K7 gelten für importierten Kontext und Verknüpfungen; K1 darf durch Forge-Abfragen nicht langsamer werden.

Bewertung: hoher Nutzen, mittlerer bis hoher Umfang. Sinnvoll nach oder zusammen mit dem Kontextmodell für Review-Feedback, aber als eigener fachlicher Bereich.

### 5.3 Visuelles Feedback aus der laufenden Anwendung

Design Mode erfasst das ausgewählte Seitenelement mit DOM-/Style-Kontext und Screenshot; der Code für Elementkontext enthält Selector-Erzeugung, Budgets und Secret-Prüfungen. Das reduziert unpräzise Anweisungen wie „der Knopf links sieht falsch aus“. [Design Mode](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/browser/design-mode.mdx), [Elementkontext-Script](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/browser/element-grab/grab-guest-element-context-script.ts).

AncientVoids P29-Preview ist absichtlich beschränkt: registrierter Service, Ticket, sandboxed iframe, GET/HEAD, keine WS-Upgrades. Das ist keine fertige technische Grundlage für beliebige DOM-Inspektion oder browsergesteuerte Tests. Insbesondere erlauben Cross-Origin-/Sandbox-Grenzen dem Elternfenster nicht einfach, jede Seite auszulesen.

Eigene erste Stufe: Screenshot oder markierter Ausschnitt, aktuelle Service-/Seitenreferenz und menschliche Notiz als Anhang an eine Session. DOM-/Style-Auswahl erst nach Architektur-Spike, etwa über bewusst eingebundene Instrumentierung oder einen kontrollierten Browserdienst. Kein Aufweichen des Preview-Proxys aus Bequemlichkeit. K5 für Bild-/DOM-Blobs, K7 für Artefaktbezug, K10 für ehrlichen Offline-Zustand; ein eigener messbarer UX-Nutzen muss im späteren Epic hinzukommen.

Bewertung: hoher Nutzen bei UI-Arbeit, zunächst mittlerer Umfang; ein vollständiger Browser hätte sehr hohen Umfang.

### 5.4 Zustellung sichtbar und nachvollziehbar machen

Eine besonders wertvolle Orca-Idee ist die explizite Unterscheidung zwischen aufgenommenen, übergebenen, unsicheren und ungesendeten Nachrichten. Der Journalcode hält nach Neustarts nicht belegbar versendete persönliche Eingaben als Karten zurück. Das ist mehr als eine persistente FIFO. [Unsent-Hold](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/native-chat/agent-session-journal/queued-messages/journal-unsent-send-hold.ts).

AncientVoid besitzt bereits eine persistente Prompt-Queue und interrupted/resume. `SessionQueue.take()` entfernt jedoch den Eintrag vor der nachfolgenden Zustellung; das allein belegt keine Ende-zu-Ende-Zustellung. Das ist hier **kein bestätigter Bugreport**: dafür müssten Manager, Adapter-Acks und Crashfenster gezielt reproduziert werden. Es ist eine konkrete Audit-Frage.

Eigene Variante bei nachgewiesener Lücke: beständige Auftrags-ID, Status bis zur Adapter-/Provider-Übergabe, Unsicherheit sichtbar statt blindem Retry. Keine unbelegbare Exactly-once-Garantie gegenüber externen CLIs. K7/K9, zusätzlich Prüfung auf Doppelprompts und verlorene Queue-Einträge.

Bewertung: kleinerer, technisch wichtiger Audit-Kandidat. Bei reproduzierbarem Fehler wäre das Bugfix-Arbeit, nicht automatisch ein neues Epic.

### 5.5 Aufgabenstatus statt nur Prozessstatus

Eine Session kann technisch „working“ sein und fachlich gerade „Tests laufen“ oder „Review wartet“ bedeuten. Orca hat dafür Workspace-Kommentare und Statuswerte. Wichtig: Die Dokumentationsseite **Worktree checkpoints** beschreibt genau solche textuellen Fortschrittsnotizen; sie belegt keine Git-Snapshots oder Dateirückrollfunktion. [Checkpoint-Dokumentation](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/cli/worktree-checkpoints.mdx).

AncientVoid hat Lauf-/Turn-Metriken und Berichte. Ein aktuelles Ziel mit nächstem Schritt und Blocker könnte diese ergänzen. Arbeitsnotizen aus Agenten bleiben untrusted Statusdaten; „fertig“ darf keine Test-/Merge-Freigabe auslösen. K2/K5/K7/K10. Zuerst prüfen, ob eine kleine Erweiterung der bestehenden Übersicht genügt.

Bewertung: guter kleiner Zusatz, kein zwingendes Groß-Epic.

## 6. Sinnvolle Ideen mit höherem Preis

**Zeitpläne:** Orca hat Presets, Cron/RRULE, Zeitzonen, Prechecks, Verlauf und Regeln für verpasste Läufe. Die Implementierung behandelt Start, Abschlussbeobachtung, Wiederanlauf und Host-Zuständigkeit. Eine bloße Cron-UI würde das unterschätzen. [Scheduler](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/automations/service.ts), [Dokumentation](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/cli/automations.mdx). In AncientVoid zuerst klären, ob externe Loops/Factory das Scheduling bereits besitzen sollen. Eine doppelte Autorität erzeugt doppelte Starts. Ein späterer Hub-Scheduler müsste Operationen, Host-Besitz, Parallelität, verpasste Termine, K7 und Quotas modellieren. Mittlerer bis hoher Umfang.

**Natives Task-/Dispatch-Modell:** Orca persistiert Runs, Nachrichten, Deliveries, Mutation-Receipts und Worker-Dispatches; Tasks validieren Run-Zugehörigkeit und Abhängigkeiten. Das ist echte Implementierung mit Invariantentests, keine reine Prompt-Schablone. Gleichzeitig ist Orchestrierung ausdrücklich experimentell, der Panel-/Switch-Zugang laut aktueller Doku vorübergehend nicht verfügbar. [DB-Schema](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/runtime/orchestration/db/schema/create-core-tables-sql.ts), [Task-Store](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/runtime/orchestration/db/tasks/task-store.ts), [Invariantentest](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/runtime/rpc/orchestration-task-dispatch-invariant.test.ts), [Produktstatus](https://www.onorca.dev/docs/cli/orchestration).

AncientVoid delegiert autonome Arbeit über `LoopConnector` an externe Systeme; `agents: hub` ist im Vertrag reserviert. Ein eigener Scheduler/DAG-Executor würde die Systemverantwortung verändern. Erst entscheiden: bessere Darstellung fremder Task-/Dispatch-Zustände oder eigene ausführende Orchestrierung? Ich würde zunächst vorhandene Factory-Arbeit besser sichtbar machen. Ein zweiter Orchestrator wäre sehr großer Umfang und braucht ausdrückliche Produktentscheidung, neue Contracts/ADR, K5/K7/K8 sowie einen definierten Recovery- und Befugnispfad.

**Agenten schlafen lassen:** Orca dokumentiert experimentelle Hibernation, standardmäßig aus. Nur abgeschlossene, unsichtbare, resumierbare und nicht von Mobile oder unsettled Dispatches belegte Terminals kommen infrage. Das kann bei vielen PTYs Speicher sparen. AncientVoids Adapter haben aber unterschiedliche Prozesslebenszyklen; nicht jeder hält einen gleich teuren Idle-Prozess. Daher erst RSS-/Prozessmessung, dann gegebenenfalls gezielte Lösung. Kein pauschales Auto-Resume ableiten. [Hibernation](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/agents/hibernation.mdx).

**Account-Wechsel:** Orcas Bedienung von Accounts/Rate-Limits ist interessant. AncientVoid hat bereits Account-Quota-Signale, Modellwahl und Handover. Zusätzliche Credential-Verwaltung lohnt nur bei eigenem belegtem Bedarf; sie sollte nicht bloß eine zweite Login-Welt schaffen. Zunächst bessere vorhandene Kontingentanzeigen und saubere Übergaben priorisieren.

**Computer Use, Emulator, vollständiger Editor:** Orca hat dafür umfangreiche Produktflächen. AncientVoid hat einen Desktop-Companion für definierte Aktionen, aber keine gleichwertige allgemeine Computer-Use-Plattform. Ein Ausbau wäre erheblich. Für den aktuellen Schwerpunkt ist das eine Ablenkung gegenüber Review, MR/CI und zuverlässigem Mobilbetrieb.

## 7. Architektur, Sicherheit und Wartbarkeit fair bewerten

AncientVoids klare Kette Adapter→Context→EventStore→Transport→PWA ist ein gutes Fundament. Contracts, Größenbudgets, Recovery-Ziele und Actor-Policy machen neue Funktionen prüfbar. Das spricht für die Weiterentwicklung der bestehenden Lösung. Es beweist weder geringere Fehlerrate noch höhere Sicherheit gegenüber Orca.

Orca besitzt ebenfalls geteilte RPC-/Wire-Verträge, ein separates Relay-Contract-Paket, Authentifizierungs- und Geräteverwaltung, E2EE-Pfade und umfangreiche Lifecycle-Tests. „Orca hat keine Governance“ wäre daher unhaltbar. Umgekehrt ist ein SDK, Plugin oder offenes Protokoll allein kein Beweis besserer Architektur. Relevant ist, welche Garantien der konkrete Pfad tatsächlich hält.

Orca kann auch ohne Hersteller-Relay über private Netzwerkpfade betrieben werden; „zwingend Cloud“ wäre falsch. Relay- und Push-Runtime sind öffentlich, Produktions-Terraform und Betriebswerkzeuge laut Cloud-README im privaten `orca-cloud`-Repo. Vollständig eigene Relay-/Push-Infrastruktur wäre deshalb zusätzliche Arbeit. Native Benachrichtigung transportiert zudem über APNs/FCM. Die Cloud-README erklärt den Relay-Pfad; ihre Formulierung zu nichtdirekten Verbindungen darf nicht auf die separat dokumentierten LAN-/Tailscale-Modi übertragen werden. [Cloud-README](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/cloud/README.md), [Remote-Server](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/remote-servers.mdx).

Orca integriert PostHog. Die aktuelle Consent-Implementierung wartet bei fehlender Entscheidung auf `pending_banner`, erlaubt Senden bei Opt-in und respektiert `DO_NOT_TRACK`/`ORCA_TELEMETRY_DISABLED`. Deshalb weder „Zero Telemetry“ noch pauschal „sendet automatisch alles“ behaupten. Die veröffentlichte Telemetrie-Seite enthält außerdem ältere Aussagen zum fehlenden Account-System, während die Mobile-Seite Relay-Anmeldung beschreibt: Code, Betriebsart und Dokumentationsdatum müssen zusammen gelesen werden. [Consent-Code](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/telemetry/consent.ts), [Telemetrie-Dokumentation](https://www.onorca.dev/docs/telemetry).

Größenmessung anhand getrackter JS-/TS-Dateien, jeweils `src/mobile/cloud/native/tests` bei Orca und `apps/packages/e2e` bei AncientVoid: rund **2,95 Mio. Zeilen in Nicht-Testdateien plus 1,90 Mio. in 10.950 Testdateien** gegenüber **48.056 plus 30.058 Zeilen in 244 Testdateien**. Testklassifikation nach Dateisuffix `*.test`/`*.spec`; Nicht-Test-Kategorie enthält auch Hilfen, Fixtures und generierte Teile. Die Zahlen sind weder Produktionscode-Metrik noch Qualitätsnote. Sie illustrieren vor allem: vollständige Orca-Parität wäre eine ganz andere Wartungsklasse als gezielte Verbesserungen des eigenen Hubs.

Orcas viele Plattform-/E2E-/Performance-/Release-Workflows belegen Infrastruktur, nicht deren heutigen grünen Status. AncientVoids selbstverwalteter Runner ist durch P28/ADR-0049 dokumentiert. Ohne aktuelle Runs beider Projekte ist kein CI-Zuverlässigkeitsranking gerechtfertigt.

## 8. Bestehende Epics nutzen, Doppelplanung verhindern

| Orca-Impuls | Zuständigkeit bei AncientVoid | Konsequenz |
|---|---|---|
| Workspace-Defaults, Setup, Include, Services | P29 / ADR-0051 vorhanden | Keine zweite Workspace-Runtime planen |
| Kacheln, mehrere Fenster, Darstellung | P18/P34/P35 implementiert, Abnahmen offen | Bestehende Abnahmen schließen |
| Resume, Discovery, Custom-Provider | P17/P22/P24/P27/P35 | Konkrete Capability-Lücken adressieren, kein pauschales neues Resume-Epic |
| Plugin-Installation und Lifecycle | P30 geplant | Mit ausgewählten Orca-Erfahrungen schärfen |
| Mehr Agenten und Modelle | P31; Fundament aus P35 | Capability-Nachweise statt Logo-Zählen |
| Native Mobile-Vorteile | P32, P12/P16 | Gerätebedarf messen; keine React-Native-Neuschreibung vorwegnehmen |
| Onboarding und englische Dokumentation | P33 und bestehende Runbooks | Bestehende Planung nutzen; README-Statuskorrektur separat möglich |
| Diff-Feedback, Forge-Kontext, visuelle Rückmeldung | Noch keine gleichwertige vollständige Strecke im gescannten Bestand | Kandidaten für spätere neue Epics |

Die gültige Kette lautet laut Index **P27→P28→P29→P34→P35→P30→P31→P32→P33**. Neue Nummern oder eine neue Reihenfolge wären eine spätere Entscheidung. Dieser Report hebt keine offenen Exit-Kriterien auf und erfindet keine Ausnahme für parallel beginnende Features.

## 9. Kandidatenliste für die spätere Entscheidung

Die folgenden Namen sind Gesprächskandidaten, keine angelegten Epics und keine genehmigte Roadmap. Umfang ist relativ, keine Terminzusage.

| Rang | Kandidat | Nutzen / Umfang | Messlatten und erste Abnahmeidee |
|---|---|---|---|
| Zuerst | Offene P34/P35- und Geräte-Abnahmen | Sehr hoch / bestehende Arbeit | Bestehende AC mit Jan/Pixel schließen; Restpunkte behalten ihre IDs |
| A | Diff-Kommentare und gesammeltes Agenten-Feedback | Hoch / mittel | K3/K5/K7; Kommentar→Restart→gezielter Folgeauftrag→erneute Prüfung, veraltete Anker sichtbar |
| A | GitLab-MR-/CI-/Review-Kontext pro Session | Hoch / mittel–hoch | K1/K5/K7; verknüpfter MR, Fehlerjob mit SHA/Quelle, bestätigte Übergabe; pending nie grün |
| A, zunächst Audit | Nachvollziehbare Prompt-Zustellung | Hoch bei Lücke / erst klein | K7/K9; Disconnect/Crash um Übergabe nachstellen, kein verlorener oder blind doppelt gesendeter Prompt |
| B | Visuelles Feedback aus Workspace-Preview | Hoch für UI / mittel, mit DOM hoch | K5/K7/K10; Ausschnitt+Seitenbezug an Agenten, gültige Auth-/Sandbox-Grenze bleibt erhalten |
| B | Aufgabenstatus, Ziel und Blocker in Übersicht | Mittel / klein–mittel | K2/K5/K7/K10; nach Reload gleiche Notiz, klar vom Prozess-/Gate-Status getrennt |
| C | Zeitpläne mit Laufhistorie | Mittel / mittel–hoch | K7/K8; ein verantwortlicher Scheduler, Restart und verpasste Termine, keine Doppelstarts |
| C, nur bewusste Neuausrichtung | Hub-eigene Task-/Dispatch-Orchestrierung | Potenziell hoch / sehr hoch | K5/K7/K8; stale Dispatch kann neuen Versuch nicht abschließen; klare Abgrenzung zu Loops |
| Bedarf zuerst | Hibernation, Account-Verwaltung, Native Shell | Situativ / unterschiedlich | Ressourcen-/Geräte-/Account-Befund vor zusätzlichem System |

## 10. Weiterbauen, wechseln oder hybrid?

**AncientVoid weiterbauen:** passt zur Präferenz für die eigene Lösung und erhält die bereits investierten Contracts, Recovery, Fleet, Loops und den Betrieb. Der nächste Aufwand sollte sich auf wenige durchgängige Journeys konzentrieren. Risiko ist die Wartung vieler Provider und ein wachsender Abnahme-Rückstand. Erfolg misst sich daran, wie zuverlässig Jan tägliche Arbeit erledigt, nicht an der Zahl neuer Epics.

**Auf Orca wechseln:** attraktiv, wenn vollständiger Desktop-Arbeitsplatz, Editor/Terminal/Browser und viele Integrationen kurzfristig wichtiger werden als die eigene Produktgestaltung. Open Source und private Netzwerkmodi erlauben erheblich mehr Eigenkontrolle als bei einer geschlossenen SaaS-Lösung. Trotzdem wären lokale Daten, laufende Sessions, Loop-Anbindung, Workflow-Regeln und Bedienung zu migrieren beziehungsweise zu validieren. Die vorhandenen Audit-/Recovery-Garantien wären nicht automatisch übertragen. Kein Grund, AncientVoid ohne realen Vergleichslauf aufzugeben.

**Beide dauerhaft betreiben:** höchstens mit klarer Rollenverteilung. Zwei aktive Prozess- oder Workspace-Eigentümer für denselben Arbeitsbestand erzeugen Unklarheit über Status, Cleanup und Steuerung. Sinnvoller erscheint Orca zunächst als separates Referenzprodukt auf einem isolierten Testprojekt; im vorliegenden Auftrag wurde es nicht installiert.

Eine spätere praktische Entscheidung könnte dieselben drei Aufgaben in beiden Produkten prüfen: (1) vom Handy einen blockierten Agenten weiterführen, (2) drei Diff-Befunde präzise zur Revision senden, (3) einen fehlgeschlagenen GitLab-Job bis zum korrigierten MR verfolgen. Dazu Restart/Reconnect und die Frage: Wie viel Handarbeit und Kontextkopieren bleiben? Erst das liefert einen belastbaren UX-/Zeitvergleich; der Code-Scan liefert die begründeten Hypothesen dafür.

**Mein Votum:** AncientVoid behalten. Orcas stärkste Anregung ist die Verbindung der Arbeitsschritte. Für uns wären Diff-Feedback und GitLab-Kontext die ersten neuen Funktionskandidaten; visuelles Feedback folgt danach. Plugins, Provider-Katalog und Mobile bleiben in ihrer vorhandenen Planung. Eigene ausführende Multi-Agent-Orchestrierung, Electron-IDE oder Cloud-Relay sollten nur aus einer später ausdrücklich gewünschten Produktausrichtung entstehen.
