# Recherche 2026-11-14 — UI-Feinschliff, Discovery-Integration, Typewriter, KI-Server-Metriken

**Art:** Erklaerung

Planungsrecherche zu den vier Nutzerpunkten vom 14.11.2026. Für jeden Punkt:
Ist-Bestand mit Code-Evidenz, Zuordnung (existiert / offenes Epic / neu
angelegt) und die Epic-Aufgabe mit AC. Umsetzung geschieht in den
zugewiesenen Epics; dieses Dokument ist die epistemische Landkarte dazu.

## 1. Expand-Button verkleinern (nur Icon-Button)

**Status:** Button existiert bereits und funktioniert; die *Größe* ist der
Punkt. Der Maximieren-Button im Composer (`Composer.tsx`, aria-label
„Eingabe maximieren/verkleinern", Glyphen ⤢/⤡) ist der einzige volle
`.btn` in der Actions-Zeile und wird über `.composer-actions .btn
{ flex: 1 1 0 }` (`05-composer.css`) auf die volle Restbreite gezogen —
das ist die „Fullscreen-Fläche". Die Geschwister (Verbessern, Voice) nutzen
längst das kompakte `icon-btn`-Muster (Zeile 5 ff. derselben Datei).
Änderung = Klasse anpassen, Verhalten unverändert; `resize.spec.ts` prüft
die Funktion und bleibt grün.
**Zuordnung:** Anpassung im offenen Epic
[EPIC-P43.5](../epics/EPIC-P43.5-darstellungs-presets-quellenchips.md)
(Darstellung/Composer-Optik gehört dorthin), Aufgabe **T43.5-6**,
**AC-P43.5-6**.

## 2. „Session entdecken" in die Übersicht integrieren, Menüpunkt entfällt

**Status:** Feature existiert vollständig und soll erhalten bleiben —
nur der Aufbewahrungsort ändert sich. Derzeit eigener Menüpunkt
(`app/Dock.tsx` Entry „Entdeckt", `app/route.ts` `TOOL_PAGE_IDS`/
PAGE_SLUG `gefunden`) mit `features/discovery/Discovery.tsx` (Suche
serverseitig, Projektgruppen, Übernahme/Kopie — P5/P22). Die Übersicht
bekommt den Ansichtsumschalter erst in
[EPIC-P47](../epics/EPIC-P47-uebersicht-sessions-projekte-hosts.md)
(Sessions/Projekte/Hosts, Status offen, noch nicht begonnen). Die
Design-Entscheidung (vierter Umschalt-State statt Mischliste; Dock-Eintrag
weg; Chip „Gefunden" und Hash `#/gefunden` bleiben Sprungziele) ist in
EPIC-P47 §3.4 dokumentiert. P22/P5 bleiben unverändert (abgeschlossen,
nur Live-Abnahme offen — keine Regressionen an deren Dateien).
**Zuordnung:** Anpassung im offenen Epic P47: **T47.5/T47.6**,
**AC-P47-5/AC-P47-6**; betroffene Specs (`funktionsinventar` G03/G04,
`discovery.spec.ts`, `dock-visibility`, `deeplink`) werden umgestellt,
nicht gelöscht.

## 3. Typewriter-Effekt für Chat-Output und Thinking/Reasoning

**Status:** neu — im Repo existiert kein Typewriter (null Treffer in
`apps/`, `packages/`, `docs/`, `epics/`). Building blocks: Live-Event-
Darstellung (`ChatTurns.tsx`, `EventRow.tsx` inkl. Thinking-Zeilen),
Bewegungssprache mit zentralem Gate `motionAllowed()` (`shared/motion.ts`,
`data-ctx-motion`, `36-motion.css`, `prefers-reduced-motion`),
Appearance-Settings mit Bewegungs-Schalter. Rein clientseitig → kein
Contract-Wechsel, kein ADR nötig; kein neues Event-Payload (K5 erhalten).
**Zuordnung:** neues Epic
[EPIC-P58-typewriter-effekt](../epics/EPIC-P58-typewriter-effekt.md)
(Quer-Epic, Präzedenz P50–P53; Vorgänger-Phase P57 abgeschlossen).
Settings-Schalter (persistiert, geräte-lokal), History rendert sofort,
nur neuer Live-Zuwachs wird getippt; K2-Messlauf und Spec
`typewriter.spec.ts` in der DoD.

## 4. Metrik-Seite für den lokalen KI-Server (CPU, GPU, Tokens/s, Prefill, Decode)

**Status:** neu als Seite. Bestand: `/api/metrics` (nur Prozesszähler,
ADR-0010), `/api/health` mit Memory-Check; P21 liefert Lauf-Metriken auf
Session-Ebene, P56 plant Session-/Modell-Kennzahlen aus dem EventStore —
beides ist nicht die Server-Auslastung und bleibt unberührt. Datenquellen
sind real vorhanden: der llama.cpp-Server läuft bereits mit `--metrics`
(`docs/local-llm.md`, Instanzen `ancientvoid-llama`/-`vision` auf gpubox;
Prometheus-Endpoint liefert tokens/s, prefill/TTFT, decode, KV-Cache,
Queue). GPU-Auslastung (amdgpu sysfs ohne ROCm-Userland) ist ein Spike.
Fleet-Peers melden bisher nur Zustand/Detail/lastSync — eine
Contract-Erweiterung braucht ein ADR (Regel 1), deshalb ADR-Aufgabe vor
Implementierung.
**Zuordnung:** neues Epic
[EPIC-P59-ki-server-metriken](../epics/EPIC-P59-ki-server-metriken.md)
(Quer-Epic; Vorgänger-Phase P57 abgeschlossen; Abgrenzung zu P56: P59 zeigt
nur direkte Proben, Aggregation bleibt bei P56). Ehrliche Quellen gemäss
ADR-0023: „nicht gemeldet" statt erfundener Null.

## Zuordnung auf einen Blick

| Punkt | Status | Epic | Aufgabe / AC |
|---|---|---|---|
| Expand-Button → Icon | existiert, Optik-Änderung | P43.5 (offen) | T43.5-6 / AC-P43.5-6 |
| Discovery → Übersicht | existiert, Umzug | P47 (offen) | T47.5–T47.6 / AC-P47-5–6 |
| Typewriter | neu | P58 (neu angelegt) | T58.1–T58.6 / AC-P58-1–5 |
| KI-Server-Metriken | neu | P59 (neu angelegt) | T59.1–T59.6 / AC-P59-1–5 |

In Arbeit befindliche Epics (P37, P38, P42, P46, P51 teils) wurden nicht
angefasst.
