# ADR-0101 — Mehrsprachigkeit: Kataloge in der PWA, Nachrichtenschlüssel im Contract, Locale am Push-Abo

**Status:** akzeptiert (EPIC-P61 §3.2–§3.4; decisions from 17.11.2026) · **Betrifft:** `apps/pwa/src/shared/i18n/`, `packages/contracts/src/notifications/`, `packages/core/src/modules/notifications/`, `apps/hubctl/src/`, `scripts/check-i18n.mjs`, `e2e/support/fixtures.ts`

**Messlatten:** K5 (Payload-Größe), K7 (Rekonstruierbarkeit), K10 (Offline), PRD §8.5 (Agenten-Output ist Daten, keine UI)

## Kontext

Die Oberfläche ist deutsch hartcodiert (§3.1 des Epics: ~2.600 Strings,
Realitätsabschätzung ~1.900 UI-Strings). Nutzerentscheid 17.11.2026: Default
ist die Browsersprache, wenn ein Katalog passt (sonst Englisch); pro Gerät
persistierbar; Sprachliste modular. Der Hub erzeugt Texte, die in der PWA
landen (Notifications, Web-Push, API-Fehlertexte) — die dürfen nicht als
deutsche Prosa durch die Leitung müssen, sonst kann der Client nicht
übersetzen. bestehende Events aus der Zeit vor P61 dürfen nicht migriert
werden (K7).

## Entscheidung

1. **Kein Framework; typisierte Kataloge.** `de.ts` ist Quelle der Schlüssel
   (fachlich benannt, nie der deutsche Text selbst), `en.ts` ist als
   `Record<keyof typeof de, string>` typisiert — Vollständigkeit erzwingt
   `tsc`. Jede weitere Sprache ist genau eine Katalogdatei plus ein Eintrag
   in `availableLanguages` (Code, Label, Locale-Aliasse); `t()` und die
   Settings lesen nur diese Liste. Plural über `Intl.PluralRules`
   (Schlüssel-Suffixe `.one`/`.other`), Datum/Zahl über `Intl`-Formatter mit
   der gewählten Locale. `t()` hat `{name}`-Interpolation; fehlender
   Schlüssel zur Laufzeit: sichtbarer Fallback auf `de`, `console.warn` im
   Dev-Build — nie leerer Text. Beide Kataloge sind gebündelt und im
   Service-Worker-Precache (K10: offline umschaltbar); ab > 60 KB gzip pro
   Katalog wird der nicht aktive Katalog lazy-geladen und trotzdem
   vorgeladen.

2. **Sprache ist eine Geräte-Einstellung** (`localStorage`, wie die
   Presets, mit try/catch-Fallback auf „Automatisch"): „Automatisch
   (Browsersprache)" · Deutsch · English · (künftige Sprachen automatisch).
   Browsersprach-Match über das Sprachpräfix gegen `availableLanguages`;
   ohne Treffer Englisch. `<html lang>` folgt der gewählten Sprache. Der
   Wechsel lädt die PWA neu (deterministisch, kein Live-Re-Render); die
   bestehende Draft-Persistenz (Composer, Vormerkung) überlebt den Reload.
   Solange die Migration läuft, ist „English" in den Einstellungen hinter
   einem Dev-Flag, damit keine halbmigrierte Oberfläche ausgeliefert wird
   (Premortem 1).

3. **Der Hub schickt Schlüssel statt Prosa — additiv.** `HubNotification`
   (ADR-0015) bekommt `messageKey?: string` und
   `params?: Record<string, string | number>` (K5: keine Freitexte > 512 B
   in `params`, sonst `detail`); `title`/`detail` bleiben als Fallback
   (Deutsch) für Alt-Clients und Alt-Journal. Persistierte Notifications vor
   P61 haben keinen Schlüssel → Fallback-Text, keine JSONL-Migration (K7).
   API-Fehler: bestehende `code`-Felder werden zu Katalogschlüsseln
   (`error.<code>`); unbekannter Code zeigt die Hub-Message wörtlich.
   Web-Push rendert der Hub selbst: kleiner Server-Katalog in
   `packages/core/src/modules/notifications/i18n/` (nur Titel/Texte, die
   über die Leitung müssen), Sprachwahl über das additive Feld `locale` am
   Abo.

4. **`hubctl`** bekommt einen kleinen eigenen Katalog; Sprache:
   `--lang` > `AV_LANG` > `LANG`, Default Englisch wenn nichts passt;
   `--json` bleibt sprachneutral byte-identisch.

5. **Gate gegen Rückfall:** `scripts/check-i18n.mjs` (im `gate`) scannt den
   AST wie §3.1 über `apps/pwa/src` außerhalb von `shared/i18n/` und meldet
   JSX-Text und `title`/`aria-label`/`placeholder`/`alt`-Literale mit
   Wortcharakter; Ratchet-Baseline `scripts/check-i18n.baseline.json`
   (Anzahl pro Datei, darf sinken, nie steigen; am Epic-Ende leer);
   Ausnahmen nur per `// i18n-ignore: <Grund>`.

6. **Agenten-Output, Provider-Fehlerwortlaut, Tool-Namen, Logs und
   Commit-Nachrichten werden nicht übersetzt** (Daten, keine UI — PRD
   §8.5). Quick-Commands/Nyx erkennen Schlüsselwörter aller Katalogsprachen
   gleichzeitig (Muskelgedächtnis).

## Folgen

- ~1.900 Strings migrieren featurebereichsweise (T61.4–T61.6); die
  Ratchet-Baseline macht den Fortschritt sichtbar und den Rückfall rot.
- Die 46 `toLocaleString("de-DE")`-Aufrufe wandern in `shared/i18n/format.ts`.
- E2E: bestehende Specs bleiben deutsch (Fixture setzt Locale/Gerätesprache
  explizit auf `de`); eine neue Spec prüft den Wechsel.
- Contract-Änderungen sind additiv; Replay alter Events bleibt bitgleich.
