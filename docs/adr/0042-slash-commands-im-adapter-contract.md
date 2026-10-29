# ADR-0042: Slash-Commands im Adapter-Contract (`capabilities().commands`)

**Status:** angenommen (2026-10-29) · **Epic:** [EPIC-P25](../../epics/EPIC-P25-slash-commands.md)
· **Analyse:** [slash-commands-analyse-2026-10-29](../slash-commands-analyse-2026-10-29.md)

## Kontext

Harness-CLIs haben Slash-Commands (/clear, /new, /compact …). Die Analyse
vom 2026-10-29 zeigt: Der Hub transportiert Prompt-Text unverändert bis zur
CLI — bei CLIs, die Slash-Commands im getriebenen Modus ausführen (Claude
`-p`, Copilot ACP, aider `--message`, oh-my-pi ACP), würde ein
durchgeschicktes "/compact" also ausgeführt; bei anderen (OpenCode run?,
Codex exec?, dsh sicher nicht) wird es als Chat-Text **beantwortet**. Ein
reiner Passthrough wäre eine stille Fehlleitung.

## Entscheidung

1. **`AdapterCapabilities.commands?: readonly SlashCommand[]`** (additiv,
   optional). Shape: `{ name: "/klein-kebab", description, scope:
   "start" | "steer" | "both" }`. `scope` sagt, wo der Command funktioniert:
   `start` nur als erster Prompt (aider — kein followUp), `steer` nur als
   Zwischenruf, `both` überall.
2. **Fail loud statt Fehlleitung:** fehlt das Feld oder ist die Liste leer,
   hat der Adapter **keinen** nachweislich getriebenen Command. Die PWA
   zeigt das (Hinweis bei "/"-Eingabe) und sendet ungelistete Slashes nur
   mit sichtbarem Hinweis „geht als normaler Text" — nie still.
3. **Beleg-Regel (wie `resume`, ADR-0036):** deklariert wird nur, was die
   Doku des Harness für den getriebenen Modus zusagt (documented) oder was
   live verifiziert wurde. Picker-basierte Commands (ohne Argument nicht
   benutzbar) werden nie deklariert. Der Testkit prüft die Form (Name,
   Eindeutigkeit, Scope, Beschreibung); der Evidenz-Level steht im Adapter-
   Kommentar und in `docs/adapters.md`. Live-Verifikation der deklarierten
   Listen ist Epic-Rest (T25.6), analog „unproven ehrlich markiert" bei
   copilot in P3.
4. **Kein eigener Steer-Kanal:** Commands laufen als normaler Prompt-Text
   über die bestehenden `start`/`steer`-Wege. Keine `SteerInput`-Erweiterung,
   kein Contract-Break bestehender Adapter.
5. **Sicherheit:** Commands sind ausschließliche Nutzereingabe aus dem
   Composer. Agent-Output interpretiert nie als Command (PRD §8.5
   unberührt); Senden bleibt der bewusste Tap wie bei jedem Prompt.

## Alternativen (verworfen)

- **Passthrough ohne Deklaration:** sofort nutzbar, aber stille
  Fehlleitung bei allen „unklar"-CLIs — verletzt Fail-loud.
- **Hub-seitige Emulation (/clear im Hub):** Kontext-Reset ist
  CLI-interner Zustand; ein Fake beschädigt K7 und die Ehrlichkeit der
  Historie. Abgelehnt.
- **`SteerInput`-Erweiterung `kind:"command"`:** unnötig — kein Adapter
  braucht einen anderen Transport als Promp-Text; weniger Contract-Fläche.

## Konsequenzen

- Testkit-Kontrakt-Check prüft jede `commands`-Deklaration auf Form.
- `/api/adapters` reicht `commands` unverändert durch (Capabilities-Passthrough).
- PWA-Composer filtert nach `scope` (Neu-Session: `start`, Antwort: `steer`).
- Adapter ohne Beleg deklarieren nichts — `docs/adapters.md` führt die
  Evidenz je Eintrag.
