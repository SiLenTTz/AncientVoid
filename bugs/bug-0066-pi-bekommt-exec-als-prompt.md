---
id: BUG-0066
slug: pi-bekommt-exec-als-prompt
status: done
severity: S2
area: adapters
instance: prod
commit: "43f43d0"
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/21"
epic: "P7"
created: 2026-10-26
reporter: jan
---

# BUG-0066 — pi bekommt „exec" als eigene Nachricht und den Prompt in Anführungszeichen

## Gesehen

Jeder pi-Turn, den der Hub startet, schickt pi zuerst eine eigene
User-Nachricht mit dem Text `exec`. Erst danach folgt der eigentliche Prompt,
und der ist in wörtliche Anführungszeichen gehüllt (`"Der wichtigste Punkt …`).
pi bearbeitet `exec` als eigenen Auftrag. Im belegten Turn vergehen dabei
5,5 Minuten, bevor der echte Prompt ankommt.

## Erwartet

pi bekommt genau eine Nachricht: den Prompt, so wie der Nutzer ihn getippt hat.

## Repro

Voraussetzung: Produktiv-Hub, Adapter `pi`, pi coding agent 1.4.0.

1. In der PWA eine pi-Session starten oder eine Folgenachricht senden.
2. Danach pis Session-Datei für das Projekt lesen
   (`~/.pi/agent/sessions/--<projekt>--/<neueste>.jsonl`, nur lesen).

**Ergebnis nach Schritt 2:** zwei User-Nachrichten pro Turn, `exec` und
`"<prompt>`.

**Häufigkeit:** immer.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`), Produktiv-Hub |
| Commit | `43f43d0` |
| Node-Version | v26.7.0 |
| Adapter | pi 0.1.0 (pi coding agent 1.4.0) |
| Repro-Weg | pi-Session-Datei zur Hub-Session `eeb744d9-…` |

## Logs

pi-Session-Datei, User-Nachrichten (Text gekürzt):

```text
2026-10-26T22:15:10.582Z ['exec']
2026-10-26T22:15:15.718Z ['"Der wichtigste Punkt ist das ich Whatsapp Nachrichten von a…']
2026-10-26T22:27:54.054Z ['exec']
2026-10-26T22:33:32.814Z ['"Jetzt ist die Frage, wie ich die Personen am einfachsten da…']
```

Dazu passend im Hub: Prompt `#38` um 22:27:53.538Z, Antwort `#40` erst um
22:40:09.243Z.

`pi --help` (1.4.0) kennt kein Subkommando `exec`. Positionale Argumente sind
dort `[messages...]`.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/adapters/pi/test/adapter.test.ts` | grün. Die Tests prüfen `--model`/`--continue` im argv, aber nicht, dass der Prompt das einzige und unveränderte Message-Argument ist |

Dieser Test müsste ohne Fix rot sein: in `adapter.test.ts` das gebaute argv
durch `sh -c` parsen (oder den Befehl ohne Shell bauen) und prüfen, dass genau
ein Message-Argument übrig bleibt, gleich dem Prompt-Text. Kein `exec`, keine
zusätzlichen Anführungszeichen.

## Eingrenzung

`packages/adapters/pi/src/index.ts:53-57` (`buildArgs`):

- `[cfg.command, "exec"]`: `exec` wird zum ersten Message-Argument.
- `JSON.stringify(prompt)` und danach Shell-Quoting: die JSON-Anführungszeichen
  bleiben wörtlich im Text stehen.

Der Doc-Kommentar (`index.ts:15`) und `docs/harness-matrix.md:20` nennen
ebenfalls `pi exec`. Das Muster sollte nach der Live-Verifikation mit der
installierten CLI angepasst werden, z. B. `pi -p`/`--mode json`, siehe
[BUG-0065](bug-0065-pi-verlauf-ohne-tools-und-thinking.md). Die beiden Fixes
gehören in denselben Adapter, sind aber getrennte Verhaltensänderungen.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` oder offen lassen
