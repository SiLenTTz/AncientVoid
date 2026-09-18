# ADR-0006 — `tokensEst` von Event zu `SessionRecord` aggregiert (Bericht-Reiter)

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/session.ts`, T1.6-4 (EPIC-P1.6)

## Kontext

EPIC-P1.6s neuer Bericht-Reiter braucht eine reale Token-Zahl pro Session —
bisher „nirgends aggregiert" (EPIC-P1.6 §3.3). Ein Blick in die Contracts
zeigt: `EmittedEvent`/`NormalizedEvent` haben bereits ein optionales
`tokensEst: number`-Feld (`packages/contracts/src/event.ts:81`) — aber es
wird nur vom `dummy`-Adapter mit Testwerten befüllt
(`packages/adapter-dummy/src/index.ts:169`) und von `SessionManager`
lediglich unverändert an den WS-Client weitergereicht
(`sessionmanager.ts:449`), **nie aufsummiert**. Ein weiteres Beispiel des
Musters aus T1.5-11/T1.6-2/T1.6-3 (Contract-Feld existiert, ist aber toter
Code) — diesmal auf Event-Ebene statt Session-Ebene.

Gleichzeitig liefert `claude`s echter `result`-Stream-Zeile bereits ein
`usage`-Objekt mit `input_tokens`/`output_tokens` — direkt neben dem
`total_cost_usd`, aus dem `costUsd` schon seit ADR-0003 gespeist wird
(siehe `packages/adapter-claude/test/fixtures/trivial-text.jsonl`). Beide
Zahlen kommen aus derselben Zeile, in derselben `normalizeResult()`-Funktion.

## Entscheidung

Exakt das in ADR-0003 bereits entschiedene Muster, jetzt auf das
bestehende `tokensEst`-Feld angewendet statt ein neues zu erfinden:

- `adapter-claude`s `normalizeResult()` setzt `tokensEst = usage.input_tokens
  + usage.output_tokens` (eine kombinierte Zahl, kein `in`/`out`-Split — die
  Bericht-UI zeigt „Tokens gesamt", keine Zerlegung, weil dafür kein
  zweites Contract-Feld nötig ist).
- `SessionRecord` bekommt ein neues Feld `tokensEst: number` (Default 0,
  `nonnegative()`), das `SessionManager.emitEvents()` genauso aufsummiert
  wie `costUsd` — pro Event, nicht kumulativ im Event selbst.
- Neue SQLite-Spalte `tokens_est INTEGER NOT NULL DEFAULT 0`, Migration
  `sessions-tokens-est` (id 3).
- `codex`/`dummy` in der echten Bericht-Anzeige: dieselbe
  `capabilities().cost`-Fähigkeit entscheidet, ob eine Tokenzahl als „real"
  angezeigt wird oder als „nicht erfasst" — beide Werte stammen bei
  `claude` aus derselben Quellzeile, eine zweite Fähigkeits-Flagge wäre
  hier eine unnötige zusätzliche Unterscheidung, die nichts Neues
  ausdrückt.

## Konsequenzen

- `SessionRecord.tokensEst` ist rückwärtskompatibel (neues, optional
  ignorierbares Feld) — bestehende Clients unbetroffen.
- `codex` bleibt bei `tokensEst = 0` — dieselbe „0 heißt nichts gemeldet,
  nicht bestätigt kostenlos"-Einschränkung wie bei `costUsd` gilt hier
  identisch; die UI zeigt „nicht erfasst" statt der reinen 0, wenn
  `capabilities().cost === false`.
- Kein neuer Aggregations-Endpunkt nötig — `tokensEst` reist wie `costUsd`
  bereits über den bestehenden `GET /api/sessions/:id`-Pfad mit.
