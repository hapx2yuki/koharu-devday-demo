import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { registerDemoTools } from './server.js';
declare const KOHARU_UI_HTML: string;

/** Public surface: official 2026-07-28 SDK, no credentials, shared mutations or provider calls. */
export async function handlePublicMcp(request: Request, appHtml: string): Promise<Response> {
  const url = new URL(request.url);
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Accept,MCP-Protocol-Version,Mcp-Session-Id,Mcp-Method,Mcp-Name', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Expose-Headers': 'MCP-Protocol-Version' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (url.pathname !== '/mcp') return new Response('こはる珈琲デモの公開MCP。架空データの読取・集計のみ。', { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
  // Sites probes the supported revisions before adding MCP2's per-request
  // envelope. This narrow discovery compatibility path advertises the real
  // SDK2 implementation below; all tool/resource execution stays in the SDK.
  if (request.method === 'POST') {
    let raw = ''; let bytes = 0;
    const reader = request.body?.getReader(); const decoder = new TextDecoder();
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          bytes += chunk.value.length;
          if (bytes > 150_000) { await reader.cancel(); return new Response('Payload too large', { status: 413, headers: cors }); }
          raw += decoder.decode(chunk.value, { stream: true });
        }
        raw += decoder.decode();
      } finally { reader.releaseLock(); }
    }
    let probe: unknown;
    try { probe = JSON.parse(raw); } catch { /* The SDK owns malformed requests. */ }
    if (!request.headers.has('MCP-Protocol-Version') && probe && typeof probe === 'object' && !Array.isArray(probe)) {
      const p = probe as Record<string, unknown>;
      const emptyParams = p.params === undefined || p.params !== null && typeof p.params === 'object' && !Array.isArray(p.params) && Object.keys(p.params).length === 0;
      const validId = typeof p.id === 'string' || typeof p.id === 'number' && Number.isFinite(p.id);
      if (p.jsonrpc === '2.0' && p.method === 'server/discover' && emptyParams && validId) {
        return Response.json({ jsonrpc: '2.0', id: p.id, result: { supportedVersions: ['2026-07-28'], capabilities: { tools: {}, resources: {} } } }, { headers: { ...cors, 'Cache-Control': 'no-store' } });
      }
    }
    request = new Request(request, { body: raw });
  }
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'koharu-demo-public', version: '0.1.0' }, { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
    registerDemoTools(server, appHtml, 'public-readonly');
    return server;
  }, { legacy: 'stateless', maxRequestBodySize: 150_000 });
  const response = await handler.fetch(request);
  const headers = new Headers(response.headers); for (const [k,v] of Object.entries(cors)) headers.set(k,v);
  return new Response(response.body, { status: response.status, headers });
}
export default { fetch: (request: Request) => handlePublicMcp(request, KOHARU_UI_HTML) };
