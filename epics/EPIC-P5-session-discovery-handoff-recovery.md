# EPIC-P5 — Session-Discovery, PC↔Handy-Handoff und Recovery

**Status:** teilweise — Inventar und read-only Scan sind im Code (ADR-0012). AC-P5-2 bleibt blockiert, solange kein echter PC↔Handy↔Provider-Lauf vorliegt. · **Phase:** P5 · **Dauer:** 2–4 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P4.5 grün; P4-externe Restpunkte (T4.3/T4.4/T4.5/T4.8/T4.11) bleiben bewusst offen (Ausnahme P4.5, siehe Index).

Planungsauftrag vom 2026-09-21; kein Umsetzungsstart und keine Behauptung eines
grünen Vorgänger-Gates. Scope, Evidenz und bestehende Restarbeiten:
[Audit](../docs/remote-control-audit-2026-09-21.md), [Index](README.md).

## 1. Ziel

Jede verpflichtende Coding-Session wird gefunden und mit derselben Provider-Identität
auf PC und Handy fortgeführt. Ein Hub-Neustart erhält sowohl Verlauf als auch
Bedienbarkeit. Bezug: PRD G1/G4, K2/K5/K7/K8/K9/K10, Audit G01–G04/G10/G17.

## 2. Scope (In / Out)

**In:** Inventar, Discovery, Session-Identität, persistente Resume-Daten, echte
Übernahme, Writer-Konflikte, Reconnect und Worker-Recovery zunächst auf einem Host.
**Out:** Multi-Host-Aggregation (P6), neue Provider-Tool-Gates (P7), beliebige GUI-
Automation (P11). Ein Kontext-Fork erfüllt niemals die Handoff-Abnahme.

## 3. Design-Details

Contracts/ADR zuerst: externe Identität = Host + Provider + native Session-ID;
Hub-ID bleibt stabil. `observed`, `managed`, `controllable` werden getrennt
modelliert. Discovery liefert mehrere Sessions pro Projekt, auch abgeschlossene
und wartende, mit Cursor/Pagination und explizitem Alter der Beobachtung.
Provider-IDs, Modell, Skill, CWD/Worktree, Log-Offset und Resume-Version brauchen
JSONL-/Snapshot-Recovery. Auth-Credentials gehören nicht in diese Checkpoints.

Zwei echte Pfade prüfen: native Session-API/Resume oder ein von Beginn an
verwalteter interaktiver Worker. Externe Prozesse dürfen nicht blind mit einem
zweiten Writer versehen werden. Eine erneuerte Lease/Revision schützt Desktop-
und Handy-Eingaben; jede Anfrage erhält eine idempotente ID. Bei fremdem Writer
sichtbar nur lesen, übernehmen oder warten. Capability-Grenzen sind UI-Daten.

tmux-Attach nur für tatsächlich existierende Worker anzeigen; ein JSON-Stream
ist keine interaktive Provider-Konsole. Native Desktop-App, IDE und CLI als
verschiedene Harness-Ziele führen. Fehlende Provider-Schnittstelle ist ein
Blocker mit Evidenz, keine implizite Genehmigung für DB-Schreibzugriffe.

## 4. Aufgaben

- [x] **T5.1 — Pflichtinventar und ADR.** Zielmatrix aus Audit §4 vervollständigen; je Harness unterstützte Version und native Discovery-/Resume-Schnittstelle mit tatsächlichen Probes belegen. Capability-Contract erweitern; WIP Claude-Clip übernehmen erst nach eigener grüner MR. PRD G1; K7/K9. Stand 2026-09-22: `GET /api/inventory` probed die Katalog-Binaries und lässt die Zelle ehrlich (`verified` nur für die belegten Read-only-Layouts, Resume der CLIs `implemented-unverified`). Claude-Clip war bereits in !40 gemerged.
- [x] **T5.2 — Persistente Session-Identität.** Provider-Resume-Daten und Lifecycle-Übergänge in Contracts, JSONL und Snapshot ablegen; bestehende Records migrieren; unbekannte Resume-Version sichtbar ablehnen. K5/K7.
- [x] **T5.3 — Discovery und Deduplizierung.** Alle Sessions konfigurierter Provider-Quellen erfassen, nach Host/Provider/native ID deduplizieren; Subagent-Elternbezug vorbereiten; CLI/IDE-Quellen read-only scannen. K5/K8/K9. Stand 2026-09-22: Claude-`*.jsonl` und Cursor-`composerHeaders` werden read-only gemischt; `parentSessionId` für Subagent-Dateien und eine vorhandene Parent-Spalte. Codex/OpenCode/Copilot/Aider ohne belegtes Dateilayout bleiben `missing`.
- [ ] **T5.4 — Echte Übernahme.** Für jeden verpflichtenden Harness PC→Handy→PC implementieren; laufender Turn und Turn-Pause getrennt; gleicher Kontext/Worktree. Native Resume bevorzugen; Fork/monitor-only korrekt beschriften. K2/K7.
- [ ] **T5.5 — Writer-Koordination und Clients.** Lease/Revision, Input-ID, sichere Retry-Semantik, Native-Open-/Copy-Link und Web-Deep-Link verbinden; reale Pane-Verfügbarkeit; kein doppeltes Absenden bei zwei Clients. K7/K10.
- [ ] **T5.6 — Recovery und Ausfallbeweis.** recoverAll darf ohne nutzbares Handle nicht kontrollierbare Wiederherstellung behaupten; adoptierte Worker nicht als Orphans töten; Adapter-Testkit-Lücke BUG-0004 schließen/verifizieren; Crash-Tests gegen echte Worker inkl. Log-Tail und ausstehender Eingabe. K2/K5/K7/K8.

## 5. Acceptance Criteria

- **AC-P5-1:** Auf einem Host werden 20 bekannte Sessions, darunter zwei pro Projekt und externe/Hub-Sessions, innerhalb 10 s vollständig und ohne Duplikate angezeigt; unbekanntes Format innerhalb K9 sichtbar.
- **AC-P5-2:** Je verpflichtendem Harness drei PC→Handy→PC-Zyklen in den Zuständen laufend, zwischen Turns und wartend: gleiche native ID, CWD/Worktree und überprüfbarer Kontext; keine doppelte Aktion. Nicht unterstützte Zellen bleiben blockiert.
- **AC-P5-3 (K7):** Nach hartem Hub-Kill: exakte bestätigte Event-Sequenz und Kontrollmetadaten in < 3 s wiederhergestellt; überlebender Worker erneut steuerbar. Provider-Netzzeit separat; keine verlorenen Worker durch Reaping.
- **AC-P5-4:** Zwei Clients senden mit gleicher Input-ID beziehungsweise konkurrierenden Revisionen: einmalige Ausführung oder sichtbarer Konflikt; Disconnect und Lease-Ablauf verursachen keinen zweiten Turn.
- **AC-P5-5:** Ein Deep-Link öffnet dieselbe Session nach Reload; im Idle ohne Pane gibt es keinen fälschlich aktiven tmux-Attach-Knopf. K5-/K8-Gates bleiben grün.

## 6. Premortem

1. **Gleicher Titel, neue Provider-Session:** native ID und Kontext-Marker im Handoff-Test assertieren; Fork separat kennzeichnen.
2. **Desktop und Handy schreiben gleichzeitig:** Writer-Lease und atomare Revision, sichtbare Übergabe statt Last-write-wins.
3. **Recovery räumt lebende Worker weg:** Adoption vor Reaping, Eigentumsnachweis; kill-9-Prüfung je Provider.
4. **Provider-Dateiformat ändert sich:** versionierter read-only Decoder, K9-Alarm, keine destruktive Reparatur der Fremddaten.

## 7. Definition of Done

Alle ACs mit benannten Tests/Messläufen belegt, Vorgänger-Gate geschlossen;
`npm test`, `npm run lint`, `npm run typecheck` grün, PWA-Build bei UI-Änderungen,
Last-/Gerätetests gemäß AC. Contracts first; Adapter-/Event-/Worker-Änderungen
mit ADR. K5-Blob-Grenze, K7-Recovery, AdapterContext-Isolation und Fail-loud
nachgewiesen. Jede Funktion in Config, API/CLI und passender UI tatsächlich
registriert/erreichbar; Capability-/Support-Matrix ehrlich aktualisiert.
Premortem im Abschlussreview gegenprüfen, offene Pflicht-ACs blockieren Abschluss.
Commit/MR gemäß Repo-Workflow; kein lokaler Merge nach main.

## 8. Stand dieses Schnitts (2026-09-22)

Umgesetzt und getestet, ohne die offenen ACs grün zu färben:

- ADR-0011 und ADR-0012. `GET /api/inventory` plus `hubctl inventory`.
- `nativeDiscovery` / `nativeResume` an den Adapter-Capabilities.
- Read-only Scan: Claude-Transcripts (inkl. `subagents/` → `parentSessionId`) und Cursor-`composerHeaders`, gemischt in `GET /api/discovery`.
- Unbekanntes Datei- oder Schema-Format bleibt `unsupported-format`.
- Dedup, Lease, ehrliches Recovery, Hash-Route, `attachCmd`, BUG-0004 wie im Schnitt davor.

Offen, blockiert den Epic-Abschluss:

- **AC-P5-2:** drei echte PC→Handy→PC-Zyklen je Pflicht-Harness.
- **T5.4:** keine native Übernahme.
- **T5.6:** kein Kill-9 gegen echte Provider-Worker.
- Resume-Zellen von Claude/Codex/OpenCode/Copilot bleiben `implemented-unverified`.

## 9. UI nach dem ersten Claude-Lauf (2026-09-22)

Der Lauf auf `tetris-reloaded` war steuerbar. Drei Anpassungen danach:

- Chat zeigt bei `assistant`/`user` den vollen `payload.text`. Die Zusammenfassung ist auf 200 Zeichen gekappt; die Abschlussnachricht mit der Browser-URL (1611 Zeichen, Event 411) war dadurch im Chat abgeschnitten, im Event aber vollständig. Die kurzen Zeilen `#64`, `#75`, `#82` („Jetzt das Neon-Styling:“ und die beiden folgenden Vorspanne) sind vollständig; der Rest des Schritts liegt als `tool_use`/`tool_result` im Verlauf.
- Voice, Verbessern, Senden und Stop stehen in einer Zeile.
- `archived` (Migration 8, `POST /api/sessions/:id/archive`) nimmt einen Lauf aus der Übersicht. Der Chip „Archiv“ holt ihn zurück. Der Lauf und seine Events bleiben.
- Nach „Verbessern“ schlägt der Hub einen Skill, Agent oder Workflow aus dem Projekt vor. Passt keiner, kommt ein Entwurf. Verwerfen lässt ihn liegen, Nutzen nimmt ihn für diesen Prompt, Speichern merkt ihn als Standard und legt die Datei an, wenn sie neu ist.
