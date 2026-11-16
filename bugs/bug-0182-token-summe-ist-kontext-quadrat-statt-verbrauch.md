---
id: BUG-0182
slug: token-summe-ist-kontext-quadrat-statt-verbrauch
status: in Arbeit
severity: S1
area: pwa
instance: prod
commit: ""
forge: ""
epic: ""
created: 2026-11-16
reporter: kai (Handy über Tailnet)
---

# BUG-0182 — „Σ 244.707.213 Tokens“ ist der Kontext, quadratisch aufaddiert

## Gesehen

In der Statuszeile einer laufenden Pi-Session (diese Session, `18830ec6`):

```text
∑ 244.707.213 Tokens · Kontext 84 % · frei 40.936 von 262.144
```

244 Millionen Tokens für eine Session, in der der Agent spürbar weniger Text
hervorgebracht hat. Kai: „kann nur Fake sein“.

## Gemessen (an der echten Historie)

`data/sessions/18830ec6-…/events.jsonl`, 7.748 Events:

| Größe | Wert |
|---|---|
| Events mit `tokensEst` (alle `system/pi.usage`) | 1.744 |
| **Summe `tokensEst`** (das ist die angezeigte Zahl) | **272.613.546** |
| davon `usage.input` (Kontext, den jeder Aufruf mitbekam) | 271.666.206 |
| davon `usage.output` (was der Agent tatsächlich schrieb) | **947.340** |
| Kontext pro Aufruf: Median / Maximum | 156.447 / 251.927 |

Die Zahl ist also **nicht erfunden** — sie ist die Summe dessen, was 1.744
Modell-Aufrufe jeweils an Kontext *durchgeschoben* haben. weil jeder Aufruf
den ganzen Verlauf mitschickt, wird derselbe Kontext ~1.700-mal gezählt. Als
„Σ Tokens“ nebeneinander mit „Kontext 84 %“ liest sich das wie Verbrauch, und
das ist es nicht: erzeugt wurden 947 T Tokens.

## Erwartet

Zwei verschiedene, ehrliche Größen, klar beschriftet:

* **erzeugt** – Summe der gemeldeten Ausgabe-Tokens (947.340),
* **verarbeitet** – Summe dessen, was die Aufrufe an Kontext+Ausgabe bekommen
  haben (272,6 Mio), erkennbar als solche.

Ein einzelner „Σ Tokens“-Wert, der Kontext-Wiederholungen aufaddiert, darf nicht
mehr als Token-Verbrauch erscheinen. Unbekanntes bleibt unbekannt (ADR-0032).

## Ursache

* `packages/core/src/modules/sessions/session-manager.ts:2635` summiert
  `event.tokensEst` pro Event in `record.tokensEst` (ADR-0006) — ein Feld, das pro
  Event *die Größe dieses Aufrufs* meint, nicht den Verbrauch der Session.
* `apps/pwa/src/features/session/StatusLine.tsx:27` druckt genau diese Summe als
  `Σ … Tokens`. Der Ausgabanteil (`usage.output`) ist in der Oberfläche nirgends
  sichtbar.
* DieAdapter melden unterschiedliche Formen (`usage.input/output`,
  `usage.inputTokens/outputTokens`, `cachedInputTokens`), eine Session-weite
  Aufbereitung existiert nicht.

## Repro

1. Pi-Session mit vielen Modell-Aufrufen laufen lassen (agentic, viele Tool-Rufe).
2. Statuszeile ansehen, danach `events.jsonl` auswerten.

**Ergebnis:** Anzeige ≈ Summe aller `tokensEst`; davon > 99,6 % Kontext.

**Häufigkeit:** jede längere Session; wächst quadratisch mit der Zahl der Aufrufe.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Windows-Host, Hub `127.0.0.1:7373`, Adapter `pi` mit lokalem Modell |
| Commit | `main` nach PR #41 (`9a21e15f`) |
| Repro-Weg | Auswertung `events.jsonl` + Statuszeile im Browser |

## Logs

```text
usage.input  median=156,447 min=12,629 max=251,927 sum=271,666,206  (n=1.735)
usage.output median=374     min=53    max=4,632   sum=947,340
Σ-Anzeige 244.707.213 (Stand beim Fotografieren) → Summe aller tokensEst
```

## Tests

| Ring | Datei / Fall | Stand |
|---|---|---|
| Unit | `packages/core/test/.../token-totals.test.ts` | offen |
| Hub | Route `GET /api/sessions/:id/tokens` | offen |
| E2E | `e2e/specs/token-bilanz.spec.ts` | offen |

## Schrittstand

- [x] Messung an echter Historie (Zahlen oben)
- [ ] ADR-0084: was „erzeugt“, „verarbeitet“, „geschätzt“ bedeutet
- [ ] Core-Auswertung über den EventStore (abgeleitet, K7-fähig)
- [ ] Hub-Route
- [ ] PWA: beschriftete Werte statt „Σ Tokens“
- [ ] E2E-Beweis
