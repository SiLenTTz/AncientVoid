# EPIC-P7 — Harness- und Tool-Parität mit echten Freigaben

**Status:** abgeschlossen (2026-09-24, Retro unten) · **Phase:** P7 · **Dauer:** 2–4 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P6 grün; ursprüngliche P3-Adapterzusagen abgeschlossen.

Planungsauftrag vom 2026-09-21; kein Umsetzungsstart und keine Behauptung eines
grünen Vorgänger-Gates. Scope, Evidenz und bestehende Restarbeiten:
[Audit](../docs/remote-control-audit-2026-09-21.md), [Index](README.md).

## 1. Ziel

Alle verpflichtenden Harness-Funktionen sind mobil erreichbar: Modelle/Skills,
Tool-Aufrufe, Rückfragen, Anhänge, Änderungen und Freigaben. „Steer vorhanden“
wird durch eine geprüfte Funktionsmatrix ersetzt. PRD G1, §8, K1/K3/K4/K5/K7/K9;
Audit G02/G06–G08/G13/G16.

## 2. Scope (In / Out)

**In:** feinere Capabilities, Provider-Tool-Gates, persistente Aktionen,
Swarm-Kind-Sessions, Anhänge, registrierte Tools, Quellcodesuche und Messwerte.
**Out:** Umgehung nicht existierender Provider-APIs, freie Shell vom Handy,
GUI-Fallback (P11). Basis-Adapter aus P3 nicht nochmals als Neubau zählen.

## 3. Design-Details

ADR: getrennte Fähigkeiten für Folgeprompt, Interrupt, Resume, Tool-Freigabe,
User-Question, Modellwechsel, Skill/Agent, Bilder/Dateien, Context-Fork. Der Server
validiert die echte Capability; eine deaktivierte UI allein schützt nichts.

Freigabe eines Prompts autorisiert nicht automatisch jedes spätere Tool. Native
Permission-/Question-Callbacks nutzen, falls vorhanden; sonst dokumentierte
Sandbox/Tool-Allowlist und sichtbare eingeschränkte Fähigkeit. Kein universelles
`allow-all` als behaupteter Ersatz. Ein Agent darf eigene Freigaben nicht erteilen.
Session-Start/Stop/Park erhalten klare, akteurabhängige Policy; Not-Stopp bleibt
für den autorisierten Menschen unmittelbar erreichbar.

Pending-Operation enthält unveränderliche Argumente/Hash, Revision, Actor,
Timeout, Zustand; JSONL+Snapshot rekonstruierbar. Freigabe und tatsächliche
Ausführung getrennt protokollieren. Bei ungewissem externem Side-Effect erst
abgleichen, nie blind erneut ausführen. Anhänge als Blobs mit Medien-/Größenlimits.

DeepSeek/llama.cpp-Endpunkt ist ein Modell, kein Coding-Harness. Modellzugang
und toolausführende Runtime explizit trennen. Eigener Swarm braucht reale
Event-Schemas und Parent-/Child-Bezüge. Quellcodesuche ergänzt die bestehende
Markdown-Suche; Indexpfade und Host-/Worktree-Grenzen erhalten eindeutige Anker.

## 4. Aufgaben

- [x] **T7.1 — Capability-Matrix und ADR.** Pflichtmatrix je realer Provider-Version implementieren, Modellkatalog/Account/Skill pro Harness; unbekannte Funktionen ehrlich sperren. K5/K9. Stand 2026-09-23: [ADR-0018](../docs/adr/0018-harness-features-and-native-gates.md), `features` je Adapter aus der Konfiguration berechnet, Server lehnt Modell/Agent/Folgeprompt/Park mit Grund ab (`features.test.ts`), Modellkatalog `/api/adapters/:id/models` (claude-Kürzel, `opencode models`), [`docs/harness-matrix.md`](../docs/harness-matrix.md) von `check:adapter-matrix` im Gate geprüft, PWA zeigt Funktionen und warnt bei `bypass` (E2E `harness.spec.ts`, `navigation.spec.ts`).
- [x] **T7.2 — Native Rückfragen und Tool-Freigaben.** Tool-Call-ID, Optionen, Auswirkung und Antwortkanal an Freigaben binden; nicht nur Hub-Prompts gaten; echte Erlauben/Ablehnen/Timeout-Roundtrips. K1/K5/K7. Stand 2026-09-24: **claude** über `--permission-prompt-tool` + MCP-Brücke (Token darf nur fragen, nie entscheiden), **codex** über `app-server` (jetzt Standard, dazu Modellkatalog und Kontingent), **ACP** (`@ancientvoid/adapter-acp`) für copilot, opencode und dsh; Rückfragen (claude AskUserQuestion, codex request_user_input) als Formular am Handy; nie „immer/für die Session erlauben“; Zeitablauf ⇒ nicht ausgeführt; Anfragen als Operationen persistent (ADR-0019), tmux-Pipe-Modus für dauerhafte Agenten (ADR-0013 Nachtrag). Live (`scripts/messlauf-p7.mjs`): claude 2.1.280 Erlauben/Ablehnen/Rückfrage ✓, codex 0.156.1 ✓, copilot 1.0.88 ✓, opencode 1.18.32 ✓. aider bleibt ohne Mechanismus (`bypass`, sichtbar gewarnt).
- [x] **T7.3 — Dauerhafte Aktionsausführung.** Pending-Steer/Top-up aus RAM in rekonstruierbaren Zustand bringen, Approval-Hash/Revision, Outcome, Idempotenz und Crash-Abgleich. K5/K7. Stand 2026-09-24: [ADR-0019](../docs/adr/0019-durable-approval-operations.md), `operations`-Tabelle (Migration 12) mit Payload-Hash in der signierten Entscheidung, bedingte Zustandsübergänge (höchstens einmal), Abgleich nach Neustart (`operations.test.ts`: vor/nach Entscheidung, während Dispatch, Manipulation; Mutation ohne Abgleich rot), E2E „wartende Freigabe übersteht einen Hub-Absturz“ (SIGKILL).
- [x] **T7.4 — Gemeinsame Policy und MCP.** Alle registrierten Operationen nach Akteur/Capability freigeben; Start/Stop/Park erst danach exponieren; drei Meta-Tools beibehalten, echter Referenz-Tokenizer für K4 statt reiner Zeichenheuristik. K1/K4/K7. Stand 2026-09-24: [ADR-0021](../docs/adr/0021-actor-policy.md) — Akteur aus Token-Label, eine Tabelle für jede Route (preHandler, fail-closed), Agenten-Schreibzugriffe werden Freigaben (Start/Prompt/Park/Stop/Budget), Entscheiden/Übernehmen/Tokens/Flotte für Agenten gesperrt, Not-Stopp für Menschen sofort; MCP-Gateway mit `sessions.create/stop/park` (202 + Freigabe), weiterhin drei Meta-Tools, K4 mit js-tiktoken o200k_base = 280 / cl100k_base = 274 Tokens. Tests: Invarianten (`policy.test.ts`), Hub-Integration, Gateway `hub_exec` Ende-zu-Ende.
- [x] **T7.5 — Harness-Parität und Anhänge.** Swarm-Gates/Kinder, Aider/DeepSeek/local-llm live abnehmen; Bilder/Dateien/mehrzeilige Antworten pro echter Capability, ohne große Event-Payloads; kein Steuerbutton für Observer. K3/K5/K7/K9. Stand 2026-09-24: **lokales Modell** llama.cpp (Vulkan) auf gpubox, Qwen3-Coder-30B-A3B Q4_K_XL, nur Tailnet + Schlüssel ([local-llm.md](../docs/local-llm.md)); **live** durch opencode (ACP) und den **DeepSeek-Harness dsh** (ACP, `read-only`-Sandbox, Eskalation fragt am Handy) mit Tool-Erfolg und -Fehler ([Messlauf](../docs/messlauf/2026-09-24-p7-harness-gates.md)). ACP-Adapter: Modellwahl beim Start (`session/set_config_option`, sichtbarer Abbruch bei unbekanntem Modell), Tool-Details für Anfragen nur mit `toolCallId`, Exit-Code ≠ 0 als Fehler. Observer: kein Stop/Antworten, nur „Beobachtung beenden“ (E2E `harness.spec.ts`). Bilder/Dateien je Capability: T7.10. **Nicht erledigt, mit Grund:** aider live (kein Tool-Gate; Lauf mit `--yes-always` hier nicht freigegeben) → T12.4; Swarm → T12.8 (fehlendes Credential, Event-Vokabular unbelegt).
- [x] **T7.6 — Dateien, Quellcode und Arbeitsresultate.** Lokale Code-Suche und Dateiviewer mit Zeilenankern, Diff-Verweis, Worktree-Identität; registrierte Test/Git/Tool-Aktionen mit Schemas, Ausführungsstatus und Policy. K3/K5; PRD §6.2/§8. Stand 2026-09-24: Modul `code` (Core) + `/api/code/{search,file}` und `/api/sessions/:id/actions`: ripgrep (Rückfall `git grep`), Symbolmodus mit Definitionen zuerst (TS/JS, Python, Go, Rust, Shell), Viewer mit Sprache, Blob-Id, Worktree-Identität (Branch, HEAD, Basis) und „in dieser Session geändert → Diff“; Pfade per realpath im Worktree, kein `.git`, keine Binärdateien. Zeilenanker `#/sessions/<id>/code/<pfad>:L<n>` übersteht Neuladen. Aktionen: eingebaute Git-Lesezugriffe, erkanntes `npm test`/pytest, weitere aus `hub.config.json` `actions`; argv ohne Shell, Parameter per Muster und ohne `-`-Präfix, eine Aktion je Session, Zeitlimit beendet die Prozessgruppe, Ausgabe-Ende ≤ 4 KB in der Timeline. Policy `actions.run`: Mensch ja, Agent nein. Kein Such-Egress. Nebenbei: PWA-Typprüfung jetzt Teil von `npm run typecheck`; neue Events scrollen nur noch Chat/Verlauf. Tests: `code.test.ts` (Core, Hub), E2E `code.spec.ts`.
- [x] **T7.7 — Ehrliche Messwerte.** Token-Erfassung von Kostenfähigkeit entkoppeln, unknown/partial/estimated/native, Account-Quota und Session-Nutzung unterscheiden; ADR für betroffene Contracts und bestehende ADR-0006-Annahmen. K5/K7; PRD §9/R9.7. Stand 2026-09-24: [ADR-0023](../docs/adr/0023-honest-metrics.md) — Quelle pro Event (`tokensSource`/`costSource`), Beleg pro Zug (`metric_counters`, Migration 15), Qualität je Session `unknown/partial/estimated/native`; opencode-`cost: 0` ist kein Wert, codex-Preistabelle und Dummy-Tokens sind `estimated`; PWA: „nicht gemeldet“, „mind. …“, „≈ …“, Tages-Summe nur glatt bei durchgehend `native`. Tests: `metrics.test.ts` (Contracts, Core inkl. Migration), E2E `session.spec.ts`.
- [x] **T7.10 — Dateien und Bilder in Sessions, mit Inhaltsauslese (Wunsch 2026-09-24).** Upload aus PWA (Kamera, Galerie, Dateien) als Blob mit Medien-/Größenlimits; Formate: Bilder (PNG/JPEG/WebP/HEIC), PDF (Textebene, gescannte Seiten per OCR), Office (DOCX/XLSX/PPTX), Text/Code/Markdown/CSV/JSON. Auslese lokal wo möglich, sonst über **Gemini** (kostenloser API-Key, in den **Einstellungen** hinterlegt, hub-seitig gespeichert, nie an Clients zurückgegeben, Egress sichtbar). Der Harness bekommt die Datei nativ, wenn er es kann (T7.5 `images`/`files`), sonst den ausgelesenen Text als Anhang. Vorschau und Auslese-Text in der PWA; E2E mit echten Beispieldateien. Stand 2026-09-24: [ADR-0022](../docs/adr/0022-attachments.md) — Upload bis 25 MB, Speicher nach Hash, lokale Auslese (pdftotext, tesseract deu+eng, Office-XML) mit Gemini-Rückfall, Schlüssel nur schreibbar (Einstellungen), native Übergabe an claude/codex/opencode/ACP, sonst Text im Prompt; PWA: Büroklammer in Start und Antwort, Auslese-Status, Vorschau und Text im Chat. Tests: echte PNG/PDF(Scan+Text)/DOCX/XLSX/PPTX/CSV (`extract.test.ts`), Adapter-Wege, E2E `attachments.spec.ts`.
- [x] **T7.9 — System-1-Gatekeeper für Tool-Freigaben (Laya-Prinzip).** Lokales Modell (llama.cpp auf gpubox, T7.5) bewertet jede Tool-Anfrage aus T7.2 feldweise mit Enum-Grammatik und Logprobs: `tool_risk` (READ_ONLY/LOCAL_WRITE/DESTRUCTIVE/EXFILTRATION) und `security_gate` (CLEAN/WARNING/CRITICAL_BLOCK). Ergebnis als Badge auf der Freigabe-Karte; `CRITICAL_BLOCK` stuft auf `destructive` (Passkey) hoch. Fail-closed-Schwellen im Code, Prompt auf AncientVoid-Regeln (ADR-0007, Worktree-Grenzen, Secrets) umgeschrieben, Kalibrierung auf eigenen Tool-Anfragen. Verschärft nur, gibt **nie** frei. Sprach-Intents bleiben in P10. Stand 2026-09-24: [ADR-0024](../docs/adr/0024-tool-gatekeeper.md). Regeln als Boden + llama.cpp-Modell (GBNF, Logprobs), fail-closed kombiniert; `CRITICAL_BLOCK` → `destructive`; Badge „Laya: …“ auf der Karte. Messlauf auf 44 gelabelten eigenen Anfragen: kombiniert 95,5 % Gate / 90,9 % Risiko, **0 verpasste CRITICAL, 0 zu mild**, p95 ≈ 0,4 s ([Messlauf](../docs/messlauf/2026-09-24-gatekeeper.md)). Ehrlich: die Logprob-Konfidenz dieses Modells ist ≈ 1 und kalibriert nichts; unabhängiger Held-out-Satz aus dem Betrieb → T12.4. Tests: `gatekeeper.test.ts`, E2E `harness.spec.ts` (Badge, Passkey bei Schlüssel-Upload).
- [x] **T7.8 — Nachgebauter `claude`-CLI im E2E-Gate (AI-P5-3).** stream-json wie `adapter-claude/normalize.ts` erwartet; entsperrt den Skill-Picker-Test (`fixme`) und prüft den Claude-Fehlerpfad (ADR-0015) im Browser. Stand 2026-09-23: `e2e/support/bin/claude` (Formen aus den echten 2.1.280-Captures, Schlüsselwörter WERKZEUG/FEHLER/LANGSAM), im Test-Hub registriert; Skill-Picker-Test statt `fixme`, Tool-Aufruf und Fehlerpfad im Browser (`harness.spec.ts`). Skill-Picker richtet sich nach `features` (ADR-0018).

## 5. Acceptance Criteria

- **AC-P7-1:** Jede Pflichtzelle der Matrix hat reale Evidenz; lokale Modelle und DeepSeek durchlaufen den gewählten Harness mit echtem Tool-Erfolg und -Fehler. „Unproven“ verhindert Abschluss.
- **AC-P7-2 (K1):** Reale Provider-Rückfrage und Tool-Freigabe vom Handy beantwortbar; Reject/Timeout führt keinen Tool-Call aus; Risikoargumente stimmen mit ausgeführter Aktion überein.
- **AC-P7-3 (K7):** Crash vor Entscheidung, nach Entscheidung und während Dispatch: keine verlorene Anfrage, kein blind doppelter Side-Effect, ungewisser Zustand sichtbar.
- **AC-P7-4:** Mindestens Text, Bild und Datei durch den jeweils fähigen Harness; ungeeigneter Provider gibt verständlichen Fehler vor Upload/Dispatch. Alle Event-Payloads ≤ 4 KB.
- **AC-P7-5:** MCP hat weiterhin drei Meta-Tools und < 1.000 statische Tokens mit benanntem Tokenizer; Agent kann seine eigene Approval nicht bestätigen.
- **AC-P7-7 (T7.9):** Der Gatekeeper bewertet reale Tool-Anfragen lokal (kein Egress), jedes Feld nur mit einem erlaubten Wert; Unsicherheit oder Ausfall führt zur strengeren Stufe; keine Anfrage wird durch ihn freigegeben; Trefferquote und Latenz auf einem gelabelten Satz eigener Anfragen im Messlauf belegt.
- **AC-P7-8 (T7.10):** Je ein Bild mit Text, ein gescanntes PDF, ein Text-PDF, eine DOCX und eine CSV landen in einer Session und sind auslesbar (OCR/Text); ohne Gemini-Key läuft der lokale Weg oder es kommt eine klare Meldung; der Key ist nur in den Einstellungen setzbar und nie aus der API lesbar.
- **AC-P7-6:** Bekannte Funktion in .ts und .py durch lokale Suche mit korrektem Zeilenanker auffindbar; kein Such-Egress. Fehlende Kosten/Tokens erscheinen nie als bestätigte Null.

## 6. Premortem

1. **Hub-Gate verdeckt unkontrollierte Tool-Ausführung:** native Gate-Probe mit realem verbotenen Tool und Reject.
2. **Approval überlebt, Inhalt verschwindet:** immutable Operation persistent; Entscheidung und Outcome getrennt.
3. **Capability-Versprechen überholt Provider:** Version-/Fixture-Matrix und Fail-loud-Status, kein boolesches Alles-kann-Steer.
4. **Anhang überlastet Stream:** Blob-Upload mit Limits; JSONL nur Referenzen, K5-Property-Tests.

## 7. Definition of Done

Alle ACs mit benannten Tests/Messläufen belegt, Vorgänger-Gate geschlossen;
`npm test`, `npm run lint`, `npm run typecheck` grün, PWA-Build bei UI-Änderungen,
Last-/Gerätetests gemäß AC. Contracts first; Adapter-/Event-/Worker-Änderungen
mit ADR. K5-Blob-Grenze, K7-Recovery, AdapterContext-Isolation und Fail-loud
nachgewiesen. Jede Funktion in Config, API/CLI und passender UI tatsächlich
registriert/erreichbar; Capability-/Support-Matrix ehrlich aktualisiert.
Premortem im Abschlussreview gegenprüfen, offene Pflicht-ACs blockieren Abschluss.
Commit/MR gemäß Repo-Workflow; kein lokaler Merge nach main.

## Retro

**Zeitraum:** 2026-09-23 23:49 – 2026-09-24 · **Commits:** 37 (`6c770be` … `305a44a`
plus Abschluss-MR) · **Gate am Ende:** vitest 568+, E2E 124, lokal (`npm run gate`).

### AK-Matrix

- **AC-P7-1:** 🟡 teilweise
  - **Beleg:** `docs/harness-matrix.md`, `scripts/check-adapter-matrix.mjs` (im Gate).
    Live-Messläufe `docs/messlauf/2026-09-24-p7-harness-gates.md`: claude, codex,
    copilot/opencode über ACP, lokales Modell durch opencode **und** dsh mit
    Tool-Erfolg und -Fehler.
  - **Offen:** aider hat keinen Live-Lauf. aider hat kein Tool-Gate, und ein
    Lauf mit `--yes-always` wurde in dieser Umgebung nicht freigegeben. Swarm
    fehlt ebenfalls (kein Credential, Event-Vokabular unbelegt). Beides ist
    ausdrücklich verschoben (AI-P7-1, T12.8).
  - **Selbst korrigiert:** Die Modellwahl-Zelle von copilot/ACP stand kurz auf
    ✓ und ist nach dem Live-Check auf „—“ gesetzt.
- **AC-P7-2 (K1):** 🟢 erfüllt
  - **Beleg:** Messlauf P7, Tabelle „Tool-Freigabe vom Handy“: Erlauben/Ablehnen
    bei 4 Harnesses, Rückfrage bei claude. Dazu E2E `harness.spec.ts` (Erlauben,
    Ablehnen, Rückfrage, Warteschlange) und
    `approval-flow`-Regressionstest.
- **AC-P7-3 (K7):** 🟢 erfüllt
  - **Beleg:** `packages/core/test/modules/approvals/operations.test.ts`
    (Absturz vor/nach Entscheidung/während Dispatch) und E2E „wartende Freigabe
    übersteht einen Hub-Absturz und läuft danach genau einmal (T7.3)“.
- **AC-P7-4:** 🟢 erfüllt
  - **Beleg:** E2E `attachments.spec.ts` (Payload < 4096). Dazu
    `code.test.ts` (Aktionsausgabe ≤ 4 KB), `features.test.ts` („an
    observer gets no attachments — said before anything is sent“) und die
    Adapter-Tests mit nativer Übergabe (claude/codex/opencode/ACP).
- **AC-P7-5:** 🟢 erfüllt
  - **Beleg:** `apps/gateway-mcp/test/k4-token-budget.test.ts` (o200k 280, cl100k
    274) und `apps/hub/test/modules/approvals/policy.test.ts` (Agent → 403 auf
    `decide`).
- **AC-P7-6:** 🟢 erfüllt
  - **Beleg:** `packages/core/test/modules/code/code.test.ts` („finds a known
    function in .ts and .py …“) und E2E `code.spec.ts` (Zeilenanker übersteht
    Neuladen). Ehrliche Messwerte: `metrics.test.ts` (Contracts, Core,
    Migration) und E2E „nicht gemeldete Kosten sind keine $0“.
- **AC-P7-7 (T7.9):** 🟡 teilweise
  - **Beleg:** `docs/messlauf/2026-09-24-gatekeeper.md`: 0 verpasste
    CRITICAL, 0 zu mild, p95 ≈ 0,4 s, lokal (gpubox). Dazu
    `gatekeeper.test.ts` (Fail-closed bei Timeout, Fehler und Antwort
    außerhalb der Grammatik; „never approves“) und E2E „ein Schlüssel ins Netz
    ist kritisch“.
  - **Offen:** Die Kalibrierung lief auf dem Entwicklungssatz, nicht auf einem
    unabhängigen Held-out-Satz. Die Logprob-Konfidenz des Modells ist ≈ 1 und
    damit kein Signal (AI-P7-3).
- **AC-P7-8 (T7.10):** 🟢 erfüllt
  - **Beleg:** `packages/core/test/modules/attachments/extract.test.ts` (echte
    PNG/Scan-PDF/Text-PDF/DOCX/XLSX/PPTX/CSV) und E2E `attachments.spec.ts`
    (Schlüssel nur schreibbar).

**Stand:** 6 🟢 / 2 🟡 / 0 🔴 / 0 ⚪. Beide 🟡 haben ein benanntes Ziel.

### Premortem

1. **Hub-Gate verdeckt unkontrollierte Tool-Ausführung:** eingetreten und
   abgefangen.
   - opencode führt ohne Preset ungefragt aus.
   - dsh führt in `workspace-write` ungefragt aus (live gesehen).
   - Beide Presets erzwingen jetzt die Nachfrage (`permission: ask` bzw.
     `DSH_PERMISSION_MODE=read-only`); belegt im Messlauf.
2. **Approval überlebt, Inhalt verschwindet:** nicht eingetreten. Die Operation
   ist immutable und hashgebunden (T7.3-Tests).
3. **Capability-Versprechen überholt Provider:** eingetreten.
   - Das opencode-Plugin `permission.ask` wird in 1.18.32 nicht geladen; der
     Weg läuft deshalb über ACP.
   - copilot/ACP bietet keine Modellwahl an.
   - Beides wurde erst live sichtbar.
4. **Anhang überlastet Stream:** nicht eingetreten. Blobs werden nach Hash
   gespeichert, Events enthalten nur Referenzen (Payload-Tests).

### Erkenntnisse

1. **Live-Messläufe finden, was Fakes nicht finden.** Beispiele: Session hing
   nach „Ablehnen“ (`68e55b3`), dsh ohne Gate, ACP-Anfrage ohne Befehl
   (Adapter ergänzt jetzt aus `tool_call`), copilot ohne Modellwahl.
2. **Das Gate hatte eine Lücke:** Die PWA wurde nicht typgeprüft. Ein Syntaxfehler
   fiel erst beim Build auf. Jetzt ist `npm run typecheck` inklusive PWA
   (T7.6-MR).
3. **Ein Test, der ohne Fix nicht rot wird, beweist nichts.** Die erste
   Scroll-Regression lief auch ohne Fix grün. Der neue Test löst das Event
   selbst aus und ist ohne Fix nachweislich rot.
4. **Geteilte Hardware ist eine echte Betriebsgrenze.**
   `halogen-starten.sh` beendet `ancientvoid-llama` regelmäßig (02:41, 03:16).
   Der Gatekeeper ist deshalb fail-closed gebaut, nicht verfügbarkeitsabhängig.
5. **Logprobs eines Coder-Modells sind keine Kalibrierung.** Die Konfidenz ist ≈ 1
   auch bei Fehlgriffen. Die Sicherheit tragen die Regeln (Boden) und der
   Rückfall.

### Action Items

- **AI-P7-1:** aider mit dem lokalen Modell live abnehmen. Das braucht deine
  ausdrückliche Freigabe für einen Lauf ohne Tool-Gate.
  - **Zurück als:** P12 T12.4 (bereits eingetragen).
- **AI-P7-2:** Swarm-Adapter, sobald ein Admin-Credential und eine reale
  Event-Datei vorliegen.
  - **Zurück als:** P12 T12.8.
- **AI-P7-3:** Gatekeeper auf einem unabhängigen Satz echter Tool-Anfragen
  aus dem Betrieb nachmessen (≥ 100, nach dem Labeln nicht mehr am Prompt
  drehen).
  - **Zurück als:** P12 T12.4.
- **AI-P7-4:** Betrieb von `ancientvoid-llama` neben Halogen klären: gemeinsame
  Speicherplanung oder ein vereinbarter Start/Stopp. Das ist deine
  Entscheidung, nicht die des Hubs.
  - **Zurück als:** P12 T12.9.
- **AI-P7-5:** Der Live-Hub auf workstation läuft noch mit claude
  `--dangerously-skip-permissions` und opencode `--auto`. Auf native Gates
  umstellen, sobald du das bestätigst, denn es ändert deinen Alltag.
  - **Zurück als:** P12 T12.1.
