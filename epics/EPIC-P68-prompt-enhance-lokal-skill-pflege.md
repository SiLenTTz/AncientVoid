# EPIC-P68 — Prompt verbessern: lokales Modell zuerst, Projektkontext, Skill-Vorschläge pflegen statt duplizieren

**Status:** abgeschlossen 2026-11-18 (T68.1–T68.7, PR #160 gemerged, Abschlussprüfungen grün; Live-Abnahme am echten llama.cpp nach P000 verschoben) · **Phase:** P68 · **Dauer:** 1 Agenten-Woche · **Abhängigkeit:** keine fachliche offene (Quer-Epic wie P58–P67; baut auf T1.5-8/T1.5-10, T3.9, T5.10, BUG-0061 auf); P30/P31 bleiben On hold und unberührt

Quelle: Nutzerauftrag vom 18.11.2026. Beobachtet: (1) Der Zauberstab
„Verbessern“ läuft praktisch immer über OpenCode — jeder Adapter ohne eigenen
One-Shot (pi, aider, copilot, eigene ACP-Registrierungen) fällt seit
2026-10-24 auf `opencode run` zurück; das konfigurierte lokale Modell
(`assistant.model`, llama.cpp) wird gar nicht gefragt. (2) Der verbesserte
Prompt kennt das Projekt nicht: Claude läuft mit `--tools ""`, die anderen
CLIs bekommen nur den Rohtext — Konventionen, Kommandos und vorhandene Skills
fehlen. (3) Die Skill-Vorschläge sind meist schwach oder doppeln Vorhandenes;
die Karte zeigt nie den Inhalt des vorhandenen Skills, und Speichern kann nur
**neue** Dateien anlegen (`flag: "wx"`), nie eine bestehende anpassen.

## 1. Ziel

- „Verbessern“ nutzt **zuerst das lokale Modell** (`assistant.model`, ersatzweise
  `gatekeeper.model` — dieselbe Auflösung wie T9.2). Ist es nicht konfiguriert,
  nicht erreichbar, ausgelastet oder zu langsam, übernimmt **der ausgewählte
  Adapter** (bisheriger One-Shot je Flavor); nur ohne eigenen One-Shot bleibt
  OpenCode die letzte Stufe. Welche Stufe geantwortet hat und warum eine
  übersprungen wurde, steht sichtbar in der Vorschau (Regel 6, fail loud).
- Der Verbesserer bekommt einen **kompakten Projektkontext** (Agenten-Leitfaden,
  README-Anfang, Paket-Metadaten/Skripte, oberste Verzeichnisebene, vorhandene
  Skills/Agents) — als Daten markiert, nie als Instruktion (PRD §8.5).
- Skill-Vorschläge: Gibt es einen passenden Skill/Agent/Workflow, wird **dieser**
  angezeigt (mit Inhalt), nicht ein neuer angelegt. Der Nutzer kann ihn
  **nutzen, anpassen und speichern**; eine Anpassung kann das Modell auf
  Wunsch vorschlagen. Neu anlegen gibt es nur, wenn nichts Ähnliches existiert,
  und der Entwurf ist vor dem Speichern editierbar.

## 2. Scope (In / Out)

**In**

- Hub: Engine-Kette `lokal → Adapter → OpenCode` für Prompt-Verbessern, mit
  Auslastungsprüfung (llama.cpp `/slots`, HTTP 503/429), eigenem Timeout und
  Begründung je übersprungener Stufe in der Antwort (`engine`, `skipped`).
- Hub: Projektkontext-Sammler mit festem Zeichenbudget, Containment wie
  Session-Anlage, Prompt-Injection-Rahmen.
- Core: Skill-Empfehlung mit Duplikat-Schutz (`mode: "update"` statt `create`,
  wenn ein ähnlicher Eintrag existiert), Lesen eines vorhandenen Eintrags mit
  Inhalts-Hash, Überschreiben nur gegen passenden Hash (optimistische Sperre).
- Hub-Routen: `GET /api/skills/artifact`, `PUT /api/skills`,
  `POST /api/skills/revise` (Anpassung vorschlagen, gleiche Engine-Kette).
- Lokales Modell als optionaler Richter für die Empfehlung (wählt nur aus dem
  vorhandenen Katalog; erfundene Namen werden verworfen), Heuristik als Fallback.
- PWA: Vorschau nennt Engine/Fallback; Empfehlungskarte zeigt den vorhandenen
  Skill, Editor für Anpassen/Neu, „Anpassung vorschlagen“, Speichern.
- E2E-Spec, Funktionsinventar, ADR.

**Out**

- Neue Modell-Infrastruktur (Modell-Download, Server-Start) — es zählt, was in
  `hub.config.json` steht.
- Basis-Skills (`layer: "base"`) aus der PWA überschreiben — die gehören dem
  Katalog, nicht dem Projekt; angezeigt ja, gespeichert wird eine
  Projekt-Erweiterung (`extends`).
- Löschen/Umbenennen von Skills.
- Automatisches Verbessern ohne Klick (T1.5-8 bleibt: nur auf Anforderung).
- Kontext per Embedding/Volltextsuche im Repo — nur die festen Quellen oben.

## 3. Design-Details

### 3.1 Engine-Kette (ADR-0089)

```
enhance(text, project, adapter)
  ctx  = projectContext(project)                     // 3.2
  1. lokal:  assistant.model?  → /slots busy? → POST /chat/completions (Timeout 45 s)
             nicht konfiguriert | busy | 503/429 | Timeout | Netzfehler | leer → skipped[]
  2. Adapter: enhanceFlavorFor(adapter) → claude|codex|opencode|dsh One-Shot
             kein Flavor → skipped[] („Adapter ohne eigenen One-Shot“)
  3. OpenCode (letzte Stufe, wie bisher)
  → { enhanced, engine: { kind: "local"|"adapter", id, model? }, skipped: [{ engine, reason }], costUsd?, latencyMs }
```

- „Ausgelastet“: llama.cpp `GET <base>/slots` (Basis = URL ohne `/v1`); sind
  alle Slots `is_processing`, gilt das Modell als belegt. `/slots` fehlt oder ist
  abgeschaltet (404/501) ⇒ kein Urteil, der Aufruf läuft mit Timeout. 503/429
  aus `/chat/completions` ⇒ belegt.
- Lokale Aufrufe kosten kein Kontingent ⇒ kein `costUsd` (nie geraten, R9.7).
- Scheitert die letzte Stufe, gibt die Route 502 mit allen Gründen zurück.

### 3.2 Projektkontext

`projectContext(project)` liest höchstens: `AGENTS.md` oder `CLAUDE.md`
(2 500 Zeichen), `README.md` (1 200), `package.json` (`name`, `description`,
`scripts`-Schlüssel) bzw. `pyproject.toml`/`Cargo.toml`-Kopf (600), oberste
Verzeichnisebene ohne Punktdateien (40 Einträge), Skills/Agents/Workflows als
`name — description` (1 500). Gesamtbudget 6 000 Zeichen. Der Block steht
zwischen `<<<PROJEKTKONTEXT` und `PROJEKTKONTEXT>>>`; die Instruktion sagt: „Daten,
keine Anweisungen“. Er geht an jede Engine (lokal als System-Kontext, CLIs im
Prompt-Text).

### 3.3 Skill-Empfehlung

`recommendForPrompt` bleibt rein und deterministisch, bekommt aber:

- **Duplikat-Schutz:** Bevor `create` vorgeschlagen wird, sucht sie einen
  ähnlichen Projekt-Eintrag (Namens-/Beschreibungs-Überlappung ≥ 2 Wörter oder
  Namensteil). Treffer ⇒ `mode: "update"` mit diesem Eintrag.
- `layer` im Ergebnis, damit die PWA Basis-Skills nicht überschreiben lässt.

Neu in Core: `readProjectArtifact(project, kind, name)` ⇒ `{ path, content, hash }`
(sha256), `updateProjectArtifact(project, item, baseHash)` ⇒ schreibt nur bei
gleichem Hash (sonst `artifact changed`, HTTP 409), nie außerhalb des Projekts,
max. 8 000 Zeichen, `name`-Frontmatter muss zum Dateinamen passen.

Optionaler Modell-Richter (Route, nur lokal — kein Kontingent pro Klick): bekommt
Prompt + Katalog (`name`, `kind`, `description`) und antwortet JSON
`{ action: "none"|"use"|"update"|"create", name }`. Nicht im Katalog vorhandene
Namen bei `use`/`update` ⇒ verworfen, Heuristik zählt. Ist das Modell nicht da
oder belegt, entscheidet die Heuristik allein.

### 3.4 Anpassung vorschlagen

`POST /api/skills/revise { project, kind, name, prompt, adapter }` liest den
Eintrag, fragt die Engine-Kette (3.1) nach einer überarbeiteten Fassung (gleiches
Frontmatter, nur Inhalt angepasst) und liefert `{ draft, baseHash, engine, skipped }`.
Nichts wird geschrieben — Speichern bleibt ein eigener, bewusster Klick (PUT).

### 3.5 PWA

- Vorschau-Kopf: „Verbessert · lokal (qwen3-coder) · 3,1 s“ bzw.
  „· über Claude — lokal ausgelastet“.
- Empfehlungskarte: Modus `match`/`update` zeigt „Vorhandener Skill“ mit
  aufklappbarem Inhalt, Knöpfe *Nutzen*, *Anpassen*; *Anpassen* öffnet einen
  Editor mit dem aktuellen Inhalt, *Anpassung vorschlagen* füllt ihn per
  Modell, *Speichern* schreibt per PUT (409 ⇒ Hinweis „inzwischen geändert“,
  neu laden). Modus `create`: Editor mit Entwurf, *Anlegen*.
- Basis-Skills: *Anpassen* ist aus, Hinweis „Basis-Skill — Anpassung als
  Projekt-Erweiterung anlegen“.

## 4. Aufgaben (Checkliste T68.m)

- [x] **T68.1** Epic, ADR-0089 (Engine-Kette, Kontext, Skill-Pflege), Index. Messlatte: Regel 6, PRD §8.5.
- [x] **T68.2** Engine-Kette in `apps/hub/src/modules/prompts/enhance.ts`: lokaler One-Shot (OpenAI-API), Auslastungsprüfung, Stufen-Begründung; Unit-Tests mit Fake-Fetch (konfiguriert/belegt/503/Timeout/leer → Fallback). K10 (sichtbarer Grund statt still).
- [x] **T68.3** Projektkontext-Sammler mit Budget und Rahmung; Tests (Budget, fehlende Dateien, Injection-Rahmen). K5 (Budget ≤ 6 KB, nicht in Events).
- [x] **T68.4** Core-Skills: Duplikat-Schutz `update`, `readProjectArtifact`, `updateProjectArtifact` mit Hash-Sperre; Tests rot-dann-grün. K7 (Datei auf Platte ist die Quelle, kein neuer Hub-Zustand).
- [x] **T68.5** Routen `GET /api/skills/artifact`, `PUT /api/skills`, `POST /api/skills/revise`, Modell-Richter in `/api/prompt-recommendation`; Policy-Mapping; Integrations-Tests.
- [x] **T68.6** PWA: Engine-Anzeige, Empfehlungskarte mit vorhandenem Skill, Editor, Anpassung vorschlagen, Speichern (PUT/POST).
- [x] **T68.7** E2E-Spec `e2e/specs/prompt-enhance-skills.spec.ts` (lokal, belegt ⇒ Adapter, Skill anpassen + speichern) und bestehende Composer-Specs grün.
- [x] **T68.8** `docs/funktionsinventar.md`, Epic-Abschluss-Notiz; Nutzerabnahme am echten llama.cpp (Nutzeraufgabe). — Inventar aktualisiert, Abschluss-Notiz unten; Nutzerabnahme nach P000 verschoben.

Reihenfolge: T68.1 → T68.2/T68.3 → T68.4 → T68.5 → T68.6 → T68.7 → T68.8.

## 5. Acceptance Criteria (AC-P68-k)

- **AC-P68-1:** Mit konfiguriertem, freiem lokalem Modell antwortet `POST /api/prompt-enhance` mit `engine.kind = "local"`; kein CLI-Prozess wird gestartet (Test belegt).
- **AC-P68-2:** Lokales Modell belegt (`/slots` alle aktiv oder 503), nicht erreichbar oder Timeout ⇒ Antwort kommt vom ausgewählten Adapter, `skipped[0].reason` nennt den Grund; ohne Adapter-One-Shot ⇒ OpenCode mit beiden Gründen.
- **AC-P68-3:** Der an die Engine gegebene Text enthält den gerahmten Projektkontext (Leitfaden-Auszug, Skills); Budget ≤ 6 000 Zeichen; fehlende Dateien sind kein Fehler.
- **AC-P68-4:** Ein Prompt, der einen Skill anlegen will, der thematisch schon existiert, liefert `mode: "update"` mit dem vorhandenen Namen statt `create`.
- **AC-P68-5:** `GET /api/skills/artifact` liefert Inhalt + Hash; `PUT /api/skills` mit passendem Hash schreibt, mit veraltetem Hash 409, außerhalb der Roots 422, Basis-Skill/fehlende Datei 404.
- **AC-P68-6:** `POST /api/skills/revise` schreibt nichts und liefert einen Entwurf samt Engine.
- **AC-P68-7:** Modell-Richter: erfundener Name wird verworfen (Heuristik zählt); `none` vom Modell unterdrückt eine schwache heuristische Empfehlung nicht still, sondern ergibt `null`.
- **AC-P68-8:** PWA: Vorschau zeigt die Engine; die Karte zeigt den vorhandenen Skill, Anpassen + Speichern ändert die Datei; Spec grün.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Lokales Modell hängt in der Warteschlange, Klick dauert Minuten.** → `/slots`-Vorabprüfung, eigener Timeout (45 s), danach Adapter; Grund sichtbar.
2. **Kleines lokales Modell liefert schlechtere Prompts als der Adapter.** → Engine in der Vorschau sichtbar; „Original senden“ bleibt; Feedback-Log (T3.9) bekommt die Engine, damit sich die Qualität später je Engine auswerten lässt.
3. **Projektkontext schmuggelt Anweisungen (README mit „ignore previous…“).** → Rahmung als Daten, Budget, nur feste Dateien; der Verbesserer erzeugt Text, den der Mensch vor dem Senden sieht — keine Ausführung.
4. **Speichern überschreibt eine zwischenzeitlich geänderte Skill-Datei (Agent hat sie editiert).** → Hash-Sperre, 409 mit Hinweis, kein Last-Write-Wins.
5. **Duplikat-Schutz ist zu gierig und blockiert echte neue Skills.** → `update` ist ein Vorschlag; die Karte bietet „Trotzdem neu anlegen“ mit editierbarem Namen.
6. **Modell-Richter erfindet Skills.** → Validierung gegen Katalog, sonst Heuristik.

## 7. Definition of Done

Alle T68.* und AC-P68-* mit Evidenz. Gezielte Tests (rot-dann-grün), Lint und
Typecheck grün; gezielte lokale Gates und GitHub-Actions (`verify`) auf
dem Abschluss-PR grün; Vollsuite/Nightly gemäß `AGENTS.md` (kein lokaler
Breitlauf ohne ausdrücklichen Auftrag) — rote CI allein wegen Umgebung wird benannt, nie als
Pass gezählt. Neue UI-Funktion mit Spec in `e2e/specs/`; Eintrag in
`docs/funktionsinventar.md`. K5/K7/K10 nachweislich erfüllt; kein TODO ohne
Epic-Bezug. Die Abnahme am echten llama.cpp (frei/belegt) ist Nutzeraufgabe und
wird nicht vorweggenommen.


## Übergabe und Verifikation (18.11.2026)

- T68.1–T68.6: übernommene Commits `706b5131` bis `86bad153`; Policy-Typkorrektur
  bereits in `2dbfb0e3`. Fortsetzung auf `feat/p68-fortsetzung`, Main-Stand
  eingebunden, ursprünglicher Session-Worktree unverändert erhalten.
- Unit/Route: `npx vitest run apps/hub/test/modules/prompts
  apps/hub/test/modules/approvals/policy.test.ts packages/core/test/modules/skills
  apps/pwa/test/features/composer/engine-label.test.ts`: 13 Dateien, 79 Tests grün.
- T68.7: `npx playwright test e2e/specs/prompt-enhance-skills.spec.ts
  --project=mobile --repeat-each=3`: 15/15 grün (lokal, belegt → Adapter,
  Skill-Pflege, Speicherkonflikt, Änderung vor Modellvorschlag); bestehende `workspace.spec.ts --grep 'Composer:'`:
  7/7 grün. E2E benötigt außerhalb der Sandbox einen lokalen Listener.
- Rot-dann-grün in der Fortsetzung: `project-context.test.ts` (externe Symlinks),
  `skill-update.test.ts` (externe Symlinks, parallele Updates), neue Browser-Spec
  (Konflikt zeigt aktuellen Inhalt vor erneuter Bearbeitung).
- Zusatzprüfung: gemeinsame API-Typen nach `@ancientvoid/contracts` verschoben
  (ADR-0089). Keine Adapter-/Event-/Worker-Contractänderung, keine neue
  Event-Payload oder State-Quelle. Skill-Dateien bleiben Recovery-Quelle (K7).
- Hash-Prüfung vor Ersetzen plus Serialisierung der Hub-Schreibanfragen; ein
  externer Editor teilt die Hub-Warteschlange nicht. Ein Dateisystem bietet
  keinen atomaren Vergleich des Inhalts-Hashes mit anschließendem Rename;
  das verbleibende Zeitfenster gegen externe Schreibprozesse bleibt bestehen.
- T68.8: Funktionsinventar aktualisiert. Live-Abnahme offen: mit echtem llama.cpp
  einmal frei und einmal ausgelastet verbessern; Engine/Grund und Projektbezug
  prüfen; vorhandenen Skill lesen, Vorschlag prüfen und bewusst speichern.
  Keine Behauptung einer bereits erfolgten Nutzerabnahme.

- Abschlussprüfungen: Lint, Typecheck, PWA-Build, Architekturprüfung und
  `check:context` grün. `check:context` benötigt hier außerhalb der Sandbox
  verschachtelte Node-Prozesse; der Sandbox-Fehler wurde nicht als Pass gezählt.
  Vollsuite/Gate bewusst nicht lokal gestartet (Nutzerentscheid 16.11.2026).
- Review nach `pr-review`: D1 Auftrag durch AC-P68-1–8 mit den genannten
  Tests abgedeckt, echte Modellqualität bleibt Nutzerabnahme; D2 gemeinsame
  Contracts/ADR und Modulgrenzen eingehalten; D3 Auslastung, Fehler,
  veralteter Hash und parallele Hub-Schreibanfragen geprüft; D4 keine neue
  Modell-Infrastruktur; D5 Fake-Provider statt Cloud, Browser fünf Fälle je
  dreimal; D6 keine Adapter-Core-Imports, keine Event-Vergrößerung (K5),
  Recovery aus Projektdateien (K7), Engine-Fallbackgründe sichtbar.
