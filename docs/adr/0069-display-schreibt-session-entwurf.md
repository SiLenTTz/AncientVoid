# ADR-0069 — Display darf Session-Entwurf schreiben (VoidWarden-Stimme)

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/approvals/{policy,display}.ts`,
`apps/hub` Auth · **Anlass:** VoidWarden Web-Kiosk Voice → Composer-Entwurf
(Schwesterprojekt BUG-0016) · **Fortschreibt:** [ADR-0048](0048-display-akteur.md),
[ADR-0025](0025-shared-drafts.md)

## Kontext

VoidWarden nimmt per Mikrofon Text auf und soll ihn im **geteilten Session-Entwurf**
(`PUT /api/sessions/:id/draft`, ADR-0025) hinterlegen — derselbe Text, den die PWA
im Composer zeigt. Der Display-Akteur darf laut ADR-0048 nur lesen und `write`-
Freigaben entscheiden; `drafts.write` war deny. Ein Entwurf ist **kein Senden**:
er füllt nur das Eingabefeld; der Mensch schickt weiterhin selbst.

## Entscheidung

1. Policy: `drafts.write` für `display` = **allow** (alle übrigen Operationen
   bleiben deny, ADR-0048 sonst unverändert).
2. Route-Grenze `displayTokenAllows`: zusätzlich
   `GET|PUT /api/sessions/:id/draft`.
3. Kein Auto-Steer, kein Prompt an den Agenten vom Display — nur Entwurf.
4. Audit: `device` am Entwurf bleibt das Token-Label (`display:<name>`), wie
   bei menschlichen Geräten.

## Konsequenzen

- Tests in `policy.test.ts` (Tabelle + Routen) anpassen.
- VoidWarden Companion schreibt Entwürfe mit dem Display-Token
  (`decideTokenFile`).
