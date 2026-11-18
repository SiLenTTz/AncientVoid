# ADR-0093 — die Ablage nimmt auch, was außerhalb kopiert wurde (Text und Bild)

## Lage

ADR-0090 legt Kopien eine Stufe tiefer ab — aber nur, was **die App selbst** kopiert.
Ein Screenshot aus einer anderen App, ein Text aus dem Mail-Programm, eine Kennung aus
einem Terminal: nichts davon erreicht die Ablage. Und Bilder kommen in der Ablage gar
nicht vor, weil sie in `localStorage` nicht passen.

Beides soll anders werden, ohne so zu tun, als könnte ein Browser das System-Clipboard
belauschen, wenn er nicht am Zug ist.

## Entscheidungen

1. **Gelesen wird beim Wiederkommen, nicht dauerhaft.** Beim `focus` und beim
   `visibilitychange` auf „sichtbar“ schaut die App einmal ins System-Clipboard —
   frühestens drei Sekunden nach dem letzten Blick. Kein Polling-Timer, kein
   Hintergrundlauschen.
2. **Was drin ist, wird eingeordnet:** `text/plain` → Stufe mit der Herkunft
   „Andere App“; `image/png`/`image/jpeg` (höchstens 12 MB pro Bild) → **Bild-Stufe**.
   Weitere Typen (Files, HTML) bleiben vorerst draußen — die Zeile würde Lügen erzählen,
   wenn wir daraus „Text“ zimmern.
3. **Ehrliche Grenze:** der Browser erlaubt Clipboard-Lesen nur, während das Fenster
   fokussiert ist, und nur nach seiner Erlaubnis (`clipboard-read`). Was kopiert wurde,
   während die App zu war, holt kein Web-Feature nach. Das steht im Blatt, nicht nur hier.
4. **Bilder liegen in IndexedDB, nie in `localStorage`:** eigener Speicher
   (`ancientvoid.clipboard-images`), zwölf Bilder, höchstens 24 MB, neueste zuerst, das
   älteste fliegt zuerst. Das Blatt zeigt ein echtes Vorschaubild (Object-URL aus dem
   Blob) — kein Base64 im Textpeicher.
5. **Was man mit einem Bild anfängt:** „**anhängen**“ (derselbe Weg wie die Büroklammer:
   Hochladen zum Hub, dort OCR/Vision), „in die Zwischenablage“ zurück, „entfernen“.
   Anhängen nutzt die bestehende Anhang-Route des Hubs — kein neuer Endpunkt.
6. **Wer das nicht will, schaltet es ab:** im Ablageblatt ein Schalter
   „aus anderen Apps übernehmen“. Standardmäßig an, weil sonst eine Funktion fehlt, die
   Kai ausdrücklich will; der Browser fragt ohnehin selbst einmal nach.
7. **Keine Duplikate, keine Geheimnisse:** eigene Kopien bleiben durch den Dedupe-Trick
   einfach eine Stufe; Token werden weiterhin nicht abgelegt (ADR-0090 bleibt).

## Abgewogen

- *Warum nicht beim Start einmal lesen?* Genau das passiert (Fokus beim Start). Aber ein
  Timer, der alle paar Sekunden liest, würde die Erlaubnis-Achse des Browsers strapazieren
  und ist kein Gewinn: zwischen zwei Blicken ändert sich das Clipboard nur, wenn etwas
  kopiert wurde — und das sieht die App erst beim nächsten Blick.
- *Warum IndexedDB und nicht Hub-Speicher?* Ein Screenshot ist personenbezogener
  Bildschirminhalt. Der Hub kennt Sessions; ein allgemeiner Bildvorrat dort wäre ein neuer
  Datenbestand mit Löschpflicht. Auf dem Gerät ist er schon durch den Browser begrenzt.

## Grenze (bewusst)

Drei Sekunden Mindestabstand, zwölf Bilder, 24 MB, ein Bild höchstens 12 MB. Nach dem
Löschen der Browserdaten ist alles weg. Und: was der Browser nicht hatte, kann die App
nicht zeigen — sie sieht das Clipboard nur, wenn sie darf und dran ist.
