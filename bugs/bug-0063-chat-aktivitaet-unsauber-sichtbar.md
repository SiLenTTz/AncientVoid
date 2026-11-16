---
id: BUG-0063
slug: chat-aktivitaet-unsauber-sichtbar
status: done
severity: S3
area: pwa
instance: dev
commit: "995f2df"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/18"
epic: ""
created: 2026-10-21
reporter: nutzer (Handy)
---

# BUG-0063 — Im Chat ist nicht sichtbar genug, ob der Agent aktiv ist

## Gesehen

In der Übersicht erkennt man eine arbeitende Session sofort (animierter laufender Rahmen, `st-working`); innerhalb der Session-Ansicht (Chat) fehlt jedes äquivalente Signal — der Status-pill ist ein statisches farbiges Kärtchen, das im laufenden Betrieb nicht von „idle“ zu unterscheiden ist, wenn man nicht genau hinsieht.

## Erwartet

Die Session-Ansicht zeigt „Agent arbeitet gerade“ mit derselben Klarheit und derselben Animationssprache wie die Übersicht (laufender Licht-Ring), auch für `waiting_approval` (Warnfarbe).

## Repro

Voraussetzung: eine Session im Status `working` (hier: dieselbe Live-Session `b66c47db…`).

1. Übersicht öffnen: Karte der Session hat den laufenden Rahmen (`ancientvoid-border-chase`, sichtbar in Bewegung).
2. Session öffnen (Chat): der Pill `.session-topbar .pill.working` (`SessionTail.tsx:512`) ist statisch — keine Bewegung, kein Puls.

**Ergebnis nach Schritt 2:** Kein Bewegungssignal im Chat; der Status ist nur lesbar, nicht sichtbar.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `995f2df` |
| Node-Version | 26.7.0 |
| Adapter | beliebig |
| Repro-Weg | PWA (Übersicht vs. Session-Ansicht verglichen) |

## Logs

Keine beteiligt (rein visuelles Verhalten). CSS-Beleg: die Chase-Animation existiert nur für `.session-card.st-working` und `.btn.busy` (`03-session-cards.css:33` bzw. `:95`), nicht für den Pill der Session-Ansicht.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | — | nicht vorhanden (CSS) |
| E2E | `e2e/specs/*` (statusPill) | prüft nur `data-status`, nicht die Sichtbarkeit von Aktivität |

Vorschlag: E2E-Erweiterung in `e2e/specs/harness.spec.ts` — während `working` trägt der Session-Pill die Chase-Klasse/`::after`-Animation (per CSS-Pseudostatus testbar über class-Check `.pill.working`), plus `prefers-reduced-motion`-Absicherung bleibt dem CSS vorbehalten.

## Eingrenzung

`apps/pwa/src/app/styles/03-session-cards.css` — die bestehende `ancientvoid-border-chase`-Animation ist nicht auf `.pill.working` / `.pill.waiting_approval` in der Session-Ansicht angewendet.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt ([#18](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/18))
- [x] `bugfix` (im selben Lauf beauftragt)
