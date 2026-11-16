# Session-Abbrüche, Hintergrundarbeit und Deployment — Audit 13.11.2026

Eingefrorener Befund, erhoben ab 14:36 UTC (15:36 CET), Peer-Abgleich ergänzt.
Auftrag: Ursachen der Abbrüche und fehlenden Nachrichten ermitteln,
Aktivstatus bei Hintergrundarbeit prüfen, jüngste Aufträge abgleichen.
Dieser Audit ändert kein Produktverhalten und führt kein Deployment aus.

## Umfang und Belegstärke

- Alle **168 lokalen Session-Journale** mit der lokalen SQLite-Projektion
  abgeglichen; Fehlerereignisse seit 10.11.2026 00:00 UTC gezählt.
- Die **35 zuletzt angelegten Sessions** (10.–13.11.) zusätzlich auf ihre
  letzten Nutzeraufträge/Antworten und vorhandenen Worktrees untersucht.
- Die letzten 100 AncientVoid-MRs und offene MRs live über `glab` gelesen.
  Zum Abfragezeitpunkt: **keine offene AncientVoid-MR**.
- Produktiv-Service, User-Journal seit 12.11., Health/Readiness und PWA-Build
  gelesen. Keine Provider-Anfragen ausgelöst, keine Session fortgesetzt.
- Zusätzlich beide gekoppelten Peer-Hubs über ihre vorhandenen Fleet-Zugänge
  lesend abgefragt: **47 Sessions auf gpubox**, **7 auf home-server**.
  Session-Metadaten vollständig, letzte Ereignisse der zehn bzw. sieben
  zuletzt angelegten Sessions gelesen. Tokens nie ausgegeben.
- Vollständige Journalauswertung/Git-Abgleich betreffen `workstation`. Die
  Fremdrepositories und der tatsächlich auf dem Handy gecachte Bundle-Stand
  sind **nicht vollständig geprüft**.
- `idle` bedeutet lediglich Zugende, nicht Auftragsabschluss. Eine letzte
  Assistant-Nachricht kann ein Zwischenbericht sein. Ein Merge beweist
  Integration, nicht vollständige fachliche Abnahme oder Auslieferung.

## 1. Nachrichten werden tatsächlich fälschlich bestätigt

[BUG-0158](../bugs/bug-0158-codex-ablehnung-als-erfolg.md):
`packages/adapters/codex/src/app-server.ts:233` fängt in `steer(prompt)` den
Fehler von `turn/steer` leer ab und liefert anschließend `{ ok: true }`.
Auch `startTurn()` fängt `turn/start` ab; der Aufrufer liefert dennoch Erfolg.

**Deterministischer Repro über die AdapterContext-/WorkerProcess-Naht:**
Ein in-memory JSON-RPC-Worker beantwortet `initialize`, `thread/start` und
den ersten `turn/start` regulär, lehnt dann `turn/steer` mit RPC-Fehler
`-32000` ab. Ergebnis: `ok: true`, **kein** `provider.error`.
Nach simuliertem `turn/completed` lehnt er den nächsten `turn/start` ab:
erneut `ok: true`, diesmal mit `provider.error`. Kein Live-Provider nötig.
Das ist ein reproduzierter Codefehler; die Zuordnung zu einer bestimmten
historisch verlorenen Eingabe bleibt ohne den damaligen RPC-Fehler offen.

Folge: `SessionManager.steerNow()` behandelt den Input als angenommen und
kann seine Idempotenz-ID verbuchen; ein fehlgeschlagener Folgeauftrag kann
dadurch als erfolgreich abgearbeitet erscheinen. Keine automatische
Wiederholung hinzufügen: bei Transport-Timeout kann die Annahme unbekannt sein.

## 2. Hintergrundarbeit zählt nicht zum Aktivstatus

[BUG-0155](../bugs/bug-0155-idle-trotz-hintergrundarbeit.md):
`SessionManager.adapterTurn()` setzt bei `ctx.turn("idle")` unmittelbar
`idle` und schreibt `session.turn_end` mit `code: 0`. Es gibt dort keine
Prüfung auf laufende Provider-Subagenten oder ausgelagerte Hintergrundjobs.
`activeWorkers` erfasst über den Hub gestartete Zug-Prozesse; der persistente
Provider-Prozess ist ausdrücklich kein aktiver Zug (Adapter-Contract).
Prozesse innerhalb dieses Providers oder eine externe systemd-Unit sind
damit nicht automatisch eigene verwaltete Arbeitseinheiten.

**Live-Gegenbeispiel:** P57-Session `a257b3d1…` ist seit
14:33:56 UTC `idle`. Ihr Abschluss nennt einen weiterlaufenden Messlauf
und Watcher; `systemctl --user list-units` meldet die dazu passende
`ttfs-diag2.service` während des Audits als `active/running`.
Das Ende der Chatantwort ist hier kein Ende des beauftragten Arbeitsablaufs.

Den Provider-Prozess pauschal als Arbeit zu zählen wäre ebenfalls falsch:
app-server/ACP bleiben absichtlich zwischen zwei Aufträgen gestartet.
Eine beliebige Zeitverlängerung des `working`-Status löst das Problem nicht.

## 3. Mehrere unterschiedliche Ursachen für Abbrüche

Seit 10.11.: **29 `session.interrupted`-Ereignisse**, **20
`provider.error`-Ereignisse**, **3 `acp.recovered` mit `cancelled: true`**.
Dies sind Ereigniszahlen, keine Zahl unabhängiger Ausfälle. Codex kann
denselben Providerfehler über `error` und `turn/completed` doppelt melden.

- **Betriebsunterbrechungen:** Journal seit 12.11. enthält zehn
  Shutdown/Listen-Paare, jeweils `SIGTERM`, keine dort nachgewiesenen
  spontanen Heap-Abstürze. Am 13.11. allein neun Paare. Größte belegte Lücke:
  10:08:24–10:32:46 UTC (24 min 22 s); zuletzt 14:28:53–14:31:12 UTC.
  Die Ursache jedes Stop-Aufrufs ist aus diesem Journal allein nicht ableitbar.
- **P57-Messskript:** Session `a257b3d1…` räumt selbst ein, ohne `HUB_LOCAL=1`
  den Produktionsservice gestoppt zu haben. `scripts/hub.sh:91` erklärt den
  Mechanismus: ohne Override gewinnt die installierte systemd-Unit, auch
  wenn der Aufrufer einen anderen Test-Checkout meint. Ein Gegenpatch
  (`51f972f`) liegt bereits im P57-Arbeitsbranch, noch ohne MR.
  Die dort behauptete durchgehende 14-Minuten-Lücke ist **nicht** korrekt:
  Das Journal zeigt dazwischen einen erfolgreichen Start um 14:19:44 UTC.
- **Neustart ist kein transparentes Weiterarbeiten:** ACP-`recover()` in
  `packages/adapters/acp/src/index.ts:817` sendet beim Adoptieren explizit
  `session/cancel`. „recovered: 163, failed: 0“ belegt rekonstruierte
  Session-Objekte, nicht 163 erfolgreich fortgesetzte Arbeitsaufträge.
- **Automatische Fortsetzung ist hier nicht eingeschaltet:** Die gelesene
  Produktivkonfiguration setzt `autoResumeInterrupted` nicht; der Default ist
  `false`. `SessionManager` verlangt zusätzlich `capabilities.resume.auto`
  beim Adapter. Codex app-server deklariert das derzeit nicht. Ein natives
  Resume oder ein wieder vorhandenes Session-Objekt allein verspricht also
  keine automatische Wiederaufnahme des Auftrags.
- **Stummschaltungs-Watchdog:** Maki/OpenCode-Journale nennen mehrfach
  „seit 10 min stumm — Hub bricht ab (session/cancel)“, etwa `44521072…`
  am 12.11. 08:41:39 UTC und `0f75d99c…` am 11.11. 21:22:23 UTC.
  Lange Shell-/E2E-Arbeit kann so aussehen; ob der konkrete Prozess zu
  diesem Zeitpunkt noch Fortschritt machte, ist rückwirkend nicht belegt.
  Der aktuelle Code-Default ist 30 min; die gelesene Produktivkonfiguration
  überschreibt ihn für Maki und OpenCode ausdrücklich mit **600000 ms (10 min)**.
- **Provider-Limits:** `79d8ca74…` endet am Claude-Wochenlimit,
  `cdf0fa85…` und `a63233cb…` an Codex-Usage-Limits. Das sind echte externe
  Grenzen, zusätzlich aber unzureichend als Auftragszustand dargestellt.
- **Irreführender Abschluss:** `adapterTurn("idle")` schreibt `code: 0`
  auch nach zuvor sichtbarem Providerfehler. `cdf0fa85…` zeigt nach
  `codex.turn_end(status=failed)` einen solchen scheinbar sauberen Hub-Ende-
  Eintrag. Das sollte Fehler/Unterbrechung getrennt vom Zugende darstellen.

Die alte Datei `data/hub-app.log` endet mit Heap-OOM vom 27.10.2026.
Sie ist **kein Beleg für einen heutigen OOM**. Während des Audits meldet
Readiness etwa 46 MB Heap, 230 MB RSS; Service `KillMode=process`,
`NRestarts=0` im aktuellen Service-Lauf. Diese Momentaufnahme schließt
frühere Speicherprobleme nicht aus.

## 4. Deployment-Lücke ist belegt

| Ebene | Gelesener Stand |
|---|---|
| GitLab `main` | `02fd546` vom 13.11. 10:50:56 UTC |
| Produktiver Checkout `main` | `f92263a` vom 13.11. 07:03:15 UTC, arbeitsfrei |
| Produktiver PWA-Build | `apps/pwa/dist/index.html`, 13.11. 07:08:08 UTC |
| Laufender Service | Hauptcheckout, seit 14:31:08 UTC gestartet |
| HTTP | Health und Readiness antworten erfolgreich auf Port 7373 |

MR **!448** (P57-Erststart, Merge 10:06 UTC) liegt auf GitLab-`main`, aber
nicht im Produktiv-Checkout/Build. MR **!449** ergänzt danach nur den
Bugreport BUG-0152. Ein erneuter Service-Start allein aktualisiert weder
den Checkout noch den PWA-Build. MR **!447** (Chat/Prompt/Denkpfad) und
**!446** (Galaxie) sind dagegen bereits im lokalen Produktivstand enthalten.
Dass ein konkretes Handy genau diesen Build rendert, wurde nicht geprüft.

## 5. Die letzten 35 Sessions

IDs sind eindeutige Präfixe. „Integriert“ bedeutet belegten Merge/Code in
AncientVoid, keine nachträglich behauptete vollständige Feature-Abnahme.
Fremdrepos sind ausdrücklich als solche markiert.

| Session | Ergebnis des Abgleichs / verbleibende Arbeit |
|---|---|
| `a0b368ae` | Dieser Audit, aktiv während der Erhebung. |
| `0ce1df1b` | HiveOS/Recherche, aktiv; zuletzt noch keine Assistant-Antwort. Kein Abschluss behauptet. |
| `a257b3d1` | P57 **offen**: Messlauf/Abnahme/Retro/Integration/Deployment; Arbeitsbranch hat zusätzliche Commits gegenüber GitLab-main, keine offene MR. `idle` trotz Job. |
| `109c8d3a` | Chat/Scroll/Prompt/Denkpfad: !447 gemergt, im Produktiv-Checkout und Build enthalten; Neustart im Journal bestätigt. Companion-Funktion nicht erneut abgenommen. |
| `79d8ca74` | **P57-Vorgänger**, sagt „PWA-Agent gestoppt“, danach Claude-Wochenlimit. Planung !439 integriert; Fortsetzung läuft inzwischen über `a257b3d1`. Kein zusätzlicher unabhängiger Featureverlust. |
| `9478fa40` | Antwort bestätigt !446, nennt aber drei offene Abnahmepunkte. Galaxie integriert, Epic nicht vollständig abgenommen. Session-Projekt ist presentations. |
| `6984be4d` | Präsentationsrepos: Abschluss nennt noch Videos, Handy-Token und Generalprobe. Teilabschluss; Fremdrepo-Deployments nicht unabhängig geprüft. |
| `b36c36cd` | Epic-Markierung !427 und Kontext-Hygiene !431 integriert; knip-Triage ausdrücklich offen. |
| `47c9ece3` | Buttons/Vormerkung/FAB !413 sowie Galaxie !446 integriert. Letzte Nutzerbitte zu Neustart/Fortsetzung bleibt **unbeantwortet**, Session `interrupted`. |
| `0e5594c9` | Offline-Badge !400 und P36-Doku !408 integriert. `7edd22e` ist noch unique, ändert nur eine Epic-Zeile; kein fehlendes Feature. Schlussantwort vertagt Deployment/CI. |
| `803d87cd` | Nyx-FAB/Git-Graph/Autosave !398 integriert. |
| `c0e0ab44` | Provider-Reparatur !396/!397 integriert. Weiterdelegierter Dateibaum später über !404 integriert. |
| `44521072` | Verlauf endet mitten im E2E-Gate, Watchdog-Fehler. Dateibaum trotzdem später **!404 gemergt**, keine unique Commits im Branch. Kein Grund zur doppelten Implementierung. |
| `3bfa2a78` | Session-Menü !411, Dreispaltenlayout !403 und Umbruch !412 integriert. |
| `e2868425` | BUG-0125 / Workspace-Link-Check !399 integriert. |
| `13fd6e36` | AncientVoid-Hälfte !392 integriert; VoidWarden-MR laut Verlauf gemergt, hier nicht unabhängig überprüft. |
| `0f75d99c` | Verlauf endet nach Testankündigung/Watchdog; Registry später **!402 gemergt**, Branch ohne unique Commits. Integration vorhanden trotz fehlender Schlussmeldung. |
| `ea1f78ad` | P41/P50 !389/!390/!391 integriert; fachliche Restabnahmen gemäß Epics beurteilen. |
| `7ad61139` | VoidWarden-Verbindungstest, kein Feature-Auftrag. |
| `91f0d0b7` | VoidWarden: Verlauf endet beim angekündigten SW-Update-Fix, zuvor Rate-Limit. Fertigstellung/Deployment dort **nicht unabhängig belegt**. |
| `ebf136e9` | VoidWarden: Schlussmeldung nennt offene MR !58. Heutiger Fremdrepo-Status ungeprüft. |
| `6103be71` | VoidWarden-TTS: Codex-Limit; letzter Bericht fordert noch Finalisierung. Heutiger Fremdrepo-Stand ungeprüft. |
| `a63233cb` | Setup-Audit nach Codex-Limit übernommen: !406 sowie Fixes !423–!426 integriert. |
| `6445fde7` | Vault-Unterbau !383 inzwischen gemergt; Session-Schluss „MR offen“ ist veraltet. **P51 T51.3–T51.11 weiterhin offen** laut Epic. |
| `fc926ce1` | P53 !380/!381 integriert; Zwei-Frischklon-Kaskadenabnahme laut Abschluss noch offen. |
| `3d448e9e` | P42 laut Abschluss !373/!375 fertig; passende MRs in GitLab vorhanden/gemergt. Physische Geräteabnahme hier nicht wiederholt. |
| `4466aa67` | Kein Nutzerprompt/Assistant-Verlauf in den normalisierten Ereignissen; kein bewertbarer Feature-Abschluss. |
| `349daf20` | Vormerkung !367 integriert; Schlussmeldung nennt noch laufendes Vollgate. Kein nachträglicher Gate-Pass aus `idle` ableitbar. |
| `79509b29` | UI-Konzept/Artifact geliefert; kein belegter Implementierungs-/Deployment-Abschluss und auch nicht aus einem Konzept abzuleiten. |
| `7e462c84` | Automationsarbeit !389 und spätere P41-Nachweise !433–!437 integriert. Früherer Provider-Stillstand ist kein aktueller Nachweis fehlenden Codes. |
| `af1599fa` | Audit/Planung lieferte P50-Befunde; Umsetzung später !390/!391 integriert. |
| `cdf0fa85` | Eigener Lauf am Codex-Limit gescheitert, Status dennoch `idle`. P41-Arbeit später durch andere MRs integriert; kein automatischer Wiederholungsauftrag. |
| `c6719917` | Fremdprojekt/Zugangsdaten-Suche, kein AncientVoid-Feature. Inhalte absichtlich nicht in diesen Bericht übernommen. |
| `bc46cce9` | Letzte Bitte „weiter machen“ ohne Assistant-Antwort, Provider-Netzwerkfehler; P36/P41/P42-Arbeiten später anderweitig integriert. |
| `1ac1beaa` | Neustart/Weiterbitten ohne Assistant-Antwort, `error`; P42 später durch andere Session abgeschlossen. |

Alle 168 Journale zusammen haben 24 letzte Prompts ohne spätere
Assistant-Nachricht. **Das sind nicht 24 nachgewiesen verlorene Nachrichten**:
darunter sind Alt-/Test-/aktive Sessions. Für Prompts seit 10.11. verbleiben
vier Treffer: `1ac1beaa`, `bc46cce9`, `47c9ece3` und die aktive `0ce1df1b`.
Die zuletzt drei alten Fehlerfälle brauchen keinen blinden Komplett-Neustart
ihrer ursprünglichen Feature-Aufträge, weil spätere Sessions Code integriert haben.

### Peer-Befunde

Auf **gpubox**: 26 `idle`, 3 `error`, 18 `stopped`. Unter den zuletzt
angelegten Sessions gibt es seit 10.11. genau einen neuen Arbeitsauftrag:
`1d7e78f8…` (QMD-Evaluation/Integration). Dessen letzte Antwort vom
13.11. 08:38:28 UTC nennt PR #415/#416 und einen noch laufenden Nachschub-
Push von Commit `480e62c5`; sie verspricht eine Bestätigung danach.
Statt dieser Bestätigung folgt nur `session.turn_end`, Status ist `idle`.
**Abschluss nicht bestätigt**, tatsächlichen heutigen PR-/Push-Stand des
Fremdrepos hier nicht unabhängig geprüft. Auch dieser Fall zeigt, warum
„ich bestätige gleich“ plus `idle` kein belastbarer Abschluss ist.

Auf **home-server**: sieben `error`-Sessions, sämtlich Dummy-Flotten-
Messläufe vom 23.09.2026; keine neu angelegte Feature-Session seit 10.11.
Diese Altlasten sind keine sieben zusätzlich verlorenen aktuellen Aufträge.

## 6. Reparaturreihenfolge und Abnahmekriterien

1. **Codex-Eingabeannahme korrigieren (K2/K7, BUG-0158).** Abgelehnte
   `turn/steer`/`turn/start` als negatives Ack und sichtbares Fehlerereignis;
   Input nicht als erfolgreich verbuchen. Unbekanntes Ergebnis bei Timeout
   separat behandeln, keine blinde Retry-Schleife. Tests für beide RPC-
   Ablehnungen, Zeitüberschreitung, Idempotenz und Queue-Erhalt; Hub-/PWA-E2E.
2. **Hintergrundarbeit im Contract modellieren (K7/K10, BUG-0155).** ADR
   vor Contract-Änderung; Arbeitseinheiten mit stabiler ID und Zustand für
   Provider-Subagenten/Commands sowie ausdrücklich registrierte externe Jobs.
   Statusprojektion bleibt aktiv, solange zugehörige Arbeit offen ist;
   Freigaben/Fehler bleiben sichtbar. Start/Ende im Journal, Snapshot-Recovery,
   Zuordnung zur Worker-Generation; ein verwaister Job wird sichtbar unklar/
   unterbrochen, nicht still als fertig behandelt. Persistenter Agent allein
   hält die Session nicht aktiv. Provider liefern strukturierte Zustände;
   Assistant-Text wird nie als Steueranweisung interpretiert.
3. **Wiederanlauf und Stillstand getrennt reparieren (K7).** ACP-Cancel beim
   Adoptieren nicht als nahtloses Resume verkaufen. Überlebende aktive Turns
   samt Berechtigungsfragen rekonstruieren, sonst klare Unterbrechung und
   Fortsetzungsweg. Watchdog berücksichtigt nachgewiesene laufende Arbeit;
   echte verwaiste/defekte Turns bleiben begrenzt und sichtbar. Tests mit
   Hub-Kill während Shell-Prozess, Subagent und Freigabe, ohne Doppelsendung.
4. **Betriebsgrenze härten (K7).** Messlauf-Fix des aktiven P57-Branches
   integrieren; Test-Hub-Aufrufe mit eigenem Port/Datadir und überprüfter
   Instanzidentität. Negativtest mit vorhandener Produktions-Unit muss
   belegen, dass deren Stop/Restart nicht aufgerufen wird. Ein gesetztes
   `HUB_LOCAL` allein ist keine allgemeine Instanzidentitätsprüfung.
5. **Auslieferung nachholen (K10).** Nach Integration Checkout auf
   GitLab-main bringen, PWA bauen, geordnet neu starten und Health/Readiness
   sowie Bundle-Identität am Handy prüfen. Checkout-SHA, gebauten SHA und
   laufenden SHA sichtbar machen, damit „gemergt“ nicht „live“ suggeriert.
6. **Auftragsabschluss explizit prüfen.** Offene P57-Abnahme, P51-UI/Shortcuts
   und P52-Abnahmepunkte bleiben offen. P54–P56 sind Planungsentwürfe mit
   Umsetzungssperre, keine verschwundenen fertigen Features. Für jede
   betroffene Session: letzter Auftrag → vorhandener Code → MR → Build →
   fachliche Abnahme; nur tatsächlich fehlende Restarbeit wieder beauftragen.

Die beiden Produktfehler wurden nach dem Repo-Skill
[`bug-report`](../.claude/skills/bug-report/SKILL.md) zusätzlich als
[GitLab #61](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/61) und
[GitLab #62](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/62) erfasst.

Kein automatischer Self-Resume aller alten Sessions und kein pauschales
Re-Deployment der Fremdrepos aus diesem Audit. Die Diagnose und der
Adapter-Repro sind belegt; die obigen Produktreparaturen sind noch offen.

## Verifikation der Dokumentationsänderung

`npm test`: **2044 bestanden**, 4 übersprungen (275 Testdateien bestanden,
eine übersprungen). `npm run lint`, `npm run typecheck` und
`npm run check:context` grün. Skips zählen nicht als Pass.
Zuvor fehlende lokale Workspace-Links wurden mit dem vorhandenen
`check-workspace-links.mjs --fix` eingerichtet; es wurden keine Gates
abgeschwächt. Keine Produktcode-Änderung, kein E2E-/Deployment-Nachweis
für die noch offenen Reparaturen.
