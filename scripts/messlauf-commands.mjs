#!/usr/bin/env node
// T9.5 / AC-P9-2: held-out formulations (written after the rules were
// tuned on the development set, never tuned against) — rules only, and
// rules + local model (LLAMA_KEY set).
//
//   LLAMA_KEY=… node scripts/messlauf-commands.mjs
import { CommandContext } from "../packages/contracts/src/index.ts";
import { planCommand } from "../packages/core/src/index.ts";
import { DATA } from "../packages/core/test/modules/commands/eval-set.ts";

const overview = { page: "dashboard" };
const inS1 = { page: "session", sessionId: "s1", hostId: "omarchy", sessionRevision: 3 };
const withText = { ...inS1, field: "reply", fieldText: "kanst du das bite nochmal machn" };

/** [text, context, expected op | "question:<param>" | "refusal" | "none"] */
const HELD_OUT = [
  ["Was wartet gerade auf mich?", overview, "sessions.show"],
  ["Zeig mir bitte alle laufenden Sitzungen", overview, "sessions.show"],
  ["Bring mich zu den Einstellungen", overview, "nav.open"],
  ["Mach die Freigaben-Seite auf", overview, "nav.open"],
  ["Öffne bitte die Session zum Login", overview, "session.open"],
  ["Spring zur Build-Session", overview, "session.open"],
  ["Starte Claude für AncientVoid: Lies die Architektur-Doku", overview, "session.create"],
  ["Mach eine neue Codex-Session im Projekt beta auf: Tests", overview, "session.create"],
  ["Fang mit opencode in beta an: README prüfen", overview, "session.create"],
  ["Antworte der Doku-Session: gerne auch englisch", overview, "session.prompt"],
  ["Sag Claude dort: nimm pnpm", inS1, "session.prompt"],
  ["Schick ihr: die Tests laufen jetzt", inS1, "session.prompt"],
  ["Beende bitte die Login-Session", overview, "session.stop"],
  ["Brich die aktuelle Session ab", inS1, "session.stop"],
  ["Unterbrich sie kurz", inS1, "session.park"],
  ["Pack die Doku-Session ins Archiv", overview, "session.archive"],
  ["Heft mir die Login-Session oben an", overview, "session.pin"],
  ["Nenn die Session um in Auth-Fix", inS1, "session.rename"],
  ["Erhöhe das Budget auf 3 Euro", inS1, "session.budget"],
  ["Übernimm das Ergebnis ins Projekt", inS1, "session.apply"],
  ["Wo wird parseToken definiert?", inS1, "code.search"],
  ["Suche nach der Klasse SessionManager im Code", inS1, "code.search"],
  ["Lass die Tests laufen bitte", inS1, "action.run"],
  ["Mach das Feld kürzer", withText, "field.transform"],
  ["Bitte Rechtschreibung korrigieren", withText, "field.transform"],
  ["Schreib 'bitte nicht löschen' ins Feld", inS1, "field.fill"],
  ["Erlaube das", inS1, "refusal"],
  ["Nein, doch nicht stoppen", inS1, "none"],
  ["Wie viele Tokens hat das verbraucht?", inS1, "none"],
  ["Stoppe Parser-Tests", overview, "question:session"],
];

const model = process.env.LLAMA_KEY ? { url: process.env.LLAMA_URL ?? "http://100.65.133.28:8081/v1", model: "qwen3-coder", apiKey: process.env.LLAMA_KEY } : undefined;

function judge(plan, want) {
  if (want === "none") return plan.steps.length === 0 && !plan.question;
  if (want === "refusal") return plan.steps.length === 0 && Boolean(plan.refusal);
  if (want.startsWith("question:")) return plan.question?.param === want.slice(9);
  return plan.steps[0]?.op === want || (plan.question !== null && plan.steps.length === 0 && want !== "sessions.show" && want !== "nav.open");
}

for (const [label, cfg] of [["Regeln", undefined], ...(model ? [["Regeln + lokales Modell", model]] : [])]) {
  let ok = 0;
  let risky = 0;
  const misses = [];
  const times = [];
  for (const [text, ctx, want] of HELD_OUT) {
    const t0 = Date.now();
    const plan = await planCommand(text, CommandContext.parse(ctx), DATA, { model: cfg });
    times.push(Date.now() - t0);
    const good = judge(plan, want);
    if (good) ok++;
    else {
      misses.push(`„${text}“ → ${plan.steps[0]?.op ?? (plan.question ? `Frage ${plan.question.param}` : plan.refusal ? "Ablehnung" : "nichts")} (${plan.planner}), erwartet ${want}`);
      if (plan.steps.some((s) => s.risk !== "read") && plan.steps[0]?.op !== want) risky++;
    }
  }
  times.sort((a, b) => a - b);
  console.log(`\n== ${label}: ${ok}/${HELD_OUT.length} = ${((100 * ok) / HELD_OUT.length).toFixed(1)} % · falsche schreibende Schritte: ${risky} · Planungszeit p50 ${times[Math.floor(times.length / 2)]} ms, max ${times.at(-1)} ms`);
  for (const m of misses) console.log("  " + m);
}
