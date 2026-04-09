# Fullstack KERN Example

A complete Todo app with **Next.js frontend** + **Express API** + **MCP server** + **shared types** — all generated from `.kern` files.

## Quick Start

```bash
# 1. Install KERN CLI
npm install -g @kernlang/cli

# 2. Scaffold from template (or use these files directly)
kern init --template=fullstack my-todo-app
cd my-todo-app

# 3. Compile shared types
kern compile models.kern

# 4. Compile the Express API
kern compile api.kern --target=express --outdir=generated/api

# 5. Compile the Next.js frontend
kern compile frontend.kern --target=nextjs --outdir=generated/app

# 6. Compile the MCP server
kern compile mcp-server.kern --target=mcp --outdir=generated/mcp

# 7. Run the API
cd generated/api && npx tsx server.ts

# 8. Run the MCP server (in another terminal)
cd generated/mcp && npx tsx server.ts
```

## What's in each file

| File | Target | What it generates |
|------|--------|-------------------|
| `models.kern` | (default) | TypeScript interfaces — `Todo`, `CreateTodoInput`, `TodoFilter` |
| `api.kern` | `--target=express` | Express server with CRUD routes on port 3001 |
| `frontend.kern` | `--target=nextjs` | Next.js page with state, effects, form |
| `mcp-server.kern` | `--target=mcp` | MCP server with `listTodos` + `addTodo` tools |

## Watch mode

```bash
kern compile . --target=express --watch --facades --index
```
