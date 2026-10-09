# ADR-0033 — Modus und Modell einer Session wählen und wechseln

**Status:** akzeptiert · **Betrifft:** EPIC-P15, `@uacc/contracts` (Adapter-Contract,
additiv), SessionManager, Hub `/api/sessions/:id/steer`, Claude-Adapter, PWA

## Kontext

Der Hub kennt kein Modus-Konzept. Bei Claude hängt die Freigabe an der
Adapter-Konfiguration (`permissionPrompts: "hub"` schickt jede Tool-Anfrage aufs
Handy); die Claude-CLI selbst kennt `--permission-mode auto | manual | plan |
acceptEdits | dontAsk | bypassPermissions`. Das Modell ist nur beim Start wählbar
(`HarnessFeatures.modelChoice: "start"`). Gewünscht: Auto Mode als Standard,
Modus und Modell pro Session in der Oberfläche setzen und mitten in der Session
wechseln, für jeden Provider, der das kann.

## Entscheidung

1. **Additiv im Contract.** `HarnessFeatures` bekommt `permissionModes:
   readonly string[]` (leer = der Adapter kennt keinen wählbaren Modus) und
   `modelSwitch: boolean` (Modell auch nach dem Start wechselbar).
   `basicFeatures()` setzt `[]`/`false`; kein bestehender Adapter ändert sein
   Verhalten. Die Modus-Namen sind providereigen und werden nicht vereinheitlicht:
   die Oberfläche zeigt, was der Adapter meldet.
2. **Ein neuer Steer.** `SteerInput` bekommt `{ kind: "configure"; model?: string;
   permissionMode?: string }`. Der Hub lehnt ab, was der Adapter nicht deklariert
   (`refuseSteer`, wie bei `park`). Der Adapter wendet es spätestens beim nächsten
   Zug an; Adapter mit Prozess pro Zug (Claude) merken es sich in ihrem Sitzungsstand.
3. **Start.** `SessionSpec.args.permissionMode` wählt den Modus beim Start
   (freier Adapter-Slot, kein Contract-Bruch). `refuseSpec` prüft ihn gegen
   `permissionModes`.
4. **Default.** Die Hub-Konfiguration `defaultPermissionMode` (Voreinstellung
   `"auto"`) gilt für jede neue Session, deren Adapter diesen Modus deklariert und
   bei der der Start keinen anderen nennt. Adapter ohne diesen Modus bleiben
   unberührt.
5. **Zustand und K7.** Die Session speichert `permissionMode` (neue Spalte
   `sessions.permission_mode`, nullable) und `model`. Jeder Wechsel schreibt ein
   Event `session.configured { model, permissionMode, actor }`; der Zustand ist
   damit aus JSONL + Snapshot wiederherstellbar. Ein beendete Session übergibt
   beides beim Fortsetzen (`continueStopped`) an den Adapter.
6. **Fail loud.** Lehnt der Adapter ab (oder gilt der Wunsch erst nach einem
   Neustart des Providers), antwortet der Steer mit `ok: false` und Grund.
   Es gibt kein stilles Ignorieren.

## Folgen

- Claude: `--permission-mode <modus>` bei **jedem** Spawn (auch `--resume`),
  `--model` ebenfalls, sobald ein Wechsel gesetzt ist. Die Hub-Freigabebrücke
  bleibt für alles, was der Modus selbst noch rückfragt.
- Providerabdeckung steht in `docs/harness-matrix.md`; wo ein Provider Modus oder
  Modell nur beim Start kennt (ACP-Adapter mit langlebigem Prozess), meldet er
  `[]`/`false`, und die Oberfläche blendet den Knopf aus.
- **Sicherheit:** Ein Default `auto` verschiebt die Entscheidung vom Handy in den
  Provider. Der Hub-Gatekeeper (T7.9) bleibt für Anfragen zuständig, die den Hub
  erreichen. Der Default ist konfigurierbar (`defaultPermissionMode: "manual"`).
- Offene Punkte: Moduswechsel für ACP/Codex-App-Server (Protokollaufrufe), Queue
  und Pause-Knopf (EPIC-P15 T15.3).

## Messlatten

K7 (Zustand wiederherstellbar: Event + Spalte), K5 (Event-Payload klein).
