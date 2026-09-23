# ADR-0015 — Provider-Fehler in Worten und Benachrichtigungen

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/provider-error.ts`,
`packages/contracts/src/notification.ts`, `packages/core/src/notifications.ts`,
`packages/core/src/sessionmanager.ts` (Migration 9, `notifications()`,
Übergang `error → working`), `packages/adapter-{opencode,claude,codex}`,
`GET /api/notifications`, PWA `Notifications.tsx`

## Kontext

Ein Lauf mit OpenCode/glm-5.3 (2026-09-23) zeigte nur „unhandled event type
"error"“, „process exited with code 1“ und „adapter.down“. OpenCode hatte
`{"type":"error","error":{"name":"UnknownError","data":{"message":"Unexpected
server error…","ref":"err_9508ce50"}}}` geschickt; der Inhalt wurde verworfen.
Danach stand die Session auf `error`, ohne Weg zurück. Status-Änderungen und
Fehler anderer Sessions sah man nur, wenn man sie gerade offen hatte.

## Entscheidung

1. **Fehler in Worten.** `classifyProviderError(text, ref)` ordnet den Text
   der CLI einer Kategorie zu (`quota`, `rate_limit`, `auth`, `network`,
   `server`, `unknown`) und liefert Titel und Handlungshinweis, bei
   Kontingent mit Fenster und Freigabezeit, wie der Provider sie schreibt.
   Nur Textabgleich: ein undurchsichtiger Serverfehler bleibt „Serverfehler“
   und sagt, dass die CLI keine Ursache nennt. `providerErrorEvent()` ist das
   eine Event (`kind: provider.error`), das opencode, claude und codex senden.
2. **Fehlgeschlagener Zug ≠ tote Session.** `error → working` ist erlaubt;
   der nächste Prompt startet einen neuen Zug (ADR-0013 zählt ihn).
3. **Benachrichtigungen.** Der SessionManager leitet aus Events Meldungen ab
   (`notificationFor`: Provider-Fehler, Start-/Recovery-Fehler, Zug fertig,
   Freigabe nötig, Budget, Übernahme, nicht steuerbar). Ein Prozessende
   direkt nach einem gemeldeten Provider-Fehler wird nicht doppelt gemeldet.
   Gespeichert in `notifications` (Migration 9), abrufbar per
   `GET /api/notifications?after=<id>`.
4. **PWA.** Karten oben rechts in der Farbe der Stufe (Fehler 12 s,
   Warnung 8 s, sonst 5 s), antippen öffnet die Session. Glocke mit Zähler
   ungelesener Meldungen (pro Gerät) und Liste der letzten 100. Hub nicht
   erreichbar und wieder da wird ebenfalls gemeldet. Beim Öffnen der App
   werden alte Meldungen nicht erneut als Karte gezeigt.

## Konsequenzen

- Neue Provider-Fehlertexte ergänzt man in `classifyProviderError` mit Test.
- Copilot und aider haben keine eigene Fehlerzeile; bei ihnen bleibt
  „abgebrochen (Code n)“ mit Verweis auf den Verlauf.
- Meldungen werden nicht automatisch gelöscht; die Liste zeigt die neuesten.
