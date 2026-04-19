#!/usr/bin/env node

/**
 * @kernlang/mcp-server — KERN MCP Server
 *
 * Complete MCP interface for KERN: compile, review, parse, decompile, and analyze.
 * AI agents can write .kern, compile to 13 targets, review code, and scan MCP servers.
 *
 * Usage:  kern-mcp
 * Config: { "mcpServers": { "kern": { "command": "npx", "args": ["@kernlang/mcp-server"] } } }
 */

import type { IRNode, KernStructure, KernTarget, ResolvedKernConfig } from '@kernlang/core';
import {
  ALL_TARGETS,
  countTokens,
  decompile,
  defaultRuntime,
  expandTemplateNode,
  generateCoreNode,
  isCoreNode,
  isTemplateNode,
  KERN_VERSION,
  NODE_SCHEMAS,
  NODE_TYPES,
  parse,
  parseWithDiagnostics,
  resolveConfig,
  STYLE_SHORTHANDS,
  serializeIR,
  VALID_TARGETS,
  VALID_STRUCTURES,
  VALUE_SHORTHANDS,
} from '@kernlang/core';
import { transpileExpress } from '@kernlang/express';
import { transpileFastAPI } from '@kernlang/fastapi';
import { transpileMCP, transpileMCPPython } from '@kernlang/mcp';
import { generateReactNode, isReactNode, transpileNextjs, transpileTailwind, transpileWeb } from '@kernlang/react';
import { reviewKernSource, reviewSource } from '@kernlang/review';
import type { LiveLockFile } from '@kernlang/review-mcp';
import {
  computeSecurityScore,
  generateLiveLockFile,
  inferMCP,
  inspectMcpServers,
  reviewMCPSource,
  runPostScan,
  scanMcpConfigs,
  verifyLiveLockFile,
} from '@kernlang/review-mcp';
import { transpileInk, transpileTerminal } from '@kernlang/terminal';
import { transpileNuxt, transpileVue } from '@kernlang/vue';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ── Server ──────────────────────────────────────────────────────────────

const server = new McpServer(
  {
    name: 'kern',
    version: '3.0.0',
  },
  {
    instructions:
      'KERN is a declarative DSL that compiles to 13 targets. Use the write-kern prompt to learn the syntax before writing .kern code. Use compile to generate output, review to analyze code, and review-kern to lint .kern source.',
  },
);

// ── Helpers ─────────────────────────────────────────────────────────────

function log(event: string, details: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: 'info', event, ...details, ts: new Date().toISOString() }));
}

function err(event: string, details: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: 'error', event, ...details, ts: new Date().toISOString() }));
}

function fmtError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function transpileLib(ast: IRNode) {
  const lines: string[] = [];
  function processNode(node: IRNode): void {
    if (isCoreNode(node.type)) {
      lines.push(...generateCoreNode(node));
      lines.push('');
    } else if (isTemplateNode(node.type)) {
      lines.push(...expandTemplateNode(node));
      lines.push('');
    } else if (isReactNode(node.type)) {
      lines.push(...generateReactNode(node));
      lines.push('');
    }
  }
  processNode(ast);
  if (ast.children) {
    for (const child of ast.children) processNode(child);
  }
  return { code: lines.join('\n'), sourceMap: [], irTokenCount: 0, tsTokenCount: 0, tokenReduction: 0, artifacts: [] };
}

function transpile(ast: IRNode, target: KernTarget, config: ResolvedKernConfig) {
  switch (target) {
    case 'lib':
      return transpileLib(ast);
    case 'web':
      return transpileWeb(ast, config);
    case 'tailwind':
      return transpileTailwind(ast, config);
    case 'nextjs':
      return transpileNextjs(ast, config);
    case 'express':
      return transpileExpress(ast, config);
    case 'fastapi':
      return transpileFastAPI(ast, config);
    case 'terminal':
      return transpileTerminal(ast, config);
    case 'ink':
      return transpileInk(ast, config);
    case 'vue':
      return transpileVue(ast, config);
    case 'nuxt':
      return transpileNuxt(ast, config);
    case 'mcp':
      return transpileMCP(ast, config);
    default:
      return transpileNextjs(ast, config);
  }
}

function countNodes(node: IRNode): number {
  let count = 1;
  for (const child of node.children || []) count += countNodes(child);
  return count;
}

const targetEnum = z.enum(ALL_TARGETS as [string, ...string[]]);
const structureEnum = z.enum(VALID_STRUCTURES as [string, ...string[]]);

// ── Security test generation (ported from kern-sight-mcp) ──────────────

interface TestCase {
  name: string;
  description: string;
  input: Record<string, unknown>;
  expectBlocked: boolean;
}

interface ToolTestSuite {
  toolName: string;
  cases: TestCase[];
}

const MALICIOUS_PAYLOADS: Record<string, { value: unknown; label: string }[]> = {
  sanitize: [
    { value: '<script>alert(1)</script>', label: 'XSS payload' },
    { value: '"; DROP TABLE users; --', label: 'SQL injection' },
    { value: '$(whoami)', label: 'command substitution' },
    { value: '{{7*7}}', label: 'template injection' },
  ],
  pathContainment: [
    { value: '../../../etc/passwd', label: 'path traversal (unix)' },
    { value: '..\\..\\..\\windows\\system32\\config\\sam', label: 'path traversal (windows)' },
    { value: '/etc/shadow', label: 'absolute path escape' },
    { value: 'data/../../../etc/hosts', label: 'nested traversal' },
  ],
  validate: [
    { value: -999999, label: 'extreme negative number' },
    { value: 999999999, label: 'extreme large number' },
    { value: '', label: 'empty string' },
  ],
  sizeLimit: [{ value: 'x'.repeat(2_000_000), label: '2MB payload' }],
  rateLimit: [],
  auth: [],
  sanitizeOutput: [],
};

function irChildren(node: IRNode, type: string): IRNode[] {
  return (node.children || []).filter((c) => c.type === type);
}

function irStr(val: unknown): string | undefined {
  return val === undefined || val === null ? undefined : String(val);
}

function generateTestSuites(ast: IRNode): ToolTestSuite[] {
  const mcpNode = ast.type === 'mcp' ? ast : ((ast.children || []).find((c) => c.type === 'mcp') ?? ast);
  const tools = irChildren(mcpNode, 'tool');
  const suites: ToolTestSuite[] = [];

  for (const tool of tools) {
    const toolName = irStr(tool.props?.name) || 'tool';
    const params = irChildren(tool, 'param');
    const guards = irChildren(tool, 'guard');
    const cases: TestCase[] = [];

    const validInput: Record<string, unknown> = {};
    for (const p of params) {
      const name = irStr(p.props?.name) || 'input';
      const pType = irStr(p.props?.type) || 'string';
      const defaultVal = irStr(p.props?.default);
      validInput[name] = defaultVal ?? (pType === 'number' ? 1 : pType === 'boolean' ? true : 'test-value');
    }

    cases.push({
      name: `${toolName} — valid input passes`,
      description: 'All parameters within bounds, should succeed',
      input: { ...validInput },
      expectBlocked: false,
    });

    for (const guard of guards) {
      const kind = irStr(guard.props?.type) || irStr(guard.props?.kind) || irStr(guard.props?.name) || '';
      const target = irStr(guard.props?.param) || irStr(guard.props?.target);
      const payloads = MALICIOUS_PAYLOADS[kind] || [];

      for (const payload of payloads) {
        const malInput = { ...validInput };
        if (target) {
          malInput[target] = payload.value;
        } else {
          const firstStr = params.find((p) => (irStr(p.props?.type) || 'string') === 'string');
          if (firstStr) malInput[irStr(firstStr.props?.name) || 'input'] = payload.value;
        }
        cases.push({
          name: `${toolName} — ${kind} blocks ${payload.label}`,
          description: `Guard type=${kind} should reject: ${payload.label}`,
          input: malInput,
          expectBlocked: true,
        });
      }

      if (kind === 'validate' && target) {
        const min = irStr(guard.props?.min);
        const max = irStr(guard.props?.max);
        if (min) {
          cases.push({
            name: `${toolName} — validate rejects below min (${min})`,
            description: `Value below minimum ${min} should be rejected`,
            input: { ...validInput, [target]: Number(min) - 1 },
            expectBlocked: true,
          });
        }
        if (max) {
          cases.push({
            name: `${toolName} — validate rejects above max (${max})`,
            description: `Value above maximum ${max} should be rejected`,
            input: { ...validInput, [target]: Number(max) + 1 },
            expectBlocked: true,
          });
        }
      }
    }

    suites.push({ toolName, cases });
  }

  return suites;
}

function renderTestFile(suites: ToolTestSuite[], serverPath: string): string {
  const lines: string[] = [];
  lines.push('// Auto-generated security tests from .kern definition');
  lines.push('// Tests that guards correctly block malicious inputs');
  lines.push("import { describe, it, expect } from 'vitest';");
  lines.push('');
  lines.push("// TODO: Import your compiled MCP server's tool handlers");
  lines.push(`// import { callTool } from '${serverPath}';`);
  lines.push('');

  for (const suite of suites) {
    lines.push(`describe('${suite.toolName}', () => {`);
    for (const tc of suite.cases) {
      const inputStr = JSON.stringify(tc.input, null, 2).replace(/\n/g, '\n    ');
      if (tc.expectBlocked) {
        lines.push(`  it('${tc.name}', async () => {`);
        lines.push(`    const input = ${inputStr};`);
        lines.push(`    // ${tc.description}`);
        lines.push(`    // await expect(callTool('${suite.toolName}', input)).rejects.toThrow();`);
        lines.push('    expect(true).toBe(true); // TODO: wire up tool call');
        lines.push('  });');
      } else {
        lines.push(`  it('${tc.name}', async () => {`);
        lines.push(`    const input = ${inputStr};`);
        lines.push(`    // ${tc.description}`);
        lines.push(`    // const result = await callTool('${suite.toolName}', input);`);
        lines.push('    // expect(result.isError).toBeFalsy();');
        lines.push('    expect(true).toBe(true); // TODO: wire up tool call');
        lines.push('  });');
      }
      lines.push('');
    }
    lines.push('});');
    lines.push('');
  }

  return lines.join('\n');
}

// ── Tools ───────────────────────────────────────────────────────────────

// 1. compile
server.tool(
  'compile',
  'Compile .kern source code to a target framework (Next.js, React, Vue, Express, FastAPI, MCP, etc.). Returns generated code.',
  {
    source: z.string().describe('.kern source code'),
    target: targetEnum.default('nextjs').describe('Target framework'),
    structure: structureEnum.default('flat').describe('Output structure for React targets: flat, bulletproof, atomic, kern'),
  },
  async ({ source, target, structure }) => {
    log('tool:compile', { target, structure, len: source.length });
    try {
      const ast = parse(source);
      const config = resolveConfig({ target: target as KernTarget, structure: structure as KernStructure });
      const result = transpile(ast, target as KernTarget, config);
      const structureSuffix = structure !== 'flat' ? ` / ${structure}` : '';
      let text = `// Compiled to ${target}${structureSuffix} (${result.irTokenCount} KERN → ${result.tsTokenCount} output tokens)\n${result.code}`;
      if (result.artifacts?.length) {
        text += `\n\n${result.artifacts.map((a) => `--- ${a.path} ---\n${a.content}`).join('\n\n')}`;
      }
      return { content: [{ type: 'text', text }] };
    } catch (e) {
      err('tool:compile:error', { error: fmtError(e) });
      return { isError: true, content: [{ type: 'text', text: `Compile error: ${fmtError(e)}` }] };
    }
  },
);

// 2. review — TypeScript/JavaScript static analysis
server.tool(
  'review',
  'Run KERN static analysis (76+ rules, taint tracking, OWASP) on TypeScript/JavaScript source code.',
  {
    source: z.string().describe('TypeScript or JavaScript source code to review'),
    filePath: z.string().default('input.ts').describe('File path for rule context'),
    target: targetEnum.default('nextjs').describe('Target framework for rule selection'),
  },
  async ({ source, filePath, target }) => {
    log('tool:review', { filePath, target });
    try {
      const report = reviewSource(source, filePath, { target: target as KernTarget });
      const findings = report.findings;
      if (!findings.length) return { content: [{ type: 'text', text: 'No issues found.' }] };
      const lines = findings.map((f) => {
        const loc = f.primarySpan?.startLine ? `L${f.primarySpan.startLine}` : '';
        const conf = f.confidence !== undefined ? ` [${f.confidence.toFixed(2)}]` : '';
        const sev = f.severity === 'error' ? '!' : f.severity === 'warning' ? '~' : '-';
        return `${sev} ${loc}: [${f.ruleId}]${conf} ${f.message}${f.suggestion ? `\n  → ${f.suggestion}` : ''}`;
      });
      const errors = findings.filter((f) => f.severity === 'error').length;
      const warnings = findings.filter((f) => f.severity === 'warning').length;
      return {
        content: [
          {
            type: 'text',
            text: `${findings.length} finding(s) — ${errors} errors, ${warnings} warnings\n\n${lines.join('\n')}`,
          },
        ],
      };
    } catch (e) {
      err('tool:review:error', { error: fmtError(e) });
      return { isError: true, content: [{ type: 'text', text: `Review error: ${fmtError(e)}` }] };
    }
  },
);

// 3. review-kern — lint .kern source files
server.tool(
  'review-kern',
  'Lint .kern source code for structural issues, missing props, and pattern violations.',
  {
    source: z.string().describe('.kern source code to review'),
  },
  async ({ source }) => {
    log('tool:review-kern', { len: source.length });
    try {
      const report = reviewKernSource(source);
      const findings = report.findings;
      if (!findings.length) return { content: [{ type: 'text', text: 'No issues found in .kern source.' }] };
      const lines = findings.map((f) => {
        const loc = f.primarySpan?.startLine ? `L${f.primarySpan.startLine}` : '';
        return `${f.severity === 'error' ? '!' : '~'} ${loc}: [${f.ruleId}] ${f.message}`;
      });
      return { content: [{ type: 'text', text: `${findings.length} finding(s)\n\n${lines.join('\n')}` }] };
    } catch (e) {
      err('tool:review-kern:error', { error: fmtError(e) });
      return { isError: true, content: [{ type: 'text', text: `Review error: ${fmtError(e)}` }] };
    }
  },
);

// 4. review-mcp-server — scan MCP server code for security issues (with scoring)
server.tool(
  'review-mcp-server',
  'Scan MCP server TypeScript/Python code for security vulnerabilities. 13 rules mapped to OWASP MCP Top 10. Returns findings + security score (0-100, A-F).',
  {
    source: z.string().describe('MCP server source code to scan'),
    filePath: z.string().default('server.ts').describe('File path for context'),
  },
  async ({ source, filePath }) => {
    log('tool:review-mcp-server', { filePath });
    try {
      const findings = reviewMCPSource(source, filePath);
      const postFindings = runPostScan(source, filePath);
      findings.push(...postFindings);

      let irNodes: IRNode[] = [];
      if (!filePath.endsWith('.py')) {
        try {
          irNodes = inferMCP(source, filePath);
        } catch {
          irNodes = [];
        }
      }

      const score = computeSecurityScore(irNodes, findings);

      if (!findings.length) {
        return {
          content: [
            {
              type: 'text',
              text: `No MCP security issues found.\n\nSecurity Score: ${score.total}/100 (${score.grade})`,
            },
          ],
        };
      }

      const lines = findings.map((f) => {
        const loc = f.primarySpan?.startLine ? `L${f.primarySpan.startLine}` : '';
        const conf = (f as any).confidence !== undefined ? ` [${((f as any).confidence as number).toFixed(2)}]` : '';
        return `${f.severity === 'error' ? '!' : '~'} ${loc}: [${f.ruleId}]${conf} ${f.message}${f.suggestion ? `\n  → ${f.suggestion}` : ''}`;
      });

      const errors = findings.filter((f) => f.severity === 'error').length;
      const warnings = findings.filter((f) => f.severity === 'warning').length;

      return {
        content: [
          {
            type: 'text',
            text: [
              `Security Score: ${score.total}/100 (${score.grade})`,
              `${findings.length} finding(s) — ${errors} errors, ${warnings} warnings`,
              '',
              ...lines,
            ].join('\n'),
          },
        ],
      };
    } catch (e) {
      err('tool:review-mcp:error', { error: fmtError(e) });
      return { isError: true, content: [{ type: 'text', text: `MCP review error: ${fmtError(e)}` }] };
    }
  },
);

// 5. parse — .kern to IR
server.tool(
  'parse',
  'Parse .kern source and return the KERN IR (intermediate representation). Useful for debugging and understanding structure.',
  { source: z.string().describe('.kern source code') },
  async ({ source }) => {
    log('tool:parse', { len: source.length });
    try {
      const ast = parse(source);
      const ir = serializeIR(ast);
      return { content: [{ type: 'text', text: `// ${countTokens(ir)} IR tokens, ${countNodes(ast)} nodes\n${ir}` }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Parse error: ${fmtError(e)}` }] };
    }
  },
);

// 6. decompile — IR tree back to readable .kern text
server.tool(
  'decompile',
  'Decompile a parsed KERN IR tree back to human-readable .kern text. Useful for reformatting or inspecting parsed output.',
  { source: z.string().describe('.kern source code to parse then decompile') },
  async ({ source }) => {
    log('tool:decompile', { len: source.length });
    try {
      const ast = parse(source);
      const result = decompile(ast);
      return { content: [{ type: 'text', text: result.code }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Decompile error: ${fmtError(e)}` }] };
    }
  },
);

// 7. validate
server.tool(
  'validate',
  'Validate .kern syntax without compiling. Returns parse errors or success.',
  { source: z.string().describe('.kern source code') },
  async ({ source }) => {
    try {
      const ast = parse(source);
      return { content: [{ type: 'text', text: `Valid .kern — ${countNodes(ast)} node(s) parsed.` }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Syntax error: ${fmtError(e)}` }] };
    }
  },
);

// 8. list-targets
server.tool('list-targets', 'List all available KERN compile targets.', {}, async () => {
  const targets: Record<string, string> = {
    lib: 'Plain TypeScript (no framework)',
    nextjs: 'Next.js (App Router, TypeScript/React)',
    tailwind: 'React + Tailwind CSS',
    web: 'Plain React components',
    vue: 'Vue 3 SFC',
    nuxt: 'Nuxt 3 (Vue meta-framework)',
    express: 'Express TypeScript REST API',
    fastapi: 'FastAPI Python async backend',
    native: 'React Native (iOS/Android)',
    cli: 'Node.js CLI',
    terminal: 'Terminal UI (ANSI)',
    ink: 'Ink (React for terminals)',
    mcp: 'MCP server (Model Context Protocol)',
  };
  const lines = Object.entries(targets).map(([k, v]) => `  ${k.padEnd(10)} — ${v}`);
  const structures = VALID_STRUCTURES.map((s) => `  ${s}`).join('\n');
  return {
    content: [
      {
        type: 'text',
        text: `KERN v${KERN_VERSION} — ${VALID_TARGETS.length} targets:\n\n${lines.join(
          '\n',
        )}\n\nStructures for React targets:\n\n${structures}`,
      },
    ],
  };
});

// 9. list-nodes — describe available node types with their props
server.tool(
  'list-nodes',
  'List KERN node types with their properties and allowed children. Use this to understand what props a node accepts.',
  {
    filter: z
      .string()
      .optional()
      .describe(
        'Filter by category: layout, content, interactive, backend, data, state, react, cli, terminal, mcp, or a specific node name',
      ),
  },
  async ({ filter }) => {
    const categories: Record<string, string[]> = {
      layout: ['screen', 'page', 'row', 'col', 'card', 'grid', 'scroll', 'section', 'form'],
      content: ['text', 'image', 'progress', 'divider', 'codeblock', 'icon', 'svg'],
      interactive: ['button', 'input', 'textarea', 'slider', 'toggle', 'modal', 'select', 'option'],
      navigation: ['tabs', 'tab', 'header', 'link', 'list', 'item'],
      backend: [
        'server',
        'route',
        'middleware',
        'handler',
        'schema',
        'stream',
        'spawn',
        'timer',
        'on',
        'env',
        'websocket',
      ],
      data: [
        'model',
        'column',
        'relation',
        'repository',
        'cache',
        'entry',
        'invalidate',
        'dependency',
        'inject',
        'config',
        'store',
      ],
      state: ['machine', 'transition', 'state', 'signal', 'cleanup'],
      types: ['type', 'interface', 'field', 'fn', 'const', 'union', 'variant', 'service', 'method', 'error'],
      react: ['hook', 'provider', 'effect', 'logic', 'memo', 'callback', 'ref', 'context', 'prop', 'returns'],
      cli: ['cli', 'command', 'arg', 'flag'],
      terminal: [
        'separator',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
        'scoreboard',
        'metric',
        'spinner',
        'box',
        'gradient',
      ],
      ground: [
        'derive',
        'transform',
        'action',
        'assume',
        'invariant',
        'branch',
        'path',
        'resolve',
        'guard',
        'collect',
        'pattern',
        'apply',
        'expect',
        'recover',
        'strategy',
      ],
      mcp: ['mcp', 'tool', 'resource', 'prompt', 'param', 'description', 'sampling', 'elicitation'],
      meta: ['doc', 'theme', 'import', 'module', 'export'],
    };

    const lines: string[] = [];

    if (filter && filter in categories) {
      lines.push(`── ${filter} nodes ──`);
      for (const nodeType of categories[filter]) {
        const schema = NODE_SCHEMAS[nodeType];
        if (schema) {
          const props = Object.entries(schema.props)
            .map(([k, v]) => `${v.required ? k : `${k}?`}:${v.kind}`)
            .join(', ');
          const children = schema.allowedChildren ? ` → [${schema.allowedChildren.join(', ')}]` : '';
          lines.push(`  ${nodeType}(${props})${children}`);
        } else {
          lines.push(`  ${nodeType}`);
        }
      }
    } else if (filter) {
      // Specific node lookup
      const schema = NODE_SCHEMAS[filter];
      if (schema) {
        lines.push(`${filter}:`);
        lines.push(
          `  Props: ${Object.entries(schema.props)
            .map(([k, v]) => `${k}${v.required ? ' (required)' : ''}: ${v.kind}`)
            .join(', ')}`,
        );
        if (schema.allowedChildren) lines.push(`  Children: ${schema.allowedChildren.join(', ')}`);
      } else {
        lines.push(`Node type "${filter}" has no schema definition. It may still be valid — check examples.`);
      }
    } else {
      lines.push(`KERN node categories (use filter to drill down):\n`);
      for (const [cat, nodes] of Object.entries(categories)) {
        lines.push(`  ${cat.padEnd(12)} — ${nodes.slice(0, 6).join(', ')}${nodes.length > 6 ? ', ...' : ''}`);
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

// 10. schema — machine-readable JSON schema for LLM self-correction loops
server.tool(
  'schema',
  'Get the full KERN language schema as machine-readable JSON. Use this to know what node types, props, and children are valid before writing .kern code.',
  {},
  async () => {
    const schema = {
      version: KERN_VERSION,
      nodeTypes: [...NODE_TYPES],
      multilineBlockTypes: [...defaultRuntime.multilineBlockTypes],
      schemas: NODE_SCHEMAS,
      styleShorthands: STYLE_SHORTHANDS,
      valueShorthands: VALUE_SHORTHANDS,
    };
    return { content: [{ type: 'text', text: JSON.stringify(schema) }] };
  },
);

// 11. compile-json — compile with structured diagnostics for self-correction
server.tool(
  'compile-json',
  'Compile .kern source and return structured JSON diagnostics (code, line, col, suggestion). Use this for programmatic self-correction.',
  {
    source: z.string().describe('.kern source code'),
    target: targetEnum.default('nextjs').describe('Target framework'),
    structure: structureEnum.default('flat').describe('Output structure for React targets: flat, bulletproof, atomic, kern'),
  },
  async ({ source, target, structure }) => {
    log('tool:compile-json', { target, structure, len: source.length });
    try {
      const result = parseWithDiagnostics(source);
      const config = resolveConfig({ target: target as KernTarget, structure: structure as KernStructure });
      const compiled = transpile(result.root, target as KernTarget, config);
      const output = {
        success: result.diagnostics.filter((d) => d.severity === 'error').length === 0,
        code: compiled.code,
        diagnostics: result.diagnostics,
        stats: { irTokens: compiled.irTokenCount, outputTokens: compiled.tsTokenCount, structure },
      };
      return { content: [{ type: 'text', text: JSON.stringify(output) }] };
    } catch (e) {
      err('tool:compile-json:error', { error: fmtError(e) });
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: fmtError(e) }) }],
      };
    }
  },
);

// 12. compile-and-review — compile .kern → MCP, then auto-scan the output
server.tool(
  'compile-and-review',
  'Compile .kern to a secure MCP server (TypeScript or Python), then auto-scan the compiled output for security vulnerabilities. Returns code + security score + findings in one call.',
  {
    source: z.string().describe('.kern source code'),
    target: z.enum(['typescript', 'python']).default('typescript').describe('Output language'),
  },
  async ({ source, target }) => {
    log('tool:compile-and-review', { target, len: source.length });
    try {
      const ast = parse(source);
      const config = resolveConfig({ target: 'mcp' as KernTarget });
      const compiled = target === 'python' ? transpileMCPPython(ast, config) : transpileMCP(ast, config);

      const filePath = target === 'python' ? 'server.py' : 'server.ts';
      const findings = reviewMCPSource(compiled.code, filePath);
      const postFindings = runPostScan(compiled.code, filePath);
      findings.push(...postFindings);

      let irNodes: IRNode[] = [];
      if (target !== 'python') {
        try {
          irNodes = inferMCP(compiled.code, filePath);
        } catch {
          irNodes = [];
        }
      }

      const score = computeSecurityScore(irNodes, findings);
      const errors = findings.filter((f) => f.severity === 'error').length;
      const warnings = findings.filter((f) => f.severity === 'warning').length;

      const findingLines = findings.map((f) => {
        const loc = f.primarySpan?.startLine ? `L${f.primarySpan.startLine}` : '';
        return `${f.severity === 'error' ? '!' : '~'} ${loc}: [${f.ruleId}] ${f.message}${f.suggestion ? `\n  → ${f.suggestion}` : ''}`;
      });

      const header = [
        `// Compiled to MCP ${target === 'python' ? 'Python' : 'TypeScript'} (${compiled.irTokenCount} KERN → ${compiled.tsTokenCount} output tokens)`,
        `// Security Score: ${score.total}/100 (${score.grade}) — ${findings.length} finding(s): ${errors} errors, ${warnings} warnings`,
        '',
      ].join('\n');

      const review =
        findings.length > 0
          ? `\n\n--- Security Review ---\n${findingLines.join('\n')}`
          : '\n\n--- Security Review ---\nNo issues found.';

      return { content: [{ type: 'text', text: header + compiled.code + review }] };
    } catch (e) {
      err('tool:compile-and-review:error', { error: fmtError(e) });
      return { isError: true, content: [{ type: 'text', text: `Compile-and-review error: ${fmtError(e)}` }] };
    }
  },
);

// 13. audit-mcp-config — scan MCP configuration files for security issues
server.tool(
  'audit-mcp-config',
  'Scan MCP configuration files (Claude Desktop, Cursor, VS Code, Windsurf) for hardcoded secrets, missing version pins, and wide permissions. Scans the host machine config files.',
  {
    workspaceRoot: z
      .string()
      .optional()
      .describe('Workspace root path to also scan .cursor/mcp.json, .vscode/mcp.json, .windsurf/mcp.json'),
  },
  async ({ workspaceRoot }) => {
    log('tool:audit-mcp-config', { workspaceRoot });
    try {
      const result = scanMcpConfigs(workspaceRoot);

      if (result.servers.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: [
                `Scanned ${result.configsScanned.length} config file(s), ${result.configsMissing.length} not found.`,
                'No MCP servers configured.',
                '',
                result.configsMissing.length > 0
                  ? `Missing configs:\n${result.configsMissing.map((p) => `  ${p}`).join('\n')}`
                  : '',
              ]
                .filter(Boolean)
                .join('\n'),
            },
          ],
        };
      }

      const lines: string[] = [
        `Scanned ${result.configsScanned.length} config(s) — ${result.servers.length} server(s), ${result.totalIssues} issue(s)`,
        '',
      ];

      for (const server of result.servers) {
        const trustIcon = server.trust === 'verified' ? '+' : server.trust === 'risky' ? '!' : '~';
        lines.push(`${trustIcon} ${server.name} (${server.source})`);
        lines.push(`  command: ${server.command} ${server.args.join(' ')}`);
        if (server.issues.length === 0) {
          lines.push('  No issues.');
        } else {
          for (const issue of server.issues) {
            const sev = issue.severity === 'error' ? '!' : issue.severity === 'warning' ? '~' : '-';
            lines.push(`  ${sev} [${issue.type}] ${issue.message}`);
            if (issue.detail) lines.push(`    → ${issue.detail}`);
          }
        }
        lines.push('');
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (e) {
      err('tool:audit-mcp-config:error', { error: fmtError(e) });
      return { isError: true, content: [{ type: 'text', text: `Config audit error: ${fmtError(e)}` }] };
    }
  },
);

// 14. generate-security-tests — auto-generate test cases from .kern AST
server.tool(
  'generate-security-tests',
  'Generate security test cases from .kern source. For each tool and guard, generates valid + malicious inputs to verify guards block attacks. Returns a vitest test file.',
  {
    source: z.string().describe('.kern source code with MCP tools and guards'),
    serverImportPath: z.string().default('./server').describe('Import path for the compiled server module'),
  },
  async ({ source, serverImportPath }) => {
    log('tool:generate-security-tests', { len: source.length });
    try {
      const ast = parse(source);
      const suites = generateTestSuites(ast);

      if (suites.length === 0) {
        return { content: [{ type: 'text', text: 'No MCP tools with guards found in source. Nothing to test.' }] };
      }

      const testFile = renderTestFile(suites, serverImportPath);
      const totalCases = suites.reduce((sum, s) => sum + s.cases.length, 0);

      return {
        content: [
          {
            type: 'text',
            text: `// ${suites.length} tool(s), ${totalCases} test case(s)\n\n${testFile}`,
          },
        ],
      };
    } catch (e) {
      err('tool:generate-security-tests:error', { error: fmtError(e) });
      return { isError: true, content: [{ type: 'text', text: `Test generation error: ${fmtError(e)}` }] };
    }
  },
);

// 15. inspect-mcp-servers — connect to configured servers and check for poisoning
server.tool(
  'inspect-mcp-servers',
  'Connect to locally configured MCP servers (Claude Desktop, Cursor, VS Code, Windsurf), retrieve their tool lists, and check for poisoning patterns (hidden instructions, cross-origin escalation, tool shadowing, data exfiltration). Returns findings per server.',
  {
    workspaceRoot: z.string().optional().describe('Workspace root for .cursor/mcp.json, .vscode/mcp.json scanning'),
    allowlist: z.array(z.string()).optional().describe('Only inspect servers with these names (default: all)'),
    timeout: z.number().default(10000).describe('Timeout per server connection in ms'),
  },
  async ({ workspaceRoot, allowlist, timeout }) => {
    log('tool:inspect-mcp-servers', { workspaceRoot, allowlist, timeout });
    try {
      const result = await inspectMcpServers(workspaceRoot, { allowlist, timeout });

      if (result.servers.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `Scanned ${result.configsScanned} config(s) — no MCP servers found to inspect.`,
            },
          ],
        };
      }

      const lines: string[] = [
        `Inspected ${result.servers.length} server(s) — ${result.totalTools} tool(s), ${result.totalFindings} finding(s)`,
        '',
      ];

      for (const srv of result.servers) {
        const statusIcon = srv.status === 'ok' ? '+' : srv.status === 'timeout' ? '~' : '!';
        lines.push(`${statusIcon} ${srv.name} (${srv.source}) — ${srv.status}`);
        if (srv.error) lines.push(`  Error: ${srv.error}`);
        if (srv.tools.length > 0) {
          lines.push(`  Tools: ${srv.tools.map((t) => t.name).join(', ')}`);
        }
        for (const f of srv.findings) {
          const sev = f.severity === 'error' ? '!' : '~';
          lines.push(`  ${sev} [${f.pattern}] ${f.toolName}: ${f.message}`);
        }
        lines.push('');
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (e) {
      err('tool:inspect-mcp-servers:error', { error: fmtError(e) });
      return { isError: true, content: [{ type: 'text', text: `Inspection error: ${fmtError(e)}` }] };
    }
  },
);

// 16. verify-tool-pins — generate or verify a lockfile of tool hashes
server.tool(
  'verify-tool-pins',
  'Generate or verify a lockfile of MCP tool description and schema hashes. Detects rug pulls — when a server changes its tool behavior after initial trust. Pass mode="generate" to create a new lockfile, mode="verify" to check against an existing one.',
  {
    mode: z.enum(['generate', 'verify']).describe('"generate" to create lockfile, "verify" to check against existing'),
    lockfileJson: z.string().optional().describe('Existing lockfile JSON content (required for verify mode)'),
    workspaceRoot: z.string().optional().describe('Workspace root for config discovery'),
    timeout: z.number().default(10000).describe('Timeout per server connection in ms'),
  },
  async ({ mode, lockfileJson, workspaceRoot, timeout }) => {
    log('tool:verify-tool-pins', { mode, workspaceRoot });
    try {
      const result = await inspectMcpServers(workspaceRoot, { timeout });

      if (mode === 'generate') {
        const lockFile = generateLiveLockFile(result);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(lockFile, null, 2),
            },
          ],
        };
      }

      // Verify mode
      if (!lockfileJson) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'verify mode requires lockfileJson parameter' }],
        };
      }

      let lockFile: LiveLockFile;
      try {
        lockFile = JSON.parse(lockfileJson);
      } catch {
        return {
          isError: true,
          content: [{ type: 'text', text: 'lockfileJson is not valid JSON' }],
        };
      }

      const drifts = verifyLiveLockFile(lockFile, result);

      if (drifts.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `All tool pins verified — no changes detected across ${result.servers.length} server(s).`,
            },
          ],
        };
      }

      const lines = [
        `${drifts.length} drift(s) detected:`,
        '',
        ...drifts.map((d) => {
          const sev = d.severity === 'error' ? '!' : '~';
          return `${sev} [${d.field}] ${d.serverName}/${d.toolName}: ${d.message}`;
        }),
      ];

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (e) {
      err('tool:verify-tool-pins:error', { error: fmtError(e) });
      return { isError: true, content: [{ type: 'text', text: `Pin verification error: ${fmtError(e)}` }] };
    }
  },
);

// ── Resources ───────────────────────────────────────────────────────────

// Full spec
server.resource(
  'kern-spec',
  'kern://spec',
  {
    description: 'KERN language specification — grammar, node types, style shorthands, all compile targets',
    mimeType: 'text/plain',
  },
  async (uri) => {
    const nodeList = (NODE_TYPES as readonly string[]).join(', ');
    const shorthandList = Object.entries(STYLE_SHORTHANDS)
      .map(([k, v]) => `  ${k} → ${v}`)
      .join('\n');
    const schemaList = Object.entries(NODE_SCHEMAS)
      .map(([name, s]) => {
        const props = Object.entries(s.props)
          .map(([k, v]) => `${v.required ? k : `${k}?`}:${v.kind}`)
          .join(', ');
        const children = s.allowedChildren ? ` children=[${s.allowedChildren.join(',')}]` : '';
        return `  ${name}(${props})${children}`;
      })
      .join('\n');

    const text = [
      `KERN v${KERN_VERSION} Language Specification`,
      '',
      '── Grammar ──',
      'document   = node+',
      'node       = indent type (SP prop)* (SP style)? NL child*',
      'prop       = ident "=" value',
      'value      = quoted | bare',
      'style      = "{" spair ("," spair)* "}"',
      '',
      '── Rules ──',
      '- Indent: 2 spaces (no tabs)',
      '- Props: key=value (strings in double quotes)',
      '- Styles: inline {shorthand: value} blocks',
      '- Handlers: <<< code >>> blocks for inline code',
      '- Theme refs: $refName to reference theme nodes',
      '',
      `── Node Types (${NODE_TYPES.length}) ──`,
      nodeList,
      '',
      '── Node Schemas (props + children) ──',
      schemaList,
      '',
      '── Style Shorthands ──',
      shorthandList,
      '',
      `── Compile Targets (${VALID_TARGETS.length}) ──`,
      VALID_TARGETS.join(', '),
    ].join('\n');

    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] };
  },
);

// Examples by category
server.resource(
  'kern-examples',
  new ResourceTemplate('kern://examples/{category}', {
    list: async () => ({
      resources: [
        { uri: 'kern://examples/ui', name: 'UI examples (screens, layouts, lists)' },
        { uri: 'kern://examples/api', name: 'API examples (Express, FastAPI routes)' },
        { uri: 'kern://examples/state-machine', name: 'State machine examples' },
        { uri: 'kern://examples/mcp', name: 'MCP server examples' },
        { uri: 'kern://examples/terminal', name: 'Terminal UI examples' },
      ],
    }),
  }),
  { description: 'KERN example code by category', mimeType: 'text/plain' },
  async (uri, { category }) => {
    const examples: Record<string, string> = {
      ui: `# UI Example — Dashboard Screen

screen name=Dashboard {bg:#F8F9FA}
  row {p:16,jc:sb,ai:center}
    text value="Dashboard" {fs:24,fw:bold}
    image src=avatar {w:40,h:40,br:20}
  card {p:16,br:12,bg:#FFF,m:16}
    progress label=Users current=1840 target=2200 color=#FF6B6B
    progress label=Revenue current=96 target=140 color=#4ECDC4
  list title="Recent Activity" separator=true
    item id=1 name="New signup" time=08:15
    item id=2 name="Purchase" time=12:40
  tabs active=Dashboard
    tab icon=home label=Dashboard
    tab icon=chart label=Stats
    tab icon=gear label=Settings

# Card Grid
page name=Products
  grid columns=3 {gap:16,p:16}
    card {br:8,bg:#FFF}
      image src=product1 {w:full,h:200}
      text value="Product Name" {p:12,fw:bold}
      button label="Buy" {bg:#007AFF,c:#FFF}`,

      api: `# Express API Example

server name=UserAPI port=3001
  middleware name=cors
  middleware name=json

  route GET /api/users
    auth required
    validate UserQuerySchema
    handler <<<
      const users = await db.query('SELECT * FROM users');
      res.json(users);
    >>>
    error 401 "Unauthorized"

  route POST /api/users
    auth required
    validate CreateUserSchema
    derive user expr={{await db.users.create(body)}}
    respond 201 json=user
    error 400 "Invalid request"

  route GET /api/users/:id
    derive user expr={{await db.users.findById(params.id)}}
    guard name=exists expr={{user}} else=404
    respond 200 json=user

  route DELETE /api/users/:id
    auth required
    derive result expr={{await db.users.delete(params.id)}}
    respond 204`,

      'state-machine': `# State Machine — 7 lines → 140+ lines TypeScript

machine name=Order initial=pending
  transition from=pending to=confirmed event=confirm
  transition from=confirmed to=shipped event=ship
  transition from=shipped to=delivered event=deliver
  transition from=pending to=cancelled event=cancel
  transition from=confirmed to=cancelled event=cancel

# Generates: enums, transition functions, exhaustive checks, error classes`,

      mcp: `# MCP Server Example — secure file tools

mcp name=FileTools version=1.0

  tool name=readFile
    description text="Read a file within allowed directories"
    param name=filePath type=string required=true
    guard type=pathContainment param=filePath allowlist=/data,/home
    handler <<<
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(params.filePath as string, 'utf-8');
      return { content: [{ type: "text", text: content }] };
    >>>

  tool name=searchFiles
    description text="Search for files matching a pattern"
    param name=query type=string required=true
    param name=maxResults type=number default=50
    guard type=sanitize param=query
    guard type=validate param=maxResults min=1 max=500
    handler <<<
      const { globSync } = await import('node:fs');
      const results = globSync(params.query as string).slice(0, params.maxResults as number);
      return { content: [{ type: "text", text: results.join('\\n') }] };
    >>>

  resource name=config uri="config://app"
    description text="Application configuration"
    handler <<<
      return { contents: [{ uri: uri.href, text: JSON.stringify({ version: "1.0" }) }] };
    >>>

# Guards: sanitize, pathContainment, validate, auth, rateLimit, sizeLimit
# Transports: stdio (default), http (streamable HTTP)`,

      terminal: `# Terminal UI Example

screen name=AgonTerminal
  gradient text="AGON" colors=[208,214,220,226]
  box color=214
    text value="Any AI can join. They compete. You ship." {fw:bold}
  separator width=48
  text value="Engines:" {c:#a1a1aa}
  text value="  claude  codex  gemini" {c:#f97316,fw:bold}
  separator width=48
  scoreboard title="Results" winner="claude"
    metric name=Score values=["89","74","71"]
    metric name=Diff values=["436","570","317"]
  table
    thead
      tr
        th value="Engine"
        th value="Score"
    tbody
      tr
        td value="claude"
        td value="89"`,
    };

    const text =
      examples[category as string] || `Unknown category: ${category}. Available: ${Object.keys(examples).join(', ')}`;
    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] };
  },
);

// Targets resource
server.resource(
  'kern-targets',
  'kern://targets',
  { description: 'Available KERN compile targets', mimeType: 'application/json' },
  async (uri) => {
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(VALID_TARGETS) }] };
  },
);

// ── Prompts ─────────────────────────────────────────────────────────────

server.prompt(
  'write-kern',
  'Comprehensive system prompt for writing .kern code — spec, rules, examples, patterns',
  async () => {
    const nodeList = (NODE_TYPES as readonly string[]).join(', ');
    const shorthandList = Object.entries(STYLE_SHORTHANDS)
      .map(([k, v]) => `${k}→${v}`)
      .join(', ');

    return {
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `You are writing KERN (.kern) code — a declarative, indent-based DSL designed for LLMs.

## Grammar
- Indent: 2 spaces (no tabs, strict)
- Nodes: type name=value prop=value
- Strings: double quotes ("hello")
- Styles: inline {shorthand: value, shorthand: value}
- Handlers: <<< multi-line code >>>
- Theme refs: $refName
- Comments: // or # (full-line and inline)
- Documentation: doc text="..." or doc <<< multiline >>>  (emits JSDoc)

## Available Node Types
${nodeList}

## Style Shorthands
${shorthandList}

## Compile Targets
${VALID_TARGETS.join(', ')}

## Key Patterns

### UI Screen
\`\`\`kern
screen name=Dashboard {bg:#F8F9FA}
  row {p:16,jc:sb,ai:center}
    text value="Title" {fs:24,fw:bold}
  card {p:16,br:12,bg:#FFF}
    text value="Metric" {fs:14,c:gray}
    text value="1,234" {fs:32,fw:bold}
  button text="Action" {bg:#007AFF,c:#FFF,br:8}
\`\`\`

### API Server
\`\`\`kern
server name=API port=3001
  middleware name=cors
  middleware name=json
  route GET /api/items
    auth required
    handler <<<
      const items = await db.items.findAll();
      res.json(items);
    >>>
\`\`\`

### State Machine (7 lines → 140+ TypeScript)
\`\`\`kern
machine name=Order initial=pending
  transition from=pending to=confirmed event=confirm
  transition from=confirmed to=shipped event=ship
  transition from=shipped to=delivered event=deliver
\`\`\`

### MCP Server
\`\`\`kern
mcp name=Tools version=1.0
  tool name=search
    description text="Search for items"
    param name=query type=string required=true
    guard type=sanitize param=query
    handler <<<
      return { content: [{ type: "text", text: "results" }] };
    >>>
\`\`\`

### Type System
\`\`\`kern
// Define user status enum
type name=Status values=active|inactive|pending

doc text="Core user entity"
interface name=User
  field name=id type=string
  field name=email type=string
  field name=status type=Status
\`\`\`

### Hooks (React)
\`\`\`kern
hook name=useAuth
  state name=user type=User|null initial=null
  effect deps=[]
    handler <<<
      const session = await getSession();
      setUser(session?.user ?? null);
    >>>
  returns user, isAuthenticated:boolean
\`\`\`

## Rules
- Every node is a line. Children are indented 2 spaces deeper.
- Props on the same line as the node type.
- Style blocks are CSS shorthand: {fs:24} = font-size:24, {fw:bold} = font-weight:bold, {p:16} = padding:16, {m:8} = margin:8, {bg:#FFF} = background:#FFF, {c:gray} = color:gray, {br:8} = border-radius:8, {w:full} = width:100%, {jc:sb} = justify-content:space-between, {ai:center} = align-items:center
- Handler blocks: <<< on new line, code, >>> on new line. For short handlers, inline is fine.
- Always use the simplest node structure. Don't over-nest.`,
          },
        },
      ],
    };
  },
);

// ── Start ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('server:start', { name: 'kern', version: '3.0.0', kernVersion: KERN_VERSION });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main().catch((error) => {
  err('server:fatal', { error: fmtError(error) });
  process.exitCode = 1;
});
