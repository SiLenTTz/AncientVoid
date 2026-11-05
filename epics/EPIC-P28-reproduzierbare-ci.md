# EPIC-P28 — Reproduzierbare CI und belastbare Gate-Nachweise

**Status:** Planungsentwurf · **Umsetzung:** gesperrt · **Phase:** P28
**Dauer:** 1–2 Agenten-Wochen (ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P27 und dessen wirksame Vorgänger-Exit-Kriterien nachweislich grün.

Quelle: [Vergleichsanalyse vom 05.11.2026](../docs/2026-11-05_paseo-vs-ancientvoid.md), §5; [Planungsgrundlage und Quellen](../docs/2026-11-05_paseo-umsetzungsplanung.md).

**Planungsauftrag:** Der Nutzer hat am 05.11.2026 ausdrücklich detaillierte
Epics zu den Verbesserungen der Paseo-Analyse beauftragt. Das erlaubt diese
Planung vor grünen Vorgängern, aber keinen Implementierungsstart. Vor T*.1
Vorgänger-AC mit aktueller Code-/Test-Evidenz prüfen; historische Statuszeilen
reichen nicht. Keine neue Ausnahme von AGENTS.md durch diesen Entwurf.

## 1. Ziel

Jeder MR kann denselben Commit in einer sauberen Umgebung prüfen lassen wie
lokal. Ein Fehler liefert reproduzierbare Logs; fehlende Voraussetzungen oder
Skips werden nicht als bestandene Messlatte ausgegeben. Lokale Gates bleiben
bis zu einer separat beschlossenen Regeländerung verbindlich (AGENTS.md).
Nutzen: K1–K10 werden ausführbar belegt statt aus Release-Frequenz abgeleitet.

## 2. Scope (In / Out)

**In:** Ursache der GitLab-Ausfälle erheben, vorhandene Jobs angleichen,
Runner-Option entscheiden, isolierten Verify-/E2E-Lauf und Artefakte herstellen,
Betrieb und Ausfallpfad dokumentieren.

**Out:** Repo-Migration, ungefragtes Public-Mirroring, automatische Releases,
Deployment, geänderte Merge-Regeln oder Kauf/Registrierung eines Runners.
GitHub Actions ist eine geprüfte Alternative, keine vorausgesetzte Infrastruktur.

## 3. Design-Details

### 3.1 Bestand und Diagnose

`.gitlab-ci.yml` enthält bereits `verify` und `e2e`, Systempakete und Chromium.
`package.json` definiert zusätzlich Workspace-Link-, Architektur-, Commit- und
Adapter-Matrix-Checks im lokalen Gate. Die bisherigen CI-Jobs sind nicht dessen
vollständige Entsprechung; der CI-Lasttest mit 10×20 ersetzt K8 (20×30) nicht.
Runner-/Quota-/Netzfehler, Produktfehler und fehlende Voraussetzungen getrennt
anhand konkreter Pipeline-/Job-IDs und Commit-SHAs erfassen, keine pauschale
Schuldzuweisung an das Free-Abo. Keine produktiven Tokens/Datadirs in Logs.

### 3.2 Ausführungsmodell

Zuerst GitLab mit bestehendem Runner prüfen; dann isolierten selbstverwalteten
Runner gegen privaten Actions-Mirror vergleichen (Kosten, Wartung, Tailnet,
Secrets, Ausfall). Entscheidung samt Betriebsverantwortung in ADR dokumentieren;
externe Einrichtung erst nach geklärtem Host und expliziter Betriebsentscheidung.
Ungeprüfter MR-Code erhält weder Produktionsdaten noch Deployment-Secrets,
Docker-Socket oder Zugriff auf laufende Agenten; bevorzugt kurzlebiger Container.
Node-Version, Lockfile und Tool-Versionen dokumentieren, Cache optional halten.

### 3.3 Nachweise

Ein Gate-Inventar ordnet jedem lokalen Teilkommando einen Job zu. Alle Teile
von `npm run gate`, PWA-Build und separater K8-Lauf müssen erkennbar sein.
Jeder Report nennt SHA, Runner-Image/Versionen, Laufzeit, Pass/Fail/Skip und
Artefaktpfad. Versehentlich fehlende Tests/Browser blockieren die Aussage
„grün“. Retries nur für nachgewiesene Infrastrukturfehler, erster Fehler bleibt
sichtbar; abgebrochene/veraltete Pipelines sind kein Abschlussnachweis.

## 4. Aufgaben (Checkliste T28.m)

- [ ] **T28.1** Gate-Inventar und mindestens drei fehlgeschlagene vorhandene
  Job-Läufe klassifizieren; bei fehlendem Zugriff konkreten Blocker benennen,
  nichts erfinden. Ausgabe: Ursache, Repro, Verantwortlicher. **K1–K10**.
- [ ] **T28.2** Runner-ADR und sauberen lokalen Container-Repro vorbereiten;
  Host-, Kosten- und Secret-Grenzen entscheiden, bevor ein Runner aktiviert
  wird. Nachweis: Neuaufbau ohne Cache. **K5/K7/K8**.
- [ ] **T28.3** CI-Konfiguration an Gate-Inventar angleichen; alle lokalen
  Gate-Teile, PWA-Build und K8 mit 20 Sessions × 30 Events/s ausführbar.
  Nachweis: echte Jobs am selben SHA, keine entschärften Limits. **K1–K10**.
- [ ] **T28.4** Artefakte/Skip-Bericht und Fehlerklassifikation einrichten;
  absichtlich fehlerhaften Test und fehlenden Browser in Wegwerf-Branches
  prüfen, sauberen Commit erneut laufen lassen. **K2/K7/K8/K10**.
- [ ] **T28.5** Runbook und lokale-vs-CI-Regel konsistent dokumentieren;
  drei aufeinanderfolgende vollständige Läufe ohne manuelles Reparieren auf
  sauberem Runner nachweisen, darunter kalter Cache. **K1–K10**.

## 5. Acceptance Criteria (AC-P28-k)

- **AC-P28-1:** Inventar hat für jedes lokale Gate-Teilkommando, PWA-Build und
  K8 einen ausführbaren Job und einen Report; kein grünes Dach über fehlendem Job.
- **AC-P28-2:** T28.5 liefert drei SHA-gebundene vollständige grüne Läufe;
  absichtlicher Testfehler und fehlendes Chromium führen nachweislich zu Rot.
- **AC-P28-3:** Keine produktiven Credentials/Volumes im Test-Runner;
  bereinigte Logs und Artefakte sind vom MR aus auffindbar (14 Tage Aufbewahrung).
- **AC-P28-4:** Bekannter Runner-Ausfall ist über Runbook lokal reproduzierbar;
  Gate-Regeln wurden nicht still geändert. Lokaler K8-Nachweis bleibt 20×30.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Runner auf Alltagshost beeinflusst Agenten:** Ressourcenlimits und isolierte
   Testdaten, keine produktiven Worker/Panes übernehmen; Host-Auswahl vor Rollout.
2. **Cache kaschiert fehlende Pakete:** mindestens ein kalter Lauf, Lockfile und
   benötigte Systemtools explizit installieren.
3. **Ein Retry macht Produktfehler grün:** nur klassifizierte Infrastrukturfehler
   wiederholen; Erstfehler und alle Versuche behalten.
4. **Mirror veröffentlicht privates Repo:** ohne separate Entscheidung keinen
   Mirror erstellen; selbstverwalteter GitLab-Runner ist die erste Alternative.

## 7. Definition of Done

Alle Aufgaben und AC mit SHA-/Job-Evidenz abgenommen; `npm run gate`, PWA-Build
und vollständiger K8-Lauf lokal grün. Pipeline-Job `e2e` grün; externe
Infrastrukturprobleme sichtbar nach AGENTS.md bewerten, niemals als Pass zählen.
Jede neue UI-Funktion/jeder neue Ablauf hat einen Spec in `e2e/specs/`;
CI-spezifische Negativproben zusätzlich als Job-Artefakt. Runbook über docs/README
bzw. CONTRIBUTING erreichbar. Keine Produktion umgestellt ohne Betriebsentscheidung.
