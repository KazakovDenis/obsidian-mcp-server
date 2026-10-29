/**
 * Search tools.
 *
 * Two complementary search modes:
 *
 *   1. obsidian_search   — exact text search via the CLI's `search:context`
 *                          command. Substring match. Returns matching files
 *                          with line context. Works without Obsidian running.
 *
 *   2. obsidian_omnisearch — scored fuzzy/BM25 search via the Omnisearch
 *                          plugin's HTTP server (default http://localhost:51361).
 *                          Requires Obsidian to be running with the plugin's
 *                          HTTP server enabled.
 *
 * Use omnisearch for concept/relevance queries; use search for exact-string lookups.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  compactArgs,
  optArg,
  optFlag,
  runObsidian,
} from "../cli.js";
import {
  errorResult,
  ResponseFormat,
  successResult,
  trimTrailingNewline,
} from "../format.js";
import { OmnisearchError, omnisearchQuery } from "../omnisearch.js";
import { responseFormatField, vaultField } from "../schemas.js";
import { formatCliError } from "./notes.js";

/* ------------------------------ obsidian_search --------------------------- */

const SearchShape = {
  query: z
    .string()
    .min(1)
    .describe("Text to search for. Substring match; not a regex."),
  path: z
    .string()
    .min(1)
    .optional()
    .describe("Limit the search to a folder within the vault."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Maximum number of files to return (1-500). Default 50."),
  case_sensitive: z
    .boolean()
    .default(false)
    .describe("If true, match case exactly. Default false."),
  with_context: z
    .boolean()
    .default(true)
    .describe(
      "If true (default), return each match with its surrounding line context. " +
        "If false, return only the file list.",
    ),
  vault: vaultField,
} as const;
type SearchInput = z.infer<z.ZodObject<typeof SearchShape>>;

function registerSearch(server: McpServer) {
  server.registerTool(
    "obsidian_search",
    {
      title: "Text Search Vault",
      description:
        "Search the entire vault for a literal substring. Returns matching files, " +
        "optionally with the surrounding line context for each match.\n\n" +
        "Best for: exact phrase lookups, finding a specific identifier, code, or term.\n" +
        "For concept / fuzzy / ranked search, prefer obsidian_omnisearch.\n\n" +
        "Args:\n" +
        "  - query (string, required): Text to find. Not a regex.\n" +
        "  - path (string, optional): Limit to a folder.\n" +
        "  - limit (number, default 50): Max files returned (1-500).\n" +
        "  - case_sensitive (boolean, default false): Case-sensitive match.\n" +
        "  - with_context (boolean, default true): Include matching lines.\n" +
        "  - vault (string, optional): Target vault.\n\n" +
        "Returns plain text with file paths and (optionally) matching lines.",
      inputSchema: SearchShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: SearchInput) => {
      try {
        const command = params.with_context ? "search:context" : "search";
        const out = await runObsidian(
          command,
          compactArgs([
            { key: "query", value: params.query },
            optArg("path", params.path),
            { key: "limit", value: String(params.limit) },
            optFlag("case", params.case_sensitive),
          ]),
          { vault: params.vault },
        );
        const text = trimTrailingNewline(out);
        if (!text.trim()) {
          return successResult(`No matches found for '${params.query}'.`);
        }
        return successResult(text);
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

/* ---------------------------- obsidian_omnisearch ------------------------- */

const OmnisearchShape = {
  query: z
    .string()
    .min(1)
    .describe(
      'Search query. Supports Omnisearch syntax: quoted "phrases", -exclusions, ' +
        "and file-type filters like `.md` or `.pdf`.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum results to return (1-100). Default 20."),
  include_excerpts: z
    .boolean()
    .default(true)
    .describe(
      "If true (default), include each result's excerpt in the response. " +
        "Set to false for a compact path-only list.",
    ),
  response_format: responseFormatField,
} as const;
type OmnisearchInput = z.infer<z.ZodObject<typeof OmnisearchShape>>;

function registerOmnisearch(server: McpServer) {
  server.registerTool(
    "obsidian_omnisearch",
    {
      title: "Omnisearch (Smart Search)",
      description:
        "Smart fuzzy/BM25-ranked search across the vault, powered by the Omnisearch " +
        "plugin's local HTTP server. Returns scored results with matched excerpts.\n\n" +
        "Best for: concept queries, ranked relevance, fuzzy matching, querying PDFs " +
        "and images (when indexed via Text Extractor).\n" +
        "For literal substring search, prefer obsidian_search.\n\n" +
        "Requirements: Obsidian must be running, the Omnisearch plugin must be " +
        "installed and its HTTP server must be enabled in plugin settings.\n\n" +
        "Args:\n" +
        "  - query (string, required): Search query. Omnisearch syntax supported.\n" +
        "  - limit (number, default 20): Max results.\n" +
        "  - include_excerpts (boolean, default true): Include excerpt per result.\n" +
        "  - response_format ('markdown' | 'json', default 'markdown'): Output format.\n\n" +
        "JSON shape:\n" +
        "  {\n" +
        '    "query": string, "count": number, "total": number,\n' +
        '    "results": [{ "score": number, "path": string, "basename": string,\n' +
        '                  "excerpt": string, "foundWords": string[] }]\n' +
        "  }\n\n" +
        "Errors:\n" +
        "  - If Obsidian is not running or the HTTP server is disabled, returns a " +
        "    clear message instructing the user how to enable it.",
      inputSchema: OmnisearchShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true, // depends on a local HTTP service
      },
    },
    async (params: OmnisearchInput) => {
      let raw;
      try {
        raw = await omnisearchQuery(params.query);
      } catch (err) {
        if (err instanceof OmnisearchError) return errorResult(err.message);
        return errorResult(
          `Unexpected Omnisearch error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const total = raw.length;
      const sliced = raw.slice(0, params.limit);

      const results = sliced.map((r) => ({
        score: round(r.score, 4),
        path: r.path,
        basename: r.basename,
        ...(params.include_excerpts && r.excerpt
          ? { excerpt: r.excerpt }
          : {}),
        ...(r.foundWords && r.foundWords.length ? { foundWords: r.foundWords } : {}),
      }));

      const structured = {
        query: params.query,
        count: results.length,
        total,
        results,
      };

      if (params.response_format === ResponseFormat.JSON) {
        return successResult(JSON.stringify(structured, null, 2), structured);
      }

      // Markdown
      if (!results.length) {
        return successResult(`No Omnisearch results for '${params.query}'.`, structured);
      }
      const lines: string[] = [];
      lines.push(`# Omnisearch results: '${params.query}'`);
      lines.push("");
      lines.push(`Showing ${results.length} of ${total} ranked results.`);
      lines.push("");
      for (const r of results) {
        lines.push(`## ${r.basename}  _(score ${r.score})_`);
        lines.push(`- **Path**: \`${r.path}\``);
        if ("foundWords" in r && r.foundWords?.length) {
          lines.push(`- **Matched**: ${r.foundWords.join(", ")}`);
        }
        if ("excerpt" in r && r.excerpt) {
          lines.push("");
          lines.push("> " + r.excerpt.replace(/\n/g, "\n> "));
        }
        lines.push("");
      }
      return successResult(lines.join("\n"), structured);
    },
  );
}

function round(n: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

export function registerSearchTools(server: McpServer) {
  registerSearch(server);
  registerOmnisearch(server);
}
