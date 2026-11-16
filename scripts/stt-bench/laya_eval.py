#!/usr/bin/env python3
"""T10.4 (ADR-0029): Laya zero-shot as operation classifier on the P9 formulations.

intents.json: {text, label (catalog op or none), set (dev/heldout)} — exported
from packages/core/test/modules/commands/eval-set.ts and the held-out list in
scripts/messlauf-commands.mjs. Run in a venv with `pip install laya==0.3.20`.
"""
import json, statistics, time, sys
from laya import Router
rows = json.load(open("intents.json"))
CRIT = {
 "nav.open": "Eine Seite der App öffnen (Einstellungen, Freigaben, Status, neue Session)",
 "sessions.show": "Sessions in der Übersicht anzeigen oder filtern (wartend, aktiv, alle)",
 "session.open": "Eine bestimmte Session öffnen",
 "code.search": "Im Code des Projekts nach etwas suchen",
 "field.fill": "Einen Text in das Eingabefeld schreiben, ohne ihn zu senden",
 "field.transform": "Den Text im Feld korrigieren, kürzen, übersetzen oder verbessern",
 "session.create": "Eine neue Agenten-Session in einem Projekt starten",
 "session.prompt": "Dem Agenten eine Antwort oder Nachricht senden",
 "session.stop": "Eine Session beenden oder stoppen",
 "session.park": "Den laufenden Zug des Agenten anhalten oder unterbrechen",
 "session.archive": "Eine Session archivieren oder wiederherstellen",
 "session.pin": "Eine Session anheften oder lösen",
 "session.rename": "Eine Session umbenennen",
 "session.budget": "Das Kostenbudget einer Session setzen",
 "session.apply": "Die Änderungen der Session ins Projekt übernehmen",
 "action.run": "Eine Projektaktion ausführen (Tests, Build, Lint)",
 "none": "Nichts davon, eine Frage oder kein Auftrag",
}
router = Router()
q = lambda t: {"op": {"type": "choice", "instructions": "Welche Aktion will die Person in der Agenten-App auslösen?", "criteria": CRIT}}
router.predict("warm-up", q(""))
out = []
for r in rows:
    t0 = time.perf_counter()
    res = router.predict(r["text"], q(r["text"]))
    ms = (time.perf_counter() - t0) * 1000
    a = res["answers"]["op"]
    out.append({**r, "got": a.get("choice"), "conf": a.get("confidence"), "ms": round(ms, 1)})
for s in ("dev", "heldout"):
    sub = [o for o in out if o["set"] == s]
    ok = sum(o["got"] == o["label"] for o in sub)
    print(s, f"{ok}/{len(sub)} = {ok/len(sub):.1%}")
lat = sorted(o["ms"] for o in out)
print("latency p50", statistics.median(lat), "p90", lat[int(.9*(len(lat)-1))])
print("model", getattr(router, "model_name", None) or getattr(router, "model_id", None))
json.dump(out, open("result-laya.json", "w"), ensure_ascii=False, indent=1)
