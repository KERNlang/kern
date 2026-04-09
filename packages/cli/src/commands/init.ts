import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import { hasFlag, parseFlag } from '../shared.js';

// ── MCP Templates ───────────────────────────────────────────────────────

const TEMPLATES: Record<string, { description: string; content: string }> = {
  'file-tools': {
    description: 'File operations MCP server with path safety guards',
    content: `mcp name=FileTools version=1.0

  tool name=readFile
    description text="Read a file's contents within allowed directories"
    param name=filePath type=string required=true description="Path to the file"
    guard type=pathContainment param=filePath allowlist=/data,/home
    handler <<<
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(params.filePath as string, 'utf-8');
      return { content: [{ type: "text", text: content }] };
    >>>

  tool name=listFiles
    description text="List files in a directory"
    param name=directory type=string required=true description="Directory to list"
    guard type=pathContainment param=directory allowlist=/data,/home
    handler <<<
      const fs = await import('node:fs/promises');
      const files = await fs.readdir(params.directory as string);
      return { content: [{ type: "text", text: files.join('\\n') }] };
    >>>

  tool name=searchFiles
    description text="Search for files matching a pattern"
    param name=query type=string required=true description="Search query"
    param name=maxResults type=number default=50 description="Maximum results to return"
    guard type=sanitize param=query
    guard type=validate param=maxResults min=1 max=500
    handler <<<
      // TODO: Implement file search logic
      return { content: [{ type: "text", text: "Search results for: " + params.query }] };
    >>>
`,
  },

  'api-gateway': {
    description: 'HTTP API gateway MCP server with auth and rate limiting',
    content: `mcp name=APIGateway version=1.0 transport=stdio

  tool name=apiRequest
    description text="Make an authenticated API request"
    param name=url type=string required=true description="API endpoint URL"
    param name=method type=string default=GET description="HTTP method"
    param name=body type=string required=false description="Request body (JSON)"
    guard type=sanitize param=url
    guard type=auth envVar=API_AUTH_TOKEN
    guard type=rateLimit maxRequests=60 windowMs=60000
    handler <<<
      const response = await fetch(params.url as string, {
        method: (params.method as string) || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \\\`Bearer \\\${process.env.API_AUTH_TOKEN}\\\`,
        },
        ...(params.body ? { body: params.body as string } : {}),
      });
      const data = await response.text();
      return { content: [{ type: "text", text: data }] };
    >>>

  resource name=apiStatus uri="status://health"
    description text="API gateway health status"
    handler <<<
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
        }],
      };
    >>>
`,
  },

  'database-tools': {
    description: 'Database query MCP server with input validation',
    content: `mcp name=DatabaseTools version=1.0

  tool name=query
    description text="Run a read-only database query"
    param name=sql type=string required=true description="SQL query (SELECT only)"
    param name=limit type=number default=100 description="Row limit"
    guard type=sanitize param=sql
    guard type=validate param=limit min=1 max=1000
    handler <<<
      // Enforce read-only queries
      const normalized = (params.sql as string).trim().toUpperCase();
      if (!normalized.startsWith('SELECT')) {
        throw new Error('Only SELECT queries are allowed');
      }
      // TODO: Connect to your database
      return { content: [{ type: "text", text: "Query results would appear here" }] };
    >>>

  tool name=listTables
    description text="List available database tables"
    handler <<<
      // TODO: Connect to your database and list tables
      return { content: [{ type: "text", text: "Tables: users, posts, comments" }] };
    >>>

  tool name=describeTable
    description text="Show columns and types for a table"
    param name=tableName type=string required=true description="Table name"
    guard type=sanitize param=tableName
    handler <<<
      // TODO: Connect to your database
      return { content: [{ type: "text", text: "Columns for: " + params.tableName }] };
    >>>
`,
  },
};

// ── Init command ─────────────────────────────────────────────────────────

export function runInit(args: string[]): void {
  const isMcp = hasFlag(args, '--mcp');
  const template = parseFlag(args, '--template') || 'file-tools';
  const outArg = args.find((a) => !a.startsWith('--') && a !== 'init');

  if (!isMcp) {
    console.error('Usage: kern init --mcp [--template=<name>] [output.kern]');
    console.error('');
    console.error('Templates:');
    for (const [name, tmpl] of Object.entries(TEMPLATES)) {
      console.error(`  ${name.padEnd(16)} ${tmpl.description}`);
    }
    process.exit(1);
  }

  const tmpl = TEMPLATES[template];
  if (!tmpl) {
    console.error(`Unknown template: '${template}'`);
    console.error(`Available: ${Object.keys(TEMPLATES).join(', ')}`);
    process.exit(1);
  }

  const outFile = resolve(outArg || `${template}.kern`);
  const outDir = resolve(outFile, '..');

  if (existsSync(outFile)) {
    console.error(`File already exists: ${basename(outFile)}`);
    console.error('Remove it first or choose a different name.');
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, tmpl.content);
  console.log(`  Created ${basename(outFile)} (template: ${template})`);
  console.log('');
  console.log('  Next steps:');
  console.log(`    kern compile ${basename(outFile)} --target=mcp --outdir=generated`);
  console.log('    # or watch for changes:');
  console.log(`    kern compile ${basename(outFile)} --target=mcp --outdir=generated --watch`);
}
