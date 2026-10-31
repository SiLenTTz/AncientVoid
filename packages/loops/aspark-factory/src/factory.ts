import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LoopOnboardResult, LoopOnboarding } from "@ancientvoid/contracts";

/**
 * Anbindung an `factoryctl` der aSPARK-Factory: bestehende Linien lesen und ein neues Repo einrichten
 * (`factoryctl new`). Der Hub geht dieselben Schritte wie die Person am Terminal; das Repo-Token wandert nur
 * über stdin in den Prompt von factoryctl (getpass) und steht nirgends sonst, auch nicht in Fehlertexten.
 */

export const expandHome = (p: string): string => (p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

/** Wert eines Schlüssels aus einer KEY=value-Datei (factory.env). Nur dieser eine Wert wird gelesen. */
export function readEnvValue(file: string, key: string): string | undefined {
  for (const line of readFileSync(expandHome(file), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && m[1] === key) return m[2]?.replace(/^(['"])(.*)\1$/, "$2");
  }
  return undefined;
}

export interface KnownLine {
  name: string;
  repo: string;
  mode: string;
}

/** Die Linien unter FACTORY_HOME/lines. Aus line.env nur die drei Anzeigeschlüssel, nie Tokens. */
export function knownLines(home: string): KnownLine[] {
  const dir = join(expandHome(home), "lines");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      try {
        const file = join(dir, d.name, "line.env");
        return [{ name: d.name, repo: readEnvValue(file, "LINE_REPO") ?? "?", mode: readEnvValue(file, "LINE_MODE") ?? "?" }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const RESERVED = new Set(["all", "leitstand", "admin"]);
const REPO = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const ONBOARD_MODES = ["manual", "supervised", "autonomous"] as const;

export const ONBOARDING: LoopOnboarding = {
  optionKey: "line",
  label: "Neues Repo anbinden",
  fields: [
    { key: "repo", label: "Repo", kind: "text", required: true, placeholder: "owner/name (GitLab: group/untergruppe/name)" },
    { key: "name", label: "Name der Linie", kind: "text", placeholder: "leer = Name des Repos" },
    { key: "type", label: "Art", kind: "select", choices: [{ value: "project", label: "Projekt" }, { value: "environment", label: "Umgebung" }] },
    { key: "mode", label: "Betriebsart", kind: "select", choices: ONBOARD_MODES.map((m) => ({ value: m, label: m })) },
    { key: "gitlabUrl", label: "GitLab-Server", kind: "text", placeholder: "leer = GitHub; sonst z. B. https://gitlab.com" },
  ],
  secret: { label: "Repo-Token", hint: "GitHub: Issues, Contents, Pull requests (schreiben). GitLab: Scope api, mindestens Developer." },
};

/** Der Linienname aus den Angaben: ausdrücklich gewählt, sonst der Repo-Name in Kleinbuchstaben. */
export function lineNameFor(options: Record<string, string>): string {
  const given = options.name?.trim();
  if (given) return given;
  const last = (options.repo ?? "").trim().split("/").pop() ?? "";
  return last.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

// eslint-disable-next-line no-control-regex -- ANSI-Steuerzeichen aus factoryctl sollen weg
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function scrub(text: string, secret: string): string {
  const clean = text.replace(ANSI, "").replace(/\r/g, "");
  return secret ? clean.split(secret).join("•••") : clean;
}

export interface FactoryConfig {
  factoryctl: string;
  home: string;
  python: string;
}

/** Läuft `factoryctl new` für ein Repo. Wirft nie: jeder Fehler kommt als `ok: false` mit lesbarem Grund. */
export async function onboardLine(cfg: FactoryConfig, input: { options: Record<string, string>; secret: string }, signal: AbortSignal): Promise<LoopOnboardResult> {
  const o = input.options;
  const repo = o.repo?.trim() ?? "";
  const name = lineNameFor(o);
  const type = o.type?.trim() || "project";
  const mode = o.mode?.trim() || "supervised";
  const gitlabUrl = o.gitlabUrl?.trim() ?? "";
  if (!input.secret.trim()) return { ok: false, detail: "Das Repo-Token fehlt" };
  if (!REPO.test(repo)) return { ok: false, detail: "Repo: owner/name (bei GitLab group/…/name)" };
  if (!NAME.test(name) || RESERVED.has(name)) return { ok: false, detail: `Name der Linie „${name}“ geht nicht (a–z, 0–9, -; nicht all, leitstand, admin)` };
  if (type !== "project" && type !== "environment") return { ok: false, detail: "Art: Projekt oder Umgebung" };
  if (!(ONBOARD_MODES as readonly string[]).includes(mode)) return { ok: false, detail: "Betriebsart beim Anbinden: manual, supervised oder autonomous (dark später, mit Bestätigung)" };
  if (gitlabUrl) {
    try {
      if (!/^https?:$/.test(new URL(gitlabUrl).protocol)) throw new Error("protocol");
    } catch {
      return { ok: false, detail: "GitLab-Server: eine http(s)-Adresse" };
    }
  }
  const home = expandHome(cfg.home);
  if (!existsSync(join(home, "factory.env"))) {
    return { ok: false, detail: `Die Factory ist noch nicht eingerichtet: einmal „${cfg.factoryctl} setup“ im Terminal ausführen (Claude-Token, Broker).` };
  }
  const existing = knownLines(home).find((l) => l.name === name);
  if (existing) {
    return existing.repo === repo
      ? { ok: true, options: { line: name }, detail: `Linie „${name}“ gibt es schon für ${repo}` }
      : { ok: false, detail: `Linie „${name}“ gibt es schon, aber für ${existing.repo}. Anderen Namen wählen.` };
  }
  if (!existsSync(expandHome(cfg.factoryctl))) return { ok: false, detail: `factoryctl nicht gefunden: ${cfg.factoryctl}` };

  const args = [expandHome(cfg.factoryctl), "new", name, "--repo", repo, "--type", type, "--mode", mode, ...(gitlabUrl ? ["--gitlab-url", gitlabUrl] : [])];
  return new Promise<LoopOnboardResult>((resolve) => {
    // detached = eigene Sitzung ohne Terminal: getpass liest dann das Token von stdin statt von /dev/tty.
    const child = spawn(cfg.python, args, { detached: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, FACTORY_HOME: home, PYTHONUNBUFFERED: "1", NO_COLOR: "1" } });
    let out = "";
    const take = (b: Buffer) => {
      out = (out + b.toString("utf8")).slice(-4000);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const abort = () => child.pid && process.kill(-child.pid, "SIGTERM");
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", (err) => resolve({ ok: false, detail: `factoryctl nicht startbar: ${err.message}` }));
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (code === 0 && existsSync(join(home, "lines", name, "line.env"))) {
        resolve({ ok: true, options: { line: name }, detail: `Linie „${name}“ für ${repo} angelegt und gestartet` });
        return;
      }
      const lines = scrub(out, input.secret).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("Warning: Password") && !l.startsWith("›"));
      const why = signal.aborted ? "Zeitüberschreitung beim Anlegen der Linie" : lines.slice(-3).join(" · ").slice(0, 400) || `factoryctl endete mit Code ${code}`;
      resolve({ ok: false, detail: why });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(`${input.secret}\n`);
  });
}
