# EPIC-P54 — Hermes als wählbarer Orchestrator im Loop-Dropdown inkl. Ralph-Onboarding-Prompt

**Status:** Planungsentwurf · **Umsetzung:** gesperrt (wartet auf Nutzer-Review, beauftragt 2026-11-12) · **Phase:** P54
**Dauer:** 1–2 Agenten-Wochen (grobe Schätzung)
**Abhängigkeit:** P40 Gate grün (Run/Task/Dispatch-Modell steht); Loop-Dropdown/Session-UI aus P36/P50 stabil.

## 1. Ziel

Der Nutzer kann beim Anlegen einer neuen Session im Loop-Dropdown zusätzlich den **Orchestrator** wählen: `self` (bisheriges Verhalten, Default) oder `hermes`. Bei `hermes` ist verbindlich die **Ralph-Loop-Mechanik** zu nutzen. Ein neuer Hermes-User (frische Session ohne Ralph-Wissen) liest bei der **ersten Ausführung** einen im Repo abgelegten Onboarding-Prompt und integriert die Ralph-Loop-Mechanik selbstständig in seinen Ablauf, bevor er arbeite.

## 2. Scope (In / Out)

**In:** Orchestrator-Auswahl im Loop-/Session-Dropdown (PWA), serverseitige Validierung gegen `caps.orchestrators`, Ralph-Pflicht bei `hermes`, Onboarding-Prompt-Datei im Repo, Onboarding-Ablauf mit Nachweis, Absicherung bei fehlendem/veraltetem Prompt.
**Out:** Zweite konkurrierende Steuerung derselben Factory (P40-Regel bleibt), Worker-spawn-Worker-Rekursion, automatische Merge-/Destructive-Freigaben, neue AV-eigene Ralph-Implementierung (Hermes bringt Ralph mit, AV erzwingt nur dessen Nutzung).

## 3. Design-Details

### 3.1 Orchestrator-Auswahl im Loop-Dropdown

`packages/contracts/src/loops/loop.ts` hat bereits `orchestrator: z.string().min(1).max(40).optional()`; `registry.ts` validiert gegen `caps.orchestrators` (heute `self/hermes`, P40). Darauf aufbauen:

- Loop-Dropdown zeigt pro Loop die verfügbaren Orchestratoren (aus Capability-Matrix, nicht hartkodiert). `self` bleibt Default; Auswahl wird Bestandteil der Loop-Spec/Session-Anlage.
- `hermes` ist nur wählbar, wenn der Hermes-Adapter installiert und von der lokalen Probe (P31) bestätigt ist — grau hinterlegen statt Fehler nach dem Start.
- Auswahl wird im Run sichtbar geführt (PWA zeigt Orchestrator neben Harness/Provider; AC-P40-2-kompatibel).

### 3.2 Ralph-Pflicht bei Orchestrator `hermes`

- Bei `orchestrator: "hermes"` verlangt AV in jedem Dispatch-Kontextpaket den Hinweis, dass die **Ralph-Loop-Mechanik** verbindlich ist (kontinuierlicher autonomer Epic-Grind, Goal-Gates, Task-Updates über die etablierten exakten Kanäle, kein stiller Ausfall).
- AV prüft nicht die Semantik des Ralph-Verhaltens (das ist Hermes' Verantwortung), aber der Run-Report muss Ralph-Konformität bestätigen (siehe Onboarding-Prompt, Anhang). Ohne Bestätigung gilt der Dispatch als nicht konform → sichtbarer Vermerk, kein Auto-Retry.

### 3.3 Onboarding-Prompt im Repo

- Datei: `docs/hermes/orchestrator-onboarding.md` (Version + Checksum im Kopf; Änderungen nur über MR).
- Ablauf bei erster Ausführung mit `orchestrator: "hermes"`:
  1. Hermes erkennt an der Markierung im Kontextpaket, dass Onboarding für diese Hermes-Installation noch nicht bestätigt ist.
  2. Hermes liest `docs/hermes/orchestrator-onboarding.md` vollständig (Tool-Nutzung, kein Raten).
  3. Hermes integriert die Ralph-Loop-Mechanik in seinen eigenen Ablauf (Skills laden: `ralph-wiggum-loop`, `ralph-goal-gate-ops` sofern verfügbar) und quittiert das Onboarding mit Prompt-Version im Run-Report.
  4. Quitting wird pro Hermes-Installation (Instanz-ID/Profil) gespeichert; erneutes Onboarding nur bei Prompt-Versionswechsel.
- Fail-safe: Fehlt die Datei oder ist die Version nicht lesbar, wird der Run **abgelehnt** (harte Fehlermeldung), nicht blind gestartet. Kein Fallback auf nicht-Ralph-Betrieb.

### 3.4 Onboarding-Prompt (Entwurf, wird in T54.3 als Datei materialisiert)

> Du bist als Orchestrator für AncientVoid (AV) eingeteilt. Verbindliche Regeln:
> 1. Arbeite nach der **Ralph-Loop-Mechanik**: hole dir die nächste offene Task, arbeite sie vollständig ab, verifiziere das Ergebnis mit echtem Tool-Output, berichte, fahre mit der nächsten fort. Keine Untätigkeit, kein Warten auf Rückfragen außer an expliziten Gates.
> 2. Lade, sofern verfügbar, die Skills `ralph-wiggum-loop` und `ralph-goal-gate-ops` und befolge sie.
> 3. **Gates:** Irreversible Schritte (Merge, Delete, Formatierung, Produktionssysteme) sind menschliche Gates. Beantworte niemals ein Gate für dich selbst.
> 4. **Status-Updates** gehen ausschließlich über die etablierten exakten Kanäle (AV-Run-Report, zugewiesene Sinks). Vage oder fehlende Updates gelten als Fehlschlag.
> 5. **Verify-then-report:** Jede Behauptung über erledigte Arbeit braucht realen Nachweis (Test-Output, Datei-Pfad, ID). Niemals plausible Ausgaben erfinden.
> 6. Unknown costs bleiben unknown, nicht Null (P40-Regel).
> 7. Bestätige am Anfang jedes Runs: `ONBOARDED <prompt-version>` — sonst gilt der Run als nicht konform.

### 3.5 Datenmodell & UI

- Run erhält `orchestrator` und `onboarding_version` (nullable); PWA zeigt beides; fehlendes Onboarding blockiert Dispatch-Anlage für `hermes`.
- Kein neues Event-Subsystem: Wiederverwendung des Run/Task/Dispatch-Modells (P40); Onboarding-Quit ist ein Run-sichtbares Faktum, kein separater Store.

## 4. Aufgaben (Checkliste T54.m)

- **T54.1** Loop-Dropdown: Orchestrator-Auswahl je Loop aus Capability-Matrix (Contracts/Frontend), Default `self`, `hermes` nur bei bestandener Probe.
- **T54.2** Server: `orchestrator` + `onboarding_version` am Run; Dispatch-Anlage für `hermes` ohne gültiges Onboarding verweigern; Ralph-Hinweis im Kontextpaket.
- **T54.3** `docs/hermes/orchestrator-onboarding.md` aus Anhang 3.4 materialisieren (Version + Checksum), Tests für Fail-safe.
- **T54.4** Run-Report: `ONBOARDED <version>`-Bestätigung parsen und führen; Nicht-Konformität sichtbar machen, kein Auto-Retry.
- **T54.5** E2E: Auswahl `hermes` → Onboarding-Ablauf → Dispatch mit zwei Harnesses (nutzt P40-Live-Abnahme-Rest mit).
- **T54.6** Doku/README + Release Notes; Abnahme mit Nutzer am Gerät.

## 5. Acceptance Criteria (AC-P54-k)

- **AC-P54-1:** Im Loop-Dropdown ist der Orchestrator wählbar; `hermes` erscheint nur bei bestandener Adapter-Probe; Auswahl ist am Run sichtbar.
- **AC-P54-2:** Erste `hermes`-Ausführung ohne Onboarding liest den Prompt aus dem Repo, bestätigt `ONBOARDED <version>`; zweite Ausführung fragt nicht erneut (außer bei Versionswechsel).
- **AC-P54-3:** Fehlender/unlesbarer Prompt lehnt den Run ab; kein Start ohne Ralph-Onboarding.
- **AC-P54-4:** Ralph-Konformität ist Bestandteil jedes `hermes`-Run-Reports; fehlende Bestätigung ist sichtbar und blockiert Auto-Retry.
- **AC-P54-5:** `self`-Verhalten ist unverändert; keine Regression in bestehenden Loops (bestehende Test-Suite grün).

## 6. Premortem (Failure-Modi + Mitigation)

- **Prompt veraltet vs. Hermes-Version** → Version + Checksum im Prompt; Versionswechsel erzwingt Re-Onboarding.
- **Hermes quittiert ohne zu lesen** → Quitting ist nur mit korrekter Versionsangabe möglich; Stichproben-Abnahme durch Menschen (Gate).
- **Zwei Orchestrator-Wahrheiten (UI vs. Registry)** → einzige Quelle ist `caps.orchestrators`; UI hartkodiert nichts.
- **Onboarding-Datei wird zur zweite Konfig-Wahrheit** → sie ist Verhaltenstext, keine Maschinenkonfiguration; Config bleibt in hub.config.json/Registry.

## 7. Definition of Done

Alle T54.* und AC-P54-* mit aktueller Evidenz; Live-Abnahme am Gerät mit Nutzer; Release Notes aktualisiert.
