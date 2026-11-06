# AncientVoid — Epic-Paket (P0–P4.5 und Planungsentwürfe bis P33)

**Erstellt:** 12.09.2026 · **Basis:** PRD AncientVoid v1.0 (2026-09-12-PRD-Unified-AI-Agent-Command-Center.md)
**Workflow:** Vault-Standard — jedes Epic enthält Premortem, Messlatten-Bezug (K1–K10), Definition of Done.

**Bestandsaufnahme 2026-09-21:** [Audit mit Code-Evidenz, UI-Sichtung und
Laya-Bewertung](../docs/remote-control-audit-2026-09-21.md). „Implementiert“
ist nicht gleich „Exit-Kriterien grün“: P0/P1/P1.5/P1.6 haben offene reale
Abnahmen; P2/P3 dokumentierte Teillücken; P4 externe und Release-Restarbeit.
Der Offline-Reload-Fehler [BUG-0015](../bugs/bug-0015-offline-reload-token-gate.md)
blockiert K10. Historische grüne Überschriften sind keine Vollumfang-Freigabe.

## Enthaltene Epics

| Datei | Phase | Titel | Dauer (Agenten-Wochen) |
|---|---|---|---|
| EPIC-P0-hub-kern.md | P0 | Hub-Kern: Sessions, EventStore, tmux-Worker, Tailscale-serve, PWA-Gerüst | 1 |
| EPIC-P1-claude-codex-monitor.md | P1 | Adapter claude + codex, Monitor-Dashboard, Chat-Tail mit Filtern | 1–1,5 |
| EPIC-P1.5-control-center-ux.md | P1.5 | Kontingent statt Budget, Projekt-Autoerkennung, Sprach-Composer, Skill-Overlay | 1–1,5 |
| EPIC-P1.6-futuristic-ui-system.md | P1.6 | Futuristisches UI-System: Bottom-Dock, Bericht-Ansicht, Design-System-Referenz | 1 |
| EPIC-P2-diff-approvals-budgets.md | P2 | Diff-Ansicht, Approval-Gates, Budgets, Messlatten im CI | 1 |
| EPIC-P3-adapter-flotte-sprachsuche.md | P3 | swarm/zai/local-llm-Adapter, cursor-clip, Sprachsuche + Prompt-Composer | 1,5 |
| EPIC-P4-brain-windows-mcp-oss.md | P4 | Brain-Digest-Skill, evox2/Windows, MCP-Gateway, OSS-Aufbereitung | 1–2 |
| [EPIC-P4.5-testing-observability.md](EPIC-P4.5-testing-observability.md) | P4.5 | Testpyramide, write-tests-Skill, strukturiertes Logging, Health/Ready/Metrics | 0,5–1 |

## Vollständige Fernsteuerung — Planungsentwürfe vom 2026-09-21

Alle folgenden Epics sind **offen / Umsetzung blockiert**. Der ausdrückliche
Auftrag, für sämtliche Lücken Epics zu schreiben, erlaubt ihre Planung vor
Abschluss der Vorgänger; er hebt kein Umsetzungs-Gate auf. Bestehende Restarbeit
bleibt unter ihren ursprünglichen Task-/AC-IDs (Zuordnung: Audit §7, Gate G0).
Kein zweites Häkchen für bereits umgesetzte Funktionen, keine neue Architektur
ohne ADR bei späterer Implementierung. Schätzungen ohne G0-Restarbeit.

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P5 — Session-Discovery, Handoff, Recovery](EPIC-P5-session-discovery-handoff-recovery.md) | dieselbe Session PC↔Handy, auch nach Neustart — **abgeschlossen 2026-09-23** (Retro) | P4.5 grün; P4-externe Restpunkte bleiben offen | 2–4 |
| [P6 — Multi-Host-Flotte](EPIC-P6-multi-host-fleet.md) | alle eigenen Rechner in einer Oberfläche — **abgeschlossen 2026-09-23** (Retro) | P5 grün | 1–2 |
| [P7 — Harness-/Tool-Parität](EPIC-P7-harness-tool-parity.md) | echte Rückfragen/Freigaben, Anhänge und Tools — **abgeschlossen 2026-09-24** (Retro; aider/Swarm → P12) | P6 grün | 2–4 |
| [P8 — Mobiler Arbeitsplatz](EPIC-P8-mobile-workspace-ux.md) | einfache UI, Inbox, Entwürfe, Push/Offline — **abgeschlossen 2026-09-24** (Retro; Gerätetests → P12) | P7 grün | 1–2 |
| [P9 — AI-Steuerung und Eingaben](EPIC-P9-ai-command-input.md) | jeder Hub-Flow per natürlicher Sprache/Text — **abgeschlossen 2026-09-24** (Retro) | P8 grün | 1–2 |
| [P10 — Echtzeit-Sprache und Laya](EPIC-P10-realtime-voice-laya.md) | lokale Streaming-STT, gemessene Laya-Entscheidung | P9 grün | 1–3 |
| [P10.5 — Medien- und Video-Analyse](EPIC-P10.5-media-video-analysis.md) | YouTube/Videos: Transkript, Schlüsselbilder, Kapitel, Zusammenfassung als Session-Material | P7 T7.10 + P10 grün | 1–3 |
| [P11 — Desktop-Companion](EPIC-P11-desktop-companion.md) | systemweite Eingabe und definierte GUI-Flows | P10 grün | 2–4 |
| [P12 — Betriebsreife](EPIC-P12-operational-readiness.md) | Verschlüsseltes Produktivbackup + isolierter Restore belegt; Code und Doku gemergt (!112–!115); **offen: externe Geräte-/Provider-Abnahmen** (T12.1–T12.5, T12.7, T12.8, T12.10, T12.12) | P11 abgeschlossen mit Restnachweisen | 1–2 |
| [P13 — Hermes-Adapter](EPIC-P13-hermes-adapter.md) | Hermes Agent als CLI-Adapter (Spawn/Resume/Events, live verifiziert 03.10.2026) — **abgeschlossen 2026-10-03** (Ralph-Loop) | P3-Adaptermuster | 1 |
| [P14 — Session-Worktree-Hygiene](EPIC-P14-session-worktree-hygiene.md) | Archivieren räumt saubere Worktrees auf, `hubctl worktrees [prune]` — **abgeschlossen 2026-10-08** (produktiver `prune --apply` steht aus) | keine fachliche (BUG-0027 behoben) | 0,5 |
| [P15 — Session-Steuerung](EPIC-P15-session-steuerung.md) | Modus/Modell wählen, Pause, Queue, Sync Handy↔PC, klare Titel — **Code abgeschlossen 2026-10-09** (ADR-0033/0034/0035; Live-Sync am PC offen, Entscheidung bei Jan) | keine offene | 1–2 |
| [P16 — Handy-Abnahme](EPIC-P16-handy-abnahme.md) | E2E auf dem Pixel 9 Pro XL: Token-Seite, DevTools-Abbruch, Code-Suche; Querformat-Lauf nicht als Produktbefund — **offen** | P15-Code liegt; P12-Geräteabnahme bleibt offen | 0,5–1 |
| [P17 — Laufzeit-Robustheit](EPIC-P17-laufzeit-robuheit.md) | Resume-Referenzen im Adapter-Contract, Wait-Pinning/-Idempotenz, stabile `ANCIENTVOID_*`-Pane-Marker (Herdr-Ideen, Option C der [Evaluation 2026-10-26](../docs/herdr-evaluation-2026-10-26.md)) — **abgeschlossen 2026-10-26** (ADR-0036/0037; AC-P17-1: 100 % Marker-Zuordnung in 282 ms) | keine fachliche (P13/P14-Präzedenz, läuft neben P12) | 1–1,5 |
| [P18 — Desktop-Workspace](EPIC-P18-desktop-workspace.md) | Widescreen ohne 1680-px-Deckel, bis zu vier Sessions als Kacheln (Layouts 1/2/1+2/2×2), Tastatur nach Hyprland-Art, Persistenz pro Gerät, K2 mit vier Kacheln — **offen** | keine fachliche (baut auf P8-Split, AC-P8-6) | 1–1,5 |
| [P19 — Loop / Dark Factory](EPIC-P19-loop-dark-factory.md) | Auswahldimension „Loop“: `securesight-factory` (vormals Entwurfsname securesight-harnez; Orchestrator `self`/Hermes) und `aSPARK-Factory` (MQTT-Leitstand, Modus dark) als austauschbare `LoopConnector`-Pakete ([ADR-0038](../docs/adr/0038-loop-dark-factory.md), [Analyse](../docs/loop-analyse-2026-10-27.md)) — **gebaut seit 2026-10-28 (T19.1–T19.8: Contract, `loopAsAdapter`, beide Connectors, Auswahl, Abzeichen, Panel); Messlauf und Retro 2026-10-28 (3 🟢 / 5 🟡), manuelle Handy-Abnahme offen** | keine fachliche (P13/P14/P17-Präzedenz); P18 noch offen, Gating-Frage im ADR | 2–3 |
| [P24 — pi, omp, maki](EPIC-P24-pi-omp-maki.md) | Erkennung und Übernahme von pi-, oh-my-pi- und maki-Sessions — **Code abgeschlossen, Live-Abnahme offen** | P5, P22 | 0,5 |
| [P23 — Desktop-Navigation, Reste](EPIC-P23-desktop-navigation-reste.md) | „AncientVoid“ führt in die Übersicht (letzte Session markiert), einheitliche Statusleiste am Desktop — **Code abgeschlossen** | P18, P20, P21 | 0,5 |
| [P22 — Session-Entdeckung](EPIC-P22-session-entdeckung.md) | Titel/Vorschau/„läuft woanders“, Suche vor dem Paging, Übernahme ohne Prompt und als Kopie — **Code abgeschlossen, Live-Abnahme offen** | P5, P21 | 0,5 |
| [P21 — Icon-Leisten, Übergabe, Metriken, Fragen](EPIC-P21-icon-leiste-uebergabe-metriken-fragen.md) | Desktop-Icon-Leisten und klickbare Kürzel (fertig), Provider-Ausfall erkennen und übergeben, Lauf-Metriken mit Restzeit-Schätzung, Fragen-Dialog — **Code abgeschlossen** | keine fachliche | 1–2 |
| [P25 — Slash-Commands](EPIC-P25-slash-commands.md) | Harness-Commands (/clear, /compact …) steuerbar im Composer: `capabilities().commands` ([ADR-0042](../docs/adr/0042-slash-commands-im-adapter-contract.md), [Analyse](../docs/slash-commands-analyse-2026-10-29.md)), Autocomplete scope-gefiltert, Fail-loud-Hinweis statt stiller Fehlleitung — **Mechanik abgeschlossen 2026-10-29; Live-Verifikation der CLI-Listen offen (T25.6-Rest)** | keine fachliche | ~1 |
| [P26 — Factory-Integration](EPIC-P26-factory-integration.md) | `securesight-factory` Ende-zu-Ende aus AncientVoid: Projekt anlegen (PRD → `factory init`), Lauf auslösen (Treiber-Session `/factory` + Beobachter-Loop), beobachten, Rückfragen beantworten, human-only steuern; Connector-Modus `project` (Zielprojekte ohne `betrieb.py`), Namensbereinigung — **offen (Planung 2026-10-30)** | keine fachliche offene (P19 gebaut, manuelle Abnahme offen; P7, P25) | 2–3 |
| [P27 — Unterbrochene Sessions](EPIC-P27-interrupted-sessions.md) | Unterbrechungen (Worker-Kill, Hub-Restart, Adapter-Down) als Status `interrupted` mit Grund sichtbar machen, offene Züge ordentlich per `session.turn_end(interrupted)` abschließen (Endreport stimmt), im Chat Weitermachen (ADR-0036-Resume, Mensch-ja/Agent-nein) oder Archivieren anbieten; Auto-Resume nur deklarativ sicher (`resume.auto`) — **abgeschlossen (05.11.2026, [MR !293](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/293), 1181 Tests / 295 E2E-Pässe, K8 grün); CI-Quota-Befund an P28 übergeben** | keine fachliche offene (P5/P15/P17 als Basis; parallel zu P26, Präzedenz P13/P14/P17) | ~1 |

„Alle / 100 %“ bezieht sich auf die Pflichtmatrix aus Audit §4. Eine unbekannte
oder technisch blockierte Fähigkeit verhindert diesen Claim; Monitor-only und
Kontext-Fork zählen nicht als native 1:1-Steuerung. Mac ist bisher Demo-Kontext,
kein bestätigter zusätzlicher Zielhost.

## Paseo-Impulse — Planungsentwürfe vom 2026-11-05

Ausdrücklicher Planungsauftrag auf Basis der
[Vergleichsanalyse](../docs/2026-11-05_paseo-vs-ancientvoid.md).
[Bestandskorrekturen, Quellen und Entscheidungsregister](../docs/2026-11-05_paseo-umsetzungsplanung.md)
erläutern den Umfang. **Alle sechs Epics sind Planungsentwürfe, Umsetzung gesperrt.**
Die Planung hebt keine Vorgänger-Abnahme auf; P27 und dessen wirksame
Vorgänger-Exits müssen vor Start von P28 nachweislich grün sein. Historische
Statuszeilen gelten nicht als aktueller Abschlussnachweis.

| Epic | Ergebnis | Abhängigkeit | Agenten-Wochen |
|---|---|---|---|
| [P28 — Reproduzierbare CI](EPIC-P28-reproduzierbare-ci.md) | Diagnose, isolierter Runner, vollständige Gate-/K8-Evidenz — **abgeschlossen (06.11.2026)**: selbstverwalteter Docker-Runner `av-docker` ([ADR-0049](../docs/adr/0049-selbstverwalteter-ci-runner.md)), Gate-Parität inkl. K8 20×30 in `verify`, Skip-Bericht in `e2e`, zwei Negativproben rot, drei SHA-gebundene grüne Gesamtläufe (8895473), 5 CI-Funde als BUG-0092–0096 | P27 samt Vorgänger-Exits grün | 1–2 |
| [P29 — Worktree-Workspace-Runtime](EPIC-P29-worktree-workspace-runtime.md) | Manifest, Dateiübernahme, Setup/Teardown, Services/Ports, mobiler Zugang — **in Umsetzung (T29.1–T29.3 abgeschlossen 07.11.2026: ADR-0051 abgenommen, Resolver/Freigabe/Übernahme, persistente Setup-Operationen mit Crash-Klärung)** | P28 grün; P2/P14/P26 geprüft | 3–5 |
| [P30 — Adapter-/Sink-Plugins](EPIC-P30-adapter-sink-plugins.md) | Manifest, lokale/Git-Installation, Testkit, sicherer Lifecycle | P29 grün | 2–3 |
| [P31 — ACP-Provider-Katalog](EPIC-P31-acp-provider-katalog.md) | kuratierte Provider, explizite Probe, getrennte Fähigkeitsnachweise | P30 grün | 2–3 |
| [P32 — Mobile-Client-Entscheidung](EPIC-P32-mobile-client-entscheidung.md) | Gerätebefund + Go/No-go; optional interne Android-Shell | P31 grün, P12/P16 geprüft | 0,5–1; optional +2–4 |
| [P33 — Englischer Einstieg](EPIC-P33-englische-einstiegsdokumentation.md) | Bedarfsentscheid, README/Contracts/Quickstart; keine Publikation | P32-Exit ausdrücklich abgenommen | 0,5–1,5 |

Neue Kette: **P27 → P28 → P29 → P30 → P31 → P32 → P33**.
Bei P32/P33 ist ein dokumentierter Evaluations-Exit (No-go/vertagt) vom
Implementierungsabschluss getrennt. Keine Antwort ist kein Go. Bei P32-Go
wartet P33 auch auf den Implementierungs-Exit; bei Vertagung muss der gültige
Evaluations-Exit ausdrücklich festgehalten werden. Keine automatische App-/OSS-Freigabe.

## Reihenfolge & Gating

Reihenfolge: **P0 → P1 → P1.5 → P1.6 → P2 → P3 → P4 → P4.5 → P5 → P6 → P7 → P8 → P9 → P10 → P10.5 → P11 → P12 → P13 → P14 → P15 → P16 → P17 → P18 → P19 → P21 → P22 → P23 → P24 → P26** (P13/P14/P17/P18/P19 unabhängig: Adaptermuster aus P3, Worktree-Hygiene bzw. Laufzeit-Robustheit auf bestehendem P5/P7/P15-Code; P16 ist die Handy-Liste, kein Start vor geklärter P12-Abnahme).

Jedes Epic endet mit messbarem Exit-Kriterium. Das folgende Epic startet erst,
wenn alle Exit-Kriterien des Vorgängers grün sind (Eval-Frage-Regel aus PRD §9.1.6).

**E2E-Gate (ab P5, 2026-09-23):** Ein Epic ist erst abgeschlossen, wenn
`npm run gate` grün ist und der blockierende Pipeline-Job `e2e` auf dem
Abschluss-MR grün lief. Jede im Epic gebaute UI-Funktion und jeder Ablauf hat
einen Spec in `e2e/specs/`. Offene Lücken stehen als `test.fixme` mit Task-
oder Bug-ID im Gate, nie als gelöschter Test. Details:
[`docs/testing-e2e.md`](../docs/testing-e2e.md).

**Ausnahme P1.5 — bewusste Umpriorisierung, kein umgangenes Gate:** Nach dem
ersten echten Einsatz der P1-Oberfläche wurde P1.5 auf Nutzerwunsch vor P2 und
den Rest von P3 gezogen, weil P2s Budget-Teil für eine reine
Subscription-Nutzung teilweise gegenstandslos ist (gebraucht wird
Kontingent-/Limit-Transparenz, kein Dollar-Budget pro Session) und interaktive
Steuerung — antworten, diktieren, mit Skill/Agent starten — aktuell mehr Wert
schafft als Diff-/Approval-UI. P3s T3.6/T3.7/T3.9 (Sprache, Prompt-Composer)
sind dabei anteilig nach P1.5 vorgezogen; P2, P3 und P4 bleiben inhaltlich
unverändert. Begründung im Detail: Vorbemerkung in
[`EPIC-P1.5-control-center-ux.md`](EPIC-P1.5-control-center-ux.md).

**Ausnahme P4.5 — dritte Umpriorisierung (2026-09-21):** P5–P12 waren als
Planungsentwürfe hinter vollständig grünem P4/G0 gesperrt. Der Nutzer hat
ausdrücklich angeordnet, zuerst Testing/Logging/Monitoring zu bauen und erst
dann P5–P12 nacheinander umzusetzen. P4s externe Restpunkte (T4.3/T4.4/T4.5/
T4.8/T4.11) bleiben offen und blockieren P4.5 nicht. Begründung:
[`EPIC-P4.5-testing-observability.md`](EPIC-P4.5-testing-observability.md).

**Ausnahme P1.6 — zweite Umpriorisierung nach demselben Muster:** P1.5s
formale DoD-Zeile (ein echter Live-Handy-Lauf) steht noch aus, aber der
Nutzer hat die P1.5-Oberfläche nach dem ersten Blick abgelehnt und über
einen eigenen Mockup-Vergleich durch eine neue Informationsarchitektur samt
„Futuristisch"-Bedienrahmen ersetzt haben wollen — den ausstehenden
Live-Test jetzt mit der bereits verworfenen Oberfläche zu machen wäre
verschwendete Zeit. P1.6 baut **keine neuen fachlichen Funktionen**, nur den
Bedienrahmen für die in P1.5 bereits gebauten; danach folgt ein gemeinsamer
Live-Handy-Test, der P1.5s und P1.6s offene Punkte gemeinsam abschließt.
Begründung im Detail: Vorbemerkung in
[`EPIC-P1.6-futuristic-ui-system.md`](EPIC-P1.6-futuristic-ui-system.md).

## Referenz-Messlatten (aus PRD §9)

K1 Approve-Latenz < 5 s · K2 Tail ohne Frame-Lag bei 30 Events/s · K3 Diff-Payload ≤ 50 KB
K4 MCP-Gateway < 1.000 Tokens statisch · K5 Adapter-Events ≤ 4 KB unchunked
K6 Sprach-Transkript ≤ 1,5 s · K7 State-Restore 100 % in < 3 s · K8 20 parallele Sessions ohne Verlust
K9 Cursor-Breakage sichtbar < 60 s · K10 PWA-Offline mit Zeitstempel
