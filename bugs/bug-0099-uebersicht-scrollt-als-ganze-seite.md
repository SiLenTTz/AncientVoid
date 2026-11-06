---
id: BUG-0099
slug: uebersicht-scrollt-als-ganze-seite
status: done
severity: S2
area: pwa
instance: live (Nutzerbericht 06.11.2026, installierte Omarchy-Web-App)
commit: "5d879829"
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

## Nachtrag (06.11.2026, Nutzerbericht „Scrollbar bei nur 4 Sessions")

Das Dock-Padding von 86 px lag INNERHALB der scrollenden Liste und war damit
scrollbarer Leerraum unter der letzten Karte — bei wenigen Sessions
erschien eine Scrollbar, obwohl alle Karten sichtbar waren, und beim
Scrollen lief man 86 px „ins Leere". Außerdem hielt die Übersicht 86 px
frei, obwohl auf ihr nur der GlobalDock (~64 px) steht — die
Session-Steuerung gehört zur Session-Seite. Korrigiert: Freiraum als
Padding der Shell-Spalte außerhalb des Scroll-Inhalts, auf die echte
GlobalDock-Höhe (64 px + Safe-Area) verkleinert. E2E-Nachtrag rot-dann-grün
(4 Sessions, 412×710): alt rot (Liste scrollbar trotz sichtbarer Karten),
neu grün (583/583, kein Leerraum).
