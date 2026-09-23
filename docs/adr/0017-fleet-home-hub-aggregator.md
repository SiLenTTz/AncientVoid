# ADR-0017 — Flotte: Heim-Hub aggregiert, jeder Hub bleibt Quelle

**Status:** akzeptiert · **Betrifft:** EPIC-P6 T6.1–T6.6,
`packages/contracts/src/fleet.ts`, `packages/server/src/{routes,fleet}.ts`,
PWA

## Kontext

Omarchy, silenttz-server und evox2 sollen in einer Oberfläche erscheinen
(EPIC-P6). Zwei Wege standen offen: der Browser spricht jeden Hub direkt an,
oder ein Heim-Hub aggregiert und leitet weiter.

## Entscheidung

**Heim-Hub als Aggregator.** Das Handy spricht nur mit seinem Hub (ein
Ursprung, ein Geräte-Token). Der Heim-Hub hält für jeden gepaarten Hub ein
hostgebundenes Token und leitet nur freigegebene Pfade dorthin weiter.

Gegen den Direktzugriff sprachen: Cross-Origin zwischen Tailnet-Namen
(CORS, Cookies, Service Worker je Ursprung), ein Token pro Host im
Browser-Speicher, und die PWA müsste jede Host-URL kennen.

1. **Identität.** Jeder Hub hat eine `hostId` (Konfig oder Hostname als
   Slug, `HOST_ID_PATTERN`). Nach außen trägt jede Session diese `hostId`;
   intern bleibt `local`. Globaler Schlüssel: `hostId` + Session-ID.
   Projektnamen sind nicht eindeutig und nie Schlüssel.
2. **Hello.** `GET /api/fleet/hello` (ohne Token) liefert `hostId`,
   `protocolVersion` (`FLEET_PROTOCOL_VERSION`), Hub-Version, Serverzeit.
   Ungleiche Protokollversion → Host `incompatible`, keine Weiterleitung.
3. **Pairing (T6.2).** Der Ziel-Hub erzeugt einen kurzlebigen Einmalcode;
   der Heim-Hub tauscht ihn gegen ein Token mit Label `fleet:<heim-hostId>`.
   Gespeichert nur im Heim-Hub (Datenbank im Datenordner, nie in URLs/Logs).
   Revoke auf dem Ziel-Hub sperrt neue Requests sofort und laufende Streams
   binnen 5 s.
4. **Routing (T6.4).** `/api/hosts/:hostId/<pfad>` → nur an die beim Pairing
   gespeicherte URL, nur Pfade aus einer Positivliste (Sessions, Events,
   Adapter, Projekte, Skills, Verbessern, Suche, Benachrichtigungen,
   Freigaben). Keine freie URL-Weiterleitung; Fleet-, Token- und
   WebAuthn-Pfade werden nie weitergeleitet. Idempotenz (Input-ID, Lease)
   aus P5 gilt Ende-zu-Ende.
5. **Aggregation (T6.3).** `GET /api/fleet` mischt eigene Sessions mit den
   Listen der Peers (parallel, Timeout 3 s). Pro Host: Zustand
   (`reachable`, `stale`, `offline`, `incompatible`, `unauthorized`) und
   Zeit der letzten Synchronisierung; ein ausgefallener Host behält seinen
   letzten Stand mit Original-Zeitstempel.
6. **Ausfall.** Jeder Hub liefert weiter seine eigene PWA; ein Ausfall des
   Heim-Hubs nimmt nur die Gesamtsicht weg.

## Konsequenzen

- Der Heim-Hub ist für Weiterleitung Vertrauensanker; Peer-Tokens sind
  auf das Label `fleet:<heim>` beschränkt und einzeln widerrufbar.
- Große Flotten brauchen Paging über Hosts; für drei Hosts reicht das
  parallele Laden (K8 gemessen in T6.5).
