# EPIC-P57 T57.12 — Doku-Site: Evaluations-Exit

Stand 13.11.2026 · Vorschlag **vertagt** (kein Go) — Nutzer-Bestätigung offen.
Grundlage: [Recherche](2026-11-13_doku-onboarding-recherche.md) §3.3/§4/§5.

## Frage

Braucht AncientVoid nach der Stufe 1 (Diátaxis-Kopfzeilen, generierte
Referenz, ausführbares Tutorial, Gate-Regeln) eine gerenderte Doku-Site
(VitePress, Starlight, Docusaurus)?

## Kriterien und Ist-Stand

| Kriterium | Schwelle für „Go“ | Ist (13.11.2026) |
|---|---|---|
| Lebende Seiten | > ca. 60 und Navigation über die Übersichtsseite reicht nicht mehr | 37 lebende `docs/*.md` (Übersichtsseite `uebersicht.md` ordnet sie nach Art) |
| Suchbedarf | Nutzer finden Inhalte nicht über README, Übersicht, GitLab-Suche oder die PWA-Dokumentansicht | Die PWA zeigt Dokumente bereits gerendert und gruppiert (`e2e/specs/docs.spec.ts`); kein belegter Suchbedarf |
| Öffentliche Doku | Es gibt eine Zielgruppe außerhalb des Repos (P33 „englischer Einstieg“) | P33 vertagt, keine Veröffentlichung geplant |
| Versionierung | mehrere Releases parallel dokumentieren | ein Stand (`main`), keine Release-Zweige |
| Pflegeaufwand | Site-Build ersetzt keine Prüfung, kostet Abhängigkeit und ADR | Vue/Astro/React wäre neu neben Preact/Vite; Aufwand ohne Nutzen für die Lücken E1–E7 (Inhalt, nicht Darstellung) |

## Ergebnis

**Vertagt.** Keines der Go-Kriterien ist erfüllt; die Lücken aus der Recherche
sind Inhalt und Drift, nicht Darstellung. Es entsteht keine Abhängigkeit in
`package.json` (AC-P57-11).

## Wiedervorlage

Erneut prüfen, wenn (a) P33 ein Go bekommt oder (b) die Übersichtsseite über
etwa 60 Seiten wächst oder (c) die TTFS-Messung (T57.10) „Seite nicht gefunden“
als Haupthindernis zeigt. Dann zuerst **VitePress** als Spike (Vite vorhanden,
Markdown unverändert, Build lokal, kein SaaS), mit ADR und Rückbaupfad; MkDocs
Material scheidet wegen Wartungsmodus aus. Die Diátaxis-Kopfzeilen und
generierten Referenzen bleiben dabei die Quelle, die Site wäre nur Darstellung.
