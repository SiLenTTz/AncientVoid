# ADR-0024 — System-1-Gatekeeper für Tool-Anfragen (Laya-Prinzip)

**Status:** akzeptiert · **Betrifft:** EPIC-P7 T7.9, AC-P7-7,
`packages/contracts/src/approvals/gatekeeper.ts`, `packages/core/src/modules/gatekeeper/`,
`ToolPermissions`, `ApprovalRequest.assessment` (Migration 16), `hub.config.json`
`gatekeeper`, PWA-Freigabekarte

## Kontext

Seit T7.2 landet jede Tool-Anfrage eines Harness als Freigabe auf dem Handy.
Viele davon sind harmlos (`git status`), wenige gefährlich (ein Schlüssel, der
per `curl` die Maschine verlässt). Auf dem Handy sieht beides gleich aus. Das
„Laya“-Prinzip: ein schnelles, enges System 1 ordnet jede Anfrage in wenige
feste Klassen ein. Das langsame System 2, also der Mensch, entscheidet.

## Entscheidung

1. **Zwei Felder, feste Werte:** `tool_risk` ∈ READ_ONLY, LOCAL_WRITE,
   DESTRUCTIVE, EXFILTRATION und `security_gate` ∈ CLEAN, WARNING,
   CRITICAL_BLOCK. Eine GBNF-Grammatik lässt nichts anderes zu.
2. **Regeln als Boden:** feste, lesbare Muster (`rules.ts`) für
   Geheimnisse, Netz, Upload, `curl | sh`, zerstörerische Befehle, Pfade
   außerhalb des Worktrees und Prompt-Injection. Sie laufen immer, auch ohne
   Modell. Das Modell kann nie unter sie gehen.
3. **Lokales Modell:** OpenAI-kompatibler llama.cpp-Server auf eigener
   Hardware (T7.5). Der Prompt ist auf UACC umgeschrieben: Worktree-Grenzen,
   Geheimnisse, ADR-0007-Passkey, „nie freigeben“. Dazu kommen Beispiele, die
   nicht aus dem Testsatz stammen, und ein deterministischer Pfad-Hinweis
   (innen/außen). Kein Cloud-Egress.
4. **Fail-closed:** Das strengere Ergebnis von Regeln und Modell gewinnt. Ein
   Feld mit weniger als 0,8 Konfidenz (Logprob, renormalisiert über die
   grammatisch erlaubten Kandidaten) geht eine Stufe höher. Zeitlimit (8 s),
   HTTP-Fehler oder eine Antwort außerhalb der Grammatik führen zu Regeln +
   mindestens WARNING. Ohne konfiguriertes Modell sprechen die Regeln
   allein, ohne erfundene Warnung (`source: "rules"`).
5. **Wirkung:** `CRITICAL_BLOCK` macht die Freigabe `destructive`. Sie
   braucht dann Passkey und Begründung (ADR-0007). Alle anderen Stufen
   ändern nur das Etikett. Der Gatekeeper **gibt nie frei** und verkürzt
   keine Wartezeit.
6. **Sichtbar:** Die Einstufung steht auf der Freigabe (`assessment`) und
   gekürzt im `gate`-Event. Die Karte zeigt „Laya: unauffällig | genau
   hinsehen | kritisch — Passkey“, dazu Risiko, Quelle und Gründe.

## Folgen

- Jede Tool-Freigabe wartet zusätzlich auf die Einstufung: gemessen
  p95 ≈ 0,4 s, begrenzt auf 8 s.
- Eine Fehleinstufung „zu streng“ kostet einen Passkey-Tipp. „Zu mild“ ist
  durch die Regeln begrenzt: 0 verpasste CRITICAL im Messlauf
  ([Messlauf](../messlauf/2026-09-24-gatekeeper.md)).
- Die Logprob-Konfidenz dieses Modells ist praktisch immer ≈ 1. Sie wird
  gemessen und angezeigt, trägt aber nicht die Sicherheit. Die tragen die
  Regeln und der Rückfall.
- Sprach-Intents bleiben in P10 (T10.4). Dieser ADR betrifft nur
  Tool-Anfragen.
