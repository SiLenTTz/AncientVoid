# Produktionsreife-Report — AncientVoid

**Datum:** 2026-10-26 · **Stand:** `main` @ `a87fdae` · **Anlass:** Frage „Ist der
mobile Hub inzwischen auf einem produktiven Stand? Wo sind Bugs, Gaps,
Verbesserungen offen?"

## TL;DR

**Ja für den Solo-Alltagseinsatz — nein im Sinne der eigenen P12-Definition von
„Betriebsreife“.** Der Hub ist produktiv im täglichen Gebrauch (systemd-Dienst
aktiv, 378 MB produktive Daten, 11 Adapter konfiguriert), alle lokalen Gates
sind grün, kein einziger offener Bug. Was fehlt, sind fast ausschließlich
**externe Abnahmen** (echtes Handy, echter Desktop, Provider-Zugänge,
Betriebszeit-Nachweise) — keine Programmierarbeit. Außerdem liegen drei kleine
Entscheidungen bei dir (T15.4 Live-Sync, P14 `prune --apply`, T16.5 zweiter
Origin) und der README-Status ist einen Monat alt.

---

## 1. Heute frisch verifiziert (Evidenz dieses Scans)

| Prüfung | Ergebnis |
|---|---|
| `npm run typecheck` | ✅ grün (Hub + PWA) |
| `npm run lint` | ✅ grün |
| `npm test` (vitest) | ✅ 129 Dateien / 837 Tests, 0 Fehler (164 s) |
| Offene Bugs (`bugs/`) | ✅ **0 offen** — alle 63 `done` |
| `test.fixme` in `e2e/` | ✅ keines vorhanden |
| TODO/FIXME im Produktionscode | ✅ keines (nur ein Tool-Name-Regex in der PWA) |
| Laufende Instanz | ✅ `systemctl --user ancientvoid-hub` = active, PWA auf `127.0.0.1:7373`, `/api/health` implementiert (auth-frei, korrekt) |
| Produktivdaten | `data/` = 378 MB (SQLite + WAL, JSONL, Blobs, Backups, Medien) |
| Konfigurierte Adapter (Produktion) | 11: claude, codex, hermes, opencode (ACP), aider, copilot, cursor-clip, deepseek (ACP/dsh), securesight-harnez (ACP), cursor, pi |

Letzte vollständige Gate-Evidenz (inkl. Playwright-E2E): Messlauf
2026-09-24 — `npm run gate` exit 0, 151 E2E bestanden / 2 sichtbare Skips;
K8-Lasttest: 6.097 Events, 604 ev/s, 169 MB RSS, 0 verlorene Sessions.

**Bewertung:** Der Code-Zustand ist außergewöhnlich sauber für ein Projekt
dieser Größe. „Produktiv“ im Sinne von *ich verlasse mich täglich darauf und
vertraue meinen Agenten-Workloads dem Hub an* ist belegt — du betreibst
genau so eine Instanz.

## 2. Was „produktiv“ hier formal bedeutet: P12 ist offen

Nach eigener Messlatte (EPIC-P12 + `docs/p12-abnahme-checkliste.md`, Stand
2026-10-08) fehlen **externe Nachweise**. Zusammengefasst aus der Checkliste:

### A. Braucht dein Handy / ein echtes Gerät
- **T12.1** — Echtes Handy-Pairing über WAN (K10)
- **T12.4** — Push im Hintergrund/Sperrbildschirm, echter Flugmodus,
  Bildschirmtastatur, 200 % Text, TalkBack, Teilen-Menü (Web Share Target),
  ≥ 20 Fachbegriff-Diktate je Zielgerät (K6)
- **T12.7** — Aktuelle Gerätetokens auf Clients einspielen; Fairphone
  (gesperrt, Flugmodus); `gpubox`-Fleet-Credential rotieren

### B. Braucht deinen Desktop (Hyprland)
- **T12.4** — Desktop-Companion: 3 Apps × 10, Not-Stopp-Keybind, WAN-Abbruch
- **T12.12** — Leck-Messung 0/50 am echten Desktop (isoliertes Hyprland
  scheitert an Aquamarine `CBackend::create()`)
- **T11.4** — GUI-Harness-Flows (Claude Desktop, Cursor …), GTK3-Zelle

### C. Braucht einen Zugang / ein Provider-Konto
- **T12.1** — Claude-native Permission-Turns (Wochenkontingent war erschöpft)
- **T12.8** — Swarm-Adapter live (Admin-Credential + `swarm_cockpit` fehlen)
- **T12.4** — WSL-Host (z. B. bmax) in die Flotte; Handläufe Claude Code,
  Codex, Copilot (EPIC-P5 §12.4)

### D. Braucht Betriebszeit oder Datenmenge (keine neue Technik)
- **T12.5** — 24-h-Dauerlauf mit ≥ 20 Sessions inkl. Netz-/Hub-/Modell-Ausfällen
- **T12.2** — K2/K8 unter echter Sprachlast mit 20 Sessions
- **T12.4** — Gatekeeper auf ≥ 100 echt gelabelten Tool-Anfragen; Planer auf
  ≥ 100 echten Formulierungen
- **T12.3** — Restore-Latenz, ENOSPC-Verhalten, Retention-Löschlauf
- **T12.10** — Streaming-STT mit endpointing/VAD auf Zielhosts (bis dahin
  bleibt `stt.streaming` aus); 100 warme Kurzbefehle je Gerät
- **T12.1** — Update/Rollback der Produktivinstanz
- **T10.5** — Videofrage über echte Harness-Session, Video > 20 min

**Wichtig:** Fast nichts davon ist Code. Es fehlen Geräte, Zugänge oder deine
Mitwirkung. „Nicht vorhandener Zugriff ist kein Pass“ (AC-P12-4) — solange
diese Zellen offen sind, ist der formale Betriebsreife-Stempel nach
eigenem Regelwerk nicht verdient, so gut der Code auch dasteht.

## 3. Offene Entscheidungen, die bei dir liegen

| Punkt | Was | Wo dokumentiert |
|---|---|---|
| **T15.4 — Live-Sync Handy↔PC** | Hub-Sessions als Hintergrund-Sessions (`claude --bg`/`attach`) für echten Live-Sync — ersetzt `claude -p` pro Zug. Status-Quo: App zeigt Hinweis mit `claude --resume`/`attach`. | ADR-0034, EPIC-P15 |
| **P14 — produktiver `prune --apply`** | `hubctl worktrees prune --apply` wurde nie produktiv gefahren (löscht Daten — bewusste Entscheidung nötig). | EPIC-P14 |
| **T16.5 — Zweiter Origin auf dem Handy** | Fleet-, Handoff-, Drafts- und Messlauf-Specs brauchen einen zweiten Port/Browser; `adb reverse` kennt nur den Test-Hub. K8 bleibt dort ungesehen. | EPIC-P16 |
| **T15.6 (Nebenpunkt)** | Gruppierung nach Host in der Übersicht bei mehreren Flotten-Hubs. | EPIC-P15 |

## 4. Gaps & Schwächen (ehrliche Bestandsaufnahme)

1. **GitLab-CI unzuverlässig** (Free-Abo): zuletzt `ci_quota_exceeded`, Pipeline
   lief 0 s. Bekannt und über lokale Gates kompensiert (AGENTS.md regelt das) —
   aber Remote-Evidenz fehlt dauerhaft. Risiko: „Grün“ ist nur lokal belegbar.
2. **Streaming-STT deaktiviert** (`stt.streaming` aus bis T12.10). Sprachpfad
   läuft über die etablierte nicht-streamende STT; die gemessene
   Endpointing/VAD-Variante wartet auf Zielhost-Abnahme.
3. **Swarm-Adapter** existiert, ist aber ohne Admin-Credential nie live
   gelaufen — das ist der einzige Adapter ohne echte Lauf-JSONL.
4. **Mac nur Demo-Kontext** — kein bestätigter zusätzlicher Zielhost
   (epics/README). Windows/WSL-Host fehlt in der Flotte (C oben).
5. **Retention**: `data/` bei 378 MB; der Retention-Löschlauf (T12.3) ist als
   Nachweis offen. Kein akutes Problem, aber unbegrenzt wachsend ohne ihn.
6. **README-Status veraltet**: Der Kopf beschreibt den Stand des Audits
   2026-09-21 („Multi-Host-Steuerung noch nicht“, „P5–P12 geplant“) — P5/P6/P7/
   P8/P9 sind laut epics/README seit 2026-09-23/24 abgeschlossen, P13–P15
   inzwischen ebenso. Für dich selbst und künftige Agenten ist das eine
   falsche Erwartungshaltung. → aktualisieren (kleiner Docs-Fix).
7. **Kleinigkeiten** (keine Bugs): `/health` (ohne `/api`) fällt auf die SPA
   zurück — kosmetisch, `/api/health` ist der richtige Pfad. Vitest-Hinweis:
   `isolate: false` würde ~9 s sparen (bewusste Trade-off-Entscheidung nötig,
   forks-Pool ist bewusst gewählt).

## 5. Verbesserungsvorschläge (priorisiert)

1. **P12-Kurzliste abarbeiten, sinnvoll sortiert** — höchster Wert zuerst:
   - **T12.5 (24-h-Dauerlauf)**: einmal starten, kostet nur Zeit, deckt
     K2/K7/K8/K9/K10 gleichzeitig ab.
   - **T12.1 (WAN-Pairing + Update/Rollback)**: die beiden einzigen
     Betriebsrisiken, die im Alltag wehtun, wenn sie unerprobt sind.
   - **T12.4-Handymatrix**: ein eingeplanter Abend mit Handy (Push, Flugmodus,
     Teilen-Menü, Diktate).
2. **T15.4-Entscheidung treffen** (ADR-0034): entweder `claude --bg`-Pilot
   bauen oder Kontext-Fork-Status-Quo explizit per ADR abschließen — die
   offene Entscheidung kostet mehr als jede der beiden Optionen.
3. **P14 `prune --apply` produktiv fahren**: ein bewachter erster Lauf mit
   Trockenlauf-Report davor.
4. **README-Status auf Epics-Stand bringen** (30-Minuten-Fix, verhindert
   Fehlentscheidungen künftiger Agenten-Runden).
5. **Retention-Lauf (T12.3) angehen**, bevor `data/` weiter wächst.

## 6. Antwort auf die Frage

> „Ist der mobile Hub inzwischen auf einem produktiven Stand?“

**Produktiv genutzt: ja, nachweislich** — stabiler Alltagseinsatz, alle Gates
grün, null offene Bugs, saubere Contract-Architektur, Recovery-Pfade gebaut
und getestet.

**Produktionsreif im selbstgesetzten Sinne (P12): noch nicht ganz** — es
fehlen ~20 dokumentierte Abnahmen, die fast alle Geräte, Zugänge oder
Betriebszeit brauchen statt Code. Bis auf die drei offenen Entscheidungen
(T15.4, prune --apply, T16.5) und den veralteten README-Status gibt es keine
bekannten offenen Defekte oder funktionalen Gaps im Code.

---
*Erzeugt durch Repo-Scan am 2026-10-26 (Gates live ausgeführt). Quellen:
`epics/README.md`, `docs/p12-abnahme-checkliste.md`, EPIC-P14/P15/P16,
`docs/messlauf/2026-09-24-p12-lokale-evidenz.md`, `bugs/README.md`, Live-Prüfung
der Produktivinstanz.*
