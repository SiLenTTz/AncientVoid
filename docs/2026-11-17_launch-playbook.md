# Launch-Playbook: README, Repo und Reichweite — 17.11.2026

Eingefrorene Analyse (Snapshot) zum Nutzerauftrag vom 17.11.2026: README und
GitHub-Repo so aufstellen, dass AncientVoid maximale Aufmerksamkeit und
maximalen Nutzen erzeugt („Richtung 100k Stars“). Entscheidungen des Nutzers:
Lizenz AGPL-3.0 plus Kauflizenz ([ADR-0086](adr/0086-lizenz-agpl-mit-kauflizenz.md)),
Hub-Plattformen Linux und Windows nativ, **README jetzt, Launch erst nach P61**
(englische Oberfläche).

## 1. Ausgangslage

| Merkmal | Stand 17.11.2026 |
|---|---|
| Stars / Forks | 2 / 0 (öffentlich seit 16.11.2026) |
| Beschreibung | „The last coding tool you will install“ (ohne Suchbegriffe) |
| Topics, Homepage, Social Preview, Release | keine, leer, Standardbild, keiner |
| Lizenz | PolyForm Noncommercial (nicht OSI) → Wechsel vorgeschlagen |
| UI / Screenshots | deutsch (P61 Planungsentwurf) |
| Install-Weg | `git clone` + `./setup.sh`, kein npm-Paket, kein Docker-Image |

Wettbewerb mit Handy-Steuerung von Coding-Agenten (Stand der Recherche;
Sternzahlen schwanken je Quelle):

| Projekt | Lizenz | Reichweite | Ansatz |
|---|---|---|---|
| Paseo | Apache-2.0 | ~23k Stars in ~12 Monaten (lokaler Vergleich 05.11.) | Daemon + native Apps, Relay für Kopplung |
| T3 Code | MIT | ~20k, mehrfach GitHub-Trending | Desktop/Web/Mobile-Clients |
| Orca | MIT | Desktop-IDE + Mobile-App | Worktree-Orchestrierung |
| Happy | MIT | App-Store-Bewertungen als Sozialbeweis | E2E-verschlüsseltes Relay |
| CloudCLI | AGPL-3.0 | Trendshift-Badge | Web-UI, optional Cloud |

**Einordnung:** 100k Stars ist die Liga der größten Entwicklerwerkzeuge.
Selbst der stärkste direkte Wettbewerber steht nach einem Jahr bei rund einem
Viertel davon. Eine README bringt keinen Traffic, sie **wandelt Besucher in
Stars und Nutzer um**. Traffic entsteht durch Launches (Show HN, Reddit),
wiederkehrende Anlässe und Trending, und Trending misst
**Sterne pro Zeit**, nicht die Gesamtzahl. Realistische Meilensteine:
1k → 5k → 20k, jeder an einen Launch-Anlass gebunden.

## 2. Was in dieser Runde umgesetzt ist

- **README neu** (290/300 Zeilen): Claim, Hero, sechs Differenzierungsmerkmale,
  Screenshots, Quickstart mit Handy-Weg in drei Schritten, Feature-Tabelle,
  Agentenliste plus geprüfte Matrix (eingeklappt), Mermaid-Architektur,
  Messlatten, Sicherheitsmodell, Plattformen, FAQ „wie unterscheidet es sich?“.
- **Hero/Social Preview** `apps/site/assets/social-preview-01.jpg`
  (1280×640, `npm run readme:hero`, reproduzierbar).
- **Lizenzwechsel** als eigener PR (ADR-0086, `LICENSE`, SPDX in allen
  `package.json`, Lizenzklausel für Beiträge in `CONTRIBUTING.md`).
- **Repo-Metadaten:** Beschreibung mit Suchbegriffen, 20 Topics und Homepage
  sind vorbereitet (§6). Der Agenten-Account hat nur WRITE-Rechte, setzen muss
  sie deshalb der Repo-Owner.

Angewandte README-Regeln: Der erste Bildschirm beantwortet *was, für wen,
warum anders* und zeigt ein Bild. Quickstart in höchstens drei Befehlen. Fünf
Badges, kein Statuslog, keine veralteten Daten. Tiefe in `<details>`.
Ehrlichkeit vor Superlativen: „no cloud“ ist wahr, „no relay“ wurde bewusst
nicht behauptet (Tailscale nutzt bei Bedarf eigene DERP-Relays).

## 3. Launch-Gates (alle grün vor Show HN)

| # | Gate | Warum | Wer |
|---|---|---|---|
| G1 | Lizenz-PR gemergt, Zustimmung aller Commit-Autoren, CLA-Mechanismus aktiv (z. B. CLA Assistant) | Lizenzdebatte würde jeden Launch-Thread kapern | Rechteinhaber |
| G2 | P61 fertig: englische UI; danach `scripts/readme-screenshots.mjs` mit `en`-Locale und `npm run readme:hero` neu | Deutsche Screenshots kosten bei internationalem Publikum die meiste Konversion | Agenten (Epic P61) |
| G3 | Demo-Video 60–90 s unter dem Hero (Skripte 02 und 04 in `docs/videos/`) | Bewegtbild schlägt Screenshots; Show HN verlangt „ausprobierbar“, das Video zeigt es | Nutzer (Aufnahme) |
| G4 | Release `v0.1.0` mit Notes | Watcher-Benachrichtigung, Release-Feeds, „Latest release“-Signal | Agenten |
| G5 | macOS-Smoke-Test des Hubs | Viele Nutzer von Claude Code und Codex arbeiten auf macOS; „untested“ kostet sie | Nutzer oder Community |
| G6 | Social Preview hochgeladen, Discussions an, 5–10 echte `good first issue` | Link-Vorschauen, Ort für Fragen, Einstieg für Beitragende | Nutzer (Settings) |

**Video in der README:** Video- und GIF-Dateien sind im Repo rot
(`check:media`). Der Weg ist, das MP4 per Drag & Drop in ein Issue oder einen
PR-Kommentar zu laden und die entstehende
`github.com/user-attachments/assets/…`-URL allein in eine Zeile der README zu
setzen. GitHub rendert sie als Player. Größenlimit für Anhänge beachten.

**Größter Konversionshebel nach G1–G3, eigenes Epic:** ein Install-Einzeiler.
Die Wettbewerber starten mit `npx @cloudcli-ai/cloudcli` bzw.
`npm install -g @getpaseo/cli`. Ein `npx ancientvoid` (Wizard als npm-Paket)
oder ein Docker-Image würde die „erste Session in 2 Minuten“ greifbar machen.
Für Show HN gilt: ausprobierbar ohne Anmeldung. Bei uns erfüllt das
`./setup.sh --adapter=dummy`, das im Post auch so benannt werden sollte.

## 4. Kanäle und Reihenfolge (Wellen statt einem Knall)

Trending belohnt anhaltende Geschwindigkeit. Deshalb in Wellen launchen, und
**jeder große Meilenstein ist ein neuer Anlass** (englische UI, macOS, npx,
iOS-Abnahme).

1. **Welle 0, Soft-Launch (2 Wochen vorher):** 10–20 Leute aus dem Umfeld
   gehen den Quickstart auf frischen Rechnern durch. Jede Hürde wird ein
   Issue und vor dem Launch behoben. Keine Upvote-Bitten (HN-Regel).
2. **Welle 1, Show HN** (Di–Do, 14–16 Uhr MEZ): Titel und erster Kommentar
   siehe §5. Der Autor bleibt den ganzen Tag im Thread und antwortet sachlich.
3. **Welle 2 (+2–3 Tage), Reddit:** r/selfhosted (beste Passung: lokal,
   Tailscale, keine Cloud), r/ClaudeAI, r/LocalLLaMA (lokale Modelle über
   OpenAI-kompatible Endpunkte), r/ChatGPTCoding. Regeln zur Eigenwerbung je
   Sub vorher lesen.
4. **Welle 3, X/Bluesky/Mastodon:** Thread mit Video. Die Communities der
   angebundenen Harnesses (pi, opencode, Hermes, ACP-Ökosystem) markieren,
   denn Integrationen werden gern geteilt.
5. **Welle 4, Listen und Newsletter:** awesome-selfhosted (nur mit
   OSI-Lizenz in der Hauptliste; Aufnahmekriterien wie das Mindestalter des
   ersten Releases vorher prüfen), awesome-claude-code und vergleichbare
   Listen zu Coding-Agenten. Dazu Newsletter für Entwicklerwerkzeuge (z. B.
   Console.dev, Changelog News). Jeweils Existenz und Kriterien vor dem PR
   prüfen.
6. **Optional, Product Hunt:** nur mit fertigem Video und englischer UI.

## 5. Texte (Entwürfe, Englisch)

**Show-HN-Titel** (HN-Grenze 80 Zeichen):

- `Show HN: AncientVoid – self-hosted hub to steer any coding agent from your phone`
- `Show HN: AncientVoid – approve your coding agents' commands from your phone`

**Erster Kommentar des Autors:**

> I built AncientVoid because my coding agents kept stalling on one question
> while I was away from my desk. It's a hub that runs on your own machine and
> supervises Claude Code, Codex, pi, opencode, Copilot CLI, Cursor, Hermes and
> any ACP agent. A PWA on your phone shows every session from every machine
> in one queue. You answer, approve or redirect, and the *running* agent
> continues.
>
> What's different: there is no server of ours. The phone reaches your hub over
> your own tailnet, and there's no account and no telemetry. Sessions you
> started in a terminal can be taken over. Destructive tool calls need a
> passkey, and unanswered approvals fail closed. Every session is an
> append-only event log, so you can `kill -9` the hub and it's back in under
> 3 s.
>
> Try it without any agent account: `./setup.sh --adapter=dummy`. Linux and
> Windows are tested, macOS isn't yet. It's AGPL-3.0. I'd love feedback on the
> setup and on which agents you want next.

**r/selfhosted-Titel:** `AncientVoid: a self-hosted, no-cloud hub to monitor
and approve your AI coding agents from your phone (Tailscale, PWA, AGPL)`

## 6. Repo-Einstellungen (Checkliste)

- [ ] Beschreibung, Topics und Homepage. Braucht Admin- oder Maintain-Rechte;
      mit WRITE antwortet die API mit 404:

  ```bash
  gh repo edit SiLenTTz/AncientVoid \
    --description "Steer Claude Code, Codex, pi & any coding agent from your phone, tablet or PC. Self-hosted, local-first: no cloud, no telemetry." \
    --homepage "https://silenttz.github.io/AncientVoid/" \
    --add-topic claude-code,codex,coding-agents,ai-agents,agentic-coding,ai-coding,pwa,self-hosted,local-first,tailscale,mobile,remote-control,developer-tools,opencode,copilot-cli,cursor,agent-client-protocol,llm,typescript,privacy
  ```
- [ ] Social Preview: Settings → General → Social preview →
      `apps/site/assets/social-preview-01.jpg` (keine API; Nutzer)
- [ ] Discussions an (Q&A, Ideas, Show and tell); Issues bleiben für Bugs
- [ ] `v0.1.0` taggen und Release-Notes schreiben (G4)
- [ ] 5–10 `good first issue`, z. B. „Gemini CLI über ACP-Preset“,
      „macOS-Smoke-Test“, „iOS-Safari-Test“, „Guide-Seite X prüfen“
- [ ] Topic `open-source` ergänzen, sobald der Lizenz-PR gemergt ist
- [ ] Promo-Seite: `og:image` auf das Social-Preview-Bild, CNAME
      `void.securesight.ai` (ADR-0082, Nutzeraufgabe)
- [ ] Ab ~1k Stars: Star-History-Grafik und Stars-Badge in die README
      (vorher wirkt eine kleine Zahl gegen den Besucher)

## 7. Messen

Wöchentlich unter Insights → Traffic: Besucher, Referrer und Clones. Daneben
Stars pro Tag und Issues mit Setup-Bezug. Konversion = neue Stars ÷
eindeutige Besucher. Steigt der Traffic, aber die Konversion nicht, liegt das
Problem in README oder Quickstart, nicht im Kanal.

## 8. Premortem: woran der Launch scheitern würde

| Risiko | Gegenmittel |
|---|---|
| Lizenz wird zum Thread-Thema | G1; README erklärt AGPL in zwei Sätzen |
| „Deutsche UI, nicht für mich“ | G2 vor dem Launch |
| Setup scheitert bei Besuchern | Welle 0; Wizard-Exit-Codes; npx-Epic |
| „Noch ein Wrapper“ | FAQ und Differenzierung: kein Server, Übernahme, Passkey-Freigaben, Crash-Sicherheit |
| Sicherheitsskepsis bei Handy-Steuerung | Sicherheitsmodell oben in der README; `docs/security.md` mittelfristig auf Englisch |
| Einmal-Spitze ohne Folge | Wellen und jeder Meilenstein als neuer Anlass |

## Quellen

Praxisberichte und Ratgeber (Meinung, keine kontrollierten Studien):
[Puter: 10k Stars in zwei Wochen](https://nj.puter.site/oss.html) ·
[Skyvern: Launch so oft wie möglich](https://www.skyvern.com/blog/how-we-got-to-10-000-stars-why-you-should-be-launching-as-often-as-you-can/) ·
[ToolJet: 0 → 10k](https://blog.tooljet.com/zero-to-10-000-stargazers-on-github/) ·
[Lago: erste 1000 Stars](https://getlago.com/blog/how-we-got-our-first-1000-github-stars) ·
[BookStack: Effekte von Hacker News](https://www.bookstackapp.com/blog/9000-stars-and-the-effects-of-hacker-news/) ·
[README-Praktiken (DEV)](https://dev.to/iris1031/github-readme-best-practices-how-to-write-a-readme-that-gets-stars-2gb2) ·
[GitHub-SEO (DEV)](https://dev.to/infrasity-learning/the-ultimate-guide-to-github-seo-for-2025-38kl).
Primärquellen: [Show-HN-Regeln](https://news.ycombinator.com/showhn.html) ·
[GitHub: Social Preview](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview) ·
[awesome-selfhosted Beitragsregeln](https://mintlify.com/awesome-selfhosted/awesome-selfhosted/getting-started/contributing).
Wettbewerber-READMEs (abgerufen 17.11.2026):
[Paseo](https://github.com/getpaseo/paseo) · [Orca](https://github.com/stablyai/orca) ·
[Happy](https://github.com/slopus/happy) · [CloudCLI](https://github.com/siteboon/claudecodeui) ·
[T3 Code](https://github.com/pingdotgg/t3code).
