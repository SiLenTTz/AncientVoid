# EPIC-P10.5 — Medien- und Video-Analyse

**Status:** abgeschlossen (2026-09-24, Retro unten; Wunsch vom 2026-09-24) · **Phase:** P10.5 · **Dauer:** 1–3 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P7 T7.10 (Anhänge mit Inhaltsauslese) und P10 (lokale Spracherkennung) grün.

## 1. Ziel

Ein Video wird zum Arbeitsmaterial einer Session: YouTube-Link oder eigene
Datei rein, heraus kommen Transkript mit Zeitmarken, Kapitel, Schlüsselbilder
mit Beschreibung und eine Zusammenfassung. Der Agent kann daraus zitieren und
auf Zeitpunkte verweisen, am Handy lässt sich an die Stelle springen.

## 2. Scope (In / Out)

**In:** YouTube- und andere Video-Links (yt-dlp), hochgeladene Videodateien
(MP4/WebM/MOV/MKV), Audio-Spur → Transkript (lokale STT aus P10, Untertitel
des Anbieters bevorzugt), Bildspur → Szenenwechsel und Schlüsselbilder
(ffmpeg) → Beschreibung/OCR (lokales Vision-Modell oder Gemini mit
konfiguriertem Schlüssel aus T7.10), Kapitel und Zusammenfassung, Ergebnis
als Anhang einer Session, Fortschritt und Abbruch.
**Out:** Umgehen von Paywalls/DRM oder Nutzungsbedingungen, Live-Streams in
Echtzeit, Videoschnitt, Speicherung fremder Videos über die Analyse hinaus.

## 3. Design-Details

Pipeline als Hub-Job (nicht im Adapter): `fetch` (yt-dlp, nur gewählte
Qualität, Größen-/Dauerlimit) → `probe` (ffprobe) → parallel `audio`
(Untertitel wenn vorhanden, sonst STT mit Zeitstempeln) und `frames`
(Szenenwechsel `select='gt(scene,…)'`, max. N Bilder, Perceptual-Hash
gegen Duplikate) → `vision` (Bildbeschreibung/OCR je Schlüsselbild) →
`merge` (Zeitleiste: Satz ↔ Zeitmarke ↔ Bild) → `summarize` (Kapitel,
Kernaussagen). Jeder Schritt schreibt ein Zwischenergebnis als Blob
(K5: Events tragen nur Referenzen und Fortschritt), ist wiederholbar und
nach Hub-Neustart fortsetzbar (ADR-0019-Muster). Egress sichtbar: welcher
Schritt welchen Dienst nutzt (lokal vs. Gemini), abschaltbar pro Job.
Rohvideo wird nach der Analyse gelöscht (Retention konfigurierbar), nur
Transkript, Schlüsselbilder und Ergebnis bleiben.

## 4. Aufgaben

- [x] **T10.5.1 — Job-Vertrag und ADR.** Medien-Job (Quelle, Limits, Schritte, Fortschritt, Egress, Retention) in `contracts`; Wiederaufnahme nach Neustart; Abbruch. Stand 2026-09-24: [ADR-0030](../docs/adr/0030-media-jobs.md); `packages/contracts/src/media/media.ts`, `MediaJobs` (Migration 20, Dateien je Schritt, `resume()`, `cancel()`), Routen `/api/media/*`, Policy `media.analyze`.
- [x] **T10.5.2 — Quelle holen.** YouTube/andere Links per yt-dlp, Datei-Upload (T7.10-Blobs); Dauer-/Größenlimits, klare Fehler (privat, gesperrt, zu lang). Stand 2026-09-24: yt-dlp (Metadaten zuerst: Dauer/Live vor dem Download geprüft, ≤ 720p, `--max-filesize`, ein zweiter Versuch bei 403), Upload gestreamt bis 500 MB, vorhandene Anhänge; lokale/Tailnet-Links abgelehnt.
- [x] **T10.5.3 — Audio → Transkript.** Anbieter-Untertitel bevorzugen, sonst lokale STT (P10-Modell) mit Zeitmarken; Sprache erkennen. Stand 2026-09-24: Untertitel (VTT, rollende Auto-Captions entdoppelt) → whisper.cpp `verbose_json` in 10-min-Stücken → Gemini nur mit Erlaubnis; Sprache aus Metadaten oder erkannt.
- [x] **T10.5.4 — Bild → Schlüsselbilder.** Szenenwechsel, Deduplikation, Beschreibung und Texterkennung je Bild (lokal oder Gemini). Stand 2026-09-24: Szenenwechsel (0,08, gemessen) + Intervall, dHash-Deduplikation, tesseract mit Wortfilter; Beschreibung per lokalem Bildmodell (`media.vision`) oder Gemini — lokal ohne VLM nur OCR.
- [x] **T10.5.5 — Zusammenführen und Zusammenfassen.** Zeitleiste, Kapitel, Kernaussagen; als Session-Anhang nutzbar (Agent kann zitieren, Zeitmarken verlinken). Stand 2026-09-24: Zeitleiste, Kapitel (Anzahl nach Dauer), Kernaussagen, Teil-Zusammenfassung ab 40 000 Zeichen; `result.md` als Text-Anhang mit Zeitmarken und Bildpfaden.
- [x] **T10.5.6 — PWA.** Link/Datei einreichen, Fortschritt je Schritt, Ergebnisansicht mit Kapiteln, Bildern und Sprung zur Zeitmarke; E2E mit kurzem Testvideo. Stand 2026-09-24: Seite „Medien“ (`#/medien`), Link/Datei, Cloud-Schalter, Schritte mit Fortschritt, Egress-Zeile, Kapitel/Bilder/Transkript, Zeitmarke öffnet YouTube an der Stelle bzw. markiert die Transkriptzeile, „In Session verwenden“; E2E `media.spec.ts`. In Worten: „Analysiere das Video <Link>“.
- [x] **T10.5.7 — Messlauf.** Dauer und Qualität auf 3 realen Videos (Vortrag, Tutorial mit Bildschirmtext, Gespräch); Egress-Nachweis im lokalen Modus. Stand 2026-09-24: [Messlauf](../docs/messlauf/2026-09-24-p10.5-media.md) — 3 echte Videos (Nachrichten, Tutorial, Gespräch), 12–28 s je Video, WER vs. Untertitel 1,3–16,4 %, 3/3 Fragen mit richtiger Zeitmarke.

## 5. Acceptance Criteria

- **AC-P10.5-1:** Ein öffentliches YouTube-Video (≤ 30 min) und eine lokale MP4 ergeben Transkript mit Zeitmarken, ≥ 1 Schlüsselbild pro Szene (dedupliziert) mit Beschreibung, Kapitel und Zusammenfassung.
- **AC-P10.5-2:** Im lokalen Modus verlässt kein Byte den Hub außer dem Abruf der Quelle (Egress-Test); mit Gemini ist jeder Aufruf je Schritt sichtbar protokolliert.
- **AC-P10.5-3:** Hub-Neustart mitten im Job: fertige Schritte werden nicht wiederholt, der Job läuft weiter oder meldet klar, woran er scheiterte.
- **AC-P10.5-4:** Events ≤ 4 KB (K5); Rohvideo nach Abschluss gelöscht, Ergebnis bleibt.
- **AC-P10.5-5:** Eine Session kann das Ergebnis nutzen: der Agent beantwortet eine Frage zum Video mit korrekter Zeitmarke.

## 6. Premortem

1. **Rechtliches/Plattform ändert yt-dlp-Verhalten:** Quelle austauschbar, klare Fehlermeldung, Version gepinnt und im Inventar sichtbar.
2. **Lange Videos sprengen Zeit/Speicher:** harte Limits vor dem Download, Fortschritt, Abbruch, Blob-Retention.
3. **Bildbeschreibung halluziniert:** Beschreibung als solche kennzeichnen, OCR-Text getrennt, Stichproben im Messlauf.
4. **Gemini-Kontingent erschöpft:** lokaler Rückfall pro Schritt, Kontingent sichtbar.

## 7. Definition of Done

Alle ACs mit Tests/Messlauf belegt; `npm run gate` grün; ADR für Job-Vertrag;
Egress- und Retention-Verhalten dokumentiert; PWA-Abläufe im E2E-Gate.

## Retro

**Zeitraum:** 2026-09-24 · **Gate:** lokal grün (Abschluss-MR)

### AK-Matrix

- **AC-P10.5-1:** 🟢 erfüllt (Bildbeschreibung eingeschränkt)
  - **Beleg:** Messlauf — YouTube-Links und lokale MP4 ergeben Transkript
    mit Zeitmarken, Schlüsselbilder (dedupliziert), Kapitel und
    Zusammenfassung. Test „a local file: transcript with timestamps, one key
    frame per slide …“, E2E `media.spec.ts`.
  - **Einschränkung:** Ohne lokales Bildmodell oder Gemini gibt es nur OCR,
    keine Beschreibung (AI-P10.5-1).
- **AC-P10.5-2:** 🟢 erfüllt
  - **Beleg:** Egress je Schritt mit eigen/Dritte, Test „Gemini only when the
    job allows the cloud …“ (ohne Erlaubnis 0 Gemini-Aufrufe, obwohl ein
    Schlüssel gesetzt ist). Messlauf: Link-Läufe verlassen den Hub nur zu
    youtube.com.
- **AC-P10.5-3:** 🟢 erfüllt
  - **Beleg:** Test „a hub restart mid-job continues at the unfinished step“.
    probe wird nicht wiederholt, audio läuft neu.
- **AC-P10.5-4:** 🟢 erfüllt
  - **Beleg:** Job-Datensatz < 4 KB (Test). Nach dem Ende, auch bei Abbruch,
    gibt es keine `source.*` mehr (Tests und Messlauf).
- **AC-P10.5-5:** 🟡 teilweise
  - **Beleg:** E2E — das Ergebnis geht per „In Session verwenden“ in eine
    Session, und der Harness erhält es als Text. Messlauf: Das lokale Modell
    beantwortete 3/3 Fragen aus `result.md` mit der richtigen Zeitmarke
    (±20 s).
  - **Was fehlt:** Frage und Antwort über eine echte Harness-Session sind
    nicht gemessen (AI-P10.5-2).

**Stand:** 4 🟢 / 1 🟡.

### Premortem

1. **yt-dlp-Verhalten ändert sich:** eingetreten. YouTube antwortete auf
   einen Download mit 403. Es gibt jetzt einen zweiten Versuch und eine
   klare Meldung; die Version steht im Messlauf.
2. **Lange Videos sprengen Zeit und Speicher:** nicht eingetreten. Grenzen
   greifen vor dem Download (ein 40-min-Video wurde in < 4 s abgelehnt), der
   Upload wird gestreamt.
3. **Bildbeschreibung halluziniert:** abgefangen. Die Beschreibung steht
   getrennt vom OCR-Text, mit dem Zusatz „kann irren“. OCR-Rauschen auf
   Kamerabildern trat ein und wird mit einem Wortfilter gedämpft.
4. **Gemini-Kontingent erschöpft:** nicht geprüft, weil kein Schlüssel
   vorhanden war. Der lokale Weg ist der Standard.

### Erkenntnisse

1. Die übliche Szenen-Schwelle von 0,3 hätte Folienwechsel übersehen (Werte
   um 0,11–0,16). Erst die Messung am Fixture zeigte das. Beleg: Commit
   dieses MRs, `timeline`-Kommentar in `jobs.ts`.
2. Das Ergebnis als normaler Text-Anhang zu liefern, spart jede
   Adapter-Änderung: Alle Harnesses können es sofort nutzen. Beleg: E2E mit
   opencode.
3. Die Untertitel des Anbieters sind schneller als STT und bei Englisch fast
   identisch (WER 1,3 %). Bei deutschen Gesprächen liegen sie weiter
   auseinander (16,4 %). Beleg: Messlauf.

### Action Items

- **AI-P10.5-1:** Ein lokales Bildmodell (z. B. Qwen2.5-VL über llama.cpp mit
  mmproj) auf evox2 als `media.vision` einrichten und die Beschreibungen
  stichprobenartig prüfen. Zurück als: P12 T12.11.
- **AI-P10.5-2:** Eine echte Harness-Session (opencode mit lokalem Modell)
  beantwortet Fragen zu einem Video, dazu ein Video über 20 min
  (Teil-Zusammenfassung). Zurück als: P12 T12.4.

