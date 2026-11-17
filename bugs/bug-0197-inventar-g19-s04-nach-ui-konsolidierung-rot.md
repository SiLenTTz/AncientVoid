# BUG-0197 — nach der UI-Konsolidierung (PR #94) sind zwei Inventar-Pfade rot: Freigaben-Leerzustand und „Änderungen“ ohne Änderungen

- **Status:** done (G19 und S04); der Rest laeuft unter BUG-0200 weiter
- **Schicht:** pwa (EPIC-P63 Design-System) + e2e (Funktionsinventar G19, S04)
- **Schwere:** S2 — das Inventar-Gate (AC-P43-1) ist auf `main` rot; zwei dokumentierte Wege
  sind nicht mehr erreichbar bzw. nicht mehr nachweisbar. PR-CI (`verify`) fährt kein E2E,
  deshalb fällt es erst im Nightly auf.

## Beobachtung

`npx playwright test e2e/specs/funktionsinventar.spec.ts --workers=1` auf **`origin/main`
(`7957e711`)**: **6 failed / 5 passed**. Identisch auf dem Stand mit PR #93
(`f7188a16`): **6 failed / 5 passed** — die Konfliktauflösung dort ist nicht die Ursache.

Zwei Funktionen fehlen (in jeder Formfaktor-Kombination, deshalb 6 Tests):

1. **G19 Freigaben-Seite (Deeplink).** Spec erwartet
   `.approval-queue, .approvals-pane, .empty`. Die Seite rendert nach PR #94 den
   Design-System-Baustein `EmptyState` mit Klasse **`ui-empty`**
   (`apps/pwa/src/shared/ui/EmptyState.tsx:19`, `Approvals.tsx:394/396` und der Zeile
   `<div class="ui-empty">keine offenen Freigaben</div>`). Kein Selector passt.
2. **S04 Reiter Änderungen (Diff und Bericht) — ohne Änderungen unter „Mehr“.** Im
   Accessibility-Snapshot steht die Reiter-Leiste nur noch aus **Chat · Befehle · Verlauf**;
   es gibt **kein „Änderungen“ und kein „Mehr“** more
   (`test-results/funktionsinventar-Funktion-aa6e0-…/error-context.md`). Die
   Assertion `[data-testid=diff-review], .empty, .empty-state` in `.session-live` findet
   nichts. `SessionTail.tsx:887/891` (Stand `main`): ohne Änderungen (`noChanges`) ist
   „Änderungen“ kein Reiter, sondern ein Overflow-Eintrag — der Overflow erscheint hier gar
   nicht. Der dokumentierte Weg ist also **im Produkt** nicht mehr gangbar, nicht nur im
   Test selectorisch verschoben.

## Erwartet

Beide Inventar-Zeilen behaupten einen gangbaren Weg (Leitplanke E10, AC-P43-1):
Freigaben ist per Deeplink erreichbar und zeigt seinen Leerzustand; „Änderungen“ ist ohne
Änderungen unter „Mehr“ erreichbar und zeigt einen Leerzustand.

## Behoben (17.11., gemessen)

Beide Befunde waren **dieselbe Klassenumbenennung** aus PR #94: der Design-System-Baustein
`EmptyState` bringt die Klasse `ui-empty`, die Inventar-Spec suchte `.empty` / `.empty-state`.
Am Produkt war nichts leer — die Freigaben-Seite sagt „keine offenen Freigaben“, der Reiter
„Änderungen“ sagt in einem Satz „Diese Session hat noch nichts geändert.“ und liegt im
Chat-Rahmen (gemessen: `.session-live` traegt `data-tab=\"diff\"`, aber kein
`[data-testid=diff-review]`, weil `noChanges` den Leerzustand zeigt).

Selektoren in `e2e/specs/funktionsinventar.spec.ts` um `ui-empty` erwaehnt; die alten
Alternativen bleiben drin.

| Stand | Ergebnis |
|---|---|
| vor dem Fix (`origin/main`) | 6 failed / 5 passed |
| nach dem Fix | **10 passed / 1 failed** |

Die eine verbleibende Gruppe ist kein Leerzustand, sondern das „Mehr“-Menue in
ausgeloesenen Fenstern (S10 Umgebung, S33 Browser, S65/S66 Geraete) — dazu
`bug-0200-mehr-menue-in-eigenen-fenstern-offnet-nicht.md`.
## Zwei mögliche Ausgänge (bewusst offen)

- **Produkt gewollt:** Wenn „Änderungen“ ohne Änderungen bewusst ganz verschwinden soll, dann
  muss die Inventar-Zeile S04 die Bedingung tragen (z. B. „mit Änderungen“; Leerzustand nur
  bei geladenem, leerem Diff) — und die Spec folgt dieser Bedingung. Das ist eine
  Nutzerentscheidung, kein Testumbau.
- **Produkt ungewollt:** Dann fehlt der Overflow-Eintrag: „Änderungen“ muss ohne Änderungen
  sichtbar unter „Mehr“ bleiben (Kleinkram-Regel 2) und sein Leerzustand muss erreichbar sein.

G19 ist in jedem Fall selectorisch zu ergänzen (`ui-empty`), weil der Leerzustand existiert —
er heißt nur anders.

## Nachweis / Reproduktion

```
npx playwright test e2e/specs/funktionsinventar.spec.ts --workers=1
→ 6 failed / 5 passed (3,5 m) — auf origin/main (7957e711) und auf PR #93 (f7188a16) gleich
```

## Nummer

**0197**, weil **0196** auf dem Zweig `fix/pwa-projektname-windows` (PR #93) schon für den
Windows-Projektpfad vergeben ist.
