# Messlauf — AC-P5-1 (Discovery, K9) und AC-P5-3 (Recovery, K7)

**Datum:** 2026-09-23 · **Commit:** `7148e20` plus `scripts/messlauf-p5.mjs`
(im selben MR) · **Messlatten:** AC-P5-1, AC-P5-3, K7, K9

## Umgebung

- Node v26.7.0, Linux 7.1.9-arch1-2 x86_64, 16 Kerne, Maschine sonst in Ruhe
- Hub: echter Prozess `packages/server/src/main.ts` über `TestHub`
  (`e2e/support/hub.ts`): eigenes Datenverzeichnis, SQLite-Datei, ProcessRunner
- Adapter: `@uacc/adapter-dummy` (20 ev/s), kein Provider, keine Netzzeit
- Stand enthält BUG-0016 bis BUG-0021 und T5.5 (Übernahme)

## Kommandos

```bash
node scripts/messlauf-p5.mjs discovery --runs 10
node scripts/messlauf-p5.mjs recovery --runs 10
```

## AC-P5-1 — 20 Sessions, zwei pro Projekt, ohne Duplikate

Aufbau: 10 Hub-Sessions (je 5 in `alpha` und `beta`), 10 externe
Claude-Transkripte (5 Projektordner × 2), dazu eine Kopie von `ext-1-1` in
einem zweiten Projektordner (gleiche native ID, muss dedupliziert werden) und
eine Datei `notes.txt` in unbekanntem Format (K9).

| Ergebnis | Wert |
|---|---|
| Einträge | 21 = 10 Hub + 10 extern + 1 `unsupported-format` |
| Duplikate | 0 (die kopierte Datei erscheint einmal) |
| `GET /api/discovery`, warm | n=10, min 1, Median 1, p95 2, max 2 ms |
| Kill -9 → Hub bereit → Discovery beantwortet | n=5, min 418, Median 420, p95 422, max 422 ms |

**Urteil API-Ebene:** bestanden. 10 s werden um mehr als das Zwanzigfache
unterschritten.

## AC-P5-3 — harter Kill, exakte Sequenz, wieder steuerbar

Aufbau: 20 laufende Dummy-Sessions mit 20 ev/s, 30 gestoppte Sessions mit
zusammen 2100 Events. Zehnmal: bestätigte Events aller 20 laufenden Sessions
lesen, `kill -9`, Neustart, vergleichen, eine Session per Steer ansprechen.

| Ergebnis | Wert |
|---|---|
| `recovery_ms` (Hub-eigene Messung von `recoverAll`) | n=10, min 29, Median 37, p95 41, max 41 ms |
| Kill -9 → `/api/ready` (mit Node-Start) | n=10, min 408, Median 410, p95 412, max 412 ms |
| Abweichungen im bestätigten Präfix | 0 von 200 Vergleichen |
| Nicht steuerbar nach Neustart | 0 von 200 |
| Fehlgeschlagene Steers nach Neustart | 0 von 10 |

**Urteil für den Dummy-Adapter:** bestanden, weit unter 3 s. Die 30
gestoppten Sessions kosten beim Start nichts mehr (BUG-0018: sie werden erst
beim Öffnen geladen).

## Was das nicht sagt

- **AC-P5-1 „angezeigt“ ist nicht erfüllt:** Die PWA hat keine Ansicht für
  `GET /api/discovery`. Gemessen ist die API, nicht die Oberfläche.
- Die externen Sessions sind Claude-Dateien im erwarteten Layout.
  Codex/OpenCode/Copilot/Aider haben weiter keine belegte Discovery
  (`missing` in `GET /api/inventory`).
- **AC-P5-3 gilt hier nur für den Dummy.** claude, codex, opencode und
  copilot haben kein `recover()`. Ein laufender Zug ist nach dem Kill ehrlich
  „nicht steuerbar“ (E2E `recovery.spec.ts`), und sein tmux-Worker wird
  beim Start weggeräumt. Der Teil „überlebender Worker erneut steuerbar“ ist
  für echte Provider offen (T5.6).
- Provider-Netzzeit ist nicht enthalten (kein Provider im Lauf).
- Ein Lauf auf einem Rechner. Keine Aussage über langsamere Hosts (Pi,
  Windows).
