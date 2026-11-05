import { readFile } from 'node:fs/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDemoServer } from './server.js';

try {
  const html = await readFile(new URL('./ui.html', import.meta.url), 'utf8');
  const server = createDemoServer(html);
  await server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 256_000 }));
} catch {
  // stdout belongs exclusively to MCP. Never print environment or raw exceptions.
  console.error('こはる珈琲デモを起動できませんでした。配布物のbuildを確認してください。');
  process.exitCode = 1;
}
