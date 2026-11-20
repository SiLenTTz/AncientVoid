# EPIC-P66 — Metrik-Konsolidierung: alles an einem Ort, aufgeräumt und klappbar

**Status:** abgeschlossen 2026-11-17 (T66.1–T66.4 nachweisbar unten; Nutzerabnahme nach P000 verschoben) · **Phase:** P66
**Dauer:** 2–3 Agenten-Sessions
**Abhängigkeit:** EPIC-P56 grün (T56.1a–T56.4 gemerged, PR #123; T56.6-Abnahme läuft parallel), EPIC-P59 grün (ADR-0078). P56-T56.5 (Compression, P55/P31) und EUR-Kosten (P31) bleiben gesperrt — auch hier.

## 1. Ziel

**Eine** Metrik-Zentrale in der PWA (`#/statistik`), die alles zeigt, was
belegt ist: System-Kennzahlen des Hub-Hosts, lokale KI-Server (P59), Modell-
und Cloud-Adapter-Kennzahlen aus Sessions/Zügen, Gates, Tools, Teams,
Anomalien und der A/B-Vergleich — filterbar, auf- und zuklappbar, mit
Schnitt-Auswahl die über Reloads erhalten bleibt. Das UI folgt dem
Design-System (P63: Bausteine, Tokens, Ratchets).

## 2. Scope (In / Out)

**In:**
- Statistik-Seite wird die Metrik-Zentrale: zwei neue Sektionen „System" und
  „KI-Server" betten den bestehenden `GET /api/aimetrics`-Report ein
  (kind `hub-host` bzw. `model-server`) — Les-API unverändert, kein neuer
  Sampler, keine zweite Wahrheit.
- Auf-/zuklappbare Sektionen: jede Karte bekommt einen Klapp-Kopf
  (aria-expanded), Zustand pro Sektion in `localStorage`, „alle auf/zu".
- Filter-Dauerhaftigkeit: Zeitraum/Projekt/Host/Harness überleben einen
  Reload (`localStorage`, versionierter Schlüssel, fail-safe), plus
  „Zurücksetzen".
- Cloud-Adapter-Kennzahlen ehrlich: vorhanden (Sessions, Züge, Tokens mit
  Herkunft, Dauer, Endgründe, Tool-Fehlerquoten je Adapter/Modell);
  Hinweis-Zeile, was datenbedingt fehlt.

**Out:**
- EUR-Kosten (gesperrt bis P31), Compression-Kennzahlen (P55),
  Input-/Output-/Cache-Token-Split und Provider-Normalisierung (nicht belegt,
  docs/statistik-metriken.md), Orchestrator-Schnitt (nicht belegt).
- Automatisches Ranking/Bewertung von Modellen; Cloud-Export.
- Eigene Diagramm-/Chart-Engine — Tabellen bleiben die Wahrheit; mehr nicht
  bauen, nur weil Charts „schön" wären.

## 3. Design-Details

- **Klapp-Sektionen:** Card-Kopf als Button (Design-System-Baustein `Button`
  oder native `summary`), `aria-expanded`, Inhalt nur im ausgeklappten Zustand
  im DOM. Default: die ersten zwei Sektionen offen (Schnitt + Sessions), Rest
  zu — Handy-First (K10: kein Whiteout, kein Springen).
- **Zustand:** ein versionierter localStorage-Schlüssel
  `ancientvoid.statistik.v1` mit `{collapsed: string[], filter: {...}}`;
  unbekannter/defekter Inhalt → Defaults, kein Crash (K10).
- **Aimetrics-Einbettung:** einmaliger Abruf beim Seitenöffnen plus
  Nachladen im Report-Intervall (`intervalSec`, Fallback 10 s) — identische
  Quelle wie die Metrik-Seite; „nicht gemeldet" bleibt „nicht gemeldet"
  (ADR-0023). Ohne konfigurierten Sampler: ehrliche Leerstelle mit Hinweis
  auf `aiMetrics`-Konfiguration, keine Nullen.
- **Filter-UX:** Beschriftungen wie bisher (Zeitraum/Woche/Monat/Alles,
  Projekt, Host, Harness), Reset-Knopf; die Vergleichskarte (B-Zeitraum)
  folgt weiterhin dem Schnitt.

## 4. Aufgaben (Checkliste T66.m)

- **T66.1** Klappbare Sektionen inkl. persistenter Zustände und „alle auf/zu".
  **K10.** *(17.11.2026 erledigt.)*
- **T66.2** System- und KI-Server-Sektionen aus dem aimetrics-Report
  (hub-host / model-server), ehrliche Leerstelle ohne Sampler. **K5/K9/ADR-0023**.
  *(17.11.2026 erledigt.)*
- **T66.3** Filter-Dauerhaftigkeit (localStorage, versioniert, fail-safe)
  und „Zurücksetzen". **K10.** *(17.11.2026 erledigt.)*
- **T66.4** E2E-Spezifikation (klappen, Filter über Reload, Aimetrics-
  Sektionen mit konfigurierter Quelle) und Guide-Pflege. **K10.**
  *(17.11.2026 erledigt — statistik.spec.ts um drei Tests erweitert, Guide
  aktualisiert.)*

## 5. Acceptance Criteria (AC-P66-k)

- **AC-P66-1:** `#/statistik` zeigt System-, KI-Server-, Session-/Modell-,
  Zug/Token-, Gate-, Tool-, Team-, Anomalie- und Vergleichs-Sektionen; ohne
  konfigurierten aiMetrics-Sampler steht ein ehrlicher Hinweis, nie Nullen.
- **AC-P66-2:** Jede Sektion ist auf-/zuklappbar (`aria-expanded`), der
  Zustand überlebt einen Reload; „alle auf/zu" wirkt auf alle.
- **AC-P66-3:** Zeitraum-/Projekt-/Host-/Harness-Auswahl überlebt einen
  Reload; „Zurücksetzen" stellt die Defaults wieder her.
- **AC-P66-4:** Design-System eingehalten: css-tokens- und
  ui-primitives-Ratchet grün, Bausteine aus `shared/ui`.
- **AC-P66-5:** Ehrlichkeits-Regeln unverändert: Klein-n gekennzeichnet,
  fehlende Werte als fehlend (nie 0), keine Cloud-Exporte, kein Ranking.

## 6. Premortem (Failure-Modi + Mitigation)

- **Zweite Wahrheit für Aimetrics-Daten** (Statistik-Seite re-sampelt oder
  transformiert) → nur der unveränderte `GET /api/aimetrics`-Report wird
  gelesen und angezeigt; keine eigene Probe, kein eigener Zustand.
- **Zustands-Chaos in localStorage** (alte Versionen, defektes JSON,
  fremde Sektions-IDs) → ein versionierter Schlüssel, `try/parse` mit
  Defaults, unbekannte IDs ignoriert; Test mit Müll-Eingabe.
- **Feature-Creep Richtung Dashboard/Ranking** („noch ein Diagramm, noch
  eine Zahl") → §2 Out ist Teil des Epics: Tabellen, beschreibend; neue
  Metriken nur per Epic-Änderung wie in P56.
- **Handy-Regression durch alles-auf** (Seite wird unüberwindlich lang) →
  Default nur Schnitt + Sessions offen; E2E läuft auf 412 px wie gehabt.

## 7. Definition of Done

Alle T66.* und AC-P66-* mit Evidenz; `npm run gate` lokal grün;
GitHub-Actions (`verify`) auf dem Abschluss-PR grün; jede neue
UI-Funktion hat Spec-Anteil in `e2e/specs/statistik.spec.ts`; Seite bleibt
im Guide-Inventar gelistet; Abnahme der Konsolidierung mit dem Nutzer an
echten Daten (nach T56.6-Muster).

## 8. Umsetzungsstand

T66.1–T66.4 (17.11.2026, ein Zug): Statistik-Seite zur Metrik-Zentrale
umgebaut — klappbare Sektionen (Kopf-Button, `aria-expanded`, Inhalt nur
offen im DOM; Default offen: Schnitt + Sessions, Premortem 4), Zustand und
Schnitt im versionierten `localStorage`-Schlüssel `ancientvoid.statistik.v1`
(fail-safe, Unit-Tests für `parseStatistikState`), „alle auf/zu" und
„Schnitt zurücksetzen"; System-/KI-Server-Sektionen betten den
unveränderten `GET /api/aimetrics`-Report ein (Poll im Report-Intervall,
Wert-/Altersformat geteilt mit der Metrik-Seite über `shared/metrics.ts`,
keine zweite Wahrheit; ohne Host-Probe/Sampler ehrliche Hinweise statt
Nullen). Belegt: statistik.spec.ts 8/8 grün (drei neue Tests: Klappen +
Reload-Stand, Schnitt-Reload + Zurücksetzen, Aimetrics-Sektionen gegen
llamacpp-Stand-in), ki-server-metriken.spec 8/8 (geteilte Helfer ohne
Verhaltenswechsel), statistics-state.test.ts 3/3; css-tokens-Ratchet grün
(neue Klassen in 53-statistik.css nur mit Tokens). Offen: Abnahme mit dem
Nutzer (nach T56.6-Muster); EUR/Compression/Input-Output-Token bleiben
gesperrt (§2 Out).
