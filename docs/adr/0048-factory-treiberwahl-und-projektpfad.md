# ADR-0048: Factory-Treiberwahl und gemeinsamer Projektpfad

**Status:** angenommen (2026-11-02) · **Bezug:** ADR-0043, EPIC-P26, BUG-0085–0088

## Kontext

Die feste Claude-Wahl aus ADR-0043 verwirft die im Hub getroffene maki-/Modellwahl.
Zwei Rollen sind weiterhin erforderlich, erscheinen aber ohne Titel und Verlinkung
als unabhängige Läufe. Ein normaler Treiber-Start legt einen Worktree an; der
Beobachter liest damit ein anderes Verzeichnis als der Treiber bearbeitet.

## Entscheidung

`POST /api/factory/start` akzeptiert optional `adapter` (`claude` oder `maki`)
und `model`. Ohne Adapter bleibt Claude der kompatible Standard. Claude erhält
`/factory <Auftrag>`. Für maki lädt der Hub den vertrauenswürdigen projektlokalen
Skill über die vorhandene Skill-Auflösung und fügt dessen Text dem ersten Prompt
hinzu (`args.skill="factory"`, bestehende SessionManager-Skill-Kette inklusive Fortsetzung und Recovery). Der Chat enthält weiter nur den ursprünglichen Auftrag. Ein fehlender Skill wird vor dem Session-Start laut abgelehnt. Das ist keine
Slash-Ausführung durch maki und benötigt keine Änderung des Adapter-Contracts.
Die Providerwahl der Factory-Worker bleibt unabhängig im Factory-Projektrouting;
die Treiberwahl verwendet die Adapter-Modellkennung des Hubs.

Der Treiber wird über die interne `SessionManager.create`-Option `workInProject`
im Originalprojekt gestartet. Normale Sessions behalten ihre Isolation. Persistenz
und Recovery verwenden wie bisher `worktreeSha=null` und `record.project`; es
entsteht keine zusätzliche State-Quelle. Dies erfüllt den Projektpfad aus ADR-0043.

Die API setzt in beiden SessionRecords die echte Hub-hostId wie die Session-Routen; andernfalls würde die PWA auf einen unbekannten Fleet-Host „local“ navigieren. Der Dialog öffnet den Treiber und schließt auch im Desktop-Split. Beide Rollen
haben Titel und Partnerlinks aus den vorhandenen `factory.linkage`-Events.
Ein synchroner Submit-Schutz verhindert doppelte UI-Aufrufe. Die Route reserviert
den kanonischen Projektpfad während des Starts und lehnt weitere Starts bei einer
aktiven Beobachter-Session mit 409 ab. Die Aktivprüfung liest die persistierten
Sessions und gilt damit auch nach Hub-Neustart; die temporäre Reservierung schützt
nur den laufenden HTTP-Aufruf. Gestoppte, fehlgeschlagene und unterbrochene
Beobachter blockieren keinen neuen Lauf.

## Konsequenzen und Nachweis

Zwei technische Sessions bleiben ein Factory-Lauf. Der Nutzer sieht und öffnet
zuerst den Treiber-Chat. Die Factory-Harnesswahl für Worker bleibt wie in ADR-0043
fähigkeitsgesteuert; sie ist unabhängig vom Hub-Treiber. Keine Secrets werden
übergeben, keine zusätzlichen Event-Felder oder Worker-/Adapter-Contracts entstehen.
Integrationstests decken maki/Z.ai, Rollen, Git-Workdir und konkurrierende Starts ab;
Mobile-/Desktop-E2E decken Navigation und Partnerlinks ab. Bezug: PRD §9 K7/K9.
