---
id: BUG-0015
slug: offline-reload-token-gate
status: done
severity: S2
area: pwa
instance: dev
commit: "80f8696"
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/11"
epic: "EPIC-P0 AC-P0-4 (K10); EPIC-P8 T8.2"
created: 2026-09-21
reporter: "Codex, Remote-Control-Audit"
---

# BUG-0015 — Offline-Neuladen zeigt Anmeldung statt gecachter Sessions

## Gesehen

Nach erfolgreichem Login und Laden der Session-Liste erscheint bei Offline-
Neuladen die Token-Anmeldung statt des zuvor geladenen Dashboards.

## Erwartet

K10: vorhandene letzte Projektion mit ursprünglichem Datenzeitpunkt zeigen.
Ohne Netz keine erneute Token-Eingabe verlangen und keine Mutation ausführen.

## Repro

1. PWA bauen (`npm -w @uacc/pwa run build`) und in sauberem Chromium-Profil
   gegen einen isolierten Hub mit temporärer DB und einer Dummy-Session öffnen.
2. Gültigen Test-Device-Token im UI eingeben, „Verbinden“ und Session-Liste öffnen.
3. Auf Service-Worker-Bereitschaft warten; online neu laden und sichtbare
   `.session-card` abwarten. Damit sind Shell und Session-Projektion geladen.
4. Browserkontext offline setzen (Playwright `context.setOffline(true)` oder
   DevTools Network Offline), Seite neu laden.
5. Sichtbare Oberfläche prüfen.

**Ergebnis:** „UACC Hub“, „Device-Token“, „Verbinden“; keine Session-Liste.
**Häufigkeit:** einmaliger vollständiger Browser-Repro im Audit; kein
physischer Flugmodus-Test auf einem Handy.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | isolierter Hub auf Loopback, zufälliger Port, keine Produktivdaten |
| Commit | `80f8696`, PWA frisch gebaut |
| Node | 26.7.0 |
| Browser | Chromium 151.0.7922.173, Playwright, 390×844 |
| Adapter | dummy |
| Repro-Weg | echte PWA, Login über sichtbares Eingabefeld |

## Logs

Browser-DOM des Auditlaufs, Beginn 2026-09-21T20:14:16.839Z, danach Offline-
Reload im selben Lauf. Kein Token oder echter Chat-Inhalt gespeichert:

```text
Vorher: UACC / Heute: $0 / dummy / working / Übersicht
Nach Offline-Reload:
UACC Hub
Device-Token eingeben (wird beim Start des Hubs via hubctl token issue erzeugt).
Device-Token
Verbinden
```

## Tests

Bestehende Unit-/Contract-Suite bestand im ursprünglichen Arbeitsbaum mit
325 Tests trotz des Fehlers. Kein Offline-Reload-Browsertest in der Suite.
Vorgeschlagener Regressionstest: echtes Service-Worker-Profil online einrichten,
Sessions laden, offline neu laden, cached Session + Stale-Badge assertieren;
anschließend Reconnect und Tokenwechsel mit getrennten Cache-Daten prüfen.
Implementierung im `bugfix`-Folgeauftrag, nicht in diesem Planungs-Diff.

## Eingrenzung

`packages/pwa/src/main.tsx`: `Main` beginnt mit `ready=false`; die initiale
`hubApi.adapters()`-Prüfung setzt bei jedem Fehler `ready=false`.
`packages/pwa/public/sw.js`: `CACHEABLE_API_PATTERNS` enthält Sessions und
Usage, aber keinen Offline-Pfad für diese initiale Adapter-Prüfung.
Das ist die zum Repro passende Code-Eingrenzung, kein ausgeführter Fix.

Separater Prüfpunkt für T8.2: der Service Worker setzt `X-UACC-Cached-At` auf
die aktuelle Auslieferungszeit; damit ist der ursprüngliche Datenzeitpunkt
nicht zuverlässig abgebildet. Dieser zweite Befund ist hier nur Code-Review.

## Handoff

- [x] Datei im Index.
- [x] GitLab-Issue [#11](https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/11) angelegt.
- [ ] Fix über `bugfix`; blockiert ursprüngliche K10-Abnahme.

## Behebung (2026-09-24, EPIC-P8 T8.2)

**Root-cause:** `apps/pwa/src/app/main.tsx` prüfte beim Start das Token mit
`/api/adapters`. Diese Antwort lag nicht im Service-Worker-Cache, offline kam
503. Jeder Fehler führte zu `setReady(false)` und damit zur Token-Eingabe.

**Fix:**
- Nur 401/403 gelten als falsches Token (`isAuthError`); offline startet mit
  vorhandenem Token auf dem Cache.
- Der Service Worker cached Übersicht (`/api/fleet`), Adapter, Session und
  Meldungen in einem eigenen Cache und liefert offline die **Speicherzeit**
  (`X-UACC-Stored-At`), nicht „jetzt“.
- Offline ist Senden gesperrt, der Entwurf bleibt.

**Test:** E2E `workspace.spec.ts` „BUG-0015/AC-P8-2 …“ mit echtem Service
Worker. Ablauf: offline neu laden, Übersicht und Session sichtbar,
Zeitstempel vom Abruf, keine Mutation.
