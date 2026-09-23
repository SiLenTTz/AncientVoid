# EPIC-P10.5 — Medien- und Video-Analyse

**Status:** Planungsentwurf (Wunsch vom 2026-09-24) · **Phase:** P10.5 · **Dauer:** 1–3 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P7 T7.10 (Anhänge mit Inhaltsauslese) und P10 (lokale Spracherkennung) grün.

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

- [ ] **T10.5.1 — Job-Vertrag und ADR.** Medien-Job (Quelle, Limits, Schritte, Fortschritt, Egress, Retention) in `contracts`; Wiederaufnahme nach Neustart; Abbruch.
- [ ] **T10.5.2 — Quelle holen.** YouTube/andere Links per yt-dlp, Datei-Upload (T7.10-Blobs); Dauer-/Größenlimits, klare Fehler (privat, gesperrt, zu lang).
- [ ] **T10.5.3 — Audio → Transkript.** Anbieter-Untertitel bevorzugen, sonst lokale STT (P10-Modell) mit Zeitmarken; Sprache erkennen.
- [ ] **T10.5.4 — Bild → Schlüsselbilder.** Szenenwechsel, Deduplikation, Beschreibung und Texterkennung je Bild (lokal oder Gemini).
- [ ] **T10.5.5 — Zusammenführen und Zusammenfassen.** Zeitleiste, Kapitel, Kernaussagen; als Session-Anhang nutzbar (Agent kann zitieren, Zeitmarken verlinken).
- [ ] **T10.5.6 — PWA.** Link/Datei einreichen, Fortschritt je Schritt, Ergebnisansicht mit Kapiteln, Bildern und Sprung zur Zeitmarke; E2E mit kurzem Testvideo.
- [ ] **T10.5.7 — Messlauf.** Dauer und Qualität auf 3 realen Videos (Vortrag, Tutorial mit Bildschirmtext, Gespräch); Egress-Nachweis im lokalen Modus.

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
