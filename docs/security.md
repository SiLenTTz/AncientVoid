# Sicherheit (T4.9, PRD §8)

**Art:** erklaerung

Diese Doku ist das OSS-facing Gegenstück zu PRD §8 und
[`EPIC-P2`](../epics/EPIC-P2-diff-approvals-budgets.md)s Sicherheits-
Walkthrough (§7 dort) — real gegen den umgesetzten Code geprüft, nicht nur
behauptet. Jede Zeile unten verweist auf eine echte Datei/einen echten
Test, keine Absichtserklärung ohne Beleg.

## Bedrohungsmodell (PRD §8)

### 1. Netz — kein öffentlicher Port

`apps/hub/src/main.ts` bindet standardmäßig `127.0.0.1`; ein
öffentliches Binden erfordert das explizite `ANCIENTVOID_EXPOSE=1`-Opt-in. Der
vorgesehene Zugriffsweg ist `tailscale serve`
(`scripts/setup-tailscale-serve.sh`) — kein Reverse-Proxy, kein
öffentlicher DNS-Eintrag. PWA-Auth: optional Tailnet-Identität
(`enforceTailnetIdentity` + `Tailscale-User-Login`-Header,
`apps/hub/src/auth.ts`) + immer Device-Token
(SHA-256-Hash in SQLite, Klartext nur einmal bei `hubctl token issue`
gezeigt) + optional WebAuthn für destruktive Freigaben (T2.5).

### 2. Approval-Klassen

| Klasse | Gate | Real umgesetzt in |
|---|---|---|
| `read` | frei | jede GET-Route — kein Approval-Objekt entsteht |
| `write` | Tipp-Bestätigung, Begründung optional | `ApprovalService.decide()`, HMAC-Signatur über den rohen Device-Token (ADR-0007) |
| `destructive` | Biometrie (WebAuthn) + Pflicht-Begründung | `ApprovalService.decideBiometric()`, echtes `@simplewebauthn/server` |

Fail-closed real erzwungen, nicht nur konventionell: ein abgelaufenes
`pending` wird bei jedem Lesezugriff **vor** jeder anderen Aktion in
`timed_out` aufgelöst (`ApprovalService.resolveIfExpired`), strukturell
unmöglich zu umgehen. `destructive` kann **nur** über
`decideBiometric()` genehmigt werden — der einfachere `write`-Pfad
verweigert eine `destructive`-Anfrage hart, egal welche Begründung
mitgeschickt wird.

**Bekannte, benannte Lücke:** `SessionManager.create()`
(Session-Start) ist trotz EPIC-P2 §3s Klassentabelle
(„Session starten" als write-Beispiel) nie tatsächlich gegated worden —
nur Steer-Prompt und Budget-Top-up sind es real. `@ancientvoid/gateway-mcp`
exponiert `session.create`/`stop`/`park` deshalb bewusst nicht (siehe
dessen `operations.ts`), um diese Lücke nicht über eine neue Oberfläche
zu vergrößern.

### Automatische Freigabe (`toolApprovals: "auto"`)

Auf Wunsch des Betreibers (2026-10-09) kann der Hub Tool-Anfragen der Provider ohne Rückfrage erlauben.
Der Gatekeeper (T7.9) und die Klasse `destructive` mit Passkey greifen dann für Tool-Anfragen nicht mehr;
**jede** so erlaubte Anfrage steht trotzdem als Event `tool.auto_approved` im Verlauf (Audit). Nicht erfasst
sind Rückfragen an die Person und Aktionen am Hub selbst. Der Standard bleibt `"ask"`. Das Risiko ist bewusst:
ein Agent kann auf diesem Rechner alles tun, was sein Benutzer darf. Es gilt nur in Verbindung mit dem
Tailscale-Netz als Vertrauensgrenze (Abschnitt 1).

### 3. Befehls-Allowlist — nie freie Shell vom Handy

Kein Route-Handler in `apps/hub/src/modules/*/*.routes.ts` reicht
client-geliefertes Freitext an `execFile`/`spawn` durch. `diff.ts`s
`execFile`-Aufrufe nehmen ausschließlich serverseitig aufgelöste
Pfade/Refs. Jeder Adapter-Prozess läuft über `ctx.spawnWorker` mit vom
Adapter selbst konstruierten Argumenten; Client-Eingaben laufen vorher
durch Zod-Schemas (`CreateSessionBody`, `SteerBody`,
`OptimizerFeedbackBody`, …).

**Korrektur (2026-09-18, BUG-0012):** diese Behauptung war für `cmd`-Argv
richtig, aber unvollständig — `SessionSpec.env`s **Schlüssel** liefen bis
zu diesem Fund komplett ungeprüft in `TmuxRunner.spawn()`s Shell-String
ein, ein reales, live reproduziertes RCE. Jetzt geschlossen:
`ENV_VAR_NAME`-Schema (`@ancientvoid/contracts`) an der API-Grenze plus
`SAFE_ENV_KEY`-Validierung direkt in `TmuxRunner` selbst — siehe
[BUG-0012](../bugs/bug-0012-tmux-env-key-shell-injection.md).

### 4. Audit-Trail — wer-wann-was

`SessionManager`s mutierende Methoden (`create`/`steer`/`stop`/`park`/
`requestBudgetTopUp`/`applyApproved*`) nehmen einen `actor`-Parameter
(das echte, `identify()`te Device-Token-Label des Aufrufers) und schreiben
ihn in ihre System-Events (T2.8). Jede Freigabe-Entscheidung — genehmigt
**oder abgelehnt** — landet zusätzlich als `session.approval_decided` auf
dem Session-Tail selbst, nicht nur als Zeile in der separaten
`approvals`-Tabelle.

### 5. Prompt-Injection-Grenze — Agenten-Output ist Daten, nie Instruktion

Kein `dangerouslySetInnerHTML`/`innerHTML` für Agenten-Output irgendwo in
`apps/pwa/src/*.tsx` — jeder Event-`payload`/`summary`-Wert läuft
durch Preacts normales, auto-escapendes JSX-Rendering.

**Eine bewusste, geprüfte Ausnahme (T3.8, `Search.tsx`s Datei-Viewer):**
Syntax-Highlighting einer echten Projektdatei (nicht Agenten-Output)
nutzt `highlight.js`, dessen Ausgabe per `dangerouslySetInnerHTML`
gerendert wird — live verifiziert, dass `highlight.js` den Quelltext
selbst escaped, bevor es eigene `<span>`-Tags einfügt (ein `<script>` im
Dateiinhalt kommt als `&lt;script&gt;` heraus, nie als echtes Tag). Diese
Ausnahme betrifft Dateiinhalt aus `readProjectFile()`, nie ein
Event-`payload`/`summary` — die Grenze oben bleibt für Agenten-Output
unverändert bestehen.

### 6. Kosten-Governance

Siehe „BudgetState" in [`architecture.md`](architecture.md) — Fail-closed
real erzwungen seit dem in T2.10 gefundenen und behobenen Bug (ein
geparkter, aber nicht real signalisierter Adapter produzierte nach dem
Parken weiter Kosten).

## Reale Funde

**Aus dem unabhängigen Fresh-Context-Red-Team-Review (2026-09-18, T4.10)**
— null Vorwissen über dieses Repo, gegen den realen Code geprüft:

- **[BUG-0012](../bugs/bug-0012-tmux-env-key-shell-injection.md) (Kritisch)** —
  `TmuxRunner.spawn()` interpolierte `env`-Schlüssel ungeprüft in einen
  Shell-String; live reproduziert als echte Command-Substitution-RCE über
  ein client-erreichbares Feld (`SessionSpec.env`). Gefixt.
- **[BUG-0013](../bugs/bug-0013-mcp-gateway-sessionid-route-confusion.md) (Hoch)** —
  MCP-Gateway interpolierte `sessionId` ungeprüft in Pfad-Templates; ein
  `?` im Wert brach real aus dem Pfad aus (`new URL()` verifiziert) und
  lenkte z. B. `steer_prompt` auf `session.stop` um. Gefixt (`.uuid()` +
  `encodeURIComponent()`).

Volle Befunde inkl. geprüfter-und-bestätigt-sicherer Bereiche (WebAuthn,
SQL-Parametrisierung, Worktree-Isolation, PWA-Injektionsoberfläche,
`adapter-cursor-clip`) in der Session-Historie; Zusammenfassung in
[`epics/EPIC-P4-brain-windows-mcp-oss.md`](../epics/EPIC-P4-brain-windows-mcp-oss.md)s
T4.10-Eintrag.

**Aus der vorangegangenen Selbst-Review derselben Session** (kein Ersatz
für eine unabhängige Prüfung, aber real gefunden und behoben):

- **[BUG-0011](../bugs/bug-0011-stop-button-silently-broken.md)** —
  der reale „Stop"-Button hat nie funktioniert (leerer Body + JSON-
  Content-Type → echter 400, still verschluckt). Sicherheitsrelevant,
  weil „eine außer Kontrolle geratene Session stoppen" eine Kernfunktion
  der Kosten-/Sicherheits-Governance ist.
- **Budget-Park-Fail-closed-Lücke** (EPIC-P2 T2.10) — ein geparkter
  Adapter lief real weiter, bis `parkFor()` ein echtes
  `SteerInput{kind:"park"}`-Signal bekam.

## Abhängigkeits-Audit (Stand 2026-10-08)

`npm audit --omit=dev` (Laufzeit-Abhängigkeiten) meldet **0 Funde**. Behoben
per `npm audit fix` (ohne `--force`): `@modelcontextprotocol/sdk` 1.30.0 →
1.32.1 (OAuth-Client-Credentials, high), `fastify` 5.12.4 → 5.12.5 (HTTP/2-
Trailer-DoS), `fast-uri` 3.1.8. Die Untergrenzen in `apps/gateway-mcp` und
`apps/hub` sind angehoben, damit eine frische Auflösung keine verwundbare
Version holt.

Die früher offenen Dev-Funde (`tinypool`, `@vitest/mocker`, `esbuild`) sind
mit vitest 5 / Vite 8 (2026-10-08) behoben: `npm audit` meldet insgesamt 0 Funde.

## Was noch fehlt (ehrlich, nicht Teil dieser Session)

- Lizenz-Entscheidung (T4.8) — rechtliche Frage, nicht hier autonom
  entschieden.
- `swarm`-Adapter: kein Code, da das reale Event-Vokabular nicht
  auffindbar war (ADR-0001-Nachtrag) — ein spekulativer Adapter hätte ein
  eigenes Risiko dargestellt (falsch kategorisierte Events).
