# EPIC-P1.5 — Control-Center-UX: Kontingent statt Budget, Projekt-Autoerkennung, Sprach-Composer, Skill-Overlay

**Status:** offen · **Phase:** P1.5 (bewusst zwischen P1 und P2 eingeschoben) · **Dauer:** 1–1,5 Agenten-Wochen · **Abhängigkeit:** P1 mechanisch fertig (Adapter `claude`/`codex` live verifiziert)
**Ziel-Machine:** Omarchy (Entwicklung + reale Nutzung), silenttz-server (Staging)

---

> **Vorbemerkung: bewusste Umpriorisierung, kein Übersehen des Epic-Gatings.**
> `AGENTS.md` (erster Abschnitt) und `epics/README.md` §„Reihenfolge & Gating"
> verlangen: P(n) startet erst, wenn P(n-1) grün ist — und regulär wäre als
> Nächstes P2 (Diff/Approvals/Budgets) dran. Diese Phase überholt P2 und den
> Rest von P3 **auf ausdrückliche Anweisung des Nutzers**, aus zwei konkreten
> Gründen:
>
> 1. **P2s Budget-Teil ist für die reale Nutzung teilweise gegenstandslos.**
>    Der Nutzer arbeitet ausschließlich mit Coding-**Subscriptions**, nicht mit
>    API-Guthaben. Ein Dollar-Budget pro Session (heute `SessionSpec.budgetUsd`,
>    `packages/pwa/src/App.tsx:130-140`) beantwortet die Frage, die er
>    tatsächlich hat, nicht: „wie viel meines Kontingents ist verbraucht, wann
>    laufe ich ins Limit?" P2 bleibt vollständig bestehen; nur die
>    Reihenfolge-Annahme, dass Budget-Enforcement das dringlichste
>    Steuerungsthema sei, wurde durch echte Nutzung widerlegt.
> 2. **Interaktive Steuerung schlägt Diff-/Approval-UI im aktuellen
>    Nutzungsbild.** Die PWA kann heute Sessions *anschauen* und *stoppen*,
>    aber keinen einzigen Folge-Prompt senden: `POST /api/sessions/:id/steer`
>    existiert serverseitig (`packages/server/src/routes.ts:93-101`), wird in
>    `packages/pwa/src/` aber **nirgends aufgerufen** (verifiziert per grep über
>    `packages/pwa/src/*`). Antworten, Diktieren und „mit Skill X starten" sind
>    damit näher an „vom Handy voll arbeitsfähig" als eine Approval-Queue.
>
> Diese Phase ist damit eine **echte Priorisierungsentscheidung mit Begründung**,
> kein umgangenes Gate. P2 und P3 bleiben unverändert in der Reihenfolge
> danach — mit der Ausnahme, dass T3.6/T3.7/T3.9 (Sprache, Prompt-Composer)
> hierher vorgezogen werden (siehe §3.3/§3.4 und die Vermerke in
> [`EPIC-P3-adapter-flotte-sprachsuche.md`](EPIC-P3-adapter-flotte-sprachsuche.md) §4).

## 1. Ziel

Die PWA wird vom **Beobachtungsfenster zum Bedienpult**. Vier Dinge, die der
Nutzer nach dem ersten echten Einsatz der P1-Oberfläche konkret vermisst hat:

1. **Kontingent statt Budget** — sichtbar machen, wie viel des
   Subscription-Kontingents verbraucht ist und wann das Limit fällt (bzw. bei
   API-Abrechnung: wie viel Guthaben übrig ist). Das Dollar-Budget-Feld
   verschwindet aus der Oberfläche.
2. **Projekte werden erkannt, nicht getippt** — auf dem Host konfigurierte
   Repo-Wurzeln, der Hub scannt, das Handy wählt aus einer Liste.
3. **Eingabe per Sprache + Prompt-Enhancer** — Diktat statt Handy-Tastatur,
   optional zu einem brauchbaren Coding-Agent-Prompt umformuliert, immer
   editierbar vor dem Absenden.
4. **Skill-/Agent-Overlay beim Absenden** — statt nur „Senden" auch „Senden
   mit …": eine Auswahl der Skills/Agents, die im **Zielprojekt selbst**
   liegen; die zuletzt gewählte ist pro Projekt der Default, sichtbar und
   überschreibbar.

Diese Phase liefert **keine Approvals, keine Diffs, kein Budget-Enforcement** —
das bleibt P2. Wer hier eine Approval-Queue einbaut, verletzt den Scope.

## 2. Scope

### In
- Kontingent-/Quoten-Erfassung auf **Adapter-Account-Ebene** (nicht pro Session)
  aus dem realen `rate_limit_event` von claude; neuer Lese-Endpunkt
  (`GET /api/adapters/:id/usage`) + Anzeige in der PWA
- Ehrliches „unbekannt" für codex (belegt: kein Quota-Event im Stream, kein
  Quota-Subkommando in der CLI) — R9.7-Regel, wie schon bei T1.11s Kosten
- Entfernen des Budget-Eingabefelds aus der PWA (Contract-Feld `budgetUsd`
  bleibt unangetastet — P2 baut darauf auf)
- `projectRoots` in `HubConfig`, Scanner für Git-Repos, `GET /api/projects`,
  Projekt-Picker in der PWA statt Freitext-Pfad
- Prompt-Composer als eigene PWA-Komponente — beim Anlegen **und** als
  Folge-Prompt in einer laufenden Session (`hubApi.steer()`, existiert noch nicht)
- Spracheingabe (aus P3 vorgezogen, MVP: Browser-STT; Whisper.cpp dokumentierter
  Ausbaupfad), Transkript immer editierbar
- Prompt-Enhancer (aus P3 vorgezogen): Roh-Eingabe → strukturierter Prompt,
  Split-Preview, „Original senden" bleibt immer möglich
- Skill-/Agent-Overlay: Scan von `<projekt>/.claude/skills/*/SKILL.md` und
  `<projekt>/.claude/agents/*.md`, Anzeige der Auswahl, Per-Projekt-Default
- Zwei ADRs (Account-Usage-Modell, Skill-Invocation-Mechanismus) als echte
  Vorbedingungen, nicht als Nachdokumentation

### Out
- Diff-Ansicht, Approval-Gates, Budget-**Enforcement** — bleibt P2
- Sprachsuche über Projekt-Index (S5, Qdrant) — bleibt P3 (T3.8)
- Sprach-Direktiven-Parser („stopp", „Budget 3 Dollar" als Aktionen) — bleibt
  P3 (T3.10); hier wird Sprache nur zu **Text**, nie zu einer Aktion
- Learning-Loop-Storage des Optimizers (P3 T3.9s zweiter Teil) — hier nur der
  Optimizer selbst
- Weitere Adapter (swarm/zai/local-llm/copilot/cursor-clip) — bleibt P3
- Web-Push-Infrastruktur (offen aus AC-P1-5) — nicht Teil dieser Phase

## 3. Design-Details

### 3.1 Kontingent-Modell: Account-Ebene, nicht Session-Ebene

**Ground Truth (live in dieser Session aus dem echten claude-Stream erfasst):**

```json
{"type":"rate_limit_event","rate_limit_info":{
  "status":"allowed","resetsAt":1789473600,"rateLimitType":"five_hour",
  "overageStatus":"rejected","overageDisabledReason":"out_of_credits",
  "isUsingOverage":false,
  "unifiedWindows":{
    "five_hour":{"utilization":0.43,"resetsAt":1789473600},
    "seven_day":{"utilization":0.28,"resetsAt":1789891200}}},
  "uuid":"…","session_id":"…"}
```

Das ist **genau** die Information, die „wie viel ist übrig bis zum Limit"
beantwortet: `utilization` als 0.0–1.0 pro rollendem Fenster (5h und 7d),
`resetsAt` als Unix-Zeitstempel. `overageStatus`/`overageDisabledReason`
decken zusätzlich den API-Guthaben-Teil der Frage ab („wann 0 $ erreicht sind").

Der Hub **verwirft diese Daten heute**: `packages/adapter-claude/src/normalize.ts:55-58`
mappt `rate_limit_event` auf ein generisches, unbeschriftetes System-Event
(`summary: "claude: rate-limit status update"`, `payload.info` roh). Kein
Feld, kein Endpunkt, keine Anzeige.

**Die architektonisch entscheidende Eigenschaft:** Rate Limits gelten pro
**Account** (dem gesamten `claude`-Login der Maschine) und werden von *allen*
Sessions dieses Adapters geteilt. Damit sind sie strukturell etwas anderes als
`SessionRecord.costUsd` (ADR-0003), das pro Session summiert wird. Zwei parallele
Sessions haben zwei getrennte Kostensummen, aber **ein** gemeinsames Kontingent.

Konsequenz: Ein neues Feld auf `SessionRecord` wäre falsch (es würde suggerieren,
jede Session habe ihr eigenes Kontingent, und beim Summieren im Dashboard —
`packages/pwa/src/Dashboard.tsx:57` summiert `costUsd` genau so — käme Unsinn
heraus). Gebraucht wird ein **Usage-Snapshot pro Adapter-Id**: der Hub merkt sich
das jeweils letzte beobachtete `rate_limit_event` je Adapter samt Beobachtungs-
zeitpunkt und liefert es über einen eigenen Endpunkt aus.

Das berührt die Contracts (`packages/contracts/src/adapter.ts`): entweder
bekommt `AdapterCapabilities` ein `usage: boolean`, oder `HealthReport` einen
optionalen Usage-Teil, oder der `Adapter` eine neue optionale Methode
(`usage?(): Promise<UsageReport | null>`) — **diese Wahl ist offen und gehört
in ein ADR, bevor Code entsteht** (AGENTS.md Regel 1: „Änderungen am
Adapter-/Event-/Worker-Contract brauchen ein ADR"). Behandlung analog zu
[`docs/adr/0001-swarm-adapter-context.md`](../docs/adr/0001-swarm-adapter-context.md),
das vor T3.1 genau diese Vorarbeit leistet. Siehe T1.5-1.

**codex hat dazu kein Gegenstück — belegt, nicht vermutet.** In den realen
`codex exec --json`-Captures (`packages/adapter-codex/test/fixtures/`, codex-cli
0.153.4) treten ausschließlich `thread.started`, `turn.started`,
`turn.completed`, `item.started`, `item.completed` und `file_change` auf — kein
Quota-/Rate-Limit-Ereignis. Auch `codex login status`, `codex --help` und
`codex login --help` kennen unter einem ChatGPT-Plan-Login **kein**
Usage-/Quota-Subkommando (in dieser Session gegen die echte CLI geprüft). Damit
gilt für codex dieselbe Regel wie bei T1.11 für Kosten: **„unbekannt" anzeigen,
niemals schätzen, niemals 0 % suggerieren** — und ausdrücklich *nicht* über
eine undokumentierte Web-API ausweichen.

### 3.2 Projekt-Autoerkennung über `projectRoots`

Heute ist das Projekt ein Freitext-Pfad: `SessionSpec.project`
(`packages/contracts/src/session.ts`) und ein `<input placeholder="/home/user/repo">`
in `packages/pwa/src/App.tsx:114-121` — auf einem Handy die unangenehmste
denkbare Eingabe und gleichzeitig ein Pfad, den der Client frei bestimmt.

Reale Struktur auf der Zielmaschine: unter
`/mnt/omarchy_data/30_repos/arch/arbeitsbaeume/` liegen mehrere
Geschwister-Repos (`mobile-hub`, `custom-rag`, weitere) nebeneinander.
„Automatisch erkannt" heißt deshalb:

- Neues Feld `projectRoots: string[]` in `HubConfig`
  (`packages/core/src/config.ts:21-39`, Default `[]`), Beispiel in
  `packages/server/hub.config.example.json`, Doku in
  [`docs/configuration.md`](../docs/configuration.md).
- Der Hub scannt die **direkten** Unterverzeichnisse jedes Roots (Tiefe 1, keine
  Rekursion) und nimmt auf, was ein `.git` enthält. Ergebnis: stabile
  Projekt-Id (z. B. `<root-index>/<verzeichnisname>`), Anzeigename, absoluter
  Pfad, optional der aktuelle Branch.
- Neuer Endpunkt `GET /api/projects` (neben `/api/adapters`,
  `packages/server/src/routes.ts:41-47`).
- **Sicherheitsmuster aus ADR-0001 übernehmen** (dort für `swarm` beschrieben:
  „Client sendet nur einen `allowlist_key`, nie einen Pfad; Server löst gegen
  `roots` auf, Symlink-Escape wird verweigert"). Für UACC heißt das: Ist
  `projectRoots` gesetzt, muss `POST /api/sessions` einen Pfad außerhalb der
  Roots ablehnen. Ist `projectRoots` leer, bleibt das heutige Verhalten
  unverändert (keine Breaking Change für bestehende Configs).

### 3.3 Spracheingabe — aus P3 vorgezogen, mit expliziter MVP-Umkehr

Ursprünglich geplant als [EPIC-P3](EPIC-P3-adapter-flotte-sprachsuche.md) T3.6
(Whisper.cpp-Server als **Primärpfad**) und T3.7 (Browser-STT als **Fallback**).

**Vorgeschlagene Umkehr der Reihenfolge, bewusst benannt statt still gedreht:**
Für den MVP dieser Phase kommt **Browser-STT zuerst** (T3.7s ursprünglicher
Scope), weil es keinerlei Serverinfrastruktur braucht — kein Whisper-Build,
kein Modell-Download, keine GPU-Konkurrenz auf Omarchy (exakt das
P3-Premortem-Risiko 1). Der Whisper.cpp-Pfad (T3.6) bleibt als dokumentierter
Ausbau-/Ersatzpfad für Browser ohne native STT bestehen und wandert **nicht**
aus P3 heraus, sondern wird dort nur als „von P1.5 teilweise vorgezogen"
vermerkt.

Die Umkehr hat einen realen Preis, der in der UI benannt werden muss: Die
`SpeechRecognition`-API in Chrome überträgt Audio typischerweise zur
Erkennung an einen Google-Dienst — das steht im Spannungsverhältnis zum
local-first-Anspruch des Projekts (README „Sicherheit"). Deshalb: kein stilles
Aktivieren, sondern ein sichtbarer Hinweis und der Whisper-Pfad als bewusste
lokale Alternative. Siehe Premortem-Risiko 6.

Unverändert aus P3 übernommen: **Das Transkript ist immer editierbar vor dem
Absenden — kein Fire-and-forget.** Messlatte K6 (Transkript ≤ 1,5 s) bleibt
gültig und bekommt einen `docs/messlauf/`-Eintrag.

### 3.4 Prompt-Enhancer — aus P3 (T3.9) vorgezogen, mit einer echten offenen Frage

Übernommen aus [EPIC-P3](EPIC-P3-adapter-flotte-sprachsuche.md) §3
„Prompt-Optimizer": Systemprompt strukturiert die Roh-Eingabe in
Ziel / Scope / Constraints / Erfolgskriterium, Split-Preview (roh | optimiert),
„Original senden" bleibt jederzeit erreichbar, Optimierung ist **optional**
(„wenn gewünscht", Nutzerwortlaut).

**Offene Design-Frage, hier bewusst nicht beantwortet:** *Welches Modell führt
die Umformulierung aus?* Zwei plausible Wege mit unterschiedlichen Kosten:

- **(a) Der aktuell gewählte Coding-Adapter selbst**, über einen kurzen
  Wegwerf-Aufruf. Vorteil: nichts Zusätzliches zu installieren, nutzt die
  ohnehin eingeloggte Subscription. Nachteil: verbraucht genau das Kontingent,
  das §3.1 sichtbar machen soll, und startet einen zweiten Prozess pro Eingabe.
- **(b) Ein separates, leichtgewichtiges lokales Modell** (P3 §3 sah dafür
  einen Qwen-Finetune auf Omarchy vor). Vorteil: kontingent-neutral, wirklich
  local-first. Nachteil: neue Abhängigkeit, Latenz unbekannt, in diesem Repo
  noch nirgends verdrahtet.

Diese Frage ist **mit Beleg zu entscheiden** (Messung von Latenz und
Kontingent-Wirkung beider Wege), nicht per Bauchgefühl — genauso wie ADR-0001
seine offene Steer/Approval-Abhängigkeit ausdrücklich als offen führt, statt
sie wegzuraten. Teil von T1.5-8, Risiko 4 im Premortem.

### 3.5 Skill-/Agent-Overlay — Quelle ist das Zielprojekt, Default ist pro Projekt

**Entschieden (Nutzer-Rückfrage 1, keine offene Frage mehr):** Die Quelle ist
das **ausgewählte Zielprojekt selbst**, nicht eine hub-weite zentrale
Registry. Gescannt wird die Konvention, die dieses Repo selbst benutzt:

- `<projekt>/.claude/skills/<name>/SKILL.md` — YAML-Frontmatter mit `name` und
  `description` (real geprüft, z. B. `.claude/skills/bugfix/SKILL.md`)
- `<projekt>/.claude/agents/<name>.md` — YAML-Frontmatter mit `name`,
  `description`, `model` (real geprüft, z. B. `.claude/agents/hub-dev.md`)

Reale Zählung in `mobile-hub` zum Planungszeitpunkt: **11 Skills** mit
`SKILL.md` (`architecture-best-practices`, `bugfix`, `bug-report`,
`concept-phase`, `epic-creation`, `gates`, `git-workflow`, `messlauf`,
`ponytail-review`, `pr-review`, `retro`) und **3 Agents** (`epic-planner`,
`hub-dev`, `pwa-dev`). Der Scanner muss die realen Ausnahmen aushalten:
`.claude/skills/_shared/` enthält **kein** `SKILL.md` (Hilfsverzeichnis) und
`.claude/skills/README.md` sowie `.claude/skills/skill-template.md` sind keine
Skills. Alle drei dürfen nicht in der Liste landen.

**Zu „Workflows" (dritter vom Nutzer genannter Typ):** In diesem Repo existiert
**keine** verifizierte Workflow-Konvention — unter `.claude/` liegen genau
`agents/` und `skills/`, sonst nichts. Der Typ wird daher im Datenmodell
vorgesehen (`kind: "skill" | "agent" | "workflow"`), aber erst befüllt, wenn
eine reale Konvention belegt ist. Keine erfundene Verzeichnisstruktur.

**Entschieden (Nutzer-Rückfrage 2):** Der Default-Speicher „zuletzt gewählt"
ist **pro Projekt**, nicht global — Schlüssel z. B. `uacc.skill.<projekt-id>`.
Speicherort ist gerätelokales `localStorage`, exakt wie der Filter-State aus
T1.6 (`packages/pwa/src/SessionTail.tsx`, `loadFilter()`): kein
Server-Roundtrip, überlebt Reload, ist von Natur aus gerätespezifisch.
Die Auswahl ist immer **sichtbar** und immer **überschreibbar** („so dass man
nicht immer auswählen muss aber kann").

**Die offene Kernfrage — und sie ist nicht kosmetisch:** *Wie wird „Nutzer hat
Skill X gewählt" dem darunterliegenden CLI-Prozess pro Adapter tatsächlich
mitgeteilt?* Beide Adapter haben dafür **strukturell verschiedene, hier nicht
verifizierte** Mechanismen:

- **claude:** Die `.claude/skills/`-Konvention ist Claude Codes eigene.
  Vermutlich erfolgt der Aufruf über einen Slash-Command-artigen Präfix im
  Prompttext oder über ein CLI-Flag — **beides unbestätigt**. Der Adapter
  setzt den Prompt heute als reines Positional-Argument (`claude -p "<prompt>"`,
  plus `--resume` beim Steer).
- **codex:** Kennt eine eigene, strukturell unverwandte `plugin`-/Profil-Welt
  (`codex --help` listet ein `plugin`-Subkommando). Eine 1:1-Entsprechung zu
  claudes Skills ist **nicht** belegt.

Die Annahme „ein einheitlicher Mechanismus funktioniert für beide" wäre genau
die Art von Vermutung, die T1.2/T1.3 bei den Event-Formaten schon einmal
widerlegt haben (P1-Retro, Erkenntnis 1). Deshalb: eigene Untersuchung an den
echten CLIs **vor** der Implementierung, Ergebnis als ADR — analog zu
ADR-0001s Rolle vor T3.1. Siehe T1.5-9; Premortem-Risiko 1.

### 3.6 Prompt-Composer als gemeinsame Komponente (und die Steer-Lücke)

Der Nutzerwunsch beschreibt **eine** Eingabefläche mit drei Ausgängen:
„Senden", „Diktieren", „Verbessern" und dem Overlay „Senden mit …". Diese
Fläche wird an zwei Stellen gebraucht:

1. Beim Anlegen einer Session (heute: `prompt`-Feld in `CreateSession`,
   `packages/pwa/src/App.tsx:122-129`)
2. **Als Folge-Prompt in einer laufenden Session** — heute schlicht nicht
   vorhanden: `packages/pwa/src/SessionTail.tsx` hat nur Filter-Chips, einen
   Zurück- und einen Stop-Button; `hubApi` (`packages/pwa/src/api.ts:51-73`)
   kennt `createSession`/`stopSession`, aber **kein** `steer`. Der Server
   kann es längst (`POST /api/sessions/:id/steer`), und `adapter-claude`
   implementiert `steer(prompt)` via `--resume` (T1.2), `adapter-codex` via
   `exec resume` (T1.3). Es fehlt nur der Client-Pfad.

Deshalb ist der Composer eine eigene, an beiden Stellen wiederverwendete
Komponente — und nicht zweimal derselbe Code.

## 4. Aufgaben

> **Task-ID-Konvention dieser Phase:** `T1.5-m` (Bindestrich), **nicht**
> `T1.5.m` — sonst kollidiert die Notation optisch mit P1s bereits vergebenem
> `T1.5` (Monitor-Dashboard).

- [x] **T1.5-1** **ADR: Account-Level-Usage-Modell** — entschieden, siehe
  [`docs/adr/0004-account-level-usage-quota.md`](../docs/adr/0004-account-level-usage-quota.md):
  ein hub-seitiger In-Memory-Cache pro Adapter-Id (Option c aus der Aufgabe),
  gespeist über ein neues optionales `usageQuota`-Feld auf
  `EmittedEvent`/`NormalizedEvent` (Muster von ADR-0003), **kein** Feld auf
  `SessionRecord`, bewusst nicht K7-persistiert (Begründung im ADR).
  `AdapterCapabilities` bekommt `usage: boolean` (claude: `true`, codex:
  `false` — real gegen die CLIs geprüft: `claude auth status --json` und
  `codex login status` bieten keinen On-Demand-Abfrageweg, nur das reale
  `rate_limit_event` im claude-Stream liefert die Daten). Optionen (a) neue
  Adapter-Methode `usage?()` und (b) `HealthReport`-Erweiterung wurden geprüft
  und explizit verworfen (Begründung im ADR: kein On-Demand-Weg bei beiden
  CLIs bzw. falscher semantischer Ort — `HealthReport` ist an ein
  `SessionHandle` gebunden, nicht an einen Account).
- [x] **T1.5-2** **Kontingent-Erfassung + `GET /api/adapters/:id/usage`.**
  `packages/contracts/src/event.ts`: neue `UsageWindow`/`UsageQuota`-Typen +
  optionales `usageQuota`-Feld auf `NormalizedEvent`/`EmittedEvent` (ADR-0004).
  `packages/adapter-claude/src/normalize.ts` zieht `unifiedWindows` jetzt
  strukturiert heraus (`normalizeUsageQuota()`), inkl. Unix-Sekunden→ISO
  (`toIsoTimestamp()`) und `overageAvailable`/`overageBlockedReason` aus
  `overageDisabledReason`/`isUsingOverage` — nie geraten, `undefined` wenn
  beide Signale fehlen. `AdapterCapabilities.usage` ergänzt (claude `true`,
  codex/dummy `false`). `packages/core/src/sessionmanager.ts`: neue
  `usageByAdapter`-Map (adapter-id-Schlüssel), aktualisiert in `emitEvents()`,
  **kein** Feld auf `SessionRecord`/SQLite — bewusst nicht K7-persistiert
  (Kommentar am Code). Neuer Endpunkt `GET /api/adapters/:id/usage`
  (`packages/server/src/routes.ts`) liefert `{adapterId, supported, quota,
  observedAt}` — `supported` aus `capabilities().usage`, `quota`/`observedAt`
  `null` solange keine Meldung vorliegt (nie 0 %). Getestet: real gegen die
  bestehenden Fixtures (`trivial-text.jsonl` enthält bereits einen echten
  `rate_limit_event`, kein neuer Capture nötig), SessionManager-Test beweist
  „keine Summierung, keine Überschreibung über Sessions hinweg falsch"
  (letzte Beobachtung gewinnt), Routen-Test für `supported:false`/`404`.
  98/98 Tests grün.
- [x] **T1.5-3** **PWA: Budget raus, Kontingent rein.** Budget-Eingabefeld aus
  `CreateSession` entfernt (`packages/pwa/src/App.tsx`) — Contract-Felder
  (`SessionSpec.budgetUsd`, `SessionRecord.budgetUsd`, `hubApi.createSession`s
  `budgetUsd`) unverändert, nur die Eingabe ist weg. Neue Kontingent-Zeile
  im Dashboard (`UsageRow` in `packages/pwa/src/Dashboard.tsx`): pro
  bekanntem Adapter entweder die Fenster-Auslastung (`5h X% · reset HH:MM ·
  7d X% · reset HH:MM`, `resetsAt` in lokaler Zeit), oder bei aktivem
  Overage-Block den Guthaben-Hinweis (`overageDisabledReason`), oder ein
  explizites „unbekannt (Adapter meldet kein Kontingent)" für Adapter ohne
  Datenlage (dummy, codex) — nie 0 %, nie eine leere Zeile. `App.tsx` holt
  `hubApi.adapterUsage(id)` für jeden bekannten Adapter im selben Poll-Zyklus
  wie Sessions/Adapter (kein zweiter Timer). **K10:** `packages/pwa/public/sw.js`
  cached jetzt auch `/api/adapters/:id/usage` (bisher nur `/api/sessions`) —
  die bereits bestehende globale „Daten vom … (offline)"-Anzeige
  (`main.tsx`, `uacc:stale-data`) deckt die Kontingent-Zeile damit automatisch
  mit ab, kein zweiter, redundanter Alters-Indikator nötig.
  **Echt im Browser geprüft** (Playwright, nicht nur `vite build`): Create-Form
  zeigt kein „Budget" mehr, Dashboard zeigt reale Werte einer echten
  claude-Session (`5h 20% · reset 02:50 · 7d 36% · reset 10:00 ·
  out_of_credits`) neben ehrlichem „unbekannt" für dummy/codex —
  Screenshots verifiziert, dark theme und Handy-Breite intakt.
- [ ] **T1.5-4** **`projectRoots` + Repo-Scanner + `GET /api/projects`.** Neues
  Feld in `HubConfig` (`packages/core/src/config.ts:21-39`, Default `[]` —
  bestehende Configs bleiben gültig). Scanner: für jeden Root die direkten
  Unterverzeichnisse (Tiefe 1), aufnehmen was ein `.git` enthält; je Treffer
  stabile Id, Anzeigename, absoluter Pfad, optional Branch. Nicht existierende
  oder nicht lesbare Roots → sichtbare Warnung beim Start, kein stiller
  Leerzustand und kein Crash (Fail loud, AGENTS.md Regel 6 — vgl. BUG-0009,
  `pwaDir` wurde genau so still verschluckt). Ergebnis über einen neuen Endpunkt
  ausliefern. **Sicherheitsteil (nicht optional):** Ist `projectRoots` gesetzt,
  lehnt `POST /api/sessions` (`packages/server/src/routes.ts:58-71`) ein
  `project` außerhalb der Roots ab (422/400), inklusive Symlink-Escape —
  Muster aus [ADR-0001](../docs/adr/0001-swarm-adapter-context.md)
  („niemals ein Dateisystempfad im Request … Server löst gegen `roots` auf").
  Beispielwert in `packages/server/hub.config.example.json` ergänzen.
- [ ] **T1.5-5** **PWA: Projekt-Picker statt Freitext.** Das
  `<input placeholder="/home/user/repo">` in
  `packages/pwa/src/App.tsx:114-121` durch eine Auswahl aus `GET /api/projects`
  ersetzen (`hubApi.projects()` in `packages/pwa/src/api.ts` ergänzen). Verhalten
  bei leerer Liste (kein `projectRoots` konfiguriert): ehrlicher Hinweis
  „keine Projekt-Wurzeln konfiguriert — siehe docs/configuration.md" **mit**
  dem Freitextfeld als Rückfallebene, damit ein frisch aufgesetzter Hub nicht
  unbedienbar wird (BUG-0006-Lektion: Onboarding-Pfade werden zu leicht
  unerreichbar). Im echten Browser prüfen, nicht nur bauen (P1-Retro,
  Erkenntnis 2).
- [ ] **T1.5-6** **Prompt-Composer-Komponente + `hubApi.steer()`.** Eine
  wiederverwendbare Eingabekomponente (neue Datei unter `packages/pwa/src/`),
  eingesetzt an beiden Stellen aus §3.6: im Erstell-Formular und **neu** als
  Antwortfeld in `packages/pwa/src/SessionTail.tsx`. Dafür `steer` in
  `packages/pwa/src/api.ts` ergänzen (Ziel: `POST /api/sessions/:id/steer`,
  Body entspricht `SteerInput` aus `packages/contracts/src/adapter.ts`).
  Ehrliches Fehlerverhalten: Adapter ohne `capabilities().steer` bekommen kein
  Antwortfeld angeboten; ein `ok:false`-Ack (z. B. claudes „Steer(resume) ohne
  Prompt", T1.2) wird sichtbar gemeldet, nicht verschluckt. Die drei Ausgänge
  („Senden", Mikrofon, „Verbessern") werden hier als Platzhalter angelegt und
  in T1.5-7/T1.5-8/T1.5-10 gefüllt — diese Aufgabe ist allein schon deshalb
  einzeln committierbar, weil sie die heutige Steer-Lücke schließt.
- [ ] **T1.5-7** **Spracheingabe (Browser-STT-MVP).** Mikrofon-Knopf im
  Composer, Transkription über die native Browser-STT (§3.3), Ergebnis landet
  **im editierbaren Textfeld**, wird nie direkt abgesendet. Sichtbarer Hinweis,
  wenn die Erkennung den Browser verlässt (Datenschutz-Ehrlichkeit, §3.3), und
  ein sauberer Zustand für Browser ohne Unterstützung (Knopf deaktiviert +
  Begründung, kein stiller No-Op). **K6:** Latenz Aufnahmeende → Transkript
  messen und als `docs/messlauf/<datum>-k6-stt-latenz.md` dokumentieren
  (Prüfstand, Datum, Commit — AI-P0-4-Lektion: keine Zahl ohne Messlauf).
  Geräte-Fähigkeits-Matrix (welches getestete Gerät/Browser kann was)
  dokumentieren — das ist T3.7s ursprünglicher Auftrag, hier eingelöst. Der
  Whisper.cpp-Pfad (P3 T3.6) bleibt explizit **out of scope** dieser Aufgabe
  und wird nur als Ausbaupfad vermerkt.
- [ ] **T1.5-8** **Prompt-Enhancer.** „Verbessern"-Ausgang des Composers:
  Roh-Eingabe → strukturierter Coding-Agent-Prompt (Ziel / Scope / Constraints /
  Erfolgskriterium, P3 §3), Split-Preview (roh | optimiert), „Original senden"
  bleibt jederzeit erreichbar, Auslösung **nur auf Anforderung**, nie automatisch.
  **Vorab zu klären und im Task zu belegen:** welcher der beiden Wege aus §3.4
  (aktueller Coding-Adapter vs. separates lokales Modell) es wird — mit
  gemessener Latenz und gemessener Kontingent-Wirkung beider Optionen, nicht per
  Annahme. Ist die Entscheidung (a), muss die Kontingent-Wirkung des Enhancers
  in der Anzeige aus T1.5-3 sichtbar werden, sonst frisst das Feature unbemerkt
  genau die Ressource, die diese Phase transparent machen soll. P3s
  Over-Engineering-Heuristik übernehmen (kurze klare Imperative brauchen keine
  Optimierung). Learning-Loop-Storage bleibt in P3.
- [x] **T1.5-9** **ADR: Skill-/Agent-Invocation-Mechanismus pro Adapter** —
  entschieden, siehe
  [`docs/adr/0005-skill-agent-invocation-mechanism.md`](../docs/adr/0005-skill-agent-invocation-mechanism.md).
  Gegen die echten CLIs verifiziert (nicht aus Doku-Erinnerung): claude hat
  **zwei** echte, verschiedene Mechanismen — Skills über einen `/skill-name`-
  Präfix im Prompttext (live getestet: `claude -p "/bugfix ..."` lädt die
  Skill-Instruktionen nachweislich auch im nicht-interaktiven Modus), Agents
  über das `--agent <name>`-CLI-Flag (live getestet:
  `claude -p --agent hub-dev "..."` — die Antwort bestätigt selbst die
  aktive Persona). codex hat **kein** Gegenstück (`codex plugin list` zeigt
  ein global installiertes Marketplace-System, unabhängig vom Zielprojekt;
  kein `--skill`/`--agent`-Flag, kein projekt-lokales Konzept). Kein neuer
  Contract-Bruch nötig — beide Mechanismen laufen über das bereits
  bestehende `SessionSpec.args` (adapterspezifischer Freiraum). Offen und im
  ADR benannt: ob `--agent` bei einem `steer(prompt)`-Resume noch wirkt,
  bleibt vor T1.5-10s Umsetzung empirisch zu klären.
- [ ] **T1.5-10** **Skill-/Agent-Overlay.** Zwei Teile. (a) **Scanner**
  (serverseitig, weil das Handy kein Dateisystem des Hosts sieht): liest für ein
  Projekt `<projekt>/.claude/skills/*/SKILL.md` und
  `<projekt>/.claude/agents/*.md`, extrahiert `name` + `description` aus dem
  YAML-Frontmatter, ignoriert Verzeichnisse ohne `SKILL.md` (`_shared/`) und
  lose Dateien (`README.md`, `skill-template.md`) — reale Gegebenheiten, §3.5.
  Ausgeliefert z. B. als `GET /api/projects/:id/skills`. Projekt ohne `.claude/`
  → leere Liste mit Hinweis, kein Fehler. (b) **Overlay-UI**: erscheint beim
  „Senden mit …"-Ausgang des Composers, zeigt Skills/Agents mit Beschreibung,
  die aktuelle Auswahl ist **immer sichtbar** (auch außerhalb des Overlays), der
  zuletzt gewählte Eintrag ist **pro Projekt** vorbelegt (`localStorage`,
  Muster `loadFilter()` aus `packages/pwa/src/SessionTail.tsx`), und „ohne
  Skill senden" bleibt jederzeit möglich. Die tatsächliche Übergabe an die CLI
  folgt exakt dem in T1.5-9 belegten Mechanismus; für Adapter ohne belegten
  Mechanismus zeigt das Overlay **ehrlich „für diesen Adapter nicht verfügbar"**
  statt Prompttext zu basteln, der vielleicht nichts bewirkt. Die getroffene
  Auswahl muss nach dem Absenden im Tail nachvollziehbar sein (Chip am
  user-Event oder System-Event) — sonst weiß niemand hinterher, womit gestartet
  wurde.
- [ ] **T1.5-11** **Registrierung & Erreichbarkeit** (DoD-Teil, nicht Kosmetik).
  Ein fertiges Feature, das nirgends registriert oder dokumentiert ist, zählt
  nicht als fertig: `projectRoots` in
  `packages/server/hub.config.example.json` **und**
  [`docs/configuration.md`](../docs/configuration.md); die neuen Endpunkte
  (`/api/adapters/:id/usage`, `/api/projects`, Skill-Liste) in
  [`docs/architecture.md`](../docs/architecture.md); die Kontingent-Fähigkeit je
  Adapter in der README-Status-Matrix (README §„Adapter-Status-Matrix", heute 6
  Spalten — claude „nativ", codex ehrlich „—") und in
  [`docs/adapters.md`](../docs/adapters.md), damit ein neuer Adapter weiß, was
  von ihm erwartet wird; beide neuen ADRs in `docs/adr/` verlinkt. Zusätzlich:
  P1s Ehrlichkeitsklausel beachten — Status wird erst nach bestandenen Tests
  gesetzt, nicht vorher.

## 5. Acceptance Criteria

- **AC-P1.5-1:** Eine echte `claude`-Session vom Handy gestartet → spätestens
  beim ersten `rate_limit_event` des Streams zeigt die PWA die Auslastung des
  5-Stunden- **und** des 7-Tage-Fensters als Prozentwert plus den Reset-Zeitpunkt
  in lokaler Zeit. Gegenprobe gegen die Rohzeile: angezeigter Prozentwert
  entspricht `unifiedWindows.<fenster>.utilization × 100` mit ≤ 1 Prozentpunkt
  Rundungsabweichung, angezeigte Reset-Zeit entspricht dem Unix-`resetsAt`.
- **AC-P1.5-2:** Eine `codex`-Session zeigt an derselben Stelle wörtlich
  **„unbekannt"** mit abrufbarer Begründung — nie 0 %, nie 100 %, nie ein leeres
  Feld. Die CLI-Grenze (kein Quota-Event im `--json`-Stream, kein
  Quota-Subkommando) ist mit CLI-Version und Prüfdatum dokumentiert, analog zur
  Quellenangabe in `packages/adapter-codex/src/pricing.ts` (T1.11).
- **AC-P1.5-3:** Im Erstell-Formular der PWA existiert kein Budget-Eingabefeld
  mehr (prüfbar per `grep -rn "budget" packages/pwa/src/ --ignore-case` → kein
  Treffer in einem Eingabe-Element). Gleichzeitig sind `SessionSpec.budgetUsd`
  und `SessionRecord.budgetUsd` in `packages/contracts/src/session.ts`
  unverändert und alle bestehenden Tests grün — die Entfernung ist eine
  UI-Änderung, **kein** Contract-Bruch.
- **AC-P1.5-4:** Mit `projectRoots: ["/mnt/omarchy_data/30_repos/arch/arbeitsbaeume"]`
  listet `GET /api/projects` genau die direkten Unterverzeichnisse mit `.git`
  (u. a. `mobile-hub`, `custom-rag`) — kein Nicht-Repo, kein Eintrag aus Tiefe 2,
  kein Eintrag außerhalb der Roots. Ein nicht existierender Root erzeugt eine
  sichtbare Warnung statt einer stillen Leerliste.
- **AC-P1.5-5:** Bei gesetzten `projectRoots` wird ein `POST /api/sessions` mit
  einem `project`-Pfad außerhalb der Roots mit 4xx abgelehnt; ein Symlink
  innerhalb eines Roots, der nach außen zeigt, ebenfalls. Beides als Test.
- **AC-P1.5-6:** Eine Session lässt sich vom Handy **ohne Tippen eines Pfades**
  anlegen (Auswahl aus der Projektliste). Bei leerer/unkonfigurierter Liste
  bleibt der Hub bedienbar (Rückfall-Freitextfeld, BUG-0006-Lektion).
- **AC-P1.5-7:** In einer laufenden `claude`-Session wird aus dem Tail heraus ein
  Folge-Prompt abgesetzt → Server antwortet mit `ok:true` auf
  `POST /api/sessions/:id/steer`, und die Antwort des Agenten erscheint im
  Tail. (Heute unmöglich: die PWA ruft `steer` nirgends auf.) Ein `ok:false`-Ack
  wird als sichtbare Fehlermeldung angezeigt, nicht verschluckt.
- **AC-P1.5-8 (K6):** 20 Diktate aus einem fachbegriffslastigen Testsatz
  (`git`, `diff`, `worktree`, `JSONL`, `tool_use`, `Codex`, `Claude`, `tmux`,
  `MCP`) → Transkript in ≤ 1,5 s bei mindestens 90 % der Läufe, jedes Transkript
  vor dem Absenden editierbar. Ergebnis als `docs/messlauf/`-Eintrag mit
  Prüfstand, Gerät, Browser, Datum, Commit.
- **AC-P1.5-9:** Der Enhancer verwandelt eine vage Eingabe („mach das mit dem
  Login besser") in einen strukturierten Prompt mit Ziel/Scope/Constraints/
  Erfolgskriterium; die Split-Preview zeigt beide Fassungen, „Original senden"
  ist immer erreichbar, und die Optimierung läuft **nie** ungefragt. Das
  gewählte Enhancer-Backend ist mit Messwerten (Latenz, Kontingent-Wirkung)
  begründet dokumentiert.
- **AC-P1.5-10:** Für das Projekt `mobile-hub` listet das Overlay genau die real
  vorhandenen Einträge: **11 Skills** (aus `.claude/skills/*/SKILL.md`) und
  **3 Agents** (aus `.claude/agents/*.md`) — ohne `_shared/`, ohne
  `.claude/skills/README.md`, ohne `skill-template.md`. Ein Projekt ohne
  `.claude/` liefert eine leere Liste mit Hinweis, keinen Fehler.
- **AC-P1.5-11:** Nach einer Auswahl im Overlay ist derselbe Eintrag beim
  nächsten Öffnen **desselben** Projekts vorausgewählt und bei einem **anderen**
  Projekt nicht (Per-Projekt-Speicher, überlebt Reload). Die aktuelle Auswahl ist
  ohne Öffnen des Overlays sichtbar und lässt sich mit einer Interaktion ändern
  oder abwählen.
- **AC-P1.5-12:** Nach dem Absenden ist im Tail nachvollziehbar, mit welchem
  Skill/Agent gestartet wurde (Chip oder System-Event). Für einen Adapter, für
  den T1.5-9 keinen Mechanismus belegen konnte, zeigt das Overlay „für diesen
  Adapter nicht verfügbar" — und es wird nachweislich **kein** Prompttext
  heimlich umgeschrieben.
- **AC-P1.5-13 (K2, Regression):** Die neuen Composer-/Overlay-/Kontingent-
  Elemente verschlechtern die in
  [`docs/messlauf/2026-09-15-k2-frame-lag.md`](../docs/messlauf/2026-09-15-k2-frame-lag.md)
  gemessene Tail-Performance nicht: 30 Events/s über 10 min, weiterhin kein
  Frame-Lag > 200 ms (Wiederholungslauf mit `scripts/k2-frame-lag.mjs`).

## 6. Premortem

**Es ist Ende P1.5 und das Epic ist gescheitert. Warum?**

1. ***Das Skill-Overlay ist eine schöne Attrappe.*** Die Auswahl wird
   gespeichert, angezeigt, hübsch gerendert — aber der gewählte Skill erreicht
   den CLI-Prozess nie, weil der Mechanismus bei `claude` anders aussieht als
   vermutet und bei `codex` überhaupt nicht existiert. Der Agent arbeitet
   einfach so weiter wie ohne Auswahl, und niemand merkt es, weil das Ergebnis
   ja *irgendein* plausibler Output ist. Mitigation: T1.5-9 (echte Untersuchung
   an beiden CLIs + ADR) ist **harte Vorbedingung** für T1.5-10 — kein
   Overlay-Code vorher. Kein einheitlicher Mechanismus per Annahme (die
   P1-Retro-Erkenntnis 1 gilt hier doppelt: die vereinfachte Vorstellung war
   schon bei den Event-Formaten falsch). Wo kein Mechanismus belegbar ist, sagt
   die UI das ehrlich (Fail loud, AGENTS.md Regel 6) statt Prompttext zu
   basteln. Und AC-P1.5-12 verlangt, dass die Wirkung im Tail **sichtbar** ist —
   eine Attrappe fiele dort auf.
2. ***Das Kontingent landet doch als Feld auf der Session.*** Weil es der
   kürzeste Weg zur Anzeige ist, wandert `utilization` neben `costUsd` in den
   `SessionRecord` — und das Dashboard summiert es, wie es `costUsd` schon
   summiert (`packages/pwa/src/Dashboard.tsx:57`). Ergebnis: zwei parallele
   Sessions melden „86 % verbraucht", wo es real 43 % sind. Der
   `costUsd`-Overload, den AI-P1-4 bereits als Schuldposten führt, verdoppelt
   sich. Mitigation: T1.5-1 (ADR) vor jeder Zeile Code; das ADR muss die
   Abgrenzung zu ADR-0003 ausdrücklich enthalten; ein Test hält fest, dass ein
   Usage-Wert nirgends über Sessions summiert wird.
3. ***Die Kontingent-Anzeige bleibt leer und wirkt kaputt.*** Wie oft `claude`
   ein `rate_limit_event` schickt, ist **nicht** verifiziert — der eine reale
   Capture beweist, dass es vorkommt, nicht, dass es in jeder kurzen Session
   vorkommt. Bei einem 20-Sekunden-Turn sieht der Nutzer womöglich nie einen
   Wert und hält das Feature für defekt. Mitigation: Der Snapshot ist
   adapter-global und überlebt die einzelne Session, trägt sein Alter sichtbar
   („Stand: HH:MM") und sagt im Leerfall „noch keine Meldung von diesem Adapter"
   statt nichts. Niemals eine erfundene 0.
4. ***Der Enhancer frisst genau das Kontingent, das diese Phase sichtbar machen
   soll.*** Weg (a) aus §3.4 wird stillschweigend gewählt, weil er ohne neue
   Infrastruktur auskommt — und jede Prompt-Verbesserung kostet einen echten
   Modell-Aufruf aus derselben Subscription. Am Monatsende ist das Limit früher
   erreicht als vorher, ausgerechnet wegen des Features, das davor warnen sollte.
   Mitigation: Die Entscheidung ist in T1.5-8 **mit Messung beider Wege** zu
   treffen und zu dokumentieren; fällt sie auf (a), muss die Kontingent-Wirkung
   des Enhancers in T1.5-3s Anzeige auftauchen; Optimierung bleibt opt-in.
5. ***Die Projektliste wird zum Pfad-Escape.*** Der Picker ist gebaut, aber
   `POST /api/sessions` nimmt weiterhin jeden Pfad an, den ein Client schickt —
   und der Client ist ein Handy im Tailnet. Ein kompromittiertes Gerät startet
   einen Coding-Agenten mit Schreibrechten in `$HOME`. Mitigation: Die
   serverseitige Root-Prüfung ist **Teil** von T1.5-4, nicht ein Folgeticket;
   ADR-0001s Allowlist-Muster wird übernommen; AC-P1.5-5 testet Escape und
   Symlink-Escape.
6. ***Die Spracheingabe widerspricht dem local-first-Versprechen.*** Browser-STT
   schickt das Audio zur Erkennung an einen Cloud-Dienst — und ausgerechnet
   ein Projekt, dessen P3-Scope einen Egress-Test im CI vorsieht (AC-P3-6),
   baut sich damit einen Cloud-Pfad in die Eingabe. Mitigation: sichtbarer
   Hinweis in der UI, keine stille Aktivierung, der Whisper.cpp-Pfad (P3 T3.6)
   bleibt als dokumentierte lokale Alternative bestehen und wird in der
   Geräte-Matrix aus T1.5-7 als solche geführt; diese Phase erklärt Browser-STT
   ausdrücklich zum **MVP**, nicht zum Endzustand.
7. ***„Control-Center" wird zum Sammelbecken.*** Jeder weitere UI-Wunsch findet
   in dieser Phase ein Zuhause, weil sie ohnehin „die UX-Phase" ist, und P2
   verschiebt sich um Wochen. Mitigation: dieselbe Regel wie in P1
   (Premortem 4): jede Zusatz-UI braucht einen Task **und** einen
   Messlatten-Bezug (AGENTS.md Regel 5). Alles, was §2 „Out" nennt — Approvals,
   Diffs, Sprachsuche, Sprach-Direktiven, Learning-Loop —, bleibt draußen, auch
   wenn es „gerade gut passen würde".

## 7. Definition of Done

Alle ACs grün **und**:

- Beide ADRs (`docs/adr/0004-*` Account-Usage-Modell, `docs/adr/0005-*`
  Skill-Invocation-Mechanismus) existieren mit Status **entschieden** — nicht
  „offen", nicht nachträglich zur bereits gebauten Lösung geschrieben.
- Kontingent-Anzeige **mit Quellenangabe pro Adapter** (claude: nativ aus
  `rate_limit_event`, CLI-Version + Datum; codex: belegt „unbekannt", geprüfte
  CLI-Version + Datum) — dieselbe Ehrlichkeitsdisziplin wie bei T1.11s
  Preistabelle.
- **Erreichbarkeit ist Teil der Fertigstellung** (T1.5-11): `projectRoots` steht
  in `packages/server/hub.config.example.json` und `docs/configuration.md`, die
  neuen Endpunkte in `docs/architecture.md`, die Kontingent-Fähigkeit in der
  README-Status-Matrix und `docs/adapters.md`. Ein Feature, das nur im Code
  existiert und in keiner Konfiguration oder Matrix auftaucht, gilt als nicht
  fertig.
- Mindestens ein **echter Ende-zu-Ende-Lauf vom Handy** pro Kernfluss
  (Projekt auswählen → diktieren → optional verbessern → mit Skill senden →
  Antwort im Tail → Kontingent sichtbar), dokumentiert — damit diese Phase nicht
  denselben 🟡-Ausgang nimmt wie AC-P1-1/AC-P1-2 (P1-Retro: „nie als Live-Lauf
  ausgeführt", AI-P1-1).
- K6-Messlauf unter `docs/messlauf/` mit Prüfstand/Datum/Commit; K2-Regressions-
  lauf wiederholt und dokumentiert.
- `npm test`, `npm run lint`, `npm run typecheck` grün; kein TODO-Kommentar ohne
  Ticket-Referenz; Premortem-Mitigationen, wo testbar, als Tests abgebildet
  (mindestens: Root-Escape, Symlink-Escape, „Usage wird nie über Sessions
  summiert", Scanner ignoriert `_shared`/`README.md`/`skill-template.md`).
