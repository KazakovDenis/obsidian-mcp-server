/**
 * Generic escape hatch.
 *
 * Wraps an arbitrary `obsidian <command> [args]` invocation. Useful for the
 * many CLI commands not covered by dedicated tools (bases, bookmarks, plugins,
 * themes, hotkeys, workspace, dev:* commands, etc.) without bloating the tool
 * list. Pair this with the `obsidian help` introspection it surfaces by
 * default so an agent can discover what's available.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { runObsidian } from "../cli.js";
import { errorResult, successResult, trimTrailingNewline } from "../format.js";
import { vaultField } from "../schemas.js";
import { formatCliError } from "./notes.js";

// Conservative deny-list: actions that could destabilize the user's setup.
// These can still be reached by setting OBSIDIAN_MCP_ALLOW_RESTART=1, but the
// default is to refuse — it's almost never what an agent should do unprompted.
const DANGEROUS_COMMANDS = new Set<string>([
  "restart",
  "reload",
  "plugin:uninstall",
  "theme:uninstall",
  "plugins:restrict",
]);

const ObsidianCliShape = {
  command: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9:_-]*$/i, "Invalid command — must match obsidian CLI command syntax.")
    .describe(
      "The obsidian CLI command name, e.g. 'help', 'bases', 'tags', 'plugins', 'workspace'. " +
        "Run with command='help' to discover available commands.",
    ),
  args: z
    .array(z.string())
    .default([])
    .describe(
      "List of additional argv tokens to pass after the command. " +
        "Each entry is one argv element (no shell splitting). " +
        "Use 'key=value' for keyed options or bare flag names for booleans. " +
        "Examples: ['filter=daily', 'verbose'] or ['id=daily-notes'].",
    ),
  vault: vaultField,
} as const;
type ObsidianCliInput = z.infer<z.ZodObject<typeof ObsidianCliShape>>;

export function registerCliTool(server: McpServer) {
  server.registerTool(
    "obsidian_cli",
    {
      title: "Run Obsidian CLI Command",
      description:
        "Escape hatch: run any Obsidian CLI command not covered by a dedicated tool. " +
        "Returns the raw stdout.\n\n" +
        "Use this for advanced/uncommon operations like:\n" +
        "  - bases / base:query / base:views\n" +
        "  - bookmarks, hotkeys, workspace, recents\n" +
        "  - plugins, themes, snippets\n" +
        "  - history, diff, deadends, orphans, unresolved\n" +
        "  - templates, commands\n\n" +
        "Discover the command list with command='help', then read details with " +
        "command='help' and args=['<command>'].\n\n" +
        "Args:\n" +
        "  - command (string, required): CLI command name (e.g. 'bases').\n" +
        "  - args (string[], default []): Argv tokens after the command. " +
        "Use 'key=value' or bare flag names.\n" +
        "  - vault (string, optional): Target vault.\n\n" +
        "Examples:\n" +
        '  command="help"\n' +
        '  command="bookmarks", args=["verbose"]\n' +
        '  command="plugins", args=["filter=community"]\n' +
        '  command="base:query", args=[\'file=Tasks.base\', "format=json"]\n\n' +
        "Refused commands (potentially destabilizing): restart, reload, plugin:uninstall, " +
        "theme:uninstall, plugins:restrict. Set the env var OBSIDIAN_MCP_ALLOW_DANGEROUS=1 " +
        "on the server to enable them.",
      inputSchema: ObsidianCliShape,
      annotations: {
        readOnlyHint: false, // unknown — could be anything
        destructiveHint: false, // dangerous ones are guarded
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: ObsidianCliInput) => {
      const allowDangerous = process.env.OBSIDIAN_MCP_ALLOW_DANGEROUS === "1";
      if (DANGEROUS_COMMANDS.has(params.command.toLowerCase()) && !allowDangerous) {
        return errorResult(
          `Refused: '${params.command}' is on the dangerous list. ` +
            `Set OBSIDIAN_MCP_ALLOW_DANGEROUS=1 in the MCP server environment to permit it.`,
        );
      }

      // Each arg is a single argv element. Validate they look like CLI args
      // (key=value or bare flag) but keep the check permissive — the CLI's own
      // help text is the source of truth.
      const args = params.args.map((a) => {
        const eq = a.indexOf("=");
        return eq === -1 ? { flag: a } : { key: a.slice(0, eq), value: a.slice(eq + 1) };
      });

      try {
        const out = await runObsidian(params.command, args, { vault: params.vault });
        const text = trimTrailingNewline(out);
        return successResult(text || "(empty output)");
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}
