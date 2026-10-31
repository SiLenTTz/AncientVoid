# P12 — Abnahme-Checkliste (Stand 2026-10-08)

Zweck: die offenen Punkte aus [EPIC-P12](../epics/EPIC-P12-operational-readiness.md)
nach **was fehlt** sortieren. Fast nichts davon ist noch Programmierarbeit; es
fehlen Geräte, Zugänge oder deine Mitwirkung. Evidenz gehört in einen Messlauf
unter `docs/messlauf/` (Skill `messlauf`); ein isolierter oder simulierter Lauf
schließt keine Zelle (AC-P12-4: „Nicht vorhandener Zugriff ist kein Pass“).

## A. Braucht dein Handy / ein echtes Gerät

| Task | Was | Messlatte |
|---|---|---|
| T12.1 | Echtes Handy-Pairing über WAN | K10 |
| T12.4 / AI-P10-1 | ≥ 20 Fachbegriff-Diktate je Zielgerät (Headset, Störgeräusch, Permission-Deny, Coldstart, WAN) | K6 |
| T12.4 / AI-P8-1 | Push im Hintergrund/Sperrbildschirm, echter Flugmodus, Bildschirmtastatur, 200 % Text, TalkBack/VoiceOver | K10 |
| T12.4 / AI-P9-2 | Anhang aus dem Teilen-Menü (Web Share Target) | — |
| T12.4 / AI-P8-2 | Peer-Meldungen als Push über den Heim-Hub | — |
| T12.7 | Aktuelle Gerätetokens auf Clients einspielen und dort prüfen; Fairphone (gesperrt, Flugmodus) | — |

## B. Braucht deinen Desktop (Hyprland)

| Task | Was |
|---|---|
| T12.4 / AI-P11-1 | Desktop-Companion: 3 Apps × 10, Not-Stopp-Keybind, WAN-Abbruch |
| T12.12 / AI-P11-3 | Leck-Messung 0/50 am echten Desktop (isoliertes Hyprland scheitert an Aquamarine `CBackend::create()`) |
| T11.4 / AI-P11-2 | GUI-Harness-Flows (Claude Desktop, Cursor …), GTK3-Zelle |

## C. Braucht einen Zugang oder ein Provider-Konto

| Task | Was | Blocker |
|---|---|---|
| T12.1 | Claude-native Permission-Turns | Wochenkontingent war erschöpft; nach Reset wiederholen |
| T12.8 | Swarm-Adapter live | Admin-Credential und `swarm_cockpit`-Feature fehlen; keine echte Lauf-JSONL |
| T12.7 | `evox2`-Fleet-Credential rotieren | Dienstzugriff |
| T12.4 / AI-P6-1 | WSL-Host (z. B. bmax) in die Flotte | Host-Zugang |
| T12.4 / AI-P5-1 | Handläufe Claude Code, Codex, Copilot (EPIC-P5 §12.4) | Provider-Konten |

## D. Braucht Betriebszeit oder Datenmenge (keine neue Technik)

| Task | Was | Messlatte |
|---|---|---|
| T12.5 | 24-h-Dauerlauf mit ≥ 20 Sessions inkl. Netz-/Hub-/Modell-Ausfällen | K2/K7/K8/K9/K10 |
| T12.2 / AI-P10-3 | K2/K8 unter echter Sprachlast mit 20 Sessions | K2/K8 |
| T12.4 / AI-P7-3 | Gatekeeper auf ≥ 100 echten, unabhängig gelabelten Tool-Anfragen | — |
| T12.4 / AI-P9-1 | Planer auf ≥ 100 echten Formulierungen (vorher nicht schärfen) | — |
| T12.3 | Restore-Latenz, ENOSPC, Retention-Löschlauf | K5/K7/K10 |
| T12.10 / AI-P10-2 | Streaming-STT mit endpointing/VAD auf Zielhosts, 100 warme Kurzbefehle je Gerät (`stt.streaming` bleibt bis dahin aus) | AC-P10-2 |
| T12.1 | Update/Rollback der Produktivinstanz | K7 |
| T12.4 / AI-P10.5-2 | Videofrage über echte Harness-Session, Video > 20 min | — |

## E. Code-Arbeit, die tatsächlich noch fehlt

Nichts Blockierendes in P12. Nebenbefunde aus dem Statusreport vom 2026-10-08
(Worktree-Retention der `ancientvoid/*`-Sessions) sind keine P12-Abnahmen; sie stehen in
[EPIC-P14](../epics/EPIC-P14-session-worktree-hygiene.md).

## Reihenfolge-Empfehlung

1. Block D „billige“ Punkte, die nur Laufzeit brauchen (T12.3, T12.1 Update/Rollback).
2. Block A in einem Gerätetermin bündeln (Pairing, Diktate, Push).
3. Block B in einem Desktop-Termin.
4. Block C sobald Zugänge/Kontingent da sind.
5. T12.5 (24 h) zuletzt, wenn A–C grün sind; vorher sollte EPIC-P14 (Worktree-Hygiene) stehen.
