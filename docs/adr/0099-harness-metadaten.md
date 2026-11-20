# ADR-0099 — Native Harness-Metadaten in Session und Freigabe

**Status:** angenommen

**Bezug:** ADR-0032, ADR-0074, ADR-0084, BUG-0237 und BUG-0239–0242

**Messlatten:** K1, K5, K7

## Entscheidung

- Eine strukturierte Rückfrage kann `ToolQuestion.required: false` melden.
  Ältere Fragen ohne Feld bleiben Pflichtfragen. ACP übernimmt dazu die
  Eigenschaft `required` seines Formularschemas. Unbeantwortete optionale
  Felder werden weggelassen. Die Operation speichert die Frage und Antwort
  über den bestehenden Freigabepfad.
- Der Detailabruf einer Session liefert `openActivities` aus dem
  rekonstruierten, im Snapshot und im Journal geführten Aktivitätsregister.
  Das Erstellungsdatum einer Aktivität bleibt beim Herzschlag erhalten.
  Für laufende externe Jobs dient `lastSeenAt` der Ablaufprüfung.
  Bei älteren Hubs verwendet die PWA die Aktivitätsereignisse im geladenen
  Verlauf.
- Ein Adapter kann `payload.contextInputTokens` für eine native
  Kontextmeldung schreiben. ACP nutzt das Feld für `usage_update.used`
  und übernimmt `size` als `contextWindowTokens`.
  Claude summiert für den letzten Modellaufruf uncached input,
  cache creation und cache read. Nur die Hauptausführung meldet diesen Wert.
- Claude meldet Fenster und Ausgabelimit des Hauptmodells über `modelUsage`.
  Codex übernimmt `modelContextWindow` aus dem App-Server. Die PWA verwendet
  die zuletzt gemeldete Fenstergröße. Eingabewerte älterer Ereignisse ohne
  native Kontextmeldung bleiben als Fallback nutzbar.
- Der gemeinsame Kontext-Leser für PWA und Hub verhindert, dass kumulierte
  Claude- und ACP-Zugstatistiken die Kontextmeldung desselben Zugs
  überschreiben. Die aufsummierte Nutzung und die Kontextfüllung bleiben
  eigenständige Metriken. Die Daten ergeben sich aus dem Journal (K7).
  Neue Kontextereignisse speichern nur die relevanten Zahlen (K5).
- Die lokalisierte Z.ai-Meldung zum ausgeschöpften Kontingent behält
  die vom Anbieter angegebene Reset-Zeit als Text (ADR-0015). Die Meldung
  gibt keine Zeitzone an, daher leitet der Hub daraus keine automatische
  Wiederaufnahmezeit ab.

Quellen: [ACP v1 Schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v1/schema.json),
[Codex App-Server-Schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/ThreadTokenUsageUpdatedNotification.json),
Claude-Captures in `packages/adapters/claude/test/fixtures/`.
