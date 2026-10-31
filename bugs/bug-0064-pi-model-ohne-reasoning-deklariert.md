---
id: BUG-0064
slug: pi-model-ohne-reasoning-deklariert
status: done
severity: S3
area: agent-tooling
instance: dev
commit: ""
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/19"
epic: ""
created: 2026-10-26
reporter: nutzer (Pi-Session, Desktop)
---

# BUG-0064 — Agent-Modell war als non-thinking deklariert, Denken nicht steuerbar

## Gesehen

Pi startet jede Session auf `evo-evox2/halogen-qwen3.8-flash-next-uncensored-iq4xs`
mit Thinking-Level `off`, `pi --list-models` zeigt das Modell mit `thinking: no` —
obwohl der Endpoint auf `enable_thinking` reagiert.

## Erwartet

Ein Modell hinter einem Endpoint, der `enable_thinking` auswertet, wird als
thinking-fähig geführt und die Thinking-Stufe ist wählbar
(`reasoning` / `compat.thinkingFormat`, Pi-Doku `models-configuration.md`).

## Repro

Voraussetzung: Urzustand der Maschinen-Konfiguration `~/.pi/agent/models.json`
(Modelleintrag ohne `reasoning`), Pi 1.4.0, Endpoint `100.65.133.28:8100`.
**PWA und `hubctl` können hier nicht greifen** — der Defekt sitzt nicht im Hub,
sondern in der Harness-Konfiguration; Repro deshalb über Pi-CLI und direkten
API-Ruf.

1. `pi --list-models halogen` → Spalte `thinking` = `no`.
2. Session auf dem Modell starten → Session-Log schreibt beim Start
   `thinking_level_change -> off`; `/thinking` bietet keine Stufe an.
3. Gegentest direkt gegen denselben Endpoint (gleicher Prompt, `temperature 0`):
   ohne Parameter 26 Reasoning-Tokens, mit `enable_thinking: false` → 0.
   Der Endpoint kann es also, Pi wusste es nur nicht.
4. Gegenprüfung im Zustand nach dem Fix: `pi --list-models` → `thinking: yes`;
   `pi --model <m> --thinking high -p …` liefert einen echten Thinking-Block
   (18 Reasoning-Tokens), `--thinking off` liefert 0.

**Ergebnis nach Schritt 3:** Fähigkeit vorhanden, Deklaration fehlte — deshalb
Durcheinander statt Steuerung.
**Häufigkeit:** immer (jede Session auf diesem Modell seit 2026-10-25 23:04Z;
die einzige frühere Session lief auf einem anderen Anbieter).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (Pi 1.4.0, kein Hub beteiligt) |
| Commit | `dc0c290` (Worktree-Stand; die betroffene Datei liegt außerhalb des Repos) |
| Node-Version | 26.7.0 |
| Adapter | — (Harness-Konfiguration, nicht der Adapter-Stack) |
| Repro-Weg | Pi-CLI + direkte API (PWA/`hubctl` hier nicht anwendbar) |

## Logs

```text
2026-10-26T19:37:34.512Z  session-log: thinking_level_change -> off   (Urzustand, jede Session)
2026-10-26T19:50:05Z  $ pi --list-models halogen  →  thinking: no     (Urzustand, rückgesichert)
2026-10-26T19:50:06Z  $ pi --list-models halogen  →  thinking: yes    (mit reasoning+compat)
```

Direkter API-Gegentest um 19:45:12Z / 19:46:17Z (`rt` = Reasoning-Tokens, identischer Prompt):

```text
baseline (kein Parameter)              rt=26
enable_thinking=false                  rt=0     <- wirkt
enable_thinking=true                   rt=26
reasoning_effort=high|xhigh            rt=26    <- keine messbare Änderung
chat_template_kwargs.enable_thinking   rt=26    <- keine messbare Änderung
thinking_budget=128|4096               rt=26     <- keine messbare Änderung
```

Vorbehalt: der Endpoint cacht offenbar pro Prompt + Thinking-Schalter; bei den
letzten drei Zeilen heißt „keine Änderung" also „nicht belegt", nicht „sicher
ignoriert". Die Differenz bei `enable_thinking` ist zweifach reproduziert.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | — | nicht vorhanden (betroffene Datei ist Maschinen-Zustand, kein Repo-Inhalt) |
| Contract (`adapter-testkit`) | — | nicht anwendbar |

Welcher Test hätte das fangen müssen: **keiner** — `~/.pi/agent/models.json`
liegt außerhalb des Repos. Falls das gefangen werden soll, müsste die
Konfiguration ins Repo wandern (z. B. `deploy/pi-models.json`) und ein
`scripts/check-*` müsste deklarierte Fähigkeiten gegen `/v1/models` des
Endpoints prüfen. Vorschlag, kein Auftrag dieses Skills.

## Eingrenzung

Nicht Repo-Code: `~/.pi/agent/models.json`, Modelleintrag ohne `reasoning`
(Standard `false`) → Pi hält das Modell für non-thinking und sendet nie
`enable_thinking`. Zusätzlich kann Pi das Thinking-Format aus einer IP-URL nicht
auto-erkennen, deshalb explizit `thinkingFormat: "qwen"` (sendet top-level
`enable_thinking`).

**Nicht Teil dieses Bugs (kein gesehenes Verhalten, nur Konfig-Drift):**
`contextWindow`/`maxTokens` stehen mit 131072/32768 deutlich unter dem, was der
Endpoint advert (216064/65536) → Pi kompaktiert früher und kappt Output.
Bewusst als Puffer stehengelassen; eigener Bug erst ab gesehenem Verhalten.

## Fix (Status-Grund)

Zeile im Modelleintrag von `~/.pi/agent/models.json`:
`"reasoning": true` plus `"compat": { "thinkingFormat": "qwen" }`. Backup:
`models.json.bak-20261026`. Wirkt ab dem nächsten Pi-Prozess. **Der Fix liegt
nicht im Repo** — auf einer anderen Maschine ist der Defekt wieder da.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt ([#19](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/19))
- [x] `bugfix` nicht nötig — keine Produktcode-Änderung in diesem Lauf
