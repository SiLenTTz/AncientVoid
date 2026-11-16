# EPIC-P65 — Status-Sounds: akustische Rückmeldung ohne VoidWarden

**Status:** offen (Planungsentwurf 17.11.2026) · **Phase:** P65 · **Dauer:** ≤ 1 Agenten-Woche · **Abhängigkeit:** keine fachliche offene (Quer-Epic); **reihenempfohlen nach P64** (beide berühren `Notifications.tsx`)

Quelle: Nutzerauftrag vom 17.11.2026 — für Nutzer, die VoidWarden nicht
nutzen, soll jede Statusänderung hörbar sein: ein Sound je Kategorie.

## 1. Ziel

AncientVoid ist ohne VoidWarden akustisch nutzbar: Wer die PWA im
Hintergrund-Tab oder beiseitegelegt offen hat, hört, **dass** sich etwas
getan hat — und **was**: Fehler, offene Frage/Freigabe, beendeter Lauf,
Info. Sounds sind pro Gerät konfigurierbar (an/aus je Kategorie, Lautstärke)
und funktionieren offline (K10). Sie sind bewusst Teil der PWA, nicht des
Hubs: Der gleiche Mechanismus gilt für den eigenen Hub und Fleet-Peers.

Messlatten: K10 (Sounds offline, kein Netz-Abruf), K2 (Audio-Auslösung
verursacht keinen Frame-Lag im Session-Tail).

## 2. Scope (In / Out)

**In:**

- `shared/audio.ts`: kleiner WebAudio-Spieler (AudioContext, Unlock nach
  erster Nutzer-Geste wegen Autoplay-Policy, Lautstärke, Master-Schalter).
- Klangkatalog als **Synthese** (Oszillator/Hüllkurve, keine Assets):
  `error` (tief, zweifach), `action` (offene Frage/Freigabe, mittig),
  `done` (Lauf beendet, aufsteigend), `info` (kurz, default aus).
- Anbindung an die Notification-Pipeline (`take()`): Sound bei **neu
  ankommenden** Meldungen — nie beim Laden, nie Replay alter Meldungen.
- Einstellungen → neuer Abschnitt „Töne“: Master, je Kategorie, Lautstärke,
  Test-Knopf (dient zugleich als Geste zum AudioContext-Unlock);
  Persistenz pro Gerät (`localStorage` wie Presets).
- Vibration am Handy (`navigator.vibrate`) für die Kategorien
  `error`/`action`, mit demselben Schalter abschaltbar — best effort,
  kein Fehler, wo die API fehlt.
- Rate-Limit: höchstens ein Sound je Kategorie pro 10 s (Fleet mit vielen
  Hosts soll kein Glockenspiel veranstalten).

**Out:**

- Erkennung, ob VoidWarden aktiv ist (kein Auto-Muting — VoidWarden-Nutzer
  stellen Sounds einfach aus; Hinweistext in den Einstellungen genügt).
- Sounds pro Einzel-Event im Session-Tail (Tool-Aufrufe, Deltas — das wäre
  Lärm; Statusänderungen sind der Auftrag).
- Sprachausgabe/TTS, Musik, Download zusätzlicher Klangpakete zur Laufzeit.
- Hub-seitige Sounds (der Hub ist kopflos; `hubctl`-Töne sind kein Ziel).
- Asset-Dateien (.wav/.mp3) — nur falls die Synthese in der Abnahme (T65.5)
  abgelehnt wird, folgt ein eigener kleiner Task mit selbst erzeugten,
  lizenzfreien WAVs (keine Dritt-Inhalte).

## 3. Design-Details

### 3.1 Spielpfad (WebAudio statt `<audio>`)

`AudioContext` + kurze Oszillator-Sequenzen mit Gain-Hüllkurve
(`shared/audio.ts`): null Asset-Bytes, offline trivial (K10),
deterministisch testbar (Spy statt Lautsprecher), keine Lizenzfragen.
Autoplay-Policy: Context startet `suspended`; der erste
`pointerdown`/`keydown` (global, einmalig) resumed ihn. Der Test-Knopf in
den Einstellungen ist die bewusste Geste, wenn Nutzer Sounds zuerst nach
einem frischen Laden konfigurieren. Fehlender/gruppierter Tab:
`visibilitychange` drosselt nichts — Hintergrund-Tabs dürfen klingen.

### 3.2 Kategorie-Mapping (gleiche Taxonomie wie P64-Glow)

| Kategorie | Quelle | Default |
|---|---|---|
| `error` | neue Notification `level === "error"` | an |
| `action` | neue Notification `kind ∈ APPROVAL_KINDS` und Pending bestätigt | an |
| `done` | neue Notification `kind === "session.turn_end"` | an |
| `info` | übrige (`level info/success/warning` ohne Pending) | aus |

`done` ist der Hauptnutz (`Lauf beendet` hören, während das Handy in der
Tasche ist); dass T8.6 seinen Toast unterdrückt, berührt den Sound nicht.

### 3.3 Rate-Limit & Fleet

Pro Kategorie max. ein Sound pro 10 s (Zeitfenster im Modul, kein State im
Komponentenbaum); Meldungen während des Fensters verfallen still (sie
stehen ohnehin in Glocke/Panel). Hub-„nicht erreichbar“-Warnungen bleiben
ohne Sound (Out) — Ausfälle hört man nicht 30-mal.

### 3.4 Einstellungen

`features/settings/SoundSettings.tsx` neben `PushSettings.tsx`: Master-
Schalter, je Kategorie Schalter + Lautstärke-Slider + Play-Icon
(Vorschau), Hinweis „VoidWarden aktiv? Sounds hier abschalten“. Persistenz
`ancientvoid.sounds` (localStorage, try/catch wie Presets).

## 4. Aufgaben (Checkliste T65.m)

- [ ] **T65.1** `shared/audio.ts` (Context, Unlock, Synthese-Katalog,
  Lautstärke, Rate-Limit) + Unit-Tests mit gemocktem AudioContext:
  Unlock-Reihenfolge, Rate-Limit, Master-Kategorie-Logik.
- [ ] **T65.2** Anbindung an `take()` in `Notifications.tsx` (Kategorie-
  Mapping, kein Replay beim Laden, kein Sound bei Panel-offen-Vorbelegung);
  Unit-Tests gegen das Mapping. Messlatte: K2.
- [ ] **T65.3** `SoundSettings.tsx` (Master/Kategorie/Lautstärke/Test) +
  Persistenz + Verkabelung in `SettingsPage.tsx`.
- [ ] **T65.4** Vibration (`error`/`action`, best effort) am Handy hinter
  demselben Schalter. Messlatte: K10 (alles lokal, kein Netz).
- [ ] **T65.5** E2E `sounds.spec.ts`: Settings-Interaktion, Spy auf
  AudioContext (Playwright hört nicht — Assert der Aufrufe), Sound bleibt
  nach Reload aus, wenn ausgeschaltet; Eintrag `docs/funktionsinventar.md`.
- [ ] **T65.6** Abnahme: PC-Hintergrund-Tab, Handy-Bildschirm-aus, offline
  (Flugmodus im lokalen Netz); Klangbild-Nachweis beim Nutzer (Synthese-
  katalog gefällt oder Asset-Fallback-Task).

## 5. Acceptance Criteria (AC-P65-k)

- **AC-P65-1:** Neue Meldungen lösen den Kategorie-Sound aus (Unit + E2E-
  Spy-Beleg); Laden/Reload und Hub-Restart replays nichts.
- **AC-P65-2:** Einstellungen steuern Master/Kategorie/Lautstärke, überleben
  Reload und Offline-Start (K10); Test-Knopf entsperrt den Context ohne
  vorherige andere Interaktion.
- **AC-P65-3:** Rate-Limit nachweisbar (n Sounds bei n≥10 gleichzeitigen
  Meldungen einer Kategorie in 10 s → 1).
- **AC-P65-4:** Kein Netz-Abruf für Sounds (K10; Spy/SW-Log leer), kein
  Frame-Lag im Session-Tail durch Audio-Auslösung (K2).
- **AC-P65-5:** Handy: Vibration bei `error`/`action`, identisch
  abgeschaltet mit dem Sound; ohne Vibration-API kein Fehler.
- **AC-P65-6:** Funktionsinventar-Eintrag; VoidWarden-Hinweis in den
  Einstellungen sichtbar.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Autoplay-Policy blockt den ersten Sound** (frisch geladene PWA, keine
   Geste) → Unlock-Muster + Test-Knopf; Verhalten dokumentiert
   („erst nach erster Interaktion“) statt stiller Ausfall.
2. **Ton-Flut bei Fleet/Parallelsessions** → Rate-Limit je Kategorie
   (3.3), Meldungen verfallen nicht (Glocke), Loadtest-Verhalten im
   Unit-Test.
3. **Synthetische Töne klingen billig und werden abgelehnt** → T65.6
   Abnahme vor Epic-Abschluss; Asset-Fallback als eigener Task mit selbst
   erzeugten WAVs (kein Lizenzrisiko, kein CDN — K10 bleibt).
4. **Hintergrund-Tab-Throttling verzögert Poll und damit den Sound** →
   Poll-Intervall existiert (4 s) und bleibt; Verhalten im
   Abnahme-Task T65.6 real am Handy gemessen, nicht angenommen.
5. **Kollision mit P64 in `Notifications.tsx`** → P65 nach P64 (oder im
   Abgleich); `take()`-Anbindung bleibt minimal (ein Hook-Aufruf je
   Meldung), Kategorie-Logik liegt getestet im Modul.

## 7. Definition of Done

Alle T65.* und AC-P65-* mit Evidenz. `npm run gate` lokal grün;
GitHub-Actions-Lauf (`verify`, `k8`, `e2e`) auf dem Abschluss-PR grün; rote
CI allein wegen Umgebung wird benannt, nie als Pass gezählt. Neue
UI-Abläufe mit Spec in `e2e/specs/` (`sounds.spec.ts`) und Eintrag in
`docs/funktionsinventar.md`; Einstellungen erreichbar und in der Bedien-
doku erwähnt. K2/K10 nachweislich unverändert bzw. erfüllt; kein TODO ohne
Epic-Bezug.
