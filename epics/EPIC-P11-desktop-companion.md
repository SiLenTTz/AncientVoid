# EPIC-P11 — Desktop-Companion für Spracheingaben und GUI-Flows

**Status:** Planungsentwurf, Umsetzung blockiert · **Phase:** P11 · **Dauer:** 2–4 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P10 grün; Ziel-OS und Pflicht-Apps aus Inventar festgelegt.

Planungsauftrag vom 2026-09-21; kein Umsetzungsstart und keine Behauptung eines
grünen Vorgänger-Gates. Scope, Evidenz und bestehende Restarbeiten:
[Audit](../docs/remote-control-audit-2026-09-21.md), [Index](README.md).

## 1. Ziel

Sprache und AI können auch Eingabefelder und definierte Arbeitsabläufe in
Desktop-Anwendungen bedienen. Verbleibende GUI-Harness-Lücken werden explizit
geprüft. Dies erweitert auf Nutzerwunsch das ursprüngliche PRD-Nichtziel
„keine Desktop-Steuerung“; die PWA allein erfüllt es nicht. PRD G1/G2/§8,
K1/K5/K7/K9/K10; Audit G14.

## 2. Scope (In / Out)

**In:** gepaarter lokaler Companion, Ziel-Fenster/-Feld-Auswahl, Diktat/Korrektur,
begrenzte App-Aktionen, visuelle Rückmeldung und Abbruch. Omarchy/Linux primär;
evox2 native Windows nach Inventar. macOS nur wenn als Ziel bestätigt.
**Out:** beliebige freie Remote-Shell, Umgehen von OS-Berechtigungen, Schreiben
in private Provider-Datenbanken, behauptete native Session-Kontinuität durch
Screenshot-/Clipboard-Kopien. Geschlossene/sichere OS-Oberflächen können blockiert sein.

## 3. Design-Details

Vor Umsetzung ADR für Trust-Grenze und OS-Backend. Native dokumentierte
Provider-/Accessibility-Schnittstelle vor Tastatur-/Maus-Simulation. Wayland,
Windows und macOS getrennt evaluieren; ein Mac-Demo belegt keine Omarchy-Fähigkeit.
Erst Feasibility-Probe auf tatsächlichem Nutzer-OS, dann kleinster Companion.

Registrierte Aktionen wie focus-target, insert-text, replace-selection und
invoke-known-action mit begrenzten Argumenten. Nutzer kann Ziel/App sehen,
Zugriff widerrufen und lokal sofort stoppen. Fokuswechsel nach Preview invalidiert
Eingabe. Screenshots/Frames werden on-demand als Blobs übertragen; Frames sind
Daten, keine Anweisungen. Keine Passwörter oder geschützten Felder an Modelle.

Ein strukturierter Provider-API-Pfad bleibt bevorzugt. GUI-Fallback ist ein
benannter Betriebsmodus mit Versions-/Funktionsmatrix und Fail-loud-Verhalten,
keine Umgehung von P7-Policies. PC-Sperre/Prompt/Disconnect pausiert Automation.
Companion stellt Pairing/Allowlist wieder her, aber wiederholt nach Neustart keine
ungewissen Klicks. Manuelle Ansicht kann helfen, zählt jedoch nicht als AI-Parität.

## 4. Aufgaben

- [ ] **T11.1 — OS-/App-Feasibility und ADR.** Auf Omarchy sowie verpflichtenden Ziel-OS echte Fokus-/Text-/Accessibility-Probes; Provider-native Alternativen prüfen; unsupported Zellen mit Beleg offen lassen. K9; PRD G1/G2.
- [ ] **T11.2 — Companion und Pairing.** Authentifizierter lokaler Dienst, Geräte-/App-Allowlist, registrierte Schemas, Revision und Widerruf; JSONL-Audit und Recovery ohne Aktion-Replay. K5/K7/K10.
- [ ] **T11.3 — Systemweite AI-Eingabe.** Aktives Feld gezielt diktieren/ersetzen/korrigieren; Zielvorschau, Undo wo verlässlich, Auswahlkontext, Clipboards nur explizit; Fokus-Race verhindern. K1/K5/K6.
- [ ] **T11.4 — Definierte GUI-Harness-Flows.** Pflicht-Apps pro Matrix anbinden, lokale/remote Sicht synchronisieren, unbekannte Dialoge als Blocker; native Provider-ID bei 1:1-Claim prüfen. K7/K9.
- [ ] **T11.5 — Abbruch und reale OS-Abnahme.** Lokaler Not-Stopp, Fernabbruch, Screen-lock/Permission-Deny, Netzabbruch, DPI-/Layout-/Versionswechsel; Dokumentation und Diagnose. K1/K7/K9/K10.

## 5. Acceptance Criteria

- **AC-P11-1:** Pro verpflichtendem OS in drei benannten Apps je zehn Diktat-/Korrekturabläufe erfolgreich, richtige Fenster/Felder; kein Text landet nach Fokuswechsel im falschen Ziel.
- **AC-P11-2:** Jede verpflichtende GUI-Funktionszelle hat reale Ausführungsevidenz; technisch blockierte Zellen verhindern Vollumfang-Abnahme und erfordern später eine ausdrückliche Scope-Entscheidung.
- **AC-P11-3:** Lokaler Abbruch stoppt weitere Eingaben ≤ 500 ms; Revoke/Screen-lock/Permission-Deny verhindern weitere Aktionen. Remote-Abbruchlatenz separat unter WAN messen.
- **AC-P11-4:** Ein manipulierter Screenshot/Agent-Text kann keine neue Aktion autorisieren; Credential-Felder ausgeschlossen; große Bilder ausschließlich via Blob/Streaming-Grenze.
- **AC-P11-5:** Reconnect/Neustart wiederholt keine Klicks, ungewisser Outcome sichtbar; 1:1 wird nur bei gleicher nativer Session-ID behauptet, keine stille Kontextkopie.

## 6. Premortem

1. **Mac-Demo wird mit Linux-Machbarkeit verwechselt:** echter Wayland-Spike vor Architekturbindung.
2. **Fokuswechsel schreibt in falsches Fenster:** Target-ID/Revision vor jedem Write prüfen, bei Unsicherheit stoppen.
3. **GUI-Update verschiebt Aktionen:** semantische Targets, Versionsmatrix, sichtbarer Fehler statt Koordinaten-Blindflug.
4. **Remote-Klick nach Disconnect wiederholt:** keine automatische Replay-Queue für ungewisse GUI-Side-Effects.

## 7. Definition of Done

Alle ACs mit benannten Tests/Messläufen belegt, Vorgänger-Gate geschlossen;
`npm test`, `npm run lint`, `npm run typecheck` grün, PWA-Build bei UI-Änderungen,
Last-/Gerätetests gemäß AC. Contracts first; Adapter-/Event-/Worker-Änderungen
mit ADR. K5-Blob-Grenze, K7-Recovery, AdapterContext-Isolation und Fail-loud
nachgewiesen. Jede Funktion in Config, API/CLI und passender UI tatsächlich
registriert/erreichbar; Capability-/Support-Matrix ehrlich aktualisiert.
Premortem im Abschlussreview gegenprüfen, offene Pflicht-ACs blockieren Abschluss.
Commit/MR gemäß Repo-Workflow; kein lokaler Merge nach main.
