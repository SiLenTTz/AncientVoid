# EPIC-P3 — Adapter-Flotte (swarm/zai/local-llm), cursor-clip, Sprachsuche & Prompt-Composer

**Status:** offen · **Phase:** P3 · **Dauer:** 1,5 Agenten-Wochen · **Abhängigkeit:** P2 grün

---

## 1. Ziel

Der Hub deckt die volle Provider-Liste ab — einschließlich des read-only Cursor-Clip —
und bekommt die sprachgesteuerte Eingabeseite: lokale Dateisuche über bunker.ai-RAG und
den Prompt-Composer mit automatischer Prompt-Optimierung. Ab hier ist das Produkt „vom
Handy aus voll arbeitsfähig".

## 2. Scope

### In
- Adapter `swarm` (securesight-swarm Event-API: Event-Stream, Gate-Ergebnisse, Ladder-State)
- Adapter `zai` (Nemesis-Router :8788; Normalisierung `reasoning_content` vs `content`)
- Adapter `local-llm` (llama.cpp-Server-Streams, Qwen-Finetunes)
- Adapter `copilot` (best effort, --allow-all-tools; Status: unproven ehrlich markiert)
- Adapter `cursor-clip` (read-only state.vscdb-Watcher, `may-break`-Banner, K9)
- Entscheidung & Umsetzung OD-1: Browser-STT vs. serverseitiges Whisper.cpp
- Sprachsuche (S5): Projekt-Index über Qdrant+, Embedding lokal, Ergebnisliste mit
  Zeilen-Ankern, Datei-Viewer mit Syntax-Highlight
- Prompt-Composer (S6): Roh-Transkript → lokaler Optimizer → Diff-Preview → Senden
- Sprach-Direktiven („Budget 3 Dollar", „stopp") als Constraints/Actions mit Gate-Mapping

### Out
- Brain-Digest, evox2/Windows, MCP-Gateway, OSS — P4

## 3. Design-Details

### Cursor-Clip (read-only, fragil by design)
- FS-Watcher auf `~/.config/Cursor/User/globalStorage/state.vscdb` (SQLite, WAL-Modus
  beachten → read-only Connection mit immutable-Flag wo möglich).
- Decoder hinter Interface mit Versions-Marker: erkanntes Schema ↔ Decoderversion.
- Schema-Bruch → innerhalb 60 s `adapter.broken` + Banner „Cursor-Integration unterbrochen,
  Kernfunktionen unbeeinträchtigt" (K9). **Kernnutzung darf nie von diesem Adapter hängen.**
- Steuer-Umleitung: UI zeigt bei Cursor-Sessions „Steuern via Hub-Agent"-Button, der eine
  neue claude/codex-Session mit dem Cursor-Chat-Kontext (Zusammenfassung, ≤ 2 KB) anlegt.

### Sprach-Pipeline (OD-1: beide Pfade, Whisper als Ziel)
1. Primär: MediaRecorder (Opus) → Whisper.cpp-Server (Omarchy oder silenttz-server) →
   Domänen-Prompt („Erkenne gut: git, diff, worktree, JSONL, tool_use, Codex, Claude,
   Qdrant, tmux, MCP") → Transkript. Ziel K6 ≤ 1,5 s.
2. Fallback: Android-Chrome `SpeechRecognition` (sofort, ohne Server).
3. Transkript ist immer editierbar vor Absenden (kein Fire-and-forget).

### Prompt-Optimizer (automatisch, lokal, optional)
- Backend: lokales Small-Model (Qwen-Finetune auf Omarchy) mit Optimizer-Systemprompt:
  strukturiert in Ziel / Scope / Constraints / Budget / Erfolgskriterium.
- UI: Split-Preview (roh | optimiert), Änderungen markiert; „Los" sendet optimiert,
  „Original senden" bleibt immer möglich.
- Learning-Loop (lokal): verworfene/edierte Optimierungen → lokale JSONL-Sammlung →
  periodische Optimizer-Prompt-Revision. **Niemals Cloud, niemals Telemetrie.**

### Sprachsuche (R3, bunker.ai-Reuse)
- Hub-Adapter ruft Qdrant+Embeddings lokal auf das Projektverzeichnis; Erstindex ad-hoc,
  danach inkrementell via file-watcher.
- Top-k (default 5) Dateien mit Zeilen-Anker + Snippet (≤ 30 Zeilen); Tap → Viewer.
- Härte: Query darf niemals an Cloud-Endpunkte gehen — Netzwerk-Egress-Test im CI
  (Mock-Interzeptor beweist: kein externer Call während Suche).

## 4. Aufgaben

- [ ] **T3.1** Adapter `swarm` inkl. Gate-Ergebnis-Mapping auf Approval-Queue.
  Kontext (WorkItem-Felder, Event-/Live-Bus-Format, Allowlist-Sicherheitsmuster):
  [`docs/adr/0001-swarm-adapter-context.md`](../docs/adr/0001-swarm-adapter-context.md).
  **Abhängigkeit:** `SteerInput` kennt bisher kein "approve/reject Gate X" —
  das Gate-Ergebnis-Mapping ist erst sauber lösbar, sobald P2 eine
  Approval-Queue-Abstraktion bereitstellt.
- [ ] **T3.2** Adapter `zai` (Routing via Nemesis :8788, Reasoning-Normalisierung)
- [ ] **T3.3** Adapter `local-llm` (Stream-Parsing, Modell-Registry: welches Modell läuft wo)
- [ ] **T3.4** Adapter `copilot` best-effort + Permission-Prompt-Hook in Approval-Queue
- [ ] **T3.5** Adapter `cursor-clip` mit Version-Detection, Broken-State, Steer-Umleitung
- [ ] **T3.6** Whisper.cpp-Server-Anbindung + Domänen-Prompt + Latenz-Messung (K6)
  — *Vermerk (P1.5):* Der Sprach-MVP wurde nach
  [`EPIC-P1.5-control-center-ux.md`](EPIC-P1.5-control-center-ux.md) T1.5-7
  vorgezogen, dort aber bewusst mit **Browser-STT zuerst** (Begründung: keine
  Serverinfrastruktur nötig, umgeht Premortem-Risiko 1 dieser Phase). T3.6
  bleibt bestehen als lokaler Ersatzpfad für Geräte/Browser ohne native STT und
  als Antwort auf den Datenschutz-Einwand aus P1.5 §3.3.
- [ ] **T3.7** Browser-STT-Fallback + Geräte-Fähigkeits-Matrix (welches Handy kann was)
  — *Vermerk (P1.5):* vorgezogen und dort umgesetzt als
  [`EPIC-P1.5`](EPIC-P1.5-control-center-ux.md) T1.5-7 (inkl.
  Geräte-Fähigkeits-Matrix und K6-Messlauf). Hier nur noch historisch geführt;
  offen bleibt in P3 allein die Rolle als *Fallback* gegenüber T3.6, nachdem
  P1.5 die Reihenfolge umgekehrt hat.
- [ ] **T3.8** Sprachsuche-Frontend (S5) + Projekt-Index-Service + Egress-CI-Test
- [ ] **T3.9** Prompt-Composer (S6) mit Optimizer + Split-Preview + Learning-Loop-Storage
  — *Vermerk (P1.5):* Composer + Optimizer + Split-Preview wurden nach
  [`EPIC-P1.5`](EPIC-P1.5-control-center-ux.md) T1.5-6/T1.5-8 vorgezogen
  (inkl. der dort offen geführten Frage, welches Modell die Umformulierung
  ausführt, P1.5 §3.4). **In P3 verbleibt der Learning-Loop-Storage**
  (verworfene/edierte Optimierungen → lokale JSONL-Sammlung → periodische
  Optimizer-Prompt-Revision) — der ist in P1.5 ausdrücklich out of scope.
- [ ] **T3.10** Sprach-Direktiven-Parser → Action-Mapping (stopp = write-Gate,
  Budget-Änderung = write-Gate mit Summary)
- [ ] **T3.11** Adapter-Status-Matrix in README live aus `capabilities()` generieren
  (Ehrlichkeitsklausel automatisieren — aSPARK-Lektion)

## 5. Acceptance Criteria

- **AC-P3-1:** Alle sechs Provider-Typen laufen parallel in je einer Session → Dashboard
  zeigt konsistentes Bild, keine Adapter-spezifischen UI-Brüche.
- **AC-P3-2 (K9):** state.vscdb-Fixture mit geändertem Schema injizieren → `adapter.broken`
  < 60 s, Banner sichtbar, alle anderen Adapter unberührt (Test beweist Isolation).
- **AC-P3-3 (K6):** 20 Sprach-Queries Fachbegriffe-lastig → Transkript ≤ 1,5 s (90.%),
  Begriffserkennung ≥ 90 % (Test-Set mit bekannten Begriffen).
- **AC-P3-4:** Sprachsuche „wo wird das Rate-Limit gesetzt" im Test-Repo mit bekannter
  Antwort → Treffer in Top-3, Zeilen-Anker korrekt.
- **AC-P3-5:** Optimizer verwandelt vagen Sprach-Prompt („mach das mit dem Login besser,
  aber nimm nicht mehr als 3 Dollar") in strukturierten Prompt inkl. Budget-Constraint;
  Budget landet tatsächlich im Session-BudgetState.
- **AC-P3-6:** Egress-Test: während Suche + Optimierung werden null externe Verbindungen
  aufgebaut (Interzeptor-Report im CI-Artefakt).
- **AC-P3-7:** „Stopp die Session" per Sprache → write-Gate-Dialog (nicht Sofort-Exekution),
  nach Bestätigung wird Session gestoppt und Audit-Event geschrieben.

## 6. Premortem

**Ende P3, gescheitert. Warum?**
1. *Whisper-Latenz platzt auf Omarchy unter Last* (GPU belegt durch lokale Modelle) →
   Mitigation: Whisper auf silenttz-server als Standard, Omarchy nur Fallback; kleines
   Modell (base/small) statt large als Default.
2. *Optimizer verschlimmert gute Prompts* (Over-Engineering einfacher Anweisungen) →
   Mitigation: Heuristik — unter 15 Wörtern und klarem Imperativ kein Optimizer-Vorschlag
   ohne Anfrage; A/B-Log im Learning-Loop.
3. *Cursor-Clip wird zum Wartungsloch* → Mitigation: harter Zeitdeckel 0,5 Wochen; wenn
   Decoder-Varianten > 2, wird auf „Letzte bekannte Version"-Support reduziert.
4. *sechs Adapter × Contract-Tests = Testmatrix-Explosion* → Mitigation: Normalizer-
   Property-Tests zentral, adapter-spezifisch nur Fixtures.

## 7. Definition of Done

Alle ACs + Adapter-Matrix automatisch generiert + Domänen-Test-Set für STT versioniert +
Learning-Loop-Datenformat dokumentiert (für spätere Brain-Integration) + keine
Cursor-Abhängigkeit in irgendeinem Exit-Kriterium anderer Epics.
