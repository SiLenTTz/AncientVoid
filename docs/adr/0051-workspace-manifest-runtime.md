# ADR-0051 — Workspace-Manifest-Runtime: Verträge, Vertrauensgrenze, Migrationsregel

**Status:** vorgeschlagen (Abnahme vor T29.2, EPIC-P29 DoD) · **Betrifft:**
`packages/contracts/src/workspace/` (neu), Core-Workspace-Modul
(`packages/core/src/modules/workspace/`), Workspace-Routen
(`apps/hub/src/modules/workspace/`), PWA `apps/pwa/src/features/workspace/`
(neu), hubctl · **Quelle:** EPIC-P29, [Paseo-Analyse §5](../2026-11-05_paseo-vs-ancientvoid.md)

## Kontext

Zwei parallele Sessions desselben Projekts sollen unabhängig nutzbare
Entwicklungsumgebungen bekommen: deklaratives Setup, ausgewählte lokale
Dateien, Services mit getrennten Ports, vom Handy sichtbar. Bestand:
`WorktreeManager` (T2.1: Branch/Worktree/Basis-SHA/Quota), `worktree-hygiene`
(P14: konservatives Cleanup), `apply` (ADR-0016: Übernahme in das Projekt) und
der Guard im SessionManager, der Loops, Factory-Treibern (`workInProject`) und
In-Place-Adoption bewusst **keinen** Worktree gibt. P29 erweitert diesen
Bestand — kein zweiter Worktree-Manager, keine Layout-Migration.

## Entscheidung

1. **Manifest.** `ancientvoid.workspace.json` mit `schemaVersion: 1`, strict
   geprüft — unbekannte Felder oder Version fail loud (kein Start, kein
   Stillstand-Verharren). `setup`/`teardown` sind benannte argv-Schritte mit
   eigener Frist (cwd ist immer die Worktree-Wurzel), `include` eine relative
   Dateiliste, `services` Einträge mit ID, argv, optionalem Port
   (`number` = Fixport, `"auto"`/fehlt = Vergabe durch den Hub) und optionalem
   HTTP-Readiness-Pfad. Keine Shell, keine Interpolation; Shell nur als
   explizit genehmigtes Programm mit Argumenten. Exakte Felder und Grenzen:
   `packages/contracts/src/workspace/manifest.ts`.
2. **Vertrauensgrenze.** Das Manifest wird an der beim Sessionstart
   festgehaltenen Basis-SHA gelesen (`git show <baseSha>:…`), nie aus dem
   beweglichen Arbeitsverzeichnis; sha256 des Manifests ist der Manifest-Hash.
   Erste Ausführung und jeder geänderte Hash brauchen eine menschliche
   Freigabe über die Actor-Policy (ADR-0021: Mensch entscheidet, Agent stellt
   nur Antrag). Die Freigabe zeigt Projekt, Basis-SHA, Manifest-Hash und das
   geparste Manifest (Schritte, Include, Services) — nie Dateiinhalte.
   Agentenausgabe kann keine Schritte registrieren. `.env`-Übernahme ist Teil
   der genehmigten Include-Liste; Inhalte bleiben außerhalb von Events/Logs.
3. **Zustände.** Laufzeit: `preparing → ready | failed`; `needs_attention`
   markiert unklaren Nebenwirkungszustand (Crash nach externem Effekt) — kein
   automatisches Re-Run, Retry nur menschlich über eine persistente Operation
   (ADR-0019-Muster: `dispatching`-Crash → uncertain/`needs_attention`).
   Archivierung separat: `tearing_down → archived | cleanup_failed`.
   Services: `starting | ready | failed | stopped | probing` (`probing` =
   Readiness wird nach K7-Restore asynchron geprüft, blockiert den Restore
   nicht).
4. **Ports und Ownership.** Ports werden je Host vergeben und persistiert.
   Fixport-Kollision → `failed` mit Grund; fremde Prozesse werden nie
   beendet — die Portnummer ist kein Eigentumsnachweis. Auto-Port bekommt ein
   begrenztes Retry nur für Bind-Races. Dienste binden an Loopback. Ownership
   ist der persistierte Satz {serviceId, sessionId, pid, argv, port,
   startedAt} plus Umgebungsmarker `ANCIENTVOID_WORKSPACE_SESSION_ID` beim
   Start; adoptiert/gestoppt wird nur nachgewiesen eigener Besitz.
5. **K5/K7.** `workspace.*`-Events bleiben ≤ 4 KB: Fehler nennen Schritt,
   Exitcode/Timeout und eine Blob-Referenz für Logs; Detailtexte sind im
   Vertrag gekappt (`MAX_WORKSPACE_DETAIL_CHARS`). Die Workspace-Projektion
   ist ausschließlich aus JSONL + Snapshot faltbar (Basis-SHA, Manifest-Hash,
   Phase, Operations-ID, Service-Ownership/Ports); Restore < 3 s (K7),
   Readiness-Probes danach asynchron.
6. **Mobiler Service-Zugang (Vertrag jetzt, Ausbau T29.6).** Zugriff vom Handy
   nur über eine authentifizierte Hub-Route auf genau den registrierten
   HTTP-Service (Loopback-Ziel, begrenzter Pfad, Origin-Prüfung, explizite
   WS-Upgrade-Regeln) — kein freier URL-Parameter, kein Open Proxy. Bis das
   sicher abnehmbar ist, bleibt der mobile Zugang blockiert.
7. **Migrationsregel.** Bestehende `data/worktrees/<sessionId>` werden nicht
   migriert; das Layout bleibt. Ohne Manifest gilt unverändert der T2.1-Pfad:
  Worktree, kein Setup, keine Services, keine `workspace.*`-Events. Bestehende
   Sessions erhalten keinen Workspace-Status. Prune/Reap bleiben unangetastet;
   P14 bleibt die letzte Löschbarriere — Archivierung stoppt eigene Services,
   führt den genehmigten Teardown aus und nutzt dann die P14-Prüfungen; bei
   Dirty/Unknown/Teardown-Fehler bleibt der Worktree mit Grund erhalten.
   `apply` (ADR-0016) ist weiterhin Nutzerverantwortung und ersetzt nicht den
   MR-Workflow dieses Repos.
8. **P26-Regel.** Workspace-Setup hängt ausschließlich an worktree-isolierten
   Sessions. Loop-Adapter (Beobachter), Factory-Treiber (`workInProject`) und
   In-Place-Adoption bekommen nie ein zweites Setup im Projekt — der
   bestehende Guard in `session-manager.ts` (`isLoopAdapter` / `workInProject`
   / `adoptsInPlace`) bleibt die eine Stelle. Gepinnt von
   `packages/core/test/modules/workspace/manifest-absent.test.ts`,
   `apps/hub/test/modules/loops/loops.test.ts` und
   `apps/hub/test/factory.integration.test.ts`.
9. **Einbauorte (ADR-0020).** Schemas in `packages/contracts/src/workspace/`;
   Domäne im Core-Workspace-Modul, öffentlich nur über dessen `index.ts`;
   Routen im Hub-Workspace-Routenmodul; PWA unter `features/workspace/`;
   Prozesse über die Worker-Abstraktion. Adapter sehen weiterhin nur ihren
   `AdapterContext` — kein Workspace-Zugriff aus Adaptern.

## Konsequenzen

- Manifest-/Status-Vertrag ändern sich nur additiv; Breaking Changes bekommen
  eine neue `schemaVersion` (Resolver lehnt Unbekanntes ab).
- T29.2–T29.6 setzen diese Verträge um; die Abnahme dieses ADR und der
  Contracts erfolgt vor T29.2 (EPIC-P29 DoD).
- PWA und hubctl zeigen Setup-/Service-Fehler mit Schritt, Exitcode/Timeout
  und Logreferenz; der Nutzer entscheidet über Retry, nie der Hub allein.
