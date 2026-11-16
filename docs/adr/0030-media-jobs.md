# ADR-0030 — Medien-Jobs: Video rein, Transkript, Schlüsselbilder und Kapitel als Session-Anhang raus

**Status:** akzeptiert · **Betrifft:** EPIC-P10.5, `packages/contracts/src/media/`,
`packages/core/src/modules/media/`, `apps/hub/src/modules/media/`, PWA `features/media/`

## Kontext

Du willst YouTube- und andere Videos analysieren können, den Ton und, wo
möglich, das Bild. Das Ergebnis soll eine Session als Material nutzen können.
Videos sind groß und langsam zu verarbeiten. Sie dürfen weder den Event-Strom
(K5) noch den Hub blockieren, und ein Neustart darf keine Stunde Arbeit
kosten.

## Entscheidung

1. **Ein Job, feste Schritte:**
   - `fetch`: yt-dlp oder ein Upload.
   - `probe`: ffprobe.
   - `audio`: zuerst die Untertitel des Anbieters, sonst whisper.cpp
     (ADR-0028), sonst Gemini, aber nur wenn der Job die Cloud erlaubt.
   - `frames`: ffmpeg wählt Bilder nach Szenenwechsel (Schwelle 0,08,
     höchstens eins je 2 s), dazu mindestens eins je Intervall. Danach werden
     Duplikate per dHash entfernt und höchstens `maxFrames` behalten.
   - `vision`: tesseract für den Text im Bild. Eine Beschreibung liefert nur
     ein lokales Bildmodell (`media.vision`) oder, wenn erlaubt, Gemini.
   - `merge`: die Zeitleiste.
   - `summarize`: das lokale Modell, sonst Gemini, wenn erlaubt, sonst
     Kapitel nach Zeit mit einem Hinweis.
2. **Wiederaufnahme:**
   - Jeder Schritt schreibt eine Datei nach `data/media/<id>/`.
   - Der Job-Datensatz (SQLite, Migration 20) sagt, welche Schritte fertig
     sind.
   - Nach einem Neustart setzt `resume()` beim ersten offenen Schritt fort
     (AC-P10.5-3).
   - Es läuft immer nur ein Job zur Zeit.
3. **Grenzen vor dem Download:**
   - Dauer (Standard 30 min) und Größe (500 MB) werden geprüft, bevor
     heruntergeladen wird.
   - Live-Streams werden abgelehnt.
   - Keine Links auf lokale oder Tailnet-Adressen und keine Zugangsdaten in
     der URL, damit der Hub kein Proxy ins eigene Netz wird.
   - Uploads werden gestreamt, nicht im Speicher gehalten.
4. **Egress je Schritt protokolliert**, als eigene Hardware oder Dritte
   markiert (AC-P10.5-2). Gemini wird nie ohne `allowCloud` gefragt, auch
   wenn ein Schlüssel hinterlegt ist.
5. **Aufbewahrung:** Rohvideo und Tonspur werden gelöscht, wenn der Job
   endet, egal wie er endet (`media.keepSource` zum Behalten). Transkript,
   Bilder und Ergebnis bleiben (AC-P10.5-4).
6. **Ergebnis als Anhang:**
   - `result.md` wird als ganz normaler Text-Anhang gespeichert (ADR-0022).
     Er enthält Zusammenfassung, Kapitel, Schlüsselbilder (Pfad, OCR,
     Beschreibung mit dem Zusatz „kann irren“) und das Transkript, alles mit
     Zeitmarken [m:ss].
   - Jeder Harness bekommt ihn also ohne neue Adapter-Fähigkeit.
   - Die PWA übergibt ihn mit „In Session verwenden“ an eine neue oder eine
     offene Session.
7. **In Worten erreichbar** (ADR-0027): `media.analyze` („Analysiere das
   Video <Link>“) und die Seite `media`. Die Policy-Operation
   `media.analyze` gilt nur für Menschen und die Flotte.

## Alternativen

- **Video direkt an den Harness:** Nur wenige können Videos, und das kostet
  viele Tokens. Verworfen.
- **Streaming-Pipeline ohne Zwischendateien:** Es gäbe keine Wiederaufnahme.
  Verworfen.
- **Szenen-Schwelle 0,3 (Kamera-Schnitte):** Folienwechsel liegen nur bei
  etwa 0,1 bis 0,16 (Messung). Deshalb 0,08 plus dHash.

## Folgen

- Der Hub braucht `ffmpeg` und `ffprobe`. Für Links braucht er `yt-dlp` samt
  JS-Laufzeit (deno), für OCR `tesseract`.
- YouTube antwortet gelegentlich mit 403 auf den ersten Download. Es gibt
  einen zweiten Versuch, danach eine klare Meldung.
- Ohne lokales Bildmodell gibt es nur OCR, keine Beschreibung. Ein lokales
  VLM ist konfigurierbar, wurde aber nicht gemessen (→ P12 T12.11).
