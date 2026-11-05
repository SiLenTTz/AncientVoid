# Paseo-Impulse: Planungsgrundlage für P28–P33

**Datum:** 05.11.2026 · **Status:** Planung, keine Implementierungsfreigabe
**Auftrag:** uncommittete [Vergleichsanalyse](2026-11-05_paseo-vs-ancientvoid.md)
lesen und auf neuem Planungsbranch detaillierte Verbesserungs-Epics ausarbeiten.
**AncientVoid-Basis:** `origin/main` bei Branch-Anlage:
`b8dad000e3c770d5ee3cd26bd3b9138a6087b209`.
**Branch:** `docs/paseo-verbesserungen-planung`.

## 1. Einordnung der Ausgangsanalyse

Die Vergleichsanalyse bleibt unverändert als Eingangsquelle erhalten. Ihre
Wertungen, Zahlen und Aussagen über Verlässlichkeit sind keine automatisch
bestätigten Produktanforderungen. Für die Planung zählen konkrete Lücken:

| Aussage im Vergleich | Verifizierter AncientVoid-Bestand | Konsequenz |
|---|---|---|
| Worktree-Workflow/Isolation fehlt | `packages/core/src/modules/workspace/worktree.ts`: Create, Basis-SHA, Apply, Quota; `worktree-hygiene.ts`: konservatives Cleanup; `main.ts`: Manager verdrahtet | P29 erweitert um Manifest, Setup, Services, Ports; kein neuer Worktree-Manager |
| Keine Erweiterbarkeit ohne Plugin-Format | `AdapterRegistry.loadAll` lädt externe Module; Reporting-Sinks und Beispiele existieren | P30 ergänzt Paketbeschreibung/Installation/Nachweise, ersetzt nicht Registries |
| ACP muss erschlossen werden | ACP-Presets copilot/opencode/dsh/maki/omp, Modell-Probe, Commands und Elicitation vorhanden | P31 plant Provider-Katalog und Nachweise, keinen zweiten ACP-Adapter |
| CI faktisch kaputt | `.gitlab-ci.yml` hat Verify/E2E mit Systempaketen und Browser; lokales Gate hat zusätzliche Checks, CI-Lasttest nur 10×20 | P28 diagnostiziert belegte Ursachen und stellt Parität her; Erfolg anderer Projekte beweist keine konkrete Fehlerursache |
| Keine Diff-/Entwickler-Werkzeuge | PRD/P2 und Hub-Module für Diff/Code, ADR-0016 mit Apply existieren | Keine pauschale Kategorie „fehlt komplett“ übernehmen; integrierte IDE bleibt außerhalb dieses Auftrags |
| Native App = Expo-WebView | Paseo beschreibt volle native App; `packages/app/package.json` nutzt Expo | WebView-Shell ist eine eigene AV-Option, keine nachgewiesene Paseo-Architektur |
| Aider/DeepSeek/Local-LLM/Swarm könnten ACP ersetzen | ACP ist ein Protokoll, Modell/API-Endpunkt allein ist kein ACP-Harness | P31 prüft einzeln, alte P3/P12-Restarbeit bleibt bis zum Paritätsnachweis offen |

Keine neuen Aufgaben für Relay, Electron-Desktop, Cron-Schedules oder komplette
Editor-/Terminal-/PR-Suite: Die Analyse schließt diese Übernahmen ausdrücklich
aus. Vorhandene Diff-/Code-/Approval-Funktionen werden erhalten.

## 2. Zuordnung und Reihenfolge

Priorität P1/P2/P3 aus §5 der Analyse ist eine Dringlichkeitsklasse, **keine**
AncientVoid-Epic-Nummer. Die neue Kette beginnt nach P27; Planung erlaubt keinen
Umsetzungsstart trotz offener realer Abnahmen früherer Phasen.

| Analyse §5 | Epic / Lieferergebnis | Schätzung (Agenten-Wochen) | Startbedingung |
|---|---|---|---|
| P1: funktionierende CI | [P28](../epics/EPIC-P28-reproduzierbare-ci.md): Diagnose, saubere Runner-Umgebung, vollständige Gate-Nachweise | 1–2 | P27 samt wirksamer Vorgänger-Exits grün |
| P1: Worktree-first | [P29](../epics/EPIC-P29-worktree-workspace-runtime.md): Manifest, Dateiübernahme, Setup/Teardown, Services, Ports, Preview | 3–5 | P28 grün; P2/P14/P26-Abgleich |
| P2: Plugin-Format | [P30](../epics/EPIC-P30-adapter-sink-plugins.md): lokales/Git-Format für Adapter und Sinks, Testkit, Lifecycle | 2–3 | P29 grün |
| P2: ACP-Breite | [P31](../epics/EPIC-P31-acp-provider-katalog.md): kuratierter Provider-Katalog, explizite Probe, zwei neue reale Provider | 2–3 | P30 grün |
| P3: optional Native | [P32](../epics/EPIC-P32-mobile-client-entscheidung.md): Gerätebefund und Go/No-go; nur bei Go interner Android-Client | 0,5–1; optional +2–4 | P31 grün, P12/P16-Gerätebefunde geprüft |
| P3: englische Public Docs | [P33](../epics/EPIC-P33-englische-einstiegsdokumentation.md): Bedarfsentscheid, englischer Start-/Contract-Einstieg | 0,5–1,5 | P32-Exit explizit abgenommen; P4/P12-Abgleich |

Schätzungen schließen die offene Vorgänger-Restarbeit, Infrastrukturwartezeit
und Store-Publikation aus; keine Terminzusagen. Zusätzliche native Umsetzung
ist separat. P28 zuerst schafft überprüfbare Nachweise für die übrigen Phasen.
Eine spätere Umpriorisierung braucht eine explizite Entscheidung samt
angepassten Abhängigkeiten, keine stillschweigende Parallelfreigabe.

P32/P33 haben einen **Evaluations-Exit** und einen bedingten
**Implementierungs-Exit**. Nutzerentscheid „No-go/vertagt“ beendet nur die
Evaluation; optionale Tasks werden nicht als umgesetzt abgehakt. Damit P33 nach
vertagter App starten darf, muss dieser P32-Exit ausdrücklich dokumentiert sein.
Ohne Entscheidung wartet das jeweilige Gate.

## 3. Anforderungen über die Epics hinweg

- Geteilte Contracts zuerst; neue Adapter-/Event-/Worker-Verträge benötigen ADR.
  Geplante Feld-/Eventnamen sind Entwürfe, keine bereits stabilen APIs.
- Neue Domäne bleibt nach ADR-0020 in ihrem Modul mit öffentlicher `index.ts`;
  Adapter sehen nur ihren AdapterContext, keine Core-/Server-Imports.
- K5 gilt auch für Setup-/Service-/Plugin-Fehler: Events ≤4 KB, Logs als Blobs.
  K7 gilt für neue Zustände: Journal/Snapshot plus Referenzartefakte; fehlende
  Dateien/Versionen werden sichtbar, nicht durch erfundene Defaults ersetzt.
- Externe Effekte sind nicht allgemein exactly-once. Nach unklarem Crash-Zustand
  keine automatische Wiederholung von Setup/Install/Teardown. Eigene Prozess-
  Ownership nachweisen; fremde Prozesse nicht anhand einer Portnummer beenden.
- Manifest, Plugin und Provider-Katalog sind unterschiedliche Vertrauensgrenzen:
  Repo-Setup braucht Hash-Freigabe, Plugin-Code bewusste Auswahl, Provider-Probe
  ein lokal installiertes Programm. Testkit ist kein Malware-Zertifikat.
- Existierende Task-/AC-IDs behalten offene Restnachweise; keine neue Epic löscht
  P4/P12/P16/P24/P25/P26/P27-Abnahmen durch einen neuen grünen Status.
- E2E-Spec pro neuem UI-/Bedienablauf; native Systemgrenzen zusätzlich am Gerät.
  Skips und externe Blocker sind keine Pässe. Bis Änderung der Regel bleiben
  lokale Gates nach AGENTS.md verbindlich; neue Epics verlangen zusätzlich
  sichtbare CI-Evidenz und erklären Abweichungen.

## 4. Entscheidungen vor der jeweiligen Umsetzung

| Entscheidung | Verantwortlicher Zeitpunkt | Vorbereiteter Default |
|---|---|---|
| Runner-Host, Isolation, Betrieb/Kosten; Mirror erlaubt? | P28 T28.2 | bestehenden GitLab-Pfad zuerst reparieren; kein Public-Mirror |
| Manifest-/Trust-/Service-Contract, Preview-Auth | P29 T29.1/T29.2 | versioniertes Manifest, argv, keine freie Remote-Shell |
| Plugin-Format, unterstützte Quellen/Dependencies | P30 T30.1 | Adapter/Sink, lokale Kopie/Git-SHA, kein Marketplace |
| Zwei neue lokal gewünschte ACP-Provider | P31 T31.1 | nach Protokoll-/Lizenzbeleg auswählen; keine erfundene Liste |
| Native App tatsächlich nötig und Push-Pfad akzeptiert? | P32 T32.1/T32.2 | erst Gerätebefund; ohne Go keine Shell bauen |
| Englischen Einstieg jetzt liefern oder vertagen? | P33 T33.1 | kleiner Einstieg; kein automatisches Open-Sourcing |

Diese Punkte brauchen heute keine Freigabe, um die Planung fertigzustellen.
Die abhängige Umsetzung wartet jeweils auf Evidenz/Entscheidung.

## 5. Erneut geprüfte Paseo-Primärquellen

GitHub-Abfrage bei Planung aufgelöst auf Commit
`e6064bb374ccddb63bea7d6aac15c9cad3d985ee`; Links unten sind eingefroren.
Es wurde kein Paseo-Code ausgeführt oder in AncientVoid kopiert.

- [README](https://github.com/getpaseo/paseo/blob/e6064bb374ccddb63bea7d6aac15c9cad3d985ee/README.md): Positionierung, native Clients und daemonseitige Plugins.
- [Worktrees](https://github.com/getpaseo/paseo/blob/e6064bb374ccddb63bea7d6aac15c9cad3d985ee/public-docs/worktrees/index.md): Manifest-/Service-Lifecycle als Vorbild; AV übernimmt nicht automatisch dessen Shell-/Merge-Policy.
- [Dateiübernahme](https://github.com/getpaseo/paseo/blob/e6064bb374ccddb63bea7d6aac15c9cad3d985ee/public-docs/worktrees/worktreeinclude.md): explizite lokale Konfigkopie als Inspiration; AVs restriktive v1-Liste ist eine eigene Entscheidung.
- [Port-Allocator](https://github.com/getpaseo/paseo/blob/e6064bb374ccddb63bea7d6aac15c9cad3d985ee/packages/server/src/server/workspace-service-port-allocator.ts): Portvergabe als Implementierungsreferenz, keine Garantie gegen Bind-Races.
- [Workspace-Modell](https://github.com/getpaseo/paseo/blob/e6064bb374ccddb63bea7d6aac15c9cad3d985ee/public-docs/workspaces.md): vom Agenten getrenntes Workspace-Konzept; AV-v1 behält bewusst den Session-Worktree.
- [Plugin-Quickstart](https://github.com/getpaseo/paseo/blob/e6064bb374ccddb63bea7d6aac15c9cad3d985ee/public-docs/plugins/index.md) und [Provider-Plugins](https://github.com/getpaseo/paseo/blob/e6064bb374ccddb63bea7d6aac15c9cad3d985ee/public-docs/plugins/providers.md): Paket-/Provider-Integration, wesentlich breiter als AVs geplanter Adapter-/Sink-Scope.
- [ACP-Provider-Katalog](https://github.com/getpaseo/paseo/blob/e6064bb374ccddb63bea7d6aac15c9cad3d985ee/packages/app/src/data/acp-provider-catalog.ts): kuratierte Metadaten/Commands; kein Beleg für AV-Capability-Parität.
- [App-Paket](https://github.com/getpaseo/paseo/blob/e6064bb374ccddb63bea7d6aac15c9cad3d985ee/packages/app/package.json): Expo-/native App-Toolchain; kein Beweis, dass eine WebView für AV genügt.
