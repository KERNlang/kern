#!/usr/bin/env node
/**
 * @kernlang/mcp-server — KERN MCP Server
 *
 * Exposes KERN's compile, review, parse, and analysis tools via MCP.
 * AI agents can use these tools to write, compile, and review .kern files.
 *
 * Usage:
 *   kern-mcp                    # stdio transport (default)
 *
 * Claude Desktop config:
 *   { "mcpServers": { "kern": { "command": "kern-mcp" } } }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  parse,
  resolveConfig,
  serializeIR,
  countTokens,
  VALID_TARGETS,
  KERN_VERSION,
  NODE_TYPES,
  STYLE_SHORTHANDS,
} from '@kernlang/core';
import type { KernTarget, IRNode, ResolvedKernConfig } from '@kernlang/core';

import { transpileWeb, transpileTailwind, transpileNextjs } from '@kernlang/react';
import { transpileExpress } from '@kernlang/express';
import { transpileFastAPI } from '@kernlang/fastapi';
import { transpileTerminal, transpileInk } from '@kernlang/terminal';
import { transpileVue, transpileNuxt } from '@kernlang/vue';
import { transpileMCP } from '@kernlang/mcp';
import { reviewSource } from '@kernlang/review';

const KERN_GRAMMAR = `
document   = node+
node       = indent type (SP prop)* (SP style)? NL child*
prop       = ident "=" value
value      = quoted | bare
style      = "{" spair ("," spair)* "}"
`.trim();

// ── Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'kern',
  version: '3.0.0',
});

// ── Helpers ─────────────────────────────────────────────────────────────

function log(event: string, details: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: 'info', event, ...details, ts: new Date().toISOString() }));
}

function err(event: string, details: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: 'error', event, ...details, ts: new Date().toISOString() }));
}

function transpile(ast: IRNode, target: KernTarget, config: ResolvedKernConfig) {
  switch (target) {
    case 'web':       return transpileWeb(ast, config);
    case 'tailwind':  return transpileTailwind(ast, config);
    case 'nextjs':    return transpileNextjs(ast, config);
    case 'express':   return transpileExpress(ast, config);
    case 'fastapi':   return transpileFastAPI(ast, config);
    case 'terminal':  return transpileTerminal(ast, config);
    case 'ink':       return transpileInk(ast, config);
    case 'vue':       return transpileVue(ast, config);
    case 'nuxt':      return transpileNuxt(ast, config);
    case 'mcp':       return transpileMCP(ast, config);
    default:          return transpileNextjs(ast, config);
  }
}

// ── Tools ───────────────────────────────────────────────────────────────

// 1. compile — parse .kern and transpile to target
server.tool(
  'compile',
  'Compile .kern source code to a target framework. Returns generated code.',
  {
    source: z.string().describe('The .kern source code to compile'),
    target: z.enum(VALID_TARGETS as [string, ...string[]]).default('nextjs').describe('Target framework (nextjs, react, express, fastapi, mcp, vue, etc.)'),
  },
  async ({ source, target }) => {
    log('tool:compile', { target, sourceLen: source.length });
    try {
      const ast = parse(source);
      const config = resolveConfig({ target: target as KernTarget });
      const result = transpile(ast, target as KernTarget, config);

      const response = [
        `// Compiled to ${target} (${result.tsTokenCount} tokens, ${result.irTokenCount} IR tokens)`,
        result.code,
      ].join('\n');

      if (result.artifacts && result.artifacts.length > 0) {
        const artifactList = result.artifacts.map(a => `--- ${a.path} ---\n${a.content}`).join('\n\n');
        return { content: [{ type: 'text' as const, text: response + '\n\n' + artifactList }] };
      }

      return { content: [{ type: 'text' as const, text: response }] };
    } catch (error) {
      err('tool:compile:error', { error: error instanceof Error ? error.message : String(error) });
      return { isError: true as const, content: [{ type: 'text' as const, text: `Compile error: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  }
);

// 2. review — run static analysis on source code
server.tool(
  'review',
  'Run KERN static analysis on TypeScript/JavaScript source code. Returns security findings, code quality issues, and KERN coverage.',
  {
    source: z.string().describe('The source code to review'),
    filePath: z.string().default('input.ts').describe('File path for context (affects which rules apply)'),
    target: z.enum(VALID_TARGETS as [string, ...string[]]).default('nextjs').describe('Target framework for context-specific rules'),
  },
  async ({ source, filePath, target }) => {
    log('tool:review', { filePath, target, sourceLen: source.length });
    try {
      const report = reviewSource(source, filePath, { target: target as KernTarget });
      const findings = report.findings;

      if (findings.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No issues found.' }] };
      }

      const lines = findings.map(f => {
        const loc = f.primarySpan?.startLine ? `L${f.primarySpan.startLine}` : '';
        const conf = f.confidence !== undefined ? ` [${f.confidence.toFixed(2)}]` : '';
        const sev = f.severity === 'error' ? '!' : f.severity === 'warning' ? '~' : '-';
        return `${sev} ${loc}: [${f.ruleId}]${conf} ${f.message}`;
      });

      const summary = `${findings.length} finding(s) — ${findings.filter(f => f.severity === 'error').length} errors, ${findings.filter(f => f.severity === 'warning').length} warnings`;

      return { content: [{ type: 'text' as const, text: `${summary}\n\n${lines.join('\n')}` }] };
    } catch (error) {
      err('tool:review:error', { error: error instanceof Error ? error.message : String(error) });
      return { isError: true as const, content: [{ type: 'text' as const, text: `Review error: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  }
);

// 3. parse — parse .kern to IR (useful for AI introspection)
server.tool(
  'parse',
  'Parse .kern source code and return the IR (intermediate representation) tree. Useful for understanding the structure of .kern code.',
  {
    source: z.string().describe('The .kern source code to parse'),
  },
  async ({ source }) => {
    log('tool:parse', { sourceLen: source.length });
    try {
      const ast = parse(source);
      const ir = serializeIR(ast);
      const tokenCount = countTokens(ir);
      return { content: [{ type: 'text' as const, text: `// ${tokenCount} IR tokens\n${ir}` }] };
    } catch (error) {
      err('tool:parse:error', { error: error instanceof Error ? error.message : String(error) });
      return { isError: true as const, content: [{ type: 'text' as const, text: `Parse error: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  }
);

// 4. validate — check .kern syntax without compiling
server.tool(
  'validate',
  'Validate .kern source code syntax. Returns any parse errors or warnings without compiling.',
  {
    source: z.string().describe('The .kern source code to validate'),
  },
  async ({ source }) => {
    log('tool:validate', { sourceLen: source.length });
    try {
      const ast = parse(source);
      const nodeCount = countNodes(ast);
      return { content: [{ type: 'text' as const, text: `Valid .kern — ${nodeCount} node(s) parsed successfully.` }] };
    } catch (error) {
      return { isError: true as const, content: [{ type: 'text' as const, text: `Syntax error: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  }
);

// 5. list-targets — return available compile targets
server.tool(
  'list-targets',
  'List all available KERN compile targets with descriptions.',
  {},
  async () => {
    const targets: Record<string, string> = {
      nextjs:   'Next.js (App Router, TypeScript/React)',
      tailwind: 'React + Tailwind CSS',
      web:      'Plain React components',
      vue:      'Vue 3 Single-File Components',
      nuxt:     'Nuxt 3 (Vue meta-framework)',
      express:  'Express TypeScript REST API',
      fastapi:  'FastAPI Python async backend',
      native:   'React Native (iOS/Android)',
      cli:      'Node.js CLI application',
      terminal: 'Terminal UI (ANSI)',
      ink:      'Ink (React for terminals)',
      mcp:      'MCP server (Model Context Protocol)',
    };

    const lines = Object.entries(targets).map(([k, v]) => `  ${k.padEnd(10)} — ${v}`);
    return { content: [{ type: 'text' as const, text: `KERN v${KERN_VERSION} — ${VALID_TARGETS.length} targets:\n\n${lines.join('\n')}` }] };
  }
);

// ── Resources ───────────────────────────────────────────────────────────

// Language spec as a resource
server.resource(
  'kern-spec',
  'kern://spec',
  { description: 'KERN language specification — grammar, node types, style shorthands', mimeType: 'text/plain' },
  async (uri) => {
    const nodeList = (NODE_TYPES as readonly string[]).join(', ');
    const shorthandList = Object.entries(STYLE_SHORTHANDS).map(([k, v]) => `  ${k} → ${v}`).join('\n');

    const spec = [
      `KERN v${KERN_VERSION} Language Specification`,
      '',
      '── Grammar ──',
      KERN_GRAMMAR,
      '',
      `── Node Types (${NODE_TYPES.length}) ──`,
      nodeList,
      '',
      '── Style Shorthands ──',
      shorthandList,
      '',
      `── Compile Targets (${VALID_TARGETS.length}) ──`,
      VALID_TARGETS.join(', '),
    ].join('\n');

    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: spec }] };
  }
);

// Available targets as a resource
server.resource(
  'kern-targets',
  'kern://targets',
  { description: 'Available KERN compile targets', mimeType: 'application/json' },
  async (uri) => {
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(VALID_TARGETS) }] };
  }
);

// ── Prompts ─────────────────────────────────────────────────────────────

server.prompt(
  'write-kern',
  'System prompt for writing .kern code — includes the full language spec',
  async () => {
    const nodeList = (NODE_TYPES as readonly string[]).join(', ');
    return {
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            'You are writing KERN (.kern) code — a declarative, indent-based DSL designed for LLMs.',
            '',
            'Grammar:',
            KERN_GRAMMAR,
            '',
            `Available node types: ${nodeList}`,
            '',
            `Available targets: ${VALID_TARGETS.join(', ')}`,
            '',
            'Rules:',
            '- Indent with 2 spaces (no tabs)',
            '- Properties use key=value syntax',
            '- Strings use double quotes',
            '- Handler code blocks use <<< >>> delimiters',
            '- Style blocks use { property: value } inline syntax',
            '',
            'Example:',
            '```kern',
            'screen name=Dashboard',
            '  header',
            '    text value="Dashboard" {fs: 24, fw: bold}',
            '  row {gap: 16}',
            '    card',
            '      text value="Users" {fs: 14, c: gray}',
            '      text value="1,234" {fs: 32, fw: bold}',
            '```',
          ].join('\n'),
        },
      }],
    };
  }
);

// ── Helpers ─────────────────────────────────────────────────────────────

function countNodes(node: IRNode): number {
  let count = 1;
  for (const child of node.children || []) {
    count += countNodes(child);
  }
  return count;
}

// ── Start ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('server:start', { name: 'kern', version: '3.0.0', kernVersion: KERN_VERSION });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main().catch((error) => {
  err('server:fatal', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
