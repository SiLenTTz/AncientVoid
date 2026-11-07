# ADR-0053 — Eigene Fenster: URL, Kanal-Protokoll, `noopener`, Wiederanmeldung

**Status:** akzeptiert · **Betrifft:** `apps/pwa/src/features/windows/` (`protocol.ts`, `windows.ts`, `PopoutShell.tsx`), `features/workspace/tiles.ts` (`detached`),
`features/shell/ToolPane.tsx`, `app/main.tsx`, EPIC-P34 T34.10–T34.12

## Kontext
Kacheln und Werkzeuge sollen in eigene Fenster wandern können (mehrere Bildschirme). Die PWA hat keinen Server-Zustand dafür; Hauptfenster und Fenster teilen nur `localStorage`
und den Ursprung. Das Token liegt bereits im gemeinsamen `localStorage`.

## Entscheidung
1. **URL:** `/?window=1#/sessions/<id>`, `#/hosts/<host>/sessions/<id>` oder `#/status` (jede Werkzeugseite). Die vorhandene Hash-Route wird wiederverwendet. **Das Token steht nie in der URL.**
2. **Hülle:** `PopoutShell` (Einstieg in `main.tsx`, wenn `window=1`): Kopfzeile mit „In die App zurück“, darunter `SessionTail` (im Kachel-Modus) oder `ToolPane`. Kein Dock, keine Liste,
   keine Kachel-Tasten. Die Hülle schreibt **nie** `ancientvoid.workspace` und nie den Hash des Hauptfensters (E2E zeichnet jeden `localStorage`-Schreibzugriff des Fensters auf und prüft das;
   eine Mutation, die es doch tut, macht den Test rot). Esc schließt im Fenster nichts.
3. **Kanal:** `BroadcastChannel("ancientvoid.windows")`. Nachrichten: `hello{id,target}`, `heartbeat{id}` (alle 3 s), `bye{id}`, `focus{id}`, `return{id,target}`, `ping`. Eingehendes wird strikt geprüft
   (`parseWindowMessage`) — jede Seite des Ursprungs kann in den Kanal schreiben. Jede Seite führt ein Register der lebenden Fenster; Einträge ohne Lebenszeichen fallen nach 10 s heraus.
   Ein `heartbeat` ohne `hello` ist unbekannt (kein Phantomfenster); ein zweites `hello` für dasselbe Ziel ersetzt das alte (Reload eines Fensters).
4. **`noopener`:** `window.open(url, "_blank", "popup,noopener,noreferrer")`. Ohne Bezug zum Öffner teilt sich das Fenster nicht dessen Haupt-Thread (K2: ein voller Tail bremst sonst beide).
   Folge: `window.open` liefert immer `null`; **ob das Fenster aufging, zeigt allein das `hello` binnen 3 s**. Bleibt es aus, meldet die App „Pop-ups blockiert“, und die Kachel bleibt unverändert.
5. **Zustand:** `Workspace.detached: TileRef[]` (optional, alte Stände gültig). Ablösen leert die Kachel und merkt die Session; `return` öffnet sie wieder in einer Kachel. Die Liste zeigt das Abzeichen
   „⧉ eigenes Fenster“ nach **dem Register** (lebendes Fenster), nicht nach `detached`; ein Klick sendet `focus`, statt die Session ein zweites Mal zu öffnen.
6. **Hauptfenster optional:** Fenster laufen allein weiter. Ein neu gestartetes Hauptfenster sendet `ping`, alle Fenster antworten mit `hello`.
7. **Reihenfolge von `bye`:** `pagehide` sendet `bye`, auch bei einem Neuladen des Fensters; das Hauptfenster entfernt deshalb `detached` nicht auf `bye` (das Wiederherstellen ist T34.12).

## Spike (T34.10) — was gemessen wurde und was nicht
| Frage | Ergebnis |
|---|---|
| Gilt die Nutzeraktion nach einem langen Zug mit gedrückter Taste noch? | **Chromium (Playwright, 2026-11-07), gemessen:** `navigator.userActivation.isActive` war bei gedrückter Taste nach 0, 2, 4,5 und 6 s `true` und direkt nach dem Loslassen `true`; `pointerdown` und `pointerup` melden beide `true`. `window.open` aus dem Loslassen heraus ist damit zulässig, solange die Aktion nicht abgelaufen ist (die Spezifikation lässt sie nach wenigen Sekunden nach dem letzten Eingabeereignis verfallen). |
| Blockiert der Browser das Pop-up wirklich? | **Nicht gemessen:** Playwright schaltet den Pop-up-Blocker ab. Der Pfad „kein `hello` ⇒ blockiert“ ist per E2E mit überschriebenem `window.open` belegt, nicht gegen einen echten Blocker. |
| Hyprland/Wayland: Fensterposition und -platzierung | **Nicht gemessen** (kein Compositor in der Testumgebung). Annahme laut Plan: das Programm darf seine Position nicht setzen, den Ort bestimmt der Compositor (Fensterregel). Das gehört in Jans Live-Abnahme (AC-P34-13). |
| Firefox | **Nicht gemessen** (nicht installiert). |
| Window-Management-API (Bildschirmwahl) | **Nicht gemessen**; nur Chromium mit Berechtigung, optional (T34.11). |

Folge für die Ziehgeste (T34.11): sie wird gebaut, soweit Chromium es belegt, mit sichtbarem Rückfall auf den `⧉`-Knopf. Der Knopf ist die zugesicherte Funktion.

## Folgen und Grenzen
- Ein Fenster ohne Hauptfenster kann `return` senden, ohne dass jemand zuhört; dann schließt es sich nur.
- `BroadcastChannel` fehlt in sehr alten Browsern; dann laufen Fenster, aber ohne Abzeichen und ohne `focus`.
- Zwei Fenster derselben Session sind durch das Register verhindert, nicht durch eine Sperre: zwei Hauptfenster-Tabs können es unterlaufen (das `storage`-Ereignis der Entwurfsablage deckt den Rest, P20).
