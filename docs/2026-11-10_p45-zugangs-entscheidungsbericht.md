# P45 — Entscheidungsbericht: Zugang ohne Tailscale (Stand 2026-11-10)

Ergebnis der Evaluation aus [EPIC-P45](../epics/EPIC-P45-zugang-ohne-tailnet-evaluation.md)
(T45.2–T45.4). Bestand: [p45-zugangsbestand](2026-11-10_p45-zugangsbestand.md).
**Dies ist Bewertung, kein Beschluss.** Der Nutzerentscheid (Go/No-go/vertagt) ist
getrennt zu erfassen (AC-P45-5) und liegt **nicht** vor — Status: **offen, kein Implementierungsstart**.

## 1. Was ein Account löst — und was nicht (AC-P45-2)

| Frage | Account/Login | Zusätzliche Netzwerkroute |
|---|---|---|
| Wer ist das Handy? (Authn, Revocation) | ja (Device-Token/Passkey/OIDC) | nein |
| Wie erreicht das Handy einen Hub hinter NAT? | **nein** | ja (Tunnel, Relay oder erreichbarer Proxy) |
| Push aufs Handy | nein (braucht Web-Push/APNs/FCM-Pfad) | nein |
| Vertrauen in Zwischenstation (E2EE) | nein | Designfrage der Variante |

Heute liefert Tailscale beides (Route + Identitätsheader). Jede Alternative muss
Transport und Identität getrennt ersetzen.

## 2. Varianten (AC-P45-1)

| | A: unverändert (Loopback + `tailscale serve`) | B: eigener HTTPS-/Tunnelpfad (z. B. Reverse-Tunnel/Proxy auf eigener Domain) | C: selbst betriebener Relay (Orca-Muster) | D: LAN + eigenes Zertifikat |
|---|---|---|---|---|
| Transport | WireGuard-Tailnet | Tunnel zu öffentlich erreichbarem Endpunkt | Hub und Handy öffnen ausgehende WebSockets zum Relay, Relay spleißt Frames | direkt im Heimnetz |
| Authn | Device-Token (+ optional Tailnet-Header) | Device-Token, neu: Passkey/OIDC nötig, da Header-Check entfällt | Device-Pairing/Schlüssel (Orca: X25519), Token | Device-Token |
| Öffentlicher Angriffspfad | keiner | **ja** (TLS-Endpunkt, Brute-Force, WS/Origin/CSRF) | **ja** (Relay), Hub bleibt ausgehend | keiner (nur LAN) |
| Betrieb/Kosten | Tailscale-Client auf beiden Seiten | Domain, Zertifikate, Tunnel-Dienst, Härtung | Relay-Hosting + DB, Rollen/Zellen, Signing-Key, Wartung | Zertifikat im Heimnetz, Handy muss im LAN sein |
| Push | unverändert (Web-Push) | Origin ändert sich → Subscriptions neu | ggf. eigene Push-Infrastruktur nötig | unverändert, nur im LAN erreichbar |
| WebAuthn | bestehende rpId | **Origin-Wechsel entwertet Passkeys** | wie B | eigener Origin → neu registrieren |
| Offline/Revocation | Token widerrufbar, Tailnet-ACL | Token widerrufbar | Token + Relay-Geräteliste | Token widerrufbar |
| Aufwand (grob, ohne Zusage) | 0 | mittel–hoch (+ Sicherheitsabnahme) | hoch (eigener Dienst) | niedrig–mittel |
| Löst „kein Tailscale auf dem Handy“ | nein | ja | ja | nur im Heimnetz |

## 3. Orca als Referenz: öffentlich vs. privat (AC-P45-3)

Belegt am gepinnten Commit `bdeb388d75120b6e36dd619291286de0cc9aae02`
(`cloud/README.md`, `docs/site/content/docs/remote-servers.mdx`):

- **Öffentlich (MIT):** Relay-Quelltext (`apps/relay`, `packages/relay-contract`),
  Push-Gateway (`apps/push`, `packages/push-contract`), Relay-Fence-Broker,
  Connector-Contract (experimentell). Relay: pnpm-Workspace, einziges Pflicht-Setting
  `ORCA_RELAY_ASSIGNMENT_SIGNING_KEY`, Rollen Director/Cell, PostgreSQL (Produktion)
  bzw. SQLite (Test). Push: Cloud-Run-Dienst, braucht FCM-Projekt, DB, optional APNs.
- **Privat:** Produktions-/Staging-Deployment, Terraform, Runbooks, Betrieb liegen im
  privaten Repo `stablyai/orca-cloud`.
- **Kein Account-Dienst beschrieben:** Weder README noch Remote-Servers-Doku nennen
  einen Account-/Auth-Dienst; Zugang läuft über Pairing-Links und pro Client widerrufbare
  Tokens. Die Doku empfiehlt Tailscale/privates Netz und warnt davor, den Port öffentlich
  weiterzuleiten; Relay wird dort nicht erwähnt.
- **Folge:** Es gibt keinen turnkey Accountdienst zum Übernehmen. Ein eigener Relay wäre
  ein neu zu betreibender Dienst (Hosting, DB, Schlüssel, Push-Provider) mit eigener
  Sicherheitsabnahme. Kein Kryptocode-Blindport; höchstens Pairing-/Revocation-Testideen.

## 4. PoC-Protokoll (T45.3, localhost, ohne Außenwirkung)

Isoliertes Skript außerhalb des Repos (`/tmp`), ruft `checkAuth` aus
`apps/hub/src/platform/auth.ts` mit gefälschten Requests (Testtoken, Test-IP), kein
Netzwerk, keine Produktivdaten, `enforceTailnetIdentity=true`:

| # | Request | Ergebnis |
|---|---|---|
| 1 | gültiger Token, **ohne** Tailscale-Header | 401 `missing tailnet identity` |
| 2 | gefälschter Header, ohne Token | 401 `missing device token` |
| 3 | gefälschter Header + gültiger Token | **ok** |
| 4 | gefälschter Header + Token per `?token=` | **ok** |

**Befund:** Der Header ist nur so vertrauenswürdig wie die Komponente davor. Hinter jedem
anderen Proxy/Tunnel ist `enforceTailnetIdentity` wirkungslos (Fall 3) — der Device-Token
bleibt der einzige echte Faktor. `?token=` (Fall 4) landet in Proxy-/Zugriffslogs.
Nicht getestet (braucht Netz-/Proxy-Aufbau, daher als Voraussetzung statt erfundenem
Test): Reconnect/Revocation über Relay, Origin-/WS-Fehler hinter echtem TLS-Proxy.

## 5. Einschätzung (eigene Präferenz, nicht bindend)

1. **Vertagen/No-go für B und C**, solange kein konkreter Bedarf (siehe Bestand §3) bestätigt ist:
   beide öffnen einen öffentlichen Angriffspfad und schaffen einen Dauerbetrieb für ein
   Solo-Projekt; ein Relay ist ein eigener Dienst samt Push-Frage.
2. **Falls Bedarf bestätigt:** zuerst D (LAN + eigenes Zertifikat) bzw. A belassen; bei
   echtem Remote-Bedarf ohne Tailscale B mit **ersetztem Identitätscheck** (Passkey-Login,
   Header-Check abschalten *und* ausdrücklich dokumentieren) und `?token=` verbieten.
3. **Vor jedem Go:** eigenes Implementierungsepic mit ADR, Contracts, öffentlicher
   Sicherheitsabnahme (Origin/CSRF/WS/Rate-Limit/Revocation) und Recovery-Pfad (K7).

## 6. Kosten/Risiken (Kurzform)

Hoch: öffentliche Angriffsfläche, Betrieb ohne Zweitperson, Passkey-Migration,
Push-Neuaufbau. Mittel: Zertifikatsverwaltung. Niedrig: Status quo.

## 7. Nutzerentscheid (T45.5)

**Offen.** Keine Antwort gilt nicht als Go. Bis zu einer ausdrücklichen Entscheidung
(Go / No-go / vertagt) wird nichts implementiert und nichts am bestehenden Zugang geändert.
Einzutragen: Datum · Entscheid · Begründung.
