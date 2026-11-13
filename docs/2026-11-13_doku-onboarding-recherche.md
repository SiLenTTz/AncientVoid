# Dokumentation und Onboarding — Recherche vom 13.11.2026

Eingefrorene Analyse (Snapshot) als Grundlage für
[`EPIC-P57`](../epics/EPIC-P57-doku-onboarding.md). Nur Recherche und
Planung: keine Doku-Site, keine neue Abhängigkeit, keine PWA-Änderung.

**Zielgruppen** (der Auftrag nannte „drei“, benannt war nur die erste; die
beiden anderen sind hier eine **Annahme**, im Epic bestätigen):

1. **Endnutzer** — will Agenten vom Handy steuern, liest keinen Code.
2. **Integratoren/Beitragende** — bindet Adapter/Harnesses an, schreibt Code.
3. **Agenten** — Coding-Agenten, die im Repo arbeiten.

## 1. Ist-Stand

| Bestand | Umfang | Zielgruppe | Befund |
|---|---|---|---|
| `README.md` | 232 Zeilen | 1 | Ist-Stand, Screenshots, Wizard, VoidWarden-Kaskade (P53). Mischt Pitch, Quickstart, Adapter-Matrix und Sicherheit in einer Datei |
| `docs/onboarding.md` | 179 Zeilen | 1+2+3 | „Route durch die Detail-Doks“; §1–5 Endnutzer, §6–8 Integratoren/Agenten in einer Seite |
| `docs/*.md` (45 Dateien) | Runbooks, Referenz, Konzepte, Snapshots | 2+3 | Keine Gliederung nach Nutzerbedürfnis; `configuration.md`, `adapters.md` sind Referenz **und** Erklärung gemischt |
| `docs/adr/` | 74 ADRs | 2+3 | Entscheidungs-Log, bewusst kein Einstieg |
| `epics/` | 62 Epics + PRD | 3 | Planung; für Endnutzer unlesbar |
| `.claude/skills/` | 16 Skills (u. a. `setup-wizard`) | 3 | Gut abgedeckt |
| `AGENTS.md`/`CONTRIBUTING.md` | je ≤ 200 Zeilen | 2+3 | Gut abgedeckt, vom Gate budgetiert |
| `setup.sh` (P53) | One-Command-Wizard | 1 | Funktioniert; Provider-Vorabprüfung fehlt ([Audit](2026-11-11-setup-modelle-audit.md)) |
| PWA | `TokenGate` in `apps/pwa/src/app/main.tsx:46`; Leerzustände nur Einzeiler („keine Sessions — lege eine an“, `Dashboard.tsx:329`) | 1 | Kein First-Run-Fluss, keine geführte Verbindung Handy↔Hub |
| VoidWarden | README, `docs/` (13 ADRs, `spec.md`, `operations.md`), Epic P14 | 1 (Kiosk), 2 | Eigenes Repo mit eigener Doku; Kaskade in beiden READMEs |

Bereits vorhandene Strukturen, die ein Epic **nutzen statt neu bauen** soll:

- **Drift-Gate:** `npm run check:context` ([`check-context.md`](check-context.md))
  mit Zeilenbudgets, Link-/Referenzprüfung und Frischhalte-Map (12 lebende Dokumente).
- **Generierte/geprüfte Wahrheit:** `check:adapter-matrix` (README-Matrix gegen
  `capabilities()`), `funktionsinventar.md` + `e2e/specs/funktionsinventar.spec.ts`
  (Inventarzeile ohne Spec = Fehler), `readme-screenshots.mjs` (Screenshots aus Demo-Hub).
- **Doku-Anzeige ohne Zusatztool:** Die PWA rendert Markdown-Dokumente
  bereits (`e2e/specs/docs.spec.ts`), GitLab ebenso.
- **Abgrenzung:** P33 (englischer Einstieg) ist „vertagt“ und gesperrt; P53
  (README/Wizard) ist abgeschlossen. Beides darf nicht doppelt gezählt werden.

## 2. Lücken je Zielgruppe

**Endnutzer (größte Lücke):**

- **E1 Handy-Weg fehlt als Pfad.** Der Wizard endet am Hub auf dem PC. Der
  Schritt, der das Produkt ausmacht — Handy erreicht den Hub (Tailscale serve),
  Token kommt aufs Handy, erste Session wird dort gesteuert — steht verteilt in
  README (`setup-tailscale-serve.sh`), `onboarding.md` §5 und `configuration.md`.
- **E2 Token-Übergabe ist manuell.** `TokenGate` verlangt Copy-and-paste eines
  einmal angezeigten Tokens; die Hilfe verweist auf `hubctl token issue`, einen
  CLI-Befehl, den man auf dem Handy nicht ausführt.
- **E3 Kein Erfolgssignal.** Weder Wizard noch PWA bestätigen „Agent verbunden,
  Handy gekoppelt“. Der Wizard prüft kein Provider-Login (Audit-Befund).
- **E4 Leere Zustände ohne Führung.** Frisch installiert zeigt die Übersicht
  „keine Sessions — lege eine an“; kein Hinweis auf den `dummy`-Adapter als
  risikoloses Probieren, keine Erklärung von Freigaben.
- **E5 Keine Diátaxis-Trennung.** Tutorial („erste 15 Minuten“), How-tos
  (Provider wechseln, zweites Gerät, Backup), Referenz (Config, hubctl, Adapter),
  Erklärung (Sicherheit, Tokens-Rollen, K7) liegen ungeordnet nebeneinander.
- **E6 Fehlerdiagnose nur für Agenten.** `setup-wizard` ist ein Agenten-Skill;
  ein Mensch ohne Agent hat keine Exit-Code-Tabelle (steht nur im Skriptkopf).
- **E7 VoidWarden-Einstieg zweigeteilt.** Zwei READMEs, zwei Wizards; ob und wann
  ein Nutzer VoidWarden überhaupt braucht, wird nicht entschieden („Welches Display?“
  steht nur im VoidWarden-README).

**Integratoren/Beitragende:** `adapters.md` (377 Z.) mischt Anleitung und
Referenz; Contracts-Übersicht fehlt (an P33 gebunden, vertagt);
keine „Ersten Adapter in 30 Minuten“-Anleitung.

**Agenten:** gut versorgt (AGENTS.md, Skills, `check:context`). Risiko ist
umgekehrt Doku-Wildwuchs: 45 Seiten in `docs/` erhöhen Stale-Kontext.

## 3. Stand der Technik (mit Quellen)

Quellenlage: Primärquellen sind direkt abgerufen (diataxis.fr, Material-Blog,
vitepress.dev, docs.immich.app, home-assistant.io). Vergleichsartikel zu
Doku-Generatoren sind überwiegend Vendor-/SEO-Texte und zählen hier nur als
Meinung. Nicht verifiziert wurde, welche Node-Mindestversion VitePress/Starlight/
Docusaurus verlangen — die abgerufenen Seiten nennen sie nicht.

### 3.1 Diátaxis

[diataxis.fr](https://diataxis.fr/) unterscheidet vier Dokumentarten nach
Nutzerbedürfnis: **Tutorials** (Lernen durch Tun), **How-to-Guides** (Ziel
erreichen), **Referenz** (neutrale Fakten) und **Erklärung** (Verstehen,
Kontext). Zwei Achsen: Tun vs. Wissen, Lernen vs. Arbeiten
([Start here](https://diataxis.fr/start-here/)). Wichtig für uns: Diátaxis ist
**iterativ** gedacht — Doku ansehen, eine kleine Verbesserung wählen,
wiederholen — und schreibt keine Werkzeuge vor. Canonical hat es als Grundlage
seiner Doku übernommen
([Canonical-Blog](https://canonical.com/blog/diataxis-a-new-foundation-for-canonical-documentation)).
Folge: Wir brauchen keine Neuschreibung, sondern eine **Zuordnung jeder
vorhandenen Seite zu genau einer Art** und das Schließen der Lücken
(Tutorial fehlt komplett).

### 3.2 Docs-as-Code und Drift

Übereinstimmend (Sammlung aus
[Fern](https://buildwithfern.com/post/docs-linting-guide),
[Mintlify](https://www.mintlify.com/library/documentation-linting),
[Sourcegraph](https://sourcegraph.com/blog/documentation-as-code) — Vendor-Meinung):

- Interne Link-Prüfung pro PR, externe Links nur geplant (Laufzeit).
- **Referenz aus der Quelle der Wahrheit generieren**, nicht von Hand pflegen;
  generierte Referenz braucht trotzdem Kuratierung.
- Link-/Stil-Checks reichen nicht: stale Aussagen (Funktion, Flag, Endpunkt
  existiert nicht mehr) fängt nur ein Abgleich Doku↔Code.
- Code-Beispiele müssen im CI laufen, sonst sind sie „noch ein Ort für Stale-Inhalt“.

Das Repo ist hier bereits weiter als der Durchschnitt (`check:context`,
`check:adapter-matrix`, Inventar-Spec). Offene Lücke ist die **Ausführung der
Doku-Beispiele** und die **generierte CLI-/Config-Referenz**.

### 3.3 Doku-Werkzeuge

| Werkzeug | Basis | Befund (Quelle) |
|---|---|---|
| **VitePress** | Vite + Vue; Markdown → statisches HTML | „Static site generator for fast, content-centric websites“, Vite-Plugins nutzbar, Vue-Komponenten im Markdown ([vitepress.dev](https://vitepress.dev/guide/what-is-vitepress)) |
| **Starlight** | Astro | Doku-Theme als Astro-Integration, Suche/i18n/Sidebar-Guides, Markdown/MDX/Markdoc ([starlight.astro.build](https://starlight.astro.build/getting-started/)) |
| **Docusaurus** | React + MDX | Versionierung und i18n eingebaut ([docusaurus.io](https://docusaurus.io/docs)); in Vergleichen als größte Community, aber schwergewichtigste Basis (Meinung: [pkgpulse](https://www.pkgpulse.com/guides/docusaurus-vs-vitepress-vs-nextra-vs-starlight-2026)) |
| **MkDocs Material** | Python | **Wartungsmodus seit 05.11.2025**, keine neuen Features; kritische Fixes bis **05.05.2027**; Nachfolger Zensical liest `mkdocs.yml`, unterstützt aber erst eine Teilmenge der Plugins ([Material-Blog](https://squidfunk.github.io/mkdocs-material/blog/2025/11/05/zensical/)). Ein Suchtreffer nannte 05.11.2026 — die Primärquelle sagt 2027 und gilt |
| **GitLab-Wiki** | in GitLab | Nicht abgerufen/geprüft; Wiki liegt in einem **separaten Git-Repo** neben dem Projekt, damit getrennt von Code-MRs und Gates — das ist der Drift-Fehlermodus, den wir vermeiden wollen (Einschätzung, keine Quelle) |

### 3.4 In-App-Onboarding

Sammlung aus Praxisleitfäden (Meinung, keine PWA-spezifische Quelle gefunden;
z. B. [Smashing Magazine](https://smashingmagazine.com/2017/02/user-onboarding-empty-states-mobile-apps),
[Fluent 2](https://fluent2.microsoft.design/onboarding/),
[Produktly](https://produktly.com/guides/how-to-use-empty-states-for-onboarding)):

- Der **leere erste Bildschirm ist die Onboarding-Fläche**: Anweisung + sichtbarer
  Handlungsknopf + ggf. Beispielinhalt.
- Beispielinhalt **deutlich als Beispiel** markieren.
- Touren kurz (≤ 3–5 Schritte), überspringbar, wiederaufrufbar; Checklisten ≤ 5–7 Punkte
  mit Fortschritt; Tooltips einmalig und sofort schließbar.
- **Onboarding-Leerzustand ≠ Filter-Leerzustand** (letzterer braucht „Filter
  zurücksetzen“ — die PWA trennt beides bereits: `Dashboard.tsx:329`).
- Fokusführung und Tastaturbedienung testen.

### 3.4a Quickstart-Muster vergleichbarer Self-Hosted-Tools

- **Home Assistant** ([Onboarding](https://www.home-assistant.io/getting-started/onboarding/)):
  genau ein Browser-Fluss — Adresse öffnen → Besitzerkonto oder Backup-Restore →
  Ort/Zeitzone → gefundene Geräte prüfen → **Finish** landet auf einem
  funktionierenden Dashboard. Erfolg ist am Ende sichtbar, kein Terminal nötig.
- **Immich** ([Install](https://docs.immich.app/install/requirements)): lineare
  Seitenfolge Voraussetzungen → Installationsweg (Docker Compose empfohlen,
  weitere Wege) → Konfiguration → „Post installation“ → Upgrade. Eine
  empfohlene Standardroute, Alternativen nachgelagert.
- **Allgemein** (Vendor-Texte, Meinung): Quickstart = eine verifizierte
  Erfolgsstelle, ein Schritt = eine Aktion mit erwarteter Ausgabe,
  „Time to first success“ als **Median-Zeit bis zum ersten fehlerfreien
  Ergebnis** messen, Zeitbudget kalt gemessen
  ([developer-quickstart-guide](https://www.claudemarket.ai/skills/samber/developer-relations-skills/developer-quickstart-guide)).
  Syncthing wurde nicht untersucht (keine Treffer).

Übertragbar: **eine Standardroute**, am Ende ein **sichtbares Erfolgssignal**,
Rest als Alternativen. AncientVoid hat heute die Route, aber kein Signal.

## 4. Optionsbewertung

Bewertung 1 (schlecht) bis 5 (gut); Gewichtung gleich. „Drift“ = Schutz gegen
Auseinanderlaufen von Doku und Code.

| Option | Aufwand | Wartbarkeit | Stack-Passung | Drift-Schutz | Local-first/self-host | Σ |
|---|---|---|---|---|---|---|
| **A: Markdown im Repo + Diátaxis-Ordnung + Gate-Checks, keine Site** | 5 | 5 | 5 (kein Neues) | 5 (läuft in `check:context`) | 5 | **25** |
| **B: A + VitePress (optional, später)** | 3 | 4 | 4 (Vite da, Vue neu) | 4 | 5 | 20 |
| C: Starlight | 3 | 3 | 2 (Astro neu) | 4 | 5 | 17 |
| D: Docusaurus | 2 | 3 | 2 (React/MDX, eigene Toolchain) | 4 (`onBrokenLinks` nicht verifiziert) | 5 | 16 |
| E: MkDocs Material | 3 | 1 (Wartungsmodus, Python-Toolchain) | 1 | 3 | 5 | 13 |
| F: GitLab-Wiki | 4 | 2 (getrenntes Repo) | 3 | 1 | 4 (an GitLab gebunden) | 14 |

Anmerkung: Die Punkte sind Einschätzung, nicht gemessen. A schlägt B nicht,
weil B schlecht wäre, sondern weil eine Site das **Problem nicht löst** (die
Lücken aus §2 sind Inhalt und Drift, nicht Darstellung) und eine neue
Abhängigkeit (Vue/Astro/React) mit ADR und Pflege kostet.

## 5. Empfehlung

**Stufenmodell, Stufe 1 verbindlich, Stufe 2 nur per Entscheidung.**

1. **Inhalt vor Werkzeug.** Markdown bleibt in `docs/` (flach, AGENTS.md-Regel),
   keine Site. Jede lebende Seite bekommt im Kopf genau **eine Diátaxis-Art**;
   `check:context` prüft das. Neue Seiten: ein **Tutorial** („Erste 15 Minuten:
   vom Klon bis zum Handy-Freigabe-Tipp“), wenige **How-tos**, Referenz
   **generiert** (hubctl-Befehle aus `usage`, Config-Felder aus dem Schema,
   Exit-Codes des Wizards aus dem Skriptkopf).
2. **Drift strukturell schließen:** Frischhalte-Map um die neuen Seiten erweitern;
   Generierte Referenz mit Check „committeter Stand = frisch generierter Stand“;
   Code-Blöcke des Tutorials als ausführbarer Test gegen den Demo-Hub; Funktionen
   in Tutorial/How-tos referenzieren Inventar-IDs statt Funktionen zu beschreiben.
3. **In-App-Onboarding klein halten:** Der sichtbare Leerzustand der Übersicht
   wird zum Einstieg (ein Knopf „Probe-Session mit dummy“, Link auf das
   Tutorial, Hinweis auf Freigaben) und die Token-Eingabe bekommt eine
   Kopplung ohne CLI-Zwang. Beides ist **PWA-Arbeit und gehört in die
   Umsetzungs-Aufgaben des Epics, nicht in diese Planung.** Keine Tour, kein
   Pflicht-Overlay.
4. **Stufe 2 (optional): Site-Spike.** Erst wenn Stufe 1 grün ist und ein
   echter Bedarf besteht (Suche über >40 Seiten, öffentliche Doku). Dann
   VitePress zuerst prüfen (Vite vorhanden, Markdown unverändert,
   Build lokal), **mit ADR** und Rückbaupfad; ausdrücklich ohne gehostetes SaaS.
   MkDocs Material scheidet wegen Wartungsmodus aus.
5. **VoidWarden:** eigenes Repo, eigene Doku, kein gemeinsames Doku-Repo.
   AncientVoid besitzt den Gesamt-Einstieg (Tutorial endet mit „Brauche ich
   VoidWarden?“-Weiche); VoidWarden besitzt Kiosk-/Board-Anleitungen und
   spiegelt das Tutorial-Ende (Schwester-Epic im VoidWarden-Repo).

## 6. Time-to-first-Success-Pfad (TTFS)

Definition: Zeit vom frischen Klon bis zum **ersten vom Handy gesteuerten
Agenten** (hier: erste Freigabe auf dem Handy entschieden). Messung als
Messlauf nach [`messlauf`](../.claude/skills/messlauf/SKILL.md), ablegbar
unter `docs/messlauf/`.

| Meilenstein | Beobachtbares Signal | Ziel (kalt, Node/npm/git vorhanden, dummy) |
|---|---|---|
| M0 Klon fertig | `git clone` beendet | — (Startuhr) |
| M1 Hub läuft | `setup.sh` Exit 0, `/api/ready` grün | ≤ 5 min |
| M2 Handy erreicht Hub | PWA lädt auf zweitem Gerät über Tailscale | ≤ 10 min |
| M3 Handy gekoppelt | Token auf dem Handy gesetzt, Übersicht sichtbar | ≤ 12 min |
| M4 Erste Session läuft | Session (`dummy`) in der Übersicht, Events im Tail | ≤ 14 min |
| M5 Erste Steuerung vom Handy | Nachricht an laufende Session gesendet, Event im Verlauf sichtbar | ≤ 15 min |
| M5b (nur Harness mit Freigaben) | Approval entschieden, Audit-Event, Agent läuft weiter | getrennt ausgewiesen (K1) |

Die Zielwerte sind **Hypothesen**, nicht gemessen; der erste Messlauf setzt
die Basis, danach gilt ein Ratchet (Ziel darf sinken, nicht steigen).
M2/M3 (Tailscale-Konto, Geräteinstallation) sind nicht vollständig
automatisierbar: Der Messlauf läuft **ohne Tailscale** auf Loopback mit zweitem
Browserprofil (Mobil-Viewport), der echte Handy-Schritt wird einmal manuell mit
Stoppuhr protokolliert und als solcher benannt. Mit echtem Provider (statt
dummy) kommt eine eigene, getrennt ausgewiesene Zeit dazu — Anmeldung beim
Provider ist nicht Teil der Messlatte.

**Korrektur 13.11.2026:** Der erste Entwurf nannte als M5 „erste Freigabe“. Der
`dummy`-Adapter (Wizard-Default) hat `toolGate: "none"` und erzeugt keine
Freigaben; M5 ist deshalb die Nachricht vom Handy, die Freigabe M5b.

## 7. Vorbehalte

- Zielwerte (≤ 15 min) und Bewertungspunkte sind Einschätzung.
- Kein Nutzertest mit Dritten durchgeführt; die Lücken E1–E7 stammen aus
  Code-/Dokumentenlesung, nicht aus Beobachtung neuer Nutzer.
- Keine Messzahl dieses Berichts ist ein K1–K10-Wert; keine bestehende
  Messlatte misst Onboarding (analog P53).
