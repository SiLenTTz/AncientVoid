# Messlauf — K1/AC-P2-3: Biometrisches Approve-Latenz

**Datum:** 2026-09-18 · **Commit:** `906fd7a` · **Messlatte:** K1 (Approve-Latenz),
AC-P2-3 ("Biometrisches Approven eines force-push aus der Queue: Push →
WebAuthn → Hub-Ack in < 5 s (95. Perzentil über 20 Messungen im Test)")

## Umgebung

- Node v26.7.0, Linux 7.1.9-arch1-2 x86_64, 16 Kerne (Maschine sonst in Ruhe)
- Browser: System-Chromium (`/usr/bin/chromium`) über Playwright `^1.63.0`,
  echter virtueller Authenticator via CDP (`WebAuthn.addVirtualAuthenticator`,
  `protocol: "ctap2"`, `hasUserVerification: true`, `isUserVerified: true`)
- `@simplewebauthn/browser@14.0.0` (UMD-Bundle, lokal aus `node_modules`,
  kein Netzwerkzugriff aus dem gemessenen Browser-Kontext)
- Hub: `createHubApp` in-process, echter Fastify-Listener auf `127.0.0.1:7391`,
  echte SQLite (`:memory:`), `ApprovalService`/`WebAuthnStore` real verdrahtet

## Kommando

```bash
node scripts/messlauf-approve-latency.mjs --runs 20
```

## Was gemessen wurde

Fensterstart: der Moment, in dem der Client (im Browser) die
`assert-options`-Anfrage abschickt. Fensterende: der Moment, in dem die
`decide`-Antwort (nach echter WebAuthn-Zeremonie und echter
Server-Verifikation über `@simplewebauthn/server`) beim Client ankommt.
**„Push" ist ehrlich außerhalb dieses Fensters**, weil dieser Hub keine
echte Mobile-Push-Infrastruktur hat (dieselbe Lücke wie EPIC-P2 T2.7s
Budget-Warnung) — gemessen wird der Teil ab „Client fragt WebAuthn-Optionen
an", nicht ab einer nie existierenden Push-Zustellung.

## Rohzahlen (ms, n=20, aufsteigend sortiert)

```
8, 9, 9, 9, 9, 9, 9, 9, 9, 10, 11, 11, 12, 12, 12, 12, 14, 16, 18, 20
```

| Kennzahl | Wert |
|---|---|
| min | 8 ms |
| median | 11 ms |
| p95 | 20 ms |
| max | 20 ms |

**Ergebnis: PASS** — p95 20 ms liegt weit unter der 5000-ms-Grenze aus AC-P2-3.

## Streuung

Sehr eng (8–20 ms Spanne über 20 echte Läufe) — kein Ausreißer, keine
Wiederholung mit anderem Seed nötig, die Zahl ist bereits stabil.

## Was das nicht sagt

- **Keine echte Netzwerklatenz enthalten.** Hub und Browser laufen auf
  derselben Maschine über `localhost` — ein echtes Handy über Tailscale
  hätte reale Netzwerk-Rundlaufzeit obendrauf, die diese Zahl nicht
  abbildet.
- **Kein echter Fingerabdruck-/PIN-Prompt.** Der virtuelle Authenticator
  (`automaticPresenceSimulation: true`) antwortet sofort — die reale
  menschliche Interaktionszeit (Finger auflegen, PIN tippen) ist auf einem
  echten Gerät ein zusätzlicher, hier nicht gemessener Faktor. AC-P2-3s
  Grenze von 5 s ist vermutlich genau dafür so großzügig bemessen.
- **Kein echter Mobile-Push gemessen** (siehe oben) — dieser Hub hat keine
  Push-Infrastruktur zu diesem Zeitpunkt.
- Gemessen mit dem `dummy`-Adapter/keiner echten Session-Last nebenher —
  eine Maschine mit mehreren aktiven LLM-Adapter-Sessions könnte durch
  CPU-Konkurrenz (Node Event-Loop) höhere Werte zeigen.
