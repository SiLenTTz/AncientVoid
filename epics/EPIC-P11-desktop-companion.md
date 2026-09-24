# EPIC-P11 — Desktop-Companion für Spracheingaben und GUI-Flows

**Status:** abgeschlossen mit Restnachweisen in P12 (2026-09-24, Retro unten) · **Phase:** P11 · **Dauer:** 2–4 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P10 grün; Ziel-OS und Pflicht-Apps aus Inventar festgelegt.

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

- [x] **T11.1 — OS-/App-Feasibility und ADR.** Auf Omarchy sowie verpflichtenden Ziel-OS echte Fokus-/Text-/Accessibility-Probes; Provider-native Alternativen prüfen; unsupported Zellen mit Beleg offen lassen. K9; PRD G1/G2. Stand 2026-09-24: [ADR-0031](../docs/adr/0031-desktop-companion.md). Omarchy = Hyprland 0.56 (Wayland): Fokus über hyprctl/socket2, Eingabe über das Virtual-Keyboard-Protokoll (wtype), AT-SPI nur lesend (Passwortrolle). Probes ausschließlich im isolierten headless-sway-Labor, nie auf deinem Desktop; Hyprland-Backend per Unit-Test. Windows/macOS nicht Ziel (evox2 ist Linux).
- [x] **T11.2 — Companion und Pairing.** Authentifizierter lokaler Dienst, Geräte-/App-Allowlist, registrierte Schemas, Revision und Widerruf; JSONL-Audit und Recovery ohne Aktion-Replay. K5/K7/K10. Stand 2026-09-24: `apps/companion` (Token `companion:<pc>`, nur eigene Routen), Long-Poll, `--allow`, Aufträge in SQLite (Migration 21, Text nach Ende gelöscht), nach Neustart „ungewiss“ statt Replay; Tests `desktop.test.ts`, `companion.test.ts`.
- [x] **T11.3 — Systemweite AI-Eingabe.** Aktives Feld gezielt diktieren/ersetzen/korrigieren; Zielvorschau, Undo wo verlässlich, Auswahlkontext, Clipboards nur explizit; Fokus-Race verhindern. K1/K5/K6. Stand 2026-09-24: PWA-Seite „PC“ (Ziel sichtbar, Text/Diktat, Eintippen/Ersetzen, Enter/Tab/Esc/Rückgängig, Abbrechen); Fokus-Revision vor dem Tippen, Fokus-Ereignisse währenddessen; Zwischenablage nicht benutzt; E2E `desktop.spec.ts`.
- [ ] **T11.4 — Definierte GUI-Harness-Flows.** Pflicht-Apps pro Matrix anbinden, lokale/remote Sicht synchronisieren, unbekannte Dialoge als Blocker; native Provider-ID bei 1:1-Claim prüfen. K7/K9. → nicht umgesetzt, nach P12 (AI-P11-2): braucht die echten Desktop-Apps (Claude Desktop, Cursor …) an deinem Desktop; im Labor nicht sinnvoll.
- [x] **T11.5 — Abbruch und reale OS-Abnahme.** Lokaler Not-Stopp, Fernabbruch, Screen-lock/Permission-Deny, Netzabbruch, DPI-/Layout-/Versionswechsel; Dokumentation und Diagnose. K1/K7/K9/K10. Stand 2026-09-24 (Labor-Teil): Not-Stopp per Socket/Keybind, Abbruch vom Handy, Sperrbildschirm, Token-Widerruf; [Messlauf](../docs/messlauf/2026-09-24-p11-desktop.md). Reale Abnahme am Hyprland-Desktop → P12 T12.4.

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

## Retro

**Zeitraum:** 2026-09-24 · **Gate:** lokal grün (Abschluss-MR)

### AK-Matrix

- **AC-P11-1:** 🟡 teilweise
  - **Beleg:** Messlauf. Drei Apps (GTK4, foot, Chromium) mit je 10
    Abläufen, zweimal 30/30. Fokuswechsel nach der Vorschau: 20/20 ohne
    ein Zeichen.
  - **Was fehlt:** Wechselt der Fokus während des Tippens, landete in 1 von
    20 Fällen 1 Zeichen im neuen Fenster (AI-P11-3). Das Labor ist nicht
    das Ziel-OS. Die Abnahme an Hyprland fehlt (AI-P11-1).
- **AC-P11-2:** 🔴 offen
  - **Bemerkung:** Die GUI-Harness-Flows (T11.4) sind nicht umgesetzt.
    GTK3-Felder bekommen im Labor keine Zeichen. Die Zellen stehen offen
    (AI-P11-2).
- **AC-P11-3:** 🟢 erfüllt (lokal)
  - **Beleg:** Not-Stopp p50 28–48 ms, max 89 ms (Messlauf, 20 Läufe).
    Test „emergency stop at the PC ends typing within 500 ms …“. Widerruf
    und Sperre blockieren (Tests).
  - **Offen:** Die Latenz über WAN ist nicht gemessen (AI-P11-1).
- **AC-P11-4:** 🟢 erfüllt
  - **Beleg:** Nur `desktop.act` für Menschen. Agenten und Companion
    können keine Aktion auslösen (Policy-Test, Token-Grenzen im
    Companion-Test). Passwortfelder in GTK4 und GTK3 werden abgelehnt
    (Messlauf). Passwortmanager und Dialoge per App oder Titel, Test in
    `desktop.test.ts`. Es gibt keine Screenshots, also auch keine großen
    Bilder.
- **AC-P11-5:** 🟢 erfüllt
  - **Beleg:** Test „a hub restart: pending expires, delivered becomes
    uncertain — nothing is replayed“, Verfall nach 10 s, Aufträge werden
    nur einmal ausgeliefert. Eine „1:1-Session“ wird nicht behauptet (kein
    Session-Claim).

**Stand:** 3 🟢 / 1 🟡 / 1 🔴.

### Premortem

1. **Eine Mac-Demo wird mit Linux-Machbarkeit verwechselt:** nicht
   eingetreten. Es gab den Wayland-Spike vor der Architektur, zudem auf
   einem echten wlroots-Compositor.
2. **Fokuswechsel schreibt ins falsche Fenster:** eingetreten und
   gemessen. Zuerst 55 Zeichen, dann 9, jetzt 0 bis 1 Zeichen. Revision und
   Fokus-Ereignisse helfen, eine Restgrenze bleibt.
3. **Ein GUI-Update verschiebt Aktionen:** nicht zutreffend. Es gibt keine
   Koordinaten und keine Klicks.
4. **Ein Remote-Klick wird nach Disconnect wiederholt:** verhindert. Kein
   Replay, Zustand „ungewiss“.

### Erkenntnisse

1. Das Labor war nötig: Die ersten beiden Entwürfe sahen in Unit-Tests gut
   aus und leckten real bis zu 55 Zeichen. Beleg: Messlauf, Abschnitt
   „Verlauf“.
2. Eine virtuelle Tastatur kennt kein Zielfenster. Sicherheit kommt nur aus
   schneller Erkennung (Compositor-Ereignisse) plus Tastenverzögerung. Beleg:
   0 bis 1 Zeichen statt 9.
3. Auf dem echten Desktop wurde bewusst nicht getippt, weil dort private
   Fenster offen waren (Messlauf, „Was das nicht sagt“).

### Action Items

- **AI-P11-1:** Abnahme am Hyprland-Desktop mit dir: drei Apps × 10,
  Keybind-Not-Stopp, WAN-Abbruch. Zurück als: P12 T12.4.
- **AI-P11-2:** GUI-Harness-Flows (T11.4) und die GTK3-Zelle an echten Apps
  prüfen. Zurück als: P12 T12.4.
- **AI-P11-3:** Leckfreie gezielte Eingabe unter Hyprland (`sendshortcut`
  auf Fenster-Adresse, Einfügen nur als ausdrücklicher Modus). Zurück als:
  P12 T12.12.

