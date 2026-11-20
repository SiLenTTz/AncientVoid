# Grid-Inhalte und konfigurierbare Sidebar

Auftrag vom 20.11.2026: Auf PC und Tablet neue Inhalte als zusätzliche Karten
öffnen; vorhandene Karten behalten. Sidebar und Projektansicht bleiben außerhalb.
Messlattenbezug: PRD §9 K1 (erreichbare Freigaben), K2 (bestehende Session-Tails
behalten ihre Verbindungen), K10 (gespeicherte Ansichten und sichtbare Fehler).

## Architektur und Referenz

Die Änderung erweitert P18s `features/workspace/tiles.ts` und verwendet die
bestehenden Seiten, Session-Ansichten und Datei-Renderer. Ab 700 CSS-Pixeln
nutzen PC und Tablet denselben Arbeitsplatz; darunter bleibt die Seitennavigation.
Die Projektansicht ist der bisherige Dateibaum. Ihr Standardplatz ist zwischen
Suchen und Session. Nutzersortierung darf diesen Standard anschließend ändern.

Referenz untersucht: `custom-rag/app/frontend/src/core/navigation/sidebarOrder.ts`,
`Sidebar.tsx` sowie `domain/use-cases/useUseCases.ts` und `MyUseCasesPanel.tsx`.
Übernommen ist das Prinzip: bekannter Katalog, gespeicherte Reihenfolge zuerst,
neue Einträge hinten ergänzen, Sichtbarkeit separat filtern. AncientVoid nutzt
seine vorhandene gerätelokale Persistenz statt eines neuen Server-Endpunkts.

## Slices und geprüfte Öffnungswege

| Slice | Umsetzung | Testanker |
| --- | --- | --- |
| Karten ohne Verdrängen | Freie Slots verwenden, Grid vergrößern, ab fünf Slots scrollen; vorhandene Referenzen beim Fokussieren behalten | `open-content.test.ts`, `tiles.test.ts`, `workspace-content.spec.ts` |
| Navigation | Listen-/Hash-Ziele einschließlich Neu, Freigaben und Werkzeugseiten als Karten; Ziel und Session-Reiter pro Karte speichern | `content.test.ts`, `tool-pane.spec.ts`, `workspace-tiles.spec.ts`, `tablet-layout.spec.ts` |
| Inhaltslinks | Session-Reiter, Graph-Dateiknoten, Dateien aus Projektbaum/Git-Historie, Code-Suchergebnisse, Vault-Dateien und Wissen-Reiter | `workspace-content.spec.ts`, `code.spec.ts`, `repo-graph.spec.ts` |
| Werkzeuge | Suche als bleibende Karte; Browser-/Gerätekarte bindet Session/Host beim Öffnen, unabhängig von späterem Fokus | `workspace-layers.spec.ts`, `schnellsuche.spec.ts` |
| Sidebar | Sortieren, Sichtbarkeit, Minimieren; Konfiguration und Minimiertaste außerhalb der ausblendbaren Einträge | `sidebar.test.ts`, `workspace-content.spec.ts` |

Bewusste Grenzen: Formularaktionen, Filter, Darstellungsschalter und explizites
Schließen verändern weiter die jeweilige Ansicht. Ausdrücklich gewählte eigene
Fenster behalten ihre bisherigen Abläufe. Es gibt keine neue Hub-State-Quelle.

## Edges und Future-Fragility

- Volles Grid und verdeckte Slots: kein Ersetzen. Identische Ziele erhalten
  Fokus ohne Remount; unterschiedliche Session-Reiter/Dateien bleiben getrennt.
- Alte Workspaces bleiben lesbar; fehlende Sessions zeigen den bisherigen
  Fehlerhinweis. Beschädigte Sidebar-Werte fallen auf den Katalog zurück.
- Alle Sidebar-Einträge dürfen verborgen sein. Minimiertaste und Zugang zur
  Konfiguration bleiben verfügbar, auch bei eingeklappter Sessionliste.
- Neue Seite: Renderer und Eintragskatalog weiter gemeinsam pflegen; der
  Seitenparser prüft gegen den vorhandenen Routenkatalog.
- Verträge, Adapter-Isolation, K5-Events und K7-Hub-Recovery werden nicht geändert.
  Karten und Sidebar sind Gerätevorlieben in localStorage; Reload ist ihr
  Recovery-Pfad. Keine Behauptung eines neuen K2-Lastmesslaufs.
- Die Suchkarte behält den Befehlskontext der aktiven Karte; ihre Eingabe
  ersetzt weder Session-Fokus noch registrierte Antwort-/Codefelder.
- Schmale Karten: Menüs am Kartenkopf verankern; Hintergrund-Codeansichten
  dürfen den Hash einer anderen fokussierten Karte nicht überschreiben.

## Nachweise

Gezielte rot-dann-grün-Nachweise: fünfter Inhalt, verdeckte Slots und getrennte
Session-/Graph-/Dateiziele; zusätzlich Referenzstabilität beim erneuten Öffnen.
Der Browser-/Gerätetest reproduzierte ein über den Kartenrand ragendes Tablet-Menü.
Breite Testsuiten wurden nicht ausgeführt. Die konkreten abschließenden
Prüfergebnisse stehen im Commit-Nachweis.
