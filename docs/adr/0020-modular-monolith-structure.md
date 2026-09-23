# ADR-0020 — Modularer Monolith: nach Fach geschnitten, Grenzen im Gate

**Status:** akzeptiert · **Betrifft:** gesamte Code-Struktur (`apps/`, `packages/`),
`.dependency-cruiser.cjs`, `npm run gate`

## Kontext

Die Paket-Ebene war schon grob richtig geschnitten: `contracts` (Verträge),
`core` (Domäne), `workers`/Adapter (angetrieben) und
`server`/`pwa`/`hubctl`/`gateway-mcp` (antreibend). Innerhalb der Pakete lag
aber alles flach:

- `core/src` hatte 24 Dateien, `server/src` 14 und `pwa/src` 28.
- Vier Dateien trugen den Großteil der Logik: `sessionmanager.ts` (1787
  Zeilen), `SessionTail.tsx` (1230), `styles.css` (1833) und `routes.ts` (741).
- Ein Fachthema wie die Flotte lag in sechs Dateien in vier Paketen.
- Abhängigkeiten liefen teils verkehrt herum, z. B. `identity` (`tokens.ts`)
  → `sessions`.

Neue Funktionen landeten deshalb dort, wo gerade Platz war.

## Entscheidung

**Modularer Monolith nach Fach (Vertical Slices) mit Ports & Adapters.** Der
Code wird nach Fachthema geordnet, nicht nach Technik. Jedes Modul hat eine
öffentliche `index.ts`; alles andere ist intern.

```text
apps/                       lauffähige Programme (treibende Adapter)
  hub/src/                  HTTP/WS-Server
    app.ts, routes.ts       Zusammensetzung (createHubApp, alle Modul-Routen)
    route-context.ts        Abhängigkeiten + gemeinsame Helfer der Routen
    modules/<modul>/        <modul>.routes.ts + Dienste des Moduls (diff, ws,
                            enhance, search, webauthn, fleet-proxy …)
    platform/               auth, http-json
  pwa/                      src/app/, src/features/<feature>/, src/shared/
  hubctl/  gateway-mcp/
packages/                   Bibliotheken
  contracts/src/<modul>/    Verträge (Ports) — importiert nichts Internes
  core/src/
    modules/<modul>/        sessions, approvals, harness, workspace, discovery,
                            skills, notifications, identity, fleet, reporting,
                            observability — je mit index.ts
    platform/               db (+ Migrationen), eventstore, config, logger, metrics
  workers/                  Worker-Runner (tmux, Prozess)
  adapters/<name>/          claude, codex, opencode, …, testkit
```

**Regeln** (von `dependency-cruiser` im Gate geprüft, `npm run check:arch`):

1. Ein Modul importiert ein anderes nur über dessen `index.ts`.
2. `platform/` importiert keine Module.
3. `contracts` importiert nichts aus dem Repo außer sich selbst.
4. Adapter importieren nur `contracts` (AdapterContext-Isolation, bestehende Invariante).
5. Die PWA importiert weder `core` noch den Hub, nur Typen, die sie selbst spiegelt.
6. Keine Zyklen zwischen Modulen.

Paketnamen (`@uacc/*`) bleiben stabil; nur der Server heißt jetzt `@uacc/hub`.

## Migration

Mechanisch und in kleinen Commits, nach jedem Schritt Gate grün:

1. Verschieben per `git mv` mit einem Werkzeug, das alle relativen Imports
   umschreibt (`^ r`, kein Verhalten geändert).
2. Danach die großen Dateien zerlegen (`sessionmanager.ts` in
   Session-Lebenszyklus, Steuerung, Wiederherstellung und
   Freigabe-Operationen; `SessionTail.tsx` in Ansichten; `routes.ts` in
   Fastify-Plugins je Modul; `styles.css` je Feature).
3. `dependency-cruiser`-Regeln ins Gate aufnehmen.

Die Betriebspfade ziehen mit um: `fleet-deploy.sh`, systemd-Unit, `pwaDir` in
den Hub-Konfigurationen und die E2E-Hilfen.

## Konsequenzen

- Neue Funktionen haben einen festen Ort: ein Modul und seine `index.ts`.
- Grenzverletzungen fallen im Gate auf, nicht erst im Review.
- ADRs vor diesem nennen alte Pfade. Sie bleiben als historische
  Dokumente, wie sie sind.
