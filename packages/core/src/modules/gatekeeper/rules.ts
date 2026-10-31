import { isAbsolute, relative, resolve } from "node:path";
import { QUESTION_TOOLS, stricterGate, stricterRisk, type RuleVerdict, type SecurityGate, type ToolRisk } from "@ancientvoid/contracts";

/**
 * T7.9: fixed rules — the floor under the model. They catch the obvious
 * cases even when the model is down, and the model can never go below them.
 * Deliberately simple and readable; the model handles the nuance.
 */

const READ_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead", "TodoWrite", "todowrite", "Lesen", "Suchen", "read", "grep", "glob", "list", "Denken"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "Bearbeiten", "write", "edit", "apply_patch", "fileChange"]);
const FETCH_TOOLS = new Set(["WebFetch", "WebSearch", "Web-Abruf", "webfetch", "fetch"]);
const SHELL_TOOLS = new Set(["Bash", "Shell", "bash", "shell", "commandExecution", "execute", "terminal"]);

/** Secrets and places an agent has no business reading or writing. */
const SECRET = /(\.ssh\/|id_(rsa|ed25519|ecdsa)|\.gnupg|\.aws\/credentials|\.netrc|\.npmrc|\.pypirc|\.docker\/config\.json|\/etc\/shadow|\.env\b|secrets?\.(json|ya?ml|toml)|\.kube\/config|\.config\/gh\/hosts|ancientvoid.*\.db|hub\.db|keychain|\bprintenv\b|\benv\s*(\||>|$))/i;
const NETWORK = /\b(curl|wget|nc|ncat|netcat|scp|sftp|rsync|ssh|ftp|telnet|socat|Invoke-WebRequest|iwr)\b/i;
const UPLOAD = /(\s-d\s|\s--data(-\w+)?[\s=]|\s-F\s|\s--form\b|\s-T\s|\s--upload-file\b|-X\s*(POST|PUT|PATCH)|\bscp\b|\brsync\b.*:|\bnc\b.*\d+\s*<|\|\s*(curl|nc|wget)\b)/i;
const PIPE_TO_SHELL = /(curl|wget)[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b|\beval\s+"?\$\((curl|wget)/i;
const DESTRUCTIVE = /(\brm\s+-[a-z]*[rf]|\brm\s+-[a-z]*\s|\bgit\s+push\b[^\n]*(--force|\s-f\b)|\bgit\s+reset\s+--hard|\bgit\s+clean\s+-[a-z]*f|\bgit\s+branch\s+-D\b|\bgit\s+checkout\s+--\s|\bdd\s+if=|\bmkfs|\bshred\b|\btruncate\s|\bchmod\s+-R|\bchown\s+-R|\bfind\b[^\n]*-delete|\bdrop\s+(table|database)\b|:\(\)\s*\{|>\s*\/dev\/sd|\bkill(all)?\s+-9|\bsystemctl\s+(--user\s+)?(stop|disable|mask|kill)|\bdocker\s+(rm|rmi|system\s+prune)|\bnpm\s+publish\b)/i;
const WIDE_TARGET = /(\s\/(\s|$|\*)|\s~\/?(\s|$)|\$HOME\/?(\s|$)|\s\.\.(\/|\s|$)|\s\/(etc|usr|var|boot|home)\b|--no-preserve-root)/;
const WRITES = /(>|>>|\btee\b|\bmkdir\b|\btouch\b|\bmv\b|\bcp\b|\bsed\s+-i|\bnpm\s+(i|install|ci|update)\b|\bpnpm\b|\byarn\b|\bpip\s+install\b|\bgit\s+(commit|add|checkout|switch|merge|rebase|stash|tag|apply)\b|\bchmod\b|\bln\b|\bpatch\b|\bmake\b|\bcargo\s+build\b)/;
const READ_ONLY_CMD = /^\s*(ls|cat|head|tail|less|wc|grep|rg|find|pwd|echo|printf|which|file|stat|tree|du|df|git\s+(status|log|diff|show|branch|remote\s+-v|rev-parse|blame)|node\s+--version|npm\s+(ls|test|run\s+(test|lint|typecheck))|pytest|python3?\s+-m\s+pytest|jq|sort|uniq|cut|date|uname|whoami|env\s+--help)\b/;
const INJECTION = /(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+(rules|instructions)|you\s+are\s+now\s+|label\s+(this|it|everything)\s+clean|answer\s+clean/i;
const BULK_UPLOAD = /(\btar\b[^|]*\||\bscp\s+-[a-z]*r|\brsync\s+-[a-z]*a|\b\d{1,3}(\.\d{1,3}){3}\b)/;
const PACKAGES = /\b(npm|pnpm|yarn)\s+(i|install|add|ci|update)\b|\bpip3?\s+install\b|\bcargo\s+(add|install)\b|\bgo\s+get\b/;
const PRIVILEGE = /\b(sudo|su\s|doas|pkexec)\b/;

/**
 * BUG-0051: `cat > file <<'EOF' … EOF` (and `tee`) only WRITES the body into a file; the body is
 * never run, so words like `rm -rf` inside it are no reason to ask for a passkey. The body is dropped
 * only when the heredoc line ends at the marker — `cat <<EOF | bash`, `bash <<EOF` and
 * `cat > f <<EOF; bash f` keep their body, because there it can run.
 */
const FILE_HEREDOC = /((?:^|[;&|\n])\s*(?:cat|tee)\b[^\n;&|<]*<<-?[ \t]*(['"]?)(\w+)\2[ \t]*\n)[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g;

export function withoutFileHeredocs(cmd: string): string {
  return cmd.replace(FILE_HEREDOC, "$1");
}

function outsideWorktree(path: string, workdir: string | null): boolean {
  if (!workdir) return false;
  const full = isAbsolute(path) ? path : resolve(workdir, path);
  const rel = relative(workdir, full);
  return rel.startsWith("..") || isAbsolute(rel);
}

function textOf(input: Record<string, unknown>): string {
  for (const key of ["command", "cmd", "commands"]) {
    const v = input[key];
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map(String).join(" ");
  }
  return "";
}

function pathOf(input: Record<string, unknown>): string | null {
  for (const key of ["file_path", "path", "notebook_path", "filePath"]) if (typeof input[key] === "string") return input[key] as string;
  return null;
}

export function assessByRules(toolName: string, input: Record<string, unknown>, workdir: string | null): RuleVerdict {
  let risk: ToolRisk = "READ_ONLY";
  let gate: SecurityGate = "CLEAN";
  const notes: string[] = [];
  const raise = (r: ToolRisk, g: SecurityGate, note: string) => {
    risk = stricterRisk(risk, r);
    gate = stricterGate(gate, g);
    if (!notes.includes(note)) notes.push(note);
  };

  if ((QUESTION_TOOLS as readonly string[]).includes(toolName)) return { toolRisk: "READ_ONLY", securityGate: "CLEAN", notes: ["Rückfrage an dich"] };

  const path = pathOf(input);
  if (INJECTION.test(JSON.stringify(input))) raise("READ_ONLY", "WARNING", "mögliche Prompt-Injection");
  if (READ_TOOLS.has(toolName)) {
    if (path && SECRET.test(path)) raise("READ_ONLY", "WARNING", "liest eine Geheimnis-Datei");
    if (path && outsideWorktree(path, workdir)) raise("READ_ONLY", "WARNING", "liest außerhalb des Worktrees");
  } else if (WRITE_TOOLS.has(toolName)) {
    raise("LOCAL_WRITE", "CLEAN", "ändert eine Datei");
    if (path && outsideWorktree(path, workdir)) raise("DESTRUCTIVE", "WARNING", "schreibt außerhalb des Worktrees");
    if (path && (SECRET.test(path) || /(^|\/)\.git\//.test(path))) raise("DESTRUCTIVE", "CRITICAL_BLOCK", "schreibt in Geheimnisse oder .git");
  } else if (FETCH_TOOLS.has(toolName)) {
    raise("READ_ONLY", "WARNING", "Netzwerkzugriff");
  } else if (SHELL_TOOLS.has(toolName) || textOf(input)) {
    const cmd = withoutFileHeredocs(textOf(input));
    if (!READ_ONLY_CMD.test(cmd) || /[;&|`$]/.test(cmd.replace(/\|\|/g, ""))) raise("LOCAL_WRITE", "CLEAN", "Shell-Befehl");
    if (WRITES.test(cmd)) raise("LOCAL_WRITE", "CLEAN", "Shell schreibt");
    if (DESTRUCTIVE.test(cmd)) raise("DESTRUCTIVE", "WARNING", "löscht oder überschreibt");
    if (DESTRUCTIVE.test(cmd) && WIDE_TARGET.test(` ${cmd}`)) raise("DESTRUCTIVE", "CRITICAL_BLOCK", "zerstörerisch auf weitem Ziel");
    if (PRIVILEGE.test(cmd)) raise("DESTRUCTIVE", "WARNING", "erhöhte Rechte");
    if (SECRET.test(cmd)) raise("READ_ONLY", "WARNING", "berührt Geheimnisse");
    if (NETWORK.test(cmd)) raise("READ_ONLY", "WARNING", "Netzwerk");
    if (NETWORK.test(cmd) && UPLOAD.test(cmd)) raise("EXFILTRATION", "WARNING", "sendet Daten nach außen");
    if (NETWORK.test(cmd) && SECRET.test(cmd)) raise("EXFILTRATION", "CRITICAL_BLOCK", "Geheimnis + Netzwerk");
    if (/\bgit\s+push\b/.test(cmd)) raise("LOCAL_WRITE", "WARNING", "veröffentlicht (git push)");
    if (/\bgit\s+push\b[^\n]*(--force|\s-f\b)[^\n]*\b(main|master|release)\b/.test(cmd)) raise("DESTRUCTIVE", "CRITICAL_BLOCK", "überschreibt die Historie von main");
    if (PACKAGES.test(cmd)) raise("LOCAL_WRITE", "WARNING", "lädt Pakete aus dem Netz");
    if (NETWORK.test(cmd) && UPLOAD.test(cmd) && BULK_UPLOAD.test(cmd)) raise("EXFILTRATION", "CRITICAL_BLOCK", "sendet Projektdaten nach außen");
    if (PIPE_TO_SHELL.test(cmd)) raise("DESTRUCTIVE", "CRITICAL_BLOCK", "führt Code aus dem Netz aus");
  } else {
    // Unknown tool (MCP etc.): may do anything.
    raise("LOCAL_WRITE", "WARNING", `unbekanntes Werkzeug ${toolName.slice(0, 40)}`);
  }
  return { toolRisk: risk, securityGate: gate, notes: notes.slice(0, 4) };
}
