# Demo-Medien: Aufnahmeregeln und Checklisten

**Art:** how-to

**Stand:** 2026-11-16 (EPIC-P62 T62.2) · **Gates:** `npm run check:media`
(Struktur, lokal + verify), `npm run check:media -- --ocr` (verify, tesseract
über neue/geänderte Guide-/Site-Screenshots), `.githooks/pre-commit`
(gestellte Medien). Regeln-Referenz: [`check-media.mjs`](../scripts/check-media.mjs).

Alles, was veröffentlicht wird (Screenshots, Videos, Seitentexte), muss
**nachweisbar** frei von Credentials, echten Host-/Projektnamen, echten
Pfaden und internen Daten sein — nicht nur per Konvention.

## Die einzige Datenquelle: Demo-Seed

Screenshots und Video-Szenen entstehen **ausschließlich** am Demo-Hub aus
`npm run demo:seed` (T62.3): Fake-Projekte aus der Allowlist
(`demo/website`, `demo/api`, …), Adapter `adapter-dummy`, Fake-Hosts, feste
Namen und geseedete Zeitstempel. Nie den Produktiv-Hub abfilmen oder
-fotografieren.

## Strukturregeln (deterministisch erzwungen)

- Bildmedien nur unter `docs/guide/assets/`, `apps/site/assets/` und den
  Bestandsorten (PWA-Produktassets, Test-Fixtures, alte Doku-Assets).
- Video-/Archiv-Typen (mp4, mov, gif, zip, …) sind im Repo rot — YouTube
  hostet Videos, Rohmaterial bleibt außerhalb. Einzige Ausnahme:
  Test-Fixtures der Medienanalyse.
- Guide-/Site-Assets heißen `<seite>-<nn>.<ext>` (z. B. `overview-01.png`).
- Budget: 512 KiB je Datei, 24 MiB je Verzeichnis.
- PNG-Textchunks, EXIF/XMP und `<script>` in SVG sind rot — ein Medium
  trägt keine Heimatkunde.
- Screenshots entstehen per `scripts/guide-shots.mjs` (T62.4) — erzeugt,
  nicht abfotografiert; Metadata wird beim Schreiben entfernt. Handaufnahme
  nur, wo Playwright nicht hinkommt (mobil/gerätespezifisch), und auch dann
  nur aus dem Demo-Seed.

## Review-Checkliste pro Medium

1. Nur Demo-Seed-Daten sichtbar? (Projektnamen, Hosts, Benutzernamen)
2. Keine Token-Felder, keine Pairing-Dialoge mit sichtbarem Plaintext?
3. Keine absoluten Pfade (`/home`, `/mnt`, `C:\Users`) in Adresszeile/Editor?
4. Dateiname, Budget, Metadata den Regeln entsprechend?
5. `npm run check:media` grün? (macht der Hook/CI ohnehin — doppelt hält besser)

## Video-Export-Checkliste (vor jedem Publish)

- Vollbildaufnahme ohne Systemmitteilungs-Overlay (Do not disturb).
- Keine Browser-Profilleiste mit echtem Account (eigenes Profil oder
  Vollbild-Playwright-Drive).
- Szene = Demo-Seed-Zustand (nicht der laufende Alltagshub).
- Länge ≤ 180 s, Sprache Englisch, Untertitel Englisch.
- Vor dem Upload: dieselbe Sichtprüfung wie oben, Screenshot-frei von
  echten Daten.

## Warum Präzision statt Heuristik

Der OCR-Pass matcht ausschließlich Token-Formen mit festen Präfixen
(`ghp_`, `github_pat_`, `sk-`, `glpat-`, `avt_`, `AKIA…`, Private-Key-Blöcke)
— dieselbe Philosophie wie `check-secrets.mjs`. Ein False-Positive-Regen
erzeugt `--no-verify`-Reflexe; lieber wenige, harte Treffer.
