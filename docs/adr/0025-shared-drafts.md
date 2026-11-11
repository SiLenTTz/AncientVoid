# ADR-0025 — Entwürfe: lokal sofort, auf dem Hub mit Revision, nie ein Sendeauftrag

**Status:** akzeptiert · **Betrifft:** EPIC-P8 T8.4, AC-P8-4,
`packages/contracts/src/sessions/draft.ts`, `DraftStore` (Migration 18),
`GET/PUT /api/sessions/:id/draft`, Policy `drafts.write`,
PWA `features/session/draft.ts`

## Kontext

Eine halb geschriebene Antwort ging bisher verloren. Das passierte beim
Wechsel in die Übersicht, beim Neuladen, bei einem PWA-Update und beim Wechsel
vom Handy an den PC. P5 hat idempotente Eingaben gebaut (`inputId`, Lease).
Die gelten erst beim Senden, vorher gibt es nichts.

## Entscheidung

1. **Ein geteilter Entwurf je Session** auf dem Hub. Er besteht aus Text,
   Anhang-IDs, Revision, Zeit und dem Gerätelabel des letzten Schreibers.
   Ein leerer Entwurf bleibt als Zeile stehen, damit die Revision
   weiterzählt.
2. **Optimistische Nebenläufigkeit:** `PUT` nennt `baseRevision`. Passt sie
   nicht und unterscheidet sich der Inhalt, antwortet der Hub mit
   **409 plus dem aktuellen Stand**. Die PWA zeigt beide Stände zur Wahl:
   „Deren übernehmen“ oder „Meinen behalten“. Gleicher Inhalt von zwei
   Geräten ist kein Konflikt.
3. **Lokal zuerst:** Jede Eingabe landet sofort in `localStorage`
   (`ancientvoid.draft.<host>.<session>`, mit `dirty`) und nach 700 ms auf dem Hub.
   Offline bleibt sie lokal, der Hinweis lautet dann „nur auf diesem Gerät“.
   Beim Öffnen entscheidet `reconcile()`: lokale ungesendete Änderung auf
   derselben Revision wird nachgeschoben, beide geändert ergibt einen
   Konflikt, sonst gilt der Hub-Stand.
4. **Nie ein Sendeauftrag:** Ein Entwurf füllt nur das Feld. Senden bleibt
   ein Tippen und läuft über den P5-Weg (`inputId`, Lease). Nach
   erfolgreichem Senden wird der Entwurf auf dem Hub und lokal geleert.
5. **Wer:** Entwürfe gehören Menschen. Agenten lesen und schreiben sie nicht
   (`drafts.write`: Agent und Bridge nein). Ein Heim-Hub (Flotte) darf für
   sein Handy. Der Flotten-Proxy reicht `PUT` durch.
   *Fortgeschrieben durch [ADR-0069](0069-display-schreibt-session-entwurf.md):
   Display-Akteure (`display:<name>`) dürfen den Composer-Entwurf schreiben
   (z. B. VoidWarden-Stimme) — weiterhin kein Senden/Steer.*
6. **Neue Session:** Der Start-Prompt ist ein lokaler Entwurf auf dem Gerät.
   Zuletzt gewählter Host, Harness und Projekt werden vorbelegt.
7. **Gerätewechsel:** Ein anderes Token löscht lokale Entwürfe und den
   API-Cache (T8.2).

## Folgen

- Ein Gerät, das nur zuschaut, folgt dem Entwurf eines anderen alle 4 s.
  Ein Gerät mit eigenen ungesendeten Änderungen folgt nicht, das führt zum
  Konflikt beim Speichern.
- Anhänge im Entwurf sind nur IDs. Die Dateien liegen ohnehin nach Hash im
  Hub (ADR-0022).
