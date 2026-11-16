---
id: BUG-0173
slug: neue-session-vergisst-letzten-pfad
status: done
severity: S3
area: pwa
instance: dev
commit: "3aef99e5"
forge: ""
epic: ""
created: 2026-11-16
reporter: Pi-Session 2026-11-16 (Nutzerbericht + Browser-Repro)
---

# BUG-0173 — „Neue Session“ legt den gemerkten Pfad nur bei Git-Projekten vor

## Gesehen

Der zuletzt benutzte Pfad liegt im LocalStorage
(`ancientvoid.newSession.last`), das Feld **Pfad** beim nächsten Öffnen ist
aber leer — und zwar sobald keine Git-Projekte entdeckt werden. Dazu kommt
ein Hinweis „keine Projekt-Wurzeln konfiguriert“, obwohl Wurzeln konfiguriert
sind (in ihnen liegen nur Ordner ohne `.git`), und der Block „neues Projekt
(Name) / + Anlegen“ verschwindet ebenfalls. Nutzerbericht: „wenn ich eine neue
Session öffne, dann muss ich da immer ein Projektpfad angeben, das nervt
mich.“

## Erwartet

Ein gemerkter Pfad wird vorbelegt, unabhängig davon, ob er in der
Auswahlliste steht. Der Hinweis hängt an der Zahl konfigurierter Wurzeln,
nicht an der Zahl gefundener Git-Ordner; „+ Anlegen“ bleibt erreichbar, wenn
Wurzeln konfiguriert sind.

## Repro

**Fall A (Kais Konfiguration, `projectRoots: []` in `hub.config.json`):**

1. Scratch-Hub mit `projectRoots: []` starten, PWA öffnen, „Neue Session“.
2. Ins Feld **Pfad** einen existierenden Ordner eintragen, Session starten.
3. „Neue Session“ erneut öffnen (Reload).

**Ergebnis nach Schritt 3:** Pfad-Feld leer; Hinweis „keine Projekt-Wurzeln
konfiguriert — siehe docs/configuration.md“; kein „+ Anlegen“-Block — obwohl
`ancientvoid.newSession.last` den Pfad enthält (gemessen: 32-stelliger Token,
`last.project` gesetzt, Feldwert leer).

**Fall B (Wurzeln konfiguriert, ein Git-Projekt):** Nach Reload wird
`gitrepo` vorgezogen statt des zuletzt benutzten `plain-ordner`
(Überschreiben des gemerkten Pfads, weil er nicht in der Liste steht).

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Scratch-Hubs (Ports 62883 = `projectRoots` gesetzt, 64919 = `projectRoots: []`) |
| Commit | `3aef99e5` |
| Node-Version | v24.18.0 |
| Adapter | dummy |
| Repro-Weg | PWA (agent-browser, Chromium) |

## Logs

```text
localStorage nach Start in plain-ordner:
  ancientvoid.newSession.last -> {"adapter":"dummy","project":"...\\projects\\plain-ordner"}
Formular nach Reload (projectRoots: []):
  Hinweis: "keine Projekt-Wurzeln konfiguriert — siehe docs/configuration.md"
  input[placeholder="/home/user/repo"].value -> ""
  Buttons: ["Starten", ...]  (kein "+ Anlegen")
Formular nach Reload (projectRoots gesetzt):
  combobox "Projekt" = "gitrepo (main)", Pfad-Feld = "...\\projects\\gitrepo"
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit (PWA) | `apps/pwa/test/new-session-prefill.test.ts` (neu) | fehlt |
| E2E | `e2e/specs/neue-session.spec.ts` (neu) | fehlt |

Ein PWA-Test, der `CreateSession` mit leerer Projektliste und gesetztem
`newSession.last` rendert und das Vorlegen des Pfads erwartet, wäre ohne Fix
rot.

## Eingrenzung

`apps/pwa/src/features/new-session/CreateSession.tsx:182-191` — die
Vorbelegung passiert nur innerhalb `if (res.projects.length > 0)`;
Zeile 319 schaltet den „+ Anlegen“-Block an dieselbe Bedingung; Zeile 313ff
zeigt den Wurzel-Hinweis, obwohl `projects.length === 0` auch bei
konfigurierten Wurzeln ohne Git-Ordner eintritt.

## Fix (`e21ba1f3`)

Ursachepraezisierung gegenueber der
Eingrenzung oben: die Vorbelegung hing an `if (res.projects.length > 0)` *und*
daran, dass der gemerkte Pfad in der Liste vorkam — ohne Git-Repos passierte gar
nichts. `/api/projects` liefert jetzt `rootsConfigured`/`roots`, die PWA trennt
"Wurzeln fehlen" von "Wurzeln ohne Repos", der gemerkte Pfad wird immer vorgelegt,
"+ Anlegen" haengt an den Wurzeln statt an der Trefferzahl. Der Eindruck "Starten
tut nichts" kam zusaetzlich von einem veralteten `apps/pwa/dist` und einem
deaktivierten Knopf ohne Deaktiviert-Optik (siehe BUG-0174).

## Tests

Live nach PWA-Neubau: nach Reload steht der gemerkte `<root>\gitrepo\unterordner`
im Eingabefeld, obwohl die Discovery nur `gitrepo`/`plain-ordner` kennt; in einem
Hub ohne einziges Git-Repo ist das Dropdown mit `plain-ordner` befuelld und
"+ Anlegen" vorhanden.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` (auf diesem Branch)
