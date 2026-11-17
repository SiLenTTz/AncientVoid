import { useEffect, useRef, useState } from "preact/hooks";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { hubApi, type TerminalTarget } from "../../shared/api.ts";
import { Button } from "../../shared/ui/index.ts";

type ConnState = "idle" | "connecting" | "open" | "closed" | "error";

/**
 * ADR-0087: Allowlist-Terminals über Hub-SSH/`script`.
 * Ohne Config: Hinweis. Mit Ziel: xterm + Ticket-WebSocket.
 */
export function TerminalPage() {
  const [targets, setTargets] = useState<TerminalTarget[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [state, setState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const dataDispRef = useRef<{ dispose(): void } | null>(null);

  useEffect(() => {
    let alive = true;
    void hubApi.terminals()
      .then((list) => {
        if (!alive) return;
        setTargets(list.terminals);
        if (list.terminals[0]) setSelected(list.terminals[0].id);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setTargets([]);
        setError(err instanceof Error ? err.message : "Liste nicht ladbar");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "var(--font-mono, ui-monospace, monospace)",
      fontSize: 13,
      theme: { background: "#0d1117", foreground: "#e6edf3", cursor: "#e6edf3" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  const disconnect = () => {
    dataDispRef.current?.dispose();
    dataDispRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    setState("closed");
  };

  const connect = async () => {
    if (!selected || !termRef.current) return;
    setError(null);
    setState("connecting");
    termRef.current.reset();
    dataDispRef.current?.dispose();
    dataDispRef.current = null;
    wsRef.current?.close();
    try {
      fitRef.current?.fit();
      const cols = termRef.current.cols;
      const rows = termRef.current.rows;
      const { ticket } = await hubApi.terminalTicket(selected);
      const ws = new WebSocket(hubApi.terminalStreamUrl(selected, ticket, cols, rows));
      wsRef.current = ws;
      ws.addEventListener("open", () => {
        setState("open");
        termRef.current?.focus();
      });
      ws.addEventListener("message", (ev) => {
        try {
          const frame = JSON.parse(String(ev.data)) as { t: string; d?: string; m?: string; code?: number };
          if (frame.t === "o" && frame.d) termRef.current?.write(frame.d);
          else if (frame.t === "e") {
            setError(frame.m ?? "Fehler");
            setState("error");
          } else if (frame.t === "x") {
            termRef.current?.writeln(`\r\n[exit ${frame.code ?? "?"}]`);
            setState("closed");
          }
        } catch {
          /* ignore malformed */
        }
      });
      ws.addEventListener("close", () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
          setState((s) => (s === "open" || s === "connecting" ? "closed" : s));
        }
      });
      ws.addEventListener("error", () => {
        setError("WebSocket-Fehler");
        setState("error");
      });
      dataDispRef.current = termRef.current.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "i", d: data }));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verbindung fehlgeschlagen");
      setState("error");
    }
  };

  const empty = targets !== null && targets.length === 0;

  return (
    <div class="terminal-page" data-testid="terminal-page">
      <header class="terminal-toolbar">
        <label class="terminal-target">
          <span class="sr-only">Ziel</span>
          <select
            value={selected}
            disabled={!targets?.length || state === "connecting" || state === "open"}
            onChange={(e) => setSelected((e.target as HTMLSelectElement).value)}
            aria-label="Terminal-Ziel"
          >
            {(targets ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
            {empty && <option value="">Keine Ziele</option>}
          </select>
        </label>
        {state === "open" || state === "connecting" ? (
          <Button variant="subtle" onClick={disconnect} disabled={state === "connecting"}>Trennen</Button>
        ) : (
          <Button variant="primary" onClick={() => void connect()} disabled={!selected || empty}>
            Verbinden
          </Button>
        )}
        <span class="terminal-state dim" aria-live="polite">
          {state === "idle" && "bereit"}
          {state === "connecting" && "verbinde…"}
          {state === "open" && "verbunden"}
          {state === "closed" && "getrennt"}
          {state === "error" && "Fehler"}
        </span>
      </header>
      {empty && (
        <p class="ui-empty" data-testid="terminal-empty">
          Keine Terminal-Ziele. In <code>hub.config.json</code> unter <code>terminals</code> z. B.
          {" "}<code>{`{ "id": "evo", "label": "evox2", "ssh": "evo" }`}</code> eintragen (ADR-0087).
        </p>
      )}
      {error && <p class="ui-error" role="alert">{error}</p>}
      <div class="terminal-host" ref={hostRef} data-testid="terminal-xterm" />
    </div>
  );
}
