# ADR-0027 — Aufträge in Worten: ein Katalog, Pläne als Daten, Ausführung über die echten Routen

**Status:** akzeptiert · **Betrifft:** EPIC-P9, `packages/contracts/src/commands/`,
`packages/core/src/modules/commands/`, `apps/hub/src/modules/commands/`,
PWA `features/commands/CommandBar.tsx`, `shared/command-context.ts`

## Kontext

Alles im Hub soll sich auch in Worten bedienen lassen: navigieren, starten,
antworten, Felder füllen und Text korrigieren. Das Risiko dabei ist ein
zweiter, schwächer geprüfter Weg an Policy, Freigaben und Idempotenz vorbei.
Genauso gefährlich wäre ein Modell, das Agenten-Ausgaben als Befehl liest.

## Entscheidung

1. **Ein Katalog** (`COMMANDS`) mit 16 Einträgen. Jeder hat eine Risikoklasse,
   einen Ort (App oder Hub) und die Policy-Operation. `USER_ONLY_FLOWS` nennt,
   was bewusst fehlt: Freigaben entscheiden, Passkey, Tokens und Schlüssel,
   Push-Erlaubnis, Kopplung, Dateiauswahl. Das bleibt ein Tippen.
2. **Plan = Daten.** Aus dem Text wird eine Absicht mit *Namen*. Der Resolver
   macht daraus Ziele (Host, Projekt, Session, Harness, Aktion). Bei
   Mehrdeutigkeit oder fehlendem Ziel kommt eine **Rückfrage mit Auswahl**,
   nie eine geratene ID. Der Resolver sieht Namen und Zustände, nie
   Event-Inhalte.
3. **Planer:** zuerst feste Regeln auf Deutsch und Englisch. Sie sind schnell,
   lokal und funktionieren ohne Modell. Was sie nicht kennen, übernimmt das
   lokale Modell (llama.cpp, JSON-Schema-beschränkt). Es sieht nur den Text
   der Person. Es gibt **keinen Cloud-Rückfall**. Fällt das Modell aus,
   kommt eine klare Meldung, und die Knöpfe gehen weiter.
4. **Ausführung über die echten Routen:** Der Hub spielt jeden Schritt per
   `inject` gegen seine eigene Route, mit dem Token des Aufrufers. Damit
   gelten dieselbe Validierung, Policy (ein Agent bekommt „wartet auf
   Freigabe“) und Idempotenz (`inputId = plan-<id>-<schritt>`) wie beim
   Tippen. Eine zweite Engine gibt es nicht. Peers erreicht der Plan über den
   Flotten-Proxy.
5. **Gebunden an den Kontext:** Der Plan merkt sich Seite, Host und Session.
   Hat sich die Ansicht bis zum Ausführen geändert, lehnt der Hub ab (409).
   Eine Antwort trägt die Revision der Session; kam dazwischen eine andere
   Eingabe, lehnt die Steer-Route selbst ab. Ein zweites Ausführen liefert
   das gespeicherte Ergebnis. Ein Plan gilt nur für das Gerät, das ihn
   geplant hat, und höchstens 10 Minuten.
6. **Lesen sofort, Schreiben nach Blick auf das Ziel:** Navigation und Listen
   laufen direkt. Alles andere zeigt Ziel und Risiko und wartet auf
   „Ausführen“.
7. **Felder:** Antwort, Start-Prompt, Titel, Code-Suche und Übersichtsfilter
   melden sich an. „Schreib ‚stopp‘ in die Nachricht“ füllt das Feld und
   stoppt nichts. Korrigieren, Kürzen, Übersetzen und Verbessern laufen über
   das lokale Modell, zeigen Vorher und Nachher und lassen sich übernehmen,
   verwerfen und rückgängig machen.

## Folgen

- Neue Hub-Funktionen brauchen einen Katalogeintrag und einen getesteten
  Satz. Der Coverage-Test in `commands-routes.test.ts` scheitert sonst.
- Die Regeln sind auf dem Entwicklungssatz (115 Sätze) vollständig. Auf einem
  danach geschriebenen Held-out-Satz verstehen sie 66,7 %, mit Modell 96,7 %,
  jeweils mit **null** falschen schreibenden Schritten
  ([Messlauf](../messlauf/2026-09-24-p9-commands.md)).
- Pläne liegen im Speicher. Ein Hub-Neustart verwirft sie (410), sodass kein
  Doppelauftrag entsteht.
