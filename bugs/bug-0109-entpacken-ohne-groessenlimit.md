---
id: BUG-0109
slug: entpacken-ohne-groessenlimit
status: done
severity: S3
area: core
instance: dev
commit: "7d0ab0b"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/43"
epic: "EPIC-P7 T7.10 / ADR-0022 (Attachments)"
created: 2026-11-10
reporter: "Sicherheitsaudit (pi)"
---

# BUG-0109 — Office-Expacken ohne Entpackgrößenlimit (Decompression-Bombe)

## Gesehen

Ein 4,9 MB DOCX (unter dem 25-MB-Limit) mit zwölf hochkomprimierbaren
Einträgen à 400 MB lässt den laufenden Hub beim Extraprozess von
~128 MB auf ~4,9 GB RSS anwachsen — der Wert bleibt danach oben.
`officeText()` ruft `unzipSync(bytes)` ohne jedes Filter/Größenlimit auf;
das Input-Limit (`MAX_ATTACHMENT_BYTES`, 25 MB) begrenzt nur die komprimierte
Datei, nicht die entpackte Menge, und der Upgrade-Pfad läuft pro Request im
Hub-Prozess (fflate synchron → blockiert nebenbei die Event-Loop). Ein einzelner
unauffälliger Upload — genau der normale Weg, auf dem Dateien ins System
kommen — kann den Hub auf einem RAM-armen Host damit OOM-kicken; die
Storage-Seite ist nicht betroffen.

## Erwartet

Ein Limit für die Entpackmenge (K5-Geist: alles Große hat eine Obergrenze,
und die Obergrenze wird an der Grenze geprüft, nicht nur beim Input);
eine Bombe sollte sichtbar scheitern, nicht den Hub in die Knie zwingen.
Der Fail-loud-Pfad selbst funktioniert: als die Einzelvariante (2 GB in
einem Eintrag) über V8s String-Limit stolperte, wurde der Fehlschlag sauber
als `extraction.status=failed` mit Grund protokolliert.

## Repro

Voraussetzung: laufender Hub (hier Testinstanz `127.0.0.1:7979`, frische DB,
kein PWA nötig — der Upload-Pfad ist exakt der der PWA).

1. DOCX-Bombe bauen: ZIP mit `word/document.xml` sowie 12 weiteren Einträgen
   à 400 MB `A`-Füllung (deflate ⇒ Datei 4,9 MB).
2. `curl -s http://127.0.0.1:7979/api/health` → `rssMb: 128`.
3. `curl -X POST --data-binary @bomb.docx -H 'content-type: application/vnd.openxmlformats-officedocument.wordprocessingml.document' -H 'x-filename: bomb.docx' -H "Authorization: Bearer <token>" http://127.0.0.1:7979/api/attachments` → 201.
4. ~20 s warten, abermals `health` → `rssMb: 4929` (bleibt danach oben);
   der Record zeigt `extraction.status=done, chars=1024` — entpackt wurden
   trotzdem alle 4,8 GB.
5. Variante mit einem einzigen 2-GB-Eintrag (Datei 2,0 MB): Extraction
   `failed` mit `Cannot create a string longer than 0x1fffffe8 characters`,
   RSS zwischenzeitlich 2135 MB.

**Ergebnis nach Schritt 4:** ~38-fache Speicher-Vervielfachung relativ zur
Dateigröße, dauerhaft; Memory-Check meldet weiterhin `ok`.
**Häufigkeit:** immer.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (Testinstanz `127.0.0.1:7979`, frische DB) |
| Commit | `7d0ab0b` |
| Node-Version | v26.7.0 |
| Adapter | keiner nötig |
| Repro-Weg | API direkt (PWA-Upload-Pfad, identischer Handler); PWA selbst nicht geklickt |

## Logs

Quelle: Hub-Log der Testinstanz (Auszug, Tokens redacted).

```text
{"ts":"2026-11-10T00:16:21.456Z","level":30,"reqId":"req-8","req":{"method":"POST","url":"/api/attachments",...},"res":{"statusCode":201},"msg":"request completed"}   ← 2-GB-Variante
{"ts":"2026-11-10T00:18:36.179Z","level":30,"reqId":"req-c","req":{"method":"POST","url":"/api/attachments",...},"res":{"statusCode":201},"msg":"request completed"}   ← 12×400MB-Bombe
```

Gesundheitswerte vor/nach Schritt 3: `rssMb 128 → 4943 → 4929` (bleibt);
Rekord des Bomben-Anhangs: `extraction {status: done, method: office, chars: 1024}`.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/modules/attachments/extract-bomb.test.ts` — `officeText()` mit ungenutztem Bomben-Eintrag entpackt ihn nicht (Filter-Weißbox); benötigter Part über Limit (128 MB) wirft definiert | rot ohne Fix ( kein Filter, kein Wurf), grün mit Fix |
| Contract (`adapter-testkit`) | n. z. | |

## Eingrenzung

`packages/core/src/modules/attachments/extract.ts` — `officeText()` (Zeile
`const files = unzipSync(bytes)`, ohne Options); Aufruferkette
`AttachmentStore.extract()` ← `POST /api/attachments`. fflate kann
`filter`/`maxSize` — genutzt wird nichts davon.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` oder offen lassen

## Fix (verifiziert 2026-11-10, pi/halogen-qwen3.8)

- Fix: Commit `6d3d999` — `officeText()` entpackt per `unzipSync`-Filter nur
  noch die Parts, die es tatsächlich liest (ungebrauchte Bomben-Einträge
  werden nie inflatiert), und wirft für einen benötigten Part über
  128 MB Limit definiert (sichtbares `extraction.status=failed` statt
  V8-String-Crash/RSS-Spike). Bestehende Fixture-Tests (DOCX/XLSX/PPTX)
  bleiben grün.
- Verifikation: `npx vitest run packages/core/test/modules/attachments/`
  grün (8/8, neuer Test rot ohne Fix); volles Gate `npm run gate` grün
  (inkl. e2e 425 passed / 2 skipped).
