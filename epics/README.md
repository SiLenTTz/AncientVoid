# UACC — Epic-Paket (P0–P4.5 und Planungsentwürfe P5–P13)

**Erstellt:** 12.09.2026 · **Basis:** PRD UACC v1.0 (2026-09-12-PRD-Unified-AI-Agent-Command-Center.md)
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

„Alle / 100 %“ bezieht sich auf die Pflichtmatrix aus Audit §4. Eine unbekannte
oder technisch blockierte Fähigkeit verhindert diesen Claim; Monitor-only und
Kontext-Fork zählen nicht als native 1:1-Steuerung. Mac ist bisher Demo-Kontext,
kein bestätigter zusätzlicher Zielhost.

## Reihenfolge & Gating

Reihenfolge: **P0 → P1 → P1.5 → P1.6 → P2 → P3 → P4 → P4.5 → P5 → P6 → P7 → P8 → P9 → P10 → P10.5 → P11 → P12 → P13** (P13 unabhängig, nur Adaptermuster aus P3).

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
