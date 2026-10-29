/**
 * Metadata tools: vault file listing, tags, frontmatter properties.
 *
 * Wraps CLI commands: files, tags, properties, property:set.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { compactArgs, optArg, runObsidian } from "../cli.js";
import { errorResult, successResult, trimTrailingNewline } from "../format.js";
import { fileField, pathField, vaultField } from "../schemas.js";
import { formatCliError } from "./notes.js";

/* ----------------------------- obsidian_list_files ------------------------ */

const ListFilesShape = {
  folder: z
    .string()
    .min(1)
    .optional()
    .describe("Limit to a folder (vault-relative path)."),
  ext: z
    .string()
    .min(1)
    .optional()
    .describe("Filter by file extension, e.g. 'md', 'pdf' (no leading dot)."),
  count_only: z
    .boolean()
    .default(false)
    .describe("If true, return only the total file count, not the listing."),
  vault: vaultField,
} as const;
type ListFilesInput = z.infer<z.ZodObject<typeof ListFilesShape>>;

function registerListFiles(server: McpServer) {
  server.registerTool(
    "obsidian_list_files",
    {
      title: "List Vault Files",
      description:
        "List files in the vault, optionally filtered by folder and/or extension.\n\n" +
        "Args:\n" +
        "  - folder (string, optional): Limit to a folder.\n" +
        "  - ext (string, optional): Extension filter, e.g. 'md'.\n" +
        "  - count_only (boolean, default false): Return total count only.\n" +
        "  - vault (string, optional): Target vault.\n\n" +
        "Returns one path per line, or a single count when `count_only` is true.",
      inputSchema: ListFilesShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ListFilesInput) => {
      try {
        const args = compactArgs([
          optArg("folder", params.folder),
          optArg("ext", params.ext),
          params.count_only ? { flag: "total" } : null,
        ]);
        const out = await runObsidian("files", args, { vault: params.vault });
        return successResult(trimTrailingNewline(out));
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

/* ----------------------------- obsidian_list_tags ------------------------- */

const ListTagsShape = {
  file: z
    .string()
    .min(1)
    .optional()
    .describe("If given, list tags only in this file."),
  path: z
    .string()
    .min(1)
    .optional()
    .describe("If given, list tags only in this file path."),
  counts: z
    .boolean()
    .default(false)
    .describe("Include occurrence counts for each tag."),
  sort_by_count: z
    .boolean()
    .default(false)
    .describe("If true, sort by count instead of alphabetically."),
  vault: vaultField,
} as const;
type ListTagsInput = z.infer<z.ZodObject<typeof ListTagsShape>>;

function registerListTags(server: McpServer) {
  server.registerTool(
    "obsidian_list_tags",
    {
      title: "List Tags",
      description:
        "List tags in the vault, or in a specific file.\n\n" +
        "Args:\n" +
        "  - file (string, optional): Tags for this file only.\n" +
        "  - path (string, optional): Tags for this path only.\n" +
        "  - counts (boolean, default false): Include occurrence counts.\n" +
        "  - sort_by_count (boolean, default false): Sort by count.\n" +
        "  - vault (string, optional): Target vault.\n\n" +
        "Returns a TSV/text listing of tags.",
      inputSchema: ListTagsShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ListTagsInput) => {
      try {
        const args = compactArgs([
          optArg("file", params.file),
          optArg("path", params.path),
          params.counts ? { flag: "counts" } : null,
          params.sort_by_count ? { key: "sort", value: "count" } : null,
        ]);
        const out = await runObsidian("tags", args, { vault: params.vault });
        return successResult(trimTrailingNewline(out) || "No tags.");
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

/* -------------------------- obsidian_get_properties ----------------------- */

const GetPropertiesShape = {
  file: fileField,
  path: pathField,
  name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "If given, return only the value of this property instead of the full property list.",
    ),
  vault: vaultField,
} as const;
type GetPropertiesInput = z.infer<z.ZodObject<typeof GetPropertiesShape>>;

function registerGetProperties(server: McpServer) {
  server.registerTool(
    "obsidian_get_properties",
    {
      title: "Get Note Properties",
      description:
        "Read the frontmatter properties of a note. Returns all properties in YAML format, " +
        "or a single value if `name` is given.\n\n" +
        "Args:\n" +
        "  - file (string, optional) OR path (string, optional): Target note. " +
        "Defaults to the active file.\n" +
        "  - name (string, optional): Return just this property's value.\n" +
        "  - vault (string, optional): Target vault.",
      inputSchema: GetPropertiesShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: GetPropertiesInput) => {
      try {
        if (params.name) {
          const out = await runObsidian(
            "property:read",
            compactArgs([
              { key: "name", value: params.name },
              optArg("file", params.file),
              optArg("path", params.path),
            ]),
            { vault: params.vault },
          );
          return successResult(trimTrailingNewline(out));
        }
        const out = await runObsidian(
          "properties",
          compactArgs([optArg("file", params.file), optArg("path", params.path)]),
          { vault: params.vault },
        );
        return successResult(trimTrailingNewline(out) || "No properties.");
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

/* --------------------------- obsidian_set_property ------------------------ */

const PropertyTypes = ["text", "list", "number", "checkbox", "date", "datetime"] as const;

const SetPropertyShape = {
  file: fileField,
  path: pathField,
  name: z.string().min(1).describe("Property name. Required."),
  value: z
    .string()
    .describe(
      "Property value as a string. Required. For list-valued properties, pass a " +
        "comma-separated string and set type='list'.",
    ),
  type: z
    .enum(PropertyTypes)
    .optional()
    .describe(
      "Optional explicit property type. One of: text, list, number, checkbox, date, datetime.",
    ),
  vault: vaultField,
} as const;
type SetPropertyInput = z.infer<z.ZodObject<typeof SetPropertyShape>>;

function registerSetProperty(server: McpServer) {
  server.registerTool(
    "obsidian_set_property",
    {
      title: "Set Note Property",
      description:
        "Set a single frontmatter property on a note. Creates the property if it does " +
        "not exist; overwrites it if it does.\n\n" +
        "Args:\n" +
        "  - file (string) OR path (string): Target note. Defaults to active file.\n" +
        "  - name (string, required): Property name.\n" +
        "  - value (string, required): Value as string.\n" +
        "  - type (enum, optional): text | list | number | checkbox | date | datetime.\n" +
        "  - vault (string, optional): Target vault.",
      inputSchema: SetPropertyShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: SetPropertyInput) => {
      try {
        const out = await runObsidian(
          "property:set",
          compactArgs([
            optArg("file", params.file),
            optArg("path", params.path),
            { key: "name", value: params.name },
            { key: "value", value: params.value },
            optArg("type", params.type),
          ]),
          { vault: params.vault },
        );
        return successResult(trimTrailingNewline(out) || "Property set.");
      } catch (err) {
        return errorResult(formatCliError(err));
      }
    },
  );
}

export function registerMetadataTools(server: McpServer) {
  registerListFiles(server);
  registerListTags(server);
  registerGetProperties(server);
  registerSetProperty(server);
}
