---
id: BUG-0059
slug: dsh-deklariert-bilder-ohne-bildeingabe
status: done
severity: S3
area: adapters
instance: prod
commit: ""
forge: ""
epic: "P7"
created: 2026-10-21
reporter: jan
---

# BUG-0059 — dsh: Adapter deklariert Bilder, der Agent nimmt keine Bildeingabe

## Gesehen

Der ACP-Adapter meldete für das Preset `dsh` `features.images: true`. `dsh` 0.2.1-rc.2
antwortet auf `initialize` mit `promptCapabilities.image: false`, und GLM-5.3 lehnt Bilder ab
(`model "glm-5.3" does not declare image input`). Ein hochgeladenes Bild kommt beim Agenten als
OCR-Text (tesseract) an, nicht als Bild. Die Oberfläche zeigte trotzdem den Chip „Bilder".

## Erwartet

Die Fähigkeit stimmt mit dem Verhalten überein: `images: false`, `files: true`. Anhänge erreichen
den Agenten weiter als Text.

## Repro

1. Hub mit `{"preset":"dsh","model":"zai/glm-5.3"}`, Bild mit Text hochladen (`POST /api/attachments`).
2. Session mit `attachmentIds` starten und nach dem Inhalt fragen.

**Ergebnis:** Der Agent nennt den Text korrekt (OCR). `GET /api/health` zeigt `images: true`.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| dsh | 0.2.1-rc.2 |
| Adapter | deepseek (acp, preset dsh) |
| Repro-Weg | HTTP-API, Sidecar-Hub |

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Adapter | `packages/adapters/acp/test/adapter.test.ts` „BUG-0059" | rot ohne Fix |
| Matrix | `node scripts/check-adapter-matrix.mjs` | grün nach Anpassung der Zeile `acp · dsh` |

## Eingrenzung

`packages/adapters/acp/src/index.ts`: `features.images` war fest `true` für jedes Preset.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Fix in derselben MR
- Hinweis: Bilder ohne lesbaren Text (Fotos) erreichen dsh nicht inhaltlich; dafür bräuchte es ein
  Vision-Modell oder die Gemini-Auslese (`ocr`-Konfiguration).
