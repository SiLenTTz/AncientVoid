# ADR-0035 — Kurze Titel für Sessions (Heuristik und optional KI)

**Status:** akzeptiert · **Betrifft:** EPIC-P15 T15.5, `SessionRecord.titleSource`, SessionManager, Konfiguration `assistant`

## Kontext

Die Übersicht unterscheidet Sessions am Titel. Der Titel war die erste Zeile des Start-Prompts, auf 80 Zeichen
gekürzt. Im Betrieb (33 Sessions) waren 14 ohne Titel, mehrere identisch („Antworte nur mit: …“), andere
nichtssagend („Ziel“) oder begannen mit Höflichkeitsfloskeln („Kannst du mir sagen, ob …“), sodass das
Wesentliche abgeschnitten wurde.

## Entscheidung

1. **Heuristik zuerst (immer an).** `sessionTitle()` entfernt Höflichkeits- und Füllwörter vor der Aufgabe,
   Markdown-Zeichen und Schlusszeichen und setzt den ersten Buchstaben groß. Bleibt nichts übrig („Bitte“), gilt
   der Originaltext.
2. **KI-Titel danach (nur mit konfiguriertem `assistant`-Modell).** Nach der ersten echten Antwort fragt der Hub
   das Modell einmal pro Session nach einem Titel (3–7 Wörter). Das Modell sieht höchstens die ersten 500 Zeichen
   des Auftrags und die ersten 300 Zeichen der Antwort. Scheitert die Anfrage oder ist die Antwort unbrauchbar,
   bleibt der Heuristik-Titel; es gibt keinen Wiederholungsversuch und keinen Fehler in der Oberfläche.
3. **Herkunft statt Raten.** `sessions.title_source` ist `auto` (Heuristik), `ai` (Modell) oder `manual`
   (Umbenennen durch die Person). Ein manueller Titel wird nie überschrieben, auch nicht von einer Antwort, die
   erst nach dem Umbenennen eintrifft. Wer den Titel leert, gibt ihn an die Automatik zurück.
4. **Nachvollziehbar.** Jeder KI-Titel steht als Event `session.titled { title, source }` im Verlauf (K7).

## Folgen und Risiko

- **Datenabfluss:** Ist `assistant.model` ein Cloud-Endpunkt (in dieser Installation `api.z.ai`), verlassen die
  genannten Textanfänge den Rechner. Das ist dieselbe Konfiguration, die schon für Text-Befehle gilt; wer das
  nicht will, entfernt `assistant` oder zeigt es auf ein lokales Modell. Ohne `assistant` passiert nichts.
- Kosten: ein kurzer Aufruf pro Session, mit dem Flash-Modell vernachlässigbar.
- Bereits vorhandene Titel bleiben (`auto`); sie werden erst bei der nächsten ersten Antwort einer lebenden
  Session ersetzt.

## Messlatten

K10 (Sessions am Handy unterscheidbar), K7 (Herkunft in der Datenbank, Änderung als Event).
