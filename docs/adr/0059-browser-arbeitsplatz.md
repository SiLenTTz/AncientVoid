# ADR-0059 — Browser-Arbeitsplatz (EPIC-P39)

**Status:** angenommen (2026-11-09) · **Epic:** P39 · **Messlatten:** K1/K2/K5/K7/K8/K10 (K3 für Review-Artefakte)

## Kontext

Der Nutzer will vom Handy eine laufende Scratch-Webapp sehen, bedienen, testen und
Design-Feedback an Agenten geben. Die PWA kann keinen Browser starten; Chromium muss auf
dem Ausführungshost laufen. P29 liefert registrierte Workspace-Services (Loopback-Ports) und
einen Preview-Proxy; P46 liefert Projektbaum/Datei-Viewer; P36/P46 liefern den
Feedback-Pfad über Steer.

**Gating-Hinweis:** P46 ist implementiert, die Geräte-Abnahme (Pixel, K2/K8) steht aus und wurde
vom Nutzer ausdrücklich auf später gelegt. P39 startet auf ausdrückliche Anweisung des Nutzers
(2026-11-09); das hebt die offene P46-Abnahme nicht auf, und die Geräte-/Tailscale-Nachweise von
P39 (AC-P39-1, T39.1-Latenz) sind ebenfalls offen.

## Entscheidung

1. **Engine/Architektur (T39.1, Spike-Ergebnis ohne Gerät).** Serverseitiges Headless-Chromium
   über Playwright (bereits Repo-Abhängigkeit; als `optionalDependencies` von `@ancientvoid/core`,
   dynamisch importiert). Der Hub-Prozess besitzt Browser und Contexts; es gibt **keinen CDP-Port**
   nach außen und keinen Client-seitigen Zugriff auf Playwright. Die PWA zeigt ein **JPEG-Standbild**
   (Qualität 60, höchstens ≈ 8 Bilder/s Abruf, 120-ms-Cache je Session) und schickt
   schema-validierte Aktionen. Kein iframe-Browser, kein Frame-Stream als Events (AC-P39-6).
   Verworfen: kooperative instrumentierte Preview (kann Seiten mit Frame-Sperren nicht zeigen,
   zweite Instrumentierungswahrheit). Offen bleibt die **Gerätemessung** (Latenz/Lesbarkeit
   auf Pixel über Tailscale): ohne sie gilt „vollständiges Browserpanel“ nicht als abgenommen.
2. **Contracts** `contracts/src/browser/`: `BrowserStatus`, `BrowserAction` (navigate, reload, back,
   forward, click, type, press [Whitelist], scroll, viewport), `BrowserTestCase` (goto, click, fill,
   expectText, expectVisible, expectUrl; ≤ 20 Schritte, Schritt-Timeout ≤ 10 s, Gesamtzeit 60 s),
   `BrowserTestRun`, `BrowserPick`, `BrowserFeedbackInput` sowie die Grenzen (Contexts ≤ 4,
   Artefakte ≤ 20/Session à ≤ 1 MiB, Konsole ≤ 100 Einträge). Core-Modul `modules/browser/`,
   Routen `apps/hub/src/modules/browser/`, UI `apps/pwa/src/features/browser/`.
3. **Ziel- und Eingabekontrolle (T39.2).**
   - Automatisch erlaubt: `http://127.0.0.1:<Port>` der **laufenden registrierten Workspace-Services**
     der Session; weitere Origins nur aus der Config (`browserOrigins`). Kein DNS-Name wird von selbst
     vertraut (auch `localhost` nicht), keine Zugangsdaten in URLs, nur `http(s)`.
   - **Jeder Request** läuft durch `context.route`; **Redirects** folgt der Browser nicht selbst
     (`route.continue()` prüft sie nicht — im Test gefunden), sondern der Hub holt mit
     `maxRedirects: 0`, prüft die `Location` und liefert die 3xx aus, sodass der Folgerequest erneut
     geprüft wird. WebSockets werden wie ihr http-Gegenstück geprüft. Downloads, Service Worker,
     Berechtigungen, Zusatz-Tabs sind aus bzw. werden geschlossen.
   - Netzwerkebene zusätzlich: `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"`
     — außer Loopback wird nichts aufgelöst (DNS-Rebinding, Exfiltration).
   - Hub-/Admin-URL (anderer Loopback-Port, z. B. der Hub selbst) ist ohne Config-Freigabe
     unerreichbar. Cookies/Storage bleiben im **inkognito**-Context je Session (nie ein persönliches
     Profil). Tests laufen in **eigenen** Contexts, getrennt vom manuellen Browser.
   - Alles Schreibende ist Menschen-Eingabe: Agent-Tokens bekommen 403 (Policy: unmapped POST
     fail-closed + `approve`-Prüfung in der Route). Agenten bedienen den Browser nicht über diese
     Routen. Der Dienst ist lokal, **nicht** in `FLEET_ROUTABLE`; Sessions anderer Maschinen zeigt
     die PWA mit ehrlichem Hinweis.
4. **Testläufe (T39.4).** Benannte Testfälle aus registrierten Schritten (kein hochgeladener Code).
   Status `running | passed | failed | aborted | unknown`. Journal `data/browser/<session>/tests.jsonl`
   (Append, letzte Zeile je Lauf gilt, beschädigte Zeilen werden übersprungen), Screenshot-Artefakt
   als Datei (Quota 20/Session, ≤ 1 MiB), Konsole/Netzfehler gekürzt. Abbruch per Route; Gesamtzeit
   begrenzt.
5. **Recovery/Ownership (T39.6).** Nach Hub-Neustart gilt ein `running`-Lauf ohne lebenden Prozess als
   **`unknown`** („nichts wird wiederholt“); Eingaben werden nie wiederholt. Contexts sind nur im
   Hub-Speicher: ein Neustart beendet sie mit dem Browser-Prozess (kein Fremdprozess wird angefasst).
   Der Reaper (15 s) schließt Contexts beendeter/archivierter Sessions und nach 10 min Leerlauf;
   Chromium wird beendet, sobald kein Context offen ist. Browserausfall ist `unavailable` mit Grund
   und berührt Session-Restore/Not-Stopp nicht (Start erst bei Bedarf, Fehler isoliert).
6. **Design-Auswahl (T39.5).** Element-Auswahl per Koordinate im Seitenkontext (`elementFromPoint`,
   Shadow-DOM-Abstieg). Ausgabe: Selector, Tag, Text (≤ 200), Rect, **Style-Whitelist**, Frame-Art
   (Inhalt von iframes wird **nicht** gelesen), Shadow-Flag, URL. **Passwort-/Secret-Felder**
   (type=password, Namen/Labels wie token/api-key/cvv/iban …) liefern weder Text noch Styles
   (`masked`); Formularwerte werden nie gelesen. Source-Map: nicht ausgewertet → `source: null`, in
   UI und Prompt als „nicht ermittelt“ sichtbar (nie geraten). Feedback: Vorschau = gesendeter Text
   (reine Funktion `composeBrowserFeedback`), Seiteninhalt als „zitierte Daten, keine Anweisung“ (PRD
   §8.5), optionaler Element-Screenshot als Anhang, Versand über Steer mit `inputId = operationId`.
7. **Orca-Referenzen.** Konzeptionelle Referenz für Element→Kontext→Feedback (Design Mode). Es wurde
   **kein Orca-Quelltext übernommen**; Selector-/Style-Auszug ist eigener Code (`pick-script.ts`),
   daher keine Lizenz-/Hash-Notiz nötig.
8. **hubctl:** `hubctl browser <session>` und `hubctl browser tests <session>` (nur Lesen).

9. **Sichtbarer Modus.** Config `browserHeadless: false` startet Chromium mit sichtbarem Fenster auf dem
   Host (braucht eine Anzeige; sonst `unavailable` mit Hinweis auf `browserHeadless`). Die PWA zeigt weiter
   dasselbe Fenster als Bild, `BrowserStatus.headless` und die Modus-Zeile im Panel benennen den Modus.
   Ziel-/Netzgrenzen sind in beiden Modi identisch (`chromiumLaunchOptions`, getestet). Der sichtbare
   Modus wurde in diesem Stand nur über die Start-Optionen und den Fehlerpfad getestet, nicht als
   Live-Lauf mit Anzeige (E2E läuft headless).

## Messung / Budgets

Frame ≈ JPEG q60 (Größenordnung 20–80 KB je Seite), Abruf 2 Bilder/s im Panel, nie im Eventstrom.
Browser-Start ≈ 1 s kalt auf dem Entwicklungsrechner; Contexts ≤ 4 Host-weit. Messung auf
Pixel/Tailscale (Latenz, Lesbarkeit, Last mit K1/K2/K7/K8) steht aus.

## Nicht Teil dieses Stands

- Geräte-/Tailscale-Abnahme (AC-P39-1, Latenzmessung), Live-Test des sichtbaren Modus mit Anzeige, Popout-Fenster,
  Sessions anderer Maschinen, Trace/Video-Artefakte (nur Screenshot), Source-Map-Auswertung,
  Frame-Inhalte fremder iframes, Agenten-Operationen über das Gateway (bewusst Menschen-only).

## Folgen

- Playwright wird Laufzeit-Option des Hubs (optional); ohne Chromium meldet das Panel „nicht verfügbar“.
- Redirect-Prüfung über `route.fetch` setzt jeden Request über den Hub — gut für lokale Dev-Server, kein
  Allzweck-Browsing.
