# EPIC-P7 — Harness- und Tool-Parität mit echten Freigaben

**Status:** in Arbeit seit 2026-09-23 (P6 abgeschlossen, siehe dessen Retro) · **Phase:** P7 · **Dauer:** 2–4 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P6 grün; ursprüngliche P3-Adapterzusagen abgeschlossen.

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
- [x] **T7.2 — Native Rückfragen und Tool-Freigaben.** Tool-Call-ID, Optionen, Auswirkung und Antwortkanal an Freigaben binden; nicht nur Hub-Prompts gaten; echte Erlauben/Ablehnen/Timeout-Roundtrips. K1/K5/K7. Stand 2026-09-24: **claude** über `--permission-prompt-tool` + MCP-Brücke (Token darf nur fragen, nie entscheiden), **codex** über `app-server` (jetzt Standard, dazu Modellkatalog und Kontingent), **ACP** (`@uacc/adapter-acp`) für copilot, opencode und dsh; Rückfragen (claude AskUserQuestion, codex request_user_input) als Formular am Handy; nie „immer/für die Session erlauben“; Zeitablauf ⇒ nicht ausgeführt; Anfragen als Operationen persistent (ADR-0019), tmux-Pipe-Modus für dauerhafte Agenten (ADR-0013 Nachtrag). Live (`scripts/messlauf-p7.mjs`): claude 2.1.280 Erlauben/Ablehnen/Rückfrage ✓, codex 0.156.1 ✓, copilot 1.0.88 ✓, opencode 1.18.32 ✓. aider bleibt ohne Mechanismus (`bypass`, sichtbar gewarnt).
- [x] **T7.3 — Dauerhafte Aktionsausführung.** Pending-Steer/Top-up aus RAM in rekonstruierbaren Zustand bringen, Approval-Hash/Revision, Outcome, Idempotenz und Crash-Abgleich. K5/K7. Stand 2026-09-24: [ADR-0019](../docs/adr/0019-durable-approval-operations.md), `operations`-Tabelle (Migration 12) mit Payload-Hash in der signierten Entscheidung, bedingte Zustandsübergänge (höchstens einmal), Abgleich nach Neustart (`operations.test.ts`: vor/nach Entscheidung, während Dispatch, Manipulation; Mutation ohne Abgleich rot), E2E „wartende Freigabe übersteht einen Hub-Absturz“ (SIGKILL).
- [x] **T7.4 — Gemeinsame Policy und MCP.** Alle registrierten Operationen nach Akteur/Capability freigeben; Start/Stop/Park erst danach exponieren; drei Meta-Tools beibehalten, echter Referenz-Tokenizer für K4 statt reiner Zeichenheuristik. K1/K4/K7. Stand 2026-09-24: [ADR-0021](../docs/adr/0021-actor-policy.md) — Akteur aus Token-Label, eine Tabelle für jede Route (preHandler, fail-closed), Agenten-Schreibzugriffe werden Freigaben (Start/Prompt/Park/Stop/Budget), Entscheiden/Übernehmen/Tokens/Flotte für Agenten gesperrt, Not-Stopp für Menschen sofort; MCP-Gateway mit `sessions.create/stop/park` (202 + Freigabe), weiterhin drei Meta-Tools, K4 mit js-tiktoken o200k_base = 280 / cl100k_base = 274 Tokens. Tests: Invarianten (`policy.test.ts`), Hub-Integration, Gateway `hub_exec` Ende-zu-Ende.
- [ ] **T7.5 — Harness-Parität und Anhänge.** Swarm-Gates/Kinder, Aider/DeepSeek/local-llm live abnehmen; Bilder/Dateien/mehrzeilige Antworten pro echter Capability, ohne große Event-Payloads; kein Steuerbutton für Observer. K3/K5/K7/K9.
- [ ] **T7.6 — Dateien, Quellcode und Arbeitsresultate.** Lokale Code-Suche und Dateiviewer mit Zeilenankern, Diff-Verweis, Worktree-Identität; registrierte Test/Git/Tool-Aktionen mit Schemas, Ausführungsstatus und Policy. K3/K5; PRD §6.2/§8.
- [ ] **T7.7 — Ehrliche Messwerte.** Token-Erfassung von Kostenfähigkeit entkoppeln, unknown/partial/estimated/native, Account-Quota und Session-Nutzung unterscheiden; ADR für betroffene Contracts und bestehende ADR-0006-Annahmen. K5/K7; PRD §9/R9.7.
- [ ] **T7.10 — Dateien und Bilder in Sessions, mit Inhaltsauslese (Wunsch 2026-09-24).** Upload aus PWA (Kamera, Galerie, Dateien) als Blob mit Medien-/Größenlimits; Formate: Bilder (PNG/JPEG/WebP/HEIC), PDF (Textebene, gescannte Seiten per OCR), Office (DOCX/XLSX/PPTX), Text/Code/Markdown/CSV/JSON. Auslese lokal wo möglich, sonst über **Gemini** (kostenloser API-Key, in den **Einstellungen** hinterlegt, hub-seitig gespeichert, nie an Clients zurückgegeben, Egress sichtbar). Der Harness bekommt die Datei nativ, wenn er es kann (T7.5 `images`/`files`), sonst den ausgelesenen Text als Anhang. Vorschau und Auslese-Text in der PWA; E2E mit echten Beispieldateien.
- [ ] **T7.9 — System-1-Gatekeeper für Tool-Freigaben (Laya-Prinzip).** Lokales Modell (llama.cpp auf evox2, T7.5) bewertet jede Tool-Anfrage aus T7.2 feldweise mit Enum-Grammatik und Logprobs: `tool_risk` (READ_ONLY/LOCAL_WRITE/DESTRUCTIVE/EXFILTRATION) und `security_gate` (CLEAN/WARNING/CRITICAL_BLOCK). Ergebnis als Badge auf der Freigabe-Karte; `CRITICAL_BLOCK` stuft auf `destructive` (Passkey) hoch. Fail-closed-Schwellen im Code, Prompt auf UACC-Regeln (ADR-0007, Worktree-Grenzen, Secrets) umgeschrieben, Kalibrierung auf eigenen Tool-Anfragen. Verschärft nur, gibt **nie** frei. Sprach-Intents bleiben in P10.
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
