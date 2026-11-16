# ADR-0082: Deployment der Promo-Seite nach void.securesight.ai

**Status:** angenommen (2026-11-16) · **Epic:** [EPIC-P62](../../epics/EPIC-P62-public-guide-videos-promo.md) (T62.7)
· **Ersetzt:** — · **Verwandt:** [ADR-0081](0081-paralleles-schreiben-in-ordnern-ohne-git.md) (Nummernnachbar, kein fachlicher Bezug)

## Kontext

EPIC-P62 verlangt eine Promo-Seite (`apps/site`) unter `void.securesight.ai`,
deployt aus der CI auf `main`, ohne manuellen Zwischenschritt. Die Domain
`securesight.ai` gehört dem Betreiber; das Repo liegt auf GitHub.

## Entscheidung

**GitHub Pages** mit Custom Domain `void.securesight.ai`.

- **Warum Pages:** die Seite ist rein statisch (eine HTML-Seite, eine
  `content.json`), Pages braucht keinen weiteren Dienst, keine
  Zugangsdaten im Repo und liefert HTTPS erzwungen. Alternative war
  Cloudflare Pages — abgelehnt, weil es einen zweiten Betriebsherd für
  genau null Mehrwert der statischen Seite bedeutet.
- **Fallback bis zum DNS-Umzug:** die github.io-URL
  (`<org>.github.io/AncientVoid`) ist sofort live und prüfbar; die CI
  deployt unabhängig vom DNS-Fortschritt. Die Seite gilt als „live“, sobald
  der Deploy-Job grün ist — `void.securesight.ai` ist Anbindung, keine
  Voraussetzung (Premortem-Punkt 6).
- **DNS ist Nutzeraufgabe:** CNAME `void` → `<org>.github.io.` beim
  Domain-Inhaber. Der Job deployt die CNAME-Datei nicht selbst — Pages
  übernimmt die Domain-Konfiguration einmalig manuell durch den Betreiber
  (dokumentiert, bewusst kein Automatismus um DNS-Besitz).
- **Job (`site-deploy.yml`):** nur `main`, nur wenn `apps/site/**` oder der
  Workflow selbst sich ändert; Actions per SHA gepinnt (wie `ci.yml`,
  Fork-Sicherheit); `permissions: pages: write, id-token: write,
  contents: read`; kein Secret.
- **Lighthouse-Gates im Job (eigene Budgets, K1–K10 betreffen den Hub):**
  Mobile **Performance ≥ 90** und **Accessibility ≥ 95** gegen den gebauten
  Stand, lokal im Runner gemessen — Unterschreiten = rot, kein Pass mit
  Sternchen. Messung im Runner statt gegen die Live-URL: deterministischer,
  kein DNS/Netz-Rauschen im Gate.

## Konsequenzen

- Betreiber einmalig: Custom Domain in den Pages-Einstellungen setzen +
  CNAME-Record anlegen (bis dahin gilt die github.io-URL).
- Seite bleibt statisch und einspaltig einfach (Premortem-Punkt 4);
  Inhalte ausschließlich über `apps/site/src/content.json` pflegen.
- Rechtshinweis-Block bleibt Platzhalter bis zur inhaltlichen
  Nutzerentscheidung (Betreiberangaben).
