import { useEffect, useRef, useState } from "preact/hooks";
import { hubApi, remoteHost, type CommandPlan, type StepResult } from "../../shared/api.ts";
import { commandContext, currentField, field, type FieldId } from "../../shared/command-context.ts";
import { pageHash, sessionHash, type ListPage } from "../../app/route.ts";

const RISK_TEXT = { read: "liest", write: "ändert", destructive: "zerstörerisch" } as const;
const TRANSFORM_TEXT: Record<string, string> = { correct: "korrigiert", shorten: "gekürzt", translate_en: "übersetzt (Englisch)", translate_de: "übersetzt (Deutsch)", improve: "verbessert" };
const EXAMPLES = ["Zeig wartende Sessions", "Starte Codex in Projekt …: …", "Antworte dort: …", "Korrigiere den Text"];

/** A client step — navigation and fields live in the app, not on the hub. */
export function runClientStep(c: Record<string, string | number | boolean | null>): string {
  const op = String(c.op);
  if (op === "nav.open") {
    location.hash = pageHash(String(c.page ?? "dashboard") as ListPage);
    return "geöffnet";
  }
  if (op === "sessions.show") {
    sessionStorage.setItem("uacc.overviewFilter", String(c.filter ?? "all"));
    window.dispatchEvent(new CustomEvent("uacc:overview-filter", { detail: c.filter }));
    location.hash = pageHash("dashboard");
    return "gefiltert";
  }
  if (op === "session.open") {
    location.hash = sessionHash(String(c.sessionId), remoteHost(String(c.hostId ?? "")));
    return "geöffnet";
  }
  if (op === "code.search") {
    sessionStorage.setItem("uacc.pendingCodeSearch", JSON.stringify({ sessionId: c.sessionId, text: c.text }));
    location.hash = sessionHash(String(c.sessionId), remoteHost(String(c.hostId ?? "")));
    window.dispatchEvent(new CustomEvent("uacc:code-search"));
    return "gesucht";
  }
  return "";
}

/** Open the command bar from anywhere. */
export function openCommandBar(): void {
  window.dispatchEvent(new CustomEvent("uacc:command-bar"));
}

/**
 * T9.4 (ADR-0027): one text entry for the whole hub — Ctrl/Cmd+K or ✦.
 * Reading and navigating run at once; anything that changes something
 * shows its target and waits for "Ausführen". Approvals, passkeys and
 * secrets stay taps (the hub says so).
 */
export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<CommandPlan | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<StepResult[] | null>(null);
  const [edit, setEdit] = useState<{ field: FieldId; before: string; after: string; label: string; applied: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    const openIt = () => setOpen(true);
    window.addEventListener("keydown", key);
    window.addEventListener("uacc:command-bar", openIt);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("uacc:command-bar", openIt);
    };
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
    else {
      setPlan(null);
      setResults(null);
      setMessage("");
      setAnswers({});
    }
  }, [open]);

  const execute = async (p: CommandPlan) => {
    setBusy(true);
    try {
      const first = p.steps[0];
      if (first?.op === "field.fill") {
        const id = String(first.args.field) as FieldId;
        const f = field(id);
        if (!f) throw new Error("Das Feld ist hier nicht offen.");
        setEdit({ field: id, before: f.get(), after: String(first.args.text), label: "eingetragen", applied: true });
        f.set(String(first.args.text));
        setResults([{ op: first.op, ok: true, detail: "eingetragen — nicht gesendet" }]);
        return;
      }
      if (first?.op === "field.transform") {
        const id = String(first.args.field) as FieldId;
        const f = field(id);
        if (!f) throw new Error("Das Feld ist hier nicht offen.");
        const before = f.get();
        const out = await hubApi.commandTransform(before, String(first.args.transform));
        setEdit({ field: id, before, after: out.text, label: `${TRANSFORM_TEXT[String(first.args.transform)] ?? "bearbeitet"} · ${out.provider} ${out.model} · ${(out.latencyMs / 1000).toFixed(1)} s`, applied: false });
        return;
      }
      const res = await hubApi.commandExecute(p.id, commandContext());
      for (const r of res.results) if (r.client) r.detail = runClientStep(r.client) || r.detail;
      setResults(res.results);
      if (res.results.every((r) => r.ok) && p.steps.every((s) => s.risk === "read")) setOpen(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (withAnswers = answers) => {
    if (!text.trim()) return;
    setBusy(true);
    setMessage("");
    setResults(null);
    setEdit(null);
    try {
      const p = await hubApi.commandPlan(text.trim(), commandContext(), Object.keys(withAnswers).length ? withAnswers : undefined);
      setPlan(p);
      // Premortem: harmless reading runs at once, without a modal step.
      if (!p.question && !p.refusal && p.steps.length > 0 && p.steps.every((s) => s.risk === "read" && !s.op.startsWith("field."))) await execute(p);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Planen fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  // Opened from ✦ (overview), ⋯ → „Auftrag in Worten“ (session) or Ctrl/Cmd+K.
  if (!open) return null;

  const writes = plan && plan.steps.some((s) => s.risk !== "read");
  return (
    <div class="command-sheet" role="dialog" aria-label="Auftrag in Worten">
      <form
        class="command-form"
        onSubmit={(e) => {
          e.preventDefault();
          setAnswers({});
          void submit({});
        }}
      >
        <input ref={input} value={text} placeholder="Was soll passieren? z. B. „Zeig wartende Sessions“" aria-label="Auftrag" onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        <button class="btn primary" type="submit" disabled={busy || !text.trim()}>
          {busy ? "…" : "Planen"}
        </button>
        <button class="btn" type="button" aria-label="Schließen" onClick={() => setOpen(false)}>
          ✕
        </button>
      </form>
      {!plan && !message && (
        <div class="command-examples dim">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" class="chip subtle" onClick={() => setText(ex.replace(/…/g, "").replace(/: $/, ": "))}>
              {ex}
            </button>
          ))}
          <div class="command-field">Feld für Textbearbeitung: {currentField() ?? "keins offen"}</div>
        </div>
      )}
      {message && <div class="reply-error">{message}</div>}
      {plan?.refusal && <div class="command-refusal">{plan.refusal}</div>}
      {plan?.question && (
        <div class="command-question">
          <div>{plan.question.question}</div>
          <div class="command-options">
            {plan.question.options.map((o) => (
              <button
                key={o.value}
                type="button"
                class="chip"
                onClick={() => {
                  const next = { ...answers, [plan.question!.param]: o.value };
                  setAnswers(next);
                  void submit(next);
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {plan && plan.steps.length > 0 && !results && !edit && (
        <div class="command-plan">
          {plan.steps.map((s, i) => (
            <div key={i} class={`command-step risk-${s.risk}`}>
              <span class="command-risk">{RISK_TEXT[s.risk]}</span>
              <span>{s.summary}</span>
            </div>
          ))}
          <div class="dim command-planner">{plan.planner === "model" ? "verstanden vom lokalen Modell" : "verstanden per Regel"} · Ziel vor dem Ausführen geprüft</div>
          {writes || plan.steps[0]?.op.startsWith("field.") ? (
            <button class="btn primary" type="button" disabled={busy} onClick={() => void execute(plan)}>
              {busy ? "…" : "Ausführen"}
            </button>
          ) : null}
        </div>
      )}
      {results && (
        <div class="command-results">
          {results.map((r, i) => (
            <div key={i} class={`command-result ${r.ok ? "ok" : "failed"}`}>
              {r.ok ? "✓" : "✗"} {r.detail}
            </div>
          ))}
        </div>
      )}
      {edit && (
        <div class="command-edit">
          <div class="dim">{edit.label}</div>
          <div class="command-diff">
            <div>
              <div class="dim">Vorher</div>
              <div class="command-before">{edit.before || "(leer)"}</div>
            </div>
            <div>
              <div class="dim">Nachher</div>
              <div class="command-after">{edit.after}</div>
            </div>
          </div>
          <div class="row" style="gap: 8px">
            {!edit.applied ? (
              <>
                <button class="btn primary" type="button" onClick={() => { field(edit.field)?.set(edit.after); setEdit({ ...edit, applied: true }); }}>
                  Übernehmen
                </button>
                <button class="btn" type="button" onClick={() => setEdit(null)}>
                  Verwerfen
                </button>
              </>
            ) : (
              <button class="btn" type="button" onClick={() => { field(edit.field)?.set(edit.before); setEdit({ ...edit, applied: false }); }}>
                Rückgängig
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
