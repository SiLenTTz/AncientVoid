---
id: BUG-0080
slug: slash-new-frische-session-ohne-modell
status: done
severity: S2
area: adapters
instance: dev
commit: "e49af07"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/34"
epic: "EPIC-P25"
created: 2026-10-30
reporter: "Jan (Session f413d422, PWA)"
---

# BUG-0080 — Erste Nachricht nach `/new` stirbt an falschem Modell (403 → „Internal error")

## Gesehen

Live-Test des BUG-0079-Fix nach Hub-Restart (15:58): `/new` wird korrekt
ausgeführt (System-Event „Command /new ausgeführt — frischer Kontext"), aber
die **erste Nachricht an die frische Session** scheitert mit
„Maki: Fehler beim Provider — Internal error". Die Nachricht ist damit
verloren; erst eine erneute `/new`-Ausführung (die ihrerseits wieder dieses
Problem hat) oder Neustart hilft.

Beleg (Session `f413d422…`, events.jsonl):

```text
seq 13  15:34:46  user    "/new"
seq 15  15:34:46  system  "Maki: Command /new ausgeführt — frischer Kontext (Session CgYfd3oo…)"
seq 16  15:34:51  user    "Ja"
seq 18  15:34:51  system  provider.error — title "Fehler beim Provider", raw "Internal error"
```

Worker-Log (`data/workers/ancientvoid-f413d422….log`):

```text
Z128  session/new → ok, sessionId CgYfd3oo…, model currentValue: "zai/glm-5-code"
Z129  session/prompt → error -32603 "Internal error"
      data: "API error (403): You do not have permission to access glm-5-code"
```

## Erwartet

Die per `/new` erzeugte frische Session tritt mit dem konfigurierten Modell
an (Adapter-Config `model: "zai/glm-5.3"`), und die erste Nachricht wird
normal beantwortet. Die Modellauswahl ist Teil des Session-Starts
(`newSession()` macht genau das für den initialen Start).

## Repro

**gesehen (PWA + Worker-Log).** Deterministisch:

1. Hub mit maki-Adapter (`bridgeCommands: true`, `model: zai/glm-5.3`, Key
   ohne glm-5-code-Freigabe).
2. PWA → Session → `/new` senden (funktioniert, Event kommt).
3. Beliebige Nachricht senden → „Fehler beim Provider / Internal error".

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (systemd ancientvoid-hub, Restart 15:58:42, main `e49af07`) |
| Adapter | `@ancientvoid/adapter-acp`, preset `maki`, model `zai/glm-5.3` |
| Provider-Key | darf glm-5.3, nicht glm-5-code (ZHIPU 403, Code 1220) |
| Repro-Weg | PWA (Nutzer) + EventStore/Worker-Log |

## Logs

Siehe „Gesehen" — EventStore seq 13–19, Worker-Log Zeilen 128/129.

## Tests

| Ring | Befehl / Datei | Stand |
|---|---|---|
| Adapter | `packages/adapters/acp/test/bridge-commands.test.ts` | grün — der Stub beantwortet `session/new`, ohne dass die Modellwahl geprüft wird; der Folge-Prompt wird gegen den Stub immer happy beantwortet |

Lücke: kein Test prüft, dass die `/new`-Session dieselbe Modellkonfiguration
erhält wie der Start (z. B. Stub-Assertion: nach `/new` muss
Modell-Selektion mit `cfg.model` erfolgt sein, oder: erste `session/prompt`
liefert die gesetzte Konfiguration). Den roten Test schreibt der bugfix.

## Eingrenzung

Root-Cause benannt: `packages/adapters/acp/src/index.ts:455` — der
`/new`-Zweig in `runBridgeCommand()` ruft `session/new` **roh** auf und
umgeht damit `newSession()` (`index.ts:408–413`), der einzige Ort, an dem
`selectModel()` das konfigurierte Modell setzt. Die neue Session startet auf
makis Default (`zai/glm-5-code`) → erster Prompt → ZHIPU 403 → maki meldet
RPC „Internal error" → Adapter zeigt provider.error.

Fix-Skizze (smallest correct): `/new`-Zweig über `newSession(state, ctx,
cfg.model)` laufen lassen (dann inkl. announce + Modellwahl + Fehlerbehandlung
an einem Ort) statt des duplizierten Roh-Requests.

## Abschluss (2026-10-30)

**Root-Cause:** `packages/adapters/acp/src/index.ts:455` — der `/new`-Zweig in
`runBridgeCommand()` rief `session/new` roh auf und umging `newSession()`
(`:408–413`), den einzigen Ort, an dem `selectModel()` das konfigurierte
Modell setzt. Die Frischsession startete auf makis Default (`zai/glm-5-code`),
der Key darf nur `zai/glm-5.3` → ZHIPU 403 → maki RPC „Internal error" →
`provider.error`-Event; die erste Nachricht war verloren.

**Fix (smallest correct):** `/new` läuft über `newSession(state, ctx,
cfg.model)` — Modellwahl, announce und Fehlerbehandlung an einem Ort statt
dupliziertem Roh-Request. Streng: wird das Modell nicht angeboten, scheitert
`/new` laut (provider.error) statt still auf ein falsches zu fallen.

**Verify:** Neuer Test `bridge-commands.test.ts` „BUG-0080: /new wählt das
konfigurierte Modell auf der Frischsession" — rot ohne Fix (nur 1
`session/set_config_option` vom Start), grün mit Fix (2. Set mit `value:
stub/good` auf neuer sessionId). Stub um maki-form configOptions erweitert.
ACP-Suite 46/46 grün. Live-Verifikation nach Hub-Restart ausstehend
(Rezept: /new → Nachricht → normale Antwort statt provider.error).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt ([#34](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/34))
- [x] `bugfix` (Fix + Test, MR siehe Historie)
