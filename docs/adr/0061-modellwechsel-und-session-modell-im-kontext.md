# ADR-0061 — Modellwechsel für ACP-Harnesses und `AdapterContext.model`

**Status:** akzeptiert · **Betrifft:** `@ancientvoid/contracts` (`AdapterContext`), `packages/core` (`makeContext`),
`packages/adapters/acp` (maki, omp, opencode, dsh), `docs/harness-matrix.md` ·
Messlatten: **K7** (Zustand aus JSONL + Snapshot rekonstruierbar), **K5** (Events ≤ 4 KB), „fail loud“

## Kontext

maki und omp sind keine eigenen Adapter, sondern Presets des ACP-Adapters (`packages/adapters/acp/src/index.ts`).
Die Modellwahl **beim Start** gibt es schon (`spec.model` → `selectModel`, strikt: unbekanntes Modell lässt den
Start sichtbar scheitern; `config.model` als Default; Katalog per ACP-Probe, ADR-0018/0054). Zwei Lücken
(Scan 2026-11-10):

1. **Das Modell einer Session geht beim Wecken verloren.** `wake()` (Agent endet zwischen Zügen von selbst oder
   Hub-Neustart, `dormant`) wendet `cfg.model` an — nie das Modell der Session. Eine Session, die auf
   `zai/glm-5.3-flash` gestartet wurde, läuft nach einem Neustart wieder auf dem Config-Default. Der
   Adapter hat in `recover()` keinen Zugriff auf das Modell; der Hub hält es aber persistiert
   (`record.model`, Event `session.configured`).
2. **Kein Wechsel in der laufenden Session.** `configure` lehnt der ACP-Adapter pauschal ab, und
   `modelSwitch` ist `false` — obwohl ACP `session/set_config_option` jederzeit erlaubt. Die PWA bietet
   den Wechsel (ADR-0033) deshalb für maki/omp nicht an.

## Entscheidung

1. **Contract:** `AdapterContext.model?: string | null` — das Modell der Session, wie der Hub es zuletzt
   aufgezeichnet hat (Getter, wie `nativeSessionId`; `null` = keins gewählt). Rein additiv, optional.
   Quelle ist `record.model` (persistiert, vom Event `session.configured` nachgezogen) — damit ist der
   Recovery-Pfad (K7) der vorhandene; es entsteht **keine neue State-Quelle**.
2. **ACP `wake()`** wendet `ctx.model ?? cfg.model` an (Priorität: Session vor Registrierung); auch der Fallback
   „Agent kann nicht laden → neuer Kontext“ bekommt es. Nicht angebotenes Modell: unverändert das sichtbare
   `acp.model_unavailable` (nichts wird beim Laden verweigert, ADR-0041).
3. **ACP `configure`** mit `model`: nur bei laufendem Agent im Leerlauf, über dieselbe Auswahl wie beim Start
   (`pickModel` → `session/set_config_option`/`set_model`), Event `acp.model` (mit Kontextfenster, K5-klein).
   Nicht angeboten → `Ack{ok:false}` mit Modellname **und** Event `acp.model_unavailable`; die Session bleibt auf
   ihrem Modell, der Hub trägt das neue nicht ein. Mitten im Zug → `ok:false` („erst nach dem Zug“) statt
   stiller Wirkung. Schlafende Session: `ok:true`, angewandt beim Wecken (Punkt 2). `permissionMode`
   bleibt abgelehnt (ACP-Presets deklarieren keine Modi).
4. **`modelSwitch`** ist für ACP-Registrierungen genau dann `true`, wenn `modelChoice` `"start"` ist.
5. **Kein neuer Konfigurationsweg:** Modell pro Adapter = `config.model`, pro Session = Start-Formular bzw.
   `configure`, Katalog/eigene Modelle = ADR-0054/0060.

## Konsequenzen

- Hub: `makeContext` liefert `model`; nichts anderes ändert sich (Configure-Route und Features-Prüfung
  existieren, ADR-0033).
- Tests: `packages/adapters/acp/test/adapter.test.ts` („ADR-0061 …“, rot-dann-grün), Contract-Suite des
  Testkits unverändert grün.
- Offen bleibt Reasoning/Thinking-Stufe pro Modell (maki `init.lua`, omp) — nicht Teil dieses ADR.
