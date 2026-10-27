---
id: BUG-0067
slug: chat-zeigt-markdown-als-rohtext
status: done
severity: S3
area: pwa
instance: prod
commit: "c41b9a5"
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/22"
epic: "P8"
created: 2026-10-26
reporter: jan
---

# BUG-0067 — Chat zeigt Markdown der Agenten als Rohtext

## Gesehen

Antworten der Agenten erscheinen im Chat mit ihren Markdown-Zeichen:
`## Überschrift`, `**fett**`, `- Liste`, Code-Zäune mit ```` ``` ```` und Tabellen
als `|`-Zeilen. Lange Antworten sind dadurch schwer lesbar.

## Erwartet

Überschriften, Hervorhebungen, Listen, Inline-Code, Code-Blöcke, Links und
Tabellen erscheinen formatiert. Agenten-Text bleibt **Daten**: kein rohes
HTML, keine Skripte, keine `javascript:`-Links (PRD §8.5,
Prompt-Injection-Grenze).

## Repro

Voraussetzung: Produktiv-Hub, Claude-Session `587a143d-…` (diese Session).

1. In der PWA die Session öffnen, Tab „Chat“.
2. Die Antwort `#204` (22:50:00) oder `#43` ansehen.

**Ergebnis nach Schritt 2:** Markdown-Zeichen stehen wörtlich im Text.

**Häufigkeit:** immer, bei jeder Antwort mit Markdown.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `c41b9a5` |
| Node-Version | v26.7.0 |
| Adapter | claude (alle Adapter betroffen) |
| Repro-Weg | PWA (Nutzer, 2026-10-26), Code-Pfad nachgeprüft |

## Logs

Event-Store der Session, Antwort-Events (nur Länge und Felder):

```text
2026-10-26T22:43:58.937Z #43  assistant payload.text  191 B
2026-10-26T22:50:00.036Z #204 assistant payload.text  220 B
```

Der Text kommt unverändert an. Die Darstellung ist der Fehler, nicht der
Transport.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/features/session/event-text.test.ts` | grün, prüft nur die Textauswahl |
| E2E | `e2e/specs/` | kein Spec prüft formatierte Antworten |

Diese Tests müssten ohne Fix rot sein: ein neuer Unit-Test für einen
Markdown-Renderer (`apps/pwa/test/shared/markdown.test.ts`). Er prüft die
Formatierung und dass HTML/Script im Agenten-Text als Text erscheint. Dazu ein
E2E-Schritt: eine Antwort mit `**fett**` erscheint als `<strong>`.

## Eingrenzung

- `apps/pwa/src/features/session/EventRow.tsx:198`: `<div class="summary prose">{visibleEventText(event)}</div>`
  gibt den Text roh aus.
- `apps/pwa/src/app/styles/04-chips-and-forms.css:143`: `.prose` hat nur
  `white-space: pre-wrap`.
- Die PWA hat keinen Markdown-Renderer. `highlight.js` ist schon Abhängigkeit
  (Code-Viewer, T7.6).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` oder offen lassen
