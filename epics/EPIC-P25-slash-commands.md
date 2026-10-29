# EPIC-P25 — Slash-Commands: Harness-Commands steuerbar in UACC

**Status:** in Umsetzung (2026-10-29, sofortiger Auftrag nach der Analyse) · **Phase:** P25 · **Dauer:** ~1 Agenten-Woche (Mechanik) + Verifikationsreste · **Abhängigkeit:** fachlich keine; baut auf ADR-0042 und der [Analyse vom 2026-10-29](../docs/slash-commands-analyse-2026-10-29.md) auf. Läuft neben den offenen P12-Abnahmen (Präzedenz P13/P14/P17).

## Ziel

Der Nutzer tippt im Composer "/" und bekommt **nur die Commands angeboten,
die der Harness der Session im getriebenen Modus nachweislich ausführt** —
ungelistete Slashes werden sichtbar als normaler Text gemeldet, nie still
fehlgeleitet. Nutzerwunsch (2026-10-29): „/commands wie /clear oder /new
von OpenCode, Claude und so weiter integrieren."

## Scope / Design

- **Contract (ADR-0042):** `capabilities().commands?: readonly SlashCommand[]`
  mit `{name, description, scope: start|steer|both}` — additiv, optional,
  Transport bleibt normaler Prompt-Text.
- **Fail loud:** leere/fehlende Liste = keine Commands gemeldet; die PWA
  sagt das, statt "/clear" still als Chat zu senden.
- **PWA-Reichweite:** Autocomplete + Hinweis leben ausschließlich im
  Composer (`apps/pwa/src/features/composer/`), Daten aus `/api/adapters`
  — keine Hub-Internas in der PWA (ADR-0020).
- **Nicht im Scope:** Dispatch-Emulation im Hub (abgelehnt, K7), ein
  eigener Steer-Kanal, Voice.

## Aufgaben

- [x] **T25.1 — ADR-0042 + Contract-Feld.** `SlashCommand`-Typ,
  `commands?` in `AdapterCapabilities`, Testkit-Formcheck (Name
  `/^[a-z0-9-]+$/`, eindeutig, Beschreibung, gültiger Scope).
- [x] **T25.2 — Adapter deklarieren (documented).** claude (/clear,
  /compact, both — headless-Doku: Slash-Prompts werden in `-p` ausgewertet,
  Picker-Commands ausgenommen), aider (/clear, /reset, /tokens, /add —
  nur `start`, followUp:false), acp-Presets copilot (/compact, /usage —
  ACP-Doku führt Built-ins als Prompt-Text aus) und omp (/new, /compact —
  Internals-Doku: Dispatch auch im ACP-Modus), dummy (/compact, Testdouble).
  opencode/codex/cursor/pi/hermes/dsh/maki deklarieren **nichts**
  (Verifikation offen — T25.6).
- [x] **T25.3 — Durchreichung.** `/api/adapters` liefert `commands` mit
  (Capabilities-Passthrough, registry streift nichts).
- [x] **T25.4 — PWA-Composer.** "/"-Autocomplete (Vorschläge gefiltert
  nach scope: Neu-Session=start, Antwort=steer), Tastatur (↑/↓, Enter
  übernimmt, Tippen geht immer), Hinweiszeile für ungelistete Slashes
  bzw. „Adapter führt keine /Commands aus". Unit-Tests der reinen Logik.
- [x] **T25.5 — E2E.** Stand-in-claude dispatcht /clear und /compact;
  Spec: Autocomplete → übernehmen → ausgeführt-Event; ungelisteter Slash
  → Hinweis; Adapter ohne Liste → Hinweis.
- [x] **T25.6 — Doku; Verifikationsreste offen.** docs/adapters.md
  Commands-Spalte mit Evidenz-Level (done). **maki live geprüft 2026-10-29
  (negativ):** nativ hat maki Commands (25 Built-ins, Custom-Dateien, Lua),
  getrieben (`-p` und `maki acp`) nicht — Stub-Beweis; Opt-in-Brücke über
  den `agent.user_message`-Slot dokumentiert
  ([Analyse-Nachtrag](../docs/slash-commands-analyse-2026-10-29.md)).
  Live-Verifikation der deklarierten Listen (claude/aider/copilot/omp) und
  Prüfung der restlichen „unklar"-CLIs (opencode run, codex exec,
  cursor -p, pi rpc) bleibt Folgeauftrag — deklariert wird erst nach
  Beleg (R9.7-Standard).

## Acceptance Criteria

- **AC-P25-1:** Eine Session mit deklarierten Commands zeigt im Composer
  ab "/" genau diese (scope-gefiltert); Übernehmen füllt das Feld; der
  gesendete Command läuft als normaler Prompt und die CLI-Antwort ist in
  der Timeline sichtbar. Beleg: E2E `slash-commands.spec.ts`.
- **AC-P25-2:** Ein ungelisteter "/…" und ein Adapter mit leerer Liste
  zeigen einen sichtbaren Hinweis vor dem Senden — niemals ein stiller
  Command-Versuch. Beleg: E2E + Unit-Tests `slash.test.ts`.
- **AC-P25-3:** Der Testkit-Check lehnt malformed commands ab (Name ohne
  "/", Duplikat, leerer Scope). Beleg: `packages/adapters/testkit/test/slash-commands.test.ts`.
- **AC-P25-4:** Kein bestehender Adapter bricht: `commands` ist optional,
  alle Suiten inkl. `check:arch` grün. Beleg: `npm run gate`.

## Premortem

1. **„PWA weiß Dinge, die nur der Hub wissen darf"** — Composer hält nur
   den Contract-Typ; Daten via `/api/adapters`. check:arch wacht.
2. **„Stille Fehlleitung bleibt"** — genau dafür der Fail-loud-Hinweis;
   AC-P25-2 testet beide Richtungen (ungelistet, leere Liste).
3. **„Contract-Bruch zwingt alle Adapter zur Deklaration"** — Feld ist
   optional, Testkit validiert nur vorhandene Deklarationen.
4. **„Ein deklarierter Command funktioniert real doch nicht"** —
   Beleg-Regel (documented/live), Evidenz-Level in adapters.md, Live-
   Verifikation als T25.6-Rest; eine falsche Deklaration ist ein Bug
   (Adapter-Lüge = S2).
5. **„Prompt-Injection über Commands"** — Commands kommen nur aus der
   Nutzereingabe des Composers; Agent-Output wird nie als Command
   interpretiert (PRD §8.5 unverändert).

## Messlatten-Bezug

P9/ADR-0027 (deterministische Ergänzung zum Natursprach-Planer), K2
(Command-Auslösung stört den laufenden Tail nicht — normaler Prompt-
Pfad), K5 (Commands sind winzig), K7 (kein Kontext-Fake im Hub),
PRD §8.5 (Injection-Grenze).

## Definition of Done

Alle Aufgaben gehäkcht, AC belegt, `npm run gate` grün, MR gemergt,
Adapter-Matrix aktualisiert. T25.6-Live-Verifikationen bleiben als
dokumentierte Reste sichtbar (kein „done" über ungesehene CLI-Läufe).
