---
name: bug-report
description: >-
  Legt einen beobachteten Defekt als bugs/bug-NNNN-slug.md an — mit Repro
  (PWA oder hubctl), Logs und Testluecke. Aktiv bei „Bug anlegen", „Fehler
  dokumentieren", „Issue erstellen", Dev-Funden ohne Fix, oder wenn bugfix
  keine Datei in bugs/ vorfindet. Nicht zum Patchen (das ist bugfix).
---

# Skill: bug-report

Querschnitts-Regeln: [`AGENTS.md`](../../../AGENTS.md). Beheben:
[`bugfix`](../bugfix/SKILL.md). Gates: [`gates`](../gates/SKILL.md).

## Zweck

Ein Symptom wird **gesehen**, eingegrenzt und als Datei unter `bugs/`
festgehalten. Die GitLab-Issue ist der Tracker, die Markdown-Datei die SSOT.
Ohne Repro keine Datei — dann die versuchten Schritte dokumentieren und
`status: open` mit Häufigkeit „einmalig / nicht reproduziert".

## Wann benutzen (Trigger)

- „Bug anlegen", „Fehler dokumentieren", „Issue erstellen", Dev-/Test-Fund.
- `bugfix` ohne bestehende `bugs/bug-NNNN-*.md`.

**Nicht benutzen, wenn:** der Patch schon klar ist und eine Datei existiert
(`bugfix`); neues Feature (`epic-creation` / `concept-phase`); reines Review
(`pr-review`).

## Hard Rules

- ✅ Reproduce **vor** dem Schreiben von „gesehen". Über PWA (Browser) oder
  `hubctl` (CLI) — nicht aus dem Code erraten.
- ✅ Ein Bug = ein Verhalten. Zwei Symptome → zwei Dateien.
- ✅ Logs mit Zeitstempel zur Aktion; keine Secrets, keine Tokens.
- ✅ Nächste Nummer aus den Dateien, nicht raten.
- ❌ Kein Fix in diesem Skill. Kein Symptom-Patch. Keine Screenshots committen.
- ❌ Kein Self-Merge, kein Force-Push, kein `--no-verify`.

## Phasen

### 1. Nummer und Titel

```bash
ls bugs/bug-*.md
```

Nächste ID = max(`NNNN`) + 1, sonst `0001`. Slug ASCII-kebab, ≤ 40 Zeichen.
Datei: `bugs/bug-NNNN-slug.md` aus [`bugs/template.md`](../../../bugs/template.md).

### 2. Repro

Zwei mögliche Wege, je nachdem wo das Symptom sitzt:

- **PWA (Browser):** Hub lokal starten (`node apps/hub/src/main.ts`),
  PWA bauen/öffnen, den Weg klicken. Nach dem Fehlverhalten: Konsole,
  Netzwerk-Tab, Screenshot nur bei Layout-Bugs (nicht committen).
- **`hubctl` (CLI):** `UACC_TOKEN=<token> node apps/hubctl/src/cli.ts
  sessions` / `tail <sessionId> -f` — Repro über Kommandozeile, Output
  zitieren.

Geht keiner der beiden Wege: das **sagen**, Logs trotzdem lesen, `repro` als
„nicht bestätigt" markieren.

### 3. Logs

`data/` ist gitignored — Auszug aus Hub-Log bzw. `journalctl`/Terminal-Output
in die Datei, Zeitstempel zur Aktion zuordnen. Ausnahme-Stack auf `file:line`
einkürzen.

### 4. Tests (Lücke, kein Patch)

Welcher bestehende Test in `packages/*/test/*.test.ts` hätte das fangen
müssen? Wenn keiner: Datei vorschlagen. Den roten Test schreibt `bugfix`.

### 5. Datei und Index

Frontmatter vollständig. Indexzeile in [`bugs/README.md`](../../../bugs/README.md).
Schwere wie das Produkt: `S1` Ausfall · `S2` Kernfunktion · `S3` Workaround ·
`S4` kosmetisch.

### 6. GitLab (Tracker, nicht SSOT)

```bash
glab issue create --title "BUG-NNNN: <Kurztitel>" --description-file bugs/bug-NNNN-slug.md --label bug
```

Die URL nach `forge:` ins Frontmatter. Schlägt das fehl: Datei bleibt gültig.

### 7. Handoff

Fix jetzt gewünscht → Skill [`bugfix`](../bugfix/SKILL.md) mit der Datei.
Sonst Output unten, Branch unverändert.

## Output-Format

```text
Bug: BUG-NNNN — <titel>
Datei: bugs/bug-NNNN-slug.md
Repro: gesehen (PWA|hubctl) | nicht bestätigt
GitLab: <url oder „keine">
Handoff: bugfix | offen
```

## Determinismus-Checkliste

- [ ] Repro über PWA oder `hubctl`, oder ausdrücklich „nicht bestätigt".
- [ ] Log-Auszug ohne Secrets.
- [ ] Indexzeile und nächste Nummer stimmen.
- [ ] Kein Produktionspatch in diesem Lauf.
