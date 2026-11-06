import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { registerDemoTools, SAMPLE_CSV } from './server.js';
import { isPublicPagePath, publicPage, type PublicPagePath } from './public-pages.js';
declare const KOHARU_UI_HTML: string;
declare const KOHARU_PUBLIC_CSS: string;
interface BrowserPage {html: string; scriptHash: string}
declare const KOHARU_BROWSER_PAGE: BrowserPage;
declare const KOHARU_DEMO_RECORDING: string | null;

function recordingResponse(request: Request, recording: Uint8Array<ArrayBuffer>, headers: Headers): Response {
  const length = recording.byteLength;
  headers.set('Content-Type', 'video/mp4');
  headers.set('Content-Disposition', 'inline; filename="koharu-plugin-demo.mp4"');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(length));
  headers.set('Cache-Control', 'public, max-age=300, no-transform');
  if (request.method === 'HEAD') return new Response(null, { headers });
  const range = request.headers.get('Range');
  if (!range || request.headers.has('If-Range')) return new Response(recording, { headers });
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  let start = 0;
  let end = length - 1;
  let valid = Boolean(match && (match[1] || match[2]));
  if (match && valid) {
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), length - 1) : end;
    } else {
      const suffixLength = Number(match[2]);
      valid = Number.isSafeInteger(suffixLength) && suffixLength > 0;
      start = Math.max(0, length - suffixLength);
    }
    valid = valid && Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < length && end >= start;
  }
  if (!valid) {
    headers.set('Content-Range', `bytes */${length}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${length}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(recording.slice(start, end + 1), { status: 206, headers });
}

function publicResponse(request: Request, path: string, sharedCss: string, browserPage?: BrowserPage, recording?: Uint8Array<ArrayBuffer>): Response {
  const headers = new Headers({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=300', 'Referrer-Policy': 'no-referrer' });
  const isRecordingRoute = path === '/demo-recording' || path === '/demo-recording.mp4';
  const knownPath = isRecordingRoute ? Boolean(recording?.byteLength) : isPublicPagePath(path) || path === '/example.csv' || path === '/order' && browserPage;
  if (!knownPath) return new Response(request.method === 'HEAD' ? null : 'ページが見つかりません。', { status: 404, headers });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    headers.set('Allow', 'GET, HEAD');
    return new Response('このページはGETまたはHEADで開いてください。', { status: 405, headers });
  }
  if (path === '/demo-recording.mp4' && recording) return recordingResponse(request, recording, headers);
  if (path === '/example.csv') {
    headers.set('Content-Type', 'text/csv; charset=utf-8');
    headers.set('Content-Disposition', 'attachment; filename="example.csv"');
    return new Response(request.method === 'HEAD' ? null : SAMPLE_CSV, { headers });
  }
  headers.set('Content-Type', 'text/html; charset=utf-8');
  if (path === '/order' && browserPage) {
    headers.set('Content-Security-Policy', `default-src 'none'; script-src 'sha256-${browserPage.scriptHash}'; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    return new Response(request.method === 'HEAD' ? null : browserPage.html, {headers});
  }
  const mediaPolicy = path === '/demo-recording' ? "media-src 'self'; " : '';
  headers.set('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; font-src data:; ${mediaPolicy}base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  return new Response(request.method === 'HEAD' ? null : publicPage(path as PublicPagePath, sharedCss), { headers });
}

/** Public surface: official 2026-07-28 SDK, no credentials, shared mutations or provider calls. */
export async function handlePublicMcp(request: Request, appHtml: string, sharedCss = '', browserPage?: BrowserPage, recording?: Uint8Array<ArrayBuffer>): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/mcp') return publicResponse(request, url.pathname, sharedCss, browserPage, recording);
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Accept,MCP-Protocol-Version,Mcp-Session-Id,Mcp-Method,Mcp-Name', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Expose-Headers': 'MCP-Protocol-Version' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
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
const bundledRecording = typeof KOHARU_DEMO_RECORDING === 'string' ? Uint8Array.from(atob(KOHARU_DEMO_RECORDING), character => character.charCodeAt(0)) : undefined;
export default { fetch: (request: Request) => handlePublicMcp(request, KOHARU_UI_HTML, KOHARU_PUBLIC_CSS, KOHARU_BROWSER_PAGE, bundledRecording) };
