# ADR-0091: Explorer-Status `blocked` — Einträge, deren Abnahme/Entscheid ein Mensch braucht

Status: akzeptiert (2026-11-18)

## Kontext

Der Projekt-Explorer färbt `EPIC-P*.md` und `bug-*.md` im Dateibaum nach Status
(`TreeEntry.epic`, ADR-0058, Nutzerauftrag 14.11.2026, BUG-0189). Bisher gibt es
vier Kategorien (done/code/wip/open). Dabei war nicht unterscheidbar, ob ein
offener Eintrag der Agent allein erledigen könnte oder ob er auf einer
Menschen-Aktion hängt: einer Abnahme (Gerät/Handy/Live-Lauf) oder einem
Entscheid (Go/No-Go, „On hold bis ausdrückliche Wiederaufnahme“). Nutzerauftrag
18.11.2026: diese Fälle sichtbar kennzeichnen — abweichende Farbe und ein „H“ am
Status-Kreis — und den dafür nötigen neuen Status im Contract zu verankern.
Der zugehörige Report liegt in `docs/2026-11-18_offene-bugs-und-epics-report.md`.

## Entscheidung

**1. Contract, rein additiv (`packages/contracts/src/code/explorer.ts`).**
`TreeEntry.epic` erhält das Enum-Mitglied `blocked` (bedeutet:
needs-human-acceptance — kann nicht ohne Menschen-Abnahme oder
-Menschen-Entscheid weiter). Rein additive Enum-Erweiterung: bestehende Werte
bleiben, Konsumenten ohne den neuen Wert behandeln ihn wie bisher (Anzeige ohne
„H“). Da die Kategorie über den öffentlichen Explorer-Contract reist, braucht
die Erweiterung dieses ADR (Regel 1).

**2. `blocked` ist abgeleitet, kein neuer Zustand (K7).**
Es gibt keinen neuen Wahrheitsspeicher: Die Kategorie wird beim Einlesen des
Dateikopfs gefaltet (Statuszeile bei Epics, Frontmatter `status:` bei Bugs) —
derselbe Recovery-Pfad wie beim bisherigen Status, Verlust ist unmöglich, da
nichts persistiert wird. Die Klassifikation bleibt eine dokumentierte
Heuristik mit engem, getestetem Vokabular, kein Semantic-Parser.

**3. Vokabular (Epics; wird vor den bisherigen Regeln geprüft).**
`blocked`, wenn die Statuszeile enthält: `on hold`, `gesperrt`, `blockiert`,
`festgefahren`, „wartet auf Nutzer…“ — oder ein Abnahme-Wort
(Abnahme/Abnahmen mit Präfix live/Geräte-/Nutzer-/Handy-/End-) **zusammen**
mit einem Offen-Marker („offen“, „steht aus“, „ausstehend“, „nicht
erreichbar“). Ein abgeschlossenes Epic mit erwähnter, aber grüner Abnahme
bleibt done. Die Vokabular-Listen liegen im Code
(`BLOCKED_STATE`/`ACCEPTANCE_WORD`/`PENDING_MARK` in
`packages/core/src/modules/code/explorer.ts`) und sind mit echten
Korpus-Statuszeilen getestet (rot-dann-grün, `explorer-epic.test.ts`).

**4. Bug-Frontmatter: neues Vokabular, Unbekanntes bleibt Fail-loud.**
Bekannt (bugs/README): `done`, `in-progress`/„in Arbeit“, `wont-fix`. Neu
dazugenommen: `fixed` → `code` (Fix liegt, Abnahme/Bestätigung steht aus) und
`blocked`/`needs-human`/`needs-human-acceptance` → `blocked`.
`wont-fix` bleibt bewusst ungemappt (→ `open`, Grauton): ein abgelehnter Bug ist
ein Entscheid, kein Done — die Anzeige soll ihn weiter zeigen. Unbekannte oder
fehlende Status werden nie still umgedeutet; der Klartext wandert unverändert
als `epicStatus` in den Tooltip (Fail-loud-Disziplin).

**5. Anzeige nur, kein neuer Flow.**
Die PWA rendert `blocked` in der Fehlerfarbe (`--err`) mit kleinem „H“ im Kreis
und eigenem Tooltip-Text („braucht Menschen (Entscheid/Abnahme)“); E2E-Spec
`e2e/specs/dateibaum-epic-status.spec.ts`. Keine neuen Endpunkte, keine
Status-Übergänge, keine Automatisierung — Kennzeichnung ist reine Anzeige.

## Grenzen (bewusst)

- Die Heuristik erkennt nur explizites Vokabular; Statusformulierungen wie
  „Live-Teile offen“ ohne Abnahme-Wort bleiben in ihrer bisherigen Kategorie —
  der Report gleicht das ab, die Anzeige darf nicht raten.
- `scripts/epic-status.mjs` (Datenbaum-Konsolenansicht) bleibt unverändert;
  seine Regeln (S1/S2/C1/C2) beantworten eine andere Frage („Datei mit offenen
  Punkten?“) als die Explorer-Kategorie („wartet sie auf einen Menschen?“).

## Konsequenzen

- Eindeutig klassifizierbare Einträge (u. a. P0, P2, P30–P35, P44, P47, P51,
  P54, P55, P59, P67; Bugs mit `fixed`/`blocked`) erscheinen im Baum jetzt
  rot mit „H“ statt grau/gelb; bestehende Kategorien verschieben sich nur für
  Zeilen mit explizitem blocked-Vokabular (in den Tests rot-dann-grün belegt).
- `docs/epic-status.md` und die Explorer-Doku im Guide bleiben gültig; das
  neue Vokabular ist hier und im Code kommentiert.

## Verweise

- `packages/contracts/src/code/explorer.ts` (Contract), `packages/core/src/modules/code/explorer.ts` (Klassifikation), `apps/pwa/src/features/files/FilesSidebar.tsx` + `apps/pwa/src/app/styles/30-files.css` (Anzeige)
- Tests: `packages/core/test/modules/code/explorer-epic.test.ts`, `e2e/specs/dateibaum-epic-status.spec.ts`
- Report: `docs/2026-11-18_offene-bugs-und-epics-report.md`; Vorgeschichte: ADR-0058, BUG-0189, `docs/epic-status.md`
