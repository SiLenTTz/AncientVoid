---
id: BUG-0099
slug: uebersicht-scrollt-als-ganze-seite
status: open
severity: S2
area: pwa
instance: live (Nutzerbericht 06.11.2026, installierte Omarchy-Web-App)
commit: "acff1767"
epic: ""
created: 2026-11-06
reporter: "Nutzer"
---

# BUG-0099 — Übersicht scrollt als ganze Seite statt in der Session-Liste

## Gesehen (Nutzerbericht 06.11.2026)

Die App ist als Omarchy-Web-App (installiertes PWA-Fenster) in Benutzung:
„Die App/Seite an sich sollte nicht scrollen müssen! Nur die Session-Liste
und der Chat innerhalb der Session!" In der Übersicht wächst die
Session-Liste als normaler Seiteninhalt — der **Body** scrollt, das
App-Fenster zeigt einen Scrollbalken am rechten Rand. In der Session-Ansicht
scrollt (seit BUG-0097/0098) nur der Chat; die Übersicht fehlt.

## Erwartet

Als installierte App scrollt das Fenster nie: Die Übersicht listet Sessions
in einer eigenen Scroll-Fläche zwischen Topbar und Dock (wie der Chat
zwischen Kopfzeile und Dock). Nebenseiten (Einstellungen, Status, Medien …)
bleiben unberührt.

## Repro

E2E `overview-shell.spec.ts` (mobile): 18 Sessions, dann
`scrollingElement.scrollHeight > clientHeight` (Fenster scrollbar — ohne
Fix rot) und `.dashboard` intern scrollbar; die letzte Karte bleibt per
Listen-Scroll erreichbar.

## Ursache

`App.tsx` rendert die Übersicht als normalen Seiteninhalt (`.app-page` >
`.dashboard`) — kein Shell-Layout: Der Body wächst mit der Liste, der
fixierte Dock wird nur per `padding-bottom: 78px` freigehalten.

## Fix

Nur für die Dashboard-Route (per `:has(> .dashboard)`, kein JS): `.app-page`
wird zur Spalte mit Fensterhöhe (`100dvh / --ui-zoom`), `.dashboard` füllt
den Rest und scrollt intern — der Platz für den fixierten Dock bleibt als
unteres Padding der Liste. Lens-Scrollbar-Stile wie für den Chat.

## Nachweis

Siehe MR.
