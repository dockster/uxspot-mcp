// uxspot MCP server — framework-agnostic core.
// Stateless remote MCP over Streamable HTTP: each POST is a complete JSON-RPC
// exchange. Read-only tools over the site's existing structured data, so no
// sessions, no DB. Underscore filename = not a Pages route (imported by mcp.ts).
//
// See docs/MCP-SERVER.md.

import glossary from '../src/data/glossary.json';
import toolsData from '../src/data/tools.json';
import checklists from '../src/data/checklists.json';
import { curriculum } from '../src/data/curriculum';
import { nearestFor } from '../src/lib/glossaryRelated';

const SITE = 'https://uxspot.io';
const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'uxspot', version: '1.1.0' };

// Cloudflare Workers Analytics Engine dataset (bound in the Pages dashboard as
// MCP_ANALYTICS). Minimal structural type — @cloudflare/workers-types is not a
// dependency and the binding is optional: local dev and unit tests pass none.
export interface AnalyticsDataset {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

// One data point per JSON-RPC request message. Cookieless, no PII: method,
// tool name, and the client name/version from `initialize` (blank elsewhere).
// index1 = tool-or-method so per-tool sampling stays balanced.
function track(analytics: AnalyticsDataset | undefined, msg: any, userAgent: string): void {
  if (!analytics) return;
  try {
    const method = typeof msg?.method === 'string' ? msg.method : 'invalid';
    const tool = method === 'tools/call' && typeof msg?.params?.name === 'string' ? msg.params.name : '';
    const client = method === 'initialize' ? msg?.params?.clientInfo : undefined;
    analytics.writeDataPoint({
      indexes: [(tool || method).slice(0, 96)],
      blobs: [method, tool, String(client?.name || ''), String(client?.version || ''), userAgent.slice(0, 256)],
      doubles: [1],
    });
  } catch {
    // Analytics must never break the protocol exchange.
  }
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

interface Term { slug: string; term: string; definition: string }
interface ToolItem { name: string; url: string; description: string }
interface ToolGroup { name: string; blurb: string; tools: ToolItem[] }
interface ChecklistItem { id: string; label: string; note?: string }
interface ChecklistTopic { name: string; items: ChecklistItem[] }
interface Checklist { slug: string; title: string; desc: string; topics: ChecklistTopic[] }

const TERMS = glossary as Term[];
const TOOL_GROUPS = toolsData as ToolGroup[];
const CHECKLISTS = checklists as Checklist[];

// ---- Tool definitions (advertised via tools/list) ----

const TOOLS = [
  {
    name: 'search_glossary',
    description: 'Search the uxspot UX glossary (198 terms). Returns matching terms with their plain-English definitions and source URLs.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Text to match against term names and definitions.' } },
      required: ['query'],
    },
  },
  {
    name: 'define_term',
    description: 'Look up one UX term and return its definition and source URL.',
    inputSchema: {
      type: 'object',
      properties: { term: { type: 'string', description: 'The exact or approximate term to define, e.g. "empathy map".' } },
      required: ['term'],
    },
  },
  {
    name: 'list_ux_tools',
    description: 'List the curated uxspot AI x UX design tools directory (42 tools across 6 categories), optionally filtered by category.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category filter.',
          enum: TOOL_GROUPS.map((g) => g.name),
        },
      },
    },
  },
  {
    name: 'list_checklists',
    description: 'List the 5 interactive uxspot checklists with their topic and item counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_checklist',
    description: 'Get one checklist in full: every topic and every checkable item.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'Checklist slug: ux, ds, ai, a11y, or usability.' } },
      required: ['slug'],
    },
  },
  {
    name: 'search_curriculum',
    description: 'Search the Learn UX curriculum (77 topics) by keyword. Returns matching topics with their HTML and raw-Markdown URLs.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Keyword to match against topic titles and section names.' } },
      required: ['query'],
    },
  },
  {
    name: 'get_curriculum',
    description: 'Return the full Learn UX curriculum outline (13 sections, 77 topics) with URLs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'spot_check',
    description:
      'Play Spot Check — the uxspot daily UX vocabulary game — with the user. Returns one quiz round: a UX term paired with a definition that is EITHER its real definition OR a plausible fake (a closely-related term\'s real definition), plus the answer and explanation. Show the user the term and the definition, ask "does this definition fit?", let them guess, then reveal. Call again for another round. Full daily game at ' + SITE + '/practice.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ---- Tool handlers (all return a plain-text string) ----

const lc = (s: string) => (s || '').toLowerCase();

const handlers: Record<string, (args: any) => string> = {
  search_glossary(args) {
    const q = lc(args.query);
    if (!q) return 'Provide a "query" to search the glossary.';
    const hits = TERMS.filter((t) => lc(t.term).includes(q) || lc(t.definition).includes(q)).slice(0, 12);
    if (!hits.length) return `No glossary terms match "${args.query}".`;
    const more = TERMS.filter((t) => lc(t.term).includes(q) || lc(t.definition).includes(q)).length - hits.length;
    const body = hits.map((t) => `**${t.term}** — ${t.definition}\n${SITE}/glossary/${t.slug}`).join('\n\n');
    return body + (more > 0 ? `\n\n(+${more} more; narrow the query to see them.)` : '');
  },

  define_term(args) {
    const q = lc(args.term);
    if (!q) return 'Provide a "term" to define.';
    const exact = TERMS.find((t) => lc(t.term) === q);
    const starts = TERMS.find((t) => lc(t.term).startsWith(q));
    const incl = TERMS.find((t) => lc(t.term).includes(q));
    const t = exact || starts || incl;
    if (!t) return `"${args.term}" is not in the glossary. Try search_glossary for related terms.`;
    return `**${t.term}**\n${t.definition}\n\nSource: ${SITE}/glossary/${t.slug}`;
  },

  list_ux_tools(args) {
    const cat = lc(args.category);
    const groups = cat ? TOOL_GROUPS.filter((g) => lc(g.name).includes(cat)) : TOOL_GROUPS;
    if (!groups.length) return `No tool category matches "${args.category}". Categories: ${TOOL_GROUPS.map((g) => g.name).join(', ')}.`;
    return groups
      .map((g) => `## ${g.name}\n${g.blurb}\n${g.tools.map((t) => `- **${t.name}** — ${t.description} (${t.url})`).join('\n')}`)
      .join('\n\n');
  },

  list_checklists() {
    return CHECKLISTS.map((c) => {
      const items = c.topics.reduce((n, t) => n + t.items.length, 0);
      return `- **${c.title}** (slug: ${c.slug}) — ${c.desc} ${c.topics.length} topics, ${items} items.\n  ${SITE}/checklist-${c.slug}`;
    }).join('\n');
  },

  get_checklist(args) {
    const slug = lc(args.slug).replace(/^checklist-/, '');
    const c = CHECKLISTS.find((x) => x.slug === slug);
    if (!c) return `No checklist "${args.slug}". Available: ${CHECKLISTS.map((x) => x.slug).join(', ')}.`;
    const topics = c.topics
      .map((t) => `## ${t.name}\n${t.items.map((i) => `- [ ] ${i.label}${i.note ? ` — ${i.note}` : ''}`).join('\n')}`)
      .join('\n\n');
    return `# ${c.title}\n${c.desc}\n${SITE}/checklist-${c.slug}\n\n${topics}`;
  },

  search_curriculum(args) {
    const q = lc(args.query);
    if (!q) return 'Provide a "query" to search the curriculum.';
    const hits: string[] = [];
    for (const section of curriculum) {
      const sectionMatch = lc(section.title).includes(q);
      for (const item of section.items) {
        if (!item.href) continue;
        if (sectionMatch || lc(item.title).includes(q)) {
          hits.push(`- ${item.title} (${section.number} — ${section.title})\n  ${SITE}${item.href} · Markdown: ${SITE}${item.href}.md`);
        }
      }
    }
    if (!hits.length) return `No curriculum topics match "${args.query}".`;
    return hits.slice(0, 15).join('\n') + (hits.length > 15 ? `\n\n(+${hits.length - 15} more.)` : '');
  },

  get_curriculum() {
    return (
      `# Learn UX curriculum — uxspot.io\n\n` +
      curriculum
        .map(
          (s) =>
            `## ${s.number} — ${s.title}\n` +
            s.items
              .map((i) => (i.href ? `- ${i.title} (${SITE}${i.href})` : `- ${i.title} (planned)`))
              .join('\n')
        )
        .join('\n\n')
    );
  },

  spot_check() {
    const term = TERMS[Math.floor(Math.random() * TERMS.length)];
    const realOne = Math.random() < 0.5;
    const head =
      `**Spot Check** — does this definition fit the term?\n\n` +
      `**Term:** ${term.term}\n`;
    if (realOne) {
      return (
        head +
        `**Definition shown:** "${term.definition}"\n\n` +
        `--- (don't reveal until the user guesses)\n` +
        `**Answer:** IT FITS — this is the real definition of **${term.term}**.\n\n` +
        `Source: ${SITE}/glossary/${term.slug} · Play the daily game: ${SITE}/practice`
      );
    }
    // Plausible fake: a genuinely-related term's real definition (never random).
    const near = nearestFor(term, 5);
    const decoy = near[Math.floor(Math.random() * near.length)] || TERMS.find((t) => t.slug !== term.slug)!;
    return (
      head +
      `**Definition shown:** "${decoy.definition}"\n\n` +
      `--- (don't reveal until the user guesses)\n` +
      `**Answer:** IT DOESN'T FIT — that's actually the definition of **${decoy.term}**. ` +
      `**${term.term}** really means: ${term.definition}\n\n` +
      `Source: ${SITE}/glossary/${term.slug} · Play the daily game: ${SITE}/practice`
    );
  },
};

// ---- JSON-RPC dispatch ----

const result = (id: any, res: any) => ({ jsonrpc: '2.0', id, result: res });
const error = (id: any, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

function dispatch(msg: any): any | null {
  const { id, method, params } = msg || {};
  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'uxspot.io UX reference. Use these tools to define UX glossary terms, browse the curated AI x UX tools directory, read the interactive checklists, and search the Learn UX curriculum. Cite the returned uxspot.io URLs.',
      });
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params?.name;
      const handler = handlers[name];
      if (!handler) return result(id, { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true });
      try {
        const text = handler(params?.arguments || {});
        return result(id, { content: [{ type: 'text', text }], isError: false });
      } catch (e: any) {
        return result(id, { content: [{ type: 'text', text: `Tool error: ${e?.message || e}` }], isError: true });
      }
    }
    default:
      // Notifications (e.g. notifications/initialized) carry no id — no reply.
      if (id === undefined || id === null) return null;
      return error(id, -32601, `Method not found: ${method}`);
  }
}

function jsonResponse(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ---- HTTP entry ----

export async function handleMcp(request: Request, analytics?: AnalyticsDataset): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method === 'GET') {
    // Streamable HTTP GET is for server-initiated SSE; this server is
    // request/response only.
    return new Response('This is the uxspot MCP endpoint. POST JSON-RPC to use it. Docs: https://uxspot.io/mcp-server', {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', Allow: 'POST, OPTIONS' },
    });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(error(null, -32700, 'Parse error'), 400);
  }

  const userAgent = request.headers.get('User-Agent') || '';

  if (Array.isArray(body)) {
    for (const msg of body) track(analytics, msg, userAgent);
    const responses = body.map(dispatch).filter((r) => r !== null);
    if (!responses.length) return new Response(null, { status: 202, headers: CORS });
    return jsonResponse(responses);
  }

  track(analytics, body, userAgent);
  const res = dispatch(body);
  if (res === null) return new Response(null, { status: 202, headers: CORS });
  return jsonResponse(res);
}
