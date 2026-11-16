# ADR-0032 — Lokale STT-Teiltranskripte über einen Hub-Proxy

**Status:** akzeptiert · **Betrifft:** P12 T12.10, P10 AC-P10-2,
`@ancientvoid/contracts`, Hub `/api/stt`, PWA Push-to-talk

## Kontext

ADR-0028 liefert abgeschlossene Aufnahmen an `whisper.cpp` `/inference`.
Der Endpunkt akzeptiert vollständige Dateien und liefert keine Teiltexte.
T12.10 verlangt sichtbare Teiltranskripte während Push-to-talk, mit VAD,
ohne dass ein Teiltext eine Aktion auslösen kann. Browsersprachenerkennung ist
kein zulässiger lokaler Ersatz, weil Browser sie an einen externen Dienst
geben können.

Ein lokaler Prototyp mit NVIDIA NeMo-Speech.cpp 0.1.0, dem quantisierten
Nemotron 3.5 ASR Streaming 0.6B-Modell und synthetischem deutschem Audio
lieferte WebSocket-Deltas während der Aufnahme. Das Modell erkennt Deutsch;
der Lauf auf CPU ist ein Einzelmesspunkt und keine Geräteabnahme. Die
offizielle Engine nimmt 16-kHz-PCM16 über `/v1/audio/transcriptions/realtime`
an und liefert Delta- und Finalereignisse. Sie bleibt ein optionaler
Streaming-Backend neben dem bestehenden Whisper-Komplettclip-Pfad.

## Entscheidung

1. Die PWA erfasst Audio nach explizitem Mikrofontap als mono PCM16/16 kHz und
   sendet kleine Binärframes über einen WebSocket zum Hub. Ein sichtbarer
   Vorschautext wird nur im Statusbereich angezeigt. Beim Stopp wird nur der
   finale Text in das editierbare Eingabefeld übernommen; kein Partial wird
   an Planner, Session, EventStore oder Tool-Gate weitergereicht.
2. Der Hub vermittelt die Verbindung zu einem explizit konfigurierten lokalen
   STT-Streamingdienst. Upstream-URL und optionale Schlüsseldatei bleiben
   serverseitig. Roh-Audio und Text werden weder geloggt noch persistiert.
3. Der WebSocket-Browserclient trägt keinen Hub-Bearer-Token in der URL.
   Eine authentifizierte `POST /api/stt/stream-ticket`-Anfrage erstellt ein
   zufälliges, einmaliges Ticket mit 15 Sekunden TTL. Der Upgrade-Endpunkt
   verbraucht es vor dem Aufbau der Upstream-Verbindung. Tickets liegen nur im
   Arbeitsspeicher; Hub-Neustart beendet aktive Streams sichtbar.
4. Die Länge ist auf 60 Sekunden je Push-to-talk begrenzt. Audioqueue,
   Upstream-Verbindung und Inferenz sind abbrechbar; Rückstau beendet den
   Stream mit sichtbarem Fehler statt unbegrenzt Speicher aufzubauen.
5. Ist Streaming nicht konfiguriert oder schlägt es fehl, bleibt der
   bestehende lokale Dateipfad verfügbar. Ein solcher Fallback startet keine
   Aktion und kennzeichnet Fehler im UI.

## Alternativen

- Browser-`SpeechRecognition`: kein verlässlicher Offline-/No-egress-Vertrag.
- Whisper-HTTP `/inference`: nur vollständige Datei; kein partieller Decoder.
- Je 0,5 Sekunden einen neuen Whisper-Clip senden: wiederholt große
  überlappende Arbeit, fehlender Decoderzustand und gemessene Erstlatenz über
  500 ms ab Sprachbeginn.
- Browser-WASM-Modell: Modelltransfer und RAM sind für die Zielhandys nicht
  belegt; kein belastbarer Fachbegriffs-Nachweis.

## Folgen und offene Prüfung

- Streamingdienst bleibt standardmäßig aus; bestehende `stt.url`-Config und
  Abschlussdiktat ändern ihr Verhalten nicht.
- T12.10 bleibt offen, bis auf Zielgerät und Zielhost 100 warme Kurzbefehle
  sowie echte VAD-/Abbruch-/Negativfälle gemessen sind und AC-P10-2 erfüllt
  ist. Der CPU-Prototyp belegt nur die Transport-/Modellmachbarkeit.
- Die Hub-/PWA-WebSocket-Verträge liegen in `@ancientvoid/contracts`; Teiltranskripte
  werden absichtlich nicht als EventStore-Events gespeichert.

## Quellen

- [NVIDIA NeMo-Speech.cpp Modellmatrix](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/asr/models.md)
- [NVIDIA NeMo-Speech.cpp WebSocket-Protokoll](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/api.md)
- [Nemotron 3.5 ASR model card](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b)
