# Security Policy

## Supported versions

AncientVoid is a solo-maintained, pre-1.0 project. Only the latest state of
`main` is supported.

| Version | Supported |
|---|---|
| 0.1.x (`main`) | yes |
| anything older | no |

## Reporting a vulnerability

Please **do not** report vulnerabilities in public issues, merge requests or
discussions, and do not publish exploit code before a fix is available.

Instead, use GitHub's **private vulnerability reporting**:
<https://github.com/securesight-ai/AncientVoid/security/advisories/new>
(repository tab *Security* → *Report a vulnerability*). Only the maintainer
can see the report. If you cannot use GitHub, e-mail
<jan.pfrommer@securesight.ai> instead.

Include, as far as possible:

- affected component (hub, PWA, hubctl, adapter, gateway-mcp, companion, setup)
  and commit/version,
- reproduction steps or a minimal proof of concept,
- impact (what an attacker can reach, under which preconditions — e.g. from
  inside the tailnet, with a device token, as an agent),
- your environment (OS, Node version, config deviations),
- logs **with tokens, hostnames, IPs and personal data removed**.

## What to expect

This is a spare-time project with a single maintainer, so responses are
**best effort**:

- acknowledgement usually within a week,
- an assessment and, for confirmed issues, a fix or mitigation plan as soon as
  practical — critical issues (e.g. remote code execution, auth bypass) first,
- credit in the fix commit or release note if you want it.

There is no bug bounty.

## Threat model in short

Details, evidence and known gaps: [`docs/security.md`](docs/security.md)
(German), based on PRD §8.

- **Local-first, no public port.** The hub binds `127.0.0.1` by default and is
  meant to be reached only through `tailscale serve` inside your tailnet.
  `ANCIENTVOID_EXPOSE=1` (bind all interfaces) is an explicit opt-in at your
  own risk.
- **Identity.** Every API request needs a device token; tokens are stored only as
  SHA-256 hashes and shown in plaintext once, at issue time. Optionally the hub
  additionally requires a Tailscale identity (`enforceTailnetIdentity`).
  Integrations get scoped `agent:` (read, writes need approval) or `display:`
  tokens instead of human device tokens.
- **Approvals.** External state changes are classified `read` / `write` /
  `destructive`; destructive actions require WebAuthn; timeouts and unknown
  errors fail closed; every decision is audited in the session log.
- **Prompt-injection boundary (PRD §8.5).** Agent output is rendered as data,
  never interpreted as an instruction by the hub or the PWA. There is no free
  shell from the phone — only registered adapter operations with
  server-constructed arguments.
- **Agents themselves are trusted with your user's permissions.** A coding
  agent the hub runs can do anything your OS user can. With
  `toolApprovals: "auto"` tool calls are allowed without asking (still
  audited). The tailnet is the trust boundary.

In scope: the hub's HTTP/WebSocket API, authentication and token handling,
approval enforcement, the PWA, hubctl, setup scripts, adapters'
handling of untrusted provider output, gateway-mcp and the companion.
Out of scope: vulnerabilities in third-party agent CLIs, Tailscale, or Node
itself; attacks that require an already compromised OS account on the host.

## Hardening advice for operators

- **Never expose the hub to the internet.** Do not port-forward 7373, do not
  put it behind a public reverse proxy, do not set `ANCIENTVOID_EXPOSE=1` on a
  machine with a public interface. Use `scripts/setup-tailscale-serve.sh`.
- Restrict your tailnet with Tailscale ACLs so only your own devices reach the
  hub, and consider `enforceTailnetIdentity: true`.
- **One token per device**, with a meaningful label. Rotate or revoke tokens
  you no longer trust:
  `hubctl token list` · `hubctl token revoke <label>` · `hubctl token issue <label>`.
- Give integrations the least privilege they need (`--agent`, `--display`).
- Keep `toolApprovals` at the default `"ask"` unless you accept the risk.
- Keep `data/` and `hub.config.json` private (file mode 600 for token files);
  they are git-ignored for a reason.
- Keep Node and dependencies up to date (`npm audit`).
