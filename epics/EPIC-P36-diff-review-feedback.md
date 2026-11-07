# EPIC-P36 — Diff-Review mit gesammeltem Agenten-Feedback

**Status:** Planungsentwurf · **Umsetzung:** gesperrt · **Phase:** P36
**Dauer:** 1–2 Agenten-Wochen (grobe Schätzung, ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P33 (nach ausdrücklich gültigem P32-/P33-Evaluations-/Umsetzungs-Exit) mit nachweislich grünen Exit-Kriterien; wirksame Vorgänger-Abnahmen bleiben bindend.

Quelle: [Orca-Vergleich](../docs/2026-11-08_orca-vs-ancientvoid.md) und [Planungsgrundlage mit Übernahmeregister](../docs/2026-11-08_orca-epic-planung.md).
**Planungsauftrag 08.11.2026:** Nutzer beauftragt diese Epics ausdrücklich vor Abschluss der Vorgänger. Das erlaubt Planung, keine Implementierung und keine Aufhebung des Epic-Gatings. Vor T36.1 aktuellen Code-/Test-/Abnahmestand prüfen; historische Überschriften reichen nicht.

## 1. Ziel

Änderungen am Handy und Desktop gezielt kommentieren und mehrere Befunde als einen Folgeauftrag an einen gewählten Agenten senden. Vorhandene Diff-Ansicht erweitern. K3/K5/K7/K10; K1 für weiterhin erreichbare Freigaben.

## 2. Scope (In / Out)

**In:** Datei-/Zeilenbereichsnotizen, Entwurf, Sammelversand, Quellenbezug, Status gesendet/offen/erledigt und sichtbare veraltete Anker; erst lokale Reviews, später P37-Forge-Verknüpfung.
**Out:** neuer Voll-Editor, automatisches Auflösen verschobener Zeilen mit unbelegter Sicherheit, autonome Merge-Freigabe, zweites Prompt-Queue-System.

## 3. Design-Details

### 3.1 Bestand und Einbauorte
`apps/pwa/src/features/session/DiffPane.tsx` und `diff-lines.ts` bleiben Renderer. Remote-main-Nachgleich `08b9240` enthält bereits Commit-Abschnitte (AC-P2-1): Notizen müssen Commit-SHA versus uncommitteten Rest unterscheiden; diese Gliederung nicht nochmals bauen. Verträge unter `packages/contracts/src/reviews/`, Fachlogik unter `packages/core/src/modules/reviews/` (nur `index.ts` öffentlich), Routen `apps/hub/src/modules/reviews/reviews.routes.ts`. Neue geteilte Event-/Adapter-Verträge vor Umsetzung per ADR. Versand über bestehenden SessionManager/Approval-/Prompt-Pfad.

### 3.2 Bezug und Versand
Eine Notiz trägt Session-/Workspace-ID, Basis-SHA, Scope (konkrete Commit-SHA oder uncommitteter Rest), Diff-Identität, Pfad, alte/neue Seite und Bereich plus begrenzten Textausschnitt. Nach Änderung der Diff-Identität muss sie erneut zugeordnet oder als veraltet markiert werden; Zeilennummer allein reicht nicht. Nutzer wählt Notizen und Empfänger, sieht den gebündelten Prompt vor Versand. Operations-ID verhindert doppelten Sammelversand nach Doppelklick/Reconnect. Adapter ohne Folgeprompt bekommen einen begründeten, sichtbaren Alternativpfad, keine heimliche neue Session.

### 3.3 Recovery und Datenbudget
Notizen und Sendestatus aus Review-Journal/Snapshot rekonstruieren, SQLite nur Projektion. Große Ausschnitte/Feedback-Pakete als Blob, Event ≤4 KB. Diff-Startpayload bleibt ≤50 KB; einzelne Hunks nachladen. Offline Notizen lokal mit sichtbarem Zeitstempel halten; Versand/Freigaben nur online. „Erledigt“ ist menschlicher Review-Status, kein bestandener Test.

### 3.4 Zustellung abgleichen
Vor Ausbau die vorhandene Queue, `Ack` und InterruptedBanner mit Crash um `SessionQueue.take()`/Adapter-Übergabe prüfen. Kein neues allgemeines Zustell-Epic auf Verdacht. Reproduzierbarer Verlust/Doppelversand als Bug mit eigener ID und rot-grün-Test; ungeklärte Zustellung sichtbar halten, nie blind automatisch erneut senden.

### Orca-Referenzen und Übernahmegrenzen

Alle Links auf Commit `bdeb388d75120b6e36dd619291286de0cc9aae02`. Einstufung ist eine geprüfte Port-Hypothese, keine behauptete fertige AV-Kompatibilität. Vor Übernahme Imports/Lizenz/Tests/Strip-Type-Tauglichkeit erneut prüfen; keine großen Orca-Subsysteme blind kopieren.

| Quelle | Verwendung in AV |
|---|---|
| [src/shared/diff-comment-types.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/diff-comment-types.ts) | Port-Kandidat: kleines Datenmodell; Zeit/IDs/Session-Bezug auf AV-Contracts umstellen. |
| [src/renderer/src/store/slices/diff-comments/diff-comment-persistence.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/renderer/src/store/slices/diff-comments/diff-comment-persistence.ts) | Referenz für geordnete Writes/Rollback; Zustand liegt in Orcas Zustand-Store, nicht direkt importieren. |
| [src/main/native-chat/agent-session-journal/queued-messages/journal-unsent-send-hold.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/native-chat/agent-session-journal/queued-messages/journal-unsent-send-hold.ts) | Test-/Recovery-Referenz; vollständiges Chat-Journal nicht kopieren. |

## 4. Aufgaben (Checkliste T36.m)

- [ ] **T36.1** Bestands-/Queue-Audit und Review-ADR/Contracts einschließlich Diff-Identität und Operations-ID; Crashfenster reproduzierbar prüfen. **K3/K5/K7**.
- [ ] **T36.2** Notizspeicher, Statusfaltung und Restore; gleiche Datei/Zeile in verschiedenen Commit-Abschnitten, veraltete, umbenannte/gelöschte Dateien und große/binary Hunks testen. **K3/K5/K7**.
- [ ] **T36.3** Mobile/ Desktop-Notizen mit Bereichsauswahl, Liste, Vorschau, Empfängerwahl und manueller Erledigung in bestehende Diff-Ansicht integrieren. **K1/K2/K3**.
- [ ] **T36.4** Sammelversand über vorhandene Policy und Queue; Doppelklick, verlorene Antwort, Adapterfehler und fehlende Capability prüfen. **K5/K7/K9-Geist**.
- [ ] **T36.5** `e2e/specs/review-feedback.spec.ts`: Notieren → Restart → Senden → Revision → erneute Prüfung; Offline und veralteter Anker. **K3/K7/K10**.
- [ ] **T36.6** Gate, PWA-Build, echte mobile/desktop Review-Journey und Doku/Registrierung abschließen. **K1/K2/K3/K5/K7/K10**.

## 5. Acceptance Criteria (AC-P36-k)

- **AC-P36-1:** Drei Notizen an zwei Dateien bleiben nach Hub-/Client-Neustart mit Bezug und Status erhalten; gleiche Datei/Zeile in zwei Commit-Abschnitten kollidiert nicht.
- **AC-P36-2:** Ein Sammelauftrag enthält nur gewählte Notizen, nachvollziehbare Datei-/Diff-Bezüge und erreicht den gewählten Harness; zweiter Klick dupliziert ihn nicht.
- **AC-P36-3:** Veränderter Diff, Datei-Rename oder fehlender Anker wird sichtbar als veraltet/ungeklärt behandelt.
- **AC-P36-4:** Events ≤4 KB und erste Diff-Antwort ≤50 KB; Anhänge/Hunks werden gezielt nachgeladen.
- **AC-P36-5:** Offline entstehen keine angeblich gesendeten Aufträge; API-Fehler erhalten Entwurf und zeigen Ursache.
- **AC-P36-6:** Zustell-Audit dokumentiert vorhandene Garantien und offene Befunde; kein Exactly-once-Claim gegenüber fremden CLIs.

## 6. Premortem (Failure-Modi + Mitigation)

1. Zeilen wandern und Feedback trifft falschen Code → Diff-Identität und Ausschnitt prüfen, unklare Anker nicht verschieben.
2. Sammelversand geht doppelt raus → persistente Operation, unklarer Ausgang blockiert blindes Retry.
3. Review wird zweite Chat-Engine → bestehenden Session-/Queue-/Policy-Pfad verwenden.
4. Große Diffs lähmen Handy → K3-Nachladen und K5-Blobs auch für Notizen.

## 7. Definition of Done

Alle T36.* und AC-P36-* mit aktueller Evidenz, Vorgänger-Exit ausdrücklich grün. `npm run gate` und PWA-Build grün; Pipeline-Job `e2e` grün bzw. Infrastrukturfall nach `docs/ci-runbook.md` nachgezogen, niemals als Pass gezählt. Jede neue UI-Funktion/jeder Ablauf hat einen Spec in `e2e/specs/`; benötigte echte Browser-/Provider-/Geräte-Nachweise separat, Skip ≠ Pass. Neue APIs/Tools/Ansichten sind registriert, in Hub/PWA/hubctl erreichbar und dokumentiert. ADR vor Contract-Änderung, K5/K7/K8 entsprechend Scope nachgewiesen; keine offene TODO ohne Epic-Bezug. Übernommene Orca-Teile mit Commit/Pfad/Hash/Lizenz/Änderungsnotiz und eigenen Tests gemäß Planungsgrundlage.
