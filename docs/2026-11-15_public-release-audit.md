# Audit vor der öffentlichen Veröffentlichung — 15.11.2026

Basis: `main` @ `1e5db943`, read-only Scan (Secrets/PII über die volle
Historie, Bugs/Epics, toter Code, Doku), Gates lokal unter Node 22.17 und 24
auf macOS. Umsetzung der Befunde auf Branch `chore/public-release`, danach
Veröffentlichung als gesquashte Historie. Eingefrorener Snapshot.

## Ergebnis

Keine echten Secrets in Arbeitsbaum oder Historie (1.512 Commits; Muster für
API-Keys, GitLab/GitHub-Tokens, Private Keys, `.env`, Hub-Token-Format). Nur
markierte Test-Werte. Zu bereinigen waren persönliche und
Infrastruktur-Daten, Lizenz-Lücken und Altlasten.

## Blocker (vor dem Veröffentlichen)

| # | Befund | Umsetzung |
|---|---|---|
| 1 | Private Autoren-E-Mail und Hostname in allen Commits | Veröffentlichung mit gesquashter Historie |
| 2 | Echte Tailnet-IP (19 Dateien), Tailnet-Name (9), SSH-Ziele, Home-Pfade, private Verzeichnisstruktur, Hostnamen | durch Dokumentations-Platzhalter ersetzt (`100.64.0.x`, `<tailnet>.ts.net`, neutrale Hostnamen) |
| 3 | Self-hosted CI-Runner auf dem Arbeitsplatz-Host, Runner-Details in Doku | Runner-Details entfernt; Runner-Schutz (protected branches, keine Fork-Pipelines, Pipeline-Sichtbarkeit) ist GitLab-UI-Aufgabe |
| 4 | `LICENSE` ohne Lizenzgeber-Notice | `Required Notice` ergänzt, kommerzielle Nutzung nur mit Erlaubnis dokumentiert |
| 5 | `@ancientvoid/contracts` exportiert fünf seit ADR-0020 gelöschte Dateien | Exports auf die Modulpfade umgestellt |
| 6 | Claude-Fixtures enthielten die Liste verbundener Account-Integrationen und Skills | Arrays geleert |

## Bugs und Tests

- Offen: BUG-0153 (Wizard lässt `projectRoots` leer), BUG-0163 (CI-Tests),
  BUG-0121 (Phone-E2E-Timeout, nur am echten Gerät reproduzierbar).
- Veraltete Status: BUG-0126/0154 `open` trotz Fix; 0157/0159 `fixed`;
  0081–0083 ohne Frontmatter. Index: 18 fehlende Zeilen, BUG-0115 doppelt,
  falsche „nächste freie Nummer“.
- Lokal (macOS, Node 24): 46 Testfehler in 20 Dateien — GNU-`du -sb`,
  `tar --directory`, `/var`↔`/private/var`, fehlende Tools (`tmux`,
  `magick`, `tesseract`) ohne sichtbaren Skip. Unter Node 22.17 zusätzlich
  Strip-Types-Fehler (unter dem `engines`-Minimum).
- `npm audit`: 11 Schwachstellen (2 hoch: `body-parser`, `zod`), per
  `npm audit fix` behebbar. Umgesetzt; fastify bleibt per `overrides` auf
  5.12.5 gepinnt (BUG-0167: neuere Version macht eine E2E-Spec flaky; die
  offene Advisory betrifft Header-Schemas, die der Hub nicht nutzt).

## Altlasten

- Keine echten TODO/FIXME, kein `@ts-ignore`, kein `.only`; alle Skips
  umgebungsabhängig mit Grund.
- knip: 67 ungenutzte Exports, 49 ungenutzte Typen, 81 „unlisted“
  (Workspace-Nachbarn in Tests nicht deklariert) — report-only.
- Veraltete Paketnamen (`@ancientvoid/server` → `@ancientvoid/hub`),
  uacc-Reste in CONTRIBUTING/Fleet-Doku, doppeltes `workflow:` in der CI,
  `examples/` nicht typgeprüft.
- Migrations-Shims für Alt-Installationen (team-store, Lock-Format,
  tmux-Log, Presets, Run-Hash) — bewusst behalten.

## Erster Eindruck

README rein deutsch und mit internem Statuslog; veraltete Aussagen (P11
„nicht umgesetzt“), tote Links in Nachbar-Checkouts (VoidWarden ist ein
separates, nicht öffentliches Projekt). Fehlend: `SECURITY.md`,
Verhaltenskodex, Issue-Templates, `repository`-Metadaten, `private: true`
in Workspace-Paketen. App-Oberfläche ist deutsch → eigenes Epic für
Mehrsprachigkeit.
