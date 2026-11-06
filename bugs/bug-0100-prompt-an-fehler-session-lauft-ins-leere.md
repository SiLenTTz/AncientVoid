---
id: BUG-0100
slug: prompt-an-fehler-session-lauft-ins-leere
status: open
severity: S2
area: core
instance: ci
commit: "dee6c0f"
epic: ""
created: 2026-11-06
reporter: "P28-CI (Lauf 3038014959)"
---

# BUG-0100 — Prompt an eine fehlerklassifizierte Session läuft ins Leere

## Gesehen

E2E `notifications.spec.ts` › „nach einem Fehler geht es mit dem nächsten
Prompt weiter" rot in Pipeline
[3038014959](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3038014959)
(Job 17817152787): Nach Kontingent-Fehler korrekt als **„Fehler"**
klassifiziert (BUG-0095-Fix wirkt — kein „unterbrochen" mehr), der Folge-
Prompt „Jetzt wieder" steht im Chat, aber es kommt keine Antwort: Der
Prompt lief per steer auf ein **totes Adapter-Handle** statt einen neuen
Zug zu starten. Nach dem BUG-0095-Fix 6 Läufe grün — diesmal war die CI
langsam genug für das Gegenstück-Rennen (Prompt NACH der Klassifizierung).

## Erwartet

Ein Prompt an eine Session im Status `error` startet einen neuen Zug
(wie bei `stopped`), statt auf einem toten Handle zu verschwinden.

## Repro

Integrationstest in `interrupted-session.integration.test.ts`: Provider-
Fehler emittieren, auf Status `error` warten (Klassifizierung abgeschlossen,
wie im CI-Lauf), dann steuern — ohne Fix bleibt der Adapter-Start-Zähler
bei 1 (kein neuer Lauf, Ack trotzdem ok), mit Fix startet die Session neu.

## Ursache

`packages/core/src/modules/sessions/session-manager.ts` (steer, Bedingung
`reopening`): `status === "stopped" || !session.handle` — der Status
`error` fehlt. Nach fehlerhaftem Worker-Exit mit abgeschlossener
Klassifizierung hängt ein totes Handle an der Session: Der Prompt geht an
`adapter.steer(totes Handle)`, das ins Leere läuft.

## Fix

`error` in die Reopen-Bedingung aufnehmen — ein Prompt nach Fehler startet
über `continueStopped` einen neuen Zug (dieselbe Naht wie bei `stopped`,
inkl. Skill-Kette).

## Nachweis

Siehe MR.
