import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
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

// ── Fullstack Templates ─────────────────────────────────────────────────

const FULLSTACK_FILES: Record<string, { file: string; content: string }[]> = {
  fullstack: [
    {
      file: 'models.kern',
      content: `// Shared types — compiled once, imported by api + frontend + mcp
interface name=Todo export=true
  field name=id type=string
  field name=title type=string
  field name=completed type=boolean
  field name=createdAt type=string

interface name=CreateTodoInput export=true
  field name=title type=string required=true

type name=TodoFilter export=true values="all|active|completed"
`,
    },
    {
      file: 'api.kern',
      content: `// Express API — kern compile api.kern --target=express
import from="./models.js" names="Todo,CreateTodoInput" types=true

server name=TodoAPI port=3001
  middleware name=json
  middleware name=cors

  route path="/api/todos" method=get
    handler <<<
      const todos: Todo[] = [];
      res.json(todos);
    >>>

  route path="/api/todos" method=post
    schema body=CreateTodoInput
    handler <<<
      const todo: Todo = {
        id: crypto.randomUUID(),
        title: req.body.title,
        completed: false,
        createdAt: new Date().toISOString(),
      };
      res.status(201).json(todo);
    >>>

  route path="/api/todos/:id" method=get
    handler <<<
      res.json({ id: req.params.id, title: "Example", completed: false, createdAt: new Date().toISOString() });
    >>>
`,
    },
    {
      file: 'frontend.kern',
      content: `// Next.js frontend — kern compile frontend.kern --target=nextjs
import from="./models.js" names="Todo" types=true

page name=TodoApp client=true route="/"
  metadata title="Todo App" description="A simple todo application built with KERN"

  state name=todos initial=[] type=Todo[]
  state name=newTitle initial="" type=string

  effect deps="[]" once=true
    handler <<<
      fetch('/api/todos').then(r => r.json()).then(setTodos);
    >>>

  form action="/api/todos" method=POST
    row
      input bind=newTitle placeholder="What needs to be done?"
      button text="Add Todo"

  list
    text value="Your todos will appear here"
`,
    },
    {
      file: 'mcp-server.kern',
      content: `// MCP server — kern compile mcp-server.kern --target=mcp
import from="./models.js" names="Todo" types=true

mcp name=TodoMCP version=1.0 transport=stdio

  tool name=listTodos
    description text="List all todos, optionally filtered by status"
    param name=filter type=string default=all description="Filter: all, active, or completed"
    handler <<<
      const response = await fetch('http://localhost:3001/api/todos');
      const todos: Todo[] = await response.json();
      const filtered = params.filter === 'all' ? todos
        : todos.filter(t => params.filter === 'completed' ? t.completed : !t.completed);
      return { content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }] };
    >>>

  tool name=addTodo
    description text="Create a new todo item"
    param name=title type=string required=true description="Todo title"
    guard type=sanitize param=title
    handler <<<
      const response = await fetch('http://localhost:3001/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: params.title }),
      });
      const todo = await response.json();
      return { content: [{ type: "text", text: \`Created: \${todo.title} (id: \${todo.id})\` }] };
    >>>
`,
    },
  ],
  nextjs: [
    {
      file: 'app.kern',
      content: `// Next.js app — kern compile app.kern --target=nextjs
page name=Home route="/"
  metadata title="My App" description="Built with KERN"

  row
    col
      text value="Welcome to your KERN app"
      button text="Get Started" to="/about"
`,
    },
  ],
  express: [
    {
      file: 'api.kern',
      content: `// Express API — kern compile api.kern --target=express
server name=MyAPI port=3000
  middleware name=json
  middleware name=cors

  route path="/api/health" method=get
    handler <<<
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    >>>

  route path="/api/hello/:name" method=get
    handler <<<
      res.json({ message: \`Hello, \${req.params.name}!\` });
    >>>
`,
    },
  ],
};

// ── Init command ─────────────────────────────────────────────────────────

export function runInit(args: string[]): void {
  const isMcp = hasFlag(args, '--mcp');
  const template = parseFlag(args, '--template');
  const outArg = args.find((a) => !a.startsWith('--') && a !== 'init');

  // Multi-file templates (fullstack, nextjs, express)
  if (template && template in FULLSTACK_FILES) {
    const dir = resolve(outArg || template);
    if (existsSync(dir) && readdirSync(dir).length > 0) {
      console.error(`Directory not empty: ${dir}`);
      process.exit(1);
    }
    mkdirSync(dir, { recursive: true });
    for (const entry of FULLSTACK_FILES[template]) {
      writeFileSync(resolve(dir, entry.file), entry.content);
      console.log(`  Created ${entry.file}`);
    }
    console.log('');
    console.log('  Next steps:');
    if (template === 'fullstack') {
      console.log(`    cd ${basename(dir)}`);
      console.log('    kern compile models.kern                          # shared types');
      console.log('    kern compile api.kern --target=express             # backend');
      console.log('    kern compile frontend.kern --target=nextjs         # frontend');
      console.log('    kern compile mcp-server.kern --target=mcp          # AI tools');
    } else if (template === 'nextjs') {
      console.log(`    cd ${basename(dir)}`);
      console.log('    kern compile app.kern --target=nextjs --outdir=generated');
    } else if (template === 'express') {
      console.log(`    cd ${basename(dir)}`);
      console.log('    kern compile api.kern --target=express --outdir=generated');
    }
    return;
  }

  // MCP single-file templates
  if (isMcp || (template && template in TEMPLATES)) {
    const tmplName = template || 'file-tools';
    const tmpl = TEMPLATES[tmplName];
    if (!tmpl) {
      console.error(`Unknown template: '${tmplName}'`);
      console.error(`Available: ${[...Object.keys(TEMPLATES), ...Object.keys(FULLSTACK_FILES)].join(', ')}`);
      process.exit(1);
    }

    const outFile = resolve(outArg || `${tmplName}.kern`);
    const outDir = resolve(outFile, '..');

    if (existsSync(outFile)) {
      console.error(`File already exists: ${basename(outFile)}`);
      console.error('Remove it first or choose a different name.');
      process.exit(1);
    }

    mkdirSync(outDir, { recursive: true });
    writeFileSync(outFile, tmpl.content);
    console.log(`  Created ${basename(outFile)} (template: ${tmplName})`);
    console.log('');
    console.log('  Next steps:');
    console.log(`    kern compile ${basename(outFile)} --target=mcp --outdir=generated`);
    console.log('    # or watch for changes:');
    console.log(`    kern compile ${basename(outFile)} --target=mcp --outdir=generated --watch`);
    return;
  }

  // Show usage
  console.error('Usage: kern init --template=<name> [directory]');
  console.error('       kern init --mcp [--template=<name>] [output.kern]');
  console.error('');
  console.error('Project templates:');
  for (const name of Object.keys(FULLSTACK_FILES)) {
    const files = FULLSTACK_FILES[name].map((f) => f.file).join(', ');
    console.error(`  ${name.padEnd(16)} ${files}`);
  }
  console.error('');
  console.error('MCP templates:');
  for (const [name, tmpl] of Object.entries(TEMPLATES)) {
    console.error(`  ${name.padEnd(16)} ${tmpl.description}`);
  }
  process.exit(1);
}
