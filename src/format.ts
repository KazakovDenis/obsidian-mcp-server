/**
 * Response shaping helpers used by tool handlers.
 *
 * The MCP best-practices guide asks every tool to:
 *  - Cap response size against CHARACTER_LIMIT and explain the truncation.
 *  - Offer at least one of {markdown, json} as an output format.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CHARACTER_LIMIT } from "./constants.js";

export const ResponseFormat = {
  MARKDOWN: "markdown",
  JSON: "json",
  RAW: "raw",
} as const;
export type ResponseFormat = (typeof ResponseFormat)[keyof typeof ResponseFormat];

/** Build a plain text MCP tool result. */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Build a successful tool result with optional structured content. The MCP
 * spec lets servers return both a human-readable text representation and a
 * machine-readable structured payload — clients that support it can prefer
 * the latter. We always provide text; structured is added when supplied.
 */
export function successResult(
  text: string,
  structured?: Record<string, unknown>,
): CallToolResult {
  const truncated = truncate(text);
  const result: CallToolResult = {
    content: [{ type: "text", text: truncated.text }],
  };
  if (structured !== undefined) {
    result.structuredContent = {
      ...structured,
      ...(truncated.truncated ? { truncated: true, truncation_message: truncated.message } : {}),
    };
  }
  return result;
}

/** Build an MCP tool error result with a clear, actionable message. */
export function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

/**
 * Cap a long response at CHARACTER_LIMIT characters. The truncation marker
 * gives the agent specific guidance for narrowing the next call.
 */
export function truncate(text: string): {
  text: string;
  truncated: boolean;
  message?: string;
} {
  if (text.length <= CHARACTER_LIMIT) {
    return { text, truncated: false };
  }
  const cutoff = CHARACTER_LIMIT - 400; // leave room for the marker
  const message =
    `Response truncated from ${text.length} to ${cutoff} characters. ` +
    `Add a more specific filter (folder=, ext=, path=, limit=, or a narrower query) ` +
    `to see the full result.`;
  return {
    text: `${text.slice(0, cutoff)}\n\n--- TRUNCATED ---\n${message}\n`,
    truncated: true,
    message,
  };
}

/** Pretty-print structured data as a fenced JSON block. */
export function jsonBlock(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** Strip the trailing newline that the CLI typically appends. */
export function trimTrailingNewline(s: string): string {
  return s.replace(/\n+$/, "");
}
