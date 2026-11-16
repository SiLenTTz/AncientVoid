# ADR-0060 — Eigene Modelle und Endpunkte (Hub-Register, pi-Provider)

**Status:** akzeptiert · **Betrifft:** `@ancientvoid/contracts` (`CustomModelInput`, `PiProviderInput`),
`packages/core/src/modules/custom-models/`, `apps/hub/src/modules/harness/harness.routes.ts`,
`packages/adapters/pi`, `packages/models` (`parseModelTable`), PWA `features/new-session/CustomModelDialog.tsx`

## Kontext

Nutzerfund 2026-11-09: In der Modellwahl fehlen Modelle, die der Nutzer nutzen kann — eigene Endpunkte
(das Halogen-Qwen auf gpubox) und Anbieter wie Anthropic in pi/oh-my-pi/maki. Ursachen: pi hatte keinen
Katalog (freie Eingabe), ADR-0054 hielt dafür kein Listenkommando für verifiziert; die Kataloge der
Harnesses zeigen nur Provider mit nutzbarer Anmeldung; und es gab keinen Weg, einen Endpunkt aus der App
anzulegen.

## Entscheidung

1. **pi-Katalog aus `pi --list-models`** (geprüft 2026-11-09, pi 1.4.0; Tabelle `provider model context …`).
   `parseModelTable` macht `provider/model` daraus und erkennt unbekannte Formate nicht an (leer statt geraten).
   `modelsCommand` bleibt die Überschreibung. maki/omp behalten ihre ACP-Probe (ADR-0054).
2. **Hub-Register eigener Modelle** (`config`-Tabelle, Schlüssel `models.custom`, also in Backup/Recovery, K7):
   Id, optionaler Name, Adapter-Liste (leer = alle mit Modellwahl). `GET /api/adapters/:id/models` ergänzt den
   Katalog des Adapters um die Einträge (`customIds` markiert sie); der Eintrag des Adapters gewinnt. Der Hub
   reicht die Id unverändert als `--model` durch — kennt der Harness sie nicht oder fehlt die Anmeldung,
   scheitert der Zug sichtbar (ADR-0054 §5), nie auf einem Ersatzmodell. Keine zweite Katalog-Wahrheit: das
   Register ist eine Ergänzung der Auswahl, keine Fähigkeitsbehauptung.
3. **Endpunkt anlegen — nur pi**: `POST /api/adapters/:id/provider` trägt einen Provider in `models.json` ein
   (dokumentiertes Schema, pi docs/models.md). Bestehende Provider bleiben unberührt, ein vorhandener Name
   braucht `replace`, vorher entsteht eine Sicherung, geschrieben wird atomar mit 0600, kaputtes JSON wird
   nicht angefasst. Der Schlüssel wird als `$UMGEBUNGSVARIABLE` empfohlen (pi interpoliert sie); der Hub
   speichert und loggt ihn nicht selbst. Zielpfad: `PI_CODING_AGENT_DIR` oder `~/.pi/agent` (wie die Sitzungs-
   Erkennung). Für maki, omp und opencode gibt es **keine** Route (501): deren Provider-Formate sind nicht
   geprüft; dort bleiben Config-Datei des Harness bzw. das Register.
4. **Nur Menschen**: alle Schreibrouten verweigern Agenten-Token (403); Eingaben werden mit zod geprüft
   (http(s)-URL, saubere Namen, begrenzte Längen).
5. **Kein Contract-Bruch**: `ModelOption`/`models()` bleiben; neu sind Hub-Routen und Eingabe-Schemata.

## Konsequenzen

- Anthropic & Co. in pi/omp/maki: Id ins Register (Dropdown), Anmeldung bleibt im Harness (`/login`, `maki auth`,
  Umgebungsvariable per `envFiles`) — ohne sie meldet der Harness den Fehler beim Zug.
- E2E und Tests laufen mit `PI_CODING_AGENT_DIR` im Wegwerf-Verzeichnis; die echte `models.json` wird nie berührt.
- Tests: `packages/core/test/modules/custom-models`, `packages/models/test` (Parser),
  `apps/hub/test/modules/harness/custom-models.test.ts`, `e2e/specs/custom-models.spec.ts`.
