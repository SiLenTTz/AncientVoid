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

## Nachtrag 2026-11-15 — Wichtiges first: Sektionen, Laufende statt Tool-Ende, Fehler erst beim Abbruch

Nutzerfund: die Glocke flutete mit „Zug fertig“ und Einzelfehlern, Fehler und
Rückfragen gingen unter. Drei Regeln:

1. **Drei Sektionen im Panel.** „Fehler“ (level error) und „Offene Fragen“
   (Freigabe-/Rückfrage-Meldungen, deren Freigabe laut Warteschlange noch
   aussteht — live geprüft gegen `/api/approvals?status=pending`, eigener Hub
   und Peers) stehen angepinnt oben, „Übrige Meldungen“ darunter. Eine
   beantwortete Frage rutscht automatisch in die übrigen Meldungen.
2. **„Zug fertig“ nur am echten Laufende.** `SessionActivities.closeIfLast`
   und `SessionManager.endActivity` schließen den Lauf nicht mehr, während
   der Hauptzug läuft (`mainTurnIdle === false`) — persistente Adapter
   (ACP, app-server) melden jeden Tool-Call als Aktivität, und die Lücke
   zwischen zwei sequenziellen Werkzeugen war fälschlich ein Laufende
   (vorzeitiges `session.turn_end`, Status-Flackern, „Zug fertig“ pro
   Tool-Call). Ausnahme bleibt externe Arbeit (ADR-0074): Ihr Ende schließt
   den Lauf wie vorher — sie meldet sich explizit und ist autoritativ.
   Ein fehlgeschlagenes Ende externer Arbeit beendet den Lauf jetzt ehrlich
   mit `turn_end {reason: "error", detail: <Label>}` statt success-idle.
3. **Fehler benennen erst beim Abbruch — einmal pro Lauf.**
   `provider.error` wird zurückgehalten (`LiveSession.pendingErrorDraft`);
   erst wenn der Lauf wirklich abbricht (`session.turn_end {reason:"error"}`,
   `session.interrupted`, `adapter.down`, Prozess-Ende,
   `session.recovery_blocked`, …), wird genau eine Fehler-Meldung
   gespeichert — mit den Worten des letzten Provider-Fehlers (Kontingent,
   Serverfehler …), sonst mit der jeweiligen Ursache (`session.turn_failed`,
   `session.recovery_blocked` sind neue Meldungs-Kinds, in
   `PUSH_KIND_CATEGORY` als „error“ gemappt). Ein Zug, der trotz
   Provider-Fehlers sauber endet, benachrichtigt gar nicht. Nach einem
   Abbruch bleiben Folge-Meldungen desselben Abbruchs (z. B. gescheitertes
   Auto-Resume) stumm; der nächste Prompt beginnt einen neuen Lauf. Die
   frühere 30-s-Unterdrückung (`recentProviderError`) ist damit entfallen —
   die Zurückhaltung gilt laufweit, nicht zeitfensterweit.

## Nachtrag 2026-11-20 — Vier Sektionen mit fester Farbbedeutung

Nutzerwunsch: „Fertig“-Meldungen und Main-Sync-Rückfragen gingen in der
Sammlung „Übrige Meldungen“ unter — sichtbar waren oft nur zwei Abschnitte.
Das Panel teilt jetzt in vier Abschnitte mit fester Farbe:

1. **Fehler** (rot, `--err`): level error.
2. **Rückfrage** (blau, `--info`): live offene Freigaben (`APPROVAL_KINDS`
   gegen die Pending-Warteschlange, wie bisher) **plus** die
   Entscheidungs-Kinds des Main-Syncs (`mainsync.behind_ask`,
   `mainsync.conflict` — gleiche Taxonomie wie der action-Glow, urgency.ts).
   Beantwortete Freigaben rutschen weiter in Sonstiges.
3. **Fertig** (grün, `--ok`): level success (`session.turn_end`,
   `session.applied`, `mainsync.applied`).
4. **Sonstiges** (gelb, `--warn`): Warnungen und Info.

Die Einteilung bleibt rein (`sections.ts`, `sectionOf`), das Einklapp-Verhalten
(Nutzerwunsch 2026-11-18) gilt unverändert je Abschnitt.

**Farbvertrag 2026-11-20 (zweite Nutzerentscheidung, gleichen Tag):** Blau
(`--info`) ist überall die Farbe für Rückfragen/Entscheidungs-Pflicht —
Glocken-Glow (`urgency-action`), Rückfrage-Sektion nebst ihrer Einträge,
Rückfrage-Toasts (`.toast.question`, Kinds wie Sektion und Glow) und das
Freigabe-Banner der Übersicht. Gelb (`--warn`) bleibt echten Warnungen
vorbehalten (Sonstiges-Sektion, Warn-Level-Toasts, Risk- und
Gatekeeper-Badges). Das löst die EPIC-P64-Farbwahl „gelb für offene
Fragen" ab; ein E2E-Farbvertragstest (notifications-glow.spec) pinnt die
Token-Zuordnung.
