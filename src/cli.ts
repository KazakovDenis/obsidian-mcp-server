/**
 * Thin, safe wrapper around the `obsidian` CLI.
 *
 * Uses `execFile` (not `exec`) so no shell is involved — argv values pass
 * through verbatim, which means we don't have to worry about quoting,
 * special characters, or shell injection. Each CLI option of the form
 * `key=value` is one argv entry; boolean flags (like `total`, `verbose`)
 * are passed as standalone argv entries.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CLI_TIMEOUT_MS, DEFAULT_VAULT, OBSIDIAN_CLI_PATH } from "./constants.js";

const execFileAsync = promisify(execFile);

/**
 * One option for the CLI. Either:
 *   - `{ key, value }` → rendered as `key=value`
 *   - `{ flag }`       → rendered as `flag` (boolean switch)
 */
export type CliArg =
  | { key: string; value: string }
  | { flag: string };

export interface CliOptions {
  /** Optional vault name passed via `vault=<name>` global option. */
  vault?: string;
  /** Override the global timeout for this single invocation. */
  timeoutMs?: number;
}

export class ObsidianCliError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly stdout: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "ObsidianCliError";
  }
}

/**
 * Convert a string of content (which may contain real newlines/tabs) into the
 * `\n` / `\t` escape sequences that the CLI documents as required for content
 * values. We also escape backslashes so the round-trip preserves literal `\n`
 * the caller might want to write.
 */
export function escapeContent(content: string): string {
  return content
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

/** Build the argv array for `execFile`, optionally injecting `vault=...`. */
function buildArgv(command: string, args: CliArg[], opts: CliOptions): string[] {
  const argv: string[] = [command];
  const vault = opts.vault ?? DEFAULT_VAULT;
  if (vault) argv.push(`vault=${vault}`);
  for (const a of args) {
    if ("flag" in a) argv.push(a.flag);
    else argv.push(`${a.key}=${a.value}`);
  }
  return argv;
}

/**
 * Run an Obsidian CLI command and return stdout. Throws ObsidianCliError on
 * non-zero exit or stderr-only output. Stdout that contains a trailing newline
 * is preserved as-is so callers can choose to trim.
 */
export async function runObsidian(
  command: string,
  args: CliArg[] = [],
  opts: CliOptions = {},
): Promise<string> {
  const argv = buildArgv(command, args, opts);
  try {
    const { stdout, stderr } = await execFileAsync(OBSIDIAN_CLI_PATH, argv, {
      timeout: opts.timeoutMs ?? CLI_TIMEOUT_MS,
      // Generous buffer — vault listings can be large.
      maxBuffer: 10 * 1024 * 1024,
      // Force locale that doesn't reformat numbers/dates.
      env: { ...process.env, LC_ALL: "C" },
    });
    // The CLI is well-behaved and uses stderr only for errors. If it emitted
    // stderr but exit was 0, surface it as a leading warning so the agent
    // sees diagnostics but the call still succeeds.
    if (stderr && stderr.trim()) {
      return `${stdout}\n[stderr] ${stderr.trim()}`;
    }
    return stdout;
  } catch (err: unknown) {
    // execFile rejects on non-zero exit OR timeout. Both ExecException and
    // plain Error reach here; we normalize.
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
      signal?: string;
    };

    if (e.killed && e.signal === "SIGTERM") {
      throw new ObsidianCliError(
        `Obsidian CLI command '${command}' timed out after ${opts.timeoutMs ?? CLI_TIMEOUT_MS} ms.`,
        e.stderr ?? "",
        e.stdout ?? "",
        null,
      );
    }

    if (e.code === "ENOENT") {
      throw new ObsidianCliError(
        `Obsidian CLI not found at '${OBSIDIAN_CLI_PATH}'. ` +
          `Install it or set OBSIDIAN_CLI_PATH to the correct location.`,
        "",
        "",
        null,
      );
    }

    const exitCode =
      typeof e.code === "number" ? e.code : null;
    const stderr = (e.stderr ?? "").trim();
    const stdout = (e.stdout ?? "").trim();
    const detail = stderr || stdout || e.message;
    throw new ObsidianCliError(
      `Obsidian CLI command '${command}' failed: ${detail}`,
      stderr,
      stdout,
      exitCode,
    );
  }
}

/**
 * Build a `{key, value}` arg only if `value` is non-empty/non-undefined.
 * Helper that lets tool handlers stay compact.
 */
export function optArg(key: string, value: string | undefined | null): CliArg | null {
  if (value === undefined || value === null || value === "") return null;
  return { key, value: String(value) };
}

/** Same as optArg for boolean flags. Returns null when `enabled` is falsy. */
export function optFlag(flag: string, enabled: boolean | undefined): CliArg | null {
  return enabled ? { flag } : null;
}

/** Filter out null entries returned by optArg / optFlag. */
export function compactArgs(args: Array<CliArg | null>): CliArg[] {
  return args.filter((a): a is CliArg => a !== null);
}
