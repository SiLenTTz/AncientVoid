---
id: BUG-0164
slug: offline-diff-verliert-stand
status: done
severity: S3
area: pwa
instance: dev
commit: "a2a7c9a0"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/67"
epic: "P36 / AC-P36-5, K10"
created: 2026-11-15
reporter: "P56-Grundlagen-Gate"
---

# BUG-0164 — Offline-Nachladen verwirft den sichtbaren Diff

## Gesehen

Im vollständigen lokalen Browserlauf verschwindet ein bereits sichtbarer
Diff nach dem Wechsel offline. Zeilen lassen sich danach nicht mehr für
eine lokale Review-Notiz auswählen; die Ansicht steht auf „lädt …“.

## Erwartet

Bei fehlgeschlagener Aktualisierung bleibt der letzte geladene Diff derselben
Session sichtbar, ausdrücklich als nicht aktuell gekennzeichnet. Eine
Offline-Notiz bleibt mit Zeitstempel lokal und wird nicht scheinversendet.
Ein anderer Session-Diff darf nicht als Cache übernommen werden.

## Repro und Eingrenzung

1. Echter Test-Hub, Dummy-Session fertig laufen lassen, neue Datei
   `offline-target.txt` mit „eins/zwei“ im Worktree anlegen.
2. „Änderungen“ öffnen und auf die sichtbare Datei warten.
3. Browser offline schalten; eine noch ausstehende/erneute `/diff`-Abfrage
   scheitert. Anschließend „Notiz an Zeilen“ und Zeile „zwei“ wählen.

**Beobachtet:** `review-feedback.spec.ts`, Offline-Fall: nach 45 s keine
`.review-pickable`-Zeile mehr. Playwright-Snapshot zeigt „lädt …“, „Failed
to fetch“ und die Offline-Banner. Häufigkeit: im vollständigen Lauf gesehen;
Last-/Replay-abhängiger erneuter Fetch. Für die Gegenprobe wird ein erneuter
Abruf durch Chat → Änderungen im Offline-Zustand explizit ausgelöst.

Ursache: `SessionTail.tsx`, Diff-Effekt: `.catch(() => alive && setDiff(null))`
verwirft vorhandene Daten auch beim bloßen Nachladefehler.

## Verifikation

Bestehender E2E `e2e/specs/review-feedback.spec.ts` wird um den expliziten
Offline-Nachladeversuch und die Kennzeichnung des alten Stands erweitert.
Der vollständige Workflow Notieren → Outbox → wieder online → Entwurf bleibt
erhalten. Kein Timeout wird erhöht, keine Assertion entfernt.

Die unabhängige P56-Arbeit bleibt separat; sie verändert diese PWA-Pfade nicht.

## Fix und gezielte Gegenprobe

Der gezielt ausgelöste Offline-Nachladeversuch war vor dem Fix rot.
SessionTail hält danach den letzten Diff mit seiner Session-ID und zeigt
einen Aktualisierungsfehler in Änderungen/Bericht ausdrücklich an. Der
Cache wird nur für dieselbe Session angezeigt; erfolgreiche Nachladeversuche
löschen die Fehlermarkierung. Drei vollständige Review-Spec-Wiederholungen
sind danach grün (9/9), inklusive Notiz/Outbox und Wieder-Synchronisieren.
Vollständiges lokales Gate grün: 2204 Unit-/Integrationstests bestanden (4 sichtbar übersprungen), 694 E2Es bestanden (5 sichtbar übersprungen; 27.4m). Typecheck, Lint, Architektur, Kontext und PWA-Build grün. Skips sind keine Passes.

Fix und Review: [MR !476](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/476).
Zusätzlicher isolierter Repro ohne P56-Dateien: 1/1 bestanden (6,4 s).
