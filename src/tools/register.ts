/**
 * Aggregator: registers every tool from every module on a given server.
 * Kept in one place so `index.ts` stays focused on transport setup.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCliTool } from "./cli.js";
import { registerDailyTool } from "./daily.js";
import { registerLinkTools } from "./links.js";
import { registerMetadataTools } from "./metadata.js";
import { registerNoteTools } from "./notes.js";
import { registerSearchTools } from "./search.js";
import { registerTaskTools } from "./tasks.js";

export function registerAllTools(server: McpServer): void {
  registerNoteTools(server);
  registerSearchTools(server);
  registerLinkTools(server);
  registerMetadataTools(server);
  registerDailyTool(server);
  registerTaskTools(server);
  registerCliTool(server);
}
