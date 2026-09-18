# EPIC-P3 — Adapter-Flotte (swarm/zai/local-llm/opencode/aider), cursor-clip, Sprachsuche & Prompt-Composer

**Status:** offen · **Phase:** P3 · **Dauer:** 1,5 Agenten-Wochen · **Abhängigkeit:** P2 grün

---

> **Vorbemerkung (2026-09-18): reale Bestandsaufnahme vor dem Bauen, zwei
> ursprüngliche Annahmen widerlegt.** Auf ausdrücklichen Nutzerwunsch
> („integriere auch weitere Tools wie deepseek harness, opencode, aider und
> unseren swarm") wurde diese Phase vor der Umsetzung real gegen die
> tatsächlich auf Omarchy laufenden Dienste geprüft, nicht nur gegen die
> ursprüngliche PRD-Annahme:
>
> - **`opencode` ist real installiert** (`/home/silenttz/.local/share/mise/
>   installs/opencode/latest/opencode`, v1.18.29) — ein echter, sofort
>   nutzbarer One-Shot-Modus (`opencode run <prompt>`), real getestet in
>   dieser Session. **Neu als T3.12 aufgenommen.**
> - **`aider` ist nicht installiert**, wird per `uv tool install aider-chat`
>   nachgerüstet. **Neu als T3.13 aufgenommen.**
> - **„zai" gibt es nicht als lokalen Nemesis-Router auf :8788** — die
>   ursprüngliche PRD-Annahme war falsch. Port 8788 gehört real zu einem
>   komplett anderen, unabhängigen Dienst („Hive Gateway" für ein separates
>   HiveOS-Projekt auf derselben Maschine — `{"openapi":"3.1.0","info":
>   {"title":"Hive Gateway", ...}}`, real per `curl` geprüft). Der reale,
>   tatsächlich funktionierende Zugang zu „zai" ist ein bereits
>   konfigurierter **`opencode`-Provider** (`zai-coding-plan`, Modelle
>   `glm-4.7` … `glm-5.3-highspeed`, real per `opencode run` gegen die
>   echte API verifiziert — Antwort „ok" kam tatsächlich vom `glm-5.3`-
>   Modell zurück). **T3.2 dahingehend korrigiert: kein eigener Zai-
>   Adapter mit erfundenem Router — Zai-Zugriff läuft über T3.12s
>   `adapter-opencode`.**
> - **Port 8080/8000 sind ebenfalls andere, unabhängige Dienste**
>   („SiLenT_Tz_KeyZ" bzw. „Pocket TTS" — real per `curl` geprüft, keine
>   OpenAI-kompatible LLM-API). Es gibt **keinen** lokal laufenden
>   llama.cpp-/Qwen-Server auf dieser Maschine zu diesem Zeitpunkt — T3.3
>   bleibt strukturell gebaut (reused `examples/adapters/openai-compat/`),
>   aber ehrlich als „unproven — keine reale lokale Instanz zum Prüfen
>   vorhanden" markiert, nicht stillschweigend als getestet geführt.
> - **DeepSeek** hat kein dediziertes CLI auf dieser Maschine und ist kein
>   opencode-Provider hier. „Deepseek harness" wird ehrlich als das
>   umgesetzt, was es technisch ist: ein OpenAI-API-kompatibler Endpunkt
>   (`https://api.deepseek.com/v1`) — **neu als T3.14** über denselben
>   `examples/adapters/openai-compat/`-Pfad wie T3.3, mit eigenem
>   Konfigurationsbeispiel statt eines erfundenen eigenen Adapters.
>
> Diese Korrekturen ersetzen keine bereits gebaute Funktionalität — sie
> verhindern, dass ein Adapter gegen den *falschen*, zufällig auf demselben
> Port laufenden Dienst gebaut oder getestet wird (real ein Risiko: ohne
> diese Prüfung hätte ein „zai"-Adapter Testverkehr an ein fremdes
> HiveOS-Gateway geschickt).

## 1. Ziel

Der Hub deckt die volle Provider-Liste ab — einschließlich des read-only Cursor-Clip —
und bekommt die sprachgesteuerte Eingabeseite: lokale Dateisuche über bunker.ai-RAG und
den Prompt-Composer mit automatischer Prompt-Optimierung. Ab hier ist das Produkt „vom
Handy aus voll arbeitsfähig".

## 2. Scope

### In
- Adapter `swarm` (securesight-swarm Event-API: Event-Stream, Gate-Ergebnisse, Ladder-State)
- ~~Adapter `zai` (eigener Nemesis-Router)~~ **gestrichen, siehe Vorbemerkung** — Zai läuft über T3.12
- Adapter `local-llm` (OpenAI-kompatibler Stream, Modell-Registry) — strukturell gebaut, unproven (keine reale Instanz)
- Adapter `deepseek` (OpenAI-kompatibel gegen `api.deepseek.com`) — **neu, T3.14**
- Adapter `opencode` (reales, installiertes CLI, One-Shot-Modus) — **neu, T3.12**
- Adapter `aider` (per `uv tool install aider-chat` nachgerüstet) — **neu, T3.13**
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
  Die ursprüngliche **Abhängigkeit ist aufgelöst**: P2 (T2.4/T2.5) liefert
  jetzt eine echte Approval-Queue-Abstraktion. **Trotzdem noch nicht
  gebaut** — real gegen `custom-rag` erneut geprüft (2026-09-18, siehe
  ADR-0001-Nachtrag): die Struktur existiert, ist aber an mehreren Stellen
  seit der ursprünglichen ADR-Notiz weitergezogen (reale Pfade, reale
  Freigabe-Route `/decisions` statt `/decide`, `Depends(require_admin)`
  auf jeder Route — ein eigenes, hier nicht vorhandenes Admin-Credential
  nötig). Vor allem: das reale `RunEvent.kind`-Vokabular war in der für
  diese Session verfügbaren Zeit nicht auffindbar — ein Normalizer ohne
  diese echten Werte wäre ein geratenes Mapping (R9.7-Verstoß), das
  reale Events später still falsch kategorisieren würde. Realer,
  korrigierter Fahrplan für den nächsten Versuch steht im
  ADR-0001-Nachtrag.
- [x] **T3.2** ~~Adapter `zai`~~ **entfällt als eigener Adapter** — kein
  lokaler Nemesis-Router existiert real (siehe Vorbemerkung). Zai-Zugriff
  (Modelle `glm-4.7`…`glm-5.3-highspeed`, Provider `zai-coding-plan`)
  läuft über T3.12s `adapter-opencode`, real verifiziert.
- [ ] **T3.3** Adapter `local-llm` (OpenAI-kompatibler Stream, Modell-
  Registry). Reuse von `examples/adapters/openai-compat/` statt Neubau.
  **Ehrlich unproven:** keine reale lokale LLM-Instanz auf dieser Maschine
  zum Zeitpunkt des Baus vorhanden (siehe Vorbemerkung) — Contract-Tests
  gegen eine echte, aufgezeichnete OpenAI-kompatible Antwort (z. B. von
  einem öffentlich erreichbaren kompatiblen Endpunkt), keine Live-Instanz.
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
- [ ] **T3.8** Sprachsuche-Frontend (S5) + Projekt-Index-Service + Egress-CI-Test.
  Hält sich an [`docs/design-system.md`](../docs/design-system.md) (P1.6) statt
  neuer Hex-Werte/Komponenten-Muster.
- [x] **T3.9** Prompt-Composer (S6) mit Optimizer + Split-Preview + Learning-Loop-Storage
  — *Vermerk (P1.5):* Composer + Optimizer + Split-Preview wurden nach
  [`EPIC-P1.5`](EPIC-P1.5-control-center-ux.md) T1.5-6/T1.5-8 vorgezogen
  (inkl. der dort offen geführten Frage, welches Modell die Umformulierung
  ausführt, P1.5 §3.4). **Learning-Loop-Storage jetzt umgesetzt** (die
  Hälfte, die P1.5 ausdrücklich offen ließ):
  `packages/server/src/prompt-optimizer-feedback.ts` — echtes lokales
  JSONL-Append (`POST /api/prompt-optimizer/feedback`, aus
  `Composer.tsx`s `acceptEnhanced()`/`keepOriginal()` aufgerufen, ein
  Eintrag pro gezeigtem Vorschlag). „Niemals Cloud, niemals Telemetrie"
  real erfüllt: reines lokales Datei-Append, kein Netzwerk-Call. Optional
  wie Approvals/WebAuthn (501 ohne konfiguriertes `dataDir`, kein Absturz).
  6 neue Tests (3 Storage-Modul, 2 Route, plus Bestand). **Ehrlich nicht
  gebaut: die „periodische Optimizer-Prompt-Revision"** — das eigentliche
  Lesen der JSONL-Sammlung und Anpassen von `enhance.ts`s `INSTRUCTION`
  ist eine echte Algorithmus-/Produktentscheidung (welches Muster gilt
  als revisionswürdig? wie oft? automatisch oder zur Prüfung
  vorgeschlagen?), die hier nicht erfunden wird — die Sammlung existiert
  jetzt real als Rohmaterial für diese Entscheidung, ist aber selbst
  noch nicht „fertig" im Sinne von T3.9s vollem Wortlaut.
- [x] **T3.10** Sprach-Direktiven-Parser → Action-Mapping (stopp = write-Gate,
  Budget-Änderung = write-Gate mit Summary)
  — *Vermerk (P1.6):* Das globale Sprachbefehl-Sheet (Transkription, Voice-
  Dock-Eintrag) existiert bereits ab
  [`EPIC-P1.6`](EPIC-P1.6-futuristic-ui-system.md) T1.6-7, dort ausdrücklich
  **ohne** Ausführung („Vorschau"-Hinweis). T3.10 ergänzt hier den fehlenden
  Teil: aus dem bereits vorhandenen Transkript eine Aktion ableiten, nicht
  das Sheet selbst neu bauen. Umgesetzt als reiner, synchroner Parser
  (`packages/pwa/src/voice-directives.ts`, 10 echte Unit-Tests — die erste
  PWA-Unit-Test-Datei dieser Session, bewusst nur für diese
  DOM-/API-freie, reine Funktion; die eigentliche Sheet-Darstellung bleibt
  wie zuvor Playwright-live-verifiziert), der genau die beiden im
  Aufgabentext genannten Direktiven erkennt (`stopp`, „Budget auf X
  Dollar/Euro ändern") — AC-P3-7-konform **nie automatisch ausgeführt**:
  `VoiceSheet.tsx` zeigt nach dem Erkennen einen echten
  Bestätigen/Abbrechen-Dialog mit der Zusammenfassung und ruft erst nach
  Tap auf „Bestätigen" die reale `stopSession()`/`requestBudgetTopUp()`-
  API. Ohne aktive Session (Sheet von der Übersicht aus geöffnet) wird das
  ehrlich benannt („Keine Session ausgewählt"), nicht stillschweigend
  ignoriert.
  **Live gegen den echten Hub verifiziert** (Playwright, echter
  Chromium-Build, Browser-eigene Spracherkennung durch eine reale
  Klassenersetzung von `window.SpeechRecognition`/
  `webkitSpeechRecognition` ersetzt — dieselbe reale Einschränkung, die
  `speech.ts`s eigener Kommentar für dieses Chromium schon dokumentiert):
  „stopp" gesprochen → Bestätigen-Dialog → nach Tap real per
  `GET /api/sessions` bestätigt, dass die Session tatsächlich von
  `working` auf `stopped` wechselte, inkl. korrektem `actor` im
  Audit-Event (T2.8).
  **Dabei einen echten, ernsten, vorbestehenden Produktionsbug gefunden
  und behoben** ([BUG-0011](../bugs/bug-0011-stop-button-silently-broken.md)):
  der reale „Stop"-Button in `SessionTail.tsx` rief dieselbe
  `hubApi.stopSession()` auf, die einen leeren Body mit
  `content-type: application/json` sendete — Fastify lehnt das mit einem
  echten 400 ab, und der Fehler wurde per `.catch(() => undefined)`
  komplett verschluckt. Der Button hat real **nie funktioniert**, seit er
  gebaut wurde, ohne dass es jemand bemerkt hätte. Behoben: echter Body
  (`"{}"`) plus sichtbare Fehleranzeige statt stillem Verschlucken.
- [x] **T3.11** Adapter-Status-Matrix in README live aus `capabilities()` generieren
  (Ehrlichkeitsklausel automatisieren — aSPARK-Lektion). Umgesetzt als
  **Prüfer statt stillem Neu-Schreiber**: `npm run check:adapter-matrix`
  (`scripts/check-adapter-matrix.mjs`) ruft für jeden Adapter mit eigenem
  Package (`dummy`/`claude`/`codex`/`opencode`/`aider`) real
  `createAdapter().capabilities()` auf und vergleicht das Ergebnis
  Spalte für Spalte gegen die tatsächlichen ✓/—-Symbole in der
  README-Tabelle — real getestet, dass es eine absichtlich eingebaute
  Abweichung auch tatsächlich findet. Bewusst **kein** blinder
  Neu-Schreiber der Status-/Phase-Spalten: die sind editorielle,
  belegpflichtige Aussagen (Tests, Messläufe), kein reiner
  Funktionsaufruf — ein Skript, das sie automatisch auf „proven" setzen
  würde, würde genau die Ehrlichkeitsklausel unterlaufen, die es
  eigentlich automatisieren soll. `copilot`/`swarm`/`zai`/`local-llm`/
  `deepseek`/`cursor-clip` sind ohne eigenes Package/mit geteilter
  Factory benannt übersprungen, nicht stillschweigend ignoriert.
- [x] **T3.12** Adapter `opencode` — real installiertes CLI (`opencode run
  <prompt>`), One-Shot-Modus analog `claude -p`. Korrektur ggü. der
  ursprünglichen Annahme oben: `opencode run --help` hat sehr wohl ein
  reales `--format json`-Flag (kein Logzeilen-Parsing nötig) — echte
  Fixtures unter `packages/adapter-opencode/test/fixtures/*.jsonl` (zwei
  reale Captures: Trivial-Read, Tool-Error), Normalisierung in
  `packages/adapter-opencode/src/normalize.ts`, 10/10 Tests grün. Nutzt
  automatisch den real konfigurierten `zai-coding-plan`-Provider für
  Zai/GLM-Zugriff (siehe Vorbemerkung) — keine separate Zai-Konfiguration
  nötig. Live-Ende-zu-Ende gegen echten Hub + echten tmux-Worker +
  echtes `opencode`/glm-5.3 verifiziert (Kosten-/Token-Summierung nach
  ADR-0003/0006 funktioniert unverändert für einen dritten Adapter).
- [x] **T3.13** Adapter `aider` — nachinstalliert via `uv tool install
  aider-chat --with audioop-lts` (reales Python-3.13-Kompatibilitätsproblem:
  `aider.voice` → `pydub` → `audioop`, seit PEP 594 aus der Stdlib entfernt —
  ohne den `audioop-lts`-Shim bricht selbst `aider --version`). Reale
  CLI-Form via `aider --help` geprüft: `--message`/`--yes-always`/
  `--no-pretty`/`--no-stream`/`--no-git` sind real, aber es gibt **keinen**
  JSON-/Strukturmodus — anders als claude/codex/opencode liefert aider nur
  einen Text-Blob pro Turn, daher bewusst kein `normalize.ts`, sondern ein
  einzelnes `assistant`-Event pro Turn (`packages/adapter-aider/src/index.ts`).
  Realer, gefährlicher Fund: ohne konfiguriertes Modell startet aider
  **keinen** Fehler, sondern einen interaktiven OpenRouter-OAuth-Flow und
  wartet bis zu 5 Minuten auf einen Browser-Callback — deshalb verweigert
  `start()` hier hart und sofort (`system`-Event `aider.missing_model`) ohne
  `spec.model`, statt dieses Risiko einzugehen. Ehrlich unproven: kein
  API-Key in dieser Umgebung vorhanden, also kein realer LLM-Turn
  aufgezeichnet — 6/6 Tests gegen einen synthetischen Stream, nicht gegen
  eine echte Aufnahme (siehe README-Matrix-Vermerk „unproven").
- [x] **T3.14** Konfigurationsbeispiel „DeepSeek" über den bestehenden
  `examples/adapters/openai-compat/`-Adapter (`baseUrl:
  "https://api.deepseek.com/v1"`, `model: "deepseek-chat"`) statt eines
  eigenen Adapters — DeepSeek ist laut eigener Doku OpenAI-API-kompatibel,
  ein zweiter Adapter für dasselbe Protokoll wäre unnötige Vervielfachung
  (dieselbe Begründung wie T1.1s Verzicht auf eine gemeinsame
  Adapter-Bibliothek, umgekehrt angewandt: hier *ist* schon eine
  gemeinsame Lösung da). Dokumentiert in
  `examples/adapters/openai-compat/README.md` und real ins lokale
  `hub.config.json` eingetragen (Erreichbarkeit, nicht nur Doku) — Hub
  gegen eine Scratch-Config gestartet, Log real bestätigt: `[hub]
  adapters: …, deepseek@0.1.0`, alle sechs Adapter laden ohne Fehler.
  Ehrlich unproven bleibt nur der eigentliche LLM-Call: kein
  `DEEPSEEK_API_KEY` in dieser Umgebung vorhanden, also nie ein echter
  Request gegen `api.deepseek.com` gefahren — Endpunkt/Modellname aus
  DeepSeeks öffentlicher API-Doku, nicht live verifiziert. Ohne Key
  liefert `runCompletion()` einen echten HTTP-Fehlerstatus als sichtbares
  `error`-Event, keinen stillen Fehlschlag.

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
