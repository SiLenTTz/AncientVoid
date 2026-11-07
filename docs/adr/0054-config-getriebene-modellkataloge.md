# ADR-0054 — Config-getriebene Modell-Kataloge für alle Adapter (`modelsCommand`, `contextWindows`)

**Status:** akzeptiert · **Betrifft:** `packages/models` (`parseModelLines`, `modelsFromCommand`),
`packages/adapters/{claude,codex,pi,copilot,hermes,opencode}`, `docs/adapters.md`,
EPIC-P35 T35.7/T35.8

## Kontext

Ein neues Modell oder ein neuer Provider soll ohne Adapter-Codeänderung nutzbar
sein (Nutzerauftrag 07.11.2026). Der Adapter-Contract hat dafür schon
`models?(): Promise<ModelOption[]>` — aber nur vier Adapter implementieren es,
jeweils anders: claude eine hartcodierte Alias-Liste aus der Doku, opencode ein
eigenes `opencode models`, cursor ein IDE-Derivat, ACP `modelsCommand` oder
eine Protokoll-Probe. codex, pi, copilot und hermes haben keinen Katalog — das
Startformular fällt dort auf freie Texteingabe zurück. Kontextfenster sind
zwar kuratiert (ADR-0032, `@ancientvoid/models`), aber nur ACP/opencode lösen
sie auf; pi kennt nur einen einzelnen konfigurierten Wert.

## Entscheidung

1. **Kein Contract-Bruch.** `ModelOption` und `models()` bleiben, wie sie
   sind. Die Verallgemeinerung passiert in der **Adapter-Konfiguration** und
   einem geteilten Helfer — kein neues Feld in `@ancientvoid/contracts`,
   deshalb kein ADR-Pflichtfall dort; dieses ADR dokumentiert das Muster.

2. **Geteilter Helfer in `@ancientvoid/models`** (Paket hat keine
   Contracts-Abhängigkeit nötig): `parseModelLines` (eine Zeile = ein Modell,
   `provider/model` oder nackte Id, optionales Label nach Tab; Warnungen,
   Kopfzeilen, Duplikate raus) und `modelsFromCommand` (führt das Kommando
   read-only aus — kein Worker, keine Session, keine Kosten; **Fehler werden
   geworfen, nie als leere Liste geschluckt**).

3. **`modelsCommand: string[]` in der Adapter-Konfiguration** für claude,
   codex, pi, copilot, hermes und opencode (dort als Überschreibung des
   abgeleiteten `<command> models`). Semantik je Adapter:
   - gesetzt → `models()` liefert `modelsFromCommand(...)` (oder `[]`, wenn
     die ehrliche Antwort des Kommandos leer ist);
   - nicht gesetzt → bisheriges Verhalten: claude die dokumentierten Aliase,
     opencode `opencode models`, codex/pi/copilot/hermes **kein** Katalog
     (freie Eingabe) — für kein dieser CLIs ist ein List-Kommando verifiziert,
     also wird keins erfunden.
   Ein neues Modell heißt damit: Zeile in `hub.config.json` (oder gar nichts,
   bei freier Eingabe) — kein Code.

4. **`contextWindows: Record<string, number>`** (ADR-0032-Overrides) für
   opencode und pi: `resolveContextWindow(model, raw, overrides)` —
   Konfiguration schlägt die kuratierte Tabelle, Tabelle schlägt „unbekannt“.
   pi löst damit erstmals pro Modell auf (statt nur einem einzelnen
   konfigurierten Wert); claude behält sein singuläres
   `contextWindowTokens` (kein Modell-Ansage-Event mit Fenster dort).

5. **Keine stille Ersatzmodell-Auswahl.** ACP verweigert sichtbar, wenn ein
   gewünschtes Modell im Katalog des Agents fehlt (`pickModel` → null →
   Meldung). Native Adapter reichen `--model` durch: kennt die CLI das Modell
   nicht, stirbt der Zug mit dem Fehler des Providers — sichtbar als
   `provider.error` (ADR-0015), nicht als Lauf auf einem anderen Modell.
   Genau das ist die äquivalente Ehrlichkeit; ein Vorab-Abgleich gegen die
   Liste würde CLI-Definitionen duplizieren.

6. **Abgrenzung zu P30/P31:** P30 liefert Distribution/Lifecycle für
   Adapter-Pakete, P31 kuratiert neue ACP-Provider mit Probe und getrennten
   Fähigkeitsnachweisen. Beide bauen auf diesem Config-Muster auf; P35 führt
   keine zweite Katalog-Wahrheit (kein Metadaten-Store im Hub — die Liste
   bleibt Antwort des Adapters, Cache ist maximal Projektion in P31).

## Konsequenzen

- Ein neues Modell/Provider ist Konfiguration: `modelsCommand` (Katalog) oder
  freie Eingabe ( Durchreichen), Credentials via `envFiles` (ACP) bzw.
  Provider-eigene Anmeldung (nativ).
- `parseModelLines` ist bewusst streng (Zeilen-Muster); unbekannte Formate
  bleiben leer — fail loud gehört zum Aufruf (`modelsFromCommand` wirft),
  nicht zum Parser (er sagt ehrlich „nichts erkannt“).
- Tests: `packages/models/test/models.test.ts` (Parser, Kommando gegen
  `printf`, Fehlschlag), je Adapter ein Konfig-Test; Live-Rauchtest eines
  Custom-Entry („Mein Zweit-OpenCode“ per `command`-Config, Antwort
  „ANKUNFT“, 07.11.2026) belegt T35.8.
