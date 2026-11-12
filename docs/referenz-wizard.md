# Referenz: Setup-Wizard (`setup.sh`)

**Art:** referenz

> Generiert von `scripts/gen-reference.mjs` (`npm run docs:reference`) aus dem Skriptkopf von `setup.sh`.
> Nicht von Hand bearbeiten — `npm run check:context` scheitert bei veraltetem Stand.

## Flags

```text
--yes                keine Rückfragen, Defaults (Adapter: dummy)
--adapter=<id>       dummy|claude|codex|opencode|copilot|pi|hermes|
                    dsh|openai (openai fragt baseUrl/model, bzw.
                    --base-url/--model)
--device-label=<n>   Name fürs Device-Token (Default: hostname)
--port=<n>           Port des Hubs (Default aus Config-Beispiel: 7373;
                    nützlich, wenn dort schon ein Hub läuft)
--voidwarden         zusätzlich agent:- und display:-Token für
                    VoidWarden ausstellen (Kaskade, s. README)
--no-pwa             PWA nicht bauen
--no-start           Hub nicht starten
```

## Exit-Codes

| Code | Bedeutung |
|---|---|
| 0 | ok |
| 2 | Voraussetzung fehlt oder ungültige Eingabe (Option, Adapter, baseUrl/Modell) |
| 3 | Config/Daten kaputt |
| 4 | Token/Hub-Start fehlgeschlagen |
| 5 | npm install fehlgeschlagen |
| 6 | Port belegt von einem Hub/Dienst, der nicht zu diesem Checkout gehört |
