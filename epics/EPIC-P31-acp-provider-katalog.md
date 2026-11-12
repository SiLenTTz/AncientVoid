# EPIC-P31 — ACP-Provider-Katalog mit ehrlichen Fähigkeitsnachweisen

**Status:** Planungsentwurf · **Umsetzung:** gesperrt (umpriorisiert 2026-11-08: läuft nach P36, Nutzerentscheid) · **Phase:** P31
**Dauer:** 2–3 Agenten-Wochen (ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P30-Exit-Kriterien grün; P7/P24/P25-Restnachweise geprüft.

Quelle: [Vergleichsanalyse vom 05.11.2026](../docs/2026-11-05_paseo-vs-ancientvoid.md), §5; [Planungsgrundlage und Quellen](../docs/2026-11-05_paseo-umsetzungsplanung.md).

**Planungsauftrag:** Der Nutzer hat am 05.11.2026 ausdrücklich detaillierte
Epics zu den Verbesserungen der Paseo-Analyse beauftragt.

> **Update 2026-11-12 (Nutzerbeauftragung):** Der Plugin-Rahmen aus diesem Epic ist die Grundlage für
> **EPIC-P55** (Plugin-Toggles in den Settings mit Token-Ersparnis-Nachweis, Headroom-artige Context
> Compression als `ContextPlugin` am LLM-Aufrufpunkt) — P30-Registry/Scopes dort wiederverwenden.
>Routing-Entscheidungen (Regeln zuerst, Router-LLM nur als Fallback) stützen sich auf den Katalog hier;
> Recherche-Grundlage: RouteLLM (lmsys, bis 85% Kostenersparnis bei 95% Qualität auf MT-Bench — gilt für
> Chat-Workloads, nicht unbesehen für Coding-Agenten). Das erlaubt diese
Planung vor grünen Vorgängern, aber keinen Implementierungsstart. Vor T*.1
Vorgänger-AC mit aktueller Code-/Test-Evidenz prüfen; historische Statuszeilen
reichen nicht. Keine neue Ausnahme von AGENTS.md durch diesen Entwurf.

## 1. Ziel

Weitere tatsächlich ACP-fähige CLIs lassen sich aus einem kuratierten Katalog
gezielt konfigurieren. Nutzer sehen je Host Installation, Handshake und separat
bewiesene Funktionen. Breite ersetzt keine Approvals-/Resume-/Tool-Parität.
Messlatten: K1/K2/K5/K7/K8; fail loud analog K9 ohne dessen Cursor-Metrik umzudeuten.

## 2. Scope (In / Out)

**In:** Provider-Metadaten, explizite lokale Probe, serverseitige Projektion,
Auswahl in PWA/hubctl, Capability-Negotiation und konservativer Nachweisstatus,
zwei reale zusätzliche ACP-Provider nach vorheriger Kompatibilitätsprüfung.

**Out:** Auto-Installation/Remote-Code durch Discovery, Preisgabe von Tokens,
pauschales Ersetzen nativer Adapter, Entfernen unproven-Vorlagen ohne Paritäts-
nachweis, „30+ proven“-Marketing oder Modelle mit ACP-Harnesses gleichsetzen.

## 3. Design-Details

### 3.1 Bestand und Quelle

`packages/adapters/acp/src/index.ts` enthält bereits Presets für copilot,
opencode, dsh, maki, omp; `catalog.ts` probt dynamische **Modelle**, nicht
installierbare Provider. Commands/Elicitation existieren samt Tests. P25- und
P24-Nachweise werden weitergenutzt. Paseos `acp-provider-catalog.ts` enthält
Command-/Versionsmetadaten; Eintrag ist dort ebenfalls kein AV-Paritätsbeleg.

Katalog-/Probe-Verträge unter contracts/harness, serverseitige Verwaltung in
core/harness (öffentliche `index.ts`), ACP-Protokoll bleibt im ACP-Adapter.
Routen in hub/modules/harness, UI im Provider-/Session-Start-Feature. ADR vor
Adapter-/Event-Contract-Erweiterung; keine neuen Core-Imports im Adapter.

### 3.2 Katalog und Probe

V1 ist kuratiert und mit dem Release versioniert: Provider-ID, Anzeigename,
Quelle/Lizenzhinweis, getestete CLI-Version, argv-Vorlage, OS-Voraussetzungen,
benötigte Secret-Referenzen. Keine Übernahme fremder Icons/Lizenztexte ungeprüft.
Lokale Overrides separat validieren. P30 ist optionales Distributionsformat;
Katalog erfordert weder Plugin-Download noch Netzwerk beim Hub-Start.

Metadaten lesen startet keinen Prozess. Menschlicher Probe-Befehl startet nur
das bestätigte lokal installierte Executable, kein automatisches `npx -y`.
Probe mit Deadline/temporärem Arbeitsverzeichnis; kontrollierter initialize-
Handshake und nur falls erforderlich Probe-Session, kein kostenpflichtiger
Prompt. Ergebnis mit Version/Host/Zeitpunkt/Fehler und TTL; gecacht, bei
Versionswechsel stale. Kein Login/Download als Nebenwirkung.

Zustände getrennt: verfügbar/nicht installiert/auth erforderlich/Probe fehlgeschlagen
und unproven/proven je Fähigkeit. Handshake ≠ Tools sicher ≠ Resume belegt.
Steuerung, Permission-Gate, Anhänge, Commands, Modellwahl und Resume aus
Handshake plus Test-/Live-Evidenz ableiten; unbekannt konservativ deaktivieren.
Nicht abgefangene Tools nie als hub-gated verkaufen; bestehende Policy erhalten.

### 3.3 Migration und Recovery

Neue Katalog-Auswahl erzeugt bekannte Adapter-Registrierung mit stabiler
Provider-ID. Bestehende IDs/Resume-Refs bleiben unverändert. Snapshot hält
Provider/CLI-Version und Referenzen, Cache ist nur Projektion. Offline nutzt
letzte Prüfung mit Zeitstempel; stale oder fehlendes Binary wird als solches
sichtbar. Restore wechselt niemals Provider. Aider, DeepSeek, Local-LLM und
Swarm einzeln auf native ACP-Unterstützung prüfen; ohne Beleg bleiben bestehende
P3-/P12-Aufgaben offen, keine künstlichen Wrapper nur für Kataloggröße.

## 4. Aufgaben (Checkliste T31.m)

- [ ] **T31.1** ACP-Bestands-/Nachweismatrix samt ADR und Katalogschema;
  zwei zusätzliche Provider nach lokalem Bedarf und echter ACP-Unterstützung
  auswählen; Lizenz-/Installationsgrundlage dokumentieren. **K1/K5/K7**.
- [ ] **T31.2** Katalog laden/validieren und explizite, begrenzte Probe über
  Worker-Pfad; Fixtures für fehlendes Binary, Authfehler, Timeout,
  ungültiges/zu großes Format und Versionswechsel. **K5/K7/K8**.
- [ ] **T31.3** Negotiation/Nachweise pro Fähigkeit, modell-/command-spezifische
  Regressionen und große Tool-/Thought-Ausgaben via Blob prüfen; Permission-
  Request erlauben/ablehnen, unbekannte Updates sichtbar melden. **K1/K2/K5**.
- [ ] **T31.4** PWA-Auswahl/hubctl mit Installation, Herkunft, Fehler,
  Probezeitpunkt und stale-Anzeige; Auswahl verändert keine aktive Session.
  Spec `e2e/specs/acp-provider-catalog.spec.ts`. **K2/K7/K10**.
- [ ] **T31.5** Zwei reale neue Provider live und Testkit prüfen (Prompt,
  Follow-up, Interrupt, Tool-Freigabe, Restart/Resume soweit unterstützt);
  Nachweise je Version/Capability. **K1/K5/K7/K8**.
- [ ] **T31.6** P3-/P12-Vorlagen-Abgleich und README-Matrix aktualisieren;
  ablösen nur nach belegter Gleichwertigkeit mit Migrationsweg,
  sonst begründetes Beibehalten. **K5/K7**, PRD §9.

## 5. Acceptance Criteria (AC-P31-k)

- **AC-P31-1:** Katalog listet vorhandene Presets und zwei tatsächlich
  verifizierte zusätzliche Provider ohne parallele Modell-/Provider-Verwechslung.
  Fehlende reale CLIs/Lizenzen blockieren diesen AC, Fixtures ersetzen ihn nicht.
- **AC-P31-2:** Discovery startet/ installiert nichts; Probe ist explizit,
  beendet ihre Prozesse bei Timeout und meldet Auth/Formatfehler sichtbar.
- **AC-P31-3:** Permission-/Resume-/Command-Fähigkeiten werden einzeln belegt;
  Handshake-only erscheint unproven. Unsupported wird nicht auswählbar behauptet.
- **AC-P31-4:** Restart rekonstruiert Sessions samt identischen Provider- und
  Resume-Refs <3 s, unabhängig von Probe-Erreichbarkeit; keine Events >4 KB.
- **AC-P31-5:** E2E zeigt Fehler/stale/Offline und erfolgreichen Start;
  K8-Regression grün, bestehende Presets und native Adapter unverändert nutzbar.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Provider-Katalog wird Download-Launcher:** lokale Executables und explizite
   Probe, keine Upstream-Installbefehle ungeprüft ausführen.
2. **ACP-Handshake wird als volle Steuerung verkauft:** konservative Capability-
   Matrix, Testkit plus getrennte Live-Nachweise je Version.
3. **Probe hängt Hub-Restore auf:** gecachte Projektion, asynchron/deadline-begrenzt,
   fehlende Provider blockieren nur betroffene Starts.
4. **Native Resume-Refs gehen bei Migration verloren:** keine ID-Umbenennung,
   alte Sessions bleiben bei ursprünglichem Adapter, Migration separat abnehmen.

## 7. Definition of Done

Alle Aufgaben/AC belegt; `npm run gate`, Adapter-Testkit und K8 grün;
Pipeline-Job `e2e` grün bzw. Infrastrukturfehler gemäß AGENTS.md separat belegt.
Jeder neue UI-Ablauf mit Spec in `e2e/specs/`, zwei Live-Providerberichte ohne
Secrets, README-/Capability-Matrix und installierbare Beispielkonfiguration
auffindbar. Keine Skips als bestandene reale Unterstützung gezählt.
