# EPIC-P4 — Brain-Integration, evox2/Windows, MCP-Gateway, OSS-Aufbereitung

**Status:** offen · **Phase:** P4 · **Dauer:** 1–2 Agenten-Wochen · **Abhängigkeit:** P3 grün

---

## 1. Ziel

Der Hub wird Ökosystem-fähig und veröffentlichbar: Brain-Digests abgeschlossener
Sessions, lauffähig auf evox2 (Windows/WSL), das lazy-disclosed MCP-Gateway (Meta-Tools,
< 1.000 Tokens) und das komplette Open-Source-Paket nach custom-rag-Hygienestandard.

## 2. Scope

### In
- `agent-hub`-Skill (Hermes-seitig): Session-Start, Status-Digest, Brain-Push
- Digest-Pipeline: abgeschlossene Sessions → kuratierte decisions/lessons-Neuronen
  (quote-grounded, EPIC-134-Pattern) mit Verweis auf JSONL-Roharchiv
- evox2-Port: WSL2-basierter Hub (tmux in WSL), read-heavy-Profil, Codex/Copilot in WSL
- MCP-Gateway als Sidecar: `hub_search` / `hub_describe` / `hub_exec`, Budget K4
- OSS-Aufbereitung: Lizenz (MIT oder Apache-2.0), AGENTS.md, docs/, epics/, CI,
  CONTRIBUTING, Security-Policy, Red-Team-Review
- Entscheidungen OD-2 (Gateway hinter Flag), OD-3 (Telegram-Push optional),
  OD-4 (Learning-Loop-Storage-Struktur) final umsetzen

### Out
- Native iOS/Android-Apps (bewusst nie — PWA-Entscheidung steht)
- Cursor-Write-Integration (bewusst nie auf diesem Pfad)

## 3. Design-Details

### Brain-Digest (Grenze strikt einhalten)
- Der OSS-Kern definiert einen **Reporting-Sink-Contract** (Webhook/Plugin):
  `onSessionComplete(sessionSummary) → void`. Brain ist *ein* Konsument, kein Bestandteil.
- Digest-Regeln: nur abgeschlossene Sessions; Quote-Grounding (jede Lesson zitiert
  Event-Sequenz-IDs); Roharchiv-Verweis statt Volltext.
- Hermes-Skill ist dünner Client: `hub session start --adapter claude --project X`,
  `hub digest push <id>`. Hermes bleibt Benutzer, nie Runtime (PRD §1.3).

### MCP-Gateway (Meta-Tool-Pattern, Bloat-Vermeidung als Kernfeature)
- **Drei Tools, keine mehr:**
  - `hub_search(query)` → Liste relevanter Operationen (Name + 1-Zeilen-Beschreibung,
    keine Schemas). ~20–100 Tokens pro Treffer.
  - `hub_describe(op)` → vollständiges Argument-Schema on demand.
  - `hub_exec(op, args_json)` → validierte Ausführung durch die Allowlist-Engine (P2).
- Statische Kosten: 3 Schemas < 1.000 Tokens (K4 — CI-Test parst das Tool-Manifest und
  zählt Tokens mit Referenz-Tokenizer).
- Aktivierung hinter Config-Flag (OD-2: Default **aus**; Warnhinweis bei Aktivierung:
  „MCP-Gateway exponiert Hub an Agenten — Budget-Regeln prüfen").
- Sicherheit: Gateway erbt Approval-Klassen; `hub_exec` auf write/destruktiv-Operationen
  erzeugt Approval-Queue-Eintrag statt Sofort-Ausführung (Elicitation-Muster).

### evox2/Windows
- Hub-Service läuft in WSL2 (systemd-user), Tailscale im WSL; PWA-Zugriff identisch.
- tmux-Worker uneingeschränkt in WSL; native Windows-Agenten-Steuerung explizit out of scope.
- Read-heavy-Profil: evox2-Hub darf Sessions monitoren, Starten nur nach zusätzlicher
  Freigabe in Config.

### OSS-Aufbereitung
- Repo-Struktur: `hub/`, `adapters/`, `pwa/`, `gateway-mcp/`, `docs/`, `epics/`, `fixtures/`
- README mit Adapter-Status-Matrix (automatisch generiert, P3-T3.11) + Ehrlichkeitsklausel
- `SECURITY.md` mit §8-Bedrohungsmodell; Red-Team-Review vor Tag v0.1:
  Prompt-Injection-Pfade, Token-Theft, Worktree-Escape, WebAuthn-Bypass-Versuche
- Keine Brain-Interna im Repo; Vault-Verweise nur als generische „reporting sink"-Beispiele

## 4. Aufgaben

- [ ] **T4.1** Reporting-Sink-Contract + Webhook-Plugin-Skelett
- [ ] **T4.2** Digest-Pipeline (Extraktion, Quote-Grounding, Archiv-Verweis)
- [ ] **T4.3** Hermes-Skill `agent-hub` (dünn, keine Runtime-Logik)
- [ ] **T4.4** Gengar-Status-Board-Anbindung (Hub-Health als State)
- [ ] **T4.5** WSL2-Port: Installer, systemd-user-Unit, Smoke-Tests auf evox2
- [ ] **T4.6** MCP-Gateway-Sidecar mit 3 Meta-Tools + Allowlist-Anbindung
- [ ] **T4.7** K4-CI-Test (Tokenizer-Messung des Manifests) + Gateway-Budget-Doku
- [ ] **T4.8** Lizenz-Entscheidung + Header-Sweep + DCO/CLA-Frage klären
- [ ] **T4.9** Docs: architecture.md, adapters.md (Contract), security.md, mobile-ux.md
- [ ] **T4.10** Red-Team-Review (externe oder frische-Augen-Session) + Findings-Triage
- [ ] **T4.11** Release-Checkliste v0.1 (Tag, Changelog, Fixtures-Hygiene, Secret-Scan)

## 5. Acceptance Criteria

- **AC-P4-1:** Abgeschlossene Test-Session → Brain-Push enthält ≥ 1 decision-Neuron mit
  gültigem Archiv-Verweis; Löschen des Brain-Plugins beeinträchtigt Hub- Kernfunktion null.
- **AC-P4-2 (K4):** CI misst Gateway-Manifest < 1.000 Tokens statisch; Test schlägt bei
  jedem neuen Tool fehl (Anti-Scope-Creep).
- **AC-P4-3:** Agent (claude) nutzt Hub über MCP-Gateway: findet Operation via `hub_search`,
  beschreibt via `hub_describe`, führt write-Op aus → landet korrekt in Approval-Queue
  statt Direktausführung.
- **AC-P4-4:** evox2: Hub läuft in WSL2, Session mit codex starten/monitoren/stoppen vom
  Handy funktioniert; Native-Windows-Pfade erscheinen nirgends im Worker.
- **AC-P4-5:** Gateway ist per Default aus; frischer Clone ohne Config-Änderung exponiert
  keinen MCP-Port.
- **AC-P4-6:** Red-Team-Report archiviert; kritische Findings gefixt oder release-blockierend
  dokumentiert; Secret-Scan des gesamten Repos sauber.

## 6. Premortem

**Ende P4, gescheitert. Warum?**
1. *Gateway wird „noch schnell" um zwei Conveniences-Tools erweitert* → Bloat zurück.
   Mitigation: K4-CI-Gate ist hart, jedes neue Tool braucht ADR + Token-Budget-Nachweis.
2. *Brain-Digest bläht den Vault mit Trivia* (jede Session = 5 Neuronen) → Mitigation:
   Kuratierungs-Filter (nur Sessions mit Entscheidungen/Fehlern/Approvals), Quote-Pflicht
   verhindert generische Lessons.
3. *WSL2-Netzwerk/Tailscale-Friktion frisst eine Woche* → Mitigation: Zeitdeckel 0,5
   Wochen; danach evox2 als „monitor-only"-Konfiguration ausliefern und Thema parken.
4. *OSS-Release ohne echte Nutzer-Kritik* → Mitigation: vor v0.1 mindestens eine externe
   Testperson (oder frischer Agent ohne Kontext) installiert nach README — alle
   Stolpersteine gehen in Docs.

## 7. Definition of Done

Alle ACs + v0.1 getaggt + Docs ohne TBD + Adapter-Matrix ehrlich + kein einziger
Brain-spezifischer Codepfad im OSS-Kern + Post-Release-Retro-Termin im Kalender.
