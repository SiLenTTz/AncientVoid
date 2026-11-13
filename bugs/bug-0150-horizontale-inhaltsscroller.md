---
id: BUG-0150
slug: horizontale-inhaltsscroller
status: done
severity: S3
area: pwa
instance: lokal
commit: ""
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/58"
epic: EPIC-P50
created: 2026-11-13
reporter: "Nutzer (Session 109c8d3a)"
---

# BUG-0150 — Lange Inhalte erzeugen horizontale Scrollflächen

## Gesehen und erwartet

Nutzer meldet häufige horizontale Scrollbalken. Codeblöcke, Tabellen,
Dateizeilen und Diffs sollen lesbar umbrechen und in ihre Fläche passen.
Referenz: EPIC-P50, EPIC-P43 AC-P43-6; PRD §9 K2.

## Repro und Ursache

`e2e/specs/chat-lesbarkeit.spec.ts`: OpenCode-Session mit langen Codezeilen
und Tabellen öffnen, Chat auf 320/412/800/1280 px prüfen. Ursprüngliche
CSS-Regeln verwenden `white-space: pre`, `overflow-x: auto` und
`min-width: max-content`; Grid-/Flex-Inhalte können die Fläche aufziehen.
Rot bestätigt am 13.11.2026: isolierter Browser-Repro mit den ursprünglichen
Markdown-Regeln meldet bei 320 px innere horizontale Scrollflächen. Mit den
neuen Regeln ist derselbe Breitentest grün.

## Behebung und Tests

`45-readable-content.css`: gezielte Umbrüche und schrumpfbare Grid-/Flex-Kinder,
Tabellen mit fester Spaltenverteilung, Code-/Diff-/Dateizeilen mit Umbruch.
Der Spec prüft innere Scrollflächen ausdrücklich zusätzlich zum Fensterrand;
abgeschnittene Texte allein gelten nicht als Lösung.
