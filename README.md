# uxspot MCP server

The UX reference your AI assistant can call.

[uxspot.io](https://uxspot.io) is a free, curated UX reference — a 198-term glossary, an AI x UX tools directory, 5 interactive checklists, and a 77-topic Learn UX curriculum. This repository documents its remote [Model Context Protocol](https://modelcontextprotocol.io) server, which exposes all of that as callable tools for Claude, Cursor, and any other MCP client.

- **Endpoint:** `https://uxspot.io/mcp` (remote, Streamable HTTP, stateless)
- **Landing page and live demo:** [uxspot.io/mcp-server](https://uxspot.io/mcp-server)
- **Auth:** none — no key, no account, no rate-limit signup
- **Privacy:** every tool is read-only over public uxspot.io content. The server never sees your project, files, or account.

## Install

**Claude Code**

```sh
claude mcp add --transport http uxspot https://uxspot.io/mcp
```

**Claude Desktop** — Settings → Connectors → Add custom connector, with URL `https://uxspot.io/mcp`.

**Cursor** — add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "uxspot": { "url": "https://uxspot.io/mcp" }
  }
}
```

**Any other MCP client** that supports the Streamable HTTP transport: point it at `https://uxspot.io/mcp`.

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `search_glossary` | `query` | Matching UX terms with definitions and source URLs |
| `define_term` | `term` | One term's definition and source URL |
| `list_ux_tools` | `category?` | The curated AI x UX tools directory, optionally filtered |
| `list_checklists` | — | The 5 checklists with topic and item counts |
| `get_checklist` | `slug` | One checklist in full: every topic and item |
| `search_curriculum` | `query` | Matching Learn UX topics with HTML and Markdown URLs |
| `get_curriculum` | — | The full Learn UX syllabus outline |

Every answer cites its uxspot.io source URL, so you (and your assistant) can verify it.

## Try it

Ask your assistant things like:

- "What's an affordance in UX — and where can I read more?"
- "List AI tools for UX research"
- "Give me the accessibility checklist"
- "Search the curriculum for usability testing"

## How it is built

The server is a single Cloudflare Pages Function in front of the static uxspot.io site. Each POST is a complete JSON-RPC exchange (stateless Streamable HTTP — no sessions, no database), and the tools read the same structured data that powers the live site, so responses are always in sync with what is published.

The code in [`server/`](server/) is a read-only mirror of the deployed function, published here for transparency and for MCP directory listings. The source of truth lives in the main uxspot site repository; the data files it imports (`glossary.json`, `tools.json`, `checklists.json`, `curriculum.ts`) live there too, so this mirror is for reading, not building.

## License

The server code in this repository is released under the [MIT License](LICENSE). The uxspot.io content the tools serve (definitions, checklists, curriculum) remains © Soufiane Chraibi and is licensed for use via the site and this API, not for bulk redistribution.
