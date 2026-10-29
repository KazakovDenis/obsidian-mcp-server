/**
 * Shared Zod field fragments. Returned as plain Zod types so each tool can
 * spread them into its raw-shape `inputSchema`. We deliberately do NOT
 * wrap these in a `z.object(...).strict()` — the MCP SDK expects raw shapes
 * (plain object literals of Zod types) and silently drops top-level refines
 * and other ZodEffects (see typescript-sdk issue #1643).
 */

import { z } from "zod";
import { ResponseFormat } from "./format.js";

/** Optional vault override. Defaults to the active vault. */
export const vaultField = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Optional vault name to target. Defaults to the active vault (or OBSIDIAN_DEFAULT_VAULT if set).",
  );

/** Markdown/JSON output toggle. */
export const responseFormatField = z
  .enum([ResponseFormat.MARKDOWN, ResponseFormat.JSON])
  .default(ResponseFormat.MARKDOWN)
  .describe(
    "Output format: 'markdown' for human-readable text, 'json' for structured machine-readable data.",
  );

/** File name (wikilink-style). */
export const fileField = z
  .string()
  .min(1)
  .optional()
  .describe(
    "File name (wikilink-style, no extension required, e.g. 'My Note'). " +
      "Mutually optional with 'path'. If neither is given, the active file is used.",
  );

/** Exact vault-relative path. */
export const pathField = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Exact vault-relative path including extension, e.g. 'Folder/My Note.md'. " +
      "Mutually optional with 'file'. If neither is given, the active file is used.",
  );
