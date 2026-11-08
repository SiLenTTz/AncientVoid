# ADR-0055 — Review-Notizen im Diff mit Sammelfeedback über den bestehenden Steer-Pfad

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/reviews/`,
`packages/core/src/modules/reviews/`, `apps/hub/src/modules/reviews/`,
`apps/pwa/src/features/session/`, EPIC-P36 (T36.1–T36.5)

## Kontext

Nutzer sollen Änderungen am Handy und Desktop gezielt kommentieren und mehrere
Befunde als einen Folgeauftrag an eine Session senden (EPIC-P36). Die
Diff-Ansicht gliedert seit AC-P2-1 Commit-Abschnitte (`sha^..sha`) und den
uncommitteten Rest — Notizen müssen sich auf genau einen dieser Abschnitte
beziehen. Es existieren bereits: der Steer-Pfad mit `inputId`-Dedupe
(`session_inputs`, „in flight" → 422), die Session-Queue (ADR zu P15/P27,
at-most-once per `take()`), der EventStore mit 4-KB-Grenze und Blob-Offload
(K5) sowie Journal+Snapshot-Recovery (K7). Orca-Referenzen
(`diff-comment-types.ts`, `journal-unsent-send-hold.ts`) sind als Hypothese
geprüft: übernommen wird nur das Datenmodell-Denkmuster, kein Code — AV hat
mit EventStore/Steer bereits die Zustell- und Persistenzbasis, die Orca im
Chat-Journal selbst baut.

## Entscheidung

1. **Verträge zuerst, klein halten** (`packages/contracts/src/reviews/review.ts`):
   `ReviewNote` trägt `sessionId`, Text, Status sowie die **Diff-Identität**
   als `basis: {baseRef, headSha, scope}` — `scope` ist entweder
   `{kind:"commit", sha}` (immuabler Commit-Abschnitt) oder
   `{kind:"uncommitted"}` (Arbeitsverzeichnis-Rest, identifiziert über
   `baseRef`+`headSha`+Inhaltsabgleich). Der Anker (`anchor`) trägt Pfad,
   Seite (`old`/`new`), Zeilenbereich und einen **begrenzten Ausschnitt**
   (≤ 400 Zeichen) des Ankerumfelds. Zeilennummern allein sind kein Identitätsnachweis.

2. **Kein automatisches Verschieben veralteter Anker** (Out of Scope laut
   Epic): Wiedervorlage prüft (a) liegt `scope` noch im aktuellen Diff,
   (b) existiert der Pfad, (c) findet sich der Ausschnitt im Umfeld des
   Ankers wieder (± 15 Zeilen Toleranz). Jedes Nein → sichtbar `stale` mit
   benanntem Grund, nie still umgebogen. Commit-scoped Notizen bleiben gültig,
   solange der Commit im Diff-Bereich liegt — gleiche Datei/Zeile in zwei
   Commit-Abschnitten kollidiert nicht, weil der Scope Teil der Identität ist.

3. **Sammelversand über den bestehenden Steer-Pfad, kein zweites Queue-System**
   (EPIC-P36 §3.2/Premortem 3): `POST /api/sessions/:id/reviews/send` wählt
   Notizen und Empfänger-Session (Default: die geprüfte Session), zeigt den
   gebündelten Prompt vorab (PWA-Vorschau) und ruft intern
   `sessions.steer(target, {kind:"prompt", …}, …, {inputId: operationId})`.
   Die **Operations-ID ist die Steer-`inputId`** — Dedupe (`hasSeenInput`),
   In-Flight-Sperre (422), Revisionsschutz und `session_inputs`-Persistenz
   wirken damit unverändert für Doppelklick/Reconnect (AC-P36-2). Fehlende
   Harness-Fähigkeit (`features.followUp`) scheitert laut über
   `refuseSteer`-Meldung, Adapterfehler landen als `sendDetail` an der Notiz —
   Notiz bleibt Entwurf (AC-P36-5). Große Feedback-Pakete (> Schwellwert) gehen
   als Anhang (Attachment) mit, der Prompttext bleibt kompakt — kein neues
   Blob-Format (K5 bleibt beim EventStore, K3 unberührt ≤ 50 KB Startdiff).

4. **ReviewStore: Journal + Snapshot, keine SQLite-Insel** (K7, Epic §3.3):
   Kanonischer Zustand ist `<dataDir>/reviews/<sessionId>/notes.jsonl`
   (append-only: `note_created|note_updated|note_deleted|note_status|review_sent`,
   monoton vergeben, blob-frei da Ausschnitte begrenzt) plus
   `snapshot.json` (atomar via temporäre Datei + rename, merkt sich
   `appliedSeq`). Restore = Snapshot + Journal-Nachlauf; kaputte Journalzeilen
   werden wie im EventStore übersprungen und gezählt, nicht versteckt. Die
   Notizliste wird im Speicher gehalten; SQLite-Projektionen bewusst weggelassen
   („SQLite nur Projektion" — ohne Projektion gibt es nichts, was auseinander
   laufen kann). Zustand ist damit aus dem Datadir vollständig rekonstruierbar.

5. **Keine Review-Events im Session-Tail**: Notizmutationen gehen nicht in den
   EventStore der Session — der Tail bleibt Chat-/Statusstrom. Die PWA lädt
   Reviews beim Öffnen des Diff-Tabs und nach eigenen Mutationen neu
   (Draft-Muster). Dadern bleibt K5 für Reviews automatisch erfüllt: Es
   entstehen keine neuen Event-Payloads.

6. **Offline: lokaler Outbox-Entwurf, kein Scheinversand** (AC-P36-5): Die PWA
   hält nicht zustellbare Notizmutationen in einem localStorage-Outbox mit
   sichtbarem Zeitstempel („lokal, noch nicht gesendet") und spült sie bei
   `online`/nächstem erfolgreichen API-Kontakt nach. Versand ist offline
   gesperrt mit Grundangabe; API-Fehler behalten den Entwurf und zeigen die
   Ursache (`sendDetail`).

7. **Statusfaltung**: `draft → sent` nur durch erfolgreichen Sammelversand
   (oder Bestätigung einer unsicheren Zustellung), `sent → open → done` sind
   menschliche Setzungen; „erledigt" ist Review-Status, kein Testergebnis.
   Ein Sendevorgang mit unklarem Ausgang (422 in-flight nach Reconnect)
   markiert `sendDetail`, nie „gesendet".

## Konsequenzen

- P37 (Forge-Verknüpfung) kann an `ReviewScope`/`ReviewNote` andocken, ohne
  den Diff-Anker neu zu erfinden.
- Der Zustell-Audit (T36.1) bestätigt: at-most-once für Queue-Drain ist durch
  `take()`-Löschung garantiert, Steer-Dedupe übernimmt den Sammelversand —
  ein Exactly-once-Claim gegenüber fremden CLIs wird nicht getroffen
  (AC-P36-6); unbekannte Auswege bleiben sichtbar ungeklärt.
- Die Diff-Typen (`SessionDiffResult` …) bleiben, wo sie sind (Hub-Modul +
  PWA-Kopie); `reviews/review.ts` referenziert nur Primitive. Eine spätere
  Vereinheitlichung der Diff-Typen in Contracts ist eigener Vertragsschritt.
