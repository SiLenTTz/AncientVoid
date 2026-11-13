# Geräte koppeln, Tokens widerrufen

**Art:** how-to

Jedes Gerät (Handy, Tablet, zweiter Rechner) bekommt ein **eigenes**
Device-Token — so lässt sich ein verlorenes Gerät einzeln sperren. Das Token
wird nur einmal angezeigt; der Hub speichert nur den SHA-256-Hash
(PRD §8). Alle Befehle: [`referenz-hubctl.md`](referenz-hubctl.md).

## Neues Gerät koppeln

1. Hub für das Gerät erreichbar machen (einmalig pro Rechner):
   `scripts/setup-tailscale-serve.sh 7373` druckt die `https://…ts.net`-Adresse.
   Es wird **kein Port geöffnet**; das Gerät muss im selben Tailnet angemeldet sein.
2. Token ausstellen:
   ```bash
   node apps/hubctl/src/cli.ts token issue "pixel-9" --db data/hub.db
   ```
3. Token auf einem selbst gewählten sicheren Weg aufs Gerät bringen
   (Passwortmanager, „an mich selbst senden“). **Nie** an eine URL hängen
   (Browserverlauf) — Begründung: [ADR-0073](adr/0073-handy-kopplung.md).
4. Adresse aus Schritt 1 im Gerät öffnen, unter **Device-Token** eintragen,
   **Verbinden** tippen.

## Gerät sperren (verloren, verkauft)

```bash
node apps/hubctl/src/cli.ts token list --db data/hub.db
node apps/hubctl/src/cli.ts token revoke "pixel-9" --db data/hub.db
```

Das Gerät bekommt ab sofort 401 und zeigt im Token-Gate, dass der Hub das
Token ablehnt. Danach bei Bedarf ein neues Token mit neuem Namen ausstellen.

## Token verloren

Ein Token ist nicht wiederherstellbar. `token revoke <name>`, dann
`token issue <name>` — der Wizard (`./setup.sh`) stellt bei einem zweiten
Lauf bewusst **kein** weiteres Token aus.

## Rollen

`agent:` liest nur (für Tools wie VoidWarden), `display:` liest und
entscheidet zulässige Freigaben, ein normales Device-Token ist ein
Menschen-Gerät. Hintergrund und Grenzen: [`security.md`](security.md).
Display-Tokens: `token issue <name> --display` (Optionsfragen nur mit
`--answer-questions`, ADR-0066).

`--db` zeigt auf die Datenbank des laufenden Hubs (Standard des Wizards:
`data/hub.db`; bei anderem `dataDir` den Pfad anpassen).
