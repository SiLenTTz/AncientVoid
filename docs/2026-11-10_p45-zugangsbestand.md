# P45 / T45.1 — Bestand der Zugangspfade (Stand 2026-11-10)

Teil der Evaluation aus [EPIC-P45](../epics/EPIC-P45-zugang-ohne-tailnet-evaluation.md).
Dies ist **Bestandsaufnahme, keine Empfehlung und kein Go**. Die Nutzerpräferenz
(Account-Zugang ohne Tailscale) ist ausdrücklich **offen** (AC-P45-5). Keine
Produktivänderung, kein Port, kein DNS, keine Firewall, kein Secret berührt (AC-P45-4).

**Gating:** P45 hängt linear an P44. Der Start vor P44-Abschluss erfolgte auf
ausdrückliche Nutzeranweisung vom 2026-11-10 (parallel zu den letzten P42-Schritten);
die Evaluation ist reine Dokumentation und kollidiert mit keinem Code-Epic.

## 1. Heute vorhandene Pfade

| Pfad | Mechanik | Beleg |
|---|---|---|
| Loopback + `tailscale serve` (Standard) | Hub bindet `127.0.0.1`; `tailscale serve --bg --https=443` terminiert TLS im Tailnet, kein öffentlicher Port | `scripts/setup-tailscale-serve.sh`, `apps/hub/src/main.ts:376` |
| Tailnet-Identitätszwang (optional) | `enforceTailnetIdentity` verlangt den von `tailscale serve` injizierten Header `Tailscale-User-Login`; direkte LAN-Treffer erhalten 401 | `apps/hub/src/platform/auth.ts:15,47` |
| Device-Token (immer) | Bearer-Token, SHA-256-Hash in SQLite, Klartext einmalig via `hubctl token issue` | `docs/security.md` §1, `auth.ts:extractToken/checkAuth` |
| Direktes LAN | `ANCIENTVOID_EXPOSE=1` hebt den Loopback-Bind auf (`0.0.0.0`); Header-Check bleibt wirksam, wenn `enforceTailnetIdentity` an ist | `main.ts:368–371` |
| Fleet-Pairing Hub↔Hub | Einmalcode/Invite, danach Fleet-Token mit eingeschränkter Routenmenge | `apps/hub/src/modules/fleet/fleet.routes.ts` (ADR-0017), `auth.ts` Fleet-Zweig |
| WebAuthn/Passkey | nur für `destructive`-Freigaben, nicht für Login; rpId/Origin kommen aus `HubConfig.webauthn` (Default `localhost`, für echtes Deployment zu überschreiben) | `apps/hub/src/modules/identity/webauthn.ts` |
| Web-Push | VAPID-basierter `PushService` im Core | `packages/core/src/modules/push/` |

## 2. Beobachtungen für die Bewertung (noch ohne Wertung)

1. **Der Tailnet-Check ist Header-Vertrauen.** `Tailscale-User-Login` ist nur
   dann ein Identitätsbeleg, wenn ausschließlich `tailscale serve` davor steht. Hinter
   einem anderen Proxy/Tunnel kann der Header gefälscht werden. Jede Variante ohne
   Tailscale muss `enforceTailnetIdentity` ausschalten oder ersetzen — und darf das
   nicht stillschweigend tun (Premortem 2, P45 §3.2).
2. **Device-Token ist der tragende Faktor.** Ohne Tailnet-Header bleibt Bearer-Token
   die einzige Authentifizierung für Lese-/Schreib-Routen. Token-Übergabe per
   `?token=`-Query ist im Code zugelassen (`extractToken`) und würde hinter einem
   Proxy in Zugriffslogs landen — für Relay-/Tunnelvarianten zu bewerten.
3. **Transport ≠ Anmeldung.** Ein Account/Login liefert dem Handy keine Route hinter
   NAT. Heute löst Tailscale beides (Route + Identität); eine Alternative muss beides
   getrennt benennen (Transport, Authn, Authz/Revocation, Recovery).
4. **WebAuthn ist origin-gebunden.** Ein neuer Hostname/Origin (eigene Domain,
   Relay) entwertet bestehende Passkey-Registrierungen → Migrationsfrage.
5. **Push ist transportunabhängig vom Login.** VAPID/Web-Push braucht eine vom Push-
   Dienst erreichbare Subscription und HTTPS-Origin; ein Relay ändert diesen Pfad
   unter Umständen (offen für T45.2).
6. **Direktes LAN ist technisch vorhanden**, aber ohne TLS (`http://`) → keine
   PWA-Installation/Service-Worker/WebAuthn auf dem Handy außer über `localhost`;
   braucht eigenes Zertifikat, bevor es eine echte Option ist.

## 3. Konkrete Nutzungssituationen ohne Tailscale (zu bestätigen)

Bewusst als **Hypothesen** geführt, bis die Nutzerin/der Nutzer sie bestätigt:

- Handy ohne installierten Tailscale-Client (fremdes/Leihgerät, eingeschränktes Profil).
- Netze, die Tailscale/WireGuard blockieren (Firmen-/Hotel-WLAN).
- Zugang für Dritte (Familie/Review) ohne Tailnet-Einladung.
- Reiner Heimnetz-Zugriff ohne Internet (LAN-Variante).

## 4. Offen / nächste Schritte

- Nutzerpräferenz und tatsächliche Situationen aus §3 bestätigen lassen (T45.5 bleibt offen).
- T45.2: Variantenvergleich (unverändert, eigener HTTPS-/Tunnelpfad, selbst betriebener
  Relay, LAN+eigenes Zertifikat) mit Orca-Public/Private-Grenze (`cloud/README.md` auf
  gepinntem Commit `bdeb388d…`).
- T45.3 nur als isolierter localhost-PoC mit Testidentitäten, sonst Voraussetzungen nennen.
