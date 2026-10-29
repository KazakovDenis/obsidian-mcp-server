/**
 * Link inspection tools.
 *
 * Wraps CLI commands: backlinks, links.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { compactArgs, optArg, optFlag, runObsidian } from "../cli.js";
import { errorResult, successResult, trimTrailingNewline } from "../format.js";
import { fileField, pathField, vaultField } from "../schemas.js";
import { formatCliError } from "./notes.js";

/* ----------------------------- obsidian_backlinks ------------------------- */

const BacklinksShape = {
  file: fileField,
  path: pathField,
  counts: z
    .boolean()
    .default(false)
    .describe("Include the number of links from each source file."),
  vault: vaultField,
} as const;
type BacklinksInput = z.infer<z.ZodObject<typeof BacklinksShape>>;

function registerBacklinks(server: McpServer) {
  server.registerTool(
    "obsidian_backlinks",
    {
      title: "List Backlinks",
      description:
        "List all files that link TO the target note. Defaults to the active file.\n\n" +
        "Args:\n" +
        "  - file (string, optional) OR path (string, optional): Target note.\n" +
        "  - counts (boolean, default false): Include link counts per source file.\n" +
        "  - vault (string, optional): Target vault.\n\n" +
        "Returns a TSV listing of source file paths (and counts if requested).",
      inputSchema: BacklinksShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: BacklinksInput) => {
      try {
        const out = await runObsidian(
          "backlinks",
          compactArgs([
            optArg("file", params.file),
            optArg("path", params.path),
            optFlag("counts", params.counts),
          ]),
          { vault: params.vault },
        );
        const text = trimTrailingNewline(out);
        return successResult(text || "No backlinks.");
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

/* --------------------------- obsidian_outgoing_links ---------------------- */

const OutgoingLinksShape = {
  file: fileField,
  path: pathField,
  vault: vaultField,
} as const;
type OutgoingLinksInput = z.infer<z.ZodObject<typeof OutgoingLinksShape>>;

function registerOutgoingLinks(server: McpServer) {
  server.registerTool(
    "obsidian_outgoing_links",
    {
      title: "List Outgoing Links",
      description:
        "List all links FROM the target note to other notes. Defaults to the active file.\n\n" +
        "Args:\n" +
        "  - file (string, optional) OR path (string, optional): Source note.\n" +
        "  - vault (string, optional): Target vault.\n\n" +
        "Returns a list of target link names/paths, one per line.",
      inputSchema: OutgoingLinksShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: OutgoingLinksInput) => {
      try {
        const out = await runObsidian(
          "links",
          compactArgs([optArg("file", params.file), optArg("path", params.path)]),
          { vault: params.vault },
        );
        const text = trimTrailingNewline(out);
        return successResult(text || "No outgoing links.");
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

export function registerLinkTools(server: McpServer) {
  registerBacklinks(server);
  registerOutgoingLinks(server);
}
