/**
 * Tools for reading and mutating individual notes.
 *
 * Wraps the CLI commands: read, create, append, prepend, delete, move, open.
 * Most commands default to the active file when neither `file` nor `path` is
 * given (per the CLI's help text).
 *
 * Pattern note: input schemas are exported as raw `ZodRawShape` literals
 * (plain object of Zod types). Cross-field validation (e.g. "name or path
 * required") is performed inside the handler because the SDK silently drops
 * top-level `.refine()`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  compactArgs,
  escapeContent,
  ObsidianCliError,
  optArg,
  optFlag,
  runObsidian,
} from "../cli.js";
import { errorResult, successResult, trimTrailingNewline } from "../format.js";
import { fileField, pathField, vaultField } from "../schemas.js";

/* ----------------------------- obsidian_read_note ------------------------- */

const ReadNoteShape = {
  file: fileField,
  path: pathField,
  vault: vaultField,
} as const;
type ReadNoteInput = z.infer<z.ZodObject<typeof ReadNoteShape>>;

function registerReadNote(server: McpServer) {
  server.registerTool(
    "obsidian_read_note",
    {
      title: "Read Note",
      description:
        "Read the raw text contents of a note in the Obsidian vault.\n\n" +
        "Args:\n" +
        "  - file (string, optional): Wikilink-style name (e.g. 'My Note').\n" +
        "  - path (string, optional): Exact vault-relative path (e.g. 'Folder/My Note.md').\n" +
        "  - vault (string, optional): Target a specific vault.\n" +
        "  Provide either `file` or `path`. If neither is given, reads the active file.\n\n" +
        "Returns the full text of the note (frontmatter + body).\n\n" +
        "Errors:\n" +
        "  - File not found if the name/path does not resolve.",
      inputSchema: ReadNoteShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ReadNoteInput) => {
      try {
        const out = await runObsidian(
          "read",
          compactArgs([optArg("file", params.file), optArg("path", params.path)]),
          { vault: params.vault },
        );
        return successResult(out);
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

/* ---------------------------- obsidian_create_note ------------------------ */

const CreateNoteShape = {
  name: z
    .string()
    .min(1)
    .optional()
    .describe("File name without extension (e.g. 'New Idea'). One of `name` or `path` is required."),
  path: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Exact vault-relative path including extension (e.g. 'Inbox/New Idea.md'). " +
        "One of `name` or `path` is required.",
    ),
  content: z
    .string()
    .optional()
    .describe("Initial content for the new note. Markdown is supported."),
  template: z
    .string()
    .min(1)
    .optional()
    .describe("Name of an Obsidian template to apply when creating the note."),
  overwrite: z
    .boolean()
    .default(false)
    .describe("Overwrite the file if it already exists. Defaults to false."),
  open: z
    .boolean()
    .default(false)
    .describe("Open the file in Obsidian after creating it."),
  newtab: z
    .boolean()
    .default(false)
    .describe("If opening, open in a new tab."),
  vault: vaultField,
} as const;
type CreateNoteInput = z.infer<z.ZodObject<typeof CreateNoteShape>>;

function registerCreateNote(server: McpServer) {
  server.registerTool(
    "obsidian_create_note",
    {
      title: "Create Note",
      description:
        "Create a new note in the Obsidian vault, optionally seeded with content and/or a template.\n\n" +
        "Args:\n" +
        "  - name (string, optional): File name without extension.\n" +
        "  - path (string, optional): Full vault-relative path with extension.\n" +
        "    Exactly one of `name` or `path` must be provided.\n" +
        "  - content (string, optional): Initial content. Real newlines are preserved.\n" +
        "  - template (string, optional): Template name to apply.\n" +
        "  - overwrite (boolean, default false): Replace existing file if present.\n" +
        "  - open (boolean, default false): Open after creating.\n" +
        "  - newtab (boolean, default false): If opening, open in a new tab.\n" +
        "  - vault (string, optional): Target vault.\n\n" +
        "Returns a short confirmation. Errors if the file already exists and " +
        "`overwrite` is false, or if neither `name` nor `path` is provided.",
      inputSchema: CreateNoteShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params: CreateNoteInput) => {
      if (!params.name && !params.path) {
        return errorResult("Provide either `name` or `path` to identify the new note.");
      }
      try {
        const args = compactArgs([
          optArg("name", params.name),
          optArg("path", params.path),
          params.content !== undefined
            ? { key: "content", value: escapeContent(params.content) }
            : null,
          optArg("template", params.template),
          optFlag("overwrite", params.overwrite),
          optFlag("open", params.open),
          optFlag("newtab", params.newtab),
        ]);
        const out = await runObsidian("create", args, { vault: params.vault });
        return successResult(trimTrailingNewline(out) || "Note created.");
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

/* -------------------- obsidian_append_note / _prepend_note ---------------- */

const AppendPrependShape = {
  file: fileField,
  path: pathField,
  content: z.string().min(1).describe("Content to add. Real newlines are preserved."),
  inline: z
    .boolean()
    .default(false)
    .describe("If true, do not insert a leading/trailing newline separator."),
  vault: vaultField,
} as const;
type AppendPrependInput = z.infer<z.ZodObject<typeof AppendPrependShape>>;

function buildAppendArgs(params: AppendPrependInput) {
  return compactArgs([
    optArg("file", params.file),
    optArg("path", params.path),
    { key: "content", value: escapeContent(params.content) },
    optFlag("inline", params.inline),
  ]);
}

function registerAppendNote(server: McpServer) {
  server.registerTool(
    "obsidian_append_note",
    {
      title: "Append to Note",
      description:
        "Append content to the end of an existing note. Defaults to the active file " +
        "when neither `file` nor `path` is given.\n\n" +
        "Args:\n" +
        "  - file (string, optional): Wikilink-style name.\n" +
        "  - path (string, optional): Exact vault-relative path.\n" +
        "  - content (string, required): Text to append. Markdown supported.\n" +
        "  - inline (boolean, default false): If true, no newline separator is inserted.\n" +
        "  - vault (string, optional): Target vault.\n\n" +
        "Returns a confirmation. Errors if the target file does not exist.",
      inputSchema: AppendPrependShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params: AppendPrependInput) => {
      try {
        const out = await runObsidian("append", buildAppendArgs(params), {
          vault: params.vault,
        });
        return successResult(trimTrailingNewline(out) || "Appended.");
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

function registerPrependNote(server: McpServer) {
  server.registerTool(
    "obsidian_prepend_note",
    {
      title: "Prepend to Note",
      description:
        "Prepend content to the start of an existing note. Useful for reverse-chrono " +
        "journals. Defaults to the active file when neither `file` nor `path` is given.\n\n" +
        "Args: same as obsidian_append_note (file, path, content, inline, vault).",
      inputSchema: AppendPrependShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params: AppendPrependInput) => {
      try {
        const out = await runObsidian("prepend", buildAppendArgs(params), {
          vault: params.vault,
        });
        return successResult(trimTrailingNewline(out) || "Prepended.");
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

/* ---------------------------- obsidian_delete_note ------------------------ */

const DeleteNoteShape = {
  file: fileField,
  path: pathField,
  permanent: z
    .boolean()
    .default(false)
    .describe("If true, skip the trash and delete permanently. Defaults to false (move to trash)."),
  vault: vaultField,
} as const;
type DeleteNoteInput = z.infer<z.ZodObject<typeof DeleteNoteShape>>;

function registerDeleteNote(server: McpServer) {
  server.registerTool(
    "obsidian_delete_note",
    {
      title: "Delete Note",
      description:
        "Delete a note. By default the file is moved to the Obsidian trash and can be " +
        "recovered. Pass `permanent=true` to delete it irrecoverably.\n\n" +
        "Args:\n" +
        "  - file (string) OR path (string): One is required.\n" +
        "  - permanent (boolean, default false): Skip trash.\n" +
        "  - vault (string, optional): Target vault.",
      inputSchema: DeleteNoteShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: DeleteNoteInput) => {
      if (!params.file && !params.path) {
        return errorResult("Provide either `file` or `path` to identify the note to delete.");
      }
      try {
        const out = await runObsidian(
          "delete",
          compactArgs([
            optArg("file", params.file),
            optArg("path", params.path),
            optFlag("permanent", params.permanent),
          ]),
          { vault: params.vault },
        );
        return successResult(trimTrailingNewline(out) || "Deleted.");
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

/* ----------------------------- obsidian_move_note ------------------------- */

const MoveNoteShape = {
  file: fileField,
  path: pathField,
  to: z
    .string()
    .min(1)
    .describe(
      "Destination folder or full path. To rename, supply a new path/name; to move, " +
        "supply a folder path. Required.",
    ),
  vault: vaultField,
} as const;
type MoveNoteInput = z.infer<z.ZodObject<typeof MoveNoteShape>>;

function registerMoveNote(server: McpServer) {
  server.registerTool(
    "obsidian_move_note",
    {
      title: "Move or Rename Note",
      description:
        "Move a note to a different folder, or rename it by supplying a new path. " +
        "Obsidian updates backlinks automatically.\n\n" +
        "Args:\n" +
        "  - file (string) OR path (string): Source note.\n" +
        "  - to (string, required): Destination folder or new path.\n" +
        "  - vault (string, optional): Target vault.",
      inputSchema: MoveNoteShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params: MoveNoteInput) => {
      if (!params.file && !params.path) {
        return errorResult("Provide either `file` or `path` to identify the source note.");
      }
      try {
        const out = await runObsidian(
          "move",
          compactArgs([
            optArg("file", params.file),
            optArg("path", params.path),
            { key: "to", value: params.to },
          ]),
          { vault: params.vault },
        );
        return successResult(trimTrailingNewline(out) || "Moved.");
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

/* ----------------------------- obsidian_open_note ------------------------- */

const OpenNoteShape = {
  file: fileField,
  path: pathField,
  newtab: z.boolean().default(false).describe("Open in a new tab."),
  vault: vaultField,
} as const;
type OpenNoteInput = z.infer<z.ZodObject<typeof OpenNoteShape>>;

function registerOpenNote(server: McpServer) {
  server.registerTool(
    "obsidian_open_note",
    {
      title: "Open Note in Obsidian",
      description:
        "Open a note in the Obsidian UI. Useful when the agent wants to surface a " +
        "result for the user rather than just reading the contents.\n\n" +
        "Args:\n" +
        "  - file (string) OR path (string): Note to open.\n" +
        "  - newtab (boolean, default false): Open in a new tab.\n" +
        "  - vault (string, optional): Target vault.",
      inputSchema: OpenNoteShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: OpenNoteInput) => {
      if (!params.file && !params.path) {
        return errorResult("Provide either `file` or `path` to identify the note to open.");
      }
      try {
        const out = await runObsidian(
          "open",
          compactArgs([
            optArg("file", params.file),
            optArg("path", params.path),
            optFlag("newtab", params.newtab),
          ]),
          { vault: params.vault },
        );
        return successResult(trimTrailingNewline(out) || "Opened.");
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

/* ----------------------- shared error formatting -------------------------- */

export function formatCliError(err: unknown): string {
  if (err instanceof ObsidianCliError) {
    return err.message;
  }
  return `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
}

export function registerNoteTools(server: McpServer) {
  registerReadNote(server);
  registerCreateNote(server);
  registerAppendNote(server);
  registerPrependNote(server);
  registerDeleteNote(server);
  registerMoveNote(server);
  registerOpenNote(server);
}
