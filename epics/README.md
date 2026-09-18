# UACC — Epic-Paket (P0–P4)

**Erstellt:** 12.09.2026 · **Basis:** PRD UACC v1.0 (2026-09-12-PRD-Unified-AI-Agent-Command-Center.md)
**Workflow:** Vault-Standard — jedes Epic enthält Premortem, Messlatten-Bezug (K1–K10), Definition of Done.

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

## Reihenfolge & Gating

Reihenfolge: **P0 → P1 → P1.5 → P1.6 → P2 → P3 → P4.**

Jedes Epic endet mit messbarem Exit-Kriterium. Das folgende Epic startet erst,
wenn alle Exit-Kriterien des Vorgängers grün sind (Eval-Frage-Regel aus PRD §9.1.6).

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
