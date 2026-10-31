# ADR-0028 — Lokale Spracherkennung: Push-to-talk, der Hub wandelt, whisper.cpp auf eigener Hardware erkennt

**Status:** akzeptiert · **Betrifft:** EPIC-P10, `apps/hub/src/modules/voice/stt.routes.ts`,
`packages/core/src/platform/config.ts` (`stt`), PWA `shared/local-stt.ts`,
`features/composer/Composer.tsx`, `features/voice/VoiceSheet.tsx`

## Kontext

Die Browser-Spracherkennung schickt Audio an Google oder Apple. Sie kennt
unsere Fachbegriffe nicht und ist nicht auf jedem Gerät da. P10 soll die App
ohne Tippen bedienbar machen, lokal und ohne Cloud. Die Frage war, welches
Modell, wo es läuft und wie Audio dorthin kommt, ohne die Event-Grenze (K5)
zu verletzen.

## Entscheidung

1. **Push-to-talk statt Daueraufnahme.** Die PWA nimmt mit `MediaRecorder`
   auf (Opus/WebM, höchstens 60 s). Tippen auf „Stopp“ ist das Sprachende,
   ab dem K6 zählt. Ein gesperrter Bildschirm, ein App-Wechsel oder ein
   verlorenes Mikrofon brechen sichtbar ab. Nichts wird erkannt oder
   wiederholt (AC-P10-5).
2. **Der Hub wandelt und leitet weiter.** `POST /api/stt` nimmt rohes Audio
   (höchstens 8 MB). ffmpeg macht daraus 16 kHz mono PCM. Das geht als
   Multipart an einen whisper.cpp-kompatiblen Server, `stt.url` in der
   Hub-Konfiguration. Audio landet nie in Events oder JSONL (K5) und wird
   nicht gespeichert. Die Policy-Operation `voice.transcribe` gilt nur für
   Menschen und die Flotte. Agenten und Bridge werden abgelehnt.
3. **Modell:** whisper.cpp `large-v3-turbo` q5_0 mit Vulkan auf evox2, als
   systemd-User-Dienst `ancientvoid-stt`, nur im Tailnet. Mit Vokabular-Prompt
   (konfigurierte Wörter plus Projektnamen des Hubs) hatte es im Messlauf
   `docs/messlauf/2026-09-24-p10-stt.md` die beste Fachbegriff-Quote (44/59)
   und die niedrigste WER auf Fachdiktat (11,9 %). Dabei lag es bei rund
   290 ms warm und Ende zu Ende bei p90 575 ms. `base`, der Ausgangskandidat
   des Epics, fiel mit 33 % WER durch.
4. **Text, kein Befehl.** Das Ergebnis landet editierbar im Feld oder geht als
   Text an den P9-Planer (`/api/commands/plan`, ADR-0027), mit derselben
   Vorschau und Bestätigung wie beim Tippen. Die Spracherkennung löst selbst
   nie etwas aus.
5. **Rückfall sichtbar.** Ohne `stt` meldet `GET /api/stt` `available:false`.
   Dann nutzt die PWA die Browser-Erkennung und kennzeichnet sie als „Cloud“.
   Fehler sind laut: 501 (keine Erkennung konfiguriert), 400 (keine
   Aufnahme), 422 (Audio nicht lesbar), 502 (Erkenner nicht erreichbar,
   „bitte tippen“).

## Alternativen

- **Parakeet TDT 0.6B v3:** auf echter Sprache so gut wie turbo (3,87 %
  WER), aber kein Vokabular-Prompt. Auf Fachdiktat 35/59 statt 44/59.
  Bleibt Kandidat, falls Streaming wichtiger wird.
- **faster-whisper:** etwas genauer auf FLEURS, aber auf CPU etwa viermal
  langsamer.
- **Kyutai STT, Moonshine:** kein Deutsch.
- **Streaming mit Teilresultaten:** für AC-P10-2 nötig. whisper-server
  liefert keine Teile, daher verschoben nach P12.
- **Audio im Browser erkennen (WASM):** zu schwer für Handys. Das Modell
  wäre für jedes Gerät einzeln zu laden.

## Folgen

- Der Hub braucht `ffmpeg` im PATH, wenn `stt` gesetzt ist.
- `ancientvoid-stt` hat keine eigene Authentifizierung. Er lauscht nur auf der
  Tailnet-IP. Wer ihn woanders betreibt, muss ihn davor schützen.
- Die Fachbegriff-Quote (74–80 % auf einer synthetischen Stimme) liegt unter
  dem Ziel von 90 %. Der Nachweis auf echten Geräten ist P12 T12.4.
