# EPIC-P5 — Session-Discovery, PC↔Handy-Handoff und Recovery

**Status:** bereit zur Abnahme — alle Aufgaben umgesetzt und im E2E-Gate (Stand §12). Offen ist nur der manuelle Lauf AC-P5-2 mit echten Providern und Geräten (Checkliste §12.4); danach Retro und Abschluss. · **Phase:** P5 · **Dauer:** 2–4 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P4.5 grün; P4-externe Restpunkte (T4.3/T4.4/T4.5/T4.8/T4.11) bleiben bewusst offen (Ausnahme P4.5, siehe Index).

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
- [x] **T5.4 — Echte Übernahme.** Für jeden verpflichtenden Harness PC→Handy→PC implementieren; laufender Turn und Turn-Pause getrennt; gleicher Kontext/Worktree. Native Resume bevorzugen; Fork/monitor-only korrekt beschriften. K2/K7. Stand 2026-09-23: Zug-Status `working`/`idle` aus dem Worker-Lebenszyklus (ADR-0013), Weiter/Übernahme mit derselben nativen ID (E2E `handoff.spec.ts`). Abnahme mit echten CLIs: §12.4.
- [x] **T5.5 — Writer-Koordination und Clients.** Lease/Revision, Input-ID, sichere Retry-Semantik, Native-Open-/Copy-Link und Web-Deep-Link verbinden; reale Pane-Verfügbarkeit; kein doppeltes Absenden bei zwei Clients. K7/K10. Stand 2026-09-23: Lease, Revision, Input-ID, Retry, Übernahme, Deep-Link, Copy-Attach und Pane-Prüfung erledigt und im E2E-Gate. Native-Open-Befehl je CLI plus Web-Link im Bericht (ADR-0012 Nachtrag).
- [x] **T5.6 — Recovery und Ausfallbeweis.** recoverAll darf ohne nutzbares Handle nicht kontrollierbare Wiederherstellung behaupten; adoptierte Worker nicht als Orphans töten; Adapter-Testkit-Lücke BUG-0004 schließen/verifizieren; Crash-Tests gegen echte Worker inkl. Log-Tail und ausstehender Eingabe. K2/K5/K7/K8. Stand 2026-09-23: tmux-Worker werden übernommen und ab der letzten ausgelieferten Zeile weitergelesen, `recover()` in claude/codex/opencode/copilot (ADR-0014); Reaping nur eigener Worker (BUG-0019); Kill -9 gegen den echten OpenCode-Adapter im Messlauf.

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

## 10. Skill-Baum (2026-09-22, Nutzerauftrag)

Die Empfehlung hat bisher ein ganzes Prompt in eine neue Datei kopiert. Sinnvoller ist ein kleiner Baum: allgemeine Formen liegen dort, wo alle Projekte liegen, und ein Projekt-Skill erweitert genau eine davon. Das ist Vererbung, kein freies Netz. Offen bleibt, den Baum zur Laufzeit in den Adapter-Aufruf zu falten — OpenCode ignoriert eine Skill-Auswahl heute noch sichtbar.

- [x] **T5.7 — Base-Katalog.** Unter der Projektwurzel `.claude/skills/` liegen `task`, `investigate`, `change`, `review`. `task` ist die Form. Die anderen nennen `extends: task`. Vorhandene Dateien werden nicht überschrieben.
- [x] **T5.8 — Empfehlung erweitert statt zu kopieren.** Trifft ein Projekt-Skill, bleibt es ein Treffer. Trifft nur ein Base-Skill oder keiner, legt der Entwurf einen Projekt-Skill an, der den passenden Base-Skill erweitert, und enthält nur die Abweichung.
- [x] **T5.9 — Modell und Stillstand sichtbar.** Die Session zeigt das Modell (`zai-coding-plan/glm-5.3`, belegt am Lauf vom 2026-09-22). Ein Schritt, der nur denkt und am Längenlimit endet, erscheint im Chat, nicht nur im Verlauf.
- [x] **T5.10 — Kette ausführen.** Ein gewählter Projekt-Skill lädt die `extends`-Kette (Vorfahren zuerst, Zyklen abgeschnitten) und legt den Text in den Prompt. Das Event `session.skill_chain` trägt nur die Namen. Ein Skill ohne auflösbare Datei bleibt sichtbar ignoriert. Steer lädt die Kette erneut.

## 11. Stand 2026-09-23 — Analyse, Bugfixes, E2E-Gate, Messläufe

### Behoben (je mit Test, der ohne Fix rot war)

| Bug | Wirkung |
|---|---|
| [BUG-0016](../bugs/bug-0016-reopen-ignores-input-id.md) | Wiederholte Eingabe startete eine gestoppte Session zweimal |
| [BUG-0017](../bugs/bug-0017-concurrent-reopen-double-run.md) | Zwei Geräte starteten zwei Läufe; die PWA schickte keine Input-/Client-ID |
| [BUG-0018](../bugs/bug-0018-recovery-replays-stopped-sessions.md) | Hub-Start las jede gestoppte Session komplett ein (K7 wuchs mit dem Verlauf) |
| [BUG-0019](../bugs/bug-0019-tmux-reap-kills-foreign-workers.md) | `npm test` und jeder zweite Hub töteten die tmux-Worker des laufenden Hubs |
| [BUG-0020](../bugs/bug-0020-diff-hides-new-files.md) | Diff und Bericht zeigten keine neu angelegten Dateien |
| [BUG-0021](../bugs/bug-0021-skill-chain-misses-base-catalog.md) | Skill-Kette hing davon ab, ob vorher die Skill-Liste offen war |

Dazu: `workerRunner` aus der Konfiguration wirkt jetzt (war toter Schalter),
T5.5 „Übernehmen“ (ADR-0011 Nachtrag), gestoppte Sessions laden beim Öffnen.

### E2E-Gate

[`docs/testing-e2e.md`](../docs/testing-e2e.md): 58 Testläufe, 48 im
Mobile-Projekt (Pixel 7) und 10 im Desktop-Projekt, jeder gegen einen eigenen
echten Hub-Prozess. 53 laufen grün, 3 sind `fixme` mit Task-/Bug-ID, die 2
Handoff-Tests laufen nur im Desktop-Projekt. Blockierender Pipeline-Job `e2e`, lokal `npm run gate`. Neue
Regel im [Epic-Index](README.md): kein Epic-Abschluss ohne grünes Gate.

### Messläufe

[`docs/messlauf/2026-09-23-p5-discovery-recovery.md`](../docs/messlauf/2026-09-23-p5-discovery-recovery.md):
Discovery 21 Einträge ohne Duplikat, kalt 420 ms (Median). Recovery nach
`kill -9` 37 ms (Median `recovery_ms`), 0 Abweichungen, alle Sessions wieder
steuerbar — für den Dummy-Adapter.

### Acceptance Criteria

| AC | Stand | Beleg / was fehlt |
|---|---|---|
| AC-P5-1 | API grün, UI offen | Messlauf grün. Die PWA hat keine Discovery-Ansicht. |
| AC-P5-2 | automatisiert grün, manuell offen | `handoff.spec.ts` (gleiche native ID und CWD, kein Doppelzug). Drei echte Zyklen je Pflicht-Harness stehen aus. Zug-Status fehlt (siehe T5.4). |
| AC-P5-3 | Dummy grün, echte Provider rot | Messlauf und `recovery.spec.ts`. Kein `recover()` in claude/codex/opencode/copilot; deren laufender Zug ist nach dem Kill nicht steuerbar, der Worker wird geräumt. |
| AC-P5-4 | grün | `steer-reopen.test.ts`, `steer-lease.test.ts`, E2E Doppeltipp und zwei Geräte |
| AC-P5-5 | grün | `deeplink.spec.ts` (Reload, Attach nur mit lebendem tmux-Worker) |

### Offen vor dem Abschluss

1. **T5.4 Zug-Status.** Kein Codepfad setzt `idle`. Eine OpenCode- oder
   Claude-Session bleibt nach einem fertigen Zug `working`. Braucht ein
   Zugende-Signal im Adapter-Vertrag (ADR).
2. **T5.6 `recover()` für echte Provider** und Kill -9 gegen echte Worker.
3. **Discovery-Ansicht in der PWA** (AC-P5-1 „angezeigt“) samt E2E-Spec.
4. **Native-Open-Link** (T5.5-Rest).
5. **Manuelle Abnahme AC-P5-2** mit echten Providern und Geräten.
6. Kleinere Befunde: [BUG-0022](../bugs/bug-0022-reply-box-missing-after-offline-open.md),
   [BUG-0015](../bugs/bug-0015-offline-reload-token-gate.md) (K10, P8).

## 12. Stand 2026-09-23 (2) — bereit zur Abnahme

### Umgesetzt seit §11

| Punkt | Umsetzung | Beleg |
|---|---|---|
| T5.4 Zug-Status | Hub zählt Worker je Session: neuer Worker → `working`, letzter sauberer Exit → `idle` + `session.turn_end` | ADR-0013, `turn-state.test.ts`, E2E „der Status trennt …“ |
| T5.6 Recovery echter Provider | `WorkerRunner.adopt`, `ctx.adoptWorker`/`ctx.nativeSessionId`, `recover()` in 4 Adaptern | ADR-0014, Adapter-Tests, E2E `recovery.spec.ts`, Messlauf `recovery-provider` |
| AC-P5-1 Anzeige | Seite „Gefunden“ (Übersicht) + Harness-Inventar (Status) | E2E `discovery.spec.ts`: 20 Sessions binnen 10 s |
| T5.5 Native-Open | `openCmd` zwischen Zügen, Web-Link, beide kopierbar | ADR-0012 Nachtrag, `native-open.test.ts`, E2E `deeplink.spec.ts` |
| Bugs | BUG-0022 (Antwortfeld nach Offline-Öffnen), BUG-0023 (doppelte Events nach Resync), BUG-0024 (Link-Wechsel mischt Verläufe) | je Test rot ohne Fix |

### Acceptance Criteria

| AC | Stand | Beleg |
|---|---|---|
| AC-P5-1 | grün | Messlauf (API) und E2E (Oberfläche, 20 Sessions < 10 s, 0 Duplikate, unbekanntes Format sichtbar) |
| AC-P5-2 | automatisiert grün, **manuell offen** | `handoff.spec.ts` (live und nach Stop, gleiche native ID und CWD, kein Doppelzug); Checkliste §12.4 |
| AC-P5-3 | grün | Messlauf Dummy und OpenCode-Adapter unter tmux; E2E Übernahme eines laufenden Zugs |
| AC-P5-4 | grün | `steer-reopen.test.ts`, `steer-lease.test.ts`, E2E Doppeltipp, zwei Geräte, Übernahme |
| AC-P5-5 | grün | `deeplink.spec.ts`: Reload, Link-Wechsel, Attach nur mit lebendem Worker, kein Terminal-Befehl während eines Zugs |

### Bekannte Grenzen (kein Abschluss-Blocker)

- Cursor hat kein natives Resume, Aider keine Session-ID: beide Zellen
  bleiben `missing`/blockiert, wie AC-P5-2 es verlangt.
- ProcessRunner übernimmt keine laufenden Züge (nur tmux, Standard).
- E2E-`fixme`: Skill-Picker (braucht nachgebauten `claude`-CLI), BUG-0015
  Offline-Neuladen (K10, P8).
- Pipeline: GitLab-CI-Kontingent erschöpft (`ci_quota_exceeded`); der Job
  `e2e` ist noch nie in GitLab gelaufen. Lokal ist `npm run gate` grün.

### 12.4 Checkliste manueller Handtest (AC-P5-2)

Voraussetzung: echter Hub (`hub.config.json`, tmux), PC-Browser und Handy
per Tailscale, je Harness ein Test-Repo. Pro Harness **Claude Code, Codex,
OpenCode, Copilot CLI** drei Zyklen PC → Handy → PC:

| Zyklus | Ablauf | Prüfen |
|---|---|---|
| 1 laufend | am PC starten, während der Zug läuft am Handy öffnen, nach dem Zug am Handy weiterschreiben, am PC „Übernehmen“ | gleiche native ID im Bericht (`openCmd`), gleicher Worktree, keine doppelte Antwort |
| 2 zwischen Zügen | Status `idle` abwarten, Handy schreibt, PC schreibt | Status wechselt `working` → `idle`, Kontext des vorherigen Zugs ist bekannt (Rückfrage „was habe ich eben gesagt?“) |
| 3 wartend + Neustart | `requireStepApprovals: true`, Antwort am Handy → Freigabe offen, Hub neu starten (`kill -9`), Freigabe am PC geben | nach Neustart steuerbar, Zug läuft einmal, dieselbe Provider-Session |

Zusätzlich je Harness einmal: `openCmd` im Terminal am PC ausführen und
prüfen, dass die CLI dieselbe Unterhaltung zeigt.

Ergebnis je Zelle hier eintragen. Danach in `packages/core/src/inventory.ts`
die Resume-Zellen der geprüften CLIs auf `verified` setzen (mit Datum und
Beleg in `evidence`), Retro schreiben, P5 schließen.

