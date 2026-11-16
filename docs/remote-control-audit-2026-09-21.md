# AncientVoid: Bestandsaufnahme und Weg zur vollständigen Fernsteuerung

**Stand:** 2026-09-21 · **Codebasis:** `80f8696` · **Auftrag:** aktueller
Nutzerwunsch nach allen Sessions, PC↔Handy-Kontinuität, AI-Eingabe und Sprache.
**Ergebnis:** tragfähiger Hub-Kern, aber noch kein vollständiger Remote-Arbeitsplatz.
Die bisherigen Epics decken überwiegend mobile Supervision ab. Eine Prozentzahl
für Fertigstellung wäre ohne verbindliche Geräte-/Provider-Matrix irreführend.

## 1. Prüfgrenze und Evidenz

Gelesen: PRD, P0–P4 einschließlich P1.5/P1.6 und Retros, ADRs, Contracts,
SessionManager, Worker, Adapter, Server-Routen, MCP-Katalog, PWA und Service Worker.
Aktuelle lokale Änderungen (`adapter-claude-clip`, Lockfile, tsconfig) separat
betrachtet; sie sind **WIP**, kein Bestandteil von `80f8696` und nicht verändert.
Dokumentation entsteht auf `docs/remote-control-audit` in eigenem Worktree.

UI tatsächlich mit isoliertem Hub, temporärer Datenbank und Dummy-Adapter
durchgeklickt: Übersicht, neue Session, Voice, Session, Offline-Neuladen.
Chromium 151.0.7922.173, Node 26.7.0, Viewports 390×844 und 1440×1000.
Der Browser-Connector meldete keine verfügbare Verbindung; deshalb lokaler
Playwright-Testbrowser. Screenshots visuell geprüft, nicht committet.
Es wurden keine produktiven Sessions gestartet/gestoppt oder Provider bezahlt.

**Keine Abnahme** echter Hardware: Handy-Mikrofon, Bildschirmtastatur,
Passkeys, Push bei gesperrtem Gerät, WAN/Tailscale, gpubox und home-server
wurden in diesem Audit nicht live geprüft. Provider-„proven“ unten bezeichnet
die vorhandene Repo-Evidenz, keinen neuen Live-Test dieser Untersuchung.

| Prüfung | Ergebnis |
|---|---|
| Aktueller Arbeitsbaum: `npm test` | 325/325 Tests, 36 Dateien grün |
| Aktueller Arbeitsbaum: `npm run lint` | grün |
| Aktueller Arbeitsbaum: `npm run typecheck` | rot: TS2554 im WIP `adapter-claude-clip/src/index.ts:193` und `test/adapter.test.ts:200` |
| `npm -w @ancientvoid/pwa run build` | grün |
| Eingecheckter Stand im isolierten Worktree | erster Testlauf: 306/307; tmux-stdout-Test liefert `[]` statt drei Zeilen. Vollständiger Wiederholungslauf: 307/307 (34 Dateien), danach Lint und Typecheck grün; keine Test-/Codeänderung |
| Browser: Offline-Neuladen | Fehler reproduziert, [BUG-0015](../bugs/bug-0015-offline-reload-token-gate.md) |

Grüne Unit-Tests sind weder eine Vollständigkeitsprüfung der Flotte noch ein
Nachweis, dass ein echter Agent nach Hub-Neustart weiter bedienbar ist.

## 2. Was bereits nutzbar ist

- Lokaler REST-/WS-Hub, Device-Tokens, Adapter-Registry, JSONL/Blobs, SQLite,
  Worktrees, tmux-/Process-Runner; Größenlimits und Recovery-Grundmechanik.
- Sessions im Hub starten, beobachten, Folgeprompts senden und stoppen;
  Diff/Hunks, Chat-/Ereignisfilter, Projektwahl, Skill-/Agent-Auswahl.
- Freigabe-Service und Passkey-Bausteine, optionale Prompt-Freigaben,
  Kosten-/Kontingentanzeige und Budget-Parken.
- PWA mit unterem Dock, Dark/Light-Theme, Diktat im Composer,
  expliziter Prompt-Verbesserung und lokaler Markdown-Suche.
- Kleines MCP-Gateway und optionaler Reporting-Sink.

## 3. Lücken mit Implementierungsbezug

| ID / Priorität | Befund und Beleg | Eigentümer im Plan |
|---|---|---|
| G01 · Blocker | Keine vollständige Discovery externer Sessions. `SessionManager.list()` liest Hub-Records; der Contract kennt keine Discovery. Cursor beobachtet einen gewählten Kontext, WIP Claude-Clip eine gewählte/letzte Datei. | P5 T5.1–T5.3 |
| G02 · Blocker | `steer: true` unterscheidet keine echte Eingabe im laufenden Turn, Folgeprompt, Interrupt oder Übernahme. CLI-Adapter spawnen pro Folgeprompt neu. Native IDs liegen in Adapter-Maps. | P5 T5.1/T5.4, P7 T7.1 |
| G03 · Blocker | Claude/Codex/OpenCode/Copilot haben kein `recover()`. `recoverAll()` zählt auch ohne Handle „recovered“; `keepWorkers` bleibt dafür leer und Orphan-Reaping kann verbliebene Worker entfernen. Codebefund, hier kein Kill-Test an produktiven Agenten. | P5 T5.2/T5.6 |
| G04 · Blocker | `attachCmd` wird aus Status/Runner abgeleitet; zwischen One-shot-Turns existiert oft kein Pane. tmux mit JSON-Ausgabe ist kein gleichwertiger interaktiver Harness. `routes.ts:withAttachCmd`, `workers/tmux.ts`. | P5 T5.4/T5.5 |
| G05 · Blocker | Ein Browser spricht einen Hub über relative `/api`-Pfade an. Kein Host-Contract, keine Flottenaggregation. `Dashboard.tsx` benennt das selbst. | P6 |
| G06 · Blocker | Swarm fehlt, local-llm/DeepSeek/Aider ohne vollständige Live-Abnahme; Cursor nur lesbar. Vorhandene Status-Matrix ist keine Funktionsparität. | bestehend T3.1/T3.3, P7 |
| G07 · Blocker | Hub-Prompt-Freigabe ersetzt keine Freigabe einzelner Provider-Tool-Aufrufe. Copilot verwendet `--allow-all-tools`; Session-Start ist nicht gegated. MCP exponiert deshalb Start/Stop/Park nicht. `pendingSteers`/`pendingBudgetTopUps` sind nur RAM. | P7 T7.2–T7.4 |
| G08 · Hoch | `SessionSpec`/`SteerInput` unterstützen hauptsächlich Text, keine getypten Rückfragen, Bilder/Dateien, Tool-Interaktion oder vollständige Modell-/Harness-Einstellungen. | P7 T7.1/T7.5 |
| G09 · Blocker mobil | Kein Web-Push; Polling/WS erfordert erreichbare Oberfläche. Offline-Neuladen fällt in TokenGate. Cache-Zeitstempel wird beim Ausliefern statt beim Speichern gesetzt. | BUG-0015, P8 T8.2/T8.3 |
| G10 · Hoch | Keine URL-basierte Session-Navigation, Draft-/Leseposition-Synchronisation oder Eingabe-Deduplizierung. `main.tsx` und `SessionTail.tsx` halten Route/Draft in Komponenten-State. | P5 T5.5, P8 T8.1/T8.4 |
| G11 · Hoch | Kein allgemeiner AI-Controller. MCP bietet sieben Operationen; Voice parst nur Stopp/Budget per Regex. Beispielbefehle starten keine Session. | P9 |
| G12 · Hoch | Browser-STT ist einmalig, ohne Interim-Ergebnisse oder lokalen Serverpfad. `latencyMs` misst ab Aufnahmestart, nicht ab Sprachende: kein K6-Nachweis. | bestehend T3.6/T3.7, P10 |
| G13 · Hoch | Prompt-Enhancer ruft Claude/Codex auf, ist nicht generell lokal. Suche indexiert Markdown, keinen allgemeinen Quellcode. | P9 T9.4, P7 T7.6 |
| G14 · Hoch | Desktop-weite Eingabe/GUI-Steuerung fehlt. Eine PWA hat im Repo keinen Companion, der andere Anwendungen bedient. Cursor-Write war bisher ausdrücklich ausgeschlossen. | P11, explizite Scope-Erweiterung |
| G15 · Hoch | Echte Erstinstallation, Backups/Restore, Upgrades, längerer Flottenbetrieb und reale Handy-Abnahme fehlen als geschlossener Nachweis. P4 externe Integrationen/WSL/Release offen. | bestehend P4, P12 |
| G16 · Mittel | Kostenfähigkeit wird als Stellvertreter für Token-Erfassung benutzt (`SessionTail.tsx`, ADR-0006). Fehlende Messwerte/Teilwerte nicht eigenständig modelliert; Tagesübersicht kann `$0` zeigen. | P7 T7.7, P8 T8.1 |
| G17 · Hoch | BUG-0004 offen; gemeinsames Testkit kann Worker-Adapter nicht ohne Weiteres ausführen. Beobachteter tmux-Test-Ausfall und WIP-Typefehler verhindern pauschales „alle Gates grün“. | G0, P5 T5.6, P12 T12.2 |

## 4. Zielumfang: „1 zu 1“ überprüfbar machen

**Gleiche Session** bedeutet: gleiche Provider-Session-ID, Host, Projekt und
Worktree, vollständiger verfügbarer Kontext, nachvollziehbare Eingaben,
keine verdeckte neue Session und keine gleichzeitigen widersprüchlichen Writer.
PC→Handy→PC muss bei laufendem Turn, wartender Rückfrage, beendetem Turn und
nach Neustart geprüft werden. Kontext in eine neue Session kopieren ist ein
sichtbarer **Fork**, keine erfolgreiche 1:1-Übernahme.

**Alle** wird gegen folgende anfängliche Inventarliste gemessen. Weitere
vom Nutzer benannte Tools erweitern T5.1/T7.1, ohne eine heimliche Zusage
für jede existierende GUI-App. Mac ist durch das Video ein Vergleich, bisher
kein bestätigter Zielhost. Native Windows-GUIs gehören zu P11, WSL zu P4/P6.

| Ziel | Hub-Start/Folgeprompt heute | Externe Sessions / 1:1 | Noch zu belegen |
|---|---|---|---|
| Claude Code | implementiert, Repo-Live-Evidenz | Claude-Clip WIP nur lesbar; keine vollständige Übernahme | Discovery, Writer-Wechsel, Restart, Tools/Rückfragen |
| Codex | implementiert, Repo-Live-Evidenz | keine generische externe Discovery/Übernahme | wie Claude, konkreten CLI-/Desktop-Harness getrennt prüfen |
| OpenCode / z.ai | implementiert, Repo-Live-Evidenz | keine vollständige Übernahme | Provider-/Modellwahl, externe Sessions, Recovery |
| Copilot CLI | implementiert, Repo-Live-Evidenz | keine vollständige Übernahme | Tool-Gates, Live-Interrupt, Recovery |
| Cursor Desktop | `cursor-clip` liest Verlauf | Schreiben nicht vorhanden | unterstützte native Schnittstelle evaluieren; sonst klar begrenzter P11-Pfad |
| Aider | Adapter gebaut | nicht Ende-zu-Ende abgenommen | reales Backend, Kontextfortführung, Recovery |
| eigener Swarm | Spec/ADR, kein Adapter | fehlt | echte Event-/Gate-Schemas und Zugriff, Kinder-Sessions, Lifecycle |
| DeepSeek / lokale Modelle | OpenAI-kompatible Vorlage | kein belegter Coding-Harness allein dadurch | Modell-Endpunkt und ausführenden Tool-Harness getrennt inventarisieren |
| weitere MCP-/CLI-Tools | festes Hub-MCP-Subset | kein allgemeiner Tool-Katalog | registrierte schema-validierte Aktionen, Dateien, Ergebnis-/Fehlerpfad |

Je Ziel werden künftig **Discovery, Beobachten, Starten, Fortführen,
Interrupt, Rückfrage, Tool-Freigabe, Anhänge, PC↔Handy, Neustart** mit
`verifiziert / implementiert-unverifiziert / fehlt / technisch blockiert`
erfasst. Ein für den Vollumfang zwingendes blockiertes Feld verhindert
„100 %“; ein Fallback darf es nicht grün färben.

## 5. UI-Sichtung und konkrete Vereinfachung

Das dunkle Erscheinungsbild, die klare Akzentfarbe und das untere Dock
funktionieren als Basis. Ein weiterer visueller Komplettumbau ist unnötig.
Die gesehenen Screens zeigen folgende Ansatzpunkte:

| Beobachtung | Änderung | Abnahme / Aufwand grob |
|---|---|---|
| Karte heißt `dummy`, zeigt `n/a · #3`; Aufgabe/letzte Aktivität fehlt | Aufgabentitel + Host/Projekt + letzte verständliche Aktion; IDs in Details | zwei gleichartige Sessions in ≤ 5 s unterscheiden / S–M |
| „Heute: $0“ dominiert auch ohne belastbare Kosten | Kontingent/„nicht erfasst“ kontextuell; Kosten nur bei vorhandenen Daten | unbekannt niemals als kostenlos darstellen / S |
| Composer + Senden/Stop + Filter + fünf Tabs + vier Dockpunkte belegen viel Höhe | Chat und Änderungen primär, Verlauf/Bericht/Suche unter Details; Stop räumlich absetzen | 390×844: ≥ 50 % für Inhalt bei geschlossener Tastatur / M |
| Desktop zeigt dieselbe schmale Spalte | ab breitem Viewport Liste links, Session rechts, optional Diff | Wechsel ohne Verlust von Draft/Scrollposition / M |
| Voice enthält nicht ausführbare Beispiele und Task-ID T3.10 | nur echte, kontextfähige Aktionen vorschlagen; klare Modi „Diktieren“/„Befehl“ | jedes sichtbare Beispiel führt zum passenden echten Flow / S–M |
| Übersicht listet alles nach Projekten | „Braucht dich“, „Aktiv“, „Zuletzt“, Suche, Pins/Archiv | aus 20 Sessions jede wartende in ≤ 2 Taps öffnen / M |
| Neue Session beginnt mit technischer Adapterauswahl | zuletzt genutztes Projekt/Harness als Default, Erweiterte Optionen einklappen | nach Pairing mit Projekt+Prompt starten / S–M |
| Token-Anmeldung erklärt einen CLI-Befehl | einmaliger QR-/Code-Pairing-Flow, Geräteverwaltung | neues Handy ohne Token-Abtippen verbinden / M |

Weitere kleine QoL-Slices: „Seit deinem letzten Besuch“-Marker, zum neuesten
Ergebnis springen, Antwort kopieren, Anhang aus Handy-Teilen-Menü, gespeicherte
Prompts, Entwurf wiederherstellen, Session umbenennen/pinnen/archivieren,
zuletzt verwendete Skill-Wahl, `Ctrl/Cmd+K` am PC, kurze Fehler mit
„Erneut versuchen“. Umsetzung in P8/P9; kein Zusatz-Dashboard nötig.
Touch-Ziele, Fokusführung, Screenreader, Reduced Motion, 200%-Text und
Safe Areas werden geprüft; virtuelle Tastatur bleibt reale Geräteabnahme.

## 6. Laya und Sprache

Recherche vom 2026-09-21, Laya-HEAD `573e5b62696ba441230cd6be71d593331b5d23af`.
Laya verarbeitet Text/Zustand zu typisierten Entscheidungen (`choice`,
`score`, `noul`). Es liefert weder Transkription noch frei formulierte
Texte oder Desktop-Ausführung. Die README nennt ca. 33 ms auf T4 für eine
Frage, nicht Mikrofon→Aktion. Genannt werden auch CPU-Werte von 193–464 ms
bei vorgeladenen Modellen und Sekunden beim Modellwechsel ohne Preload.
Lizenz laut Repository: Apache-2.0. [Primärquelle](https://github.com/NandhaKishorM/laya).

Die eigenen Benchmarks nennen Schwächen bei vielen Auswahlklassen,
Sprachwechseln und unkalibrierten Konfidenzen. Für deutsche Hub-Befehle
liegt kein eigener Nachweis vor; Confidence allein erlaubt keine riskante
Aktion. [Benchmarkbericht](https://github.com/NandhaKishorM/laya/blob/main/BENCHMARKS.md).

**Architekturempfehlung (eigene Ableitung):** Ja, eine kleine lokale
Audio-Pipeline ergibt Sinn — aber als zwei getrennte Modelle. Als Startkandidat
kommt ein vorgewärmtes, mehrsprachiges `whisper.cpp`-`base`-Modell in Frage:
es transkribiert deutschsprachige Coding-Begriffe lokal. Danach bekommt Laya
ausschließlich das finale, editierbare Transkript und klassifiziert die Absicht.
`tiny` bleibt ein zu messender Latenz-Kandidat, wird wegen der erwartbar
schwächeren Fachbegriff-Erkennung aber nicht zur vorab versprochenen
Standardwahl. Die endgültige Auswahl entscheidet der P10-Messlauf auf den
Zielhosts; kein Modell wird durch diese Planung installiert.

Laya bleibt optional hinter einer kleinen Intent-Schnittstelle: zuerst
vordefinierte Aktionen erkennen, dann Host/Session/Parameter getrennt
validieren. Regeln dienen als Vergleich; komplexe Formulierungen gehen an einen
konfigurierten lokalen LLM-Planer. Kein Python-/GPU-Dienst wird Voraussetzung
für normales Chatten oder Stoppen.

```text
Mikrofon → VAD + whisper.cpp base (lokale Streaming-STT) → editierbarer Text
                                                        ├→ Diktat ins ausgewählte Feld
                                                        └→ Intent (Regeln / optional Laya / LLM)
                                                            → validierter Aktionsplan
                                                            → Policy + ggf. echte Freigabe
                                                            → Hub/Companion → sichtbares Ergebnis
```

Whisper.cpp ist ein geeigneter zu messender Kandidat für lokale STT;
das Projekt bietet CPU-/GPU-Pfade und VAD. Ein konkretes Modell muss auf
den Zielrechnern gemessen werden. [Projektquelle](https://github.com/ggml-org/whisper.cpp).
Browser-STT bleibt ein ausdrücklich gekennzeichneter Fallback:
Implementierungen können Audio an einen Dienst senden; Verfügbarkeit ist
nicht browserübergreifend garantiert. [API-Dokumentation](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).

**„Ohne Verzögerung“ wird als Messziel übersetzt:** erstes sichtbares
Teiltranskript p95 ≤ 500 ms ab erstem Sprachsignal; finaler Text p90 ≤ 1,5 s
ab Sprachende (K6); einfache Aktion p95 ≤ 2 s ab Sprachende bei vorgewärmten
Diensten, ohne menschliche Bestätigungszeit. Kalte Starts, WAN, CPU-Last,
STT/Intent/Dispatch separat ausweisen. Dies sind geplante Kriterien,
keine heute gemessene Leistung. Das erwähnte Video ist ohne Link nicht
identifiziert; es gibt keinen Beleg, dass es dieses Laya verwendet.

Alle Eingaben: Diktieren, korrigieren („ersetze X durch Y“), strukturierte
Felder füllen, Prompt verbessern, Rückfragen beantworten und navigieren.
Passkey/OS-Berechtigungen bleiben echte Nutzeraktionen. Beliebige PC-Felder
benötigen den P11-Companion; eine Sprach-PWA allein deckt sie nicht ab.

## 7. Reihenfolge, Gating und bestehende Restaufgaben

Die neue Anweisung autorisiert **Planung aller Lücken jetzt**. Die strengere
Skill-Regel „Epic erst anlegen, wenn Vorgänger grün“ wird dafür durch die
ausdrückliche Nutzeranweisung übersteuert; **Umsetzungsgates bleiben bestehen**.
P5–P12 sind ausgearbeitete, blockierte Planungsentwürfe, keine gestarteten Phasen.

**G0 vor P5:** bestehende P0–P4-Exit-Kriterien mit Belegen schließen.
Offene Punkte verbleiben beim Ursprung und werden nicht durch neue Häkchen ersetzt:

| Ursprung | Offener Nachweis / Arbeit | Verhältnis zur neuen Planung |
|---|---|---|
| P0 AC3/AC4 | echter Tailscale-Netztest, Offline-Abnahme inkl. BUG-0015 | zuerst als Vorgänger-Fix; P8 erweitert danach Robustheit |
| P1 Retro/AC1/2/4/5/6 | Handy-Flows, Kosten-/Filter-/Fixture-Evidenz, Push | Restarbeit P1; P8 erweitert Inbox/Benachrichtigungen |
| P1.5/P1.6 DoD | gemeinsamer echter Handy-Test, K6 und Voice-Gesture-Retest | bleibt offen bis real geprüft |
| P2 T2.4/AC1 | Session-Start-Gate/Approval-Teillücke; echte Mobilfreigabe | alte Zusage zuerst schließen; P7 erweitert Provider-Tool-Gates |
| P3 T3.1/T3.3/T3.6/T3.7, AC1/3/4/6 | Swarm, lokale Modelle, lokale STT, Suchumfang/Egress | bestehende Zusagen erfüllen oder Scope-Änderung ausdrücklich entscheiden; P7/P10 erweitern, duplizieren sie nicht |
| P4 T4.3/T4.4/T4.5/T4.8/T4.11 | Hermes/Gengar, WSL, Lizenz und Release | Zugriff/Entscheidungen offen; neue Planung erteilt keine Veröffentlichungsfreigabe |
| BUG-0004, aktuelles WIP | gemeinsames Adapter-Testkit, Typecheck und Integration Claude-Clip | vor „Flotte fertig“ nachweisen |

Das strikte Gate kann durch externe P4-Abhängigkeiten lange blockiert sein.
Eine spätere Nutzerentscheidung könnte OSS-/Brain-Ziele aus dem kritischen
Pfad nehmen; dieses Audit erklärt sie **nicht** eigenmächtig für optional
oder erledigt. Die Feature-Priorität bleibt: Session-Kontinuität zuerst,
danach Flotte/Parität, UI, AI, Sprache, Desktop-Companion, Gesamt-Abnahme.

| Epic | Ziel / eigene Schätzung, keine Zusage |
|---|---|
| [P5](../epics/EPIC-P5-session-discovery-handoff-recovery.md) | alle Sessions finden, echte PC↔Handy-Kontinuität, Recovery; 2–4 Agenten-Wochen |
| [P6](../epics/EPIC-P6-multi-host-fleet.md) | eine Oberfläche für alle Rechner; 1–2 Wochen |
| [P7](../epics/EPIC-P7-harness-tool-parity.md) | Provider-/Tool-Fähigkeiten, Rückfragen, Attachments, Gates; 2–4 Wochen |
| [P8](../epics/EPIC-P8-mobile-workspace-ux.md) | einfacher, zuverlässiger mobiler Arbeitsplatz; 1–2 Wochen |
| [P9](../epics/EPIC-P9-ai-command-input.md) | alle Hub-Aktionen und Felder per AI; 1–2 Wochen |
| [P10](../epics/EPIC-P10-realtime-voice-laya.md) | lokale schnelle Sprache, Laya-Entscheidung; 1–3 Wochen |
| [P11](../epics/EPIC-P11-desktop-companion.md) | systemweite Eingabe und verbleibende GUI-Flows; 2–4 Wochen |
| [P12](../epics/EPIC-P12-operational-readiness.md) | Installation, Restore, Upgrades, gesamte Geräte-/Provider-Abnahme; 1–2 Wochen |

Grobe Summe 11–23 Agenten-Wochen **zusätzlich** zur G0-Restarbeit;
unsicherster Teil sind native Provider-Übernahme und Desktop-GUI-Zugriff.
Spikes können technische Blockaden ergeben. Dann bleibt der beanspruchte
Vollumfang unerreicht, bis Integration gelingt oder der Nutzer Scope ändert.

## 8. Wann „fertig und nutzbar“ gerechtfertigt ist

Alle verpflichtenden Felder der Zielmatrix sind auf echten Zielsystemen grün;
PC→Handy→PC bewahrt Kontext/Identität; Ausfall eines Hubs/Netzes verliert keine
Eingabe und löst keinen Doppelauftrag aus; alle relevanten Rückfragen und
Freigaben erreichen das Handy; jeder UI-Flow hat einen geprüften AI-/Diktatpfad.
Installieren und Wiederherstellen gelingt nach Dokumentation. K1–K10 und die
neuen Epic-ACs sind durch reproduzierbare Messläufe belegt. Kein offener
kritischer Befund, kein „unproven“ unter einer Pflichtfähigkeit.

Der aktuelle Auftrag liefert Audit und Planung. Er implementiert diese
Fähigkeiten nicht und setzt deshalb kein neues Epic auf „grün“.

## 9. Abschlussprüfung des Planungs-Diffs

Acht Epics, 44 Aufgaben, 42 ACs, je vier konkrete Premortem-Fälle; alle sieben
Schemaabschnitte und lokalen Markdown-Linkziele maschinell geprüft.
Die Prüfwiederholung oben klärt den einmaligen tmux-Ausfall nicht als behoben;
er bleibt ein Reliability-Befund für T12.2. Test-Stderr enthält außerdem
ENOENT beim Aufräumen temporärer Server-Testdaten; keine Behauptung eines
bereinigten Test-Lifecycles. Produktiv-Code wurde nicht verändert.

Review nach `pr-review`, zwei getrennte Achsen:

| Dimension | Ergebnis für diesen Dokumentations-Diff |
|---|---|
| D1 Requirements | Audit, echte UI-Sichtung, Laya-Recherche, vollständige bekannte Lücken→Epic-Zuordnung und AI-Eingabe-Scope vorhanden; neue Funktionen ausdrücklich nur geplant |
| D2 Architektur | geplante Änderungen verlangen ADR/Contracts, AdapterContext und gemeinsamen Operationskatalog |
| D3 Edges | Gerätewechsel, konkurrierende Writer, unbekannte Provider, Offline, Restart, Approval-/GUI-Outcome und Mikrofonfehler als AC/Premortem enthalten |
| D4 Qualität | bestehende Tasks bleiben Eigentümer ihrer Restarbeit; keine Runtime-Abhängigkeiten oder vorgetäuschte Implementierung hinzugefügt |
| D5 Determinismus | wiederholter Basislauf grün, beobachteter erster Fail bleibt dokumentiert; WIP-Typefehler getrennt ausgewiesen |
| D6 Future-Fragility | kein Contract geändert; keine Adapter-Imports/Spawns verändert; K5-Blob-/K7-Recovery-Anforderungen in jedem Epic; unbekannte Formate ausdrücklich sichtbar statt still verworfen |

**Handwerk:** Dokumentations-Diff erfüllt die Repo-Struktur, keine Secrets,
Roh-Chatlogs oder Screenshots hinzugefügt. **Auftrag:** Bestandsaufnahme und
Planung erfüllt; „App fertig“ weiterhin nicht erfüllt. Kein unabhängiger
Zweitreview durchgeführt; diese Prüfung ist ein Selbstreview, kein Red-Team-Test.
