# EPIC-P62 — Öffentliche Anleitung (EN), Feature-Videos und Promo-Seite void.securesight.ai

**Status:** offen (Planungsentwurf 2026-11-16) · **Issue:** [#14](https://github.com/securesight-ai/AncientVoid/issues/14) · **Phase:** P62 · **Dauer:** 3–4 Agenten-Wochen (Guide 1–1,5 · Leak-Guard 0,5 · Demo-Seed 0,25 · Promo-Seite + Deployment 0,5–1 · Video-Pipeline 0,5–1)
**Abhängigkeit:** keine fachliche offene (Quer-Epic wie P58–P61; P57 abgeschlossen, P60 umgesetzt). **P61** (Produktoberfläche mehrsprachig) bleibt unberührt — der Guide ist unabhängig englisch. **P33** (englische Einstiegsdoku, seit 08.11. vertagt): dieser Auftrag gibt das GO für P33s Doku-Kern; T62.4 löst T33.2–T33.4-Ziele ein, P33s Status wird beim Abschluss entsprechend gesetzt (kein zweites Häkchen, kein neues OSS-Scoping).

Quelle: Nutzerauftrag vom 16.11.2026 im Zuge des GitHub-Umzugs („perfekt
ausgearbeitete Anleitung auf Englisch mit Screenshots zu allen Seiten und
Features"; „ganz viele kurze Videos (max. 2–3 min) für YouTube";
„void.securesight.ai als Promo-Seite … wo wir dann die Videos, wiki etc
einbinden"; „Stell sicher, dass keine credentials, kritischen Daten etc. zu
sehen sind … deterministischen hook"). Motivationslage:
[Public-Release-Audit](../docs/2026-11-15_public-release-audit.md) „Erster
Eindruck": Erstkontakt ist englischsprachig zu bedienen — bisher fehlen
bebilderte Anleitung und sichtbare Features im Überblick.

## 1. Ziel

Wer AncientVoid öffentlich findet, versteht in unter zehn Minuten, was das
Tool kann, wie jede Seite der PWA bedient wird und wie der Einstieg gelingt
— auf Englisch, mit Screenshots und Kurz-Videos. Eine Promo-Seite unter
`void.securesight.ai` bündelt Value-Prop, Feature-Clips, Anleitung und
Repo-Links und macht aus Besuchern Nutzende. Alles, was dabei veröffentlicht
wird (Screenshots, Videos, Seitentexte), ist **nachweisbar und deterministisch
erzwungen** frei von Credentials, echten Host-/Projektnamen, echten Pfaden
und internen Daten — nicht nur per Konvention.

Kein Ziel: Produktverhalten der PWA/des Hubs ändern (außer der kleinen
Token-Präfix-Entscheid in T62.2), Produktoberfläche übersetzen (P61),
bezahltes Marketing, Community-Betrieb.

## 2. Scope (In / Out)

**In:**

- Feature-/Seiten-Inventur der PWA als verbindliche Liste (Quelle für Guide,
  Videos und Promo-Feature-Grid).
- Englische Anleitung mit reproduzierbaren Screenshots zu jeder inventarisierten
  Seite/jedem Feature; Ablagekonzept ohne Verstoß gegen `check:context`
  (docs/ ist flach — Regel-Erweiterung ist Teil der Aufgabe).
- Deterministischer Leak-Guard: Aufnahme-Regeln (Doku), `check:media`
  (Verzeichnis-/Typ-/Metadata-/Budget-Regeln für committete Medien),
  OCR-Pass über neue Screenshots in CI, neuer `pre-commit`-Hook,
  Token-Präfix für Device-Tokens (erkennbar statt strukturell blind).
- Demo-Hub-Seed: deterministisches Skript, das einen Hub nur mit
  Fake-Daten füllt (adapter-dummy, Allowlist-Projektnamen, Fake-Hosts) —
  einzige erlaubte Datenquelle für Screenshots und Video-Szenen.
- Video-Pipeline: Skript je Clip (≤ 3 min, englisch), Aufnahme-Runbook,
  Publish-Checkliste (YouTube: Titel, Beschreibung, Untertitel, Thumbnail,
  Playlist). Videos selbst werden **nie** committet — YouTube hostet.
- Promo-Seite als eigene statische App (`apps/site`): Hero, Feature-Grid,
  Video-Einbettungen (youtube-nocookie), Quickstart, Links zu Repo/Guide/Issues;
  Inhalte aus einer Datenquelle (`content.json`).
- Deployment auf `void.securesight.ai` per ADR-Entscheid (GitHub Pages mit
  CNAME vs. alternatives Hosting) inkl. CI-Deploy-Job mit gepinnten Actions
  und minimalen Rechten.

**Out:** Änderungen an Hub-/PWA-Verhalten jenseits der Token-Präfix-Entscheid;
Übersetzung der Produktoberfläche (P61); Übersetzung aller ADRs; Video- Roh-
oder Schnittmaterial im Repo; Analytics/Tracking auf der Promo-Seite; Community-
oder Registry-Betrieb; ein zweites Mal abhaken, was P57 (Onboarding-Doku,
abgeschlossen) oder der Public-Release schon geliefert haben.

## 3. Design-Details

### 3.1 Inventur als Contract (T62.1)

Die PWA-Ebenen sind zentral registriert (`apps/pwa/src/shared/layers.ts`,
Dock/Routing in `apps/pwa/src/app/`). T62.1 leitet daraus (plus
`apps/pwa/src/features/`-Verzeichnis) eine Inventar-Datei
`docs/guide/inventory.md` ab: jede Seite/Ebene/Feature mit ID, Kurzbeschreibung
(EN) und Verweisen auf den zugehörigen e2e-Spec. Diese Liste ist der
Abgleichmaßstab für Guide-Sektionen (AC-P62-1) und Promo-Feature-Grid — neue
UI ohne Inventareintrag wird im Test rot (Fail loud statt stiller Lücke).

### 3.2 Screenshots: erzeugt statt abfotografiert (T62.4)

Screenshots entstehen **deterministisch per Playwright** gegen einen Demo-Hub
(gestartet aus T62.3-Seed): ein Skript (`scripts/guide-shots.mjs`) öffnet jede
Inventar-Seite, setzt einen festen Viewport und schreibt
`docs/guide/assets/<seite>-<nn>.png`. Vorteile: keine Handaufnahme, keine
echte Umgebung, reproduzierbar bei UI-Änderung; ein Hash-Abgleich in CI macht
veraltete Screenshots rot, bevor der Text lügt. EXIF/tEXt-Metadata werden beim
Schreiben entfernt. Handaufnahmen sind nur erlaubt, wo Playwright nicht hinkommt
(mobil/gerätespezifisch) — auch dann nur aus dem Demo-Seed, mit
Leak-Guard als Netz.

### 3.3 Leak-Guard, dreistufig deterministisch (T62.2)

1. **Struktur (immer, auch offline):** `scripts/check-media.mjs` scannt
   getrackte Dateien — erlaubt sind nur `png/webp/jpg/svg` unter
   `docs/guide/assets/` und `apps/site/assets/`; Video-/Archiv-/Binär-Typen
   (`mp4`, `mov`, `gif`, `zip`, …) im Repo sind rot; je Datei und gesamt gilt
   ein Byte-Budget; PNG-Textchunks und EXIF müssen leer sein; Dateinamen
   folgen `<seite>-<nn>.png`. Fail loud mit Datei + Regel (gleiche Form wie
   `check:secrets`).
2. **Inhalt (in CI):** der verify-Job läuft `check:media --ocr` über neue/
   geänderte Screenshots — `tesseract` ist bereits CI-Abhängigkeit. Gemustert
   werden nur Hoch-Präzisions-Token-Formen (feste Präfixe wie `ghp_`, `sk-`,
   `glpat-`, private-Key-Blöcke **und** das neue `avt_`-Device-Token-Präfix),
   keine generischen Heuristiken — dieselbe Philosophie wie
   `scripts/check-secrets.mjs`, sonst erzeugt der erste False-Positive ein
   `--no-verify`-Reflex.
3. **Zeitpunkt (lokal):** neuer `.githooks/pre-commit` (es gibt bisher nur
   `commit-msg` und `pre-push`) prüft gestellte Medien gegen die
   Strukturregeln — schnell ohne OCR; der OCR-Teil bleibt der CI überlassen.

**Token-Präfix-Entscheid:** Device-Tokens sind heute
`randomBytes(24).toString("base64url")` — 32 Zeichen ohne erkennbares Merkmal
(`packages/core/src/modules/identity/tokens.ts`); ein Leak wäre in Text und
OCR strukturell unsichtbar. T62.2 gibt neuen Tokens das Präfix `avt_`
(gespeichert bleibt der sha256-Hash wie bisher; Plaintext erscheint genau
einmal im Pairing-Dialog). Damit sind Tokens deterministisch detektierbar —
Text wie OCR. Interne Änderung im identity-Modul, kein Contracts-Bruch;
begleitender Test prüft Präfix und Hash-Kompatibilität.

**Regeln als Doku:** `docs/demo-media.md` (neu) fixiert die Aufnahme-Regeln:
nur Demo-Seed-Daten; nie echte Projektnamen, Host-/Tailscale-Namen, IPs,
Absolute Pfade (`/home`, `/mnt`), Username, Token-Felder; Review-Checkliste
pro Medium; Video-Export-Checkliste (Fullscreen-Aufnahme, kein Systemmitteilungs-
Overlay, keine Browser-Profilleiste mit echtem Account).

### 3.4 Demo-Hub-Seed (T62.3)

`scripts/demo-seed.mjs` startet einen Hub (`--data` in ein Temp-Verzeichnis)
und befüllt ihn deterministisch: Fake-Projekte aus einer Allowlist
(`demo/website`, `demo/api`, …), Sessions über den vorhandenen
`adapter-dummy`, Fake-Hosts, Approvals, Medien- und Automation-Beispiele —
alles mit festen Namen und seeded Zeitstempeln. Ein Test
(`scripts/demo-seed.test.mjs`) stellt sicher, dass der Seed ausschließlich
Allowlist-Werte erzeugt (Allowlist ist der Test-Maßstab, nicht die intuition
des Aufnehmenden). Derselbe Seed treibt Guide-Screenshots (3.2) und
Video-Szenen (3.5) — eine Wahrheit über alle Medien.

### 3.5 Videos: Skript zuerst,.publish danach (T62.5)

Jeder Clip hat eine Skript-Datei `docs/videos/<n>-<slug>.md`: Ziel (eine
Feature-Story, ≤ 3 min), Shot-Liste (Szenen = Demo-Seed-Zustände),
Sprechtext (EN, ca. 200–350 Wörter), Endcard (Repo-URL, Guide-Link).
Reihenfolge zwingend: Skript-Review → Demo-Szene am Seed → Aufnahme →
Schnitt ≤ 180 s → Publish-Checkliste (Titel, Beschreibung mit Links,
englische Untertitel — wichtig für stummes Autoplay, Thumbnail aus
Guide-Screenshot, Playlist „AncientVoid Features"). Erst der öffentliche
YouTube-Link zählt als erledigt; ein (`Skript fertig, Video fehlt`)-Stand
ist kein Häkchen. Skripte sind Markdown im Repo und damit review- und
linkbar; Rohmaterial bleibt außerhalb (lokal/Cloud des Aufnehmenden).

### 3.6 Promo-Seite `apps/site` (T62.6)

Statisch, Vite, eine Seite mit Ankern — keine Server-Logik, kein
Framework-Overkill, keine gemeinsamen Runtime-Abhängigkeiten mit der PWA
(„keine zweite PWA warten"). Inhalte (Features, Video-IDs, Links) leben in
`apps/site/src/content.json` und speisen Hero, Feature-Grid und Video-Grid;
so bleibt die Seite inhaltsaktualisierbar ohne Strukturarbeit. Videos werden
als `youtube-nocookie`-Embeds eingebunden, Abspielen erst auf Klick
(kein Drittanbieter-Tracking beim Besuch). Sektionen: Hero (Satz + Quickstart-
Kommando), Features (Grid mit Verweis auf je einen Clip), Anleitung/Guide-Link,
Repo/Issue-Links, rechtlicher Hinweis-Block (Betreiber securesight.ai —
inhaltlich Nutzerentscheidung, als Platzhalter-Section umgesetzt). Sprache:
Englisch (P61 übersetzt die Produktoberfläche, nicht diese Seite).

Eigenes, kleines Budget statt K-Messlatte (K1–K10 betreffen den Hub, nicht
eine statische Seite): Lighthouse Mobile Performance ≥ 90 und Accessibility
≥ 95 im CI-Deploy-Job als Gate; Unterschreiten = rot, kein Pass mit Sternchen.

### 3.7 Deployment nach `void.securesight.ai` (T62.7, mit ADR)

ADR-0082 entscheidet Ziel und Weg: bevorzugt **GitHub Pages** mit Custom
Domain `void.securesight.ai` (CNAME beim Domain-Inhaber — dokumentierte
Nutzeraufgabe), Alternative Cloudflare Pages; Fallback bis zum DNS-Umzug ist
die github.io-URL, damit die Seite unabhängig vom DNS-Fortschritt live und
prüfbar ist. CI-Deploy-Job: nur `main`, Actions per SHA gepinnt (wie
`ci.yml`), `permissions` minimal (`pages: write`), Deploy grün oder rot —
kein manueller Zwischenschritt. HTTPS ist erzwungen.

### 3.8 Grenzen

Der Leak-Guard prüft committete Medien und Texte — er kann nicht verhindern,
dass jemand im Nachhinein echte Daten in ein **YouTube-Video** hält. Dafür
gilt: Video-Szenen nur aus Demo-Seed (3.4), Review-Checkliste pro Clip vor
Publish (3.5), und die Publish-Checkliste ist Teil der Definition of Done
eines Clips. Agenten-Output wird nie als Instruktion interpretiert (PRD §8.5
unberührt); die Promo-Seite bettet nur konfigurierte Embeds ein, kein
User-Content.

## 4. Aufgaben (Checkliste)

- [x] **T62.1 Inventur & Strukturentscheide** — PWA-Ebenen/Features in
      `docs/guide/inventory.md` (EN-Kurzbeschreibung + Spec-Verweis);
      Ablagekonzept Guide-Assets + `docs/check-context.md`-Regelerweiterung
      (Budgets für `docs/guide/`); Test: neue Ebene ohne Inventareintrag rot.
- [x] **T62.2 Leak-Guard** — `docs/demo-media.md` (Regeln + Checklisten);
      `scripts/check-media.mjs` (+ Tests, jede Regel rot-vor-Grün);
      `check:media --ocr` in verify; `.githooks/pre-commit` (staged Medien);
      Token-Präfix `avt_` in identity (Test: Präfix + Hash-Kompatibilität);
      README der Checks (`docs/ci-gate-inventar.md`) nachziehen.
- [x] **T62.3 Demo-Seed** — `scripts/demo-seed.ts` + Allowlist +
      `scripts/demo-seed.test.mjs`; nutzbar via `npm run demo:seed`.
- [x] **T62.4 Englische Anleitung + Screenshots** — Sektion je Inventareintrag
      (EN, alt-Texte, Querverweise zwischen Sektionen und Specs);
      `scripts/guide-shots.mjs` (Playwright → `docs/guide/assets/`,
      Metadata-strip, Hash-Datei); CI-Abgleich Inventar ↔ Sektionen ↔
      Screenshot-Hashes; README verlinkt den Guide prominently.
- [ ] **T62.5 Video-Pipeline** — Skript-Schablone + erste ≥ 8 Skripte
      (je Feature-Story, ≤ 3 min); Aufnahme-Runbook in `docs/demo-media.md`;
      Publish-Checkliste; Playlist angelegt; Clips veröffentlicht und im
      Repo (Link + Skript) registriert. Bei der Skript-Überarbeitung die
      Endcard-/Repo-Links vom alten Namespace nach `securesight-ai/AncientVoid`
      migrieren (EPIC-P71 AI-P71-1; betrifft auch das Launch-Playbook).
- [x] **T62.6 Promo-Seite** — `apps/site` (Vite, statisch, `content.json`,
      youtube-nocookie-Embeds, Rechtshinweis-Block); Lighthouse-Gates
      (Perf ≥ 90 / A11y ≥ 95) im Deploy-Job; Smoke-e2e-Spec
      (`e2e/specs/site.spec.ts`: baut Seite, prüft Hero, Links, Embeds).
- [x] **T62.7 Deployment** — ADR-0082 (Ziel, Domain, Fallback); CI-Deploy-Job
      (main-only, SHA-gepinnt, Minimalrechte); DNS-Nutzeraufgabe dokumentiert;
      github.io-URL live aus der CI — `https://void.securesight.ai` wartet auf
      den CNAME-Record (Nutzeraufgabe, ADR-0082).
- [x] **T62.8 Verdrahtung & Abschluss** — README/Guide/Videos/Site
      kreuzverlinkt; P33-Status gemäß Einlösung gesetzt; epics/README;
      `npm run gate` grün; CI (verify, k8, e2e) auf dem Abschluss-PR grün.

**Stand 16.11.2026 (Umsetzung):** T62.1–T62.4, T62.6–T62.8 umgesetzt und
gemergt (PR #30/#36). Abschlussnachweise: lokales Voll-Gate inkl.
`test:e2e` 712/712 grün (53,6 min); verify auf dem Abschluss-Head grün;
die volle e2e-Runde war auf dem inhaltsgleichen Vorgänger-Head grün und
wird ergänzend durch die neue Nightly (4 Shards) auf main belegt.
**Offen beim Nutzer:** T62.5-Clips aufnehmen/publishen (8 Skripte mit
Sprechtext liegen fertig; Playlist „AncientVoid Features") und
DNS-CNAME für `void.securesight.ai` (ADR-0082).
Messlatten-Referenz: K1–K10 betreffen den Hub und bleiben unberührt; dieses
Epic setzt eigene, equally messbare Kriterien (AC-P62-1…7), insbesondere
deterministische Leak-Erkennung (AC-P62-5/6) und Lighthouse-Budgets (AC-P62-4).

## 5. Acceptance Criteria

1. **AC-P62-1 (Abdeckung):** Ein CI-Test gleicht `docs/guide/inventory.md`
   mit den PWA-Ebenen (`layers.ts`/Features) und den Guide-Sektionen ab —
   jede Seite/jedes Feature hat eine Sektion; eine neue UI ohne Eintrag ist
   rot. Beleg: Testlauf im Abschluss-PR.
2. **AC-P62-2 (Anleitung):** Jede Sektion ist englisch, hat mindestens einen
   per `guide-shots.mjs` erzeugten Screenshot mit alt-Text; der CI-Hash-
   Abgleich kennt jede Datei. Beleg: verify-Run + Guide-Link.
3. **AC-P62-3 (Videos):** ≥ 8 Clips, jeder ≤ 180 s, öffentlich auf der
   Playlist; je Clip liegen Skript (Shot-Liste, Sprechtext, Seed-Referenz)
   und Link im Repo; die Promo-Seite bettet alle ein. Beleg: Playlist-URL +
   Repo-Dateien.
4. **AC-P62-4 (Promo-Seite):** `https://void.securesight.ai` erreichbar
   (HTTPS), Hero/Features/Videos/Links vollständig; Deploy aus CI auf main;
   Lighthouse Mobile Performance ≥ 90 und Accessibility ≥ 95 im Job. Beleg:
   Seiten-URL + Deploy-Run.
5. **AC-P62-5 (Leak-Guard deterministisch):** Für jede Regel von
   `check:media` (Verzeichnis, Typ, Metadata, Budget, OCR-Token-Präfixe)
   existiert ein Test, der vor der Einführung rot war; `check:media --ocr`
   läuft in verify; `pre-commit` prüft staged Medien. Beleg: Testsuite +
   verify-Run.
6. **AC-P62-6 (keine echten Daten):** Demo-Seed erzeugt ausschließlich
   Allowlist-Werte (Test als Maßstab); `check:secrets` und `check:media`
   über dem Release-Stand grün. Beleg: Seed-Test + Check-Runs.
7. **AC-P62-7 (Prozess):** `npm run gate` lokal grün; GitHub-Actions
   (`verify`, `k8`, `e2e`) auf dem Abschluss-PR grün; neuer statischer
   Ablauf (Site) hat einen Spec (`e2e/specs/site.spec.ts`); ADR-0082 liegt;
   P33-Status ist fortgeschrieben. Beleg: PR + ADR.

## 6. Premortem (Failure-Modi + Mitigation)

1. **„Der Screenshot zeigt doch echt den Token des Entwicklers."** —
   Screenshots entstehen nie von Hand am Produktiv-Hub, sondern per Skript
   aus dem Demo-Seed (3.2/3.4); Token-Präfix macht Restrisiken OCR-erkennbar
   (3.3); Struktur- und Metadata-Regeln plus pre-commit; Review-Checkliste
   pro Medium. Doppelt gehalten: Erzeugungsweg UND Guard.
2. **„Nach dem nächsten UI-Umbau lügt der Guide."** — Inventar ist Contract
   (AC-P62-1): neue Ebene ohne Sektion/Grafik = roter Test, nicht stiller
   Verfall; Screenshot-Hashes regenerieren deterministisch; Sektionen
   verweisen auf e2e-Specs, die sich mit der UI ändern müssen.
3. **„Die Videos werden nie fertig — Skripte ohne Schnitte."** — Reihenfolge
   erzwungen (Skript-Review → Seed-Szene → Aufnahme → ≤-180-s-Schnitt →
   Publish-Checkliste); harte Obergrenze pro Clip; nur der öffentliche Link
   zählt (AC-P62-3); Skripte sind reviewbare Artefakte, kein Rohmaterial.
4. **„Die Promo-Seite wird ein zweites wartungsintensives Projekt."** —
   bewusst statisch und einspaltig einfach: eine Seite, `content.json` als
   einzige Inhaltsquelle, keine Server-Logik, keine geteilte Runtime mit der
   PWA; Lighthouse-Budgets halten Komplexität sichtbar; ADR-0082 dokumentiert
   die Grenze (bewusst kein Framework-Overkill).
5. **„Der Leak-Guard spuckt False-Positives und jemand umgeht ihn."** — nur
   Hoch-Präzisions-Muster mit festen Präfixen (Philosophie `check:secrets`),
   OCR ausschließlich über neue/geänderte Dateien, Allowlist nur mit
   Begründung, Testsuite mit echten Negativ-Beispielen — der Guard bleibt
   schnell und vertrauenswürdig statt lautschreiend.
6. **„DNS/Domain blockiert den Go-live."** — Deploy-Job ist unabhängig von
   der Domain prüfbar (github.io-Fallback), CNAME ist eine dokumentierte
   Nutzeraufgabe im ADR; die Seite ist „live", sobald CI grün ist —
   `void.securesight.ai` ist Anbindung, keine Voraussetzung.

## 7. Definition of Done

Alle AC-P62-1…7 mit Belegen (Links auf Runs/URLs/Dateien) erfüllt;
`npm run gate` lokal grün; GitHub-Actions (`verify`, `k8`, `e2e`) auf dem
Abschluss-PR grün — rote CI allein wegen Umgebung wird benannt, nie als Pass
gezählt; ADR-0082 liegt; `docs/demo-media.md`, `check:media` und
`pre-commit` sind im Gate-Inventar (`docs/ci-gate-inventar.md`) registriert;
P33-Status fortgeschrieben; README, epics/README und der Guide kreuzverlinkt
(erreichbar = fertig: was nicht verlinkt ist, existiert nicht); keine
Credentials oder echten Daten in irgendeinem committeten Medium (Beleg:
grüne `check:secrets`- und `check:media`-Läufe über dem Release-Stand).
