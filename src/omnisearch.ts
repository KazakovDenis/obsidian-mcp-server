/**
 * HTTP client for the Omnisearch plugin's local search server.
 *
 * The Omnisearch Obsidian plugin exposes a small HTTP API on a local port
 * (51361 by default). It accepts a single query and returns a JSON array of
 * scored results that include the file path, basename, an excerpt around the
 * match, and the score from the BM25-derived ranker.
 *
 * Endpoint: GET {OMNISEARCH_URL}/search?q={url_encoded_query}
 * Response: OmnisearchResult[]
 */

import { OMNISEARCH_TIMEOUT_MS, OMNISEARCH_URL } from "./constants.js";

export interface OmnisearchResult {
  /** BM25-derived relevance score; higher is better. */
  score: number;
  /** Vault-relative path including extension, e.g. "Notes/Project X.md". */
  path: string;
  /** File basename without extension, e.g. "Project X". */
  basename: string;
  /** Excerpt of the file content around the strongest match. */
  excerpt: string;
  /** Vault name the result lives in. */
  vault?: string;
  /** Distinct query terms found in this result. */
  foundWords?: string[];
  /** Per-match positions; shape varies by Omnisearch version. */
  matches?: unknown[];
}

export class OmnisearchError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "OmnisearchError";
  }
}

/**
 * Query the Omnisearch HTTP server.
 *
 * @param query Free-text query. Supports Omnisearch syntax: quoted "phrases",
 *              `-exclusions`, and file-type filters like `.md` or `.pdf`.
 * @returns     The raw result array sorted by descending score.
 */
export async function omnisearchQuery(query: string): Promise<OmnisearchResult[]> {
  const url = `${OMNISEARCH_URL}/search?q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OMNISEARCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const e = err as Error;
    if (e.name === "AbortError") {
      throw new OmnisearchError(
        `Omnisearch request timed out after ${OMNISEARCH_TIMEOUT_MS} ms. ` +
          `Is Obsidian running with the Omnisearch HTTP server enabled?`,
        err,
      );
    }
    throw new OmnisearchError(
      `Could not reach Omnisearch at ${OMNISEARCH_URL}. ` +
        `Ensure Obsidian is running and the Omnisearch plugin's HTTP server is enabled ` +
        `(Settings → Omnisearch → HTTP server). Underlying error: ${e.message}`,
      err,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new OmnisearchError(
      `Omnisearch returned HTTP ${response.status} ${response.statusText}. ${text}`.trim(),
    );
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new OmnisearchError(
      `Unexpected Omnisearch response shape: expected an array, got ${typeof data}.`,
    );
  }

  // The Omnisearch HTTP server already orders results by score, but defensive
  // sort guards against a future version that doesn't.
  return (data as OmnisearchResult[]).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
