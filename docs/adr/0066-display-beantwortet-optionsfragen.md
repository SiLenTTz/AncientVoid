# ADR-0066 — Display beantwortet Optionsfragen (Fortschreibung von ADR-0048)

**Status:** akzeptiert (2026-11-12, Nutzerentscheid E11 vom 11.11.2026, EPIC-P43 T43.10 „AV-D3“) ·
**Betrifft:** `packages/contracts/src/approvals/display.ts`,
`packages/core/src/modules/identity/tokens.ts` (Migration 32),
`apps/hub/src/modules/approvals/approvals.routes.ts`, `hubctl token issue` ·
**Ändert:** ADR-0048 Punkt 4 (nur der Teil „Provider-Rückfrage“) · **Anlass:** VoidWarden
EPIC-P13, dort ADR-0012

## Kontext

ADR-0048 Punkt 4 lehnt für den Akteur `display` jede Provider-Rückfrage (`tool.question`) mit
403 ab: Eine Antwort ist Text, der den Agenten erreicht, und ein Statusdisplay soll keinen
Weg zum Agenten haben. Der Nutzer will Fragen, bei denen der Agent selbst Optionen vorgibt,
am Nyx-Kiosk beantworten (Design-Review E11). Offen war, wie sich das öffnen lässt, ohne dass
ein Display (oder ein kompromittierter Display-Client) frei formulieren kann.

## Entscheidung

1. **Fähigkeit je Token, Standard aus.** `device_tokens` erhält die Spalte `capabilities`
   (JSON-Array, `NULL` = keine). Einzige Fähigkeit: `display.answer_questions`. Sie wird nur
   beim Ausstellen vergeben (`hubctl token issue <name> --display --answer-questions`), nur
   für Label `display:<name>`, nicht über die HTTP-API. Unbekannte Fähigkeiten und die
   Vergabe an andere Akteure lehnt `TokenService.issue` ab. Unlesbar gespeicherte Fähigkeiten
   zählen als keine. Bestehende Tokens bleiben unverändert.
2. **Beantwortbar ist nur der enge Fall** (`displayAnswerable`, Contracts): Aktion
   `tool.question`, Klasse `write`, kein `reasonRequired`, mindestens eine Frage, **jede**
   Frage mit mindestens zwei eindeutigen, nicht leeren Options-Labels und ohne `multiSelect`,
   Fragetexte eindeutig, und der Token trägt die Fähigkeit.
3. **Die Antwort ist eine vorgegebene Option, wortgleich** (`displayAnswersValid`): genau ein
   Eintrag je Frage, Schlüssel = Fragetext, Wert = eines der Labels dieser Frage. Der Hub
   prüft gegen die gespeicherte Anfrage (Operation `tool.permission`), nie gegen etwas, das
   der Aufrufer mitschickt. Kein Freitext, keine fehlenden, zusätzlichen oder fremden Fragen.
4. **Nur beantworten, nie ablehnen, nie begründen.** `decision: "reject"` und ein `reason`
   auf eine Rückfrage sind für ein Display 403.
5. **Der Hub sagt dem Display, was es darf.** `GET /api/approvals` liefert einem
   Display-Aufrufer je Eintrag `displayAnswerable: boolean` (für den anfragenden Token). Andere
   Akteure bekommen das Feld nicht. Der Companion leitet die Beantwortbarkeit nicht selbst her.
6. **Policy vor Existenz.** Für ein Display ist jede Entscheidung auf eine unbekannte ID 403
   (bisher 422). Eine bekannte, bereits entschiedene Rückfrage endet wie jede andere als 422
   („höchstens einmal“, ADR-0019), damit das Display „schon entschieden“ von „nicht erlaubt“
   unterscheiden kann.
7. **Sonst unverändert:** Weg `POST /api/approvals/:id/decide` mit `answers`
   (`DecideApprovalInput`), Signatur über den Token (ADR-0007), Audit mit `display:<name>`,
   Routen-Grenze aus ADR-0048 Punkt 3. Die Fähigkeit erweitert nichts außer diesem Fall.

## Sicherheitsbetrachtung

- **Prompt-Injection über die Antwort:** ausgeschlossen, weil nur Zeichenketten zurückgehen,
  die der Agent selbst in dieselbe Anfrage geschrieben hat; der Vergleich läuft serverseitig.
- **Kompromittierter Display-Token:** kann Optionsfragen beantworten (gewollt) und wie bisher
  `write`-Freigaben entscheiden; mehr nicht. Ohne Fähigkeit bleibt der Stand von ADR-0048.
- **Mehrdeutige Fragen** (doppelte Fragetexte oder Labels): gelten als nicht beantwortbar,
  statt zu raten, welche gemeint ist.
- **Anzeigegrenzen** (Länge, Anzahl) sind Sache des Displays (VoidWarden ADR-0012); der Hub
  kürzt nichts und macht davon nichts abhängig.

## Verworfen

- **Fähigkeit im Label kodieren** (`display+ask:<name>`): vermischt Identität und Recht, jede
  Präfix-Prüfung müsste es kennen.
- **Fähigkeit als Hub-Einstellung für alle Displays:** nicht je Gerät widerrufbar.
- **Antwort als Options-Index statt Text am Hub:** der bestehende Weg ist textbasiert
  (`answers` nach Fragetext); ein zweites Format wäre ein zweiter Antwortweg. Der Index lebt
  zwischen Kiosk und Companion.

## Konsequenzen

- Tests: `packages/contracts/test/approvals/display-answers.test.ts` (Tabelle der Grenzen),
  `packages/core/test/modules/identity/tokens.test.ts`, Integration je Ablehnungsfall in
  `apps/hub/test/modules/approvals/tool-permissions.test.ts`, `hubctl`-Test.
- Betrieb: Für den Nyx-Kiosk einen neuen Token ausstellen und im Companion hinterlegen; den
  alten widerrufen. Ohne neuen Token ändert sich nichts.
- `GET /api/tokens` und `hubctl token list` zeigen die Fähigkeiten.
- K7: Die Fähigkeit liegt in der Hub-Datenbank (Migration 32) und überlebt Neustarts.
