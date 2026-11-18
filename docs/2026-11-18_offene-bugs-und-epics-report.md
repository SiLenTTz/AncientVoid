# Offene Bugs und Epics — Status, Blocker, Empfehlungen (Stand 2026-11-18)

Eingefrorener Analyse-Snapshot (kein lebendes Dokument). Grundlage: `bugs/*.md`
(Frontmatter-`status`) und `npm run epics:status -- --json` (Regeln S1/S2/C1/C2,
`docs/epic-status.md`). Anlass: Nutzerauftrag 18.11.2026 — Kennzeichnung
„braucht Menschen“ im Explorer (ADR-0089) und ein belastbarer Lagebericht.
Empfehlungen sind Vorschläge; der Report löst nichts automatisch.

## 1. Kurzbilanz

- **Bugs:** 215 Dateien — 189 `done`, 2 `fixed` (Fix liegt, Verify durch Menschen
  ausstehend), 1 `wont-fix` (Entscheid gefallen), 11 `open` (+1 Template).
  Blockiert im Sinne „kann nicht ohne Menschen weiter“: die zwei `fixed`-Bugs
  (Verify) und BUG-0170 (Windows-Unterstützung ist eine Produktentscheidung).
  Alle übrigen `open`-Bugs sind agentisch behebbar — kein Blocker, nur Arbeit.
- **Epics:** 73 Dateien, davon 46 mit offenen Punkten laut offiziellem Zähler.
  Davon wiederholt der Zähler konservativ (S2): P29 ist faktisch fertig.
  Echte Menschen-Blocker gibt es in zwei Formen: **Entscheid nötig**
  (Go/No-Go/Review) und **Abnahme nötig** (Gerät/Handy/Live-Lauf, gebündelt im
  P35-Endabnahme-Block). P30/P31 bleiben On hold (Nutzerentscheid 15.11.2026,
  AGENTS.md) — nicht als nächste Aufgabe empfehlen.

## 2. Bugs (offen / nicht done)

| Eintrag | Status | Warum offen / geblockt | Empfehlung |
|---|---|---|---|
| BUG-0153 | fixed | Fix gelandet (Wizard fragt projectRoots); Verify auf zwei frischen Klonen steht aus | **Entblocken:** Verify durch Menschen, dann done |
| BUG-0187 | fixed | Fix gelandet (Tokens im hellen Thema); Blick-Check im hellen Thema am Gerät steht aus | **Entblocken:** Verify durch Menschen, dann done |
| BUG-0077 | wont-fix | Nicht reproduzierbar; Ablehnung entschieden | nichts — kann als abgeschlossen galoppiert werden (Entscheid steht) |
| BUG-0167 | open | Flaky nach fastify-Update, „manchmal“; Diagnose läuft ins Eingrenzen | weiterlaufen (agentisch) |
| BUG-0170 | open | Volle Suite auf Windows rot (CRLF/Symlinks/Spawn); Umgebung nicht entschieden | **Entscheid:** Windows unterstützen (dann Fix) oder offiziell nicht unterstützen (dann wont-fix) |
| BUG-0176 | open | E2E-Klick ins Formular zeitweise durch Layout überdeckt; flaky, nie lokal reproduziert | weiterlaufen (agentisch) |
| BUG-0188 | open (Hermes) | Hermes-Session stumm bei langen Turns; Resume-Griff (K7) nach Stop verloren | weiterlaufen (agentisch) |
| BUG-0188 | open (Projekt) | Projekt-Anlegen ignoriert gewählten Host; **ID-Kollision mit dem Hermes-BUG-0188** | weiterlaufen (agentisch); ID der neueren Datei bereinigen |
| BUG-0202 | open | Cursor `interaction_query`/`tool_call` landen nicht im Chat | weiterlaufen (agentisch) |
| BUG-0207 | open | Live-Strom rollt nicht mit (Handy) | weiterlaufen (agentisch) |
| BUG-0208 | open | Nach Stromende steht die Spitze am Ende statt am Nachrichtenanfang | weiterlaufen (agentisch) |
| BUG-0211 | open | Lange Gespräche: Hochscrollen endet nach 500 Einträgen | weiterlaufen (agentisch) |
| BUG-0214 | open | STT-Verfügbarkeit geschwindelt, kein Browser-Fallback | weiterlaufen (agentisch) |

## 3. Epics mit Entscheidungs-Blocker (Mensch muss Go/No-Go sprechen)

| Epic | Status laut Datei | Warum geblockt | Empfehlung |
|---|---|---|---|
| P15 | Code abgeschlossen bis auf Entscheidung | ADR-0034-Entscheid steht aus | **Entscheid ⇒ Entblocken** |
| P32 | Evaluations-Exit „vertagt“ | Umsetzung gesperrt bis ausdrückliches Go | **Entscheid:** beauftragen oder formal ablehnen |
| P33 | Evaluations-Exit „vertagt“ | kein Go erteilt | **Entscheid:** beauftragen oder formal ablehnen |
| P44 | Planungsentwurf | Umsetzung gesperrt | **Entscheid:** beauftragen oder formal ablehnen |
| P54 | Planungsentwurf | wartet auf Nutzer-Review (beauftragt 12.11.) | Review ⇒ Entblocken |
| P55 | Planungsentwurf | wartet auf Nutzer-Review (beauftragt 12.11.) | Review ⇒ Entblocken |
| P61 | offen (Planungsentwurf) | Entscheidung Default 17.11. gefallen, Umsetzung noch nicht beauftragt | beauftragen ⇒ weiterlaufen |
| P62 | offen (Planungsentwurf) | Issue #14, noch kein Auftrag | beauftragen oder ablehnen |
| P64 | offen (Planungsentwurf) | kein Auftrag; Koordination mit P63 (abgeschlossen) nötig | beauftragen ⇒ weiterlaufen |
| P65 | offen (Planungsentwurf) | kein Auftrag; reihenempfohlen nach P64 | beauftragen ⇒ weiterlaufen |
| P30 | **On hold** (Nutzerentscheid 15.11.) | sperrt bis ausdrückliche Wiederaufnahme | **liegen lassen** (AGENTS.md) — nicht starten |
| P31 | **On hold** (Nutzerentscheid 15.11.) | sperrt bis ausdrückliche Wiederaufnahme | **liegen lassen** (AGENTS.md) — nicht starten |

## 4. Epics, die auf menschliche Abnahme warten (Code/Umsetzung steht)

Der Kern des neuen `blocked`-Status. Die Geräte-/Live-Abnahmen sind in P12/P16
schon seit der Abnahme-Retro (09.11.) in den **Endabnahme-Block P35
(T35.10–T35.17)** gebündelt: ein Mensch am echten Gerät/Handy erledigt dort
gebündelt fast alles. Empfehlung für alle Zeilen dieses Blocks: **Entblocken
durch Abnahme-Termin** — nicht ablehnen, die Produktliste ist abnahmefähig.

| Epic | Was auf Menschen wartet |
|---|---|
| P0 | Geräteabnahme (T35.10); Rückstufung 09.11. |
| P1 | Live-Teile inkl. Kostenabgleich (T35.12) |
| P1.5 | Geräteabnahme/Handy-Test (T35.10/T35.11) |
| P1.6 | gemeinsamer Live-Handy-Test (T35.10/T35.11) |
| P2 | biometrische Mobilfreigabe über WAN (T35.10) |
| P3 | Sprachsuche-Live-Probe + K6-Gerätemessung (T35.11/T35.12) |
| P4 | externe Punkte T35.13/T35.14 (inkl. Lizenz, v0.1-Tag) |
| P4.5 | 24-h-Dauerlauf (T35.15) |
| P12 | 9 offene Checkboxen = die gebündelten Geräte-/Betriebsabnahmen |
| P16 | Handy-Abnahme T16.5/T16.8 (→ T35.10) |
| P19 | manuelle Abnahme der Loop-Dark-Factory (Auftrag Jan 28.10.) |
| P21 | Roll-out und Retro offen |
| P25 | Live-Verifikation CLI-Command-Listen (T35.16) |
| P26 | manuelle Abnahme mit echter Factory (`not_run`) |
| P34 | Live-Abnahme AC-P34-13 durch Jan |
| P35 | **der Endabnahme-Block selbst (T35.10–T35.17, 8 Checkboxen)** |
| P37 | echte isolierte GitLab-Abnahme + Geräteabnahme — bewusst bis Feature-Abschluss verschoben (Entscheid Jan) |
| P38 | echte Scratch-Repo-Abnahme mit echtem Harness |
| P40 | Live-Lauf mit echtem Hermes-Koordinator am Gerät |
| P46 | Pixel-/Geräte-Abnahme (T46.1/T46.9), Offline-Bereichsstatus, Remote-Projektliste |
| P47 | Live-Abnahme am echten Gerät |
| P48 | Live-Abnahme am echten Gerät |
| P49 | Live-Abnahme am echten Gerät |
| P51 | Live-Abnahme am Gerät durch Jan (Vault-Pfad, Alt-Kürzel im Firefox, Handy-Glocke) |
| P67 | T67.10 Abnahme — ausdrücklich Nutzeraufgabe |

Sonderfall: **P59** — abgeschlossen bis auf Live-Abnahme, aber die **gpubox ist
nicht erreichbar** (externer Infra-Blocker). Empfehlung: Gpubox wieder
erreichbar machen ⇒ Entblocken; sonst Nachweis formal streichen (dann schließen).

## 5. Epics im Lauf / ohne Menschen-Blocker (weiterlaufen)

Kein Menschen-Entscheid nötig — diese Epics können agentisch weiterlaufen oder
formal schließen; der Zähler meldet sie nur konservativ (S2/C1):

| Epic | Lage | Empfehlung |
|---|---|---|
| P18 | Code abgeschlossen; Merge + Roll-out offen | weiterlaufen (Merge/Roll-out, Retro) |
| P20 | Roll-out teilweise, 1 offene Checkbox | weiterlaufen |
| P29 | alle T29.x abgeschlossen (nur S2-meldend) | **abschließen** (Statuswort) |
| P41 | Exit offen — Live-Reste §8; Umsetzung läuft | weiterlaufen |
| P42 | Umsetzung freigegeben 11.11. (Branch) | weiterlaufen |
| P43 | Exit grün, Geräte-Reste AI-P43-5 + BUG-0120/0121 geparkt | nichts (Parksache; BUGs betreffen P35-Block) |
| P56 | Grundlage T56.1a beauftragt und umgesetzt | weiterlaufen; P31-/P55-Anbindungen bleiben gesperrt |
| P66 | Startauftrag 17.11. | weiterlaufen |

(Die übrigen 27 Epic-Dateien des Zählers sind abgeschlossen — P5–P11, P13, P14,
P17, P22–P24, P27, P28, P36, P39, P43 (Exit grün, nur geparkte Gerätewege siehe oben),
P43.5, P45, P50, P53, P57, P58, P60, P63 — nichts nachzusteuern.)

## 6. Was jetzt zu tun wäre (priorisiert, Vorschlag)

1. **Endabnahme-Block P35 terminieren** — ein Menschen-Termin am echten
   Gerät/Handy entblockt die halbe Liste (§4) und zieht P0–P4.5, P12, P16, P25,
   P34, P46–P51, P67 nach sich.
2. **Entscheidungen §3 abarbeiten** — meist ein Satz pro Epic (Go/No-Go);
   P54/P55 brauchen nur das längst beauftragte Review.
3. **BUG-0170 entscheiden** (Windows ja/nein), BUG-0153/BUG-0187 verifizieren —
   sonst bleibt `fixed` dauerhaft unbewiesen.
4. Den übrigen `open`-Bugs und §5-Epics einfach weiterlaufen lassen;
   P30/P31 bleiben liegen (AGENTS.md).
