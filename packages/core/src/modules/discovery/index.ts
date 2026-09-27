/** Public API of this module (ADR-0020). Other modules import only from here. */
export { dedupeDiscovered, pageDiscovered } from "./dedupe.ts";
export { claudeDiscoverySource, cursorDiscoverySource, defaultClaudeDir, defaultCursorUserDir, defaultOpencodeDataDir, opencodeDiscoverySource, scanClaudeSessions, scanCursorComposers, scanOpencodeSessions } from "./sources.ts";
