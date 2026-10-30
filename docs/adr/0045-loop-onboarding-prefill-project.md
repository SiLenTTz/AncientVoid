# ADR-0045 — Loop-Onboarding: semantische Vorbelegung `prefill: "project"`

**Status:** akzeptiert · **Betrifft:** `LoopOnboardingField` (Erweiterung in
`packages/contracts/src/loops/connector.ts`), `@uacc/loop-securesight-factory`,
PWA `LoopPicker`/`loop-form.ts` · Folge aus [BUG-0081](../../bugs/bug-0081-loop-start-wirkungslos.md)

## Kontext

Loops mit Repo-Onboarding (aSPARK `factoryctl new`, securesight `factory init`)
fragen im Formular „Neues Repo anbinden“ Projektdaten ab. securesight verlangt
„Projektpfad (absolut)“ — obwohl der Pfad im Start-Dialog seit der Umstellung
(Projektauswahl zuerst, Pfad-Feld daraus abgeleitet) längst bekannt ist. Der
Nutzer tippt ihn doppelt, und zusammen mit BUG-0081 wirkte der Startknopf
vollständig tot.

Offensichtliche Lösungen:

- **Label-Heuristik in der PWA** (Feld heißt „Pfad“ → projektpfad-ähnlich):
  fragil, pro-Connector-Formulierung verankert, verletzt das capabilities-
  getriebene Prinzip des Loop-Pickers (Felder kommen vom Hub, nie festverdrahtet).
- **PWA füllt einfach das erste Pflicht-Textfeld**: falsch für aSPARK (dessen
  „Repo“ ein Slug `owner/name` ist, kein Dateisystempfad).
- **Feld weglassen und der Hub nutzt `spec.project` still**: Versteckt das
  Verhalten — der Nutzer sieht nicht, wo `factory init` läuft, und kann es
  nicht korrigieren (fail-loud-Prinzip).

## Entscheidung

1. **`LoopOnboardingField`** als eigener Typ für `LoopOnboarding.fields`
   (bisher strukturell `LoopOption`): additiv, mit optionalem
   `prefill?: "project"`.
2. **Semantik:** Der Wert `prefill: "project"` erklärt: dieses Feld erwartet
   den Projektpfad der aktuellen Auswahl des Start-Dialogs. Die Oberfläche
   setzt ihn ein, sobald das Formular offen ist, aktualisiert ihn bei
   Wechsel der Projektauswahl — und hört auf, sobald der Nutzer selbst tippt
   (explizite Eingabe gewinnt immer).
3. **Verbindlichkeit:** rein deklarativ für die Oberfläche. Connector und Hub
   validieren `prefill` nicht weiter; ein Connector, der es nicht setzt,
   verhält sich exakt wie vorher (nicht-brechend, auch für externe Loops).

## Konsequenzen

- securesight setzt `prefill: "project"` auf „Projektpfad (absolut)“;
  aSPARK setzt nichts („Repo“ ist kein Pfad — bewusst ohne).
- `LoopOption` (Start-Formular-Optionen) bekommt **kein** `prefill`: Start-
  Optionen sind Loop-Konfiguration, keine Onboarding-Daten. Erweiterbar,
  falls je nötig — dann eigenes ADR.
- Testkit-Fake-Loop spiegelt das Feld (rot/grün-Deckung in `loops.spec.ts`).
- Die Vorbelegung ist reine clientseitige Ergonomie: Abgeschickt wird, was
  im Feld steht — der Connector bleibt Herr der Validierung.
