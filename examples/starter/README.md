# KERN Starter — Express API + MCP Server + Shared Types

A full-stack starter showing how KERN compiles `.kern` files to production code across multiple targets.

## Structure

```
starter/
  models.kern     → Shared TypeScript types (interfaces, type aliases)
  api.kern        → Express REST API (4 endpoints)
  mcp.kern        → MCP server (3 tools that call the API)
```

## Quick Start

```bash
# 1. Compile shared types
kern compile models.kern --outdir=generated --index

# 2. Compile Express API
kern compile api.kern --target=express --outdir=generated/api

# 3. Compile MCP server
kern compile mcp.kern --target=mcp --outdir=generated/mcp

# Or watch everything at once:
kern compile . --target=express --outdir=generated --watch --facades --index
```

## What This Demonstrates

- **Shared types**: `models.kern` defines interfaces used by both API and MCP server
- **Express API**: `api.kern` compiles to a full Express server with routes, middleware, validation
- **MCP server**: `mcp.kern` compiles to a Model Context Protocol server with security guards
- **Security by default**: MCP tools have input sanitization and validation guards auto-injected

## The Flow

```
models.kern ──→ TypeScript interfaces (shared)
api.kern    ──→ Express server (localhost:3001)
mcp.kern    ──→ MCP server (calls the Express API)
```

AI agents connect to the MCP server, which calls your Express API. Types are shared.
