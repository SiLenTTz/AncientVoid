---
id: BUG-0185
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

# BUG-0185 — installierte App dreht nicht mit: der Worker betoniert das alte Manifest ein

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
  `message`-Antwort `ancientvoid:sw-info` für die Oberfläche.
* Neue Stand-Anzeige in **Einstellungen → Geräte → Installierter Stand**
  (`apps/pwa/src/shared/device-status.ts`, `InstallStatus.tsx`): Anzeigemodus,
  Fenster-Ausrichtung, Manifest-Ausrichtung, Manifest-Cache, Worker-Stufe; liest nach
  `controllerchange` und auf Knopfdruck erneut.
* Guard-Test `apps/pwa/test/public-sw.test.ts` sichert die Zusagen an `sw.js`.

## Tests

| Ring | Datei / Fall | Stand |
|---|---|---|
| Unit | `apps/pwa/test/public-sw.test.ts` — kein Manifest in `SHELL`, `dropCachedManifest` aktiv, Stufe ≥ v6, Stand-Anfrage beantwortet | grün (4 Fälle) |
| Unit | `apps/pwa/test/shared/device-status.test.ts` — Modus/Ausrichtung/Manifest/Worker gelesen; kaputter Manifest-Zugriff heißt „nicht lesbar“; Manifest-Cache erkannt | grün (5 Fälle) |
| E2E | `e2e/specs/installations-stand.spec.ts` — Panel zeigt `Manifest-Ausrichtung: any` …; Worker-Kontext: Stufe ≥ v6 **und kein Manifest in einem Cache** | grün (2 Fälle) |
| Regress | `apps/pwa/test` komplett | grün (65 Dateien, 433 Tests) |
| Offen | echter Dreh auf Kais installierter App | steht aus — Panel zeigt nach dem nächsten Öffnen, was das Gerät glaubt |

Der E2E-Harness blockiert Service Worker per Grundkonfiguration
(`playwright.config.ts`, `serviceWorkers: "block"`); der zweite Fall öffnet deshalb
einen eigenen Kontext mit erlaubten Workern.

## Schrittstand

- [x] Manifest-Cache im Worker nachgewiesen (Tabelle oben)
- [x] Worker-Stufe angehoben, Manifest raus aus dem Vorlade-Set, alte Exemplare werden geraeumt
- [x] Stand auf dem Geraet ablesbar gemacht
- [x] Guards + E2E
- [ ] Drehen auf Kais installiertem App-Startsymbol nachziehen (Entfernen + Neuanlegen kann nötig sein)
