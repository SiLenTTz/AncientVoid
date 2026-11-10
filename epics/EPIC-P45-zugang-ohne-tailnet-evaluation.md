# EPIC-P45 — Optionaler Zugang ohne Tailscale: Bedarf, Account und Transport

**Status:** Planungsentwurf · **Umsetzung:** gesperrt · **Phase:** P45
**Dauer:** 0,5–1 Agenten-Wochen Evaluation (grobe Schätzung); Umsetzung separat zu entscheiden
**Abhängigkeit:** P44 mit nachweislich grünen Exit-Kriterien; wirksame Vorgänger-Abnahmen bleiben bindend.

Quelle: [Orca-Vergleich](../docs/2026-11-08_orca-vs-ancientvoid.md) und [Planungsgrundlage mit Übernahmeregister](../docs/2026-11-08_orca-epic-planung.md).
**Planungsauftrag 08.11.2026:** Nutzer beauftragt diese Epics ausdrücklich vor Abschluss der Vorgänger. Das erlaubt Planung, keine Implementierung und keine Aufhebung des Epic-Gatings. Vor T45.1 aktuellen Code-/Test-/Abnahmestand prüfen; historische Überschriften reichen nicht.

## 1. Ziel

Informiert entscheiden, ob neben dem bewährten Tailnet-Zugang ein optionaler privater PWA-Zugang ohne Tailscale benötigt wird. Account-Anmeldung und Netzwerktransport getrennt bewerten. K1/K5/K7/K10; kein aktueller Veröffentlichungsauftrag.

## 2. Scope (In / Out)

**In:** Bedarf/Bedrohungsmodell, Vergleich unverändert/Tailscale, eigener HTTPS-/Tunnelpfad, selbst betriebener Relay und optionaler Account-Identity-Provider; kleiner isolierter PoC nur mit Testdaten, Betriebs-/Kosten-/Recovery-Matrix, dokumentierter Go/No-go/vertagt-Exit.
**Out:** Produktivport öffnen, DNS/Firewall verändern, externe Accounts/Abos anlegen, Hersteller-Relay übernehmen, eigener OAuth-/Kryptographie-Stack, Nutzerentscheidung vorwegnehmen oder native App fordern.

## 3. Design-Details

### 3.1 Offene Entscheidung respektieren
Auftrag vom 08.11.2026: PWA bleibt; Nutzer ist beim Account-Zugang ausdrücklich unentschieden. Dieses Epic ist Evaluation und keine implizite Freigabe für Internet-Exposition. Ergebnis darf No-go oder vertagt sein. Keine Antwort ist kein Go. Bestehendes Loopback+Tailscale bleibt währenddessen unverändert. Die lineare Position ist Planung, keine Aussage, dass Zugang erst nach allen UI-Features fachlich erforscht werden könnte; Umpriorisierung nur explizit im Index.

### 3.2 Transport ist nicht Anmeldung
Login verschafft dem Handy keine Route zum Hub hinter NAT. Jeder Vorschlag benennt Transport (Reverse-Tunnel/Relay/eigener erreichbarer Proxy), Authentifizierung (Device-Pairing/Passkey/optional OIDC), Autorisierung/Revocation und Speicher-/Recoverypfad separat. Device-Tokens und Actor-Policy weiterverwenden, bestehende Tailscale-Identitätschecks nicht ungeprüft hinter externem Proxy vertrauen. Keine Behauptung „OAuth macht Hub sicher öffentlich“. Vorhandene Standards/Bibliotheken nur nach eigener Versions-/Sicherheitsprüfung; konkrete Architektur-ADR erst nach ausgewählter Variante.

### 3.3 Entscheidungsmatrix
Für jede Variante Installation auf Server/Handy, eigener Betrieb/Abhängigkeiten, Credentials, öffentlicher Angriffspfad, TLS/Origin/CSRF/WS, E2EE-Vertrauensgrenze, Quotas/Abuse, Mobile-Pushpfad, Offline/Revocation und Backup/Restore vergleichen. Ein selbst betriebener Relay braucht Netzwerk-/Hostingbetrieb und möglicherweise andere Push-Infrastruktur; Login ersetzt keine APNs/FCM-/WebPush-Anforderungen. Familien-/Multiuser-Rechte sind kein automatisch mitgeliefertes Feature. Direkter lokaler LAN-Zugang ebenfalls konkret prüfen, statt „nur Tailscale technisch möglich“ als Naturgesetz zu behandeln.

### 3.4 Orca als Referenz
Orca hat direkte private Netzwerkmodi und optional Relay; die Relay-/Push-Runtime und Wire-Contracts sind öffentlich, Produktions-Infrastruktur laut `cloud/README.md` teilweise privat. Repo-Teil verfügbar heißt nicht sofort selbst betreibbarer vollständiger Accountdienst. E2EE-Code ist hoch gekoppelt und muss nicht kopiert werden, um weniger Tipparbeit zu haben. Nur Zustands-/Pairing-/Revocation-Tests als erste Referenz; kein Copy-and-paste von Schlüsselaustausch.

### 3.5 Abschluss
Ergebnis unter `docs/` mit eigener Präferenz, Kosten, Risiken, PoC-Protokoll und offenen Voraussetzungen ablegen. Nutzerentscheidung getrennt vom Bewertungsdokument erfassen. Bei Go neues abgegrenztes Implementierungsepic mit ADR/Contracts und eigener öffentlicher Sicherheitsabnahme; hier keine optionalen halbfertigen Infrastrukturänderungen. Voidwarden und Sprachausgabe bleiben davon unabhängig.

### Orca-Referenzen und Übernahmegrenzen

Alle Links auf Commit `bdeb388d75120b6e36dd619291286de0cc9aae02`. Einstufung ist eine geprüfte Port-Hypothese, keine behauptete fertige AV-Kompatibilität. Vor Übernahme Imports/Lizenz/Tests/Strip-Type-Tauglichkeit erneut prüfen; keine großen Orca-Subsysteme blind kopieren.

| Quelle | Verwendung in AV |
|---|---|
| [cloud/README.md](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/cloud/README.md) | Public Relay/Push vs. private Produktionsinfrastruktur; Betriebsreferenz, kein Komplettdienst zum Kopieren. |
| [cloud/packages/relay-contract/package.json](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/cloud/packages/relay-contract/package.json) | Wire-Vertrags-Paket als Größen-/Abhängigkeitsreferenz. |
| [src/main/runtime/rpc/server/pairing/device-registry-save-race.test.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/runtime/rpc/server/pairing/device-registry-save-race.test.ts) | Pairing-/Persistenz-Race als Testreferenz, nicht fremden Auth-Stack portieren. |
| [docs/site/content/docs/remote-servers.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/remote-servers.mdx) | Direkte/Tailscale-/Headless-Modi gegen Relay-Behauptungen abgrenzen. |

## 4. Aufgaben (Checkliste T45.m)

- [x] **T45.1** Konkrete Nutzungssituationen ohne Tailscale und bestehende LAN-/Tailnet-/Pairingpfade erfassen; Nutzerpräferenz als offen dokumentieren. **K1/K10**. — Bestand: [docs/2026-11-10_p45-zugangsbestand.md](../docs/2026-11-10_p45-zugangsbestand.md) (2026-11-10, Start vor P44 auf Nutzeranweisung, Präferenz offen).
- [ ] **T45.2** Transport/Auth/Autorisierung/Push/Betrieb je Variante vergleichen, Orca-Public/Private-Grenze und Abhängigkeiten belegen. **K5/K7**.
- [ ] **T45.3** Falls ohne Außenwirkung möglich: isolierter localhost-PoC mit Testidentitäten für Reconnect/Revocation/Origin-/WS-Fehler; sonst Voraussetzungen statt erfundenem Test nennen. **K1/K7/K10**.
- [ ] **T45.4** Entscheidungsbericht mit Kosten und No-go-/Vertagungsoption; keine Produktivänderung, keine Zugangsdaten in Bericht. **K5/K7**.
- [ ] **T45.5** Expliziten Nutzerentscheid erfassen; bei Go eigenständigen Implementierungsumfang planen, bei ausstehendem Entscheid Status offen belassen. **K1/K7/K10**.

## 5. Acceptance Criteria (AC-P45-k)

- **AC-P45-1:** Mindestens unverändert, eigener HTTPS-/Tunnelpfad und Relay sind nach Transport/Auth/Autorisierung/Betrieb verglichen.
- **AC-P45-2:** Bericht erklärt konkret, was ein Account löst und was eine zusätzliche Netzwerkroute benötigt.
- **AC-P45-3:** Öffentliche/private Orca-Bausteine und eigener Betriebsaufwand sind belegt; kein behaupteter turnkey Accountdienst.
- **AC-P45-4:** Kein Produktivport, Dienstkonto, DNS, Firewall, Secret oder bestehendes Pairing wurde verändert.
- **AC-P45-5:** Evaluationsergebnis und Nutzer-Go/No-go/vertagt sind getrennt; ohne Antwort bleibt Entscheid offen und kein Implementierungsstart.

## 6. Premortem (Failure-Modi + Mitigation)

1. Login wird für Netzwerkzugang gehalten → Transport und Identity in jedem Vorschlag getrennt benennen.
2. Evaluation veröffentlicht nebenbei Hub → nur isolierte Testdaten, keine Produktiv-Netzänderung im Scope.
3. Kryptocode spart Tokens, schafft unbekannte Garantie → Standards/Tests und Prüfung statt Blindport.
4. Offene Präferenz wird als Zustimmung interpretiert → expliziter dokumentierter Entscheid; Schweigen bleibt offen.

## 7. Definition of Done

Dies ist ein **Evaluations-Epic**. Dokumentation/PoC geprüft, Quellen gepinnt, Nutzerentscheidung wie AC-P45-5 explizit festgehalten; keine produktive Umsetzung. Für den späteren Implementierungs-Exit gelten `npm run gate` grün, PWA-Build, Pipeline-Job `e2e` grün bzw. Infrastrukturfall nach `docs/ci-runbook.md` nachgezogen (nie Pass), neue Specs in `e2e/specs/` sowie isolierte Auth-/Netzwerk-/Recovery-Abnahme. Ein Go allein ist noch kein gebauter Zugang.
