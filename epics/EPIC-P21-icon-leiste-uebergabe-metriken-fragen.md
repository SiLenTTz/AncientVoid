# EPIC-P21 — Icon-Leisten, Provider-Übergabe, Laufzeit-Metriken mit Schätzung, Fragen-Dialog

**Status:** Code abgeschlossen 2026-10-28 (T21.1–T21.4), Roll-out und Retro offen · **Phase:** P21 · **Abhängigkeit:** fachlich keine; baut auf P18/P20 (Kacheln, Oberfläche),
ADR-0015 (Provider-Fehler), ADR-0023 (ehrliche Metriken) und dem Adapter-Contract (`questions`, Resume-Referenzen ADR-0036) auf.

Auslöser: Wunsch von Jan vom 2026-10-27. Die Session-Abbrüche waren eine Hub-Absturzschleife (BUG-0075); danach: Desktop wirkt unfertig
(App scrollt, Tabs statt Icon-Leiste, Kürzel nur Text), Login-Ablauf und Rate-Limit sollen erkannt werden und die Session soll sich an
einen anderen Provider/Harness übergeben lassen, Läufe sollen gemessen werden (Dauer je Token) für eine Restzeit-Schätzung, Fragen
der Harnesses sollen sauber beantwortbar sein.

## 1. Ziel
Desktop bedient sich über Icon-Leisten und klickbare Kürzel. Ein Provider-Ausfall (Login, Rate-Limit, Kontingent) ist sichtbar und mit
einem Tipp in eine neue Session bei einem anderen Provider übertragbar. Jeder Zug wird mit Dauer, Tokens, Modell gespeichert; die Oberfläche
schätzt die Restdauer ehrlich („≈“, mit Streuung, nie ohne Datenbasis). Fragen eines Harness erscheinen als Formular (Optionen, Mehrfach,
Freitext) und gehen als strukturierte Antwort zurück. Messlatten: K2 (Latenz), K5 (Payload ≤ 4 KB), K7 (Zustand rekonstruierbar), R9.7 (unbekannt statt geraten).

## 2. Scope (In / Out)
**In:** T21.1 Icon-Leisten; T21.2 Fehlerklassen sicher erkennen + Übergabe; T21.3 Lauf-Metriken + Schätzung; T21.4 Fragen-Dialog.
**Out:** Neue Harness-Loops (P19), automatische Provider-Wahl ohne Rückfrage, Abrechnung.

## 3. Aufgaben
- [x] **T21.1 — Icon-Leisten und klickbare Kürzel.** Ab 1280 px: globale Navigation als linke Icon-Leiste, Kachel-Ansichten (Chat/Verlauf/Bericht/Diff/Suche/Code)
  als senkrechte Icon-Leiste, Layout-/Fokus-/Tausch-/Leeren-Aktionen als Knöpfe, Fenster scrollt nie. Handy unverändert. Spec: `layout-desktop.spec.ts`.
- [x] **T21.2 — Provider-Ausfall erkennen und übergeben.** Login abgelaufen (401), Rate-Limit, Kontingent als Event + Banner mit Wahl des Ziels (Adapter + Modell);
  „Übergeben“ startet eine neue Session mit Zusammenfassung/Verlauf als Kontext (Blob, K5), verlinkt beide Sessions. Kein stilles Umschalten. [ADR-0039](../docs/adr/0039-session-uebergabe.md); Specs: `harness.spec.ts`, `handover.test.ts`. Die Fehlerklassen selbst gab es schon (ADR-0015).
- [x] **T21.3 — Lauf-Metriken und Schätzung.** Pro Zug: Start, Ende, Dauer, Tokens (nativ/geschätzt), Modell, Adapter, Aufgabentyp. Aus JSONL rekonstruierbar (K7).
  Schätzung = Median/P80 gleicher Adapter+Modell; weniger als 5 Läufe → „Schätzung ab 5 Läufen“. Tabelle `turn_metrics` (Migration 25) ist Cache, `backfillTurnMetrics()` baut sie beim Start aus dem JSONL nach; `GET /api/sessions/:id/turns|estimate`, `GET /api/metrics/turns`. Dauer ist Wanduhrzeit inkl. Freigabe-Wartezeit. Specs: `progress.spec.ts`, `turn-metrics.test.ts`.
- [x] **T21.4 — Fragen-Dialog (Hybrid).** Aus claude (`AskUserQuestion`), codex (native Fragen), opencode/maki (ACP-Elicitation) ein Formular: Optionen als Chips, Mehrfachauswahl, Freitext „Sonstiges“,
  Antwort strukturiert zurück, Frage bleibt nach Reload sichtbar (Approval-Store), Timeout sichtbar. Umgesetzt: ACP `elicitation/create` (Formular-Modus) im Adapter → `AskUserQuestion` → Antwort als schema-konformer `content`; Formular mit Kopf-Chip, Beschreibungen, „Eine/Mehrere“, Ziffern-Tasten, Eigene Antwort ersetzt Wahl, Enter sendet, Fortschritt und Zusammenfassung. Specs: `harness.spec.ts`, `acp/adapter.test.ts`.

## 4. Acceptance Criteria
- AC-P21-1 (T21.1): Kein Dokument-Scroll bei 1600×900; Rail-Breite ≤ 64 px; Kürzel-Aktionen per Klick; Mobile-Specs grün.
- AC-P21-2 (T21.2): Ein 401/Rate-Limit-Lauf zeigt Banner mit Kategorie; Übergabe erzeugt neue Session mit Kontext und Rückverweis.
- AC-P21-3 (T21.3): Metrik-Zeilen je Zug nach Hub-Neustart identisch (Recovery); Schätzung zeigt „zu wenig Daten“ bei < 5 Läufen.
- AC-P21-4 (T21.4): Frage mit Optionen/Mehrfach/Freitext wird beantwortet, überlebt Reload, Antwort erreicht den Harness.

## 5. Premortem
1. **Übergabe leakt Secrets/zu großen Kontext.** *Mitigation:* nur Zusammenfassung + letzte Events, Blob, K5, Vorschau vor dem Senden.
2. **Schätzung wirkt exakt, ist es nicht.** *Mitigation:* „≈“, Bandbreite, Mindestdatenmenge, nie bei `unknown`-Qualität (ADR-0023).
3. **Rail bricht Specs/Handy.** *Mitigation:* Beschriftung bleibt im DOM, Handy-Regeln nur unter `min-width: 1280px`.
4. **Frage-Formular blockiert den Harness.** *Mitigation:* Timeout als Event, Antwort auch per Freitext-Chat.

## 6. Definition of Done
`npm run gate` grün, jede UI-Funktion mit Spec, ADR für Contract-Änderungen (Übergabe, Metriken), Hub neu gestartet, `retro`.

## Retro (2026-10-28)

Zeitraum 2026-10-27 bis 2026-10-28, vier Aufgaben (Commits `9ec36ef`, `6f4f489`, `587929b`, `36d8f82`), dazu der Auslöser-Bug BUG-0075 (MR !219, !225).

**AK-Matrix: 4 🟢 / 0 🟡 / 0 🔴 / 0 ⚪** (AC-P21-4 nachträglich 🟢, siehe unten)

- AC-P21-1: 🟢 — Beleg: `e2e/specs/layout-desktop.spec.ts:32` (Rail ≤ 64 px), Gate 223 E2E inkl. Mobile-Specs grün (MR !222).
  Bemerkung: Der Dokument-Scroll bei 1600×900 hatte als Ursache einen veralteten PWA-Build, zusätzlich per CSS abgesichert.
- AC-P21-2: 🟢 — Beleg: `packages/core/test/modules/handover/handover.test.ts`, `e2e/specs/harness.spec.ts:186` (Übergabetext), ADR-0039 (MR !226).
- AC-P21-3: 🟢 — Beleg: `packages/core/test/modules/runs/session-turn-metrics.test.ts` (Wiederaufbau aus JSONL), `e2e/specs/progress.spec.ts` „ab 5 Läufen“ (MR !223).
- AC-P21-4: 🟢 (nachgezogen 2026-10-28) — Beleg: `e2e/specs/harness.spec.ts:142` (claude), `:154` (acp), `:318` (codex): Frage wird beantwortet, die Antwort erreicht den Harness.
  Bemerkung: Zunächst 🟡, weil der Reload-Beleg fehlte. Nachgeliefert: `harness.spec.ts` „AC-P21-4: eine offene Frage überlebt einen Reload“ (4 von 4 Läufen).

**Premortem: 2 eingetreten / 2 nicht eingetreten**

- Risiko 3 (Rail bricht Specs/Handy): eingetreten im Kleinen, `oberflaeche.spec.ts` brauchte einen neuen Locator (`.notif-gear`); Handy-Specs blieben grün.
- Risiko 4 (Formular blockiert Harness): eingetreten als echter Fehler, nicht als Timeout: Die erste „nur ein resync“-Fassung verlor das erste Event (~1 von 3 E2E rot), bisektiert, MR !225.
- Risiko 1 und 2: nicht eingetreten (Übergabetext ≤ 3500 Zeichen mit Schwärzung; Schätzung zeigt „ab 5 Läufen“ statt einer Zahl).

**Erkenntnisse**

1. Die gemeldeten „Session-Abbrüche“ waren eine Hub-Absturzschleife, kein Provider-Problem — Beleg: BUG-0075.
2. Bisektieren fand die eigene Regression schnell, weil jeder Fix ein eigener Commit war — Beleg: BUG-0075 „Fix“.
3. Zwei Flakes hatten kleine, reproduzierbare Ursachen, sobald man `--repeat-each` nutzte: ein Test startete das echte `opencode` (MR !228), ein Sprachbefehl-Test wartete auf ein Zitat im schon geschlossenen Dialog (6 von 12 rot, Fix in MR !230).
4. Parallele Sessions vergaben dieselbe Bug-Nummer (0072) — Beleg: BUG-0075 „Nummer“, MR !231.
5. Der Hub hatte keine Frühwarnung vor dem OOM — Beleg: MR !229 (`checks.memory`).

**Action Items**

- AI-P21-1: Spec „offene Frage überlebt Reload“ — **erledigt 2026-10-28**.
- AI-P21-2: Bug-Nummern vor dem Anlegen gegen `origin` und offene MRs prüfen — zurück als: Eintrag in `bugs/README.md` / Skill `bug-report`.
- AI-P21-3: Roll-out auf `silenttz-server` (`scripts/fleet-deploy.sh`) und `evox2` — zurück als: offene DoD-Zeile dieses Epics; von Jan später gewünscht.
- AI-P21-4: Nach dem Merge von !218 BUG-0074 auf `done` mit Verweis auf BUG-0075 — **erledigt 2026-10-28** (!218 gemergt).
