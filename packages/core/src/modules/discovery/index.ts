/** Public API of this module (ADR-0020). Other modules import only from here. */
export { dedupeDiscovered, filterDiscovered, pageDiscovered } from "./dedupe.ts";
export { readOpenCodeMirrorDelta, type MirrorEventInput, type OpenCodeMirrorInfo } from "./opencode-mirror.ts";
export { claudeDiscoverySource, cursorDiscoverySource, defaultClaudeDir, defaultCursorUserDir, defaultOpencodeDataDir, opencodeDiscoverySource, scanClaudeSessions, scanCursorComposers, scanOpencodeSessions } from "./sources.ts";
export { ClaudeLive, parseClaudeAgents, type AgentsRunner, type ClaudeLiveSession } from "./claude-live.ts";
export { defaultOmpDir, defaultPiDir, findPiFamilySessionFile, piFamilyDiscoverySource, scanPiFamilySessions } from "./pi-family.ts";
export { codexDiscoverySource, defaultCodexDir, scanCodexSessions } from "./codex.ts";
export { defaultHermesDir, hermesDiscoverySource, scanHermesSessions } from "./hermes.ts";
export { classifyProject, type ProjectOrigin } from "./project-origin.ts";
export { defaultMakiDir, makiDiscoverySource, scanMakiSessions } from "./maki.ts";
