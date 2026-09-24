# EPIC-P10 — Lokale Echtzeit-Sprache und Laya-Evaluation

**Status:** Planungsentwurf, Umsetzung blockiert · **Phase:** P10 · **Dauer:** 1–3 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P9 grün; lokale STT-Grundfunktion aus P3 abgenommen.

Planungsauftrag vom 2026-09-21; kein Umsetzungsstart und keine Behauptung eines
grünen Vorgänger-Gates. Scope, Evidenz und bestehende Restarbeiten:
[Audit](../docs/remote-control-audit-2026-09-21.md), [Index](README.md).

## 1. Ziel

Die App wird ohne Tippen bedienbar: flüssiges Diktat, Korrektur und gesprochene
Befehle mit sichtbarem Ergebnis. Laya erhält eine belastbare Ja/Nein-Entscheidung
auf eigener Hardware. PRD G2, K1/K2/K5/K6/K7/K10; Audit G12 und §6.

## 2. Scope (In / Out)

**In:** Streaming-Aufnahme/STT, Zwischenresultate, deutsche Fachbegriffe,
ein kleiner lokaler Audio-Modellkandidat, Diktat-vs-Befehl, optionales
Vorlesen/Unterbrechen, Benchmark und Laya-Spike.
**Out:** Versprechen null Latenz, always-on Mikrofon bei gesperrtem Handy,
Laya als STT/LLM/OS-Automation, zwingende GPU oder Cloud.

## 3. Design-Details

P3s lokalen STT-Pfad wiederverwenden und auf Streaming/VAD erweitern, statt eine
zweite Spracherkennung zu bauen. Erster konkreter Kandidat ist ein
vorgewärmtes, mehrsprachiges `whisper.cpp`-`base`-Modell für lokale deutsche
Fachbegriffe. `tiny` wird nur als expliziter Latenz-/Ressourcenvergleich
gemessen; ohne besseren K6- und Fachbegriff-Wert wird es nicht als Default
ausgeliefert. Audio-Codec/Resampling, Chunk-ID/Backpressure, Auth/Timeout/Cancel
definieren; Binäraudio bleibt außerhalb JSONL-Events (K5), optionale Aufnahmen
über Blob und Retention. Standardmäßig keine Daueraufnahme.

User-Gesture → Mikro → VAD/`whisper.cpp base` → editierbarer Text → P9-Plan
oder aktives Feld. Laya erhält ausschließlich Text und ist damit weder
Audio-Modell noch STT-Abhängigkeit. Teiltranskripte niemals als Schreibbefehl
dispatchen. Fester Aufnahmemodus, Zielkontext sichtbar, Korrekturen und
Negationen berücksichtigen. Optional TTS mit Unterbrechen; eigene Sprachausgabe
darf keinen neuen Befehl auslösen. Browser-STT nur bewusst ausgewählter Fallback
mit bekanntem Datenfluss.

Laya nur als optionaler Intent-Klassifikator. Spike mit gepinntem Commit,
Lizenz-/Abhängigkeitsinventar, CPU/RAM/GPU, Warm-/Coldstart und deutschem
Held-out-Datensatz. Regeln versus Laya versus vorhandener lokaler Planer; mehr
als 20 Klassen hierarchisch prüfen. IDs/Argumente außerhalb der Klassifikation
auflösen. Confidence auf eigenen Daten kalibrieren, nie als Approval verwenden.
Bei keinem nachweisbaren Vorteil bleibt Laya aus der Standardinstallation.
Grundlage: [Laya](https://github.com/NandhaKishorM/laya) und
[Benchmarks](https://github.com/NandhaKishorM/laya/blob/main/BENCHMARKS.md);
Details und Einschränkungen im [Audit §6](../docs/remote-control-audit-2026-09-21.md#6-laya-und-sprache).

Messpunkte: erstes Audio, Sprachende, erstes Teilresultat, finales Transkript,
Intent fertig, Dispatch, sichtbare Bestätigung. Browser und Server monotone
Uhren nicht ungeprüft subtrahieren; Roundtrips/Clock-Korrelation dokumentieren.
„Ausgeführt“ erst nach echter Ausführungsbestätigung, nicht nach Parser-Erfolg.

## 4. Aufgaben

- [ ] **T10.1 — Streaming-ADR und Instrumentierung.** Audio-/Transkript-/Cancel-Verträge und Recovery-Grenze; K6 ab Sprachende statt Aufnahmestart; Phasenlatenzen instrumentieren. K5/K6/K7.
- [ ] **T10.2 — Lokale Streaming-STT und kleines Audio-Modell.** P3-STT mit vorgewärmtem mehrsprachigem `whisper.cpp base` erweitern: VAD, Teilresultate, domänenspezifisches Vokabular, Chunk-Backpressure, Codec-Probe auf realem Handy und lokalem Zielhost. `tiny` gegen `base` auf Größe, RAM, Warm-/Coldstart, K6 und Fachbegriff-Fehler messen; Standardmodell erst daraus entscheiden. K2/K5/K6.
- [ ] **T10.3 — Durchgängige Sprachbedienung.** **AI-P9-3:** Sprachbefehle über die P9-Schnittstelle (`/api/commands/plan`, ADR-0027) statt eigener Direktiven führen. P9-Felder/Aktionen erreichbar machen; „korrigiere“, „abbrechen“, Befehl/Diktat und wiederholte Aufnahme; optional TTS/Barge-in, kein Echo-Dispatch. K1/K6/K10.
- [ ] **T10.4 — Laya-Spike und Entscheidung.** Gepinnte Installation isoliert; ≥ 200 deutsche/englische Äußerungen mit unabhängiger Testaufteilung, Regeln/Laya/Planer vergleichen; Accuracy, falsche Aktion, Kalibrierung und Ressourcen messen; ADR go/no-go. K1/K6.
- [ ] **T10.6 — Bessere Alternativen zu Whisper prüfen (Wunsch 2026-09-24).** Aktuelle lokale STT-Modelle (u. a. NVIDIA Parakeet/Canary, Moonshine, Kyutai STT, whisper large-v3-turbo über faster-whisper/whisper.cpp) auf deutschen Fachbegriffen, Streaming-Fähigkeit, Latenz (K6), CPU/GPU-Bedarf (evox2 Vulkan/ROCm, omarchy) und Lizenz vergleichen; Ergebnis als Messlauf und ADR, Gewinner wird T10.2-Standard.
- [ ] **T10.5 — Geräte- und Lastabnahme.** Android-/iOS-Verhalten soweit Zielmatrix verlangt, Permission-Deny, Tastatur, Headset, Störgeräusch, Coldstart, 20 laufende Sessions, WAN und Offline prüfen. K2/K6/K8/K10.

## 5. Acceptance Criteria

- **AC-P10-1 (K6):** ≥ 20 Fachbegriffs-Diktate je Zielgerät: `whisper.cpp base` als Ausgangskandidat finaler Text p90 ≤ 1,5 s ab Sprachende; Fachbegriffe ≥ 90 % korrekt, Wortfehlerrate zusätzlich ausweisen. `tiny` und `base` mit denselben Clips/Ressourcenmesspunkten vergleichen; ein kleineres Modell darf nur bei mindestens gleicher AC-Erfüllung Default werden.
- **AC-P10-2:** ≥ 100 warme Kurzbefehle: erstes Teiltranskript p95 ≤ 500 ms ab Sprachbeginn; einfache Aktion sichtbar bestätigt p95 ≤ 2 s ab Sprachende, ohne menschliche Bestätigungszeit. CPU/WAN/Coldstart getrennt ausweisen, kein Durchschnitt statt Tail-Latenz.
- **AC-P10-3:** Jeder P9-Eingabeflow per Diktat/Befehl erreichbar; „schreibe stopp“, „nicht stoppen“ und Fremd-/TTS-Stimmen lösen im Negativsatz keinen Stop aus. Passkey/OS-Prompts bleiben echte Nutzeraktionen.
- **AC-P10-4:** Laya go/no-go mit reproduzierbaren Messungen: Aktivierung nur bei ≥ 95 % korrekter Intent-/Rückfrageentscheidung auf Held-out-Hub-Daten und messbarem Latenz- oder Ressourcen-Vorteil gegenüber Baseline. Ein begründetes no-go schließt den Spike ab, nicht die Sprach-ACs.
- **AC-P10-5:** Mikro-Entzug, gesperrter Bildschirm und Verbindungsabbruch enden sichtbar; kein unbestätigter Audio-Retry als neue Aktion. Lokaler Modus ohne externen Egress; K2/K8-Regressionsprüfung unter Sprachlast.

## 6. Premortem

1. **33-ms-Laya-Marketing verdeckt langsame STT:** Audio-Modell und Intent separat messen; End-to-end-Messpunkte, Coldstart und Netz getrennt.
2. **Deutscher Befehl hochkonfident falsch:** Held-out-Korpus, Kalibrierung, Rückfragen; Policy unabhängig vom Modell.
3. **PWA kann Hintergrundaufnahme nicht halten:** Vordergrund/Push-to-talk als klare Produktgrenze, keine unsichtbare Daueraufnahme.
4. **Audio stört Agent-Streams:** getrennte Backpressure und Ressourcenlimits, K2/K8 unter Last messen.

## 7. Definition of Done

Alle ACs mit benannten Tests/Messläufen belegt, Vorgänger-Gate geschlossen;
`npm test`, `npm run lint`, `npm run typecheck` grün, PWA-Build bei UI-Änderungen,
Last-/Gerätetests gemäß AC. Contracts first; Adapter-/Event-/Worker-Änderungen
mit ADR. K5-Blob-Grenze, K7-Recovery, AdapterContext-Isolation und Fail-loud
nachgewiesen. Jede Funktion in Config, API/CLI und passender UI tatsächlich
registriert/erreichbar; Capability-/Support-Matrix ehrlich aktualisiert.
Premortem im Abschlussreview gegenprüfen, offene Pflicht-ACs blockieren Abschluss.
Commit/MR gemäß Repo-Workflow; kein lokaler Merge nach main.
