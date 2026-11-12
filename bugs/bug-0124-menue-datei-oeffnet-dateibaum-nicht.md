---
id: BUG-0124
slug: menue-datei-oeffnet-dateibaum-nicht
status: done
severity: S3
area: pwa
instance: dev (Nutzerbefund 11.11.2026)
commit: "efaa952"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/393"
epic: "P43"
created: 2026-11-11
reporter: "Nutzer"
fixed: 2026-11-12
---

# BUG-0124 — „Mehr → Datei“ öffnet den Dateibaum nicht, Tab zeigt nur einen Knopf

## Gesehen

„Datei“ im Menü „Mehr“ wechselt nur den Tab. Ohne geöffnete Datei steht dort allein „Dateibaum öffnen“.

## Erwartet

Der Dateibaum öffnet sich rechts als Liste (wie in VS Code); die Fläche zeigt Editor/Dateiansicht.

## Fix

`SessionTail.tsx`: Menüpunkt ruft `openLayer("files")`; leerer Datei-Tab rendert die `CodePane` (MR !393).

## Tests

`kleinkram.spec.ts` (Regel 2) und `funktionsinventar.spec.ts` (S06) prüfen jetzt Sidebar und `.code-pane`.
