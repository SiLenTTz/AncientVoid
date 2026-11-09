# EPIC-P47 — Übersicht: Sessions/Projekte/Hosts statt Host-Chips, Zahnrad weg

**Status:** offen · **Phase:** P47 · **Dauer:** ~0,5 Agenten-Wochen (grobe Schätzung)
**Abhängigkeit:** keine fachliche offene — baut auf P6-Fleet-Übersicht, P34/P35-Arbeitsfläche und P46-Projekterkennung auf. Auftrag 2026-11-10 erlaubt Umsetzung vor den offenen Live-Abnahmen (AC-P34-13/AC-P35-7 im Endabnahme-Block T35.16 bleiben unberührt; Präzedenz P36).

Quelle: Nutzerauftrag vom 10.11.2026 (Übersicht zwischen Sessions, Projekten und Hosts wechseln; Host-Buttons entfernen; doppelte Einstellungen-Schaltfläche aus dem Header entfernen).

## 1. Ziel

Die Übersicht bekommt einen dreistufigen Ansichtsumschalter (Sessions / Projekte / Hosts). Die bisherigen rein informativen Fleet-Host-Chips verschwinden zugunsten echter Ansichten. Die Einstellungen-Schaltfläche im Benachrichtigungskopf (Duplikat zum Dock-Eintrag) wird entfernt. Messlatten K1 (Erreichbarkeit bleibt), K2 (kein Frame-Lag beim Umschalten), K10 (Offline-Zustände ehrlich).

## 2. Scope (In / Out)

**In:** Ansichtsumschalter in der Übersicht mit drei Zuständen (persistiert, gerätelokal); Projekt-Ansicht aus `GET /api/projects` mit laufenden Sessions je Projekt; Host-Ansicht aus `GET /api/fleet` (`FleetOverview.hosts`) mit Zustand, Detail, letzter Synchronisation und Session-Zahl; Klick auf Host filtert die Session-Ansicht; Entfernen des `notif-gear` inkl. CSS-Aufräumen; E2E-Spezifikationen.

**Out:** Remote-Verwaltung von Hosts (Einladen/Pairen bleibt in den Einstellungen), Anlegen/Umbenennen von Projekten aus der Übersicht (bleibt `POST /api/projects`/Neu-Session-Flow), neue Suche/Sortierung, Änderungen an Dock-Struktur außer dem, was für P49 nötig ist.

## 3. Design-Details

### 3.1 Bestand und Einbauorte

- `apps/pwa/src/features/overview/Dashboard.tsx` rendert `SessionRow`-Karten; Filter lebt in lokalem State mit `sessionStorage "ancientvoid.overviewFilter"` und Event `ancientvoid:overview-filter` (`Dashboard.tsx:121`, gesetzt von `CommandBar.tsx:18-19`). Der Umschalter nutzt dasselbe Muster (eigener sessionStorage-Key + Event), kein zweiter State-Mechanismus.
- Host-Chips heute: `Dashboard.tsx:220-229` (`fleet-hosts`, nur wenn `hosts.length > 1`, Anzeige ohne Filterfunktion) — werden entfernt.
- Datenquellen im Client vorhanden: `hubApi.fleet()` → `FleetOverview.sessions/hosts` (`shared/api.ts:881`, Typen `api.ts:337-353`), `hubApi.projects()` → `ProjectDiscoveryResult` (`api.ts:851`, Typen `api.ts:487-497`, wird heute nur von `FilesLayer.tsx:36` und `CreateSession.tsx:101-116` genutzt).
- Zahnrad: `apps/pwa/src/features/notifications/Notifications.tsx:175-177` (`notif-gear`, springt auf `pageHash("settings")`); CSS `apps/pwa/src/app/styles/14-notifications.css:33-46` inkl. `corner`-Block `:204-216` und Topbar-`padding-right`-Kommentar `:2-4`. Der Dock-Einstellungen-Button (`app/Dock.tsx:39-41`) bleibt der einzige Einstieg.
- Poll: `App.tsx:69-79` holt alle 3 s `hubApi.fleet()`; die Projektliste wird beim Wechsel auf die Projekt-Ansicht (und danach im selben Takt) geladen — kein neues Dauerpolling für Projekte, Fail-loud der `warnings` aus `ProjectDiscoveryResult`.

### 3.2 Ansichten

- **Sessions:** unveränderte heutige Kartei (Sektionen, Suche, Statusfilter bleiben erhalten).
- **Projekte:** eine Karte je `DiscoveredProject` (Name, Pfad-Andeutung, Branch wenn lesbar) plus Anzahl offener Sessions aus der bereits geladenen Fleet-Liste (Gruppierung über `session.project`, `projectName()` `Dashboard.tsx:64`). Klick öffnet die Datei-Seitenleiste mit diesem Projekt als gepinntem Root (bestehender `FilesLayer`-Root-Mechanismus, `files-model.ts:3-7`). Discovery-Warnings werden als Karte/Chip sichtbar (Fail loud), nicht still.
- **Hosts:** eine Karte je `FleetHost` (`hostId`, `label?`, `state`, `detail?`, `lastSyncAt`) plus Anzahl laufender Sessions auf dem Host (Gruppierung über `session.hostId`). Klick wechselt auf Session-Ansicht mit gesetztem Host-Filter (neues Filterfeld neben Statusfilter, gleiches Persistenz-Muster). Kein Host-Chip-Restbestand.
- Umschalten darf K1-Wege nicht verdecken: Benachrichtigungen, Gefunden-Chip und Suche bleiben in allen drei Ansichten erreichbar; K2: Umschalten ist reines Client-Re-render, kein neuer Netzlauf außer Projektnachladung.

### 3.3 Header-Aufräumen

`notif-gear` entfernen, `14-notifications.css` um die Regelblöcke und das Topbar-`padding-right` kürzen, `corner`-Position der Glocke prüfen. Einstellungen bleiben über Dock (`Dock.tsx:39-41`) und Hash-Route erreichbar. Alle Specs, die den Zahnrad-Button antippen, werden auf den Dock-Weg umgestellt (nie löschen ohne Ersatz-Pfad).

## 4. Aufgaben (Checkliste T47.m)

- [ ] **T47.1** Ansichtsumschalter (Sessions/Projekte/Hosts) in der Übersicht, Host-Chips entfernen, Persistenz + Event, mobile und Desktop. **K1/K2/K10**.
- [ ] **T47.2** Projekt-Ansicht mit `/api/projects`, Session-Zählung, Klick → Datei-Seitenleiste mit Projektn-Root; Discovery-Warnings sichtbar. **K1/K10**.
- [ ] **T47.3** Host-Ansicht aus `FleetOverview.hosts` mit Zustand/Detail/Sync + Session-Zahl; Klick → Session-Ansicht mit Host-Filter. **K1**.
- [ ] **T47.4** `notif-gear` und CSS-Restbestand entfernen; betroffene E2E-Specs (`settings-layout`, `oberflaeche`, `overview-shell`, `navigation*`) umstellen; `npm run gate` + PWA-Build. **K1/K2**.

## 5. Acceptance Criteria (AC-P47-k)

- **AC-P47-1:** Drei Ansichten sind umschaltbar, Wahl überlebt Reload gerätelokal; Host-Chips existieren nicht mehr; Suche/Statusfilter/Gefunden bleiben nutzbar.
- **AC-P47-2:** Jedes Projekt aus `/api/projects` erscheint mit Session-Zahl; leere Projektliste und Discovery-Warnings sind sichtbar erklärt, nicht leer versprochen.
- **AC-P47-3:** Jeder Fleet-Host erscheint mit Zustand und Session-Zahl; Klick filtert die Session-Ansicht auf den Host.
- **AC-P47-4:** Kein Einstellungen-Zahnrad mehr im Benachrichtigungskopf; Einstellungen über Dock erreichbar; keine Layout-Lücke in der Topbar; Specs grün.

## 6. Premortem (Failure-Modi + Mitigation)

1. Projekt-Ansicht verspricht mehr, als der Hub weiß (keine Metadaten jenseits Pfad/Branch) → Karte zeigt nur belegte Felder, keine erfundene Projekt-Statistik.
2. Host-Ansicht verdeckt Offline-Realität → `state/detail/lastSyncAt` direkt aus `FleetHost`, Peer-Down sichtbar, keine „verfügbar"-Behauptung.
3. Zahnrad-Entfernung bricht bestehende Specs still → vor Merge Spec-Lauf, Umstellung auf Dock-Pfad, kein Specverlust.
4. Dritter Filterzustand kollidiert mit `overviewFilter`-Event-Muster → getrennter Key, dokumentierte Reihenfolge (Ansicht wechselt, Statusfilter bleibt).

## 7. Definition of Done

Alle T47.* und AC-P47-* mit Evidenz. `npm run gate` grün, PWA-Build grün; jede neue UI-Funktion/jeder Ablauf mit Spec in `e2e/specs/` (Erweiterung `overview-shell.spec.ts`, betroffene Specs umgestellt). Neue Karten sind registriert/erreichbar und dokumentiert (README/CHANGELINE falls gefordert). Pipeline-Job `e2e` grün bzw. nach `docs/ci-runbook.md` nachgezogen, nie als Pass gezählt. Kein TODO ohne Epic-Bezug.
