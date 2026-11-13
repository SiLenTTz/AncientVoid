# EPIC-P57 — Dokumentation und Onboarding (Diátaxis, generierte Referenz, First-Run, Time-to-first-Success)

**Status:** in Umsetzung (Freigabe 13.11.2026) · **Phase:** P57
**Dauer:** 2–3 Agenten-Wochen (grobe Schätzung)
**Abhängigkeit:** P53 abgeschlossen (One-Command-Setup, README; Retro 11.11.2026) — Quer-Epic wie P50–P53, keine Laufzeit-Architektur. Die PWA-Aufgaben (T57.8–T57.9) setzen den stabilen Funktionsinventar-Stand aus P43 voraus. P33 (englischer Einstieg) bleibt vertagt und **wird hier nicht umgesetzt**.

Quelle: Nutzerauftrag vom 13.11.2026; Recherche
[`docs/2026-11-13_doku-onboarding-recherche.md`](../docs/2026-11-13_doku-onboarding-recherche.md)
(Ist-Stand, Lücken E1–E7, Quellen, Optionsvergleich). Schwester-Epic im
VoidWarden-Repo: noch anzulegen (T57.11), nach dem Muster P53 ↔ VoidWarden P14.

## 1. Ziel

Ein neuer Endnutzer kommt in **≤ 15 Minuten (Hypothese, erster Messlauf setzt
die Basis)** vom frischen Klon zum **ersten vom Handy gesteuerten Agenten**
(Standard: Nachricht per Handy an eine laufende Session gesendet und im Verlauf sichtbar; mit einem Harness, der Freigaben liefert, zusätzlich die erste Freigabe entschieden — der `dummy`-Adapter hat `toolGate: "none"` und löst keine aus), ohne Quellcode zu lesen und ohne
Agenten-Hilfe. Dafür:

1. Die Doku wird nach **Diátaxis** geordnet (jede lebende Seite hat genau eine Art);
   das fehlende **Tutorial** entsteht.
2. **Referenz wird generiert** (hubctl, Config, Wizard-Exit-Codes) statt von Hand
   gepflegt; **Doku-Drift wird im Gate sichtbar** (Ankopplung an `check:context`).
3. Die PWA führt den Erststart: Leerzustand als Einstieg, Handy-Kopplung ohne
   CLI-Zwang, sichtbares Erfolgssignal.
4. **TTFS ist messbar** (Messlauf, Ratchet).

Messlatten-Bezug (PRD §9): Keine der K1–K10 misst Onboarding. Das Epic
verankert sich deshalb an: **K1** (Approve-Latenz < 5 s — gilt für die Freigabe-Variante M5b mit echtem
Harness; der Messlauf darf K1 nicht verschlechtern), **K7**
(Hub-Neustart-How-to wird gegen K7 geprüft: Wiederanlauf identisch),
**K10** (Offline-/Leerzustand zeigt Zeitstempel, kein White-Screen) und
**PRD §8** (keine Secrets in Doku/Config, Token nur als Hash, kein öffentlicher
Port). Neue Messlatte **TTFS** wird als Epic-Messlatte eingeführt (§5), nicht
als K-Wert.

## 2. Scope (In / Out)

**In:**

- Diátaxis-Zuordnung aller lebenden `docs/*.md` und Kopfzeile je Seite
  (`Art: tutorial|how-to|referenz|erklaerung`), Prüfregel in `check:context`.
- Tutorial „Erste 15 Minuten“ (`docs/tutorial-erste-schritte.md`), eine
  Standardroute: Klon → Wizard (`dummy`) → Handy erreicht Hub → Kopplung →
  erste Session → erste Steuerung (Nachricht/Stopp; Freigabe nur mit Harness). Alternativen nur als Links.
- Wenige How-tos aus den Lücken E1–E7: Handy anbinden (Tailscale serve),
  Provider wechseln/hinzufügen, zweites Gerät koppeln/Token widerrufen,
  Wizard-Fehler lesen (Exit-Code-Tabelle für Menschen), „Brauche ich VoidWarden?“.
- Generierte Referenz: hubctl-Befehle, Hub-Config-Felder, Wizard-Exit-Codes
  (`scripts/gen-reference.mjs`, Ausgabe committed, Frischecheck im Gate).
- Ausführbare Tutorial-Beispiele: Befehlsblöcke gegen den Demo-Hub (Vorbild
  `readme-screenshots.mjs`, `e2e/support/bin`).
- PWA-Erststart: Leerzustand als Einstieg, Kopplungsweg, Erfolgssignal
  (Funktionsinventar-Zeile + E2E-Spec je Funktion).
- TTFS-Messlauf `scripts/messlauf-ttfs.mjs` + Bericht in `docs/messlauf/`.
- Split `docs/onboarding.md` (Endnutzer vs. Integratoren/Agenten) und README-Kürzung
  auf Pitch + Link zum Tutorial.
- Schwester-Epic/Abgleich im VoidWarden-Repo (nur Planung dort).

**Out:**

- **Keine Doku-Site** und keine neue Abhängigkeit in Stufe 1. Ein Site-Spike
  (VitePress zuerst) ist nur eine **Entscheidungsaufgabe** (T57.12), Umsetzung
  braucht ADR und ausdrücklichen Go.
- Kein Pflicht-SaaS, kein gehostetes Doku-Produkt, kein GitLab-Wiki (separates Repo
  = Drift-Risiko).
- Keine englische Übersetzung (P33). Keine Videos/GIFs. Keine Produkt-Tour,
  kein Pflicht-Overlay, keine Telemetrie über Nutzerverhalten.
- Kein Provider-Vorabcheck im Wizard (offener Audit-Befund,
  [`2026-11-11-setup-modelle-audit.md`](../docs/2026-11-11-setup-modelle-audit.md);
  gehört zur P53-Nacharbeit) — das Tutorial nennt die Grenze ehrlich.
- Keine Änderung an Contracts, Adaptern, EventStore. Keine neue Auth-Semantik ohne ADR
  (siehe T57.8).
- Keine VoidWarden-Code-Änderung aus diesem Repo heraus.

## 3. Design-Details

### 3.1 Abgrenzung AncientVoid ↔ VoidWarden

| | AncientVoid (dieses Repo) | VoidWarden (Schwesterrepo) |
|---|---|---|
| Rolle | Hub, PWA, hubctl, Adapter | Companion „Nyx“, Web-Kiosk, optional ESP32-Board |
| Besitzt | **Gesamt-Einstieg** (Tutorial, Handy-Kopplung, Token-Rollen-Erklärung `agent:`/`display:`), Hub-/Config-/CLI-Referenz | Kiosk-/Board-Anleitungen, Companion-Config, Voice-Setup, Messläufe W1–W15 |
| Tutorial-Ende | Weiche „Brauche ich VoidWarden?“ (Entscheidungshilfe: altes Handy/Tablet = Web-Kiosk; Board = nur Anzeige) und Verweis auf `./setup.sh --voidwarden` | Spiegelt die Weiche; Einstieg setzt einen laufenden Hub und ausgestellte Tokens voraus |
| Doku-Wahrheit | Hub-API, Token-Rollen, Contracts | Hub wird nur über HTTP-API gelesen; keine Doppel-Doku der Hub-Seite, nur Link |
| Gate | `check:context` hier | eigenes Gate dort; **kein** gemeinsames Doku-Repo, keine Laufzeitabhängigkeit |

Regel: Jede Aussage hat **einen** Eigentümer; die andere Seite verlinkt. Relative
Links ins Schwesterrepo sind nicht portabel prüfbar (`check:context` überspringt
sie) — deshalb stehen Kernsätze (Token-Rollen, Kaskade) nur im Eigentümer-Repo.

### 3.2 Diátaxis-Zuordnung

Gliederung per Kopfzeile statt Ordnerumbau (Regel: `docs/` bleibt flach).
Erste Zuordnung (im T57.1 zu bestätigen): `onboarding.md` → in zwei Seiten
splitten (Endnutzer-How-to-Folge / Integratoren-How-to); `configuration.md`,
`adapters.md`, `ci-gate-inventar.md` → Referenz (Erklärteile auslagern);
`security.md`, `architecture.md` → Erklärung; `operations-runbook.md`,
`backup-restore.md`, `fleet.md`, `ci-runbook.md` → How-to; neu:
`tutorial-erste-schritte.md` → Tutorial. Datierte Snapshots bleiben
ausgenommen (bestehende Konvention). Diátaxis wird **iterativ** angewendet
(Quelle: diataxis.fr), kein Big-Bang-Umbau.

### 3.3 Doku-Drift strukturell (drei Schichten)

1. **Generiert statt gepflegt:** `scripts/gen-reference.mjs` erzeugt
   `docs/referenz-hubctl.md` (aus der `usage`-Ausgabe von
   `apps/hubctl/src/cli.ts`), `docs/referenz-wizard.md` (Exit-Codes/Flags aus
   dem `setup.sh`-Kopf) und den Config-Feldteil. `check:context` erhält die
   Regel `reference-fresh`: committeter Stand ≠ frisch generierter Stand →
   Fehler. Config-Feldquelle wird in T57.3 geklärt (Typen in
   `packages/core/src/platform/config.ts` vs. Handtext); gibt es kein
   maschinenlesbares Schema, bleibt `configuration.md` handgepflegt und kommt
   in die Frischhalte-Map, statt ein Schema nur für die Doku zu erfinden.
2. **Geprüft statt behauptet:** Befehlsblöcke des Tutorials sind markiert
   (` ```bash tutorial-step `) und laufen im Test gegen den Demo-Hub;
   Funktionen werden per Inventar-ID referenziert
   (`funktionsinventar.md` + `funktionsinventar.spec.ts` sind schon
   gate-gekoppelt). Neue Regel `doc-kind` (jede lebende Seite hat genau eine Art).
3. **Frischhalte-Map:** Neue lebende Seiten kommen mit Ist-Drift + Luft in die
   Map (`scripts/check-context.mjs`; `onboarding`/Tutorial beobachten
   `setup.sh`, `apps/hubctl/`, `apps/pwa/src/app/`). Bestehende Regeln
   (Budget, Link, docs-ref, drift) laufen unverändert; Tests je Regel
   (`check-context.test.mjs`, positives und negatives Fixture).

### 3.4 In-App-Onboarding (PWA, klein)

Leitlinien aus der Recherche (§3.4): der Leerzustand ist die Onboarding-Fläche;
Beispielinhalt als Beispiel gekennzeichnet; keine Tour.

- **Einstieg im Leerzustand:** Statt „keine Sessions — lege eine an“ (`Dashboard.tsx:329`)
  eine kurze Anweisung, ein Knopf „Probe-Session (dummy)“ und ein Link auf das
  Tutorial; Filter-Leerzustände bleiben unverändert. Erfolgssignal nach der ersten
  Freigabe („Freigabe entschieden — Agent läuft weiter“), einmalig, schließbar.
- **Token-Gate (`main.tsx:46`):** Hilfetext verweist heute auf `hubctl token issue`.
  Ziel: Handy-Weg ohne CLI-Kopie. Varianten (Entscheidung T57.8, **neue
  Auth-Semantik → ADR, PRD §8**): (a) Token bleibt manuell, aber der Wizard druckt
  fertige Handy-URL + Hinweis, (b) einmaliger Kopplungscode analog
  `hubctl fleet invite` (10 min, Einmalgebrauch) statt Token in URLs
  (Token in URL/History ist ausgeschlossen). Standard ohne Entscheidung: (a).
- **Offline/Verbindung:** Erststart-Fehler (Hub nicht erreichbar, Token abgelehnt)
  zeigen Ursache und nächsten Schritt; Offline zeigt Zeitstempel (K10).
- Jede Funktion: Zeile im Funktionsinventar + E2E-Spec; Handy-Viewport (412) und
  Desktop; kein neuer Dauer-Zustand ohne Recovery-Pfad (K7: Onboarding-Fortschritt
  ist Gerätezustand im lokalen Speicher, nie Hub-Wahrheit).

### 3.5 TTFS-Messung

Pfad und Meilensteine M0–M5 stehen im Bericht §6. `scripts/messlauf-ttfs.mjs`
fährt kalt in frischem temporärem Checkout (`--yes --adapter=dummy`, isolierter
Datadir, Port frei wählbar), prüft M1 (`/api/ready`), M3–M5 (dummy: Nachricht senden; M5b nur mit Stand-in-Harness `claude` aus `e2e/support/bin`) über Playwright im
Mobil-Viewport und schreibt Zeiten je Meilenstein. Echtes Tailscale/Handy: einmal
manuell mit Stoppuhr, im Bericht als manuell gekennzeichnet. Ratchet: Zielwert darf
sinken, nicht steigen. Provider-Anmeldung zählt nicht in TTFS.

## 4. Aufgaben

- [x] **T57.1** Diátaxis-Inventar: jede lebende `docs/*.md` genau einer Art
  zuordnen, Kopfzeile `Art:` setzen, Gliederungstabelle in `docs/` (eine
  Übersichtsseite, die auch Waisen verhindert). Messlatte: — (PRD §8: keine Secrets).
- [x] **T57.2** `check:context` um Regeln `doc-kind` und `reference-fresh` erweitern (`doc-kind` + `doc-index` mit T57.1, `reference-fresh` mit T57.3)
  (+ Tests je Regel rot-dann-grün, Eintrag in `docs/check-context.md`). Messlatte: —.
- [x] **T57.3** `scripts/gen-reference.mjs`: hubctl-Referenz und Wizard-Exit-Codes
  generieren; Config-Quelle geklärt: zod-Schema `HubConfig` (`z.toJSONSchema`) liefert Feld/Typ/Default. Messlatte: —;
  K5 nicht berührt.
- [x] **T57.4** Tutorial `docs/tutorial-erste-schritte.md` (Standardroute, ein
  Schritt = eine Aktion + erwartete Ausgabe, endet mit Erfolgssignal und
  VoidWarden-Weiche). Messlatte: K1 (Abschnitt „Freigabe mit echtem Harness“), PRD §8 (Tailscale serve,
  kein öffentlicher Port).
- [x] **T57.5** Ausführbare Tutorial-Blöcke: Test fährt markierte Befehle gegen den
  Demo-Hub. Messlatte: K7 (Neustart-Schritt prüft Wiederanlauf).
- [x] **T57.6** How-tos: Handy anbinden, Provider wechseln, Gerät koppeln/widerrufen,
  Wizard-Fehler (Exit-Codes), Hub-Neustart/Backup-Verweis. Bestehende Runbooks
  verlinken statt kopieren. Messlatte: K7.
- [x] **T57.7** `docs/onboarding.md` splitten (Endnutzer/Integratoren-Agenten),
  README auf Pitch + Tutorial-Link kürzen, Frischhalte-Map und `epics/README.md`
  pflegen. Messlatte: —.
- [x] **T57.8** Entscheidung Handy-Kopplung (ADR): Variante (a) vs. (b) mit
  Sicherheitsabwägung. **Contract-/Auth-nah → ADR vor Code.** Messlatte: PRD §8, K1.
- [ ] **T57.9** PWA-Erststart: Leerzustand als Einstieg, Probe-Session, Erfolgssignal,
  Fehlertexte im Token-Gate; Inventarzeile + E2E-Spec; Umsetzung der in T57.8
  gewählten Kopplung. Messlatte: K1, K10.
- [ ] **T57.10** `scripts/messlauf-ttfs.mjs`, erster Messlauf, Bericht in
  `docs/messlauf/JJJJ-MM-TT-ttfs.md` (Skill `messlauf`). Messlatte: TTFS (Epic), K1.
- [ ] **T57.11** VoidWarden-Abgleich: Schwester-Epic dort anlegen (Planung; **angelegt 13.11.2026:** [VoidWarden P15](https://gitlab.com/SiLenT_Tz/voidwarden/-/blob/main/epics/EPIC-P15-doku-onboarding.md), MR !76; offen: Weichentext nach T57.4 spiegeln und gegenlesen),
  Weichen-Text spiegeln, Zuständigkeitstabelle §3.1 gegenlesen. Messlatte: —.
- [ ] **T57.12** Entscheidungsaufgabe Doku-Site (optional): VitePress-Spike nur
  planen — Kriterien (Seitenzahl, Suchbedarf, Aufwand), Ergebnis „Go/No-go/vertagt“
  als Evaluations-Exit. Kein Code ohne Go. Messlatte: —.
- [ ] **T57.13** Abnahme + Retro (Skill `retro`): AC gegen Beleg, Messlauf, Gate.

## 5. Acceptance Criteria

- **AC-P57-1 (TTFS):** Kalter Messlauf `dummy`: M1 ≤ 5 min, M5 (Nachricht vom Handy sichtbar) ≤ 15 min (Basis wird
  im ersten Lauf gesetzt; danach Ratchet). Bericht mit Zeiten je Meilenstein liegt in
  `docs/messlauf/`; manuelle Handy-Messung ist als manuell ausgewiesen.
- **AC-P57-2 (K1):** In der Freigabe-Variante M5b (Stand-in-Harness) liegt die Freigabe-Latenz weiterhin < 5 s (p95);
  Onboarding-Code verschlechtert K1 nicht (bestehender Messlauf `messlauf:approve-latency`).
- **AC-P57-3 (Diátaxis):** `check:context` scheitert, wenn eine lebende Doku-Seite
  keine oder zwei Arten trägt (Negativ-Fixture rot, dann grün).
- **AC-P57-4 (Drift generiert):** Geänderter hubctl-`usage`-Text ohne
  Neugenerierung der Referenz lässt `check:context` scheitern; Neugenerierung macht es grün.
- **AC-P57-5 (ausführbar):** Ein absichtlich falscher Befehl im Tutorial lässt den
  Tutorial-Test scheitern (rot-dann-grün).
- **AC-P57-6 (Frische):** Alle neuen lebenden Seiten stehen in der Frischhalte-Map;
  `npm run check:context` ist grün.
- **AC-P57-7 (Erststart UI):** E2E: frischer Hub ohne Sessions zeigt den Einstieg mit
  Probe-Session-Knopf; Klick erzeugt eine `dummy`-Session; Filter-Leerzustand zeigt
  weiterhin „Filter zurücksetzen“-Variante, nicht den Einstieg. Inventarzeile + Spec
  vorhanden (`funktionsinventar.spec.ts` grün).
- **AC-P57-8 (Token-Gate):** Abgelehntes/leeres Token und unerreichbarer Hub zeigen je
  eine eigene Meldung mit nächstem Schritt; Offline zeigt Zeitstempel (K10), kein
  White-Screen.
- **AC-P57-9 (Sicherheit, PRD §8):** Kein Token/Secret in Doku, Tutorial-Ausgaben oder
  Messlauf-Bericht (`npm run check:secrets` grün); keine Variante (b)/(a) legt Tokens
  in URLs oder Logs ab; ADR liegt vor, bevor Kopplungscode entsteht.
- **AC-P57-10 (VoidWarden):** Tutorial enthält die Weiche; Schwester-Epic im
  VoidWarden-Repo verweist zurück; jede Hub-Aussage hat genau einen Eigentümer (§3.1).
- **AC-P57-11 (Scope):** T57.12 endet mit dokumentiertem Evaluations-Exit; ohne Go
  existiert keine neue Abhängigkeit in `package.json`.

## 6. Premortem

**Ende P57, gescheitert. Warum?**

1. *Tutorial veraltet binnen Wochen* (Wizard-Flags, Texte der PWA ändern sich) →
   Mitigation: Tutorial-Blöcke laufen als Test (T57.5), Frischhalte-Map beobachtet
   `setup.sh`, `apps/hubctl/`, `apps/pwa/src/app/`; Funktionsbeschreibungen nur über
   Inventar-ID. Wenn der Test zu flackrig wird: auf die Befehlsblöcke (nicht UI)
   beschränken statt ihn zu löschen.
2. *TTFS-Messung misst die falsche Sache* (dummy-Adapter ist nicht der echte Weg,
   Handy-Schritt nicht automatisierbar) → Mitigation: dummy-Lauf und echter
   Provider-Lauf getrennt ausweisen, manuelle Handy-Messung kennzeichnen, die
   Aussage „≤ 15 min“ nie auf den automatischen Lauf allein stützen. Hypothese statt
   Garantie in README.
3. *Kopplung ohne CLI schwächt die Sicherheit* (Token in URL, QR im Screenshot,
   Kopplungscode ohne Ablauf) → Mitigation: ADR vor Code (T57.8), Einmalgebrauch +
   10 min analog `fleet invite`, Test gegen Wiederverwendung; Standard bleibt die
   unveränderte Token-Eingabe. PRD §8 hat Vorrang vor Komfort.
4. *Scope-Creep zur Doku-Plattform* (Site, Suche, Versionierung, Übersetzung) →
   Mitigation: Out-Liste; Site nur als Evaluations-Exit (T57.12); jede Aufgabe hat
   Messlatten-Bezug oder „—“ mit Begründung; Verstoß gegen Repo-Regel 5.
5. *Generierte Referenz ist vollständig, aber unbrauchbar* (Recherche: „voll, aber
   unhilfreich“) → Mitigation: Generator nur für Fakten (Flags, Exit-Codes);
   Erklärtexte bleiben handgeschrieben in How-to/Erklärung; Review gegen den
   Tutorial-Pfad statt gegen Vollständigkeit.
6. *Doku-Seiten wachsen statt zu schrumpfen* (45 → 55 Seiten, mehr Stale-Kontext
   für Agenten) → Mitigation: neue Seiten nur Tutorial + generierte Referenz + wenige
   How-tos; `onboarding.md` wird geteilt, nicht ergänzt; Zeilenbudgets in
   `check:context`; ungenutzte Seiten werden verlinkt oder gelöscht (docs-ref).
7. *Zwei Repos widersprechen sich* (VoidWarden-README sagt anderes als Tutorial) →
   Mitigation: Eigentümer-Tabelle §3.1, Kernsätze nur einmal, Gegenlesen in T57.11
   (Muster P53/P14); relative Cross-Repo-Links sind ungeprüft — deshalb kein Inhalt
   dahinter versteckt.

**Korrektur 13.11.2026 (T57.4):** Der ursprüngliche Meilenstein M5 „erste
Freigabe“ war mit dem Wizard-Default `dummy` nicht erreichbar (`toolGate: "none"`).
M5 ist jetzt „Nachricht vom Handy sichtbar“; die Freigabe ist M5b (echter Harness,
im Messlauf mit dem Stand-in `claude`). Bericht §6 entsprechend ergänzt.

## 7. Definition of Done

Alle AC grün (Beleg je AC in der Retro) · `npm run gate` grün, Pipeline-Job `e2e`
auf dem Abschluss-MR grün, jede neue UI-Funktion und jeder Ablauf mit Spec in
`e2e/specs/` und Zeile im Funktionsinventar · `npm run check:context` grün mit den
neuen Regeln und Map-Einträgen · TTFS-Messlauf-Bericht in `docs/messlauf/` ·
**Erreichbarkeit:** Tutorial vom README und von der PWA aus erreichbar,
generierte Referenz im Gate verdrahtet (nicht nur vorhanden) · ADR zur
Handy-Kopplung vorhanden · VoidWarden-Schwester-Epic angelegt · T57.12 mit
Evaluations-Exit · keine neue Abhängigkeit ohne Go · kein TODO ohne
Epic-Referenz · `epics/README.md` aktualisiert · Retro-Abschnitt angehängt.
