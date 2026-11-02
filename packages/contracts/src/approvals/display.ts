/**
 * ADR-0048: a display (e.g. VoidWarden's ESP32 terminal) shows the hub's state
 * and may decide `write` approvals by touch — nothing else. Its token label is
 * `display:<name>`; the routes below are the only ones it reaches.
 */
export const DISPLAY_TOKEN_PREFIX = "display:";

const READ_ROUTES = [
  /^\/api\/(health|ready|notifications|approvals|sessions)$/,
  /^\/api\/(approvals|sessions)\/[^/]+$/,
];
const DECIDE_ROUTE = /^\/api\/approvals\/[^/]+\/decide$/;

export function displayTokenAllows(method: string, path: string): boolean {
  if (method === "GET" || method === "HEAD") return READ_ROUTES.some((re) => re.test(path));
  return method === "POST" && DECIDE_ROUTE.test(path);
}
