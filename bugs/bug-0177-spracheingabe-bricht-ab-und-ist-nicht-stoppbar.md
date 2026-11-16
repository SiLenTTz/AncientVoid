# BUG-0177 — Spracheingabe bricht nach Sekunden ab, kein Wort-für-Wort, nicht stoppbar

**Status:** done · **Schweregrad:** S1 · **Bereich:** pwa · **Found on:** Handy-PWA über
`https://kaisgamingdesk.taila03493.ts.net` (Nutzerbericht 2026-11-16), Nachbau auf
Windows/Chromium bei Viewport 390×844

## Nutzerbericht

„Das mit diesem Spracheingabe scheint noch nicht wirklich gefixt zu sein, hat jetzt
gerade schon wieder abgebrochen. Außerdem möchte ich, dass das Wort für Wort
erscheint, während ich rede. Und das Icon soll zu einem Stopp-Button werden oder ich
muss nochmal drauf drücken, damit es stoppt. Das muss richtig zuverlässig
funktionieren, auch wenn das eine Minute lang läuft oder fünf.“

## Ursachen (alle im Code belegt)

1. `apps/pwa/src/shared/speech.ts`: `recognizeOnce()` setzte `continuous = false`,
   `interimResults = false` und `RECOGNITION_TIMEOUT_MS = 10_000`. Ein Diktat war
   also nach spätestens 10 s zu Ende, und es gab **keine** Zwischenstände.
2. `apps/pwa/src/shared/local-stt.ts`: `MAX_RECORDING_MS = 60_000` — auch der lokale
   Weg (Hub/whisper) kappte nach 60 s still.
3. `apps/pwa/src/features/stt/NyxFab.tsx`: `unavailable = !stt.supported ||
   (stt.listening && !stt.recording)` — während des Zuhörens war der Knopf
   absichtlich nicht klickbar, **erneut tippen konnte also nicht stoppen**.
4. `visibilitychange` brach die Aufnahme ab (Weg aus BUG-0041): Bildschirm sperren
   vernichtete ein laufendes Diktat.
5. Chrome beendet eine `continuous`-Erkennung intern selbst (Stille, Endpointing,
   Netz). Es gab keinen Neustart — genau das war das „schon wieder abgebrochen“.
6. Nach einem Neustart lieferte Chrome das letzte Stück nochmal: der Text stand
   doppelt im Feld. Auf dem Handy gemessen: „… für Kinder und günstig Die Kopfhörer
   sind gut für Kinder und günstig …“ 25-fach in einem 49-s-Lauf.

## Fix

- `startContinuousStt()` in `speech.ts`: `continuous = true`, `interimResults = true`,
  Vorschau (`finals + interim`) bei jedem Ereignis, **Neustart nach jedem `onend`**,
  harte Grenze bei 120 folgenlosen Neustarts mit sichtbarer Meldung, `stop()`/`abort()`.
- Doppeltext-Schutz `addFinal()`: exakte Duplikate weg; eine Schlussfolge, die die
  vorherige nur erweitert, ersetzt sie; was schon drinsteht, wird nicht angehängt.
- `use-push-to-talk.ts`: Browser-Weg nutzt die durchgehende Erkennung;erneut tippen oder
  Esc stoppen (der gehörte Text bleibt); Wach-Riegel für die Laufzeit; Sperren des
  Bildschirms ist nur noch ein Hinweis, Abbruch erst wenn der Mikrofon-Track endet;
  Obergrenze 15 Minuten statt 10 s/60 s (`MAX_DICTATION_MS`, `MAX_RECORDING_MS`).
- `NyxFab.tsx`/`43-nyx-fab.css`: Knopf wird sichtbar zum Stopp-Knopf (■ über dem
  Sprite, roter Puls, `aria-pressed`), Blende zeigt „⏹ Diktat läuft mm:ss — erneut
  tippen stoppt“, Neustart-Zähler und die wachsenden Wörter in eigener, lesbarer
  Zeile. Blenden-Breite jetzt fest (vorher schrumpfte sie am rechten Rand auf
  Silbenbreite und bricht Wörter mittendurch).
- Ohne streamendes ASR am Hub sagt die Blende klar, dass es keine Live-Wörter geben
  kann (`stt.streaming`), statt nur schweigsam zu sein.

## Belege

- Unit: `apps/pwa/test/shared/speech-continuous.test.ts` — 5 grün (Neustart sammelt
  weiter, Zwischenstände, `not-allowed`abbricht fatal, `restarted-out` nach 120,
  Doppeltext wird zusammengeführt).
- E2E: `e2e/specs/nyx-fab.spec.ts` — 7 grün, davon drei neue/überarbeitete Fälle
  (erneut tippen stoppt, Wörter wachsen + Stopp-Glyphe, Erkennung endet von selbst
  und das Diktat läuft weiter). Der Fall „FAB über dem Dock“ scheitert an
  `read ECONNRESET` — mit `git stash` auf demselben Stand ohne diese Änderungen
  identisch reproduziert, also eine Windows-Umgebungsbaustelle, kein Rückfall.
- Live auf dem Handy-Pfad (Tailscale-URL, 390×844): einmal drücken → Wörter wuchsen
  bis „Die Kopfhörer sind gut für Kinder und günstig“, Blende „⏹ Diktat läuft 0:25“,
  „Erkennung 13× neu gestartet“, Eingabefeld blieb unverändert; zweites Drücken
  stoppte und fügte genau diesen einen Satz ein. Vor dem Fix: 25-fach duplicierter
  Text im selben Feld.

## Was offen bleibt (echt, nicht beschönigt)

- Headless-Chromium hat keine Spracherkennung und blockiert `getUserMedia`
  (gemessen: `NotAllowedError`). Die obigen Live-Beweise laufen deshalb mit einem
  **gesetzten** Recognizer — UI-Zustand, Timer, Neustartlogik und Einfügen sind damit
  bewiesen, die eigentliche Spracherkennung (Chrome-Cloud oder whisper.cpp) nicht.
- Auf dem Handy nutzt die App die Chrome-Erkennung (Cloud). Lokales, streamendes ASR
  ist auf diesem Rechner nicht eingerichtet (`/api/stt` → `available: false`); dafür
  wären `stt.url` (whisper.cpp `/inference`) und `stt.streaming.url` in
  `hub.config.json` nötig, bei langen Diktaten zusätzlich ein höheres
  `stt.timeoutMs` (Default 30 s).
