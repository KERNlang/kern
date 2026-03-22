// ═══════════════════════════════════════════════════════════════════════
// KERN MCP Security Benchmark — TypeScript SAFE Server
// ═══════════════════════════════════════════════════════════════════════
//
// Properly secured patterns. Should trigger 0 findings (false positive check).
// ═══════════════════════════════════════════════════════════════════════

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, join } from 'path';
import { z } from 'zod';

const server = new McpServer({ name: 'safe-server', version: '1.0.0' });
const ALLOWED_DIR = '/data/workspace';

// Safe: execFile with array args (no shell interpolation)
server.tool('list-files', 'List files in workspace', { dir: z.string() }, async (params) => {
  const safePath = resolve(ALLOWED_DIR, params.dir);
  if (!safePath.startsWith(ALLOWED_DIR)) {
    return { content: [{ type: 'text', text: 'Access denied' }] };
  }
  return new Promise((res, rej) => {
    execFile('ls', ['-la', safePath], (err, stdout) => {
      if (err) rej(err);
      res({ content: [{ type: 'text', text: stdout }] });
    });
  });
});

// Safe: path.resolve + startsWith containment check
server.tool('read-file', 'Read a file from workspace', { path: z.string() }, async (params) => {
  const safePath = resolve(ALLOWED_DIR, params.path);
  if (!safePath.startsWith(ALLOWED_DIR)) {
    return { content: [{ type: 'text', text: 'Path traversal blocked' }] };
  }
  const content = readFileSync(safePath, 'utf-8');
  return { content: [{ type: 'text', text: sanitizeForResponse(content) }] };
});

// Safe: clean description, no hidden instructions
server.tool('summarize', 'Summarize the given text input', { text: z.string() }, async (params) => {
  return { content: [{ type: 'text', text: `Summary: ${params.text.slice(0, 100)}` }] };
});

// Safe: API key from environment variable
server.tool('search', 'Search the web', { query: z.string() }, async (params) => {
  const apiKey = process.env.SEARCH_API_KEY;
  const res = await fetch(`https://api.search.com?key=${apiKey}&q=${encodeURIComponent(params.query)}`);
  return { content: [{ type: 'text', text: await res.text() }] };
});

// Safe: sanitized response from external data
server.tool('get-users', 'Get user list', { limit: z.number() }, async (params) => {
  const db = (globalThis as any).db;
  const rows = await db.query('SELECT name, email FROM users LIMIT $1', [params.limit]);
  const sanitized = sanitizeForResponse(JSON.stringify(rows));
  return { content: [{ type: 'text', text: sanitized }] };
});

// Safe: Zod schema validates input
server.tool('calculate', 'Perform calculation', {
  operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
  a: z.number(),
  b: z.number(),
}, async (params) => {
  const ops: Record<string, (a: number, b: number) => number> = {
    add: (a, b) => a + b, subtract: (a, b) => a - b,
    multiply: (a, b) => a * b, divide: (a, b) => a / b,
  };
  return { content: [{ type: 'text', text: String(ops[params.operation](params.a, params.b)) }] };
});

declare function sanitizeForResponse(s: string): string;
export { server };
