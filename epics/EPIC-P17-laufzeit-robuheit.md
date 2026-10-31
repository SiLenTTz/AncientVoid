# EPIC-P17 — Laufzeit-Robustheit: Resume-Referenzen, Wait-Semantik, stabile Worker-Identität

**Status:** abgeschlossen 2026-10-26 (Ralph-Lauf; Belege im Abschluss-MR) · **Phase:** P17 · **Dauer:** 1–1,5 Agenten-Wochen · **Abhängigkeit:** fachlich keine (baut auf P5-Recovery, P7-Tool-Parität und P15-Steuerung auf; P13/P14-Präzedenz: unabhängiges Epic neben laufenden P12-Abnahmen).

Auslöser: [Herdr-Evaluation 2026-10-26](../docs/herdr-evaluation-2026-10-26.md),
Entscheidung desselben Tages — AncientVoid bleibt, Herdr ersetzt nichts; übernommen
werden nur die drei Ideen, die ohne Architekturwechsel in bestehende Strukturen
passen (Option C des Reports). Kein Screen-Scraping, keine Herdr-Integration.

## 1. Ziel

Läufe, Übergaben und Wiederanlauf werden robuster — gemessen an K7 (Zustand
nach Hub-Restart 100 % identisch, < 3 s Restore). Drei Lücken, die die
Herdr-Betrachtung sichtbar gemacht hat:

1. **Resume-Referenzen je Adapter.** Ein Adapter weiß heute(Session-ID
   vorhanden), aber nicht *mit welchem CLI-Aufruf* seine Session natürlicherweise
   fortgesetzt wird (`claude --resume <id>`, `codex resume`, `opencode --session`,
   `pi --session`, `hermes --resume`, …). Herdr führt genau diese Tabelle als
   „offizielle Integrationen" — für uns ist sie der einheitliche Schlüssel für
   Adoption, Handoff (ADR-0034 „PC offen"-Hinweis) und `hubctl`-Fortssetzung.
2. **Wait-Semantik mit occupant-Pinning.** Herdrs `agent wait` ist server-owned,
   pinnt den Pane-Bewohner (ein Ersatz kann den Wait nicht „erfüllen") und
   verhindert Doppel-Submission nach Timeout. Unsere steer-/Reply-Waits haben
   Teile davon (`pendingInput`-Revision-Guard, BUG-0016/0017), aber kein
   einheitliches Pinning.
3. **Stabile Worker-Identität über Neustarts.** tmux-Panes tragen keinen
   dauerhaften Hub-Marker; Adoption und `worktrees prune` erkennen Worker über
   Heuristiken (cwd, Prozessnamen). Herdrs `HERDR_PANE_ID` zeigt das Muster:
   ein stabiler env-Marker pro Pane macht Zuordnung eindeutig — K7-Kern.

## 2. Scope (In / Out)

**In:**
- **T17.1 ADR** für die Contract-Erweiterung „Adapter deklariert
  Resume-Befehl + Session-Referenz" (Regel 1: Adapter-Contract-Änderung
  braucht ADR in `docs/adr/`).
- Resume-Deklaration in den Adaptern, deren CLI einen echten Resume-Pfad hat;
  `@ancientvoid/adapter-testkit` prüft die Deklaration (Suite grün = hub-integrierbar).
- Nutzung der Referenz: „PC offen"-Hinweis (ADR-0034), `hubctl show` und
  Handoff nennen den konkreten Fortsetzungs-Befehl statt generischem Text.
- Steer-/Reply-Waits: occupant-pinned, mit harten Timeouts; ein Timeout kann
  nie eine zweite Submission auslösen (Idempotenz über `inputId` weitergeführt).
- `ANCIENTVOID_*`-env-Marker je tmux-Pane (Worker-Runner), **allowlist-validiert**
  (BUG-0012: unvalidierte env-Keys waren RCE) — Adoption und `worktrees prune`
  erkennen Worker primär über den Marker, Heuristik nur noch Fallback.
- Recovery-/Prune-Tests gegen echte tmux-Worker (skippt sichtbar ohne tmux,
  ADR-0002-Muster).

**Out:** Herdr als Runner/Adapter (Option B des Reports — eigener Spike mit
eigenem ADR, falls je gewünscht); Screen-Parsing jeglicher Art; neue Adapter;
Multi-Machine-SSH (Fleet bleibt ADR-0017); UI-Umbauten (bestehende Hinweise
werden nur genauer, nicht neu erfunden); Retention/Zeitfenster für Worker.

## 3. Design-Details

- **Resume-Katalog als Contract, nicht als Wissenshäufchen.** Ein Feld in der
  Adapter-Capability-Deklaration (`@ancientvoid/contracts`), z. B.
  `resume: { command: string[]; sessionRef: "native" | "transcript" }`.
  Adapter ohne belegten echten Handlauf deklarieren **nichts** — kein
  Resume-Versprechen ohne Beleg (R9.7-Geist: nichts erfinden). Vorlage für
  die Befehle je CLI ist die Herdr-Tabelle „Native agent session restore"
  (Herdr-Doku v0.9.5, Stand Oktober 2026 — beim Implementieren gegen die
  jeweils installierte CLI-Version verifizieren, nicht abschreiben).
- **Wait-Pinning am SessionManager.** Der Wait merkt sich die identität des
  laufenden Zugs (Turn-/Worker-Referenz); ist der Erwartete weg, endet der
  Wait mit Fehler statt von einem beliebigen Nachfolger „erfüllt" zu werden.
  Timeouts sind Pflicht (kein unbegrenzter Wait im Server), Fehler sind
  Events (fail loud, Regel 6).
- **Marker statt Heuristik.** Worker-Runner setzt beim Spawn
  `ANCIENTVOID_SESSION_ID`/`ANCIENTVOID_WORKER_ID` (Werte sind `crypto.randomUUID()` bzw.
  Session-IDs — keine Nutzereingabe); die tmux-Liste liest die Env beim
  Reapen. Keys kommen nur aus der Allowlist — Konfig-Werte fließen nie in
  env-Keys (BUG-0012). Heuristik (cwd-Matching) bleibt als erkennbarer
  Fallback, bis T12.5-Dauerlauf den Marker-Pfad breit belegt hat.
- **K7 bleibt die Messlatte:** Ein Hub-Neustart mit laufenden Workern
  rekonstruiert Zuordnung 100 % über Marker (Test mit ≥ 2 Adaptern), Restore
  < 3 s. Der bestehende K7-Recovery-Test wird erweitert, nicht ersetzt.

## 4. Aufgaben

- [x] **T17.1 — ADR-0036 „Resume-Referenzen im Adapter-Contract".** Felder,
  Semantik (`native` vs. `transcript`), Mitnahmepflicht der testkit-Suite.
  Vorlage `docs/adr/0035-*`. Messlatte: K7.
- [x] **T17.2 — Resume-Deklaration in Adaptern.** claude, codex, opencode,
  pi, hermes, dsh/ACP-Presets — nur soweit ein echter Handlauf je CLI
  belegbar ist (Live-Verifikation gegen die installierte Version). Andere
  Adapter deklarieren explizit nichts. Contract-Tests im testkit. K7.
- [x] **T17.3 — Fortsetzungs-Hinweise nutzen den Katalog.** „PC offen"-
  Hinweis (ADR-0034-Pfad), `hubctl show` und Handoff-Doku nennen den
  konkreten Befehl (`claude --resume …`). K1 (der Weg zur Entscheidung wird
  kürzer), K10.
- [x] **T17.4 — Wait-Pinning + Timeout-Idempotenz für steer.** Occupant-
  Referenz im laufenden Zug; Timeout endet mit sichtbarem Fehler-Event;
  erneute Einreichung nach Timeout ist eindeutig (inputId). Unit-Tests mit
  absichtlichem Timeout + Spec in `e2e/specs/pause-queue.spec.ts`. K2.
- [x] **T17.5 — Stabile `ANCIENTVOID_*`-Pane-Marker.** Worker-Runner setzt sie,
  tmux-Adapter liest sie; Allowlist-Validierung mit BUG-0012-Muster-Test
  (ungültige/Injections-Keys → fail loud, kein Spawn). K7, K9-Geist
  (Bruchbarkeit sichtbar).
- [x] **T17.6 — Adoption & `worktrees prune` über Marker.** Marker ist
  primäre Quelle, cwd-Heuristik Fallback mit Log-Hinweis; Recovery-Test
  gegen echtes tmux (≥ 2 Adapter, Hub-Kill + Restart). K7.
- [x] **T17.7 — Erreichbarkeit & Doku.** README-Adapter-Matrix-Spalte
  „Resume", `docs/adapters.md`, Runbook-Abschnitt Wiederanlauf. Neue Specs
  in `e2e/specs/` für jeden neuen/veränderten Ablauf. K10.

## 5. Acceptance Criteria

- **AC-P17-1 (K7):** Nach Hub-Kill + Restart ordnet der Hub 100 % der
  laufenden Worker ihre Session über den Marker zu (Test mit ≥ 2 Adaptern);
  der K7-Wert (< 3 s Restore) bleibt grün.
- **AC-P17-2:** Jeder Adapter mit deklariertem Resume hat einen echten
  Handlauf-Befehl in der MR-Beschreibung; testkit-Suite prüft die
  Deklaration für alle Adapter (auch „deklariert nichts").
- **AC-P17-3 (K2):** Ein steer-Wait-Timeout führt nachweislich nie zu einer
  zweiten Submission (Unit + E2E); der Fehler ist als Event sichtbar.
- **AC-P17-4:** env-Marker sind allowlist-validiert; ein Injektionsversuch
  (BUG-0012-Muster) scheitert laut und sichtbar, kein Spawn.
- **AC-P17-5:** `hubctl show` und der „PC offen"-Hinweis nennen für
  Resume-Adapter den konkreten Fortsetzungs-Befehl.

## 6. Premortem

1. **Resume-Flags verändern das CLI-Verhalten unvorhergesehen** (Session-
   Kontamination, stiller Kontextverlust, andere Modus-Presets). → Nur
   Adapter mit Live-Handlauf deklarieren; testkit-Gate; ADR nennt
   Abbruchkriterium (eine echte Anomalie → Deklaration zurückziehen, fail
   loud).
2. **Contract-Bruch zerschießt bestehende Adapter.** → ADR vor Code,
   additive Felder, keine Semantik-Änderung bestehender Felder; komplette
   adapter-testkit-Flotte muss grün bleiben, sonst kein Merge.
3. **env-Marker werden der nächste Injection-Vektor** (BUG-0012 wiederholt
   sich in Neu). → Allowlist, Werte nur UUIDs/Hub-interne IDs, Muster-Test
   im selben MR wie die Einführung.
4. **Wait-Pinning leakt Server-Ressourcen** (offene Promises/Timer unter
   Last). → Harte Timeouts Pflicht; Loadtest-Skript (K8-Rezept) mit 20
   Sessions und wartenden Steers im Abschluss-MR.
5. **Scope-Creep Richtung „Herdr nachbauen"** (plötzlich doch Screen-Reading,
   Multi-Machine, Pane-API). → Out-of-Scope hart oben festgezurrt; jede
   Aufgabe braucht eine Zeile, die sie an dieses Epic bindet; ponytail-review
   vor jedem MR (Tags `yagni`/`shrink`).

## 7. Definition of Done

`npm run gate` grün; blockierender Pipeline-Job `e2e` auf dem Abschluss-MR
grün (GitLab-unzuverlässigkeits-Regel aus AGENTS.md greift sonst: lokales
vollständiges Gate mit Evidenz); jeder neue/veränderte Ablauf hat einen Spec
in `e2e/specs/` (mindestens `recovery`/`pause-queue` erweitert); Resume-
Deklaration in README-Matrix und `docs/adapters.md` sichtbar (Erreichbarkeit
zählt als done); kein TODO ohne Epic-Referenz; ADR-0036 gemergt.
