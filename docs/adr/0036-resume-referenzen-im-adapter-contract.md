# ADR-0036 — Resume-Referenzen im Adapter-Contract

**Status:** akzeptiert · **Betrifft:** EPIC-P17 T17.2/T17.3, `AdapterCapabilities.resume`, `hubctl show`, PcOpenNotice, `@uacc/adapter-testkit`

## Kontext

`AdapterCapabilities.nativeResume` sagt nur, **ob** steer/start eine Provider-Session-ID
wiederverwendet — nicht, **wie ein Mensch die Session außerhalb des Hubs fortsetzt**.
Der „PC offen"-Hinweis (ADR-0034) hardcodiert deshalb `claude --resume <id>`, und für
alle anderen Adapter weiß niemand den Weg. Die Herdr-Evaluation (2026-10-26) zeigte:
eine Tabelle konkreter Resume-Aufrufe je Harness ist der Schlüssel für Fortsetzung,
Handoff und Betrieb. Herdr pflegt sie als „offizielle Integrationen"; der Hub braucht
dieselbe Information — als Adapter-Deklaration, nicht als Hub-Wissenshäufchen.

Vorhandene Belege im Repo (alle gegen die installierten CLIs verifiziert, `--help` +
Adapter-Nutzung): `claude --resume <session-id>`, `codex resume` (Subcommand,
„Resume a previous interactive session"), `opencode --session <id>` („Session ID to
continue"), `hermes --resume <sid>` (adapter-internal „verified live via --resume").

## Entscheidung

1. **Additives Feld `resume?: AdapterResume` in `AdapterCapabilities`** (Contract-
   Änderung ohne Bruch: fehlendes Feld bleibt gültig):
   ```ts
   interface AdapterResume {
     argv: string[];             // Template, Platzhalter {sessionId} / {token}
     ref: "native" | "token";    // woher die Id stammt
   }
   ```
   - `ref: "native"`: Der Adapter kann die Provider-Session-ID an die Oberfläche
     bringen (z. B. PcState `nativeSessionId`); der Hub ersetzt `{sessionId}` zur
     Anzeige, **nur** zur Anzeige (read-only).
   - `ref: "token"`: `{token}` bezeichnet den adapter-internen Resume-Handle
     (`SessionHandle.internal`, „never interpreted by the hub" — unverändert: der Hub
     interpretiert ihn nicht, er zeigt ihn nicht einmal an; das Template bleibt dann
     mit Platzhalter lesbar).
2. **Deklarieren nur mit Beleg (R9.7-Geist).** Ein Adapter deklariert `resume` nur,
   wenn der Aufruf gegen die installierte CLI-Version belegt ist (Handlauf oder
   Adapter-Nutzung + `--help`). Pi und ACP-Presets deklarieren initial **nichts** —
   fehlende Deklaration ist der ehrliche Zustand, kein Fehler. Nachziehen erst mit
   jeweils eigenem Beleg.
3. **`nativeResume` bleibt unberührt.** Es beschreibt In-Hub-Steuerung (steer/start
   reuses provider session id); `resume` beschreibt die Fortsetzung außerhalb des
   Hubs. Beide können unabhängig gesetzt sein.
4. **Verbraucher:** `/api/adapters` reicht `capabilities` ohnehin 1:1 weiter — die
   Deklaration ist dort automatisch sichtbar. `hubctl show` ergänzt eine
   `resume:`-Zeile (Template, Platzhalter als `<session-id>`). PcOpenNotice rendert
   den Befehl aus der Deklaration statt aus dem Hardcode (Fallback: alter Text für
   Registrationen von Hubs, die das Feld noch nicht liefern).
5. **Testkit prüft die Form, nicht den Beleg.** `runContractTests` ergänzt einen
   Check: ist `resume` gesetzt, muss `argv` nicht-leer sein, mindestens einen der
   Platzhalter `{sessionId}`/`{token}` enthalten und `ref` gültig sein. Der Beleg
   selbst liegt in der MR-Beschreibung (AC-P17-2), nicht automatisierbar.

## Folgen und Risiko

- **Veraltung:** CLI-Flags ändern sich; eine falsche Deklaration ist schlimmer als
  keine. Mitigation: Deklaration trägt den Beleg-Kommentar im Adapter-Code; bei
  CLI-Breakage (`adapter.broken`, K9) ist die Resume-Zeile mitzuprüfen.
- **Keine Ausführung:** Der Hub setzt den Befehl nie selbst ein (kein Spawn aus dem
  Template) — reine Anzeige; Injection-Fläche bleibt null. Das Template ist Daten,
  kein Code (Prompt-Injection-Grenze PRD §8.5 unberührt: Anzeige im UI bleibt
  gerendert, nicht interpretiert).
- **Anzeigefluss:** `{sessionId}`-Ersetzung passiert nur, wenn der Hub die echte
  Provider-ID kennt; sonst zeigt die UI den Platzhalter als solchen — nie raten.

## Messlatten

K7 (Fortsetzung nach Hub-Neustart beginnt mit dem richtigen Befehl), K1 (Weg zur
Entscheidung am PC kürzer), K10 (Handy zeigt denselben Fortsetzungsweg).
