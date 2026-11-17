---
id: BUG-0200
slug: metrik-karten-ohne-region-role
status: open
severity: S3
area: pwa
instance: dev
commit: "2063ec9d"
forge: "https://github.com/securesight-ai/AncientVoid/issues/117"
epic: "P63 (Folge), P59 (betroffene Seite)"
created: 2026-11-17
reporter: Agent (EPIC-P56 T56.3)
---

# BUG-0200 — Metrik-Seite: Karten haben nach der P63-Baustein-Migration keine region-Rolle mehr — E2E findet „Metrik-Quelle" nicht

## Gesehen

`e2e/specs/ki-server-metriken.spec.ts` ist auf dem main-Stand rot: Der
Locator `getByRole("region", { name: "Metrik-Quelle E2E voll" })` findet
kein Element, obwohl die Karte mit Inhalt rendert. Die Seite selbst funktioniert.

## Erwartung

Die Karten der Metrik-Seite sind — wie vor der UI-Konsolidierung (PR #94)
und wie der Spec dokumentiert — als `region` mit zugänglichem Namen
findbar (Screenreader und E2E). Seit PR #94 rendert der Baustein `Card`
(`apps/pwa/src/shared/ui/Card.tsx`) ein nacktes `div`; ein `aria-label`
ohne Role erzeugt aber keine benannte Region.

## Repro

Voraussetzung: E2E-Umgebung (`apps/pwa/dist-e2e` gebaut), kein echter
KI-Server nötig (Stand-in aus dem Spec).

1. `npm -w @ancientvoid/pwa run build -- --outDir dist-e2e --emptyOutDir`
2. `npx playwright test e2e/specs/ki-server-metriken.spec.ts --project=mobile -g "erreicht die Seite"`

**Ergebnis nach Schritt 2:** `expect(locator).toBeVisible()` schlägt fehl —
„element(s) not found" für `region „Metrik-Quelle E2E voll"`. Im
Accessibility-Snapshot steht die Karte als div mit Inhalt, ohne Role.

**Häufigkeit:** immer (auch die übrigen Tests des Specs, die `card()`
nutzen: Zahlen, p50/p95, Offline-Verhalten, Redaction-Assertion).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (E2E-Hub, `127.0.0.1:<freier Port>`) |
| Commit | `2063ec9d` (Basis von `feat/p56-t56.2-rollup-job`, identisch mit origin/main zum Zeitpunkt) |
| Node-Version | 26 |
| Adapter | e2e-Stand-in (`llamacpp`-Metrics-Server des Specs) |
| Repro-Weg | PWA (Playwright mobile) |

## Logs

Playwright, Lauf vom 2026-11-17:

```text
Error: expect(locator).toBeVisible() failed
Locator: getByRole('region', { name: 'Metrik-Quelle E2E voll' })
Expected: visible, Timeout: 10000ms
Error: element(s) not found
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/ki-server-metriken.spec.ts` | rot (dieser Bug) |

Der Spec fängt den Defekt bereits ein — er läuft nur nicht im PR-CI
(`verify` fährt kein E2E; Nightly würde ihn zeigen), dasselbe Muster wie
[BUG-0197](bug-0197-inventar-g19-s04-nach-ui-konsolidierung-rot.md). Keine
neue Testdatei nötig; der Fix rot-liest sich hier direkt.

## Eingrenzung

`apps/pwa/src/shared/ui/Card.tsx` (Baustein seit EPIC-P63 T63.7): `…rest`
(vermutlich einst `role`/semantisches Element) landet auf einem `div` ohne
Role. Betroffen: jede Fläche, die `Card` mit `aria-label` als region nutzt —
nachgewiesen `apps/pwa/src/features/aimetrics/AiMetricsPage.tsx` (`<Card
aria-label={`Metrik-Quelle ${label}`}>`). Die neue Statistik-Seite
(EPIC-P56 T56.3) setzt deshalb explizit `role="region"` auf ihre Karten
und ist nicht betroffen.

Zwei mögliche Ausgänge wie bei BUG-0197: Baustein bekommt die Role zurück
(Produkt) oder die Specs migrieren ihre Selektoren (Test). Kein Fix in
diesem Bug-Report.

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
