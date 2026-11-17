---
id: BUG-0169
slug: e2e-global-setup-npm-auf-windows
status: done
severity: S3
area: e2e
instance: dev
commit: "61b0198e"
forge: ""
epic: ""
created: 2026-11-16
reporter: Pi-Session 2026-11-16 (E2E-Lauf für BUG-0172/0174 sollte laufen)
---

## Gesehen

`npx playwright test e2e/specs/session-workspace-mode.spec.ts` brach schon in
`e2e/support/global-setup.ts` ab, bevor ein einziger Test lief:

```
Error: spawnSync npm ENOENT
   at ..\support\global-setup.ts:7
```

Nach dem Umschalten auf `npm.cmd` stattdessen:

```
Error: spawnSync npm.cmd EINVAL
```

## Erwartet

Das E2E-Gate läuft auf Windows (der Entwickler-Alltag dieses Projekts ist
Windows) und baut das PWA-Bundle, bevor die Hubs starten. Ein fehlendes
Chromium überspringt Tests sichtbar — ein kaputtes Setup nicht.

## Repro und Logs

1. Repo auf Windows, `npm ci`.
2. `npx playwright test e2e/specs/session-workspace-mode.spec.ts`
3. Abbruch in `globalSetup`, Exit-Code vom Runner, kein Testbericht.

Zusatzbefund im selben Lauf: `C:\Users\KaiFe\AppData\Local\ms-playwright\
chromium_headless_shell-1248\...` fehlte — `npx playwright install chromium`
(118 MB) war nötig. Das ist Installation, kein Defekt, aber es war nicht
dokumentiert auffindbar.

## Eingrenzung

`execFileSync("npm", …)` ohne Shell: Node löst under Windows nur ausführbare
Programme auf, `npm` ist ein `.cmd`-Shim → `ENOENT`. `npm.cmd` direkt zu
spawnen ist seit Nodes Härtung gegen Command-Injection ebenfalls verboten →
`EINVAL`. Richtig ist `shell: true` (die Argumente sind feste Konstanten).

## Fix (`shell: true` auf win32)

`e2e/support/global-setup.ts` ruft `npm` jetzt mit
`shell: process.platform === "win32"` auf, Kommentar hält die Begründung und
die Konstanten-Argumente fest. Auf POSIX bleibt `shell: false`.

## Tests

Der Spec-Lauf selbst ist der Test: `e2e/specs/session-workspace-mode.spec.ts`
→ 5 passed (10.7 s), davon der neue Fall „Ordner ohne .git: Auswahl, zweiter
Schreiber nur nach Bestätigung (BUG-0172/0174, ADR-0081)“.

## Handoff

Wer das Gate auf einer neuen Maschine fährt: einmal
`npx playwright install chromium` ausführen; sonst scheitern alle Specs am
fehlenden Browser.

## Nachtrag 17.11.2026: dieselbe Wurzel im Site-Smoke

`e2e/specs/site.spec.ts` baute `apps/site` mit `execFileSync("npm", …)` **ohne** `shell` —
auf Windows `spawnSync npm ENOENT`, der Spec war auf Windows gar nicht ausführbar
(1 failed, Bau fehlte schon im `beforeAll`). Nach dem Fix:
`npx playwright test e2e/specs/site.spec.ts --workers=1` → **3 passed (3,0 s)**.

Beide Aufrufe (Global-Setup und Site-Bau) teilen jetzt `e2e/support/win-shell.ts`
(`winShell`), damit kein dritter Aufruf dieselbe Falle bekommt.
