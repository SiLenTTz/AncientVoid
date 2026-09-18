# ADR-0008 — `parkReason` auf `SessionRecord`

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/session.ts`,
`packages/core/src/db.ts`, `packages/core/src/sessionmanager.ts`, T2.7
(`EPIC-P2-diff-approvals-budgets.md`)

## Kontext

T2.7 verlangt: bei 100 % Budget-Verbrauch wird eine Session automatisch
`parked`, Fortsetzung nur nach einem expliziten Budget-Top-up (write-
Klasse). Sowohl der manuelle `park()`-Aufruf (bestehend seit P0) als auch
der neue automatische Budget-Park und der neue Tages-Cap-Park landen alle
im selben Status `"parked"` — ohne ein zusätzliches Feld kann weder die
PWA noch `SessionManager` selbst unterscheiden, *warum* eine Session
geparkt ist, und ein Top-up dürfte eine manuell geparkte Session nicht
einfach automatisch wieder anlaufen lassen, nur weil zufällig ein neues
Budget gesetzt wurde.

## Entscheidung

`SessionRecord` bekommt ein neues optionales Feld:

```ts
/** T2.7: warum eine "parked"-Session pausiert ist — null für jeden
 *  anderen Status oder eine manuell (park()) geparkte Session. Ein
 *  Budget-Top-up darf eine Session nur dann automatisch fortsetzen, wenn
 *  sie tatsächlich wegen Budgets pausiert wurde, nie bei "manual". */
parkReason: z.enum(["manual", "budget", "daily_cap"]).nullable().default(null),
```

Persistiert als neue SQLite-Spalte `park_reason TEXT` (Migration 6,
additiv, `NULL` für alle bestehenden Zeilen — exakt das gleiche additive
Muster wie `worktree_sha`, `cost_usd`, `tokens_est`). Real K7-tauglich,
weil es eine normale Spalte auf `sessions` ist: `list()`/`get()` lesen sie
automatisch mit, kein separater Recovery-Pfad nötig.

`park()` setzt `parkReason: "manual"`; die neue automatische
Budget-/Tages-Cap-Logik in `emitEvents()` setzt `"budget"` bzw.
`"daily_cap"`. `SessionManager.applyBudgetTopUp()` (T2.7) resumed die
Session nur, wenn `parkReason === "budget"` — eine manuell geparkte oder
wegen Tages-Cap pausierte Session bleibt bei einem reinen Budget-Top-up
unangetastet (der Tages-Cap ist ein Hub-weites, nicht Session-eigenes
Limit; es zu umgehen erfordert etwas anderes als ein Top-up dieser einen
Session).

## Konsequenzen

- Additiv, rückwärtskompatibel — jeder bestehende Aufrufer/Test, der
  `parkReason` ignoriert, bleibt unbetroffen.
- `stop()`/`setStatus()` setzen `parkReason` beim Verlassen von `"parked"`
  implizit nicht zurück auf `null` in den bereits bestehenden Transitions
  — T2.7 ergänzt das explizit dort, wo eine Session `"parked"` verlässt,
  damit das Feld nie einen veralteten Grund für einen längst nicht mehr
  geparkten Zustand zeigt.
