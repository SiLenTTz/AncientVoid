# Setup und Modellanbindungen — Repository-Audit vom 11.11.2026

Basis: AncientVoid `9d97e19`, eigener Session-Worktree; Node v26.7.0.
Repositoryweite Orientierung über README, AGENTS, PRD §8/9, Epic-/Bug-Index,
Workspace-/CI-Konfiguration; vertiefte Code- und Ablaufprüfung für Setup,
Hub-Konfiguration, Harness-Inventar, Modellkatalog, eigenes Modellregister,
OpenAI-Beispieladapter, lokale Dienste und VoidWarden-Kaskade. Kein Beweis,
dass jede Funktion des gesamten Repositories fehlerfrei ist.

## Isolation und Epic-Gates

Claudes Haupt-Worktree lag bei Beginn auf
`feat/p43-t6-tablet-kachelkopf-schnellsuche`, HEAD `0ebc241`.
Dort waren später `apps/pwa/src/features/windows/DetachButton.tsx` und
`docs/adr/0068-herausloesen-ueberall.md` untracked: bereits Arbeit an T43.7.
P43 reserviert PWA-Layout, Session-/Dateienansichten, Commands, Windows,
Nyx-Blatt, Styles, Inventar/E2E und die Display-Fragen-Policy T43.10.
Diese Dateien wurden hier nicht geändert; keine fremden Worktrees, Dienste,
Provider-Konfigurationen oder Tokens verändert. Tests nutzen temporäre Daten.

P53 ist abgeschlossen; die Befunde sind Korrekturen zu dessen ACs, keine
Freigabe späterer Epics. P35 hat eine offene Live-Abnahme, P26 die echte
Factory-Abnahme, P41 offene Exit-Kriterien. Diese wurden nicht als grün erklärt.
Kein neues Epic dupliziert die bereits verantwortlichen P3/P35/P53 bzw.
VoidWarden P14. Deren abhängige Arbeiten bleiben als konkrete Bugs/Follow-ups
unten sichtbar.

## Ergebnis und Priorität

| Befund | Beleg / Bearbeitung | Zuordnung |
|---|---|---|
| Tokens trotz anderem dataDir in Default-DB | Reproduziert mit echtem hubctl/SQLite; Fix plus drei Regressionstests | [BUG-0130](../bugs/bug-0120-setup-token-falsches-datadir.md), P53, K7/PRD §8 |
| Lokaler Beispieladapter verschweigt ungültige SSE-/Folgepromptfehler | AdapterContext-Probe bestätigt; größere Adapter-Abnahme offen | [BUG-0131](../bugs/bug-0121-openai-fehler-still-verworfen.md), P3/P35, K5/K9 |
| Falscher bereits laufender Hub wird übernommen | Entscheidungszweig mit HTTP-Stand-in bestätigt, kein produktiver Zweithub gestartet | [BUG-0132](../bugs/bug-0122-setup-verwendet-fremden-hub.md), P53 |
| Mindestversion 22.5 widerspricht Toolchain | Code-/Manifestbeleg; ältere Runtime nicht live getestet | [BUG-0133](../bugs/bug-0123-setup-node-mindestversion.md), P53 |
| OpenAI-Wizard baut JSON durch String-Interpolation | Quote im Modellnamen erzeugt SyntaxError/Exit 1 | [BUG-0134](../bugs/bug-0124-setup-openai-json-escaping.md), P53 |
| Wiederholtes --voidwarden erzeugt weitere Tokens | Zweimal echter hubctl: je zwei agent-/display-Tokens | [BUG-0135](../bugs/bug-0125-setup-voidwarden-zweittokens.md), P53/VW P14 |
| Onboarding behauptet Factory/Slash-Brücke seien nicht gebaut; manueller Token-Schritt fehlt | Gegen P26/BUG-0079/CLI abgeglichen; Anleitung korrigiert | docs/onboarding.md |

Zuerst BUG-0132/0133 für verlässlichen Erststart, danach BUG-0131 für den
beworbenen lokalen Chat-Weg. JSON-/Idempotenzkorrekturen separat reviewbar
umsetzen. Der jetzige Produktionspatch ändert ausschließlich die Zuordnung
von Setup-Tokens und Marker zur konfigurierten Datenbank.

## Automatik und manuelle Anbindung

| Weg | Was tatsächlich automatisch passiert | Was Nutzer weiterhin einrichten müssen |
|---|---|---|
| Wizard | PATH-Erkennung bekannter CLI-Namen, Adapter-Config-Auswahl | CLI-Installation, Anmeldung, erfolgreicher Provider-Turn; kein Provider-Smoke im Wizard |
| Hub-Inventar / Discovery | CLI-Probes bzw. Sessions aus bekannten Stores | Kein genereller Netzscan nach Ollama/llama.cpp; keine Modellinstallation |
| ACP | Modelle/Optionen vom Harness, sichtbare Ablehnung unbekannter Auswahl | Native Provider-Config und Schlüsseldatei via config.envFiles |
| Native Adapter | modelsCommand bzw. pi-Katalog oder freie Modell-ID | Provider-eigene Anmeldung; freie ID allein aktiviert keinen Provider |
| Eigenes Modell | Hub-Register ergänzt den Katalog adapterbezogen | Tatsächliche Verfügbarkeit beim Harness |
| pi-Endpunkt | models.json mit Backup/0600, Konflikt erfordert bewusstes Ersetzen | Server, passende Modell-ID, Schlüssel/Umgebung des pi-Prozesses |
| OpenAI-Beispiel | Streaming-Chat an baseUrl/chat/completions | /v1-Basisadresse, laufender Server, apiKeyEnv in der Hub-Umgebung; keine Tools |
| Gatekeeper / Assistant / Medien | Eigene konfigurierte HTTP-Clients | Separate Modell-/STT-/Vision-Endpunkte, kein Erben aus der Session-Modellwahl |

Quellen: `setup.sh`, `apps/hub/src/modules/harness/harness.routes.ts`,
`packages/core/src/modules/harness/`, `packages/models/src/index.ts`,
`packages/core/src/modules/custom-models/`, ADR-0054/0060,
`docs/local-llm.md`, `docs/configuration.md`.
`envFiles` ist im ACP-Adapter implementiert, keine globale Hub-Zusage.
Die konkreten evox2-/Tailnet-Adressen aus local-llm.md sind Betriebsbeispiele.
Es wurden keine externen Provider angefragt und keine privaten Keys gelesen;
echte Modellqualität, Authentifizierung und GPU-Betrieb sind damit nicht neu
abgenommen. Historische Live-Belege bleiben als solche erkennbar.

## Abhängige Befunde separat

**Lokaler Beispieladapter (P3/P35, Anschluss an BUG-0131):**
Die erfolgreiche Fixture-Antwort emittiert `completion finished` mit leerem
Payload, kein `session.turn_end`. `recover()` fehlt, history liegt nur im
Handle; Stop löscht den Handle, Abbruch hängt am Context-Signal. Große einzelne
Content-Deltas werden direkt emittiert. Codebefunde zu K5/K7 und Zugabschluss,
noch kein vollständiger SessionManager-Repro. Vor einer „proven“-Aussage:
Integration mit echtem Hub, zwei Folgeprompts, Stop, Restart/Recovery und
>4-KB-Chunk; dann kleinste gemeinsame Reparatur mit Adapter-Testkit. Keine
neue Contract-Semantik ohne ADR. README nennt den Adapter bereits unproven;
das Onboarding darf ihn deshalb nicht pauschal als fertig versprechen.

**Modellkatalogfehler (P35/P43-UI-Grenze):**
`GET /api/adapters/:id/models` fängt Listingfehler ab und antwortet wie bei
fehlendem Katalog mit `models: null`; nur Server-Log unterscheidet den Fehler.
Das ist ein Codebefund, nicht als Browserfehler bestätigt. An BUG-0049
anschließen (bestehende Behandlung flackernder/fehlgeschlagener Kataloge),
keine zweite Ticketnummer: API-Fehlschlag injizieren und verständliche Meldung
sowie Erhalt einer guten Auswahl testen. PWA-Dateien wegen P43 unberührt.

**Wizard-Provider-Vorabprüfung (P53 AC-2 / Design §3):**
Die vorhandene CLI-Erkennung und Adapter-JSON-Erzeugung sind keine erfolgreiche
Modellanbindung; ein fehlendes Login/Key wird nicht vorab geprüft. P53 versprach
Provider-Validierung und Key-Datei-Abfrage, `setup.sh` bietet beides bisher
nicht. P53 wieder öffnen/ergänzen: fehlende CLI, ungültiger Endpunkt,
401/Timeout und nicht verfügbares Modell als isolierte Proben; keine bezahlten
oder schreibenden Provider-Aufrufe ohne bewusste Auswahl. Die Anleitung stellt
diese Grenze jetzt klar, historische P53-Abnahme bleibt unverändert.

**VoidWarden (nur lesend, HEAD b26dfc8):**
`companion/src/config.ts`, `voice.ts`, Beispielconfig, README und setup.sh
gegengelesen. Kein LLM-Provider in der Config: Ansagen entstehen aus festen
Vorlagen, optional Kokoro unter `voice.url`; Standard ist disabled mit einer
installationsspezifischen Tailnet-URL. Hub-Modellwahl konfiguriert das nicht.
VW P14 nachziehen: portable TTS-Einrichtung und erreichbarer Endpunkt,
fehlender TTS-Dienst sichtbar, echter Kiosk-Audiotest. Keine neue VW-Epic ohne
Abgleich dortiger Planung nötig. Die --av-checkout-Option prüft zwar einen
alternativen Pfad, npm install löst vorher weiterhin die feste file:-Dependency
auf; Nicht-Sibling-Frischklon muss dort als weiterer P14-Negativfall geprüft
werden (Codebefund, nicht live bestätigt). Hier keine Änderungen im Schwesterrepo.

## Nachweise und Review

- Setup-Test: vor Fix Default grün, relative/absolute Datenpfade rot;
  danach drei Tests grün. Echte CLI und DB; npm-Installation im Test ersetzt.
- Weitere Shell-Proben: je zwei VoidWarden-Tokens nach Wiederholung;
  fremder ready-Responder akzeptiert; Modell mit Quote → Exit 1/SyntaxError.
- Adapter-Probe: ungültige SSE-Zeile verschwiegen; Folgeprompt-Netzwerkfehler
  → ok-Ack und nur querying-Ereignis. In-memory fetch-Fixtures, kein Egress.
- Installationscheck: npm ci installierte Dependencies; prepare musste wegen
  Sandbox-Zugriff auf gemeinsame Git-Metadaten separat freigegeben laufen.
- Vollständiges Gate und Abschlussreview: Ergebnis wird nach Lauf ergänzt.

Review-Grenzen: keine Contracts geändert; AdapterContext-Isolation, K5 und
Event-Recovery durch den Token-Patch nicht berührt. Bestehende SQLite-DB als
State-Quelle beibehalten, kein neuer Token-Klartext auf Disk. Pfade mit
Leerzeichen und alte Marker getestet. Keine Interpretation von Agenten-Output.
Ungeprüfte Fälle (fremder Hub, Runtime-Matrix, reale lokale Modelle/TTS) bleiben
explizit offen und werden durch einen grünen Unit-Test nicht abgenommen.
