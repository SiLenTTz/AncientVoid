# Messlauf P29 — Restore mit Workspace-Sessions (K7) und Lastlauf (K8)

**Datum:** 07.11.2026 · **Commit:** `9cc47fe` (+ T29.6/T29.7-Arbeitsstand,
Branch `feat/p29-t29.6-service-proxy`) · **Maschine:** x86_64, Omarchy-Desktop
(Ruhe nebenbei, keine anderen Messungen) · **Node:** v26.7.0

## Prüfstand 1 — K7-Restore mit Workspace-Projektionen (AC-P29-4)

- **Kommando:** `npx playwright test e2e/specs/workspace-runtime.spec.ts --project=mobile -g "Restore-Messlauf"` (schreibt `test-results/messlauf-p29-restore-10.json`)
- **Aufbau:** 10 Sessions mit `ancientvoid.workspace.json` (ohne Setup-Schritte,
  ohne Services — es misst die Projektion, nicht die Readiness-Sonden), jede
  über die echte Approval-Queue freigegeben, Phase `ready`. Pro Runde:
  `SIGKILL` des Hub-Prozesses, Neustart, dann zehnmal
  `GET /api/sessions/<id>/workspace` bis Phase `ready`.
- **Wiederholungen:** 3 Neustart-Runden in einem Lauf; der Journey-Test
  (Session mit Setup-Fehler, Retry, Service, Preview) misst denselben Ablauf
  noch einmal einzeln (`messlauf-p29-restore.json`).

| Größe | Wert |
|---|---|
| Restart gesamt (Kill → alle 10 Projektionen `ready`) | 892 / 763 / 870 ms · **Median 870 ms** |
| Langsamste Einzelprojektion nach Ready-Signal | 6 / 3 / 3 ms · **max 6 ms** |
| Journey-Session (mit Service, Setup, Retry-Historie) | 859 ms |
| Zweite Setup-Ausführung nach Neustart | 0 (je Session genau 1× `workspace.preparing`) |
| `workspace.*`-Event-Payloads > 4 KB (K5) | 0 |

**Grenze (K7/AC-P29-4: < 3 s):** mit ~0,9 s deutlich eingehalten. Die
Einzelprojektion (Faltung aus JSONL + Snapshot) ist mit ≤ 6 ms praktisch
gratis; die Restart-Zeit dominiert (Prozessstart, Adapter-Loads,
SQLite-Open).

## Prüfstand 2 — K8-Lastlauf (AC-P29-6)

- **Kommando:** `npm run loadtest` (20 Sessions × 30 ev/s, In-Process-Hub)

| Größe | Wert |
|---|---|
| Durchsatz | 6080 Events in 10,1 s → **603 ev/s** aggregiert |
| Eventverlust | **0** (`K8 PASSED: no session lost events`) |
| RSS nach Lauf | 143 MB |

Die Lastlatte läuft ohne Workspace-Services (Dummy-Adapter); Services/
Logansicht greifen nicht in den Event-Strom (eigene DB-Zeilen + Datei-Logs),
ein K2-Verstoß durch die Umgebungsansicht ist dadurch konstruktiv ausgeschlossen.

## Was das nicht sagt

- Der K7-Wert misst **Projektionen**, nicht die Readiness adoptierter Dienste:
  Die Sonden laufen bewusst asynchron nach (ADR-0051 §5); wann ein adoptierter
  HTTP-Dienst wieder `ready` meldet, hängt vom Dienst ab (im Journey-Test:
  wenige Sekunden).
- 10 Workspace-Sessions sind die realistische Obergrenze für „zwei parallele
  Sessions pro Projekt" hochgerechnet auf mehrere Projekte; 20 Sessions mit
  vollem Manifest-Setup wurden nicht gemessen (Setup selbst ist äußere Wirkung
  mit Menschen-Freigabe, kein Restore-Pfad).
- Einzelne Zahlen auf einem Desktop-System mit Last nebenbei; die Streuung
  (763–892 ms) zeigt die Größenordnung, keine Mikrosekunden-Aussage.

## Rohdaten

- `test-results/messlauf-p29-restore-10.json` (3 Runden, 10 Sessions)
- `test-results/messlauf-p29-restore.json` (Journey-Session)
- K8-Konsolenausgabe oben (loadtest schreibt keine Datei).
