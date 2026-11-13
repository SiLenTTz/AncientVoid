---
id: BUG-0151
slug: denkpfad-verliert-werkzeuge
status: done
severity: S2
area: pwa
instance: lokal
commit: ""
forge: ""
epic: EPIC-P43
created: 2026-11-13
reporter: "Nutzer (Session 109c8d3a)"
---

# BUG-0151 — Denkpfad verliert Tool-Zuordnungen und Denktext

## Gesehen

2026-11-12T23:56Z: Browser-Repro mit OpenCode-Prompt `GROSS` zeigt
`2 Schritte · 1 gelesen` statt eines abgeschlossenen Leseschritts.
Nutzer meldet unzuverlässiges Thinking/Reasoning und unbekannte Tool-Aufrufe.

## Erwartet

Werkzeuge behalten Namen, Eingaben und Ergebniszuordnung auch über K5-Blobs.
Gelieferter Denktext bleibt vollständig aufklappbar. ACP-Reihenfolge bleibt
erhalten; aktuelle Codex-Werkzeuge werden normalisiert. Nicht gelieferter
Text wird nicht erfunden; neue unbekannte Typen bleiben diagnostizierbar.
Referenz: EPIC-P43 T43.4, PRD §9 K2/K5/K7/K10.

## Ursache

`turns.ts` wertet K5-Platzhalter vor dem Blob-Nachladen aus. IDs und Namen
fehlen; `isEmptyThinking` hält ausgelagerten Text für leer. Namensregeln
erkennen keine Namespaces/ACP-Kategorien. Arbeitsnotizen zeigen nur die
gekürzte Summary. ACP puffert Antwort und Gedanken gleichzeitig und gibt
sie in fester statt tatsächlicher Reihenfolge aus. Codex `itemCompleted`
verwirft nicht berücksichtigte Typen still.

## Behebung und Tests

Vor der Projektion Blobs laden (höchstens vier parallel, geteilter Cache
je API/Session, Fehleranzeige mit Wiederholung); Fleet-Host beim Laden
berücksichtigen. Namen/Kategorien klassifizieren, unbekannte Namen erhalten,
Notizen aufklappbar darstellen. ACP beim Kanalwechsel flushen. Codex-Shapes
gegen das lokal generierte Schema von codex-cli 0.164.0 geprüft.

Rot vor Fix: vier Unit-Regressionen in `turns.test.ts`/ACP `normalize.test.ts`,
drei Codex-Regressionen in `app-server-events.test.ts`, Browser-Repro `GROSS`.
E2E prüft große Eingaben, Ergebnisse und Denktexte über echten Hub/Blobs.
Zusätzliche Tests prüfen Cache-Isolation und Wiederholung nach Ladefehlern.
