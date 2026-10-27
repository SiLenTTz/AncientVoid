# EPIC-P21 — Icon-Leisten, Provider-Übergabe, Laufzeit-Metriken mit Schätzung, Fragen-Dialog

**Status:** in Arbeit (T21.1 fertig, Rest siehe Aufgaben) · **Phase:** P21 · **Abhängigkeit:** fachlich keine; baut auf P18/P20 (Kacheln, Oberfläche),
ADR-0015 (Provider-Fehler), ADR-0023 (ehrliche Metriken) und dem Adapter-Contract (`questions`, Resume-Referenzen ADR-0036) auf.

Auslöser: Wunsch von Jan vom 2026-10-27. Die Session-Abbrüche waren eine Hub-Absturzschleife (BUG-0072); danach: Desktop wirkt unfertig
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
- [ ] **T21.2 — Provider-Ausfall erkennen und übergeben.** Login abgelaufen (401), Rate-Limit, Kontingent als Event + Banner mit Wahl des Ziels (Adapter + Modell);
  „Übergeben“ startet eine neue Session mit Zusammenfassung/Verlauf als Kontext (Blob, K5), verlinkt beide Sessions. Kein stilles Umschalten.
- [ ] **T21.3 — Lauf-Metriken und Schätzung.** Pro Zug: Start, Ende, Dauer, Tokens (nativ/geschätzt), Modell, Adapter, Aufgabentyp. Aus JSONL rekonstruierbar (K7).
  Schätzung = Median/P80 gleicher Adapter+Modell; weniger als 5 Läufe → „zu wenig Daten“.
- [ ] **T21.4 — Fragen-Dialog (Hybrid).** Aus claude (`AskUserQuestion`), codex (native Fragen), opencode/maki (ACP-Elicitation) ein Formular: Optionen als Chips, Mehrfachauswahl, Freitext „Sonstiges“,
  Antwort strukturiert zurück, Frage bleibt nach Reload sichtbar, Timeout sichtbar.

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
