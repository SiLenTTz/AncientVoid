# EPIC-P32 — Optionaler nativer Mobile-Client mit Bedarfsentscheid

**Status:** Evaluations-Exit „vertagt" 2026-11-08 ([Entscheidungsdokument](../docs/2026-11-08_p32-evaluations-exit.md)) · Umsetzung T32.3–T32.6: gesperrt bis ausdrückliches neues Go · **Phase:** P32
**Dauer:** 0,5–1 Evaluation; optional 2–4 Umsetzung Agenten-Wochen (ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P31-Exit-Kriterien grün; P12/P16-Geräteabnahmen und P8/P10-Funktionen geprüft.

Quelle: [Vergleichsanalyse vom 05.11.2026](../docs/2026-11-05_paseo-vs-ancientvoid.md), §5; [Planungsgrundlage und Quellen](../docs/2026-11-05_paseo-umsetzungsplanung.md).

**Planungsauftrag:** Der Nutzer hat am 05.11.2026 ausdrücklich detaillierte
Epics zu den Verbesserungen der Paseo-Analyse beauftragt. Das erlaubt diese
Planung vor grünen Vorgängern, aber keinen Implementierungsstart. Vor T*.1
Vorgänger-AC mit aktueller Code-/Test-Evidenz prüfen; historische Statuszeilen
reichen nicht. Keine neue Ausnahme von AGENTS.md durch diesen Entwurf.

**Nutzerpräferenz 08.11.2026:** PWA bleibt. Dieser Evaluationsentwurf ist kein
Auftrag für einen nativen Client; dessen optionale Umsetzung bleibt bis zu
späterem konkretem Bedarf und ausdrücklichem Go gesperrt. Die Präferenz allein
hakt T32.1/T32.2 und offene Geräteabnahmen nicht ab. Zugang ohne Tailscale ist
unabhängig vom Clienttyp und wird nur in [P45](EPIC-P45-zugang-ohne-tailnet-evaluation.md)
bewertet. Voidwarden bleibt separater Companion einschließlich Sprachausgabe.

## 1. Ziel

Am tatsächlichen Mobilbedarf entscheiden, ob eine native Shell die PWA sinnvoll
ergänzt. Nur bei nachgewiesenem Mehrwert einen schlanken Android-Client liefern;
PWA und bestehende Hub-API bleiben gemeinsame Funktionsbasis. K1/K6/K10 sind
Vergleichsmaßstab, keine aus Expo automatisch folgenden Versprechen.

## 2. Scope (In / Out)

**In:** Gerätemessung und dokumentierter Go/No-go, optional Android-Shell mit
bestehender PWA und höchstens Push, Share und Aufnahme-/STT-Brücke.

**Out:** Preact→React-Native-Neuschreibung, iOS/App-Store-Veröffentlichung,
Relay/Cloud-Pflicht, neue Auth, alle nativen Features von Paseo nachbauen.
Expo/WebView ist eine zu prüfende Option, noch keine Architekturentscheidung.

## 3. Design-Details

### 3.1 Bedarf vor zusätzlichem Client

Auf Pixel 9 Pro XL/Tablet vorhandene PWA gegen App-Option prüfen: Approval
bei gesperrtem Gerät, Push nach Prozessende, Audio/Berechtigung, Share, Offline,
Tailscale-Reconnect. Offene P12/P16-Befunde behalten ihre IDs. T32.1 benennt
mindestens eine konkret benötigte, reproduzierbar mit vertretbarem PWA-Aufwand
nicht gelöste Funktion. Ohne solchen Befund: No-go/vertagt, nur Evaluation
abgeschlossen. Kein nativer Implementierungsauftrag aus diesem Planungsentwurf.

### 3.2 Optionaler Client

Nach dokumentiertem Go durch Nutzer: ADR zu Expo-Shell vs. Android WebView und
Wartungs-/Distributionskosten. Native Hülle separat unter apps/mobile; Domain-
State verbleibt Hub-JSONL+Snapshot, keine zweite Session-Datenbank. API-
Änderungen contracts-first, neues Client-Handshake nur bei tatsächlichem Bedarf.
Client-Version/Hub-Kompatibilität sichtbar behandeln, PWA-Build unabhängig.

Pairing/Tokens nutzen bestehenden Pfad; Tokens in OS-Keystore, niemals in URL
oder WebView-Bridge-Logs. Navigation auf explizit gepairte Tailscale-Origins
begrenzen; native Bridge nur dort, kleine schema-validierte Nachrichten,
keine eval-/Shell-Schnittstelle. Externe Links im Systembrowser. Share-/Audio-
Inhalte bleiben Daten, Nutzer bestätigt Senden. Widerruf wirkt auf die Shell.

Web-Push vs. OS-Push anhand Gerätebeleg entscheiden; Android-Push darf nicht
heimlich externen Dienst einführen. Ohne akzeptierten Zustellpfad kein Claim
„zuverlässig bei geschlossener App“. STT nutzt vorhandenen lokalen Pfad und
misst Ende Sprache → sichtbares Transkript, einschließlich Bridge. Letzte
Projektion mit Zeitstempel offline, keine Approvals im Offline-Modus vortäuschen.

### 3.3 Zwei getrennte Abschlüsse

**Evaluation:** Befundmatrix und Nutzerentscheid Go/No-go/vertagt. No-go ist
kein fertig gebauter Client; optionale Aufgaben bleiben sichtbar entfällt/gesperrt.
**Umsetzung:** erst nach Go und unverändert grünen Vorgängern T32.3–T32.6.
Bei Vertagung blockiert eine nicht bestellte App nicht dauerhaft P33: Vor dessen
Start explizit Evaluation als gültigen P32-Exit dokumentieren.

## 4. Aufgaben (Checkliste T32.m)

- [x] **T32.1** P12/P16-Abgleich und PWA-Messprotokoll (Gerät/OS/Browser,
  Netz-/Lockzustand, Fehlversuche, K1/K6/K10) erstellen. **K1/K6/K10**.
  — *Erledigt 08.11.2026:* Abgleich, Befundmatrix und Messprotokoll-Gerüst im
  [Entscheidungsdokument](../docs/2026-11-08_p32-evaluations-exit.md) §2/§3;
  gerätegebundene Ausführung (M1–M6) bleibt unter T35.10/T35.11 offen und
  geht in deren Abnahme ein.
- [x] **T32.2** Entscheidungsdokument mit Bedarf, Alternativen, Kosten,
  Push-/Datenschutzpfad und Nutzerentscheid; bei No-go/vertagt begründeten
  Evaluations-Exit festhalten. **K1/K6/K10**.
  — *Erledigt 08.11.2026:* Nutzerentscheid „vertagt";
  [Entscheidungsdokument](../docs/2026-11-08_p32-evaluations-exit.md).
- [ ] **T32.3 (nur Go)** ADR + minimales App-Gerüst, Pairing/Keystore,
  Origin-/Bridge-Grenzen und Versionsfehler prüfen. **K5/K7/K10**.
- [ ] **T32.4 (nur Go)** Nur beschlossene native Brücken bauen; Push-
  Duplikate, Berechtigungsverweigerung, Token-Widerruf, fremde Origin und
  manipulierte Bridge-Nachrichten testen. **K1/K5/K6**.
- [ ] **T32.5 (nur Go)** API-/Web-Regression in
  `e2e/specs/mobile-shell.spec.ts`, ergänzende native Instrumentation für
  Keystore/Bridge/Lockscreen; Playwright allein ist keine native Abnahme.
  Offline/Restart/Reconnect prüfen. **K7/K10**.
- [ ] **T32.6 (nur Go)** Signiertes internes Android-Artefakt mit expliziter
  Installationsanleitung und realem Gerätemesslauf liefern; keine Store-
  Publikation. PWA-Vergleich und Wartungsverantwortung dokumentieren. **K1/K6/K10**.

## 5. Acceptance Criteria (AC-P32-k)

- **AC-P32-1 (Evaluation):** Vollständige Befundmatrix und ausdrücklicher
  Nutzerentscheid; ohne Antwort bleibt Go ausstehend. No-go/Vertagung ist
  mit Begründung und optionalen gesperrten Tasks als solcher im Index sichtbar.
- **AC-P32-2 (nur Go):** Gepaarter Android-Client zeigt dieselbe Session wie
  PWA; Widerruf sperrt Zugriff, fremde Origins erhalten keine native Bridge.
- **AC-P32-3 (nur Go):** Beschlossene native Mehrwerte sind auf echtem Gerät
  belegt; K1 <5 s p95, K6 ≤1,5 s soweit STT enthalten, K10 Offline-Projektion
  mit Zeitstempel. Push-Zustellgrenzen bei geschlossener App dokumentiert.
- **AC-P32-4 (nur Go):** Native Negativtests plus Hub-E2E grün;
  PWA-Pairing/Approvals/Voice funktionieren unabhängig vom nativen Paket.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Zweite UI driftet:** vorhandene PWA laden, Domain-Logik nicht kopieren;
   App-Mehrwert vor Go benennen.
2. **Android beendet Hintergrundverbindung:** echte Lock-/Prozessende-Tests,
   Zustellgarantien nur nach Messung.
3. **WebView öffnet fremde Seite mit Token/Bridge:** Origin-Allowlist,
   Keystore und automatisierte Navigations-Negativtests.
4. **Store-/Signierbetrieb frisst Solo-Kapazität:** zunächst interne Android-
   Verteilung, Verantwortung und Aufwand im Go-Entscheid.

## 7. Definition of Done

Evaluations-Exit und optionaler Implementierungs-Exit getrennt im Index.
Für Implementierung: alle Go-AC belegt, `npm run gate` und PWA-Build grün,
Pipeline-Job `e2e` grün bzw. Infrastrukturfehler nach AGENTS.md separat belegt;
jede neue UI-Funktion/jeder Ablauf mit Spec in `e2e/specs/`, native Grenzen
zusätzlich instrumentiert und auf Gerät geprüft. Client/Installationshilfe
auffindbar. Evaluation allein darf nie als ausgelieferte App bezeichnet werden.

## 8. Evaluations-Exit (2026-11-08)

Nutzerentscheid (Jan, 08.11.2026): **vertagt** — kein Go für einen nativen
Client. Bedarfsbefund, P12/P16-Abgleich, Messprotokoll-Gerüst (M1–M6 für die
Endabnahmesession T35.10/T35.11), Alternativen/Kosten und Push-/Datenschutzpfad:
[Entscheidungsdokument](../docs/2026-11-08_p32-evaluations-exit.md). T32.3–T32.6
bleiben gesperrt; ein späteres Go braucht einen neuen ausdrücklichen Auftrag
(Re-Evaluation-Trigger: M1–M6-Befund). AC-P32-1 ist damit erfüllt (Evaluations-
Teil); AC-P32-2–4 sind Go-vorbehalten und entfallen. P33 startet auf diesem
Exit (§3.3); P30/P31 wurden per Nutzentscheid vom 08.11.2026 nach P36
verschoben ([Epic-Index](README.md)).
