---
id: BUG-0089
slug: e2e-ci-host-label
status: done
severity: S3
area: server
instance: ci
commit: "0f0e63b82c1c5e61611b64ef08bf9c3fffdbae33"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/39"
epic: "P27 DoD / P28 T28.1"
created: 2026-11-05
reporter: "Codex"
---

# BUG-0089 — Konfigurierter eigener Host-Name wird in Fleet ignoriert

## Gesehen

Die identische E2E-Suite besteht lokal auf `workstation`, schlägt im GitLab-Runner
aber an Host-Selektoren fehl.
Das blockiert den zusätzlichen CI-Abschluss von P27, ohne dessen Code zu betreffen.

## Erwartet

Host-ID und Anzeigename sind verschieden. Die Browser-Assertions verwenden
den konfigurierten bzw. vom Hub gemeldeten Anzeigenamen statt des Entwicklers
OS-Hostname. Testlimits werden nicht entschärft.

## Repro

1. Pipeline auf `main` SHA `0f0e63b` starten (Pipeline 3032791113).
2. Job `e2e` 17778072745 auswerten: Fleet findet `.host-chip` mit `workstation`
   nicht.
3. Derselbe Codepfad fällt erneut in Branch-Pipeline 3033045257, Job
   17780152010 auf P27-SHA `4d7374e` aus.

**Repro-Weg:** Playwright gegen echte isolierte Hub-Prozesse in CI; vorhandene
Browser-/Hub-Artefakte. Lokal ohne künstliche Verzögerung meist grün.
**Häufigkeit:** wiederholt, zwei unabhängige Pipeline-SHAs.

## Ursache

`apps/hub/src/app.ts` reicht `deps.hostLabel` nicht an `registerFleetRoutes`
weiter. Dessen eigener `/api/fleet`-Eintrag verwendet immer `hostname()`,
während `/api/fleet/hello` bereits den konfigurierten Namen meldet. Damit wird
auch ein ausdrücklich gesetztes Test-Label ignoriert.

Die CI-Selektoren erwarteten `workstation`, was lokal zufällig dem OS-Hostname
entsprach. Der neue Integrationstest reproduziert die Abweichung jetzt auch
lokal: konfiguriert `Configured home label`, geliefert `workstation`.

## Logs

GitLab Job 17778072745, 05.11.2026, Ende 16:29 UTC (bereinigter Auszug):

```text
fleet.spec.ts:125: expected host-chip workstation, element(s) not found
```

Keine Roh-Logs oder Token-Artefakte übernommen. Links:
[Baseline](https://gitlab.com/SiLenT_Tz/AncientVoid/-/jobs/17778072745),
[P27-Repro](https://gitlab.com/SiLenT_Tz/AncientVoid/-/jobs/17780152010).

## Tests

Gezielte Browser-Probe mit absichtlich von `hostId` abweichendem `label`:
Assertions schlagen ohne Fix fehl. Nach Änderung müssen dieselben Fleet-Flows
funktionieren, einschließlich Ausfall eines Peers und Bedienung des lokalen Hubs.
Das vollständige lokale Gate wurde danach erneut geprüft; CI-Quota siehe P27-Abnahme.

## Fix und Verifikation

Die Fleet-Routen erhalten das vorhandene `hostLabel`; nur ohne Konfiguration
bleibt `hostname()` der Default. Der Browser-Test verwendet bewusst einen von
`hostId` und OS-Namen verschiedenen Anzeigenamen.

Rot vor Fix: `npm test -- apps/hub/test/modules/fleet/fleet-aggregate.test.ts`,
ein Fehler / drei Pässe. MR und Abschlussnachweis siehe unten.

Gemeinsamer Abschluss-Gate der getrennten CI-Blocker-Fixes: `npm run gate`
grün; 1152 Unit-/Integrationstests, 285 E2E-Pässe, zwei bestehende Mobile-
Handoff-Skips mit grünen Desktop-Gegenstücken. Keine Testlimits verändert.
Der Fix wurde separat gemergt; der abschließende kombinierte P27-Gate
bestand mit 1181 Tests und 295 E2E-Pässen (zwei bekannte Mobile-Handoff-Skips).

Abgeschlossen über [MR !294](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/294).
