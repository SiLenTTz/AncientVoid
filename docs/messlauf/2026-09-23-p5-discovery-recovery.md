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

## AC-P5-3 mit Provider-Adapter (Nachtrag, T5.6 / ADR-0014)

```bash
node scripts/messlauf-p5.mjs recovery-provider --runs 5
```

Echter `@uacc/adapter-opencode`, TmuxRunner, nachgebauter CLI
(`e2e/support/bin/opencode`). Pro Lauf 5 Sessions, deren Zug beim
`kill -9` noch läuft (`WARTE2`); nach dem Neustart je ein weiterer Prompt.

| Ergebnis | Wert |
|---|---|
| `recovery_ms` | n=5, min 54, Median 88, p95 133, max 133 ms |
| Verlorene Antworten | 0 von 50 |
| Doppelt ausgegebene Zug-Teile | 0 von 25 |
| Nicht steuerbar nach Neustart | 0 von 25 |
| Fortsetzung in anderer Provider-Session | 0 von 25 |

**Urteil:** bestanden. Der laufende Zug wird übernommen, seine Ausgabe kommt
einmal an, der nächste Prompt setzt dieselbe Provider-Session fort.

## Wiederholung auf dem Abnahmestand (`6cbcfdd`, mit ADR-0013/0014)

Gleiche Kommandos, gleiche Maschine, gleicher Tag.

| Lauf | Ergebnis |
|---|---|
| discovery | 21 Einträge, 0 Duplikate; warm Median 1 ms (max 3); kalt Median 423 ms (max 426) |
| recovery (Dummy) | `recovery_ms` Median 37 ms (min 30, max 43); Kill → ready Median 411 ms (max 511); 0/200 Abweichungen, 0/200 nicht steuerbar, 0/10 Steer-Fehler |
| recovery-provider (OpenCode, tmux) | `recovery_ms` Median 96 ms (min 46, max 134); 0/50 verlorene Antworten, 0/25 doppelte Ausgabe, 0/25 nicht steuerbar, 0/25 fremde Provider-Session |

Alle drei bestanden.

## Was das nicht sagt

- AC-P5-1 misst hier die API. Die Anzeige in der PWA („Gefunden“) prüft
  das E2E-Gate (`discovery.spec.ts`: 20 Sessions binnen 10 s).
- Die externen Sessions sind Claude-Dateien im erwarteten Layout.
  Codex/OpenCode/Copilot/Aider haben weiter keine belegte Discovery
  (`missing` in `GET /api/inventory`).
- Der Provider-Lauf nutzt den echten OpenCode-Adapter mit nachgebautem CLI.
  claude, codex und copilot haben dieselbe `recover()`-Logik mit Unit-Tests,
  aber keinen eigenen Messlauf. Echte Provider-CLIs sind Teil der manuellen
  Abnahme (AC-P5-2/AC-P5-3).
- Provider-Netzzeit ist nicht enthalten (kein Provider im Lauf).
- Ein Lauf auf einem Rechner. Keine Aussage über langsamere Hosts (Pi,
  Windows).
