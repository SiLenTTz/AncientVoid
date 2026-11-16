# ADR-0080 — Automationen: Skript-Ziel für registrierte Miniskript-Aktionen

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/automations/automation.ts`,
`packages/core/src/modules/automations/service.ts`,
`apps/hub/src/modules/automations/automations-{service,routes}.ts`,
`apps/hubctl/src/automations.ts`, `apps/pwa/src/features/automations/`,
`apps/pwa/src/shared/api.ts`. Erweitert ADR-0064 (Eigentum und Claims) und
ADR-0065 (Abschluss und Vorlagen); Claim-Zustände und Spiegel-Prinzip (K7)
bleiben unverändert.

## Kontext

Nutzerfinding: die Automationsseite kennt nur Session-Trigger (Cron-Job auf
eine Agenten-Session) und Agenten-Teams (Service). Für kleine, cron-artig
ausführbare Miniskripte — `npm test`, ein `scripts/`-Aufruf, ein git-check —
musste bisher eine ganze Session mit Prompt gestartet werden. Genau solche
Befehle sind aber bereits als registrierte argv-Aktionen aus dem Code-Modul
vorhanden (T7.6: `BUILTIN_ACTIONS` + `detectedActions` + konfigurierte
Aktionen aus der Hub-Config) — geprüft, ohne Shell, mit Zeitlimit. Dazu
gewünscht: eine Karte, um spontan (ungeplant) eine temporäre Session zu
starten, ohne dafür den Umweg über die Neue-Session-Fläche.

## Entscheidung

### 1. `AutomationTarget` erhält `kind: "script"` (Contract-Erweiterung)

```ts
{ kind: "script", project: string, actionId: string }
```

Ein Skript-Ziel referenziert eine **registrierte argv-Aktion** des Codes-Moduls
(`[...configured, ...BUILTIN_ACTIONS, ...detectedActions(project)]`) — kein
Prompt-Blob, kein Harness. `actionId` folgt derselben Slug-Regel wie
`precheckActionId`. Die Auflösung passiert wie beim Prechecker: unbekannte IDs
werden laut abgelehnt, beim Anlegen (Route, 400) und beim Lauf (Skip-Grund
`precheck`).

### 2. Ausführung durch den Hub-Launcher via `runArgv`

Der Hub-Launcher führt die Aktion mit `actionArgv(action, {})` im Projekt aus
(Deadline `min(action.timeoutMs, 600 s)`), analog zum Prechecker. Der
Scheduler-Vertrag ändert sich nicht: `dispatch` bleibt ein Startauftrag, das
Ergebnis kommt aus dem Abgleich (`inspect`).

### 3. Ergebnis-Spiegel statt Referenz (K7)

Ein Skript-Claim trägt weder `sessionId` noch `teamId` — es gibt keine
referenzierte Ausführung, die ein Reconcile befragen könnte. Der Hub führt
deshalb eine **In-Memory-Spiegel** `Map<claimKey, AutomationOutcome>` (maximal
256 Einträge, älteste zuerst verdrängt): `launch` trägt das Ergebnis ein
(exit 0 → `succeeded`, exit ≠ 0 → `failed`, Timeout → `timeout`;
`spawn_error` ist kein Dispatch-Ergebnis, sondern ein laut abgelehnter Start),
`inspect` liest und tilgt den Eintrag und meldet `settled`. Nach einem
Hub-Neustart ist der Spiegel leer: ein dispatched gebliebener Skript-Claim
ohne Spiegel wird als `unknown` („Skript-Ergebnis nach Neustart unbekannt")
geführt und kann wie jeder unklare Start menschlich aufgegeben werden
(ADR-0072) — niemals geraten.

### 4. Form, Detail, hubctl

- Das PWA-Formular nennt die Auswahl „Automationart" mit drei Optionen:
  `session` → „Cron-Job · Session-Trigger", `team` → „Service · Agenten-Team",
  `script` → „Skript-Start · Miniskript". Der Skript-Zweig fragt Projekt und
  Aktion ab (Aktionen über die neue Route `GET /api/automations/actions`), der
  Zeitplan (Preset/Cron) gilt für alle drei Arten — Skript + Cron ist der
  cron-artige Miniskript-Trigger. Zusätzlich eine Karte „Temporäre Session
  starten" (Harness/Projekt/Prompt → normale Session-Erstellung, kein
  Automations-Claim).
- Detail-Zeile: `Skript <actionId> · <project>`.
- hubctl validiert Skript-Ziele mit Pflichtfeldern `project` + `actionId`.

## Konsequenzen

- Contracts: dritter Zweig im discriminated union; `validatePrompt` braucht
  einen script-Zweig (kein Blob-Abgleich), `dispatch` übergibt für Skripte
  `null` als Prompt-Text.
- Hub: neue lesende Route `GET /api/automations/actions?project=` mit
  projectRoots-Prüfung (422 wie git-graph); POST/PATCH lösen Skript-Aktionen
  vorab auf (400 bei unbekannter ID — Fail loud beim Anlegen, nicht erst beim
  Lauf).
- Bestehende Session-/Team-Automationen und ihre Journale ändern sich nicht;
  der Spiegel betrifft ausschließlich Skript-Claims.
