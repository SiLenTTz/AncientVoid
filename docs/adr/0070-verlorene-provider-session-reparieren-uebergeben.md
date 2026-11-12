# ADR-0070: Reparieren und Übergeben bei verlorener Provider-Session

**Status:** akzeptiert (2026-11-12) · **Betrifft:** `packages/adapters/acp/` (`resumeNative`), `packages/core/src/modules/sessions/` (`repair`, `handoverDraft`, `nativeIdFromEvents`), `apps/hub/src/modules/sessions/sessions.routes.ts` (`/repair`), PWA `features/session/` (`handover.ts`, `Handover.tsx`), BUG-0123

## Kontext

Ein Hub-Session speichert die native ID der Provider-Session (`record.nativeSessionId`). Geht
diese beim Agenten verloren (maki-Store geleert/gewandert; live 2026-11-11:
„Resource not found: not found: CgwwyS3Xtsp6JntW2hnPw"), warf `resumeNative()` den
Load-Fehler fatal weiter: Jeder Prompt — auch „Weitermachen" — endete in
`session.start_failed`, die Session klemmte auf `error`. Der sichtbare Degrade-Pfad
(`acp.context_lost`) griff nur, wenn der Agent `loadSession` gar nicht deklariert, nicht wenn
die konkrete ID unbekannt ist. Die Handover-Maschinerie (EPIC-P21) war nur für
`provider.error`-Kategorien erreichbar.

## Entscheidung

1. **Adapter degradiert statt zu sterben.** `session/load` antwortet für diese ID
   „not found" → `resumeNative()` liefert `"lost"`, emittiert `acp.context_lost`
   (`lostSessionId`, `cause`) und der Aufrufer startet eine frische native Session; der
   Prompt läuft dort. Die neue Bindung folgt über das übliche `acp.native_session`-Fold.
   Andere Load-Fehler (Timeout, Internal) bleiben fatal.
2. **Reparieren (dieselbe Session).** `POST /api/sessions/:id/repair` (nur Menschen,
   wie Resume/Handover): `SessionManager.repair()` verwirft die tote Bindung sichtbar
   (`session.native_binding_dropped`, Feld bewusst `staleNativeId` — das Record-Fold
   greift nur `nativeSessionId`) und setzt den Übergabe-Entwurf
   (`handoverDraft`: Auftrag, letzter Stand, Grund) als nächsten Prompt über
   `continueStopped` — der Hub-Verlauf ist der einzige überlebende Kontext.
   Für `stopped`/`error`/`interrupted`. Sonderfall `idle` direkt nach Degrade
   (promptloses Resume/Adoption): Bindung ist schon frisch, nur der Kontext-Feed fehlt —
   der Entwurf wird in den lebenden Worker gesteert, ohne Neustart.
3. **Übergeben (andere Session).** `currentProviderFailure` (PWA) und `handoverDraft`
   (Core) erkennen die Klasse als Kategorie `session` („Provider-Session verloren" /
   „Agent hat den Verlauf verloren"): `session.start_failed` mit „Resource not found"
   (Altvorrat) und `acp.context_lost` (Adapter). Die Handover-Bar bietet beide Wege:
   „Hier weitermachen (Kontext neu aufbauen)" und die bestehende Übergabe-Form.
4. **K7:** Der Verlust ist ein Event, die Reparatur ist Events — JSONL + Snapshot
   rekonstruieren Bindung und Zustand ohne Sonderweg.

## Folgen

- `nativeIdFromEvents` respektiert `session.native_binding_dropped`: alles Davor
  (tote Announces) bleibt tot, nur ein späteres Announce bindet neu.
- Kein Contract-Bruch: neue Route, neue Event-Kinds und eine additive Kategorie;
  `HANDOVER_CATEGORIES` erhielt `session`.
- Grenze: Ein Kontextverlust, auf den bereits eine Antwort folgte (Prompt lief im
  frischen Kontext), zeigt keine Leiste mehr — die Detector-Regel (Antwort schließt ab)
  gilt weiter; die Reparatur bleibt über die Route/API erreichbar.
