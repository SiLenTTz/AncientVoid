import { useEffect, useState } from "preact/hooks";
import type { HubApi, PcState } from "../../shared/api.ts";

/**
 * EPIC-P15 T15.4: ist die Session am PC in einem Terminal offen? Die interaktive
 * Claude Code liest ihr Transcript nicht neu — was vom Handy kommt, steht dort erst
 * nach dem erneuten Öffnen. Die App sagt das und nennt den Befehl, statt den PC
 * veraltet aussehen zu lassen.
 */
export function PcOpenNotice({ sessionId, api }: { sessionId: string; api: HubApi }) {
  const [pc, setPc] = useState<PcState>({ open: false });
  useEffect(() => {
    let alive = true;
    let closedInARow = 0;
    const load = () =>
      api
        .sessionPc(sessionId)
        .then((state) => {
          if (!alive) return;
          // BUG-0049: "closed" has to hold for three reads before the notice goes — one empty read
          // (a slow `claude agents`) must not make it blink and push the layout.
          closedInARow = state.open ? 0 : closedInARow + 1;
          if (!state.open && closedInARow < 3) return;
          setPc((prev) => (prev.open === state.open && prev.name === state.name && prev.kind === state.kind ? prev : state));
        })
        .catch(() => undefined); // ein Fehlschlag lässt den Hinweis stehen (BUG-0045)
    void load();
    const timer = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionId, api]);
  if (!pc.open) return null;
  const short = (pc.nativeSessionId ?? "").slice(0, 8);
  return (
    <div class="pc-open-notice dim" role="note">
      <strong>💻 Am PC offen{pc.name ? ` (${pc.name})` : ""}.</strong>{" "}
      {pc.kind === "background" ? (
        <>
          Hintergrund-Session — am PC live mit <code>claude attach {short}</code>.
        </>
      ) : (
        <>
          Was du hier schickst, steht im Verlauf; die offene PC-Ansicht zeigt es erst nach <code>claude --resume {pc.nativeSessionId}</code>.
        </>
      )}
    </div>
  );
}
