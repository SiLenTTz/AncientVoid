# ADR-0089 — Mehrstufige Zwischenablage: die Ablage liegt im Browser, nie am Hub

**Status:** akzeptiert · **Betrifft:** `apps/pwa/src/shared/clipboard-shelf.ts`,
`apps/pwa/src/shared/clipboard-copy.ts`, `apps/pwa/src/features/clipboard/`,
`apps/pwa/src/features/composer/Composer.tsx`, die Kopierstellen in
`features/session/`, `features/stt/paste-target.ts`, `features/discovery/`,
`features/settings/ConnectionsSettings.tsx`.

## Kontext

Kopieren gibt es in der App an sechs Stellen: Diktat-Einfügen, markierte Chat-Stelle
(BUG-0107), einzelner Ereignistext, Befehle (Host-Kommandos), Sitzung-Kennung, Token.
Jede Stelle schrieb einzeln in `navigator.clipboard`. Der Text war beim nächsten Kopieren
weg — wer zweimal kopiert, verliert das Erste kommentarlos. Kai will eine **mehrstufige
Zwischenablage**, die zum Design der App passt statt eines Systemfremden Fensters.

## Entscheidung

1. **Eine Ablage, ein Weg.** `copyIntoShelf(text, origin)` ist der einzige Pfad, der in die
   System-Zwischenablage schreibt; jede bisherige Stelle läuft darüber. Ohne
   Clipboard-API (unsicherer Kontext) bleibt die Stufe trotzdem erhalten — die Zusage
   „Auswahl wird nie still verloren“ (BUG-0107) gilt jetzt stärker als vorher.
2. **Stufen, kein Protokoll.** Neuer Text kommt obenauf. Identischer Text ganz oben zählt
   als Benutzung (`uses`), identischer Text weiter unten **steigt auf** — so arbeitet ein
   Mensch mit einer Ebene. Gespeichert werden 24, sichtbar sind 6 (ADR-typische Grenze,
   damit das Blatt nie Scroll-Krieg mit dem Chat gewinnt).
3. **Gerät lokal, nie am Hub.** Kein Endpoint, kein EventBus, kein Sessions-Teilen:
   `localStorage` unter `ancientvoid.clipboard-shelf.v1`. Der Hinweis im Blatt ist Teil des
   Designs, keine Fußnote.
4. **Geheimes bleibt draußen.** Token (`ConnectionsSettings`) kopieren weiter in die
   Zwischenablage, bekommen aber **keine** Ablage-Stufe (`{ secret: true }`). Ein Token, der
   wochenlang im Browser-Speicher nachlesbar liegt, wäre ein anderes Risiko als eine
   Textstelle aus dem Chat.
5. **Einfügen dorthin, wo das Feld war.** „Einfügen“ nutzt denselben Ziel-Merker wie das
   Diktat (`paste-target.ts`, letztes editierbares Feld) und setzt **keine** neue Stufe —
   sonst wäre jede Einfügung eine neue Ebene. Ohne fokussiertes Feld wird zurück in die
   Zwischenablage geholt und das dem Nutzer gesagt.
6. **Design ohne Sonderweg.** Einstieg: `icon-btn` in der composer-Reihe mit Zähler-Marke.
   Blatt: `shared/ui/Sheet.tsx` (Fokusfalle, Esc), Zeilen mit Stufenzahl, Herkunft
   („Diktat/Markierung/Befehl/Eintrag/Kennung/Text“), Zeit nach `ago()`, Aktionen
   `Button size="sm"`, Leerzustand `EmptyState`. Farben ausschließlich über Tokens
   (`css-tokens`-Ratchet), keine neuen Breachpunkte.
7. **Langtext ehrlich gekürzt.** Ab 20 000 Zeichen wird gespeichert abgeschnitten und die
   Zeile sagt „gekürzt“. Nichts, was hier steht, tut so, als wäre es vollständiger als es ist.

## Konsequenzen

- Unit: `apps/pwa/test/shared/clipboard-shelf.test.ts` (Reihenfolge, Hochstufen, Kappen,
  Geheim-Ausnahme, Kürzung, Bestand über Neuladen).
- E2E: `e2e/specs/clipboard-shelf.spec.ts` (markieren → Stufe da → Blatt offen → Einfügen im
  Composer → Entfernen; Token bleibt draußen).
- Inventar-Eintrag S78; Styles `54-clipboard-shelf.css`.

## Abgrenzung

- Kein Geräte-übergreifendes Sync, keine Hub-Ablage, keine Passworthinterlegung.
- Die System-Zwischenablage selbst ist und bleibt ein einzelner Slot — die Ablage hält die
  Stufen **unter** ihr, sie ersetzt nicht das Mehrstufige des Betriebssystems.
- Wer die Stufen über Browser-Neustart hinweg braucht, bekommt sie (localStorage); wer sie
  löschen will: „alle löschen“ nach zweitem Tipp, oder eine Stufe einzeln entfernen.
