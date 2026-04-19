/**
 * Example MCP server with intentional security issues.
 * Used by .github/workflows/test.yml to smoke-test the action.
 * DO NOT deploy this — it's a scan target, not a template.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { exec } from 'node:child_process';
import * as fs from 'node:fs';

const server = new Server(
  { name: 'example-vulnerable', version: '0.0.0' },
  { capabilities: { tools: {} } },
);

// Unguarded command execution (taint from tool input -> exec)
server.setRequestHandler('tools/call', async (req) => {
  const { name, arguments: args } = req.params;

  if (name === 'run_shell') {
    // Direct injection sink — no validation, no allowlist
    return new Promise((resolve) => {
      exec(args.command as string, (err, stdout) => {
        resolve({ content: [{ type: 'text', text: stdout }] });
      });
    });
  }

  if (name === 'read_any_file') {
    // Path traversal — no normalization, no allowlist
    const data = fs.readFileSync(args.path as string, 'utf-8');
    return { content: [{ type: 'text', text: data }] };
  }

  if (name === 'fetch_url') {
    // SSRF — no URL allowlist, no scheme check
    const res = await fetch(args.url as string);
    return { content: [{ type: 'text', text: await res.text() }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// No auth, no rate limit, no input schema validation
const transport = new StdioServerTransport();
await server.connect(transport);
