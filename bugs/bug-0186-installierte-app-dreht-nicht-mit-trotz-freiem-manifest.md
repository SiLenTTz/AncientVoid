---
id: BUG-0186
slug: installierte-app-dreht-nicht-mit-trotz-freiem-manifest
status: done
severity: S2
area: pwa
instance: handy
commit: "fix/drehen-installierter-stand"
forge: ""
epic: ""
created: 2026-11-16
reporter: kai (Handy über Tailnet)
---

# BUG-0186 — installierte App dreht nicht mit: der Worker betoniert das alte Manifest ein

## Gesehen

Nach BUG-0181 (Manifest gab `portrait-primary` vor, PR #41 ist gemerged) bleibt die
installierte App auf dem Handy trotzdem im Hochformat. Kai: „lokal auf dem Handy neu
gestartet und wenn ich es jetzt drehe, dreht sich immer noch nicht mit“.

## Was schon bewiesen war

* Das ausgelieferte Manifest ist frei: `curl http://127.0.0.1:7373/manifest.webmanifest`
  → `"orientation": "any"` (auch in `spec:querformat.spec.ts` als Fall verankert).
* Die Querformat-Höhen stimmen bei 915 × 412 (Dock 180 px, Chat 130 px, Laufleiste aus).

Am Ausliefern liegt es also nicht.

## Befund am installierten Stand

Der Service Worker liegt unverändert in `apps/pwa/public/sw.js`:

| Fakt | Wert |
|---|---|
| letzte Änderung an `sw.js` | `4bfbcc2d` — „AncientVoid 0.1.0 — first public release“ |
| Cache-Stufe | `ancientvoid-v5` |
| vorgeladen (`SHELL`) | `/`, `/index.html`, **`/manifest.webmanifest`**, `/icons/icon-192.png` |

Gemessen auf diesem Rechner gegen den laufenden Hub (`caches` im Page-Kontext ausgelesen):

```json
[{ "cache": "ancientvoid-v5",
   "urls": ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png"],
   "manifestOrientation": "any" }]
```

Das Manifest liegt also **in einem Cache des Workers**. Auf dem Handy ist dieses
Exemplar beim *früheren* Öffnen gelandet — zu der Zeit, als das Manifest noch
`portrait-primary` sagte. Android liest die Fenster-Ausrichtung einer installierten App
aus dem Manifest; weil sich an `sw.js` seit dem Release byte-mäßig nichts geändert hat,
installiert Chrome **nie einen neuen Worker**, der diesen Cache räumen würde. Ohne
neuen Worker bleibt das eingemauerte Manifest der Stand, den das Gerät benutzt.

## Erwartet

* Das Manifest gehört nicht in das Vorlade-Set eines Workers, das darf es auf keinem
  Gerät einbetonieren.
* Der Stand auf dem Gerät muss ablesbar sein: Anzeigemodus, Fenster-Ausrichtung,
  Manifest-Ausrichtung, Worker-Stufe, Manifest in Cache ja/nein.
* Ein Worker-Wechsel muss alte Manifest-Exemplare aktiv räumen.

## Ursache

1. `sw.js` lud `"/manifest.webmanifest"` in `SHELL` vor — für Offline-Toleranz (K10)
   gedacht, aber es zementiert genau die Einstellung, die das Fenster der installierten
   App steuert.
2. `CACHE_VERSION` war seit dem ersten Release nie angehoben worden. Chrome prüft den
   Worker auf Byte-Gleichheit: gleiche Bytes ⇒ kein neuer Worker ⇒ kein `activate` ⇒
   alter Cache bleibt für immer.
3. Nach dem ersten Fix-Versuch live auf dem Gerät gemessen (Einstellungen → Geräte →
   „Installierter Stand“):

   ```text
   Anzeigemodus: Browser-Tab
   Fenster-Ausrichtung: landscape-primary (quer)
   Manifest-Ausrichtung: any
   Manifest-Cache: liegt in ancientvoid-v6 — die App dreht sonst nicht mit
   Service-Worker-Cache: ancientvoid-v6
   ```

   Die `activate`-Räumung half nur einmal: `networkFirstShell` schreibt jede Antwort
   zurück in den Cache — auch das Manifest. Nach dem nächsten Laden lag das Exemplar
   wieder drin. Das ist die eigentliche Ursache, die beiden anderen sind ihre Träger.

## Repro

1. `caches.keys()` und die Einträge im Page-Kontext auslesen (Skript
   `data/tmp-debug/sw-cache-probe.mjs`, Ausgangszustand oben).
2. `git log -1 -- apps/pwa/public/sw.js` → erster Release-Commit.

**Ergebnis:** Manifest-Exemplar im Worker-Cache, Worker-Stufe unverändert seit Release.

**Häufigkeit:** jedes Gerät, das die App vor dem Dreh-Fix geöffnet hatte. Auf Kais Handy
konnte der Endzustand nicht direkt abgelesen werden (kein Zugriff auf das Gerät) —
deshalb ist jetzt das Diagnose-Panel an Bord, das genau diese Zeilen auf dem Handy zeigt.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Windows-Host, Hub `127.0.0.1:7373`, Tailnet `kaisgamingdesk.taila03493.ts.net` |
| Gerät | Samsung Galaxy (PWA installiert), Android/Chrome |
| Commit | `main` nach PR #41 |

## Fix

* `sw.js`: `CACHE_VERSION` → `ancientvoid-v6`, Manifest aus `SHELL` entfernt,
  `dropCachedManifest()` beim `activate` (wirft jedes Manifest-Exemplar aus jedem Cache),
  **und der Fetch-Handler fingiert das Einlagern nicht mehr**: `/manifest.webmanifest`
  wird direkt aus dem Netz beantwortet, ohne Cache-Schreibzugriff. Sonst erzeugt jedes
  Laden das Exemplar neu (auf dem Gerät so gemessen).
* `message`-Antwort `ancientvoid:sw-info` für die Oberfläche.
* Neue Stand-Anzeige in **Einstellungen → Geräte → Installierter Stand**
  (`apps/pwa/src/shared/device-status.ts`, `InstallStatus.tsx`): Anzeigemodus,
  Fenster-Ausrichtung, Manifest-Ausrichtung, Manifest-Cache, Worker-Stufe; liest nach
  `controllerchange` und auf Knopfdruck erneut.
* Guard-Test `apps/pwa/test/public-sw.test.ts` sichert die Zusagen an `sw.js`.

## Tests

| Ring | Datei / Fall | Stand |
|---|---|---|
| Unit | `apps/pwa/test/public-sw.test.ts` — kein Manifest in `SHELL`, `dropCachedManifest` aktiv, Stufe ≥ v6, Stand-Anfrage beantwortet, Fetch-Handler lagert das Manifest nie ein | grün (5 Fälle) |
| Unit | `apps/pwa/test/shared/device-status.test.ts` — Modus/Ausrichtung/Manifest/Worker gelesen; kaputter Manifest-Zugriff heißt „nicht lesbar“; Manifest-Cache erkannt | grün (5 Fälle) |
| E2E | `e2e/specs/installations-stand.spec.ts` — Panel zeigt `Manifest-Ausrichtung: any` …; Worker-Kontext: Stufe ≥ v6, kein Manifest im Cache, **und erneut nach dem Settings-Besuch** (die App holt das Manifest selbst) | grün (2 Fälle) |
| Regress | `apps/pwa/test` komplett | grün (65 Dateien, 433 Tests) |
| Offen | echter Dreh auf Kais installierter App | steht aus — Panel zeigt nach dem nächsten Öffnen, was das Gerät glaubt |

Der E2E-Harness blockiert Service Worker per Grundkonfiguration
(`playwright.config.ts`, `serviceWorkers: "block"`); der zweite Fall öffnet deshalb
einen eigenen Kontext mit erlaubten Workern.

## Schrittstand

- [x] Manifest-Cache im Worker nachgewiesen (Tabelle oben)
- [x] Worker-Stufe angehoben, Manifest raus aus dem Vorlade-Set, alte Exemplare werden geraeumt
- [x] nach dem Leben gemessen: der Fetch-Handler lagert das Manifest ebenfalls nicht ein
- [x] Stand auf dem Geraet ablesbar gemacht
- [x] Guards + E2E
- [x] Stand nach dem Deploy auf Kais Handy abgelesen (Tabelle im Nachtrag): Manifest frei,
  kein Cache, der Winkel bleibt trotz Drehversuch bei 0 Grad
- [x] Winkel in der Standanzeige plus Querformat-Zwang als Versuch und als Beweis
- [ ] Drehen auf Kais installiertem App-Startsymbol nachziehen (Entfernen + Neuanlegen kann nötig sein)

## Nachtrag: auf dem Handy gemessen (16.11.2026, nach dem Deploy)

Kai meldet nach dem Deploy („Dreht nicht") und liefert den Stand aus der App ab:

```
Anzeigemodus: installiert (eigenes Fenster)
Fenster-Ausrichtung: hoch · Systemmeldung: portrait-primary
Manifest-Ausrichtung: any
Manifest-Cache: keiner (Soll)
Service-Worker-Cache: ancientvoid-v6
```

Das trennt die Verdächtigen:

* Die **Web-Schicht ist sauber** — freies Manifest, kein Manifest-Exemplar im Cache, neue
  Worker-Stufe. Ein eingelagertes Manifest war die Ursache, aber nicht die einzige.
* Das **Fenster reagiert auf kein Drehen**: die Medienabfrage meldet weiter `hoch`, und die
  Systemmeldung sagt `portrait-primary`. Ein gedrehtes Gerät mit freien Manifest melden
  zusammen `quer` und `landscape-primary`.
* Bleibt als Sperre nur, was **oberhalb** der Web-Schicht liegt: die von Chrome gespeicherten
  App-Metadaten (die bei der Installation genommen werden und sich nicht jederzeit erneuern)
  oder eine Geräte-Einstellung (Auto-Rotate aus, One-UI-Ausrichtung je App).

Deshalb zwei weitere Maßnahmen:

1. **Winkel in der Standanzeige** (`Fenster-Winkel: 0°/90°/…`). Damit ist ein Drehversuch
   beweisbar: bleibt der Winkel bei 0°, dreht das Fenster nicht — die App ist nicht schuld.
2. **„Querformat erzwingen" / „Wieder automatisch"** (Einstellungen → Geräte). Die App
   versucht `screen.orientation.lock("landscape")` selbst. Eine Abweisung wird gezeigt, wie
   sie heißt (`SecurityError (Gerät sperrt)`, `NotSupportedError`, „API fehlt") — ein Knopf,
   der Erfolg meldet, während das Fenster liegen bleibt, ist kein Fix.

Bleibt die App nach Entfernen und Neuanlegen des Startsymbols im Hochformat und lehnt
`lock()` mit `SecurityError` ab, ist die Sperre am Gerät zu suchen: Auto-Rotate und — bei
One UI auf dem Z Fold — die Ausrichtungsfreigabe **je App**.
## Erledigt — am Gerät nachgewiesen (17.11., 19:55)

Nach Entfernen und Neuanlegen der App meldet **dieselbe installierte Anwendung** (Berichte im
Hub-Protokoll, `von: handy`, `anzeige: standalone`):

| Zeit | Winkel | Fenster | Manifest | Ausrichter |
|---|---|---|---|---|
| 19:05:14 (vorher) | **0°** | 874×883 @2.25 | `any` | entsperrt nach `SecurityError` |
| 19:55:16 (nach Neuanlegen) | 0° | 874×883 @2.25 | `any` | nicht versucht (Hochformat) |
| 19:55:26 (nach Drehen) | **270°** | **970×796** @2.25 | `any` | nicht versucht |

Der Winkel wechselt also in der installierten App auf 270° und das Fenster wird quer
(970×796 statt 874×883). Damit ist BUG-0186 abgeschlossen: die Web-Ebene war nie schuld, es
waren die **Installations-Metadaten von Chrome** (beim Anlegen übernommen: `portrait-primary`).

Dauerhaft gegen künftige Fälle: der Geräte-Selbstbericht an den Hub (Route
`/api/diagnostics/client-report`, PR #111), die Hinweiszeile im Stand-Panel (PR #113), und der
globale Skill `pwa-install-rotation-trap` (Trenn-Tab-Test, SecurityError-Spur,
One-UI-App-Ausrichtung, quadratisches Z-Fold-Innendisplay, Install-Angebot nach
Deinstallation unterdrückt). Token-Hygiene: `handy-neu` widerrufen (nie benutzt), `handy` bleibt
in Gebrauch.

## Ursache gemessen (17.11., 18:58–19:05) — Selbstbericht des Handys

Der Hub protokolliert neun Berichte aus der **installierten** App (`von: handy`,
`anzeige: standalone`) und einen Vergleichslauf im Browser:

| Quelle | Winkel | Anzeigemodus | Manifest | Fenster | Ausrichter |
|---|---|---|---|---|---|
| handy (Außendisplay) | 0° | standalone | `any` | 480×1026 @2.25 | abgewiesen: `SecurityError (Gerät sperrt)` |
| handy (Innendisplay, aufgeklappt) | 0° | standalone | `any` | 874×883 @2.25 | abgewiesen / entsperrt im Wechsel |
| PC im Browser | 90° | browser | `any` | 1280×800 @2.625 | nicht versucht |

Kai meldet unabhängig davon: **im Chrome-Tab dreht es sofort**. Der Tab-Bericht zeigt 90°,
die installierte App bleibt bei 0° — auf Außen- **und** Innendisplay. `manifest: any` und
„Manifest-Cache: keiner“ schließen Web-Ebene und Worker-Cache aus. `screen.orientation.lock()`
antwortet `SecurityError`, was zu einer Activity passt, deren Ausrichtung festgenagelt ist.

**Ursache:** die Installations-Metadaten von Chrome übernahmen die Ausrichtung beim Anlegen des
Startsymbols (damals `portrait-primary`). Die Änderung des ausgelieferten Manifests auf `any`
wirkt auf eine **bereits installierte** App nicht nachträglich.

**Heilung am Gerät:** App entfernen (Startsymbol-Icon lang drücken → App-Info → Deinstallieren)
und über https://kaisgamingdesk.taila03493.ts.net neu hinzufügen.

**Die Oberfläche sagt das jetzt selbst:** im „Installierten Stand“ erscheint eine Hinweiszeile,
wenn das Manifest frei ist, nichts gecacht ist und der Winkel trotzdem bei 0° bleibt
(`device-status.ts`, zwei neue Fälle in `device-status.test.ts` — 10 passed).

## Ferndiagnose eingebaut (17.11., `POST /api/diagnostics/client-report`)

Kai meldet vom Gerät: **„Fenster-Winkel ändert sich nicht, egal was ich mache“** — weder
Gerät drehen noch „Querformat erzwingen“ noch App-Neustart bewegen `screen.orientation.angle`
(bleibt 0). Damit ist die Frage nicht mehr, *ob* die Web-Ebene sauber ist (sie ist es:
Manifest `any`, Worker `ancientvoid-v6`, kein Manifest im Cache), sondern was das Gerät und
die Installations-Metadaten von Chrome damit machen.

Ab jetzt muss das niemand mehr auf dem Handy ablesen: „Stand neu prüfen“ (und jeder Versuch
„Querformat erzwingen“) sendet den Selbstbericht an den Hub, der ihn **protokolliert** —
eine Zeile mit Winkel, Anzeigemodus, Manifest-Ausrichtung, Fenstergröße und Gerät.

- Vertrag: `packages/contracts/src/observability/client-report.ts` (begrenzte Einzelwerte, K5)
- Route: `apps/hub/src/modules/diagnostics/client-report.routes.ts` → 202 `{logged:true}`,
  nur Protokoll, **kein** neuer Dauerzustand (K7: nichts zu erholen)
- PWA: `apps/pwa/src/shared/device-report.ts`, best-effort — ohne Token oder offline bleibt
  die Anzeige unverändert und die App funktioniert weiter.

Messung: `apps/hub/test/modules/diagnostics/client-report.routes.test.ts` **4 passed**
(annommen, unbekannter Typ 400, Feld über Grenze 400, ohne Token 401),
`apps/pwa/test/shared/device-report.test.ts` **4 passed** (Abbildung auf Vertrag,
Browser-Tab, Text-Kurzung, fehlende Winkel-API lügt nicht). Typecheck Exit 0,
`check:arch` ohne Verletzungen (543 Module).

## Zwei Ursachen, ein Trenn-Test

1. **Die Installations-Metadaten von Chrome halten die alte Ausrichtung fest.** Beim Anlegen
   des Startsymbols wurde das Manifest (`portrait-primary`) in die App-Metadaten übernommen;
   das ausgelieferte Manifest ist längst `any`, aber die installierte App fragt nicht erneut
   nach der *Ausrichtung*. Trennen: dieselbe URL in einem **normalen Chrome-Tab** öffnen und
   drehen. Dreht der Tab, die App aber nicht -> Metadaten. Heilen: App entfernen
   (Startsymbol-Icon lang drücken -> App-Info -> Deinstallieren) und neu hinzufügen.
2. **Das Gerät sperrt pro App.** One UI kennt eine Ausrichtung je App (Einstellungen ->
   Erweiterte Funktionen -> App-Ausrichtung / Auto-rotate-Apps) und global Auto-Rotate in den
   Schnelleinstellungen. Dreht auch ein normaler Tab nicht, liegt es hier.

