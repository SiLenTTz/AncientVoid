# ADR-0086: Lizenz wechselt auf AGPL-3.0-only plus kommerzielle Lizenz

**Status:** vorgeschlagen (2026-11-17), wird mit dem Merge durch den Rechteinhaber angenommen · **Epic:** — (Veröffentlichung, Nutzerauftrag 17.11.2026)
· **Ersetzt:** die Lizenzentscheidung aus EPIC-P4 T4.8 (PolyForm Noncommercial 1.0.0) · **Verwandt:** [ADR-0082](0082-promo-seite-github-pages.md) (Promo-Seite)

## Kontext

AncientVoid wurde am 15.11.2026 unter PolyForm Noncommercial 1.0.0
veröffentlicht. Ziel ist jetzt, möglichst viele Entwickler zu erreichen. Alle
direkten Wettbewerber mit großer Reichweite verwenden eine OSI-anerkannte
Lizenz: Paseo (Apache-2.0), T3 Code (MIT), Orca (MIT), Happy (MIT),
CloudCLI (AGPL-3.0). PolyForm NC hat drei belegbare Nachteile:

- Das Projekt darf sich nicht „Open Source“ nennen. Bei Show HN, Reddit oder
  Awesome-Listen wird die Lizenz damit zum Hauptthema statt des Produkts.
- awesome-selfhosted nimmt nur freie Software in die Hauptliste auf,
  source-available landet auf der Non-Free-Liste.
- Firmen dürfen es ohne Einzelvertrag nicht einmal intern ausprobieren.
  Genau diese Entwickler wären aber die Multiplikatoren.

Der Betreiber will trotzdem verhindern, dass jemand AncientVoid als
geschlossenen Hosting-Dienst anbietet. Außerdem soll eine kommerzielle
Lizenz verkaufbar bleiben.

## Entscheidung

**AGPL-3.0-only für alle, dazu eine separate kommerzielle Lizenz vom
Rechteinhaber (Dual-Licensing).**

- `LICENSE` enthält den unveränderten AGPL-3.0-Text, damit GitHub die Lizenz
  erkennt. Copyright-Vermerk und Dual-Licensing-Hinweis stehen in `README.md`.
- `-only` statt `-or-later`, nach dem Vorbild von Grafana: Über künftige
  Lizenzversionen entscheidet der Rechteinhaber, nicht automatisch die FSF.
- Alle `package.json` tragen `"license": "AGPL-3.0-only"` (SPDX).
- **Beiträge:** Wer beiträgt, lizenziert seinen Beitrag unter AGPL-3.0-only
  und räumt dem Rechteinhaber zusätzlich das Recht ein, ihn auch unter
  kommerziellen Bedingungen weiterzulizenzieren (`CONTRIBUTING.md`). Ohne
  diese Klausel könnten fremde Beiträge nicht in die Kauflizenz einfließen.
  Die DCO-Zeile (`Signed-off-by`) bleibt als Erklärung bestehen.

Verworfen:

- **MIT/Apache-2.0:** größte Verbreitung, aber Hosting-Klone sind erlaubt und
  eine Kauflizenz ergibt keinen Sinn.
- **FSL/BUSL:** schützt zwei bis vier Jahre vor Wettbewerb, ist aber nicht
  OSI-anerkannt. Damit bleibt das Akzeptanzproblem von PolyForm in kleinerer
  Form bestehen.
- **PolyForm NC beibehalten:** maximale Kontrolle, aber das oben beschriebene
  Reichweitenproblem.

## Konsequenzen

- README, Promo-Seite und Launch-Texte dürfen „open source (AGPL-3.0)“
  sagen. Topic `open-source` und Awesome-Listen werden möglich.
- **Vor dem Merge:** Alle Personen, die Commits in der Historie haben,
  müssen der Neulizenzierung zustimmen. Nach `CONTRIBUTING.md` waren
  Beiträge bisher „inbound = outbound“ unter PolyForm NC lizenziert.
  `git shortlog -sn` zeigt am 17.11.2026 vier menschliche
  Autoren-Identitäten plus Dependabot. Ob sie zu einer oder mehreren Personen
  gehören, klärt der Rechteinhaber vor dem Merge. Wer schon eine Kopie unter
  PolyForm NC bezogen hat, behält diese Rechte für genau diese Fassung.
- Die Beitragsklausel in `CONTRIBUTING.md` ist ein knapper Entwurf. Vor dem
  ersten externen Beitrag sollte sie juristisch geprüft oder durch eine
  CLA ersetzt werden (z. B. CLA Assistant).
- Die AGPL-Pflicht aus §13 betrifft nur, wer AncientVoid **verändert** und
  über ein Netzwerk anbietet. Selbsthosting für eigene Agenten löst keine
  Offenlegungspflicht aus.
