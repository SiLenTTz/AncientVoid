import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { GraphDiagnosis, GraphGroup, GraphReport } from "@ancientvoid/contracts";
import { hostApi } from "../../shared/api.ts";
import { ctxMotionOn } from "../../app/ui-scale.ts";
import { computeLayout } from "./graph-model.ts";

/** EPIC-P48 (ADR-0062 §3.4): Repo-Graph als Canvas — Knoten pulsieren organisch,
 * Kanten tragen seltene Lichtpulse. Layout wird einmalig berechnet und eingefroren;
 * ohne Motion (Nutzer- oder Systementscheid) gibt es genau ein statisches Bild. */

const GROUP_LABEL: Record<GraphGroup, string> = { doc: "Doc", code: "Code", config: "Config", other: "Sonstiges" };
const GROUP_VAR: Record<GraphGroup, string> = { doc: "--accent", code: "--graph-code", config: "--graph-config", other: "--graph-other" };
const PULSE_MAX = 60;
const PULSE_BUDGET = 400; // Kanten mit eigenem Spawner — Deckel gegen 10k-Kanten-Graphs
const PULSE_DURATION = 700;

interface Pulse {
  edge: number; // Index in edges
  start: number;
  dir: 1 | -1;
}

function hashOf(path: string): number {
  let h = 5381;
  for (let i = 0; i < path.length; i++) h = (Math.imul(h, 33) ^ path.charCodeAt(i)) >>> 0;
  return h;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function GraphPane({ target, hostId = null, onOpenFile }: { target: string; hostId?: string | null; onOpenFile: (path: string) => void }) {
  const api = useMemo(() => hostApi(hostId), [hostId]);
  const [report, setReport] = useState<GraphReport | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [diag, setDiag] = useState<GraphDiagnosis | null>(null);
  const [diagErr, setDiagErr] = useState("");
  const [checking, setChecking] = useState(false);
  const [hover, setHover] = useState<{ path: string; group: GraphGroup; in: number; out: number; x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [colorsTick, setColorsTick] = useState(0);
  const [motionOn, setMotionOn] = useState(() => !matchMedia("(prefers-reduced-motion: reduce)").matches && ctxMotionOn());
  const [viewTick, setViewTick] = useState(0);
  const [dragging, setDragging] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const drawRef = useRef<(() => void) | null>(null);
  const hoverRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    setReport(null);
    setLoadErr("");
    setDiag(null);
    setDiagErr("");
    api
      .graph(target)
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch((e: unknown) => {
        if (alive) setLoadErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [api, target]);

  const runCheck = () => {
    if (checking || !report) return;
    setChecking(true);
    setDiagErr("");
    api
      .graphDiagnose(target)
      .then((d) => {
        setDiag(d);
        setChecking(false);
      })
      .catch((e: unknown) => {
        setDiagErr(e instanceof Error ? e.message : String(e));
        setChecking(false);
      });
  };

  // Farben zur Laufzeit aus den CSS-Variablen — Akzent/Theme können wechseln.
  useEffect(() => {
    const bump = () => setColorsTick((t) => t + 1);
    const onStorage = (e: StorageEvent) => {
      if (!e.key) bump();
    };
    window.addEventListener("ancientvoid:appearance", bump);
    window.addEventListener("ancientvoid:theme", bump);
    window.addEventListener("storage", onStorage);
    // ctxMotion wird ohne Event gesetzt — der Dataset-Attributwechsel ist das Signal.
    const mo = new MutationObserver(() => setMotionOn(!matchMedia("(prefers-reduced-motion: reduce)").matches && ctxMotionOn()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ctx-motion"] });
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => setMotionOn(!mq.matches && ctxMotionOn());
    mq.addEventListener("change", onMq);
    return () => {
      window.removeEventListener("ancientvoid:appearance", bump);
      window.removeEventListener("ancientvoid:theme", bump);
      window.removeEventListener("storage", onStorage);
      mo.disconnect();
      mq.removeEventListener("change", onMq);
    };
  }, []);

  // Layout nur bei Daten- oder Größenwechsel — danach eingefroren.
  const layout = useMemo(
    () => (report ? computeLayout(report.nodes, report.edges, size.w, size.h) : null),
    [report, size.w, size.h],
  );
  const errorByPath = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of diag?.byFile ?? []) if (f.errors > 0) m.set(f.path, f.errors);
    return m;
  }, [diag]);
  // Knotenradius nach Grad (3–10 px) — einmal pro Datenstand, Draw und Hit-Test teilen ihn.
  const radii = useMemo(() => {
    let maxDeg = 1;
    for (const n of report?.nodes ?? []) maxDeg = Math.max(maxDeg, n.in + n.out);
    return new Float32Array((report?.nodes ?? []).map((n) => 3 + (7 * (n.in + n.out)) / maxDeg));
  }, [report]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || !layout || !report) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const nodes = report.nodes;
    const edges = report.edges;
    const w = size.w;
    const h = size.h;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const colors: Record<GraphGroup, string> = {
      doc: cssVar("--accent", "#7aa2f7"),
      code: cssVar("--graph-code", "#9ece6a"),
      config: cssVar("--graph-config", "#e0af68"),
      other: cssVar("--graph-other", "#a9b1d6"),
    };
    const errColor = cssVar("--err", "#f7768e");
    const fg = cssVar("--fg", "#c0caf5");

    // Puls-Phasen deterministisch aus dem Pfad — kein Flackern bei Neulayout.
    const phases = new Float32Array(nodes.length);
    const speeds = new Float32Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const hash = hashOf(nodes[i].path);
      phases[i] = ((hash % 997) / 997) * Math.PI * 2;
      speeds[i] = 0.5 + ((hash >>> 10) % 997) / 997; // 0.5–1.5
    }
    const errIdx = new Set<number>();
    for (let i = 0; i < nodes.length; i++) if (errorByPath.has(nodes[i].path)) errIdx.add(i);

    // Lichtpulse: Spawner auf einem gestreuten Kanten-Ausschnitt (Budget-Deckel).
    const stride = Math.max(1, Math.ceil(edges.length / PULSE_BUDGET));
    const spawnAt = new Float64Array(PULSE_BUDGET).fill(-1);
    let pulses: Pulse[] = [];

    const draw = (now: number | null) => {
      const { scale, tx, ty } = viewRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty);
      // Viewport in Weltkoordinaten (plus Rand) — Cull vor dem Zeichnen.
      const vx0 = -tx / scale - 20;
      const vy0 = -ty / scale - 20;
      const vx1 = (w - tx) / scale + 20;
      const vy1 = (h - ty) / scale + 20;
      const visible = (i: number) => {
        const p = layout.get(nodes[i].path);
        return p !== undefined && p.x >= vx0 && p.x <= vx1 && p.y >= vy0 && p.y <= vy1;
      };

      ctx.lineWidth = 1 / scale;
      ctx.strokeStyle = fg;
      ctx.globalAlpha = 0.26;
      ctx.beginPath();
      for (let i = 0; i < edges.length; i++) {
        const a = layout.get(edges[i].from);
        const b = layout.get(edges[i].to);
        if (!a || !b) continue;
        if ((a.x < vx0 && b.x < vx0) || (a.x > vx1 && b.x > vx1) || (a.y < vy0 && b.y < vy0) || (a.y > vy1 && b.y > vy1)) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      const animate = now !== null && motionOn;
      for (let i = 0; i < nodes.length; i++) {
        const p = layout.get(nodes[i].path);
        if (!p || !visible(i)) continue;
        const dead = nodes[i].in === 0 && !nodes[i].entry;
        const isErr = errIdx.has(i);
        const r = radii[i];
        if (animate) {
          const speed = isErr ? speeds[i] * 2.2 : speeds[i];
          const osc = 0.5 + 0.5 * Math.sin((now / 1000) * speed * Math.PI * 2 + phases[i]);
          ctx.globalAlpha = dead ? 0.55 : 0.55 + 0.45 * osc;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + osc * 1.2, 0, Math.PI * 2);
        } else {
          ctx.globalAlpha = dead ? 0.55 : 0.85;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        }
        ctx.fillStyle = isErr ? errColor : colors[nodes[i].group];
        if (nodes[i].group === "doc" && !dead) {
          ctx.shadowBlur = animate ? 6 + 8 * (0.5 + 0.5 * Math.sin((now / 1000) * speeds[i] * Math.PI * 2 + phases[i])) : 8;
          ctx.shadowColor = colors.doc;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      if (animate) {
        // Fällige Spawner abräumen, max. PULSE_MAX gleichzeitig aktiv.
        for (let s = 0; s < spawnAt.length; s++) {
          const edge = s * stride;
          if (edge >= edges.length) break;
          if (spawnAt[s] < 0) spawnAt[s] = now + 2000 + (hashOf(String(edge) + s) % 6000);
          else if (now >= spawnAt[s] && pulses.length < PULSE_MAX) {
            pulses.push({ edge, start: now, dir: hashOf(String(now) + edge) % 2 === 0 ? 1 : -1 });
            spawnAt[s] = now + 2000 + (hashOf(String(s) + String(now)) % 6000); // 2–8 s unregelmäßig
          }
        }
        pulses = pulses.filter((pu) => now - pu.start < PULSE_DURATION);
        for (const pu of pulses) {
          const a = layout.get(edges[pu.edge]?.from ?? "");
          const b = layout.get(edges[pu.edge]?.to ?? "");
          if (!a || !b) continue;
          const t = (now - pu.start) / PULSE_DURATION;
          const eased = pu.dir === 1 ? t : 1 - t;
          ctx.globalAlpha = Math.sin(Math.PI * t) * 0.9;
          ctx.fillStyle = colors.doc;
          ctx.shadowBlur = 10;
          ctx.shadowColor = colors.doc;
          ctx.beginPath();
          ctx.arc(a.x + (b.x - a.x) * eased, a.y + (b.y - a.y) * eased, 1.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        }
      }
    };
    drawRef.current = () => draw(null);

    let raf = 0;
    let running = false;
    const frame = (now: number) => {
      draw(now);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (running || !motionOn || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    if (motionOn) {
      start();
      document.addEventListener("visibilitychange", onVisibility);
    } else {
      draw(null);
    }
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      drawRef.current = null;
      pulses = [];
    };
  }, [layout, report, radii, size.w, size.h, motionOn, colorsTick, errorByPath]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const hitTest = (mx: number, my: number): number => {
    if (!report || !layout) return -1;
    const { scale, tx, ty } = viewRef.current;
    const wx = (mx - tx) / scale;
    const wy = (my - ty) / scale;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < report.nodes.length; i++) {
      const p = layout.get(report.nodes[i].path);
      if (!p) continue;
      const d = (p.x - wx) * (p.x - wx) + (p.y - wy) * (p.y - wy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return -1;
    const p = layout.get(report.nodes[best].path);
    if (!p) return -1;
    const r = radii[best];
    const limit = r + 4 / viewRef.current.scale;
    return bestD <= limit * limit ? best : -1;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const v = viewRef.current;
    const next = Math.min(8, Math.max(0.15, v.scale * Math.exp(-e.deltaY * 0.0015)));
    v.tx = mx - ((mx - v.tx) * next) / v.scale;
    v.ty = my - ((my - v.ty) * next) / v.scale;
    v.scale = next;
    drawRef.current?.();
    setViewTick((t) => t + 1);
  };

  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !report) return;
    const rect = canvas.getBoundingClientRect();
    const drag = dragRef.current;
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) {
        const v = viewRef.current;
        v.tx += dx;
        v.ty += dy;
        drag.x = e.clientX;
        drag.y = e.clientY;
        drawRef.current?.();
      }
      return;
    }
    const idx = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (idx >= 0) {
      const n = report.nodes[idx];
      hoverRef.current = n.path;
      setHover({ path: n.path, group: n.group, in: n.in, out: n.out, x: e.clientX - rect.left, y: e.clientY - rect.top });
    } else if (hoverRef.current !== null) {
      hoverRef.current = null;
      setHover(null);
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (drag?.moved) setViewTick((t) => t + 1);
    if (!drag || drag.moved || !report) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const idx = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (idx >= 0) onOpenFile(report.nodes[idx].path);
  };
  const onPointerLeave = () => {
    hoverRef.current = null;
    setHover(null);
  };

  const counts = useMemo(() => {
    const c: Record<GraphGroup, number> = { doc: 0, code: 0, config: 0, other: 0 };
    let dead = 0;
    for (const n of report?.nodes ?? []) {
      c[n.group]++;
      if (n.in === 0 && !n.entry) dead++;
    }
    return { c, dead };
  }, [report]);
  const errorTotal = diag ? diag.byFile.reduce((sum, f) => sum + f.errors, 0) : 0;
  // DOM-Hit-Flächen für E2E/Tastatur: die ~400 grad-stärksten Knoten, viewport-gecullt,
  // reines Overlay — Positionen werden nach Zoom/Pan-Ende nachgezogen, nicht pro Frame.
  const hitNodes = useMemo(() => {
    if (!report || !layout) return [];
    const { scale, tx, ty } = viewRef.current;
    const vx0 = -tx / scale - 20;
    const vy0 = -ty / scale - 20;
    const vx1 = (size.w - tx) / scale + 20;
    const vy1 = (size.h - ty) / scale + 20;
    return report.nodes
      .map((n, i) => ({ n, i, deg: n.in + n.out }))
      .filter(({ n }) => {
        const p = layout.get(n.path);
        return p !== undefined && p.x >= vx0 && p.x <= vx1 && p.y >= vy0 && p.y <= vy1;
      })
      .sort((a, b) => b.deg - a.deg)
      .slice(0, 400)
      .map(({ n, i }) => {
        const p = layout.get(n.path);
        if (!p) return null;
        const side = Math.max(10, (radii[i] + 4) * scale);
        return {
          path: n.path,
          dead: n.in === 0 && !n.entry,
          hasError: errorByPath.has(n.path),
          style: { left: `${p.x * scale + tx - side / 2}px`, top: `${p.y * scale + ty - side / 2}px`, width: `${side}px`, height: `${side}px` },
        };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);
  }, [report, layout, radii, errorByPath, size.w, size.h, viewTick]);


  return (
    <div class="graph-pane">
      <div class="graph-toolbar">
        {report && (
          <div class="graph-legend" data-testid="graph-legend">
            {(Object.keys(GROUP_LABEL) as GraphGroup[]).map((g) =>
              counts.c[g] > 0 ? (
                <span class="graph-chip" key={g}>
                  <span class={`graph-dot graph-dot-${g}`} />
                  {GROUP_LABEL[g]} {counts.c[g]}
                </span>
              ) : null,
            )}
            {counts.dead > 0 && (
              <span class="graph-chip graph-chip-dead">
                Tote Dateien {counts.dead}
              </span>
            )}
          </div>
        )}
        {report && (
          <button type="button" class="btn graph-check" aria-label="Graph prüfen" onClick={runCheck} disabled={checking}>
            {checking ? "Prüfe …" : "Prüfen"}
          </button>
        )}
      </div>
      {report?.meta.truncated && (
        <div class="graph-banner">
          Graph gekappt: {report.meta.files}/{report.meta.maxFiles} Dateien gezeigt — Filter verfeinern.
          {report.meta.unresolved > 0 && ` (${report.meta.unresolved} Spezifikatoren unaufgelöst)`}
        </div>
      )}
      {diag && (
        <div class="graph-diag">
          <div class="graph-diag-sources">
            {diag.sources.map((s) => (
              <div class={`graph-diag-source graph-diag-source-${s.state}`} key={s.name}>
                {s.name}: {s.state}
                {s.detail ? ` — ${s.detail}` : ""}
              </div>
            ))}
          </div>
          <div data-testid="graph-errors">{errorTotal} Fehler in {diag.byFile.filter((f) => f.errors > 0).length} Dateien</div>
        </div>
      )}
      {loadErr && <div class="files-error">Graph nicht ladbar: {loadErr}</div>}
      {diagErr && <div class="files-error">Prüfung fehlgeschlagen: {diagErr}</div>}
      <div class="graph-wrap" ref={wrapRef}>
        {!report && !loadErr && <div class="graph-state">Lade Graph …</div>}
        {report && report.nodes.length === 0 && <div class="graph-state">Keine Dateien im Ziel gefunden.</div>}
        <canvas
          ref={canvasRef}
          class="graph-canvas"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
        />
        <div class={`graph-node-hits${dragging ? " graph-node-hits-dragging" : ""}`}>
          {hitNodes.map((h) => (
            <button
              type="button"
              key={h.path}
              class={`graph-node-hit${h.hasError ? " has-error" : ""}${h.dead ? " dead" : ""}`}
              aria-label={`Datei ${h.path} öffnen`}
              style={h.style}
              onClick={() => onOpenFile(h.path)}
            />
          ))}
        </div>
        {hover && (
          <div class="graph-tooltip" style={{ left: `${hover.x + 12}px`, top: `${hover.y + 12}px` }}>
            <div class="graph-tooltip-path">{hover.path}</div>
            <div>
              {GROUP_LABEL[hover.group]} · Zufluss {hover.in} · Ausgehend {hover.out}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
