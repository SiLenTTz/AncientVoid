# ADR-0089: Prompt verbessern — lokales Modell zuerst, Projektkontext, Skill-Pflege statt Duplikate

Status: akzeptiert (2026-11-18)

## Kontext

T1.5-8 (EPIC-P1.5 §3.4) entschied, Prompts über den gewählten Adapter per One-Shot zu
verbessern, und verwarf ein lokales Modell, weil es keins gab. Seit T9.2 (ADR-0027) gibt
es eins: `assistant.model` (llama.cpp, OpenAI-API, ersatzweise `gatekeeper.model`). Der
Verbesserer fragt es trotzdem nicht. Adapter ohne eigenen One-Shot fallen seit 2026-10-24
auf `opencode run` zurück. Deshalb lief „Verbessern“ in der Praxis fast immer über
OpenCode. Der Verbesserer bekommt außerdem keinen Projektkontext, und die
Skill-Empfehlung kann vorhandene Skills nur nennen, nicht zeigen oder anpassen. Neu
anlegen schreibt mit `wx` und erzeugt so Dubletten (Nutzerauftrag 18.11.2026,
EPIC-P68).

## Entscheidung

1. **Engine-Kette `lokal → Adapter → OpenCode`.** Das lokale Modell kommt zuerst: Es
   kostet kein Kontingent, und die Daten bleiben auf eigener Hardware. Die Stufe wird
   übersprungen, wenn das Modell nicht konfiguriert ist, belegt ist (llama.cpp
   `/slots` meldet alle Slots aktiv, oder HTTP 503/429), nicht erreicht wird, in den
   Timeout läuft (45 s) oder leer antwortet. Danach folgt der One-Shot des gewählten
   Adapters (unverändert, `enhanceFlavorFor`), zuletzt OpenCode. Die Antwort nennt
   `engine` und jede übersprungene Stufe mit Grund (`skipped`). Nichts fällt still weg
   (Regel 6). Lokale Aufrufe tragen kein `costUsd` (R9.7).
2. **Projektkontext mit festem Budget und als Daten gerahmt.** Feste Quellen sind
   Agenten-Leitfaden, README-Anfang, Manifest-Metadaten, oberste Verzeichnisebene und
   Skill-Katalog, zusammen höchstens 6 000 Zeichen. Der Block ist ausdrücklich als
   Daten markiert, nicht als Instruktion (PRD §8.5). Er geht nie in Events (K5). Der
   verbesserte Prompt landet nur in der Vorschau; senden muss der Mensch.
3. **Skill-Pflege statt Dubletten.** Die Empfehlung kennt `mode: "update"`. Passt ein
   vorhandener Projekt-Eintrag thematisch, wird er angeboten statt eines neuen. Ein
   vorhandener Eintrag ist lesbar (`GET /api/skills/artifact`, Inhalt + sha256) und nur
   gegen den gelesenen Hash überschreibbar (`PUT /api/skills`, sonst 409). Eine
   Anpassung kann das Modell vorschlagen (`POST /api/skills/revise`, gleiche
   Engine-Kette), geschrieben wird dabei nichts. Basis-Skills bleiben aus der PWA
   unveränderbar. Die Datei im Projekt ist die einzige Quelle (K7); es entsteht kein
   neuer Hub-Zustand.
4. **Modell-Richter nur lokal und nur aus dem Katalog.** Ist ein lokales Modell frei,
   darf es die Empfehlung treffen (`none|use|update|create`). Namen, die nicht im
   Katalog stehen, werden verworfen, dann entscheidet die Heuristik. Für den Richter
   wird nie ein Adapter bezahlt.

Die gemeinsamen Antworttypen (`RewriteEngine`, `SkippedEngine`,
`PromptRecommendation`, `SkillArtifact`) liegen in `@ancientvoid/contracts`.
Hub, Core und PWA importieren dieselben Typen.

## Konsequenzen

- „Verbessern“ ist mit lokalem Modell kostenlos und meist schneller. Ist das Modell
  belegt, bleibt das bisherige Verhalten über den Adapter erhalten.
- Die Qualität kleiner lokaler Modelle ist schwächer. Weil die Engine sichtbar ist und
  „Original senden“ bleibt, bleibt das kontrollierbar. Das Feedback-Log (T3.9) bekommt
  die Engine.
- Die Policy-Tabelle braucht keine neue Operation: `PUT /api/skills` ist
  `skills.write`, `POST /api/skills/revise` ist `prompt.enhance`, das Lesen ist `read`.
- Ersetzt den Teil „(b) lokales Modell — abgelehnt“ aus EPIC-P1.5 §3.4.
