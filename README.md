# obsidian-mcp-server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that
exposes the [Obsidian](https://obsidian.md) note-taking app to AI agents. It
wraps:

- the local **`obsidian` CLI** (`/usr/local/bin/obsidian` by default), and
- the local HTTP search server provided by the **[Omnisearch](https://github.com/scambier/obsidian-omnisearch)** community plugin.

With it, any MCP-compatible agent (Claude Desktop, Cursor, Cline, Zed, custom
agents) can read, write, search, link, and manage your Obsidian vault natively.

## What's exposed

19 tools across 7 areas:

| Area | Tools |
|---|---|
| **Notes (CRUD)** | `obsidian_read_note`, `obsidian_create_note`, `obsidian_append_note`, `obsidian_prepend_note`, `obsidian_delete_note`, `obsidian_move_note`, `obsidian_open_note` |
| **Search** | `obsidian_search` (literal text via CLI), `obsidian_omnisearch` (BM25/fuzzy ranked, via Omnisearch HTTP API) |
| **Links** | `obsidian_backlinks`, `obsidian_outgoing_links` |
| **Metadata** | `obsidian_list_files`, `obsidian_list_tags`, `obsidian_get_properties`, `obsidian_set_property` |
| **Daily note** | `obsidian_daily_note` (read / append / prepend / path / open) |
| **Tasks** | `obsidian_list_tasks`, `obsidian_update_task` |
| **Escape hatch** | `obsidian_cli` (run any other CLI command — bases, bookmarks, plugins, themes, workspace, history, etc.) |

The escape hatch keeps the curated tool list small while still giving an agent
access to every command the CLI ships with.

## Requirements

- **Node.js ≥ 18**
- **Obsidian CLI** installed and accessible (default: `/usr/local/bin/obsidian`)
- For `obsidian_omnisearch`: the **Omnisearch** community plugin installed and
  its **HTTP server** enabled in plugin settings. Default port: `51361`.
  Obsidian must be running for Omnisearch to be reachable.

## Install

```bash
git clone <this repo>
cd obsidian-mcp-server
npm install
npm run build
```

The build emits `dist/index.js`, which is the executable entry point.

## Configure your MCP client

### Claude Desktop / Claude Code / Cursor / etc.

Add to your MCP client config (e.g. `~/.config/Claude/claude_desktop_config.json` on Linux,
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/absolute/path/to/obsidian-mcp-server/dist/index.js"],
      "env": {
        "OBSIDIAN_CLI_PATH": "/usr/local/bin/obsidian",
        "OBSIDIAN_OMNISEARCH_URL": "http://localhost:51361"
      }
    }
  }
}
```

### Environment variables

All optional. Useful overrides:

| Variable | Default | Purpose |
|---|---|---|
| `OBSIDIAN_CLI_PATH` | `/usr/local/bin/obsidian` | Absolute path to the `obsidian` binary. |
| `OBSIDIAN_OMNISEARCH_URL` | `http://localhost:51361` | Base URL of the Omnisearch HTTP server. |
| `OBSIDIAN_DEFAULT_VAULT` | _(unset)_ | Vault name to target by default if a tool call doesn't pass `vault`. |
| `OBSIDIAN_CLI_TIMEOUT_MS` | `30000` | Per-CLI-call timeout. |
| `OBSIDIAN_OMNISEARCH_TIMEOUT_MS` | `15000` | HTTP timeout for Omnisearch. |
| `OBSIDIAN_MCP_ALLOW_DANGEROUS` | `0` | Set to `1` to allow `obsidian_cli` to run `restart`, `reload`, `plugin:uninstall`, `theme:uninstall`, `plugins:restrict`. |

## Verify the install

Run the MCP Inspector to interact with the server manually:

```bash
npm run inspect
```

Or smoke-test stdio directly:

```bash
node dist/index.js --help-mode-noop  # exits cleanly with stderr banner
```

(There's no real CLI flag; the server only speaks JSON-RPC over stdio. The
Inspector is the right tool for hand-testing.)

## Examples

The descriptions on each tool are designed to read well in a tools/list dump.
A few representative calls, as JSON arguments:

**Read a note**

```json
{ "name": "obsidian_read_note", "arguments": { "file": "Daily/2026-05-26" } }
```

**Append to today's daily note**

```json
{
  "name": "obsidian_daily_note",
  "arguments": {
    "action": "append",
    "content": "- [ ] Review the new MCP server\n- Found a bug in the omnisearch wrapper"
  }
}
```

**Smart search across the vault**

```json
{
  "name": "obsidian_omnisearch",
  "arguments": { "query": "kafka regional token bug", "limit": 5 }
}
```

**Update a task to in-progress**

```json
{
  "name": "obsidian_update_task",
  "arguments": {
    "ref": "Projects/VM Refactor.md:24",
    "action": "set",
    "status": "/"
  }
}
```

**Run an arbitrary CLI command**

```json
{
  "name": "obsidian_cli",
  "arguments": { "command": "bookmarks", "args": ["verbose"] }
}
```

## Design notes

- **stdio transport.** The server wraps local resources, so there is no benefit
  to a streamable-HTTP server. stdio is simpler and matches how Claude Desktop
  and most agent clients launch MCP servers.
- **`execFile`, not `exec`.** No shell is involved when invoking the CLI, so
  values can contain spaces, quotes, or special characters without escaping
  concerns.
- **Content escaping.** The CLI's `content=` parameter accepts `\n` and `\t`
  escape sequences. Real newlines/tabs are converted before being passed in so
  agents can write multi-line content naturally.
- **Truncation.** Responses are capped at 25,000 characters with a clear marker
  and guidance on how to narrow the next call.
- **Two search modes by design.** `obsidian_search` is for exact substring
  lookups and does not require Obsidian to be running; `obsidian_omnisearch`
  is ranked/fuzzy/BM25 and does. The descriptions explicitly tell agents when
  to pick which.
- **Safe defaults for the escape hatch.** `obsidian_cli` refuses
  `restart`/`reload`/uninstall commands unless `OBSIDIAN_MCP_ALLOW_DANGEROUS=1`.

## License

MIT.
