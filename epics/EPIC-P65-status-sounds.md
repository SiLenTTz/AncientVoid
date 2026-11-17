# EPIC-P65 — Status-Sounds: akustische Rückmeldung ohne VoidWarden

**Status:** offen (Planungsentwurf 17.11.2026) · **Phase:** P65 · **Dauer:** ≤ 1 Agenten-Woche · **Abhängigkeit:** keine fachliche offene (Quer-Epic); **reihenempfohlen nach P64** (beide berühren `Notifications.tsx`)

Quelle: Nutzerauftrag vom 17.11.2026 — für Nutzer, die VoidWarden nicht
nutzen, soll jede Statusänderung hörbar sein: ein Sound je Kategorie.

## 1. Ziel

AncientVoid ist ohne VoidWarden akustisch nutzbar: Wer die PWA im
Hintergrund-Tab oder beiseitegelegt offen hat, hört, **dass** sich etwas
getan hat — und **was**: Fehler, offene Frage/Freigabe, beendeter Lauf,
Info. Jeder Status hat einen **eigenen Sound**, der in den Einstellungen
aus mehreren Varianten wählbar und je Kategorie an/aus schaltbar ist; ein
Lautsprecher-Knopf im Benachrichtigungs-Panel schaltet Sounds schnell
stumm/laut. Sounds funktionieren offline (K10). Sie sind bewusst Teil der
PWA, nicht des Hubs: Der gleiche Mechanismus gilt für den eigenen Hub und
Fleet-Peers.

Messlatten: K10 (Sounds offline, kein Netz-Abruf), K2 (Audio-Auslösung
verursacht keinen Frame-Lag im Session-Tail).

## 2. Scope (In / Out)

**In:**

- `shared/audio.ts`: kleiner WebAudio-Spieler (AudioContext, Unlock nach
  erster Nutzer-Geste wegen Autoplay-Policy, Lautstärke, Master-Schalter).
- Klangkatalog als **Synthese** (Oszillator/Hüllkurve, keine Assets) mit
  **mehreren Varianten je Kategorie** (je 3–4 Optionen, z. B. Chime,
  Doppelton, Blip, Gong — pro Status unterschiedlich charaktervoll):
  `error` (tief, drängend), `action` (offene Frage/Freigabe, mittig),
  `done` (Lauf beendet, aufsteigend), `info` (kurz).
- Anbindung an die Notification-Pipeline (`take()`): Sound bei **neu
  ankommenden** Meldungen — nie beim Laden, nie Replay alter Meldungen.
- Einstellungen → neuer Abschnitt „Töne“: Master-Schalter; je Kategorie
  an/aus, **Sound-Auswahl aus den Varianten** (mit Vorschau-Play-Knopf,
  der zugleich als Geste zum AudioContext-Unlock dient) und Lautstärke;
  Persistenz pro Gerät (`localStorage` wie Presets).
- **Lautsprecher-Knopf im Benachrichtigungs-Panel**: Öffnet jemand das
  Panel, schaltet ein Tipp auf das Icon die Sounds stumm oder wieder laut
  (Master), Zustand am Icon sichtbar (durchgestrichen wenn stumm) —
  persistiert wie die Settings, verlinkt lang auf den Töne-Abschnitt.
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

### 3.2 Kategorie-Mapping und Varianten (gleiche Taxonomie wie P64-Glow)

| Kategorie | Quelle | Default |
|---|---|---|
| `error` | neue Notification `level === "error"` | an |
| `action` | neue Notification `kind ∈ APPROVAL_KINDS` und Pending bestätigt | an |
| `done` | neue Notification `kind === "session.turn_end"` | an |
| `info` | übrige (`level info/success/warning` ohne Pending) | aus |

`SOUND_OPTIONS: Record<Category, { id, label }[]>` registriert je Kategorie
3–4 synthetisierte Varianten; gewählte Variante + an/aus + Lautstärke je
Kategorie persistiert (`ancientvoid.sounds`). `done` ist der Hauptnutz
(`Lauf beendet` hören, während das Handy in der Tasche ist); dass T8.6
seinen Toast unterdrückt, berührt den Sound nicht.

### 3.3 Rate-Limit & Fleet

Pro Kategorie max. ein Sound pro 10 s (Zeitfenster im Modul, kein State im
Komponentenbaum); Meldungen während des Fensters verfallen still (sie
stehen ohnehin in Glocke/Panel). Hub-„nicht erreichbar“-Warnungen bleiben
ohne Sound (Out) — Ausfälle hört man nicht 30-mal.

### 3.4 Einstellungen und Panel-Knopf

`features/settings/SoundSettings.tsx` neben `PushSettings.tsx`: Master-
Schalter; je Kategorie Zeile mit an/aus, Varianten-Auswahl (Segmented/
Select über `SOUND_OPTIONS`), Vorschau-Play und Lautstärke-Slider;
Hinweis „VoidWarden aktiv? Sounds hier abschalten“. Persistenz
`ancientvoid.sounds` (localStorage, try/catch wie Presets).

Im Benachrichtigungs-Panel (`.notif-panel-head`, neben ✕): Lautsprecher-
Icon-Knopf — Tipp schaltet den Master stumm/laut, Icon durchgestrichen
wenn stumm, `aria-pressed` für Screenreader; Longpress/Tooltip verweist
auf die Töne-Einstellungen.

## 4. Aufgaben (Checkliste T65.m)

- [x] **T65.1** `shared/audio.ts` (Context, Unlock, Synthese-Katalog mit
  `SOUND_OPTIONS` — je Kategorie 3–4 Varianten —, Lautstärke, Rate-Limit) +
  Unit-Tests mit gemocktem AudioContext: Unlock-Reihenfolge, Rate-Limit,
  Master-Kategorie-Logik, Varianten-Registry vollständig (je Kategorie ≥ 3).
- [x] **T65.2** Anbindung an `take()` in `Notifications.tsx` (Kategorie-
  Mapping, gewählte Variante, kein Replay beim Laden, kein Sound bei
  Panel-offen-Vorbelegung);
  Unit-Tests gegen das Mapping. Messlatte: K2.
- [x] **T65.3** `SoundSettings.tsx` (Master; je Kategorie an/aus,
  Varianten-Auswahl mit Vorschau, Lautstärke) + Persistenz + Verkabelung
  in `SettingsPage.tsx`.
- [x] **T65.4** Lautsprecher-Knopf im Benachrichtigungs-Panel (Master
  stumm/laut, Icon-Zustand, `aria-pressed`, Persistenz wie Settings) und
  Vibration (`error`/`action`, best effort) hinter demselben Master.
  Messlatte: K10 (alles lokal, kein Netz).
- [x] **T65.5** E2E `sounds.spec.ts`: Settings-Interaktion inkl.
  Varianten-Wechsel, Panel-Knopf schaltet stumm/laut, Spy auf
  AudioContext (Playwright hört nicht — Assert der Aufrufe), Sound bleibt
  nach Reload aus, wenn ausgeschaltet; Eintrag `docs/funktionsinventar.md`.
- [ ] **T65.6** Abnahme: PC-Hintergrund-Tab, Handy-Bildschirm-aus, offline
  (Flugmodus im lokalen Netz); Klangbild-Nachweis beim Nutzer über die
  Varianten-Auswahl (Synthese-
  katalog gefällt oder Asset-Fallback-Task).

## 5. Acceptance Criteria (AC-P65-k)

- **AC-P65-1:** Neue Meldungen lösen den Kategorie-Sound aus (Unit + E2E-
  Spy-Beleg); Laden/Reload und Hub-Restart replays nichts.
- **AC-P65-2:** Einstellungen steuern Master/Kategorie/Varianten-Auswahl/
  Lautstärke (je Kategorie ≥ 3 wählbare Varianten mit Vorschau), überleben
  Reload und Offline-Start (K10); Vorschau-Knopf entsperrt den Context ohne
  vorherige andere Interaktion.
- **AC-P65-3:** Rate-Limit nachweisbar (n Sounds bei n≥10 gleichzeitigen
  Meldungen einer Kategorie in 10 s → 1).
- **AC-P65-4:** Kein Netz-Abruf für Sounds (K10; Spy/SW-Log leer), kein
  Frame-Lag im Session-Tail durch Audio-Auslösung (K2).
- **AC-P65-5:** Handy: Vibration bei `error`/`action`, identisch
  abgeschaltet mit dem Sound; ohne Vibration-API kein Fehler.
- **AC-P65-6:** Funktionsinventar-Eintrag; VoidWarden-Hinweis in den
  Einstellungen sichtbar.
- **AC-P65-7:** Der Lautsprecher-Knopf im Benachrichtigungs-Panel schaltet
  den Master stumm/laut (E2E), zeigt den Zustand am Icon (`aria-pressed`)
  und persistiert ihn über Reload.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Autoplay-Policy blockt den ersten Sound** (frisch geladene PWA, keine
   Geste) → Unlock-Muster + Test-Knopf; Verhalten dokumentiert
   („erst nach erster Interaktion“) statt stiller Ausfall.
2. **Ton-Flut bei Fleet/Parallelsessions** → Rate-Limit je Kategorie
   (3.3), Meldungen verfallen nicht (Glocke), Loadtest-Verhalten im
   Unit-Test.
3. **Synthetische Töne klingen billig und werden abgelehnt** → je Kategorie
   3–4 Varianten auswählbar (Nutzer wählt, was gefällt); T65.6 Abnahme vor
   Epic-Abschluss; Asset-Fallback als eigener Task mit selbst erzeugten
   WAVs (kein Lizenzrisiko, kein CDN — K10 bleibt).
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

## 8. Retro (2026-11-17 — Implementierung; T65.6-Nutzerabnahme steht aus)

| AC | Stand | Beleg |
|---|---|---|
| AC-P65-1 | ✅ | `audio.test.ts` (Unlock-Reihenfolge, Master/Kategorie-Gate, Rate-Limit 12→1, keine Ausnahmen bei kaputtem Speicher) + `sound-category.test.ts` (Mapping inkl. Pending) + `sounds.spec.ts` (vor Geste still, danach Fehler-Ton, kein Replay beim Reload) |
| AC-P65-2 | ✅ | `sounds.spec.ts` „Section Töne“: info einschalten, Variante wählen, Vorschau ohne Vorinteraktion, alles reload-fest; Lautstärke via `volumeGain`-Unit-Test |
| AC-P65-3 | ✅ | `audio.test.ts` „zwölf Meldungen einer Kategorie in zehn Sekunden → genau ein Sound“; E2E bestätigt zwei dicke Fehler → ein Ton |
| AC-P65-4 | ⏳ | K10 erfüllt: der Spielerpfad ist rein lokal, kein Netz-Abruf (E2E läuft mit blockiertem Service Worker). K2: kein Messlauf — Audio Zeitplan läuft in WebAudio, kein neuer Render-Pfad; Bestätigung bei T65.6 |
| AC-P65-5 | ⏳ | Unit: Vibration bei `error`/`action`, nicht bei `done`, kein Fehler ohne API (best effort). Echter Handy-Test (Bildschirm aus) bleibt T65.6 |
| AC-P65-6 | ✅ | `docs/funktionsinventar.md` G74 (spec:sounds.spec.ts, Inventar-Gate grün); VoidWarden-Hinweis in der Töne-Sektion |
| AC-P65-7 | ✅ | `sounds.spec.ts` „Master aus am Panel“: aria-pressed-Zustand, Stille danach, Persistenz über Reload |

**Erkenntnisse**

1. Die WebAudio-Autoplay-Policy macht den Unlock-Test erst interessant: vor
   der ersten Geste wird nichts gespielt (dokumentiertes Verhalten statt
   stiller Ausfall) — der Vorschau-Knopf ist die bewusste Geste.
2. Der E2E-Spy wrapped `AudioContext` vor dem App-Bootstrap
   (`addInitScript` + Reload); die App selbst bleibt unverändert.
3. Nebenbei gefixt: die `.btn`-Selektoren der Panel-Köpfe in
   `notifications.spec.ts`/`notifications-glow.spec.ts`/`shortcuts.spec.ts`
   waren seit dem P63-Button-Refactor tot (Nightly-rot auf main); sie zielen
   jetzt auf die ✕-Rolle bzw. `.ui-button`.
