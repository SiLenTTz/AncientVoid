---
id: BUG-0134
slug: setup-openai-json-escaping
status: open
severity: S3
area: ops
instance: dev
commit: "9d97e19"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/55"
epic: "EPIC-P53"
created: 2026-11-11
reporter: "Codex — Setup-/Modellanbindungs-Audit"
---

# BUG-0134 — OpenAI-Wizard serialisiert Benutzereingaben als ungültiges JSON

## Gesehen

Ein Anführungszeichen im Modellnamen führt vor Config-Anlage zu SyntaxError und Exit 1 statt einer verständlichen Validierung.

## Erwartet

AC: JSON.stringify für das Objekt; URL/Modell früh validieren, Fehlercode dokumentieren; Quotes, Backslashes, Zeilenumbrüche und normale Ollama-ID als Regressionstests. Keine Secrets in argv/Config. P53 AC-2/3.

## Repro und Umgebung

Temporärer Checkout mit Beispielconfig, npm-Stand-in und echtem Node: `bash setup.sh --yes --adapter=openai --model='a"b' --no-pwa --no-start`; Ergebnis Exit 1, SyntaxError im JSON.parse. Shell-Repro bestätigt, kein PWA/hubctl-Repro.

Umgebung: isolierter Linux-Worktree, Node v26.7.0, keine produktiven Dienste geändert.
Häufigkeit: deterministisch im genannten Repro; reine Codebefunde sind ausdrücklich markiert.

## Logs

Ergebnis des Repros vom 11.11.2026 siehe oben; keine Tokens oder Schlüssel aufgezeichnet.

## Eingrenzung und Abgleich

`setup.sh` adapter_json/openai interpoliert baseUrl/model mit printf in JSON. Kein serverseitiger Modellparserfehler.

## Tests / Handoff

AC: JSON.stringify für das Objekt; URL/Modell früh validieren, Fehlercode dokumentieren; Quotes, Backslashes, Zeilenumbrüche und normale Ollama-ID als Regressionstests. Keine Secrets in argv/Config. P53 AC-2/3.

- [x] Im Bug-Index erfasst.
- [x] GitLab-Tracker verlinkt.
- [ ] Fix und Verifikation (Status oben; Gate-Beleg im [Audit](../docs/2026-11-11-setup-modelle-audit.md)).
