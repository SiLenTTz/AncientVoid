# EPIC-P6 — Mehrere Rechner in einer Flotte

**Status:** abgeschlossen 2026-09-23 (Retro unten) — WSL-Teil von AC-P6-5 unbelegt, kein WSL-Host in der Flotte (AI-P6-1) · **Phase:** P6 · **Dauer:** 1–2 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P5 grün; WSL-Abnahme aus P4 vorhanden.

Planungsauftrag vom 2026-09-21; kein Umsetzungsstart und keine Behauptung eines
grünen Vorgänger-Gates. Scope, Evidenz und bestehende Restarbeiten:
[Audit](../docs/remote-control-audit-2026-09-21.md), [Index](README.md).

## 1. Ziel

Omarchy, home-server und gpubox/WSL erscheinen in einer Oberfläche. Jede Aktion
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
- [x] **T6.6 — Hostgebundene Nebenpfade (AI-P5-5).** Worktree-Pfad, `openCmd`, tmux-Attach, „Ins Projekt übernehmen“ und Benachrichtigungen tragen die Host-ID und werden nur auf dem eigenen Host ausgeführt bzw. angezeigt. Stand 2026-09-23: Glocke sammelt Meldungen aller Hosts (Präfix, Lese-Stand je Host), Befehle fremder Sessions als `ssh -t <host> …` / `code --remote ssh-remote+<host>`, Übernehmen auf dem Session-Host; E2E `fleet.spec.ts` „T6.6“.
- [x] **T6.5 — Drei-Host-Betrieb.** P4-WSL-Installer verwenden; Omarchy, home-server, gpubox konfigurieren und reale WAN-/Ausfallmessung dokumentieren; Host-Wiederanmeldung ohne Dubletten. K2/K7/K8/K10. Stand 2026-09-23: `scripts/fleet-deploy.sh` (systemd `--user`, nur Tailnet-IP), drei Hosts gekoppelt, Messlauf [`2026-09-23-p6-fleet`](../docs/messlauf/2026-09-23-p6-fleet.md) alle Schritte bestanden, Betrieb in [`docs/fleet.md`](../docs/fleet.md). gpubox ist natives Linux, kein WSL.

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

## Retro (2026-09-23)

**Zeitraum:** 2026-09-23 · **Commits:** 6 (ohne Merges) · **Bugs:**
BUG-0028 (Tokens im Request-Log), behoben. Gate: `npm run gate` grün
(vitest 473, E2E 102); Live-Messlauf auf drei Hosts.

### AK-Matrix

| AC | Bewertung | Beleg | Bemerkung |
|---|---|---|---|
| AC-P6-1 | 🟢 erfüllt | Messlauf `sessions`; E2E `fleet.spec.ts` „beide Hosts in einer Übersicht“ | 20 Sessions auf drei Hosts, je ≥ 2, 0 Duplikate, gleichnamiges Projekt getrennt |
| AC-P6-2 | 🟢 erfüllt | Messlauf `routing` + `logs`; `fleet-routing.test.ts`; `log-redaction.test.ts` | 20/20 beim adressierten Host, keine Tokens in Logs/URLs (BUG-0028) |
| AC-P6-3 | 🟢 erfüllt | Messlauf `outage` (5 min); E2E „ein Host fällt aus“ | andere Hosts bedienbar, Stand mit Original-Zeit, keine verlorenen Events, kein Doppel-Dispatch |
| AC-P6-4 | 🟢 erfüllt | Messlauf `revoke`; `fleet-pairing.test.ts` | Stream < 5 s (2,0 s) zu, Peer ohne Heim-Hub bedienbar |
| AC-P6-5 | 🟡 teilweise | Messlauf `incompatible`, Tailnet-Betrieb, K1 15 ms Median | Tailnet, K1 und Abweisung belegt; **WSL** unbelegt — kein WSL-Host in der Flotte → AI-P6-1 |

**Summe:** 4 🟢 / 1 🟡 / 0 🔴 / 0 ⚪

### Premortem

| Risiko | Eingetreten? | Beleg |
|---|---|---|
| 1. Zentrale Übersicht wird Ausfallpunkt | nein | Messlauf `revoke`: gpubox bei gestopptem Heim-Hub bedienbar; jeder Hub hat seine PWA |
| 2. Falscher Host bei gleichem Projektnamen | nein | `ancientvoid-alpha` auf zwei Hosts getrennt; Eingaben 20/20 richtig |
| 3. Netzausfall tarnt sich als Providerfehler | nein | Host-Zustände (offline/veraltet) getrennt von `provider.error` (ADR-0015) |
| 4. WSL-Neustart ändert Erreichbarkeit | nicht prüfbar | kein WSL-Host; Wiederanmeldung nach Neustart für Linux belegt (584 ms) |

### Erkenntnisse

1. **Heim-Hub als Aggregator hat getragen** — kein CORS, kein Peer-Token im Browser, und die PWA brauchte nur eine Host-Schicht (API-Kontext), keine zweite App (ADR-0017, `api-context.ts`).
2. **Namen im Heimnetz sind nicht die Tailnet-Namen** — `home-server` löste über die Fritzbox ins LAN auf, der Hub lauscht nur auf der Tailnet-IP; Peers werden mit `<name>.<tailnet>.ts.net` gekoppelt (`docs/fleet.md`).
3. **Deploy-Skripte brauchen dieselbe Prüfung wie Code** — `ssh … bash -s -- <json>` verlor die Anführungszeichen; der Hub startete nicht. Behoben mit base64-Argumenten; das Skript prüft jetzt die Erreichbarkeit selbst.
4. **Credentials in URLs sind ein Log-Risiko** — erst die AC-Prüfung „keine Credentials im Log“ fand 14 echte Tokens (BUG-0028).
5. **Echte Rechner decken Annahmen auf** — „gpubox/WSL“ ist natives Arch; der Plan ging von WSL aus.

### Action Items

| ID | Maßnahme | zurück als |
|---|---|---|
| AI-P6-1 | WSL-Host in die Flotte aufnehmen (kein bmax — Trading-Maschine, Nutzentscheid 2026-11-07; Host offen), Abnahme AC-P6-5 WSL-Teil und Premortem 4 | EPIC-P35 (Endabnahme-Block) T35.13 |
| AI-P6-2 | QR-Code für den Einladungscode (Handy scannt statt tippt) | ✅ erledigt 2026-09-23 (`InviteQr.tsx`, E2E „AI-P6-2 … scannen und verbinden“) |
| AI-P6-3 | Last über die Weiterleitung (K8, 30 ev/s × Sessions über zwei Hosts) | EPIC-P12 T12.2 |
| AI-P6-4 | Vorhandene Tokens rotieren und `/tmp/ancientvoid-hub.log` leeren (BUG-0028) — vor der Veröffentlichung | EPIC-P12 T12.7 |

