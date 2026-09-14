---
id: BUG-0003
slug: k7-seq-gap-unknown-cause
status: done
severity: S2
area: core
instance: dev
commit: "3fecebc"
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/3"
epic: EPIC-P0
created: 2026-09-14
reporter: "Claude Sonnet 5 (Session 012Ga2NDi683xR9E63StoN7T)"
---

# BUG-0003 — K7-Test sah eine echte Sequenzlücke in CI, Ursache unbekannt

## Gesehen

Auf GitLabs CI-Runner (`k8s.saas-linux-small-amd64`, Pipeline
[2846580126](https://gitlab.com/SiLenT_Tz/mobile-hub/-/pipelines/2846580126))
schlug der K7-Test fehl — nicht mit einem `waitFor`-Timeout (BUG-0001, dort
behoben), sondern mit einer **echten Lücke in der persistierten
Event-Sequenz**:

```text
AssertionError: expected [ Array(12) ] to deeply equal [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, …(2) ]
- Expected:  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
+ Received:  1, 2, 3,    5, 6, 7, 8, 9, 10, 11, 12, 13
```

`seq=4` fehlt vollständig in `eventsAfter` (der replayte JSONL-Stream nach
Recovery), `eventsBefore` (12) stimmt intern konsistent mit dieser Lücke
überein — d. h. die Lücke war schon **vor** dem harten Schnitt in der Datei
vorhanden, nicht erst durch die Recovery entstanden.

## Erwartet

`SessionManager.emitEvents()` vergibt `seq` strikt lückenlos, UND jedes
vergebene `seq` landet garantiert (oder sichtbar fehlschlagend) im
persistenten Store — kein `seq`, das im Speicher vergeben, aber nie
geschrieben wurde (K7, „Fail loud", `AGENTS.md` Regel 4 und 6).

## Repro

**Nicht zuverlässig reproduziert.** Einmal auf GitLab-CI gesehen (s. o.),
nicht in ~15 lokalen Wiederholungen (isoliert oder in Kombination mit
anderen Dateien) — dort traten stattdessen `waitFor`-Timeouts auf (BUG-0001,
BUG-0002), nie eine Lücke in der Mitte der Sequenz.

**Wichtiger Ausschluss:** K7 ist der **letzte** Test in
`sessionmanager.test.ts`, und die Datei lief in diesem Pipeline-Lauf
**zuerst** (vor `eventstore.test.ts` etc., siehe CI-Log-Reihenfolge). Der in
[BUG-0002](bug-0002-cross-file-timer-delay-singlefork.md) gefundene
Zombie-Generator-Mechanismus (siehe auch Commit `ea35214`) kann diese
KONKRETE Lücke daher **nicht** erklärt haben — es gab zu diesem Zeitpunkt im
selben Prozess noch keinen vorlaufenden Zombie. Die Ursache dieser
spezifischen Lücke ist unabhängig und ungeklärt.

**Häufigkeit:** 1× beobachtet (CI), Verdacht: seltene, last-getriggerte
I/O-Störung auf dem Runner.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | GitLab CI, `k8s.saas-linux-small-amd64` (SaaS-Runner) |
| Commit | `3fecebc` |
| Pipeline | https://gitlab.com/SiLenT_Tz/mobile-hub/-/pipelines/2846580126 |
| Job | https://gitlab.com/SiLenT_Tz/mobile-hub/-/jobs/16482521543 |
| Repro-Weg | reiner `npm test` in CI — kein PWA/hubctl-Pfad |

## Logs

Siehe Job-Log (Link oben) und der Assertion-Ausschnitt unter „Gesehen".
Keine `ENOENT`-Zeile für **diese** Session-ID im Log sichtbar — anders als
die eindeutig zuordenbaren Zombie-Fälle aus BUG-0002.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/sessionmanager.test.ts:106-` (K7) | vorhanden, deckt die Lücke bereits auf (byte-identity-Assertion) |

Kein neuer Test in diesem Lauf — die bestehende K7-Assertion ist bereits das
Warnsystem. Was fehlt: eine Möglichkeit, `EventStore.append()`-Fehlschläge
gezielt zu provozieren (Fault-Injection), um die Lücke deterministisch
nachzustellen.

## Eingrenzung

Verdächtig, aber **nicht verifiziert**:

- `SessionManager.emitEvents()` (`packages/core/src/sessionmanager.ts:326-346`)
  vergibt `seq: ++session.record.lastSeq` **synchron**, bevor
  `await this.store.append(...)` überhaupt versucht wird. Schlägt der
  Append fehl, wird `seq` nie wiederverwendet — die Lücke ist permanent.
- Der Fehlerpfad in `makeContext().emit` (`sessionmanager.ts:300-309`) fängt
  Append-Fehler nur mit `console.error` ab und setzt
  `session.record.status = "error"` **direkt am Objekt**, ohne
  `setStatus()` (keine Persistenz, kein sichtbares Event) — ein
  Append-Fehlschlag ist aktuell nicht "fail loud" im Sinne von `AGENTS.md`
  Regel 6, sondern effektiv still.
- Warum `store.append()` für genau dieses eine `seq` fehlgeschlagen sein
  könnte (ENOENT? EMFILE? ein anderer transienter I/O-Fehler auf dem
  SaaS-Runner?) ist **nicht geklärt** — dazu fehlt Instrumentierung.

## Fix

Ursache doch gefunden, per Code-Lesen statt weiterer empirischer Läufe
(Commit `958d251`): `EventStore`s FSYNC-Debounce-Timer
(`setTimeout(() => void this.flush(sessionId), FSYNC_INTERVAL_MS)`) rief
`flush()` **außerhalb** der `appendChain`-Serialisierung auf, die sonst
jeden Write für eine Session ordnet. Feuerte der Timer, während
`appendLinesLocked()` für dieselbe Session gerade mitten im Schreiben war,
konnte `flush()` den `FileHandle` synchron schließen — der parallele Write
schlug fehl, aber `emitEvents()` hatte `lastSeq` bereits **vorher**
inkrementiert. Die `seq` war für immer verloren, nur ein `console.error`,
kein sichtbares Event (Verstoß gegen `AGENTS.md` Regel 6 „Fail loud").

Erklärt auch, warum die Lücke auf CI **deterministisch** an derselben
Position (`seq=4`) auftrat — fester Bezug zwischen `eventsPerSecond`-Takt
und `FSYNC_INTERVAL_MS`, nicht zufällige I/O-Störung wie ursprünglich
vermutet.

Fix: Timer-Flush, expliziter `flush()` und der `FSYNC_MAX_EVENTS`-Sofort-Flush
laufen jetzt alle durch dieselbe Chain (`chain()`-Helper). Der bereits
innerhalb der Chain laufende `FSYNC_MAX_EVENTS`-Fall ruft `flushOne()` direkt
auf (sonst Deadlock — er würde auf sich selbst warten).

Verifiziert: 10/10 volle Suiten-Läufe grün, 2/3 unter synthetischer
Alle-Kerne-Last (der eine Rest-Fehlschlag ist ein unabhängiger
tmux-Pipe-Timing-Test, in CI ohnehin geskippt). CI-Pipeline auf dem finalen
Commit grün — siehe MR !3.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` — behoben (Commit `958d251`)
