/**
 * Shared constants. All values are configurable via environment variables
 * so a user can point at a non-standard CLI location or a different Omnisearch
 * port without rebuilding.
 */

/** Path to the Obsidian CLI binary. */
export const OBSIDIAN_CLI_PATH =
  process.env.OBSIDIAN_CLI_PATH || "/usr/local/bin/obsidian";

/** Base URL of the Omnisearch HTTP server exposed by the Omnisearch plugin. */
export const OMNISEARCH_URL =
  process.env.OBSIDIAN_OMNISEARCH_URL || "http://localhost:51361";

/** Timeout for a single CLI invocation. Some commands (e.g. reload) may be slow. */
export const CLI_TIMEOUT_MS = Number(process.env.OBSIDIAN_CLI_TIMEOUT_MS || 30_000);

/** Timeout for HTTP calls to Omnisearch. */
export const OMNISEARCH_TIMEOUT_MS = Number(
  process.env.OBSIDIAN_OMNISEARCH_TIMEOUT_MS || 15_000,
);

/**
 * Maximum size of a single tool response in characters. Larger responses are
 * truncated with a clear message instructing the agent how to narrow the
 * query. Mirrors the convention recommended in the MCP best-practices guide.
 */
export const CHARACTER_LIMIT = 25_000;

/** Default vault name to pass via `vault=<name>` when the caller omits it. */
export const DEFAULT_VAULT = process.env.OBSIDIAN_DEFAULT_VAULT || undefined;

/** Server identity, surfaced during the MCP `initialize` handshake. */
export const SERVER_NAME = "obsidian-mcp-server";
export const SERVER_VERSION = "1.0.0";
