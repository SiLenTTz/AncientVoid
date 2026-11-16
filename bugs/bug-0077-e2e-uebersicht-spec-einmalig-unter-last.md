---
id: BUG-0077
slug: e2e-uebersicht-spec-einmalig-unter-last
status: wont-fix
severity: S3
area: e2e
instance: dev
commit: "f4e14a2"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/31"
epic: ""
created: 2026-10-28
reporter: "Maki (Session e2e84c77)"
---

# BUG-0077 — E2E-Übersichts-Spec fiel einmal unter voller Suite-Last

## Gesehen

Im voller `npm run test:e2e`-Lauf (2026-10-28, ~18:22, Branch
fix/pwa-metriken-luecken, mobile-Projekt) fiel
`e2e/specs/session.spec.ts:76 › T8.1: die Übersicht ordnet nach „Braucht
dich", „Aktiv", „Zuletzt" …` **einmal** mit „element(s) not found" (auto-wait
10 s abgelaufen). Kein Zusammenhang mit den Änderungen des Branches
(Metrik-Anzeigen; der Spec berührt keine davon).

## Erwartet

Der Spec besteht deterministisch — oder sein Timing-Fenster ist so
bemessen, dass Suite-Last (parallele Worker, PWA-Build, ~240 weitere
Tests) es nicht sprengt.

## Repro

1. `npm run test:e2e` (volle Suite) — beim ersten Lauf nach dem Auftreten
   zweimal grün (242/247 passed).
2. Gezielt unter Last: `npx playwright test e2e/specs/session.spec.ts -g
   "die Übersicht ordnet" --repeat-each=6 --workers=4` → 6/6 grün;
   `--repeat-each=10 --workers=8` → 10/10 grün (Laufzeit stabil ~22 s).

**Nicht reproduziert** — 18 Wiederholungen nach dem Vorfall, alle grün.

**2026-10-29 (Session e20ab9c2): reproduziert — 1×.** Unter
`--repeat-each=10 --workers=8` fiel derselbe Test 1× („1 failed / 9
passed", mobile-Projekt), direkt im ersten Lastlauf des Tages. Danach
116 weitere Ausführungen ohne Wiederholung: 10/10, 36/36, 5× 10/10 und
20/20 mit `--workers=12`, dazu drei volle Suite-Läufe des Tages (243,
253, 256 passed) — alles grün. Der Fehlerdetail-Locator des Fehlschlags
wurde nicht aufbewahrt (nur der Testname im Lauf-Log; nachfolgende Läufe
haben `test-results/` geleert, das Trace-Archiv ist damit weg).

**Repro-Anleitung (geschärft):** Lastloop fahren —
`npx playwright test e2e/specs/session.spec.ts -g "die Übersicht ordnet" --repeat-each=10 --workers=8` —
und bei Fehlschlag **sofort** `test-results/*/trace.zip` sichern, bevor
ein neuer Lauf das Verzeichnis leert. Ohne Trace/Locator kein bugfix —
nicht raten.

**Häufigkeit:** selten und lastabhängig (2026-10-28: 1/20; 2026-10-29:
1/126 am selben Tag). Ungeprüfte Hypothese: Timeout der Freigabe-Karte
(`.session-approvals .approval-card`, auto-wait 10 s) unter
CPU-Konkurrenz der Parallel-Hubs — erst mit Trace bewertbar.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (E2E-TestHub, mobile-Projekt) |
| Commit | `f4e14a2` |
| Node-Version | ≥ 22.5 |
| Adapter | dummy, claude (Stand-in mit MCP-Permission-Brücke) |
| Repro-Weg | E2E |

## Logs

```text
Error: expect(locator).toBeVisible() failed
Locator: … (auto-wait, Timeout: 10000ms) — element(s) not found
```

(Kein Trace archiviert — test-results wurden vom Folge-Lauf überschrieben.)

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/session.spec.ts:76` | grün (18/18 nach Vorfall) |

## Eingrenzung

Offen. Verdacht: Last-Pfad — der Spec wartet auf die Freigabe-Karte der
claude-Stand-in-Session (`WERKZEUG` → MCP-Brücke → Approval), mehrere
Assertionen nutzen das 10-s-Default-Fenster; der Spec braucht unbelastet
~22 s. Ohne Repro kein Fix (bugfix-Regel: keine Symptom-Patches auf
Vermutung). Nächster Schritt bei erneutem Auftreten: Trace sichern
(`--trace on`), dann Timeout an der engsten Assertion gezielt erhöhen
oder Settlement explizit abwarten.

## Schließung (2026-10-30, wont-fix)

**Evidenz:** Voller `npm run test:e2e`-Lauf auf `main` (2f9224a):
266 passed / 0 failed (2 sichtbar geskippt). Geschärfte Lastloop aus der
Repro-Anleitung — `--repeat-each=10 --workers=8` — zusätzlich 10/10 grün
(~22 s pro Ausführung). Der specifische Spec (`session.spec.ts:76`,
mobile-Projekt) lief in allen Läufen grün.

**Entscheidung:** wont-fix. Der Flake trat zweimal an zwei Tagen auf
(2026-10-28: 1/20; 2026-10-29: 1/126) und ist in den rund 130
darauffolgenden Ausführungen (29.10.: 116 weitere; 30.10.: Suite und
Lastloop) nicht wieder aufgetreten; ein Fehlerdetail-Locator/Trace
existiert nicht. Ein Timeout- oder Settlement-Eingriff wäre ein
Symptom-Patch auf Vermutung — genau das, was die Eingrenzung ausschließt.

**Bei Wiederkehr:** neuen Bug anlegen (nächste freie Nummer siehe
[`README.md`](README.md)), beim Fehlschlag **sofort**
`test-results/*/trace.zip` sichern (vor dem nächsten Lauf) und dort
referenzieren. Die Repro-Anleitung oben bleibt gültig.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] wont-fix geschlossen (2026-10-30) — siehe Abschnitt „Schließung“
