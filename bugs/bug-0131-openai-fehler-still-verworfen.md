---
id: BUG-0131
slug: openai-fehler-still-verworfen
status: done
severity: S2
area: adapters
instance: dev
commit: "9d97e19"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/52"
epic: "EPIC-P3 / EPIC-P35"
created: 2026-11-11
reporter: "Codex — Setup-/Modellanbindungs-Audit"
---

# BUG-0131 — OpenAI-Beispieladapter verschweigt Stream- und Folgepromptfehler

## Gesehen

Eine ungültige SSE-Datenzeile wird still ignoriert; ein Netzwerkfehler beim Folgeprompt liefert `ok: true`, aber kein error-Event.

## Erwartet

AC: Parse- und Transportfehler als begrenzte Fehlerereignisse, auch bei Folgeprompts; Abbruch von echtem Fehler unterscheiden; unbekannte Formate sichtbar. Fixture-Tests gegen AdapterContext und echte Hub-Integration hinzufügen. K5/K9, Fail loud. Zusammen mit Lifecycle-Lücken aus Audit planen, ohne ungeprüfte Contract-Erweiterung.

## Repro und Umgebung

Isolierter AdapterContext-Repro am 11.11.2026: `fetch` liefert `data: INVALID\n\ndata: [DONE]\n\n`; `start({prompt:"test"}, ctx)` erzeugt nur system-Ereignisse. Anschließend fetch durch eine async-Funktion ersetzen, die Error("synthetic offline") wirft; `steer(handle,{kind:"prompt",text:"next"},ctx)` bestätigt ok, nach setImmediate existiert nur das querying-system-Event. Kein PWA/hubctl-Repro; Adapter-Grenze bestätigt, kein externer Request.

Umgebung: isolierter Linux-Worktree, Node v26.7.0, keine produktiven Dienste geändert.
Häufigkeit: deterministisch im genannten Repro; reine Codebefunde sind ausdrücklich markiert.

## Logs

Ergebnis des Repros vom 11.11.2026 siehe oben; keine Tokens oder Schlüssel aufgezeichnet.

## Eingrenzung und Abgleich

`examples/adapters/openai-compat/adapter.ts`: JSON-catch behauptet partial line, obwohl bereits vollständige Zeilen getrennt wurden; steer nutzt `.catch(() => undefined)`. Kein Duplikat von BUG-0102 (maki-Fehlerklassifikation).

## Tests / Handoff

AC: Parse- und Transportfehler als begrenzte Fehlerereignisse, auch bei Folgeprompts; Abbruch von echtem Fehler unterscheiden; unbekannte Formate sichtbar. Fixture-Tests gegen AdapterContext und echte Hub-Integration hinzufügen. K5/K9, Fail loud. Zusammen mit Lifecycle-Lücken aus Audit planen, ohne ungeprüfte Contract-Erweiterung.

- [x] Im Bug-Index erfasst.
- [x] GitLab-Tracker verlinkt.
- [x] Fix und Verifikation.

## Fix

`examples/adapters/openai-compat/adapter.ts`: unlesbare SSE-Datenzeilen und Fehlerobjekte des Endpoints werden zu begrenzten `error`-Events (Auszug ≤ 200 bzw. 300 Zeichen, K5), der Strom läuft weiter. `start` und `steer` teilen einen Fehlerhandler: Abbruch durch die Session ergibt `system` „completion aborted“, jeder andere Fehler ein `error`-Event — das stille `.catch(() => undefined)` beim Folgeprompt ist weg.

Tests: `apps/hub/test/examples/openai-compat-adapter.test.ts` (Fake-`AdapterContext` aus dem Testkit, gemocktes `fetch`) — ohne Fix 4/4 rot, mit Fix 4/4 grün. Die Vertragsprüfung des Testkits fällt für das Beispiel schon auf main durch (kein Event ohne Startprompt, `status()` nach `stop()` weiter healthy) — eigener Defekt BUG-0144, dort auch die Hub-Integration.
