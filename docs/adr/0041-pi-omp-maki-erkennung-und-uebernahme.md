# ADR-0041 — Erkennung und Übernahme für pi, oh-my-pi (omp) und maki

**Status:** akzeptiert · **Betrifft:** `packages/core/src/modules/discovery/` (`pi-family.ts`, `maki.ts`, `text.ts`), `packages/adapters/pi/`,
`packages/adapters/acp/` (Preset `omp`, Modell nach `session/load`), `SessionManager.create/discover`, `HarnessInventory`, PWA `features/discovery/`, EPIC-P24

## Kontext
ADR-0011/0040 erkennen und übernehmen Sessions von Claude und opencode. pi, omp und maki liefen nur als Hub-Sessions; ihre eigenen Sessions
(Terminal) blieben unsichtbar und ließen sich nicht in den Hub holen. Gemessen am 2026-10-28 (pi 1.4.0, omp 18.13.3, maki 0.6.5):
- pi/omp legen JSONL unter `~/.pi/agent/sessions` bzw. `~/.omp/agent/sessions/<-cwd->/<ts>_<id>.jsonl` ab (`session{id,cwd}`, `message`, bei omp zusätzlich `title`).
- maki: `~/.local/state/maki/sessions/<id>.jsonl` (`header`, `msg`, riesige `frame`-Zeilen, `meta{title,updated_at}`) und exklusive Sperrdateien in `locks/`.
- pi nimmt `--session`, `--fork`, `--continue`; omp und maki sprechen ACP (`omp acp`, `maki acp`) mit `loadSession`.

## Entscheidung
1. **Scanner** (read-only, ohne Provider-Aufruf) für alle drei; Kopf-/Endfenster wie bei Claude (`text.ts`), Titel, Vorschau, `live` (zuletzt beschrieben).
   Pfade per Config `discovery.piDir/ompDir/makiDir`. Unbekannte Formate erscheinen als `unsupported-format` (Regel 6).
2. **pi-Adapter:** Args `resumeSessionId`, `forkSession`, `importHistory`. Übernahme ohne Prompt startet nichts (`idle`), jeder Zug läuft mit `--session <Datei>`,
   die Kopie mit `--fork` nur im ersten Zug. Der Verlauf wird importiert (200er Fenster), `recover()` setzt nativ fort.
3. **omp und maki** laufen über den ACP-Adapter (`session/load`, Verlauf aus dem Replay). Nach dem Laden setzt der Adapter das **konfigurierte Modell**
   (`selectModel`); maki lief sonst auf seinem letzten Modell, auf das der Account keinen Zugriff hat (403). Ist das Modell nicht im Angebot, steht
   `acp.model_unavailable` im Strom und die Session behält ihr Modell.
4. **Übernahme der Originalsession läuft ohne Worktree** (`SessionManager`, nur bei `adoptNativeSessionId` ohne `adoptFork`): omp bricht `session/load` aus einem
   anderen Verzeichnis als dem der Session ab („load was cancelled“, Exit 130). Die Session gehört ohnehin diesem Projekt; Kopien behalten ihren Worktree.
5. **Worktree-Duplikate:** eine externe Zeile, deren Projekt `…/data/worktrees/<id>` einer bekannten Hub-Session ist, wird ausgeblendet (sie ist diese Hub-Session).
6. **PWA:** „Als Kopie“ nur für pi und Claude (`COPY_CAPABLE`); läuft eine omp-/maki-Session gerade woanders, bietet die Karte kein Fortsetzen an,
   sondern den Hinweis, sie dort zu beenden. Fortsetzen erscheint nur für registrierte Adapter.

## Folgen und Grenzen
- Contract: keine Änderung (Adapter-Args sind Adapter-Sache, Config-Schlüssel additiv).
- omp ist nur in einer **lokalen** `hub.config.json` registriert (Schlüssel `ZHIPU_API_KEY` über `envFiles`); Rollout auf andere Hosts macht der Betreiber.
- maki sperrt eine Session exklusiv pro Prozess: eine zweite Übernahme gelingt erst, wenn die Hub-Session gestoppt ist.
- Der Hub übergibt `envFiles`-Werte als `env KEY='wert' cmd` an tmux-Worker; das Secret steht damit in der Prozessliste. Eigenes Thema (Env-Datei statt Kommandozeile).
- Nicht belegt: Übernahme einer Session mit offener Tool-Ausführung am Ende; Kopie für omp/maki (kein Fork-Flag gemessen).
