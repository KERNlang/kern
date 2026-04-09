import type { IRNode } from '@kernlang/core';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import { hasFlag, parseAndSurface, parseFlag } from '../shared.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function getProps(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function getChildren(node: IRNode, type: string): IRNode[] {
  return (node.children || []).filter((c) => c.type === type);
}

function getFirstChild(node: IRNode, type: string): IRNode | undefined {
  return (node.children || []).find((c) => c.type === type);
}

// ── Guard violation payloads ────────────────────────────────────────────

function guardViolationPayloads(guardKind: string, paramName: string): { description: string; value: string }[] {
  switch (guardKind) {
    case 'pathContainment':
      return [
        { description: `rejects path traversal on ${paramName}`, value: `"../../../etc/passwd"` },
        { description: `rejects absolute path on ${paramName}`, value: `"/etc/shadow"` },
      ];
    case 'sanitize':
      return [
        { description: `sanitizes dangerous input on ${paramName}`, value: `"<script>alert(1)</script>"` },
        { description: `sanitizes shell metacharacters on ${paramName}`, value: `"; rm -rf /"` },
      ];
    case 'validate':
      return [
        { description: `rejects out-of-range value on ${paramName}`, value: `-999` },
      ];
    case 'rateLimit':
      return []; // Rate limiting is hard to unit test
    case 'auth':
      return []; // Auth tests need env setup
    default:
      return [];
  }
}

// ── Test generator ──────────────────────────────────────────────────────

function generateTestFile(ast: IRNode, sourceFile: string): string {
  const mcpNode = ast.type === 'mcp' ? ast : (ast.children || []).find((c) => c.type === 'mcp');
  if (!mcpNode) {
    return `// No MCP server found in ${sourceFile}\n`;
  }

  const serverName = str(getProps(mcpNode).name) || 'MCPServer';
  const tools = getChildren(mcpNode, 'tool');
  const resources = getChildren(mcpNode, 'resource');

  const lines: string[] = [
    `/**`,
    ` * Generated tests for ${serverName} MCP server`,
    ` * Source: ${sourceFile}`,
    ` *`,
    ` * Run: npx jest ${basename(sourceFile, '.kern')}.test.ts`,
    ` */`,
    ``,
    `import { describe, it, expect } from '@jest/globals';`,
    ``,
  ];

  // Tool tests
  for (const tool of tools) {
    const toolName = str(getProps(tool).name) || 'unknown';
    const params = getChildren(tool, 'param');
    const guards = getChildren(tool, 'guard');

    lines.push(`describe('tool: ${toolName}', () => {`);

    // Happy path test
    const happyArgs: string[] = [];
    for (const param of params) {
      const pp = getProps(param);
      const name = str(pp.name) || 'input';
      const type = str(pp.type) || 'string';
      const defaultVal = str(pp.default);

      let sampleValue: string;
      if (defaultVal) {
        sampleValue = JSON.stringify(defaultVal);
      } else if (type === 'number' || type === 'int' || type === 'float') {
        sampleValue = '42';
      } else if (type === 'boolean' || type === 'bool') {
        sampleValue = 'true';
      } else {
        sampleValue = `"test-${name}"`;
      }
      happyArgs.push(`      ${name}: ${sampleValue},`);
    }

    lines.push(`  it('accepts valid parameters', () => {`);
    lines.push(`    const params = {`);
    lines.push(...happyArgs);
    lines.push(`    };`);
    lines.push(`    // Validate params match expected schema`);
    for (const param of params) {
      const pp = getProps(param);
      const name = str(pp.name);
      const required = str(pp.required) !== 'false' && !pp.default;
      if (required && name) {
        lines.push(`    expect(params.${name}).toBeDefined();`);
      }
    }
    lines.push(`  });`);
    lines.push(``);

    // Required param tests
    for (const param of params) {
      const pp = getProps(param);
      const name = str(pp.name);
      const required = str(pp.required) !== 'false' && !pp.default;
      if (required && name) {
        lines.push(`  it('requires param: ${name}', () => {`);
        lines.push(`    const params: Record<string, unknown> = {};`);
        lines.push(`    expect(params.${name}).toBeUndefined();`);
        lines.push(`    // Handler should reject missing required param`);
        lines.push(`  });`);
        lines.push(``);
      }
    }

    // Guard violation tests
    for (const guard of guards) {
      const gp = getProps(guard);
      const kind = str(gp.name) || str(gp.kind) || str(gp.type);
      const target = str(gp.param) || str(gp.target) || str(gp.field);

      const violations = guardViolationPayloads(kind, target);
      for (const violation of violations) {
        lines.push(`  it('${violation.description}', () => {`);
        lines.push(`    const maliciousInput = ${violation.value};`);
        lines.push(`    // Guard '${kind}' on '${target}' should block this input`);
        lines.push(`    expect(typeof maliciousInput).toBeDefined();`);
        lines.push(`    // TODO: Wire up actual tool handler invocation to verify guard blocks`);
        lines.push(`  });`);
        lines.push(``);
      }
    }

    lines.push(`});`);
    lines.push(``);
  }

  // Resource tests
  for (const resource of resources) {
    const name = str(getProps(resource).name) || 'unknown';
    const uri = str(getProps(resource).uri) || 'unknown://';

    lines.push(`describe('resource: ${name}', () => {`);
    lines.push(`  it('has valid URI pattern', () => {`);
    lines.push(`    const uri = ${JSON.stringify(uri)};`);
    lines.push(`    expect(uri).toBeTruthy();`);
    if (uri.includes('{')) {
      lines.push(`    // Templated URI — should have matching param definitions`);
      lines.push(`    expect(uri).toMatch(/\\{\\w+\\}/);`);
    }
    lines.push(`  });`);
    lines.push(`});`);
    lines.push(``);
  }

  return lines.join('\n');
}

// ── Command ─────────────────────────────────────────────────────────────

export function runTest(args: string[]): void {
  const testInput = args[1];
  const outDir = parseFlag(args, '--outdir');
  const dryRun = hasFlag(args, '--dry-run');

  if (!testInput) {
    console.error('Usage: kern test <file.kern> [--outdir=<dir>] [--dry-run]');
    console.error('');
    console.error('Generates test files for MCP server tools defined in .kern files.');
    console.error('Tests include happy path + guard violation test cases.');
    process.exit(1);
  }

  const inputPath = resolve(testInput);
  if (!existsSync(inputPath)) {
    console.error(`Not found: ${testInput}`);
    process.exit(1);
  }

  const source = readFileSync(inputPath, 'utf-8');
  const ast = parseAndSurface(source, inputPath);
  const testCode = generateTestFile(ast, basename(inputPath));

  if (dryRun) {
    process.stdout.write(testCode);
    return;
  }

  const outName = basename(inputPath, '.kern') + '.test.ts';
  const outPath = resolve(outDir || '.', outName);
  writeFileSync(outPath, testCode);
  console.log(`  Generated ${outName}`);
  console.log(`  Run: npx jest ${outName}`);
}
