---
id: BUG-0052
slug: e2e-zufallsport-kollidiert
status: done
severity: S3
area: e2e
instance: dev
commit: ""
forge: ""
epic: "P4.5"
created: 2026-10-09
reporter: jan
---

# BUG-0052 — E2E: Zufallsport der Stand-in-Server kollidiert mit fremden Prozessen

## Gesehen

Im Volllauf des Gates schlug `voice-local.spec.ts` („mit K6-Zeit“) mit
`Error: listen EADDRINUSE: address already in use 127.0.0.1:19333` fehl. Den Port hielt
ein fremder `chromium`-Prozess (pid 1474373, kein Test dieses Laufs). `voice-local.spec.ts`
und `media.spec.ts` wählten ihren Port per `19_000 + Math.random() * 900` bzw.
`18_000 + …` aus einem festen Bereich, `streamPort` als `port + 10_000`.

## Erwartet

Die Stand-in-Server der Specs bekommen einen Port, der nachweislich frei ist.

## Repro

1. Auf einem Port im Bereich 19000–19899 lauschen (z. B. ein weiterer Browser).
2. `npm run test:e2e` laufen lassen, bis der Zufall diesen Port trifft.

**Ergebnis nach Schritt 2:** `EADDRINUSE`, der Test fällt aus, obwohl der Code stimmt.

**Häufigkeit:** selten, aber im Volllauf gesehen (einmal in zehn Läufen dieser Sitzung).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | `e5a7130`-Linie |
| Repro-Weg | E2E-Volllauf |

## Logs

```text
Error: listen EADDRINUSE: address already in use 127.0.0.1:19333
LISTEN 127.0.0.1:19333  users:(("chromium",pid=1474373,fd=77))
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `voice-local.spec.ts` + `media.spec.ts`, 3 Wiederholungen, 4 Worker: 18/18 | Fehlschlag nur im Volllauf beobachtet; **kein deterministischer Rot-Beweis** |

## Eingrenzung

`e2e/specs/voice-local.spec.ts`, `e2e/specs/media.spec.ts`. Fix: `e2e/support/ports.ts` →
`freePort()` fragt das Betriebssystem (Port 0); beide Specs und `streamPort` nutzen es.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Fix in derselben MR (eigener Commit)
