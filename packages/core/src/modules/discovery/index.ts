/** Public API of this module (ADR-0020). Other modules import only from here. */
export { dedupeDiscovered, pageDiscovered } from "./dedupe.ts";
export { readOpenCodeMirrorDelta, type MirrorEventInput, type OpenCodeMirrorInfo } from "./opencode-mirror.ts";
export { claudeDiscoverySource, cursorDiscoverySource, defaultClaudeDir, defaultCursorUserDir, defaultOpencodeDataDir, opencodeDiscoverySource, scanClaudeSessions, scanCursorComposers, scanOpencodeSessions } from "./sources.ts";
export { ClaudeLive, parseClaudeAgents, type AgentsRunner, type ClaudeLiveSession } from "./claude-live.ts";
