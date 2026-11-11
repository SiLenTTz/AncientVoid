# ADR-0068 — Herauslösen überall: Ansichten als Fenster, Platzhalter, Zurückholen

**Status:** akzeptiert · **Schreibt fort:** [ADR-0053](0053-eigene-fenster-protokoll.md) · **Betrifft:** `apps/pwa/src/features/windows/`
(`protocol.ts`, `windows.ts`, `PopoutShell.tsx`, `DetachButton.tsx`), `features/session/SessionTail.tsx`, `features/shell/StatusBar.tsx`, EPIC-P43 T43.7 (Design §3.8, AC-P43-7)

## Kontext
ADR-0053 löst ganze Sessions, Werkzeugseiten, Graph, Datei, Notizen, Browser und Geräte in eigene Fenster. Am PC sollen nun auch die
Ansichten einer Session (Änderungen, Dateien, Bericht, GitLab, Suche, Umgebung), die Warteschlange des Starts, die Runs und das Nyx-Blatt
(T43.8) einzeln herauslösbar sein — mit einer einheitlichen Taste, einem Platzhalter an der alten Stelle und einem Zählwerk in der Statuszeile.

## Entscheidung
1. **Zielarten.** `WindowTarget` erhält `changes`, `files`, `report`, `forge`, `search`, `environment` (je `{ kind, sessionId, hostId? }`),
   `queue` und `nyx` (ohne Session). „Runs“ ist schon herauslösbar: es bleibt das Ziel `{ kind: "tool", page: "orchestrierung" }`, damit
   es nie zwei Runs-Fenster gibt. `targetKey` bleibt eindeutig je Ziel (ein Fenster je Ziel, ADR-0053 Punkt 3).
2. **URL.** Die Hash-Route bleibt die der Session bzw. `#/`; die Ansicht steht im Query: `/?window=1&view=<kind>#/sessions/<id>`
   (`#/hosts/<host>/sessions/<id>` für entfernte Hosts), `/?window=1&view=queue#/`, `/?window=1&view=nyx#/`. `parseAppHash` ändert sich nicht.
   Das Token steht weiter nie in der URL.
3. **Ansichtsfenster.** Ein Fenster einer Session-Ansicht zeigt genau diese Ansicht (`SessionTail` mit `tile.only`): keine Reiter, kein
   Antwortfeld, kein Session-Menü. Antworten bleibt der Session (Kachel oder Session-Fenster) vorbehalten — es entsteht kein zweiter Composer.
4. **Platzhalter.** Läuft eine Ansicht in einem eigenen Fenster (Register, nicht gespeicherter Zustand), zeigt ihr Reiter an der alten Stelle
   „<Ansicht> läuft in einem eigenen Fenster.“ mit „Fenster zeigen“ (`focus`) und „Zurückholen“. Ansichtsfenster werden **nicht** in
   `Workspace.detached` gemerkt: ein Fenster ohne Lebenszeichen ist nach 10 s weg, die Ansicht steht dann wieder in der Kachel.
5. **Zurückholen.** Neue Nachricht `recall{id}` vom Hauptfenster an ein Fenster. Das Fenster antwortet mit `return{id,target}` und schließt sich
   (`window.close()` ist für skriptgeöffnete Fenster erlaubt, auch mit `noopener`). `recall` wird wie jede Nachricht strikt geprüft; ein
   Fenster reagiert nur auf seine eigene ID.
6. **Taste.** `DetachButton` ist die eine Taste fürs Herauslösen: immer die letzte im Kopf, 30 px, Symbol `⧉` mit `aria-label` und `title`,
   das Wort „Herauslösen“ erscheint beim Überfahren und bei Fokus. Sie steht nur, wo Fenster möglich sind (PC-Breite, nicht im Fenster selbst).
   Der Kachel-Griff (ADR-0053 Punkt 8) und die Schnellsuche bleiben weitere Wege.
7. **Zählwerk.** Die Statuszeile zeigt „⧉ n Fenster“, solange das Register Fenster kennt.
8. **Hauptfenster geschlossen.** Unverändert: Fenster laufen allein weiter, verbinden sich selbst neu und zeigen offline den letzten Stand;
   ein neues Hauptfenster sendet `ping`, die Fenster melden sich mit `hello`, Platzhalter und Zählwerk stehen wieder.
9. **Verborgene Ströme.** Browser- und Geräte-Bilder laufen nur bei offener Ebene und sichtbarem Dokument
   (`document.visibilityState`); die Ebenen werden beim Schließen ausgehängt. Ein herausgelöstes Fenster ersetzt die Ebene, es läuft nicht doppelt.

## Folgen und Grenzen
- Zwei Fenster derselben Ansicht verhindert das Register wie in ADR-0053, nicht eine Sperre.
- Ein Fenster einer älteren App-Version kennt `recall` nicht; „Zurückholen“ ändert dann nichts, „Fenster zeigen“ und Schließen von Hand bleiben.
- Bildschirmwahl und Fensterplatz bestimmt weiter der Compositor (ADR-0053, Spike).
