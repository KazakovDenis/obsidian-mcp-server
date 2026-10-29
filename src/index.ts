#!/usr/bin/env node
/**
 * obsidian-mcp-server entry point.
 *
 * Wraps the local Obsidian CLI and the Omnisearch plugin's local HTTP server
 * as MCP tools so any MCP-compatible agent can drive Obsidian without
 * hand-crafting CLI invocations.
 *
 * Transport: stdio. This server is intended to run as a subprocess of the
 * MCP client — it talks to a local binary and a localhost HTTP server, so
 * there is no benefit from HTTP transport.
 *
 * Logging: stdio transport reserves stdout for the JSON-RPC protocol. All
 * diagnostic output must go to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  OBSIDIAN_CLI_PATH,
  OMNISEARCH_URL,
  SERVER_NAME,
  SERVER_VERSION,
} from "./constants.js";
import { registerAllTools } from "./tools/register.js";

function logStartup(): void {
  // Stderr is safe; stdout is reserved for JSON-RPC.
  process.stderr.write(
    `[${SERVER_NAME}] v${SERVER_VERSION} starting via stdio\n` +
      `  CLI:        ${OBSIDIAN_CLI_PATH}\n` +
      `  Omnisearch: ${OMNISEARCH_URL}\n`,
  );
}

async function main(): Promise<void> {
  logStartup();

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerAllTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown — close the transport on signals so the parent client
  // sees a clean EOF instead of a pipe error.
  const shutdown = async (signal: string) => {
    process.stderr.write(`[${SERVER_NAME}] received ${signal}, shutting down\n`);
    try {
      await server.close();
    } catch {
      // ignore — we're exiting anyway
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  process.stderr.write(
    `[${SERVER_NAME}] fatal startup error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
