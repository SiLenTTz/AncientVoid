import { chmod, mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE_TOKEN_PREFIX } from "@ancientvoid/contracts";
import type { TokenService } from "@ancientvoid/core";

const BRIDGE_MAIN = fileURLToPath(new URL("../../../../gateway-mcp/src/permission-main.ts", import.meta.url));

/** claude's name for the bridge's tool: `mcp__<server>__<tool>`. */
export const PERMISSION_PROMPT_TOOL = "mcp__ancientvoid__permission";

/**
 * T7.2: per session an MCP config (mode 0600) that starts the permission
 * bridge with a token bound to that session. The token lives in the file,
 * never on a command line. After a hub restart the file and its token stay
 * valid, so a claude turn that survived (ADR-0014) keeps asking the same way.
 */
export function createPermissionBridge(opts: { tokens: TokenService; hubUrl: string; dir: string }) {
  return async (sessionId: string): Promise<{ mcpConfigPath: string; toolName: string }> => {
    const label = `${BRIDGE_TOKEN_PREFIX}${sessionId}`;
    const path = join(opts.dir, `${sessionId}.mcp.json`);
    const known = opts.tokens.list().some((t) => t.label === label);
    const exists = await access(path).then(
      () => true,
      () => false,
    );
    if (!(known && exists)) {
      opts.tokens.revoke(label);
      const { token } = opts.tokens.issue(label);
      await mkdir(opts.dir, { recursive: true, mode: 0o700 });
      const config = {
        mcpServers: {
          ancientvoid: {
            command: process.execPath,
            args: [BRIDGE_MAIN],
            env: { ANCIENTVOID_HUB_URL: opts.hubUrl, ANCIENTVOID_BRIDGE_TOKEN: token, ANCIENTVOID_SESSION_ID: sessionId },
          },
        },
      };
      await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
      await chmod(path, 0o600);
    }
    return { mcpConfigPath: path, toolName: PERMISSION_PROMPT_TOOL };
  };
}
