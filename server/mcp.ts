// Cloudflare Pages Function: the uxspot MCP server at /mcp.
// Thin route wrapper — all protocol + tool logic lives in ./_mcp.ts so it stays
// framework-agnostic and testable. See docs/MCP-SERVER.md.
import { handleMcp, type AnalyticsDataset } from './_mcp';

// MCP_ANALYTICS: Workers Analytics Engine binding, added in the Pages project
// dashboard (Settings -> Bindings). Optional — the server runs without it.
export const onRequest: PagesFunction<{ MCP_ANALYTICS?: AnalyticsDataset }> = (context) =>
  handleMcp(context.request, context.env.MCP_ANALYTICS);
