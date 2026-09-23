# EPIC-P6 — Mehrere Rechner in einer Flotte

**Status:** in Arbeit seit 2026-09-23 (P5 abgeschlossen, siehe dessen Retro) · **Phase:** P6 · **Dauer:** 1–2 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P5 grün; WSL-Abnahme aus P4 vorhanden.

Planungsauftrag vom 2026-09-21; kein Umsetzungsstart und keine Behauptung eines
grünen Vorgänger-Gates. Scope, Evidenz und bestehende Restarbeiten:
[Audit](../docs/remote-control-audit-2026-09-21.md), [Index](README.md).

## 1. Ziel

Omarchy, silenttz-server und evox2/WSL erscheinen in einer Oberfläche. Jede Aktion
trifft nachweislich den ausgewählten Host; ein Host-Ausfall lässt die anderen
weiterarbeiten. Bezug: PRD G1/G4, K1/K2/K5/K7/K8/K10, Audit G05/G15.

## 2. Scope (In / Out)

**In:** Host-Registry, Pairing, Aggregation, hostgebundene Auth, Routing,
Version-Negotiation, Verbindungszustand und WSL-Integration.
**Out:** öffentliche Ports, zentraler Cloud-Zwang, OS-GUI-Steuerung (P11),
automatisches Verschieben eines laufenden Prozesses auf einen anderen Host.

## 3. Design-Details

ADR entscheidet anhand eines Zwei-Hub-Prototyps zwischen Browser-Direktzugriff
und lokalem Aggregator; keine Doppellösung vorab. Jeder Hub bleibt autonome
Quelle für seine Sessions; keine ungesicherte Master-Datenbank. Zusammengesetzte
IDs vermeiden Kollisionen. Projektnamen sind nicht global eindeutig.

Hostliste/Zuordnungen haben Recovery-Pfad, Credentials nur geschützt und nie
in Links. Pairing bindet Gerät, Host und erlaubte Operationen. Rotation/Revoke
muss auch bestehende WS-Verbindungen berücksichtigen. Keine Bearer-Weitergabe
an beliebige vom Modell/Provider gelieferte URLs. Hoststatus: erreichbar,
veraltet, offline, inkompatibel; nicht automatisch „Agent kaputt“.

WSL-Pfade bleiben auf ihrem Host; native Windows-Pfade werden nicht als
Linux-CWD durchgereicht. Aggregate filtern, sortieren und paginieren unter
K5/K8; für eine einzelne Aktion zählt die Wahrheit des zuständigen Hubs.

## 4. Aufgaben

- [x] **T6.1 — Flotten-Contract und Routing-ADR.** Host-ID, Trust, Protocol-Version, Pfadidentität und Topologie definieren; zwei echte Hub-Prozesse als Spike. K5/K7/K10. Stand 2026-09-23: ADR-0017 (Heim-Hub aggregiert), `contracts/fleet.ts`, Konfig `hostId`, `GET /api/fleet/hello`, Spike `e2e/specs/fleet.spec.ts`.
- [x] **T6.2 — Pairing und Gerätezugriff.** Einmalcode/QR, hostgebundene Tokens, explizite Registrierung, Rotation/Revoke und Gerätestatus; keine freie URL-Weiterleitung. PRD §8; K7/K10. Stand 2026-09-23: Einmalcode (12 Zeichen, 10 min, einmalig; PWA und `hubctl fleet invite`), Token `fleet:<heim>` nur für freigegebene Pfade, Revoke sofort + Streams < 5 s, Entfernen widerruft auf dem Peer; `fleet-pairing.test.ts`, E2E `fleet.spec.ts`. QR offen (Code reicht für die Abnahme).
- [x] **T6.3 — Flottenübersicht.** Host-/Projekt-/Session-Ansicht, globale Braucht-dich-Queue, Teilfehler und letzte Synchronisierung pro Host. K1/K2/K8/K10. Stand 2026-09-23: `GET /api/fleet` (parallel, 3 s), Host-Leiste mit Zustand und Stand-Zeit, Gruppierung Host · Projekt, „wartet auf dich“ über alle Hosts, neue Session auf gewähltem Host; `fleet-aggregate.test.ts`, E2E `fleet.spec.ts`.
- [x] **T6.4 — Hostgebundene Aktionen.** Start/Handoff/Steer/Freigabe über genau den ausgewählten Hub routen; Idempotenz aus P5 und Version-Konflikte testen. K1/K7. Stand 2026-09-23: `/api/hosts/<id>/…` inkl. Event-Stream (Positivliste, kein Traversal), Input-ID Ende-zu-Ende, inkompatibles Protokoll abgewiesen; PWA-Links `#/hosts/<id>/sessions/<sid>`; `fleet-routing.test.ts`, E2E. BUG-0028 (Tokens im Log) nebenbei behoben.
- [ ] **T6.6 — Hostgebundene Nebenpfade (AI-P5-5).** Worktree-Pfad, `openCmd`, tmux-Attach, „Ins Projekt übernehmen“ und Benachrichtigungen tragen die Host-ID und werden nur auf dem eigenen Host ausgeführt bzw. angezeigt.
- [ ] **T6.5 — Drei-Host-Betrieb.** P4-WSL-Installer verwenden; Omarchy, silenttz-server, evox2 konfigurieren und reale WAN-/Ausfallmessung dokumentieren; Host-Wiederanmeldung ohne Dubletten. K2/K7/K8/K10.

## 5. Acceptance Criteria

- **AC-P6-1:** Die drei Zielhosts erscheinen gleichzeitig; 20 Sessions insgesamt, davon mindestens zwei pro Host, vollständig auffindbar. Gleichnamige Projekte/Provider-IDs werden nicht verwechselt.
- **AC-P6-2:** Je Host zehn Eingaben/Freigaben landen ausschließlich beim adressierten Host; keine Credentials im falschen Hub, URL oder Log.
- **AC-P6-3:** Ein Hub 5 min offline: die anderen bleiben bedienbar; alter Stand trägt ursprünglichen Zeitstempel; Reconnect ohne verlorene bestätigte Events oder Doppel-Dispatch.
- **AC-P6-4:** Revoke sperrt neue Requests und bestehende Streams spätestens nach 5 s; lokaler Hub arbeitet bei ausgefallenem Aggregator weiter.
- **AC-P6-5:** Echte WSL- und Tailnet-Abnahme, K8 aggregiert und K1 über den Remote-Pfad belegt; inkompatibler Hub wird sichtbar abgewiesen.

## 6. Premortem

1. **Zentrale Übersicht wird Ausfallpunkt:** lokale Hub-PWA/CLI bleiben nutzbar, keine globale Runtime-Abhängigkeit.
2. **Falscher Host bei gleichem Projektnamen:** qualifizierte IDs, Host im Aktionsplan und Bestätigungsdialog.
3. **Netzausfall tarnt sich als Providerfehler:** getrennte Transport-/Provider-Zustände und Zeitstempel.
4. **WSL-Neustart ändert Erreichbarkeit:** stabile Registrierung, wiederholbare Healthchecks, echter Restart-Test.

## 7. Definition of Done

Alle ACs mit benannten Tests/Messläufen belegt, Vorgänger-Gate geschlossen;
`npm test`, `npm run lint`, `npm run typecheck` grün, PWA-Build bei UI-Änderungen,
Last-/Gerätetests gemäß AC. Contracts first; Adapter-/Event-/Worker-Änderungen
mit ADR. K5-Blob-Grenze, K7-Recovery, AdapterContext-Isolation und Fail-loud
nachgewiesen. Jede Funktion in Config, API/CLI und passender UI tatsächlich
registriert/erreichbar; Capability-/Support-Matrix ehrlich aktualisiert.
Premortem im Abschlussreview gegenprüfen, offene Pflicht-ACs blockieren Abschluss.
Commit/MR gemäß Repo-Workflow; kein lokaler Merge nach main.
