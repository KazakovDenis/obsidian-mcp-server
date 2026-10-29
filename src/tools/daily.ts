/**
 * Daily note tool. Consolidates the CLI's daily, daily:read, daily:append,
 * daily:prepend, and daily:path commands behind a single `action` parameter
 * so an agent doesn't need to remember separate tool names for closely
 * related operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { escapeContent, optFlag, runObsidian, compactArgs } from "../cli.js";
import { errorResult, successResult, trimTrailingNewline } from "../format.js";
import { vaultField } from "../schemas.js";
import { formatCliError } from "./notes.js";

const DailyActions = ["read", "append", "prepend", "path", "open"] as const;

const DailyNoteShape = {
  action: z
    .enum(DailyActions)
    .describe(
      "What to do with the daily note:\n" +
        "  - 'read': return its contents.\n" +
        "  - 'append' / 'prepend': add `content` to it.\n" +
        "  - 'path': return its file path.\n" +
        "  - 'open': open it in the Obsidian UI.",
    ),
  content: z
    .string()
    .optional()
    .describe("Content to append/prepend. Required when action is 'append' or 'prepend'."),
  inline: z
    .boolean()
    .default(false)
    .describe("For 'append'/'prepend': if true, no newline separator is inserted."),
  open_after: z
    .boolean()
    .default(false)
    .describe("For 'append'/'prepend': open the daily note in the UI after writing."),
  vault: vaultField,
} as const;
type DailyNoteInput = z.infer<z.ZodObject<typeof DailyNoteShape>>;

export function registerDailyTool(server: McpServer) {
  server.registerTool(
    "obsidian_daily_note",
    {
      title: "Daily Note",
      description:
        "Read or write today's daily note. Convenient one-stop tool for journaling " +
        "workflows.\n\n" +
        "Args:\n" +
        "  - action ('read' | 'append' | 'prepend' | 'path' | 'open', required): " +
        "Operation to perform.\n" +
        "  - content (string): Required for append/prepend; ignored otherwise.\n" +
        "  - inline (boolean, default false): No newline separator on write.\n" +
        "  - open_after (boolean, default false): On write, open the note after.\n" +
        "  - vault (string, optional): Target vault.\n\n" +
        "Returns the file contents (read), file path (path), or a confirmation.",
      inputSchema: DailyNoteShape,
      annotations: {
        readOnlyHint: false, // varies by action; conservative default
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params: DailyNoteInput) => {
      try {
        switch (params.action) {
          case "read": {
            const out = await runObsidian("daily:read", [], { vault: params.vault });
            return successResult(trimTrailingNewline(out));
          }
          case "path": {
            const out = await runObsidian("daily:path", [], { vault: params.vault });
            return successResult(trimTrailingNewline(out));
          }
          case "open": {
            const out = await runObsidian("daily", [], { vault: params.vault });
            return successResult(trimTrailingNewline(out) || "Opened.");
          }
          case "append":
          case "prepend": {
            if (params.content === undefined) {
              return errorResult(
                `Action '${params.action}' requires the \`content\` parameter.`,
              );
            }
            const args = compactArgs([
              { key: "content", value: escapeContent(params.content) },
              optFlag("inline", params.inline),
              optFlag("open", params.open_after),
            ]);
            const cmd = params.action === "append" ? "daily:append" : "daily:prepend";
            const out = await runObsidian(cmd, args, { vault: params.vault });
            return successResult(trimTrailingNewline(out) || "Done.");
          }
        }
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}
