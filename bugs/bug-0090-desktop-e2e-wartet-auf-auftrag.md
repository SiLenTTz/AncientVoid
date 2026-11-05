---
id: BUG-0090
slug: desktop-e2e-wartet-auf-auftrag
status: done
severity: S3
area: e2e
instance: ci
commit: "0f0e63b82c1c5e61611b64ef08bf9c3fffdbae33"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/40"
epic: "P27 DoD / P28 T28.1"
created: 2026-11-05
reporter: "Codex"
---

# BUG-0090 — Desktop-E2E verwechselt Auftrag mit ausgeführter Taste

## Gesehen

Der CI-Test sieht den Auftrag „Taste Return“, prüft sofort die Fake-Tastatur
und erhält `[]` statt `["Return"]`. Zwei Pipelines zeigen denselben Fehler.

## Erwartet

Der Test wartet auf den sichtbaren Abschluss des konkreten Auftrags, bevor er
dessen Außenwirkung prüft. Keine zusätzlichen Retries oder gelockerten Limits.

## Repro

Playwright gegen echten Hub und Companion: Job
[17778072745](https://gitlab.com/SiLenT_Tz/AncientVoid/-/jobs/17778072745) auf
`main` und [17780152010](https://gitlab.com/SiLenT_Tz/AncientVoid/-/jobs/17780152010)
auf P27. In `desktop.spec.ts` unmittelbar nach dem Klick auf ↵ Enter.

Lokal deterministisch: Fake-Tastatur hinter eine Promise-Barriere stellen;
diese erst nach Sichtbarkeit des Auftrags freigeben. Die bisherige synchrone
Assertion läuft vor dem Promise-Fortschritt und ist rot (`/tmp/bug90-red.log`).
Der Browser-Test ist der Repro; keine echten Desktop-Fenster werden berührt.

## Ursache und Fix

`e2e/specs/desktop.spec.ts`: Der Text „Taste Return“ erscheint beim Einreihen,
bevor der Companion den Auftrag ausführt. Auf `fertig` im selben Eintrag warten,
dann unverändert die erzeugte Taste prüfen. Die Promise-Barriere bleibt als
Regression erhalten und wird auch im Fehlerpfad freigegeben.

## Nachweise

Rot vor Fix: `npm run test:e2e -- e2e/specs/desktop.spec.ts --project=mobile --grep 'Ziel sehen'`.
Gates/MR nach Verifikation. Keine Produktionsänderung, keine Roh-Logs/Secrets.

Gemeinsamer Abschluss-Gate der getrennten CI-Blocker-Fixes: `npm run gate`
grün; 1152 Unit-/Integrationstests, 285 E2E-Pässe, zwei bestehende Mobile-
Handoff-Skips mit grünen Desktop-Gegenstücken. Keine Testlimits verändert.
Jeder Fix wird separat committet/gemerged; P27 erhält danach einen erneuten
vollständigen Gate des kombinierten Stands.
