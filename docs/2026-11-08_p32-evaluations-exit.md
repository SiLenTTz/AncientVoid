# P32-Evaluations-Exit — Optionaler nativer Mobile-Client (vertagt)

**Datum:** 2026-11-08 · **Epic:** [EPIC-P32](../epics/EPIC-P32-mobile-client-entscheidung.md)
**Abschluss:** Evaluations-Exit „vertagt" gemäß Epic §3.3 — kein Implementierungs-Go,
keine App gebaut und keine beansprucht. T32.3–T32.6 bleiben gesperrt.
**Nutzerentscheid (Jan, 08.11.2026):** vertagt — gestützt auf die dokumentierte
PWA-Präferenz vom 08.11.2026 und die Befundlage unten. Die Präferenz allein
hakt T32.1/T32.2 nicht ab ([EPIC-P32](../epics/EPIC-P32-mobile-client-entscheidung.md)
Nutzerpräferenz-Absatz); dieser Exit beruht deshalb auf Abgleich, Evidenz und
Messprotokoll-Gerüst dieses Dokuments plus ausdrücklicher Entscheidung.

## 1. Bedarfsbefund (Epic §3.1)

§3.1 verlangt für ein Go mindestens **eine konkret benötigte, reproduzierbar
mit vertretbarem PWA-Aufwand nicht gelöste Funktion**. Befund:

- Ein solcher belegter Bedarf existiert aktuell **nicht**. Die bekannten
  gerätegebundenen Lücken sind offene **Messungen** (unten, §2), keine
  bestätigten Funktionsdefizite der PWA.
- Die Differenzen zur Paseo-Analyse ([Vergleich §5](2026-11-05_paseo-vs-ancientvoid.md),
  Empfehlung P3 „nur bei eigenem Bedarf") — native Expo-App, Store-Verteilung,
  Relay-Pairing, In-App-Editor — sind bewusst nicht übernommene Merkmale,
  keine verlangten Funktionen. Relay/Cloud war explizit Out of Scope.
- Nach §3.1 folgt ohne solchen Befund: **No-go/vertagt, nur Evaluation
  abgeschlossen.** Das tritt hier ein.

## 2. Befundmatrix — P12/P16-Abgleich und PWA-Evidenz

Prüfdimensionen aus Epic §3.1 je mit PWA-seitiger Evidenz (Specs/Tests/Bugs)
und dem gerätegebundenen Offen-Posten aus dem
[Endabnahme-Block](../epics/EPIC-P35-harness-paritaet-fortsetzen-provider.md) §8:

| Dimension | PWA-seitiger Stand (Evidenz) | Gerätegebunden offen (Herkunft) |
|---|---|---|
| Approval bei gesperrtem Gerät | Approval-Flows per E2E (`e2e/specs/session.spec.ts`, `workspace-runtime.spec.ts`); K1-Latenz nie am Gerät gemessen | T35.10 (T12.4, T16.8-Restmatrix; AC-P35-9: echtes Gerät, WAN/Tailnet) |
| Push nach Prozessende | Ein/Aus + `permission=denied` sichtbar (`e2e/specs/push.spec.ts`); Hintergrund-/Sperrbildschirm-Zustellung nur am Gerät messbar | T35.10 (T12.4); ohne Messung kein „zuverlässig bei geschlossener App"-Claim (Epic §3.2) |
| Audio/Berechtigung/STT | Lokales Streaming-STT mit E2E (`e2e/specs/voice-local.spec.ts`, ADR-0028); Prototyp 919 ms ist kein p95-Beleg | T35.11 (T12.10, AC-P3-3, AC-P10-2: echte Stimme, Störgeräusch, Coldstart) |
| Share/Teilen-Menü | Share Target vorbefüllt neue Session (`e2e/specs/share-target.spec.ts`, AI-P9-2) | T35.10 (T12.4-Geräteanteil) |
| Offline/K10 | Offline-Reload zeigt letzten Stand mit Zeitstempel, Senden gesperrt, Entwurf bleibt (`e2e/specs/workspace.spec.ts`; BUG-0015 gefixt); Popout meldet Offline (`windows.spec.ts`) | T35.10 (T12.4-Flugmodus; P16-Lauf: K10/Offline lief am Gerät nicht) |
| Tailscale-Reconnect/WAN | Kein Spec; Reconnect-Verhalten nur im echten Netz belegbar | T35.10 (AC-P35-9, inkl. Fairphone gesperrt/Flugmodus, zweiter Origin T16.5) |

**P16-Abgleich:** Echter Pixel-9-Pro-XL-Lauf 2026-10-09 (Chrome 154, Commit
`8661491`): 51 bestanden / 5 Fail (BUG-0054) / 4 Skip; Restabnahmen T16.5
(zweiter Origin) und T16.8 (menschliche Restmatrix) → konsolidiert in T35.10.
**P12-Abgleich:** abgeschlossen mit Restabnahmen (T12.1/T12.4/T12.5/T12.7/
T12.8/T12.10/T12.12) → konsolidiert in T35.10–T35.15.
**P8:** abgeschlossen 2026-09-24, Gerätetests → P12. **P10:** abgeschlossen
mit Restnachweisen in P12 (T12.10 → T35.11). Damit ist die Epic-Voraussetzung
„P12/P16-Geräteabnahmen und P8/P10-Funktionen geprüft" erfüllt: geprüft und
mit Herkunfts-IDs dem Endabnahme-Block zugeordnet.

## 3. Messprotokoll-Gerüst (für die Gerätesession, T35.10/T35.11)

Auszuführen von Jan am echten Gerät über WAN/Tailnet (kein adb/Loopback,
AC-P35-9). Protokolliert je Prüfpunkt: Gerät/OS/Browser-Version, Netz- und
Lockzustand, Fehlversuche (Anzahl + Art), Messlatte, Ergebnis.

| # | Prüfpunkt | Rahmen | Messlatte | Herkunft |
|---|---|---|---|---|
| M1 | Approval bei gesperrtem Gerät | Pixel 9 Pro XL, WAN, Screen gesperrt | K1 < 5 s p95 | T35.10/T12.4 |
| M2 | Push nach Prozessende/Sperrbildschirm | App geschlossen/Hintergrund, WAN | Zustellung sichtbar; Grenzen dokumentiert | T35.10/T12.4 |
| M3 | Diktat echte Stimme (Headset/Störgeräusch/Coldstart) | je ≥ 20 Durchläufe | K6 ≤ 1,5 s (Ende Sprache → Transkript) | T35.11/T12.10 |
| M4 | Share aus Teilen-Menü | Text + URL | Session vorbefüllt, Nutzer bestätigt | T35.10/T12.4 |
| M5 | Offline/Flugmodus inkl. Reload | Flugmodus, dann online | K10: letzter Stand + Zeitstempel, kein Token-Gate | T35.10/T12.4 |
| M6 | Tailscale-Reconnect, Netzwechsel, zweiter Origin | WAN ↔ Tailnet | Session wieder erreichbar, kein Stillstand | T35.10/T16.5 |

**Re-Evaluation-Trigger:** Belegt eine dieser Messungen eine konkret
benötigte, mit vertretbarem PWA-Aufwand nicht lösbare Funktion, ist ein
ausdrückliches neues Go erforderlich (dann T32.3–T32.6 mit ADR Expo-Shell
vs. WebView). Der Befund wird unter der T35-ID dokumentiert, nicht hier
nachträglich umgedeutet.

## 4. Alternativen und Kosten

| Option | Beschreibung | Kosten/Wartung |
|---|---|---|
| **PWA (bestehend)** | Primärer Client, bleibt SSOT-UI; Gerätelücken über Messprotokoll §3 schließen | keine neue |
| **Voidwarden** | Separater Companion inkl. Sprachausgabe, bewusst eigenständig | unverändert |
| **Expo-/Android-Shell (T32.3–T32.6)** | WebView um bestehende PWA, max. Push/Share/STT-Brücke; interne Signierung/Verteilung, kein Store | 2–4 Agenten-Wochen einmalig plus laufende Hub↔Client-Versionspflege, Signierbetrieb, Geräte-Abnahmen — Solo-Kapazität (Premortem 4), gesperrt bis Go |

**Push-/Datenschutzpfad bei späterem Go:** Web-Push vs. OS-Push erst dann anhand
der M2-Belege entscheiden; Android-Push darf keinen externen Dienst einführen.
Kein Token in URL/Bridge-Logs, Keystore-Pflicht (Epic §3.2). Bei Vertagung wird
kein Zustellpfad beansprucht.

## 5. Folgen des Exits

- **T32.3–T32.6 bleiben gesperrt** bis zu einem ausdrücklichen, neuen Go;
  im Index als solche sichtbar (AC-P32-1).
- **P33 ist entblockt:** Vertagung blockiert P33 nicht (Epic §3.3); dieser
  Evaluations-Exit ist der gültige P32-Abschluss. P33 entscheidet eigenen
  Bedarf (T33.1) getrennt.
- **Umpriorisierung 2026-11-08 (Nutzerentscheid Jan):** P30 und P31 laufen
  nach P36; dokumentiert in den Statuszeilen der Epics und im
  [Epic-Index](../epics/README.md). Live-Abnahmen bleiben gebündelt im
  Endabnahme-Block (EPIC-P35 §8), Start weiterhin erst nach abgeschlossener
  Restkette.
