# Herdr-Evaluation — Ersatz oder Ergänzung für den mobile-hub?

**Datum:** 2026-10-26 · **Anlass:** „Wäre es sinnvoll, Herdr in den mobile-hub
zu übernehmen bzw. die Logik dahinter zu ersetzen? Auf den Hosts soll dann nur
herdr laufen, Steuerung über SSH + Tailscale von jedem Device.“

## TL;DR

**Ersetzen: nein. Das würde das Kernprodukt (Handy-Steuerung mit Push, Sprache,
Offline, strukturierten Events) gegen einen Terminal-Multiplexer tauschen und
genau die Fähigkeiten opfern, die mobile-hub einzigartig machen. Die Ressourcen-
und Zuverlässigkeitsthese hält der Prüfung nicht stand: mobile-hub trennt
Hub-Prozess und Terminal-Server (tmux) — Herdr vereint beides in *einem*
Prozess, dessen Crash/Update alle Panes kostet.**

**Sinnvoll ist das Gegenteil von Ersetzen: selektive Ideen übernehmen (jetzt)
und Herdr als optionalen Runner-Layer evaluieren (Spike).** Ein
`adapter-herdr`, der über `herdr --machine <id>` (JSON-CLI) bzw. die
Socket-API mit Hosts spricht, auf denen bewusst *kein* voller Hub laufen soll,
passt sauber in die bestehende Adapter-Architektur — braucht aber ein ADR,
weil Herdr Screens liest statt strukturierter Events.

---

## 1. Was Herdr ist (Stand: v0.9.5, Oktober 2026)

- Open Source (Apache 2.0), Rust/Ratatui, Hersteller Herdr, Inc.
  ([herdr.dev](https://herdr.dev/), [GitHub](https://github.com/herdrdev/herdr)).
- Reife-Signale: ~44.600 GitHub-Stars, 1,64 Mio. Installationen, 1.789
  Community-Plugins, 22 erkannte Agent-CLIs. Gleichzeitig: **pre-1.0** und
  schnell beweglich (Socket-API hat bereits öffentliche Methoden entfernt,
  z. B. die Pane-Graphics-API).
- Architektur: **Client/Server**. Ein Hintergrund-Server hält echte PTYs
  („Panes“) mit Shells und Agenten; Clients attachen/detachen. Panes gruppieren
  in Tabs/Workspaces; der Server erkennt Agent-Status (working/blocked/idle/
  done) durch Lesen des Terminalinhalts.
- **Agent-Automation**: CLI und Socket-API sind dieselbe Fläche — Panes
  erzeugen/splitten, `pane run/send-keys/wait-output`, `agent start/prompt/
  wait/read/send-keys` ([Doku](https://herdr.dev/docs/agent-automation/),
  [Socket-API](https://herdr.dev/docs/socket-api/), inkl. `events.subscribe`
  und `session.snapshot`).
- **Multi-Machine über SSH**: `herdr machine add workbox` — jede Machine
  behält ihren eigenen Herdr-Server; der Client bündelt; keine Secrets im
  Profil, Auth bleibt komplett bei OpenSSH
  ([Doku](https://herdr.dev/docs/connecting-machines/)). Über Tailscale
  funktioniert das wie jeder SSH-Transport (Tailnet-DNS/-IP als Target).
- **Persistenz-Pfade**
  ([Doku](https://herdr.dev/docs/session-state/)): Detach/Reattach = Prozesse
  leben weiter (stärkster Pfad). Server-Restart = **Prozesse weg**, Layout wird
  restauriert + „native agent session restore“ startet unterstützte Agenten
  via deren Resume-Befehl neu (`claude --resume`, `codex resume`, …; auch
  Hermes, Pi, OpenCode). Live-Handoff über Server-Austausch ist **explizit
  experimentell** und opt-in.
- **Kein Mobile-/Web-Client**: Herdr ist ein TUI für macOS/Linux/Windows.
  „Von jedem Device“ heißt: jedes Device mit Terminal + SSH-Client. „Herdr
  Cloud“ (gleiche Machines ohne SSH-Setup) ist angekündigt, geschlossen
  (Waitlist) — ob self-hostbar, unbekannt.

## 2. Architektur-Vergleich

| Aspekt | mobile-hub | Herdr |
|---|---|---|
| Persistenz-Layer | tmux (eigener, getrennter Prozess pro Host) | Herdr-Server (ein Prozess hält PTYs **und** Steuerung) |
| Hub/Steuerung | Node-Hub (`uacc-hub`, systemd) mit REST/WS + PWA | Client-TUI + CLI/Socket lokal oder über SSH |
| Agent-Anbindung | 11 Adapter mit **strukturierten Events** (stream-json, ACP, JSONL: Turns, Diffs, Budgets, Tools) | 22 erkannte CLIs, Status via **Screen-Lesen** (detection), alternativer Screen-History-Scroll |
| Mobile | PWA: Push (ADR-0026), Diktat/STT (K6), Offline-Cache (K10), Einhand-UI | — (Terminal-App nötig; kein Web/Mobile) |
| Approval/Freigaben | Strukturierte Approval-Events + Hub-Policy (`permissionPrompts: hub`), Gatekeeper (ADR-0024) | `blocked`-Erkennung + `agent send-keys` (Tasten an den Dialog) |
| Historie/Audit | EventStore: JSONL + Snapshots, aus Zustand rekonstruierbar (K7), Suche, Budgets/Kontingent | Screen-History (opt-in, off by default wegen Secrets), Snapshots = Layout |
| Multi-Host | Fleet: pro Host ein Hub, Heim-Hub aggregiert (ADR-0017); Deploy via `fleet-deploy.sh` | `machine add` über SSH; ein Client, viele Server |
| Recovery | Hub-Restart übernimmt laufende tmux-Züge (Adoption); K7-Recovery aus EventStore | Server-Restart: Panes weg, Agent-Resume über offizielle Integrationen |
| Lizenz/Reife | Eigenes Solo-Projekt, eigene E2E-Gates | Apache 2.0, pre-1.0, große Community, schnell brechende APIs |

## 3. Deine Thesen im Detail

### 3.1 „Herdr funktioniert im Endeffekt wie unser mobile-hub“ — teilweise

**Verwandt ist die Persistenz-Idee**: Agenten in echten Terminals überleben
das Loslassen des Clients. Genau das tut mobile-hub schon heute mit tmux-
Workern — Herdr erfindet das Rad nicht anders, es ist dasselbe Rad (PTYs im
Hintergrundprozess), nur mit Status-Erkennung und hübscher TUI obendrauf.

**Nicht vergleichbar ist die Datenqualität**: mobile-hub-Adapter bekommen
strukturierte Events (Turn-Ergebnisse, Tool-Aufrufe, Diffs, Kosten) direkt
vom CLI-Protokoll. Herdr liest den Bildschirm. Für „welcher Agent ist
blocked?“ reicht das; für mobile-hubs Kernversprechen (Auditierbare Historie
K7, Budgets/Kontingente, Diff-Approvals mit Policy, Suche über Verläufe)
ist Screen-Text ein deutlicher Rückschritt.

**Und nicht vergleichbar ist der Zugang**: mobile-hub ist exakt für das
Handy gebaut (Push im Sperrbildschirm, Diktat, Offline, Einhand-Dock).
Herdr hat dafür schlicht nichts — und der wichtigste mobile-hub-Use-Case
(„Agent antwortet, Handy vibriert, Daumen entscheidet“) würde bei reinem
SSH+TUI vollständig wegfallen.

### 3.2 „Zuverlässiger“ — spricht mehr dagegen als dafür

- **Prozess-Topologie**: Bei mobile-hub sind Hub-Prozess und Terminal-Server
  **getrennt** (tmux). Stürzt der Hub oder wird er aktualisiert, laufen die
  Züge weiter und werden adoptiert (dokumentiert in `docs/fleet.md`:
  „Neustart stoppt keine Session; laufende Züge werden übernommen“). Bei
  Herdr leben **alle Panes im Herdr-Serverprozess**: Server-Crash, Server-
  Update oder Reboot kostet alle Prozesse — der Live-Handoff, der das lösen
  soll, ist offiziell experimentell. tmux ist außerdem ein extrem
  abgehärteter, unabhängiger Prozess.
- **Restore nach Reboot**: beide landen bei „Agenten mit `--resume` neu
  starten“ — mobile-hub hat das (P5 Handoff/Recovery) genauso wie Herdrs
  native session restore. Unterm Strich Parität, kein Herdr-Vorteil.
- **Battle-Testing**: Hier gewinnt Herdr klar (1,6 Mio. Installationen gegen
  Solo-Projekt). Aber mobile-hub hat eine disziplinierte E2E-/Gate-Kette,
  837 Unit/Integration-Tests und null offene Bugs — die Zuverlässigkeitslücke,
  die Herdr schließen soll, ist im Repo nicht sichtbar. **Konkret:** Wenn dir
  etwas Spezifisches unzuverlässig erscheint, ist das ein `bug-report`-Fall —
  Ersatz ist dafür das falsche Werkzeug.
- **Stabilität der API**: Herdr entfernt öffentliche Socket-Methoden zwischen
  0.9.x-Versionen und ist pre-1.0. Wer darauf baut, rennt einem schnellen
  Upstream hinterher.

### 3.3 „Ressourcenschonender“ — plausibel im Detail, aber klein und ungemessen

- Was auf einem Fleet-Host entfiele: der Node-Hub-Prozess (`uacc-hub`) samt
  Adapter-Kindprozessen. Was hinzukäme: der Herdr-Server (Rust, sparsam, aber
  kein Null-Ressourcen-Prozess). tmux läuft heute schon — Herdr ersetzt es,
  spart es also nicht zusätzlich ein.
- Der dominierende Ressourcenverbraucher auf jedem Host sind die **Agent-CLIs
  selbst** (Model-Clients, Node/Python-Runtimes). Die bleiben in jedem
  Szenario identisch.
- Einzige harte Zahl, die wir haben: mobile-hub belegt unter K8-Volllast
  (20 Sessions × 30 ev/s, 604 ev/s gemessen) **169 MB RSS** — Idle real
  weniger. Die zu erwartende Ersparnis pro Host liegt also vermutlich im
  Bereich „weniger als der Lasttest insgesamt verbraucht“. Das ist ein
  Messauftrag, kein Architekturwechsel: **1-Stunden-Messlauf auf einem
  Fleet-Host (Idle-RSS/CPU: Hub+tmux vs. herdr-server) schreiben**, bevor
  irgendwer auf Basis dieser These Systeme umbaut.
- Ehrlicherweise: Wenn du einen **schwachen Kleinst-Host** hast, auf dem der
  Node-Hub fühlbar stört, ist das ein Argument für den Runner-Layer-Spike
  (Option B unten) — für genau diesen Host, nicht für die Flotte.

### 3.4 „SSH + Tailscale von jedem Device“ — Device-Matrix entscheidet

| Device | mobile-hub (PWA über `tailscale serve`) | Herdr (SSH/Tailscale) |
|---|---|---|
| Eigene PCs/Laptops | ✅ Browser | ✅ nativer Client (beste Experience) |
| Handy (gesperrt, unterwegs, einhändig) | ✅ Push, Offline-Cache, Diktat | ❌ Terminal-App + TUI-Bedienung, kein Push |
| Tablet mit Tastatur | ✅ | ⚠️ geht (Termux/Blink), kein Push |
| Fremdes Gerät (kein Install) | ✅ Browser + Tailnet | ❌ braucht Client-Install + Key |

Auf Geräten **mit Tastatur** ist Herdrs Zugang äquivalent oder angenehmer
(ein Binary, keine eigene Server-Logik pro Client). Auf dem Handy — dem
Namensgeber des Projekts — verliert die These komplett. „Von jedem Device“
gilt heute schon für die PWA, mit deutlich niedrigerer Einrichtungs-Hürde.

## 4. Verlustbilanz bei einer Ersetzung

Was beim Ersetzen der mobile-hub-Logik durch Herdr **wegfällt** (alles gebaut
und im Alltag erprobt):

- Push-Benachrichtigung bei Approval/Rückfrage (ADR-0026) — der Kern des
  „Handy-Command-Center“-Versprechens
- Diktat/Sprachsteuerung inkl. lokaler STT (K6, ADR-0028) und Text-Commands (P9)
- Offline-Session-Stand auf dem Handy (K10)
- Strukturierte EventStore-Historie, Audit, Suche, Budget-/Kontingent-Transparenz
- Diff-Approvals mit Hub-Policy und Gatekeeper (ADR-0024) — Herdrs `blocked` +
  `send-keys` ist Tastendruck-Hoffnung, keine Policy
- Fleet-Pairing per QR, Desktop-Companion (P11), Media-Jobs (P10.5),
  MCP-Gateway, Backup/Restore (P12)
- 11 Adapter mit Verhaltens-Feinsteuerung (Modell-Pins, Sandbox-Modi,
  `permissionPrompts`, stuck-Turn-Timeouts) — Herdr startet die CLIs
  unverändert in Panes

Dem steht gegenüber: ein sehr guter Terminal-Multiplexer mit Agent-Status,
den man auf dem PC nutzen **kann**, ohne mobile-hub zu ersetzen.

## 5. Optionen und Empfehlung

### Option A — Herdr ersetzt mobile-hub ❌ (nicht empfohlen)
Kostet das Kernprodukt für eine Ressourcen-Ersparnis, die ungemessen und
vermutlich klein ist, und für eine Zuverlässigkeitsthese, deren Prüfung
(Prozess-Topologie) eher für den Status quo spricht. Alles Fleet-/Mobile-
bezogene wäre Neubau *neben* Herdr — dann hast du zwei Projekte statt einem.

### Option B — Herdr als Runner-Layer / Adapter (Spike, interessant) 🟡
Auf Hosts, die keinen vollen Hub verdienen (schwache Kisten, ephemeral),
läuft nur `herdr-server`; der Heim-Hub spricht über SSH
`herdr --machine <id> agent list/prompt/wait/read --json` bzw. die Socket-API
(`events.subscribe`, `session.snapshot`, `agent.*`). Der Hub bleibt Mobile-
Frontend + EventStore + Policy; Herdr wird zur Worker-Runner-Alternative neben
tmux — die Runner-Schnittstelle (`@uacc/workers`) ist genau dafür gedacht.
**Vorher klären (ADR-pflichtig):**
- Wo kommen strukturierte Events her? Screen-Parsing liefert keine Diffs/
  Budgets/Tool-Calls in Contract-Qualität → Sessions auf Herdr-Hosts hätten
  geringere Event-Tiefe („Fail loud“: sichtbar machen, nicht verstecken).
- Approval-Policy: Der Hub-Gatekeeper greift nicht in Herdr-Panes; Ansatz
  wäre `agent wait --until blocked` + Reading + `send-keys` — ehrlich als
  „Tasten-Simulation, nicht Policy“ labeln.
- Upstream-Volatilität: CLI-Pinning pro Host, Adapter-Testkit-Suite muss
  gegen eine echte Herdr-Instanz laufen.
**Aufwandsschätzung:** Spike 2–4 Tage (Adapter-Gerüst + Testkit + ein Host),
seriöser Ausbau eher eine Epic (P17-Kandidat, mit Premortem).

### Option C — Ideen aus Herdr übernehmen (jetzt, gering) ✅
Unabhängig von B lohnen sich drei Gedanken als ADR-/Epic-Anregungen:
1. **Stabile Pane-/Session-Referenzen** für Worker (Herdrs
   `HERDR_PANE_ID` + `pane.report_agent_session`) — mobile-hub hat Session-
   Adoption; ein stabiler Umgebungs-Marker je Worker könnte Recovery-Pfade robuster
   machen (K7).
2. **`agent wait`-Semantik** (server-owned, pinned occupant, keine Doppel-
   Submission bei Timeout) als Muster für eigene Wait-Operationen.
3. **Offizielle Resume-Referenzen**: Herdr sammelt pro Agent den Resume-
   Befehl (`claude --resume <id>` …) über „offizielle Integrationen“. Die
   Liste ist auch für mobile-hubs Adapter ein guter Katalog, um Resume-Pfade
   einheitlich zu hinterlegen.

### Empfehlung
1. **C sofort** (kostet fast nichts, passt in bestehende Strukturen).
2. **B als begrenzter Spike auf genau einem Host**, wenn es einen konkreten
   schwachen Host gibt — mit dem Messlauf aus §3.3 als Abbruchkriterium
   („kein messbarer Vorteil → Spike verwerfen“).
3. **A ablehnen.** Die eigentlichen Motive „Zuverlässigkeit“ und „Ressourcen“
   sind besser über den Produktionsreife-Report adressiert: P12-Dauerlauf
   (T12.5), Update/Rollback-Nachweis (T12.1) und eine gemessene Idle-Bilanz
   der Hosts — alles ohne Architekturwechsel.

Falls du Herdr trotzdem täglich auf dem PC nutzen willst: Das geht nebenbei,
ohne Konflikt — mobile-hub-Worker (tmux) und Herdr-Panes können auf
verschiedenen Hosts (oder sogar getrennten Sessions desselben Hosts)
koexistieren. Nur *im selben Terminal* sollten Agenten nicht doppelt
verwaltet werden (ein Orchestrierer pro Agent-Prozess).

## 6. Quellen

- [herdr.dev — Landing](https://herdr.dev/) (Version v0.9.5, Apache 2.0,
  Stars/Installs, Feature-Ansprüche, „Herdr Cloud“-Waitlist)
- [Herdr-Doku: Connecting machines](https://herdr.dev/docs/connecting-machines/)
  (SSH-Multi-Machine, Auth-Modell, Reconnect-Verhalten)
- [Herdr-Doku: Agent automation](https://herdr.dev/docs/agent-automation/)
  (CLI-Primitives, blocked-Semantik, Alternate-Screen-Reads)
- [Herdr-Doku: Session state and restore](https://herdr.dev/docs/session-state/)
  (Was überlebt welchen Fall; native Resume-Liste; Handoff experimentell)
- [Herdr-Doku: Socket API](https://herdr.dev/docs/socket-api/) (Methoden,
  `events.subscribe`, entfernte Pane-Graphics-API = API-Volatilität)
- [GitHub: herdrdev/herdr](https://github.com/herdrdev/herdr)
- Repo-intern: `docs/fleet.md` (Deploy/Adoption), `docs/adr/0017` (Fleet),
  `docs/messlauf/2026-09-24-p12-lokale-evidenz.md` (K8: 169 MB RSS @ 604 ev/s),
  `hub.config.json` (11 Produktiv-Adapter), Epics P5/P6 (Recovery/Fleet).

---
*Externe Inhalte wurden als Daten behandelt und belegt verlinkt; Herdr-Infos
nach Stand der Doku v0.9.5 — vor einer Option-B-Entscheidung aktuelle
Changelogs gegenlesen.*
