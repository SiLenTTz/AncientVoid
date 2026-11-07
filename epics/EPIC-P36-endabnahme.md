# EPIC-P36 — Endabnahme: alle Geräte-, Provider- und Extern-Abnahmen in einer Runde

**Status:** offen (Vorbereitung autonom machbar; Abnahmen brauchen Jan/echte Umgebung) · **Phase:** P36 · **Dauer:** 0,5–1 Agenten-Wochen Vorbereitung + Abnahme-Termine · **Abhängigkeit:** alle übrigen offenen Epics, Aufgaben und Bugs abgeschlossen (Nutzentscheid 2026-11-07: „Live-Abnahmen erst machen, sobald alle aktuellen offenen Punkte, Bugs und Epics abgeschlossen sind — dafür ein eigenes Endabnahme-Epic; die betroffenen AK überall entsprechend schließen")

---

> **Konsolidierung 2026-11-07:** Die Live-/Geräte-/Provider-/Extern-Abnahmen
> waren previously auf P12 (T12.1–T12.5, T12.7, T12.8, T12.10, T12.12), P16
> (T16.5/T16.8) und einzelne Epic-Restpunkte (P0–P4.5, P19, P22, P24, P25,
> P34) verteilt. Sie laufen hier gebündelt; die Ursprungs-Epics sind per
> Verweis auf dieses Epic geschlossen (G0-Prinzip bleibt: die Ursprungs-AK
> wird nicht still vergessen, sie lebt mit ihrer Task-ID hier weiter). Die
> [`docs/p12-abnahme-checkliste.md`](../docs/p12-abnahme-checkliste.md) bleibt
> das Ausführungsprotokoll zu diesem Epic.

## 1. Ziel

Eine einzige, vorbereitete Abnahme-Runde am echten Zielgerät, echten Netz und
echten Providern, die jede verbliebene „live zu prüfen"-Aussage des Produkts
mit Beleg erledigt — danach gilt das „fertig und nutzbar" aus
[Audit §8](../docs/remote-control-audit-2026-09-21.md) erstmals überprüfbar.

## 2. Scope (In / Out)

**In:**
- Abnahmen, die ein echtes Gerät, eine echte Stimme, WAN/Tailnet, einen
  Provider-Zugang oder ein externes System brauchen (T36.1–T36.4, T36.7).
- Betriebs-Abnahmen unter Dauer/Ausfall (T36.6).
- Die zwei Release-Entscheidungen Lizenz und v0.1-Tag (T36.5) — die einzige
  Code-fremde Ausnahme, weil beide die Abnahme-Runde krönen.

**Out:**
- Neue Features oder Refactoring. Finden sich während der Abnahme Defekte:
  `bugs/bug-NNNN` (Skill `bug-report`), Abnahme läuft mit dokumentierter
  Lücke weiter — kein Abnahme-Epic wird zum Repair-Epic.
- Schon belegte AK werden nicht erneut gemessen (Belege zählen weiter).

## 3. Design-Details

### 3.1 Ablauf

1. **Vorbereitung (autonom):** Je Abnahmeblock eine Checkliste mit exakten
   Schritten, erwarteten Messwerten und Messlatten-Referenz; Smoke-Läufe
   gegen den Staging-Hub, wo möglich. Ziel: Am Termin mit Jan zählt nur das
   echte Gerät, nicht die Einrichtung.
2. **Termine:** Ein Termin je Block (Gerät, Stimme, Provider, Extern,
   Betrieb), dokumentiert in
   [`docs/p12-abnahme-checkliste.md`](../docs/p12-abnahme-checkliste.md).
3. **Belege:** Jede AK bekommt ihren Nachweis als Messlauf
   (`docs/messlauf/`, Skill `messlauf`), Checklisten-Häkchen mit Datum oder
   Commit; die Ursprungs-AK wird am Ursprungsepic auf `erfüllt via P36`
   gesetzt.

### 3.2 Grundsätze

- **Kein Ersatz durch Loopback/Fixtures:** Was „am Gerät/WAN/Provider"
  heißt, wird dort geprüft (R9.7 aus dem Audit gilt weiter).
- **Fail loud:** Eine AK, die nicht geprüft werden kann, bleibt offen mit
  benanntem Blocker — niemals still grün.
- **Reihenfolge:** Gerät → Stimme → Provider → Extern → Betrieb → Release;
  frühe Blöcke decken Umgebungsprobleme auf, bevor späte sie doppelt zahlen.

## 4. Aufgaben

- [ ] **T36.1 — Geräte-Abnahme Handy über WAN.** (aus T12.1/T12.4/T12.7, T16.5,
  AC-P0-4, AC-P1-5, AC-P1.5-1, P1.6-DoD) Echtes Pairing über Tailnet/WAN,
  PC↔Handy↔PC-Kontinuität, Session vom Handy starten und Kontingent sehen,
  Offline/Flugmodus mit K10-Zeitstempel, Push im Hintergrund/Sperrbildschirm,
  200 % Text, TalkBack/VoiceOver, Anhang aus dem Teilen-Menü, zweiter Origin
  (Fleet/Handoff/Entwürfe), Fairphone (gesperrt, Flugmodus), Gerätetokens
  einspielen und rotieren. K1/K7/K10.
- [ ] **T36.2 — Sprach- und K6-Gerätemessung.** (aus T12.4/AI-P10-1, T12.10,
  AC-P1.5-8, AC-P3-3, AC-P10-2) ≥ 20 Fachbegriff-Diktate je Zielgerät mit
  echter Stimme: Headset, Störgeräusch, Permission-Deny, Coldstart, WAN.
  Streaming-STT mit endpointing/VAD auf Zielhosts installieren/konfigurieren
  und je Gerät 100 warme Kurzbefehle messen (erstes Teiltranskript p95
  ≤ 500 ms ab Sprachbeginn); `stt.streaming` danach erst standardmäßig an.
  K6.
- [ ] **T36.3 — Provider-Handläufe und Swarm.** (aus T12.4/AI-P5-1, T12.8,
  AC-P1-1-Rest, T3.1, T3.3-Rest, T7.5-Rest) Handläufe Claude Code, Codex,
  Copilot über die PWA inkl. ±10-%-Kostenabgleich, danach deren
  Resume-Zellen `verified`; Swarm-Adapter live gegen das Cockpit (braucht
  Admin-Credential/`swarm_cockpit`-Freischaltung und eine echte Lauf-JSONL);
  aider live mit dem lokalen Modell (`--yes-always` braucht ausdrückliche
  Nutzerfreigabe); Live-Probe des OpenAI-kompatiblen Beispiel-Adapters
  gegen die echte llama.cpp-Instanz. K1/K2.
- [ ] **T36.4 — Externe Systeme und WSL.** (aus T4.3, T4.4, T4.5, AC-P4-4,
  AI-P6-1/AC-P6-5-WSL-Teil) Hermes-Skill `agent-hub` dünn gegen echten
  Hermes; Gengar-Status-Board-Anbindung mit realen Zugangsdaten; WSL-Host in
  die Flotte aufnehmen und Hub-in-WSL2 vom Handy aus abnehmen. Der Host ist
  noch nicht bestimmt — **bmax ist ausdrücklich kein Kandidat**
  (Trading-Maschine, nicht als Host eingetragen; Nutzentscheid 2026-11-07).
- [ ] **T36.5 — Release-Entscheidungen.** (aus T4.8, T4.11) Lizenz festlegen
  und LICENSE-File committen (Rechts-/Geschäftsentscheidung, Jan); v0.1-Tag +
  Changelog + Fixtures-Hygiene-Abschluss (der Repo-weite Secret-Scan steht
  seit MR !319 als Gate). Öffentliche, schwer rückgängig zu machende
  Aktionen nur mit expliziter Bestätigung.
- [ ] **T36.6 — Betriebs-Abnahmen.** (aus T12.2, T12.3, T12.5, T12.12,
  P14-Rest) 24-h-Dauerlauf mit ≥ 20 Sessions inkl. Netz-/Hub-/Modell-Ausfall
  (bestätigt nebenbei den FileTailer-Fix aus EPIC-P4.5 §8); K2/K8 unter
  echter Sprachlast; Restore-Latenz/ENOSPC/Retention-Löschlauf; Update &
  Rollback der Produktivinstanz; Desktop-Leck-Messung 0/50 am echten
  Hyprland-Desktop; produktiver `hubctl worktrees prune --apply`
  (löscht Daten — Entscheidung Jan). K2/K7/K8/K9/K10.
- [ ] **T36.7 — Abnahme der gebauten UI-Flows.** (aus P19, P22, P24, T25.6,
  AC-P34-13, AC-P35-7) Loop-Abnahme mit echtem Repo/Token, wartender Frage
  am Handy und K1 gesamt; Session-Entdeckung/Übernahme live am Handy;
  pi/omp/maki Live-Abnahme; Slash-Command-CLI-Listen live verifizieren
  (`capabilities().commands`); Arbeitsfläche/Eigene Fenster am Desktop mit
  Jan abnehmen (AC-P34-13 gemeinsam mit AC-P35-7).
- [ ] **T36.8 — Abschluss.** Abnahme-Checkliste vollständig, jede
  Herkunfts-AK am Ursprungsepic als `erfüllt via P36` vermerkt (oder mit
  dokumentierter Nutzentscheidung ⚪), K1–K10-Matrix belegt, Retro am
  Epic-File.

## 5. Acceptance Criteria

- **AC-P36-1:** Jede in T36.1–T36.7 referenzierte Herkunfts-AK ist erledigt
  mit Beleg (Messlauf, Checklisten-Zeile mit Datum, Commit oder Testname)
  oder per dokumentierter Nutzentscheidung geschlossen — es existiert keine
  still offene.
- **AC-P36-2:** Die Geräte-Abnahmen (T36.1/T36.2) liefen über WAN/Tailnet am
  echten Zielgerät, nicht über adb/Loopback; die SESSION-Umgebung
  (Hub-Version, Token, Tailnet) ist im jeweiligen Beleg festgehalten.
- **AC-P36-3:** Nach der letzten Abnahme ist `npm run gate` grün und es
  existiert kein offenes `test.fixme` ohne Bug-/Task-Referenz.
- **AC-P36-4:** Lizenz (LICENSE-File) und v0.1-Tag sind entschieden und
  committet/tagged — oder das Nicht-Release ist als Nutzentscheidung
  dokumentiert.
- **AC-P36-5:** Retro-Sektion an dieser Datei; Ursprungs-Epics zeigen
  überall den Finalzustand (kein „offen (irgendwo)" mehr).

## 6. Premortem

**Ende P36, gescheitert. Warum?**
1. *Die Abnahme-Termine verschieben sich endlos, weil immer noch ein Epic
   „fast fertig" ist.* Mitigation: Startkriterium ist der
   Nutzentscheid-Modus „alles andere zu"; Termine werden als erste Aufgabe
   gelegt, nicht als letzte; Vorbereitung läuft parallel zu den Rest-Epics.
2. *Die Geräte-Umgebung driftet vor dem Termin (Tailnet, Tokens,
   Hub-Version).* Mitigation: T36.1-Vorbereitung endet mit einem
   Smoke-Lauf gegen den Staging-Hub am selben Gerät; Abweichung = Blocker
   vor dem Termin, nicht während.
3. *Eine Fund-Flut während der Abnahme kippt die ganze Runde.* Mitigation:
   Defekte sofort als `bugs/bug-NNNN` mit Repro, Abnahme läuft weiter; pro
   AK zählt der Beleg, nicht die Abwesenheit aller Bugs.
4. *„Fast fertig"-Täuschung: 29 von 30 AK grün, die letzte blockiert den
   Release unbegrenzt.* Mitigation: T36.5 trennt Entscheidung von Umsetzung;
   ein dokumentiertes No-go (z. B. Lizenz vertagt) ist ein gültiger
   P36-Abschluss für AC-P36-4, kein verstecktes Rot.

## 7. Definition of Done

Alle AC erfüllt; jede neue UI-Funktion oder jeder Ablauf, die während P36
entsteht, hat einen Spec in `e2e/specs/` und `npm run gate` grün
([`docs/testing-e2e.md`](../docs/testing-e2e.md)); Belege liegen in
`docs/messlauf/` bzw. der Abnahme-Checkliste; Retro angehängt;
`epics/README.md` zeigt P36 als Abschluss der Kette.
