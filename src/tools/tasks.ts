/**
 * Task tools.
 *
 * Wraps the CLI's `tasks` (list) and `task` (mutate) commands.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { compactArgs, optArg, optFlag, runObsidian } from "../cli.js";
import { errorResult, successResult, trimTrailingNewline } from "../format.js";
import { vaultField } from "../schemas.js";
import { formatCliError } from "./notes.js";

/* ------------------------------ obsidian_list_tasks ----------------------- */

const TaskFilter = ["all", "todo", "done"] as const;

const ListTasksShape = {
  file: z
    .string()
    .min(1)
    .optional()
    .describe("Filter by file name."),
  path: z
    .string()
    .min(1)
    .optional()
    .describe("Filter by file path."),
  filter: z
    .enum(TaskFilter)
    .default("all")
    .describe("Show 'all' tasks, only 'todo' (incomplete), or only 'done' (completed)."),
  status: z
    .string()
    .length(1)
    .optional()
    .describe(
      "Filter by a specific task status character (e.g. '/', '?', '-'). " +
        "Mutually exclusive with `filter`; if both are set, `status` wins.",
    ),
  group_by_file: z
    .boolean()
    .default(false)
    .describe("Group output by file with line numbers (verbose mode)."),
  daily_only: z
    .boolean()
    .default(false)
    .describe("Limit to tasks in today's daily note."),
  vault: vaultField,
} as const;
type ListTasksInput = z.infer<z.ZodObject<typeof ListTasksShape>>;

function registerListTasks(server: McpServer) {
  server.registerTool(
    "obsidian_list_tasks",
    {
      title: "List Tasks",
      description:
        "List markdown tasks across the vault (or filtered to a file or daily note).\n\n" +
        "Args:\n" +
        "  - file (string, optional): Limit to a file (wikilink-style).\n" +
        "  - path (string, optional): Limit to a path.\n" +
        "  - filter ('all' | 'todo' | 'done', default 'all'): Status filter.\n" +
        "  - status (single char, optional): Specific status char (e.g. '/' for in-progress).\n" +
        "  - group_by_file (boolean, default false): Group tasks by file with line numbers.\n" +
        "  - daily_only (boolean, default false): Limit to today's daily note.\n" +
        "  - vault (string, optional): Target vault.\n\n" +
        "Returns task lines, optionally grouped.",
      inputSchema: ListTasksShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ListTasksInput) => {
      try {
        const args = compactArgs([
          optArg("file", params.file),
          optArg("path", params.path),
          // status wins over filter
          params.status
            ? { key: "status", value: params.status }
            : params.filter === "todo"
              ? { flag: "todo" }
              : params.filter === "done"
                ? { flag: "done" }
                : null,
          optFlag("verbose", params.group_by_file),
          optFlag("daily", params.daily_only),
        ]);
        const out = await runObsidian("tasks", args, { vault: params.vault });
        return successResult(trimTrailingNewline(out) || "No tasks.");
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

/* ----------------------------- obsidian_update_task ----------------------- */

const UpdateTaskShape = {
  ref: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Task reference in the form 'path:line', e.g. 'Notes/Project.md:42'. " +
        "Mutually optional with the `file`+`line` pair.",
    ),
  file: z
    .string()
    .min(1)
    .optional()
    .describe("File containing the task (wikilink-style or path)."),
  path: z
    .string()
    .min(1)
    .optional()
    .describe("Path of the file containing the task."),
  line: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("1-based line number of the task within the file."),
  action: z
    .enum(["toggle", "done", "todo", "set"])
    .describe(
      "What to do:\n" +
        "  - 'toggle': flip done/todo state.\n" +
        "  - 'done': mark complete.\n" +
        "  - 'todo': mark incomplete.\n" +
        "  - 'set': set status to the character given in `status`.",
    ),
  status: z
    .string()
    .length(1)
    .optional()
    .describe("Status character to assign when action='set' (e.g. '/' or '?')."),
  daily: z
    .boolean()
    .default(false)
    .describe("If true, target the daily note (the CLI's `daily` flag)."),
  vault: vaultField,
} as const;
type UpdateTaskInput = z.infer<z.ZodObject<typeof UpdateTaskShape>>;

function registerUpdateTask(server: McpServer) {
  server.registerTool(
    "obsidian_update_task",
    {
      title: "Update Task",
      description:
        "Toggle or update a markdown task in a note.\n\n" +
        "Identify the task via either:\n" +
        "  - `ref` = 'path:line' (preferred for results returned by obsidian_list_tasks " +
        "with `group_by_file=true`), or\n" +
        "  - the pair `file` (or `path`) + `line` (1-based).\n\n" +
        "Args:\n" +
        "  - ref (string, optional): 'path:line' shorthand.\n" +
        "  - file / path (string, optional): File containing the task.\n" +
        "  - line (number, optional): 1-based line number.\n" +
        "  - action ('toggle' | 'done' | 'todo' | 'set', required): What to do.\n" +
        "  - status (single char, optional): Required when action='set'.\n" +
        "  - daily (boolean, default false): Target the daily note.\n" +
        "  - vault (string, optional): Target vault.",
      inputSchema: UpdateTaskShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params: UpdateTaskInput) => {
      const hasRef = !!params.ref;
      const hasFileLine = (!!params.file || !!params.path) && params.line !== undefined;
      if (!hasRef && !hasFileLine && !params.daily) {
        return errorResult(
          "Identify the task with either `ref` ('path:line'), or `file`+`line`, " +
            "or set `daily=true` to target today's daily note.",
        );
      }
      if (params.action === "set" && !params.status) {
        return errorResult("action='set' requires `status` to be provided (1 char).");
      }

      try {
        const args = compactArgs([
          optArg("ref", params.ref),
          optArg("file", params.file),
          optArg("path", params.path),
          params.line !== undefined ? { key: "line", value: String(params.line) } : null,
          optFlag("daily", params.daily),
          params.action === "toggle" ? { flag: "toggle" } : null,
          params.action === "done" ? { flag: "done" } : null,
          params.action === "todo" ? { flag: "todo" } : null,
          params.action === "set" && params.status
            ? { key: "status", value: params.status }
            : null,
        ]);
        const out = await runObsidian("task", args, { vault: params.vault });
        return successResult(trimTrailingNewline(out) || "Task updated.");
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

export function registerTaskTools(server: McpServer) {
  registerListTasks(server);
  registerUpdateTask(server);
}
