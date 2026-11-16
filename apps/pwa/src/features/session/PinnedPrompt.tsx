import type { NormalizedEvent } from "../../shared/ws.ts";
import { useApi } from "../../shared/api-context.ts";
import { visibleEventText } from "./event-text.ts";
import { useFullEvent } from "./event-blobs.ts";

export function PinnedPrompt({ event, onJump }: { event: NormalizedEvent; onJump: () => void }) {
  const { event: full } = useFullEvent(event, useApi());
  const text = visibleEventText(full);
  return <button type="button" class="pinned-prompt" aria-label={`Letzter Auftrag: ${text}`} title={text} onClick={onJump}>
    <span class="pinned-prompt-label">Letzter Auftrag</span>
    <span class="pinned-prompt-text">{text}</span>
    <span aria-hidden="true">↑</span>
  </button>;
}
