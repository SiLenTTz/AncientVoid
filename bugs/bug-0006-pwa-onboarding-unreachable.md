---
id: BUG-0006
slug: pwa-onboarding-unreachable
status: done
severity: S1
area: server
instance: dev
commit: ""
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/6"
epic: EPIC-P1
created: 2026-09-15
reporter: "Claude Sonnet 5 (Session 012Ga2NDi683xR9E63StoN7T)"
---

# BUG-0006 — Eine neue PWA konnte den Onboarding-Flow nie durchlaufen

## Gesehen

Beim visuellen Test des T1.5-Monitor-Dashboards (`packages/pwa/src/Dashboard.tsx`)
über einen echten (Playwright-gesteuerten) Browser: ein frischer Browser
ohne gespeicherten Token konnte die PWA **nicht laden** —
`GET /` lieferte `401 {"error":"missing device token"}`, noch bevor
überhaupt JavaScript ausgeführt wurde. Zwei zusammenhängende Ursachen:

1. `authHook` (`packages/server/src/auth.ts`) schützte **jeden** Pfad
   außer `/api/health` — inklusive `index.html`, dem JS/CSS-Bundle,
   Manifest und Service Worker. Ein `?token=`-Query-Parameter in der URL
   funktioniert nur für das **eine** Dokument, das ihn trägt — ein
   `<script src="/assets/index-xxx.js">`, das dieses Dokument referenziert,
   trägt die Query-String des Elterndokuments nicht automatisch weiter.
   Verifiziert: `curl ".../?token=X"` → 200, aber
   `curl ".../assets/index-xxx.js"` (ohne Token) → 401.
2. Selbst mit gefixtem (1): `main.tsx`s Bereitschafts-Check und
   `TokenGate`s eigene Validierung riefen beide `hubApi.health()` auf —
   der einzige Endpunkt, der **absichtlich** ohne Token offen ist
   (Tailnet-Monitoring). Das bedeutet: die Prüfung "ist mein Token
   gültig?" gelang **immer**, unabhängig davon, ob überhaupt ein Token
   existierte. `TokenGate` konnte dadurch faktisch nie erscheinen bzw.
   akzeptierte jeden (auch leeren/falschen) Token als "verbunden" — die
   eigentlichen (geschützten) API-Aufrufe scheiterten danach mit 401.

## Erwartet

Ein neues Gerät öffnet die PWA-URL, sieht das `TokenGate`-Formular, gibt
den per `hubctl token issue` erzeugten Token ein, und landet danach im
funktionierenden Dashboard (README Quick-Start-Versprechen).

## Repro

1. Hub lokal starten, `pwaDir` auf das gebaute `packages/pwa/dist`
   zeigen lassen, Token per `hubctl token issue` ausstellen.
2. Frischer Browser (kein `localStorage`-Eintrag), URL ohne `?token=`
   öffnen.

**Ergebnis vor dem Fix:** `GET /` → 401, weißer/leerer Bildschirm — kein
Weg, überhaupt an das `TokenGate`-Formular zu kommen. Selbst mit `?token=`
im Link: das Dokument lädt, aber das referenzierte JS-Bundle 401t separat,
also bleibt die Seite unfertig gerendert.

**Häufigkeit:** immer — kein Zufall, zwei zusammenwirkende
Architekturfehler.

## Logs

```text
GET / -> 401 {"error":"missing device token"}
GET /assets/index-BCaM-UmS.js -> 401 (selbst wenn das Dokument über ?token= geladen wurde)
```

## Eingrenzung

- `packages/server/src/auth.ts:33-42` (`authHook`) — schützte alles außer
  `/api/health`, statt alles außer `/api/*`.
- `packages/pwa/src/main.tsx:13-25` (`TokenGate.submit`) und `:56-62`
  (`Main`s Bereitschafts-Check) — beide riefen `hubApi.health()` statt
  eines token-geschützten Endpunkts auf.

## Fix

1. `authHook`: Ausnahme erweitert von `/api/health` auf „alles außerhalb
   von `/api/`" — die statische PWA-Hülle ist öffentlich (wie das
   Installationsartefakt jeder anderen App), die eigentlich geschützte
   Fläche bleibt `/api/*`.
2. `main.tsx`: beide Stellen nutzen jetzt `hubApi.adapters()`
   (token-geschützt) statt `hubApi.health()`.

Verifiziert per echtem Playwright-Lauf (kein Request-Interception-Hack):
frischer Browser → `TokenGate` erscheint → Token eingeben → „Verbinden" →
Dashboard lädt korrekt. Zusätzlich zwei Regressionstests in
`packages/server/test/server.test.ts` (nicht-`/api/`-Pfad bleibt offen,
jeder `/api/`-Pfad bleibt geschützt).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` — behoben, siehe oben.
