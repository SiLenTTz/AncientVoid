---
id: BUG-0068
slug: lange-antwort-im-chat-gekuerzt
status: open
severity: S2
area: pwa
instance: prod
commit: "c41b9a5"
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/23"
epic: "P1"
created: 2026-10-26
reporter: jan
---

# BUG-0068 — Antworten über 4 KB zeigt der Chat nur mit 200 Zeichen

## Gesehen

Eine lange Agenten-Antwort (hier 4999 Byte) erscheint im Chat als einzeilige
Zusammenfassung mit 200 Zeichen und endet auf „…“. Codeblock-Zäune sind darin
zu einer Zeile zusammengezogen. Der Rest ist nur nach dem Aufklappen als rohes
JSON zu sehen.

## Erwartet

Der Chat zeigt die vollständige Antwort. Der Text liegt laut K5 im Blob, die
PWA lädt ihn nach. Solange er lädt oder wenn das Laden fehlschlägt, zeigt sie
die Vorschau mit einem sichtbaren Hinweis (fail loud).

## Repro

Voraussetzung: Produktiv-Hub, Claude-Session `587a143d-…`.

1. In der PWA die Session öffnen, Tab „Chat“.
2. Die Antwort `#191` (22:47:25) ansehen.

**Ergebnis nach Schritt 2:** nur 200 Zeichen, die mit
„… ```text Bug: BUG-0065 — pi-V…“ enden.

**Häufigkeit:** immer, wenn ein Antwort-Payload 4 KB übersteigt.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `c41b9a5` |
| Node-Version | v26.7.0 |
| Adapter | claude (alle Adapter betroffen) |
| Repro-Weg | PWA (Nutzer, 2026-10-26), Event-Daten nachgeprüft |

## Logs

Event `#191` im Event-Store (Text gekürzt):

```text
2026-10-26T22:47:25.491Z #191 assistant blobRef sha256:35af…
payload: { truncated: true, bytes: 4999, preview: "{\"text\":\"Ich habe Punkt 1 …" (256 Zeichen) }
summary: "Ich habe Punkt 1 analysiert … ```text Bug: BUG-0065 — pi-V…" (200 Zeichen)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/features/session/event-text.test.ts` | grün, kein Fall für ein ausgelagertes Payload |
| E2E | `e2e/specs/` | keine lange Antwort im Chat geprüft |

Dieser Test müsste ohne Fix rot sein: ein Fall in `event-text.test.ts`, in dem
ein Antwort-Event mit `blobRef` und `{truncated, preview}` nach dem Nachladen
den vollen Text liefert, sowie ein E2E-Spec mit einer Antwort über 4 KB, deren
Ende im Chat sichtbar ist.

## Eingrenzung

- `apps/pwa/src/features/session/event-text.ts:8-20`: ohne `payload.text`
  bleibt nur `event.summary`.
- Der EventStore ersetzt das Payload über 4 KB durch `{truncated, bytes,
  preview}` und `blobRef` (K5, korrekt).
- `EventRow.tsx:26-45` lädt den Blob nur in der aufgeklappten Detailansicht und
  zeigt ihn dort als rohes JSON in `<pre>`.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` oder offen lassen
