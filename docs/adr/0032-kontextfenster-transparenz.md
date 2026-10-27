# ADR-0032: Kontextfenster-Transparenz — Füllung aus Provider-Usage, Größe aus Konfiguration

Status: angenommen (2026-09-26)

## Kontext

Gefordert (P7-Nachfrage, 2026-09-26): die PWA soll zeigen, wie voll das
Kontextfenster des Modells ist — wie Tokens je Zug und je Session. Zwei
Zahlen braucht das: die **Füllung** (wie viele Tokens gerade im Kontext
stehen) und die **Fenstergröße** des Modells.

## Entscheidung

1. **Füllung = `usage.inputTokens` der zuletzt beantworteten Anfrage.**
   Die Anfrage trägt den ganzen Verlauf — ihr Input ist die ehrliche,
   provider-gemessene Füllung (live belegt: opencode-ACP meldet
   `usage {inputTokens, outputTokens, totalTokens, thoughtTokens}` auf
   jedem `session/prompt`-Resultat, z. B. 13.957 Input-Tokens in Session
   `6f03a88e`). Adapter hängen sie als `payload.usage {input, output}` an
   ihr Zugende-Event (claude: `claude.result`, ACP: `acp.turn_end`).
   `tokensEst` bleibt die Summe je Zug (`totalTokens` bzw. input+output).
2. **Fenstergröße = Adapter-Konfiguration `contextWindowTokens`,**
   sichtbar als optionale Capability `contextWindowTokens`. Kein bekannter
   Harness meldet die Größe im Band (`opencode models` listet nur Namen;
   ACP configOptions tragen sie nicht) — eine Tabelle im Hub wäre geraten.
   Wer sie weiß, trägt sie ein; sonst zeigt die PWA ehrlich „unbekannt"
   (keine Prozentzahl ausgedacht, gleiche Regel wie ADR-0023).
3. **Prozent nur aus zwei echten Zahlen**: `input / contextWindowTokens`.
   Fehlt eine, bleibt es bei der absoluten Zahl oder „unbekannt".

## Konsequenzen

- `AdapterCapabilities` wächst um ein optionales Feld (additiv — kein
  Bruch bestehender Adapter).
- Die PWA berechnet Zug- und Kontextzahlen client-seitig aus dem
  Event-Stream (Tail, letzte 500 Events) plus Session-`tokensEst` vom
  Server — kein neuer Endpunkt, kein neuer Event-Typ.
- Fenstergröße gilt pro Adapter-Instanz (typisch: eine Instanz je
  Provider/Modellfamilie). Modellspezifische Größen brauchen später eine
  Erweiterung des Modellkatalogs — heute nicht spekulieren.

## Nachtrag 2026-10-27: pi und „immer sichtbar“

- **pi** meldet die Usage je Modellantwort im `--mode json`-Stream
  (`message_end.message.usage`, BUG-0065). Die Füllung ist dort
  `input + cacheRead + cacheWrite`, denn pi zählt gecachte Tokens getrennt
  (echte Aufnahme: 53 frische + 1.057 gecachte Input-Tokens). Die
  Fenstergröße kommt wie gehabt aus `contextWindowTokens` in der
  Adapter-Konfiguration. pis eigene `models.json` hat den Wert
  (`contextWindow`), meldet ihn aber nicht im Stream. Die Modell-Ansage
  `pi.model` trägt ihn.
- Die Token-Zeile im Session-Kopf steht jetzt **immer** da: „Tokens
  unbekannt“, „Kontext unbekannt“ oder „Fenstergröße unbekannt“, statt
  ausgeblendet zu werden. Mit beiden Zahlen nennt sie auch den freien
  Platz („frei 129.962 von 131.072“). Das ist dieselbe Regel wie oben,
  nur sichtbar statt still.
