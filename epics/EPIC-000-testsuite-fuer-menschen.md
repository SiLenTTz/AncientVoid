# EPIC-P000 — Testsuite für Menschen (Abnahmen durch Nutzer und Contributor)

**Status:** permanent — Geräte-/Live-Abnahmen offen (Nachfolger des P35-Endabnahme-Blocks) · **Phase:** P000 · **Dauer:** laufend, öffnet nie · **Abhängigkeit:** keine

---

## 1. Ziel

Sammelstelle für alles, was ein Mensch abnehmen oder verifizieren muss —
die „Testsuite für den Nutzer". Fachepics schließen sauber, sobald Code und
automatisierte Tests fertig sind (das ist die messbare Messlatte); alles, was
echte Geräte, echte Stimmen, echte Remotes oder die Nutzerfreigabe braucht,
wandert hierher als prüfbarer Eintrag mit Herkunftsbezug. Damit bleibt der
Epics-Counter ehrlich (offen = noch Arbeit am Produkt), und die
Menschen-Arbeit liegt gesammelt an einem Ort, statt in sechzig Epics zu
vergammeln. Dieses Epic übernimmt den Endabnahme-Block aus EPIC-P35 §8
(2026-11-18) und wächst weiter.

## 2. Scope

**Hierher gehört:** (a) Epics schließen und haben als einzigen Rest eine
Menschen-Abnahme → der Einzug wird hier als Eintrag geführt; (b) Bugs im
Status `fixed`, deren Verifikation einen Menschen braucht (Gerät, frischer
Clone, echtes Auge); (c) Entscheidungstore mit echtem Testtermin.
**Nicht hierher:** Agentenarbeit (bleibt im Ursprungsepic, das bleibt dann
offen), reine Go/No-Go-Entscheidungen ohne Testanteil (P30/P31 und die
Entscheidungstore bleiben offen), Doku-Pflege.

## 3. Design-Details

* **Eintragsformat:** `- [ ] **T000.n — Titel.** (Herkunft: …) Vorgehen.
  Messlatte. Beleg: Messlauf/Checklisten-Zeile mit Datum.`
* **Führen:** abgehakt wird **nur hier**; das Ursprungsepic trägt nach dem
  Umzug nur noch den Delegationsvermerk in der Checkboxzeile
  („nach P000 verschoben") — ein Eintrag, ein Ort zum Abhaken.
* **Ausführung:** Externe Contributor und Nutzer führen passende Einträge selbst
  aus — bei einschlägigen Issues oder nach Vereinbarung; interne Abnahmetermine
  finden auf Zuruf oder nach Agendapunkt statt;
  [`docs/p12-abnahme-checkliste.md`](../docs/p12-abnahme-checkliste.md)
  bleibt das Ausführungsprotokoll für die Legacy-P12-Zellen; neue Belege als
  `docs/messlauf/`-Dateien.
* **Statuszeile:** dieses Epic zeigt im Explorer den H-Punkt (blocked =
  „braucht Menschen") und bleibt im Counter offen, solange es Einträge gibt.

## 4. Aufgaben (Inventar)

### Übernommen aus EPIC-P35 §8 (Endabnahme-Block)

- [ ] **T000.1 — Geräte-Abnahme Handy über WAN.** (Herkunft: T12.1/T12.4/T12.7,
  T16.5, AC-P0-4, AC-P1-5, AC-P1.5-1, P1.6-DoD) Echtes Pairing über
  Tailnet/WAN, PC↔Handy↔PC-Kontinuität, Session vom Handy starten und
  Kontingent sehen, Offline/Flugmodus mit K10-Zeitstempel, Push im
  Hintergrund/Sperrbildschirm, 200 % Text, TalkBack/VoiceOver, Anhang aus
  dem Teilen-Menü, zweiter Origin (Fleet/Handoff/Entwürfe), Fairphone
  (gesperrt, Flugmodus), Gerätetokens einspielen und rotieren. K1/K7/K10.
- [ ] **T000.2 — Sprach- und K6-Gerätemessung.** (Herkunft: T12.4/AI-P10-1,
  T12.10, AC-P1.5-8, AC-P3-3, AC-P10-2) ≥ 20 Fachbegriff-Diktate je
  Zielgerät mit echter Stimme: Headset, Störgeräusch, Permission-Deny,
  Coldstart, WAN. Streaming-STT mit endpointing/VAD auf Zielhosts
  installieren/konfigurieren und je Gerät 100 warme Kurzbefehle messen
  (erstes Teiltranskript p95 ≤ 500 ms ab Sprachbeginn); `stt.streaming`
  danach erst standardmäßig an. K6.
- [ ] **T000.3 — Provider-Handläufe und Swarm.** (Herkunft: T12.4/AI-P5-1,
  T12.8, AC-P1-1-Rest, T3.1, T3.3-Rest, T7.5-Rest) Handläufe Claude Code,
  Codex, Copilot über die PWA inkl. ±10-%-Kostenabgleich, danach deren
  Resume-Zellen `verified`; Swarm-Adapter live gegen das Cockpit (braucht
  Admin-Credential/`swarm_cockpit`-Freischaltung und eine echte
  Lauf-JSONL); aider live mit dem lokalen Modell (`--yes-always` braucht
  ausdrückliche Nutzerfreigabe); Live-Probe des OpenAI-kompatiblen
  Beispiel-Adapters gegen die echte llama.cpp-Instanz. K1/K2.
- [ ] **T000.4 — Externe Systeme und WSL.** (Herkunft: T4.3, T4.4, T4.5,
  AC-P4-4, AI-P6-1/AC-P6-5-WSL-Teil) Hermes-Skill `agent-hub` dünn gegen
  echten Hermes; Gengar-Status-Board-Anbindung mit realen Zugangsdaten;
  WSL-Host in die Flotte aufnehmen und Hub-in-WSL2 vom Handy aus abnehmen.
  Der Host ist noch nicht bestimmt — **bmax ist ausdrücklich kein
  Kandidat** (Trading-Maschine, nicht als Host eingetragen; Nutzentscheid
  2026-11-07). gpubox muss dafür wieder erreichbar sein (siehe EPIC-P59).
- [ ] **T000.5 — Release-Entscheidungen.** (Herkunft: T4.8, T4.11; Lizenz ist
  erledigt — PolyForm Noncommercial 1.0.0, `LICENSE` committet 2026-11-09)
  v0.1-Tag + Changelog + Fixtures-Hygiene-Abschluss (der Repo-weite
  Secret-Scan steht seit MR !319 als Gate). Öffentliche, schwer rückgängig
  zu machende Aktionen nur mit expliziter Bestätigung.
- [ ] **T000.6 — Betriebs-Abnahmen.** (Herkunft: T12.2, T12.3, T12.5, T12.12,
  P14-Rest) 24-h-Dauerlauf mit ≥ 20 Sessions inkl. Netz-/Hub-/Modell-Ausfall
  (bestätigt nebenbei den FileTailer-Fix aus EPIC-P4.5 §8); K2/K8 unter
  echter Sprachlast; Restore-Latenz/ENOSPC/Retention-Löschlauf; Update &
  Rollback der Produktivinstanz; Desktop-Leck-Messung 0/50 am echten
  Hyprland-Desktop; produktiver `hubctl worktrees prune --apply` (löscht
  Daten — Entscheidung Jan). K2/K7/K8/K9/K10.
- [ ] **T000.7 — Abnahme der gebauten UI-Flows.** (Herkunft: P19, P22, P24,
  P26 T26.11/AC-P26-10, T25.6, AC-P34-13, AC-P35-7; plus P43 AI-P43-5:
  echtes Tablet, zweiter Bildschirm, TalkBack/Orca) Loop-Abnahme mit echtem
  Repo/Token, wartender Frage am Handy und K1 gesamt;
  Session-Entdeckung/Übernahme live am Handy; pi/omp/maki Live-Abnahme;
  Slash-Command-CLI-Listen live verifizieren (`capabilities().commands`);
  Arbeitsfläche/Eigene Fenster am Desktop mit Jan abnehmen (**AC-P34-13 +
  AC-P35-7 gemeinsam in einem Termin**, Präzedenz P1.5/P1.6).
- [ ] **T000.8 — Abschluss.** Abnahme-Checkliste vollständig, jede
  Herkunfts-AK am Ursprungsepic als `erfüllt via P000` vermerkt (oder mit
  dokumentierter Nutzentscheidung ⚪), K1–K10-Matrix belegt, Retro am
  Epic-File.

### Übernommene Bug-Verifikationen (Mensenaugen nötig)

- [ ] **T000.9 — BUG-0153 verifizieren.** Fix auf `main`; Verifikation braucht
  zwei frische Clones mit Standard-Wizard und leerer `projectRoots` —
  erste Session muss ohne Projektwurzel startbar sein, Tutorial-Schritt
  vorhanden. Beleg: Messlauf-Zeile mit Datum.
- [ ] **T000.10 — BUG-0187 verifizieren.** Fix auf `main`; Diff-Review-,
  Dateien- und Arbeitsort-Rahmen im hellen Thema prüfen — keine fremden
  Fallback-Farben mehr, alles bei leerem und gefülltem Zustand. Am Gerät
  und am Desktop. Beleg: Screenshot oder Checklisten-Zeile mit Datum.

### Einzelne Live-Abnahmen (nachträglich eingetragen, 2026-11-18)

- [ ] **T000.11 — Scratch-Repo-Abnahme beide Varianten.** (Herkunft: EPIC-P38
  T38.6) Runbook `docs/workplace-runbook.md` §3 mit echtem Harness
  durchlaufen: eigener Worktree und Projekt direkt, Sandbox getrennt.
- [ ] **T000.12 — Live-Lauf mit echtem Hermes-Koordinator.** (Herkunft:
  EPIC-P40, P39-Endabnahme) Orchestrierung live am Gerät.
- [ ] **T000.13 — Übersicht Sessions/Projekte/Hosts am echten Gerät.**
  (Herkunft: EPIC-P47)
- [ ] **T000.14 — Repo-Graph und Popout am echten Gerät.** (Herkunft:
  EPIC-P48, Popout-Rest aus EPIC-P46 T46.8)
- [ ] **T000.15 — Knowledge Vault Notizen am echten Gerät.** (Herkunft:
  EPIC-P49)
- [ ] **T000.16 — Vault-Erreichbarkeit/Tastatur am echten Gerät.**
  (Herkunft: EPIC-P51)
- [ ] **T000.17 — Main-Sync-Abnahme am echten Remote.** (Herkunft: EPIC-P67
  T67.10, Nutzeraufgabe) Veralteter Haupt-Checkout, neue Session startet
  frisch; `ask`-Ablauf am Handy; Konfliktfall echt provoziert — Schritte im
  Epic-Abschluss-Block.

## 5. Acceptance Criteria

* **AC-P000-1:** Jedes migrierte Epic, dessen einziger Rest eine
  Menschen-Abnahme war, steht im Counter abgeschlossen (delegierte
  Checkboxen statt offener) — der Counter zeigt nur noch echte Produktarbeit
  und die Entscheidungstore.
* **AC-P000-2:** Jeder Eintrag hat Herkunft und messbares Kriterium; kein
  Eintrag ohne Vorgehensbezug (Checkliste, Runbook oder Messlatte).
* **AC-P000-3:** Ein Abnahmetermin gilt als erbracht, wenn alle Einträge des
  Termins belegt sind oder sichtbar als „nicht geschafft" zurückliegen —
  kein stiller Rückfall.

## 6. Premortem (was schiefläuft, wenn das hier scheitert)

1. **Friedhofseffekt:** Der Sammelordner wächst, niemand räumt ihn, und nach
   sechs Monaten ist er das, was die offenen Checkboxen vorher waren.
   Gegenmittel: Aufnahme nur für echte Menschenarbeit (Aufnahmeregel §2),
   Termin auf Zuruf, Inventar bleibt kurz und ausführbar.
2. **Doppelbuchung:** Eintrag wird hier UND im Ursprungsepic geführt und
   driftet. Gegenmittel: abhaken nur hier (Delegationsprinzip §3);
   `epic-status` zählt Delegationszeilen nicht als offen.
3. **Überdehnung:** Agentenarbeit wird als „Menschenarbeit“ umgelagert und
   blockiert die Produktarbeit — oder Entscheidungen gehen hier ein und
   fehlen im Entscheidungsprozess.
   Gegenmittel: Aufnahmeregelung §2; Gegenprobe ist der epics-Counter —
   er muss nach Migration nur noch echte Arbeit und Tore zeigen.
4. **Referenzrot:** Umbenennung/Umnummerierung von Herkunfts-Tasks lässt die
   Bezüge verwaisen. Gegenmittel: voller Dateiname als Herkunft, ID im Klartext.

## 7. Definition of Done (permanent)

Dieses Epic hat keinen globalen Abschluss — es ist leer, wenn der letzte
Eintrag mit Beleg (Messlauf, Checklisten-Zeile mit Datum, Testname) erledigt
oder per dokumentierter Nutzentscheidung geschlossen ist. Jede Aufnahme und
jede Erledigung ist ein Commit mit Verweis auf die Eintrags-ID.
