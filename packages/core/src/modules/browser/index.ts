/** Public API of this module (ADR-0020, ADR-0059). */
export { BrowserService, BrowserError, chromiumLaunchOptions, type BrowserServiceOptions, type BrowserErrorCode } from "./browser-service.ts";
export { checkUrl, checkWebSocketUrl, resolveTarget, allowedOriginSet, serviceOrigins, normalizeOrigin, type GuardResult } from "./target-guard.ts";
export { composeBrowserFeedback } from "./feedback.ts";
