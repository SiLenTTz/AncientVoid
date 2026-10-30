# ADR-0044 — Unterbrochene Sessions: Status `interrupted` und befristete Resume-Spawn-Erlaubnis

**Status:** akzeptiert · **Betrifft:** EPIC-P27, `SESSION_STATUSES`, `session.interrupted`-Event, `VALID_TRANSITIONS`, `AdapterResume` (Erweiterung von [ADR-0036](0036-resume-referenzen-im-adapter-contract.md)), PWA/hubctl Defensive-Regel

## Kontext

Hub-Abstürze (BUG-0074/0075) und Worker-Tötung bei Hub-Neustart (BUG-0072)
unterbrechen laufende Agenten-Sessions hart. Ist-Zustand (Belege in
[EPIC-P27 §3.0](../../epics/EPIC-P27-interrupted-sessions.md)):

- `SESSION_STATUSES` kennt keinen Unterbrechungs-Zustand — ein abgeschnittener
  Agent ist von einem fehlerhaften nicht unterscheidbar (`error` via
  `adapter.down`, `session-manager.ts`).
- Nach K7-Restart bleibt eine persistiert `working`-Session `working`, obwohl
  ihr Worker tot ist — der Chat zeigt einen toten „läuft noch"-Zustand, und
  der Nutzer muss manuell nachfragen.
- Offene Züge erhalten kein `turn.end` — Endreport/Digest schließen nicht ab.
- ADR-0036 deklariert Resume-Aufrufe je Harness, aber ausdrücklich
  **display-only** („never spawns the command itself") — der Hub kann eine
  unterbrochene Session nicht fortsetzen, und die PWA bietet für
  `error`/Interrupt keine Weitermachen-/Archivieren-Affordanz.

## Entscheidung

1. **Additiver Statuswert `"interrupted"` in `SESSION_STATUSES`** mit
   Übergängen in `VALID_TRANSITIONS`:
   `starting|working|waiting_approval|parked → interrupted` (Interrupt),
   `interrupted → working` (Resume), `interrupted → stopping|stopped`
   (Stop/Archiv), `interrupted → error` (Resume versucht und fehlgeschlagen —
   fail loud, kein stiller Rückfall).
2. **System-Event `session.interrupted { reason, since?, lastTurnId? }`** —
   `reason: "worker_exit" | "hub_restart" | "adapter_down"` (Pflichtfeld).
   System-kind ist bereits eine freie Zeichenkette — keine Event-Schema-
   Änderung, K5 bleibt enforcement-seitig unberührt.
3. **`turn.end { reason: "interrupted" }`** schließt den offenen Zug beim
   Interrupt ab — ehrlicher Abbruch statt Fake-„done" oder hängendem Zug.
4. **Klassifikationsgrenze:** `interrupted` heißt „abgeschnitten, nicht
   versagt". `adapter_down` nur, wenn **kein** Agent-Fehlerereignis vorliegt;
   liegt eines vor, bleibt `error`. Restore klassifiziert nur
   `working|starting` mit nachweislich totem Worker um —
   `parked|waiting_approval` bleiben unberührt (keine Über-Klassifikation,
   K7).
5. **Befristete Spawn-Erlaubnis für Resume (Amendment zu ADR-0036):**
   `AdapterResume` erhält zwei additive, belegbasierte Opt-in-Flags:
   ```ts
   interface AdapterResume {
     argv: string[];
     ref: "native" | "token";
     hub?: true;   // Hub darf das Template für „Weitermachen" selbst spawnen
     auto?: true;  // Auto-Resume nach Interrupt erlaubt (erfordert hub)
   }
   ```
   Ohne `hub` gilt ADR-0036 unverändert: display-only. Der Hub spawnt nur
   deklarierte Templates mit Hub-seitig substituierten Platzhaltern — argv
   stammt aus dem Adapter-Contract (kuratiert), **nie aus Agent-Output**
   (Prompt-Injektions-Grenze, PRD §8.5), ohne Shell.
6. **Policy:** Resume (manuell wie automatisch) löst nur ein Mensch aus bzw.
   nur mit Config-Freigabe — Agenten dürfen sich nicht selbst wiederanlaufen
   (Analogie zur human-only-Steuer-Allowlist in ADR-0043). Auto-Resume
   zusätzlich nur bei `auto: true`-Deklaration; default aus.
7. **Defensive-Regel für Verbraucher:** Ein unbekannter Statuswert darf die
   PWA/den hubctl niemals crashen oder als White-Screen enden — er rendert
   als Status-Text-Banner (K10-Geist). Diese Regel ist Vertrag: neue
   Statuswerte sind damit abwärtskompatibel einführbar.

## Alternativen

- **Abgeleitetes UI-Flag statt Statuswert** (PWA liest letzte Events und
  „errät" Interrupt): verworfen — hubctl, Übersichts-Sortierung („Braucht
  dich"), K7-Recovery und Steer-Gating bräuchten dieselbe Logik dann mehrfach;
  ein Statuswert ist die eine Quelle (fail loud statt erraten).
- **`error` + Grund-Feld:** verworfen — verdeckt nur; jede existing
  `error`-Behandlung (Retry-Dialog, „nächste Nachricht startet neuen Zug",
  ADR-0015) träfe auf Interrupts zu und läge falsch.
- **Vollautomatische Wiederaufnahme für alle Adapter:** verworfen — ohne
  Deklaration ist unklar, ob der Resume-Aufruf die Session identisch
  fortsetzt oder Doppelarbeit/halbe Zustände erzeugt (Premortem P27-2).

## Folgen

- Contract-Änderung streng additiv; alte PWA/hubctl-Versionen sehen einen
  unbekannten Status und müssen Regel 7 bereits heute erfüllen (PWA rendert
  Status als Text — geprüft; hubctl druckt roh — geprüft).
- T27.3 (Erkennung) darf `interrupted` erst setzen, wenn dieser Status und
  die Transitions gemerged sind (contracts first).
- `resume.auto` aktiviert der Hub ausschließlich testseitig für `dummy`;
  produktive Adapter deklarieren es nur mit Live-Beleg der identischen
  Fortsetzung (Nachweis im Adapter-Testkit).
