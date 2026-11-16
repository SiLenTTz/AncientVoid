# ADR-0031 — Desktop-Companion: Diktat ins fokussierte Fenster, geprüft vor und während des Tippens

**Status:** akzeptiert · **Betrifft:** EPIC-P11, `packages/contracts/src/desktop/`,
`packages/core/src/modules/desktop/`, `apps/hub/src/modules/desktop/`, `apps/companion/`,
PWA `features/desktop/`

## Kontext

Du willst vom Handy aus Text in Programme am PC bringen, zum Beispiel ins
Terminal, in den Editor oder in ein Browserfeld. Das PRD hatte
Desktop-Steuerung ausgeschlossen. P11 öffnet sie gezielt und eng.

Die Gefahren sind:

- Text im falschen Fenster, etwa im Chat statt im Terminal.
- Tippen in Passwortfelder.
- Wiederholte Eingaben nach Verbindungsabbrüchen.
- Ein Agent, der den PC fernsteuert.

Omarchy läuft unter Hyprland/Wayland. Dort gibt es keine
Accessibility-Schreib-API. Normale Tastatureingaben laufen über das
Virtual-Keyboard-Protokoll (wtype), das immer in das gerade fokussierte
Fenster tippt.

## Entscheidung

1. **Companion statt Fernsteuerung:**
   - Ein kleiner Prozess auf dem PC (`apps/companion`) mit eigenem Token
     `companion:<pc>`.
   - Er erreicht nur `/api/desktop/companion/*` (Auth und Policy
     `desktop.companion`). Alles andere ist ihm verboten, Lesen inklusive.
   - Er holt Aufträge per Long-Poll. Es gibt keinen eingehenden Port auf
     dem PC.
2. **Nur registrierte Aktionen:**
   - `insert` (Text), `replace` (Strg+A, dann Text) und `key`
     (Enter, Tab, Esc, Rückgängig).
   - Keine Maus, keine Tastenkürzel, keine Shell, keine Screenshots.
   - Bis zu 2000 Zeichen. Der Text wird im Hub gelöscht, sobald die Aktion
     endet.
3. **Ziel sehen, Ziel prüfen:**
   - Der Companion meldet das fokussierte Fenster (App, Titel, ID) mit
     einer Revision, die bei jedem Fenster- oder Titelwechsel steigt.
   - Die PWA schickt genau dieses Ziel mit. Der Hub lehnt ab, wenn sich
     Revision oder Fenster geändert haben (409). Der Companion prüft
     unmittelbar vor dem Tippen noch einmal.
4. **Während des Tippens wachen:**
   - Eine wtype-Instanz tippt mit 8 ms pro Taste.
   - Fokus-Ereignisse des Compositors (sway `subscribe window`, Hyprland
     socket2 `activewindowv2`) beenden das Tippen sofort. Eine Abfrage alle
     15 ms ist der Rückfall.
   - Normales Tasten-Tippen bleibt auf den Fokus angewiesen. Beim
     ausdrücklich gewählten Modus „Gezielt einfügen“ adressiert Hyprland den
     Paste-Befehl an die Window-Address aus der Vorschau. Der Text wird als
     sensibles, einmaliges `wl-copy --paste-once`-Angebot bereitgestellt und
     nach dem Einfügeversuch beendet; dieses Angebot verändert kurz die
     Zwischenablage. Der Hub akzeptiert den Modus nur bei einem Hyprland-
     Companion. Enter, Tab, Esc, Rückgängig und Ersetzen-Markierung werden
     ebenfalls an die Vorschau-Window-Address adressiert.
5. **Nie in Geheimnisse tippen:**
   - Fenster von Passwortmanagern und PIN-/polkit-Dialogen (App-ID) und
     Dialoge mit eindeutigem Titel werden abgelehnt.
   - Zusätzlich fragt der Companion über AT-SPI die Rolle des fokussierten
     Felds ab. Findet er kein fokussiertes Feld, genügt ein sichtbares
     Passwortfeld in der App.
   - Optional erlaubt `--allow` nur bestimmte Apps.
6. **Not-Stopp lokal:**
   - `ancientvoid-companion stop` über einen Unix-Socket im Runtime-Verzeichnis,
     als Hyprland-Keybind gedacht.
   - Beendet das Tippen sofort (gemessen p50 28–48 ms, max 89 ms bis zur
     Rückmeldung).
   - Danach läuft nichts mehr bis `resume`. Auch ein gesperrter Bildschirm
     blockiert.
7. **Nichts doppelt:**
   - Jeder Auftrag wird einmal ausgeliefert.
   - Nicht abgeholte Aufträge verfallen nach 10 s.
   - Ausgelieferte Aufträge ohne Rückmeldung werden „ungewiss“, ebenso
     offene nach einem Hub-Neustart. Nichts wird wiederholt.
8. **Nur Menschen:** Die Policy `desktop.act` erlaubt nur Personen. Agenten
   und die Flotte dürfen den PC nicht tippen lassen.

## Alternativen

- **Zwischenablage und Einfügen:** Hyprland kann den Paste-Befehl an
  `address:<fenster>` adressieren. Das ist als ausdrücklicher Modus umgesetzt;
  das einmalige Angebot wird bei Timeout/Abbruch beendet. Clipboard-Manager
  und manche XWayland-Apps können one-shot-Angebote beeinflussen; die
  geräteübergreifende Live-Messung bleibt P12 T12.4.
- **ydotool (uinput):** braucht root oder einen Dienst. Verworfen.
- **Accessibility-Schreiben (AT-SPI `EditableText`):** unter Wayland
  unzuverlässig, viele Apps (Chromium, Terminals) machen nicht mit.
  Verworfen, AT-SPI dient nur zum Lesen der Rolle.

## Folgen

- Im normalen Keystroke-Modus bleibt das Restrisiko: Eine bereits gesendete
  Taste kann bei Fokuswechsel im neuen Fenster landen (gemessen: 1 Zeichen in
  1 von 20). Der gezielte Clipboard-Modus adressiert den Paste-Befehl an das
  Vorschau-Fenster, muss aber noch die P12-Messung T12.12 bestehen.
- GTK3-Felder bekamen im Labor keine Zeichen von wtype. GTK4, foot und
  Chromium funktionierten. Auf echtem Hyprland ist das noch zu prüfen
  (P12 T12.4).
- Getestet wurde nur im isolierten Labor (headless sway). Am echten Desktop
  wurde nichts getippt, bewusst nicht ohne dich.
