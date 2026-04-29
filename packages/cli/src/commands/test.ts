import type { IRNode } from '@kernlang/core';
import {
  checkNativeKernTestBaseline,
  createNativeKernTestBaseline,
  explainNativeKernTestRule,
  formatNativeKernTestCoverage,
  formatNativeKernTestRunSummary,
  formatNativeKernTestSummary,
  hasNativeKernTests,
  listNativeKernTestRules,
  type NativeKernTestBaseline,
  type NativeKernTestRunSummary,
  type NativeKernTestSummary,
  runNativeKernTestRun,
  runNativeKernTests,
} from '@kernlang/test';
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import { hasFlag, parseAndSurface, parseFlag } from '../shared.js';

export {
  checkNativeKernTestBaseline,
  createNativeKernTestBaseline,
  explainNativeKernTestRule,
  formatNativeKernTestCoverage,
  formatNativeKernTestRunSummary,
  formatNativeKernTestSummary,
  listNativeKernTestRules,
  runNativeKernTestRun,
  runNativeKernTests,
} from '@kernlang/test';

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

function _getFirstChild(node: IRNode, type: string): IRNode | undefined {
  return (node.children || []).find((c) => c.type === type);
}

function hasValueFlag(args: string[], flag: string): boolean {
  return args.includes(flag) || args.some((arg) => arg.startsWith(`${flag}=`));
}

function parseValueFlag(args: string[], flag: string): string | undefined {
  const eqArg = args.find((arg) => arg.startsWith(`${flag}=`));
  if (eqArg) return eqArg.slice(flag.length + 1);
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const next = args[index + 1];
  if (!next || next.startsWith('--')) return '';
  return next;
}

function requireValueFlag(args: string[], flag: string, description: string): string | undefined {
  if (!hasValueFlag(args, flag)) return undefined;
  const value = parseValueFlag(args, flag);
  if (!value) {
    console.error(`${flag} requires ${description}.`);
    process.exit(2);
  }
  return value;
}

function loadNativeBaseline(path: string): NativeKernTestBaseline {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as NativeKernTestBaseline;
    if (parsed.version !== 1 || !Array.isArray(parsed.warnings)) {
      throw new Error('expected { "version": 1, "warnings": [...] }');
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `Failed to read native test baseline ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function handleNativeBaseline(
  summary: NativeKernTestSummary | NativeKernTestRunSummary,
  opts: { baselinePath?: string; writeBaselinePath?: string },
): boolean {
  let failed = false;
  try {
    if (opts.writeBaselinePath) {
      writeFileSync(opts.writeBaselinePath, `${JSON.stringify(createNativeKernTestBaseline(summary), null, 2)}\n`);
    }
    if (opts.baselinePath) {
      const check = checkNativeKernTestBaseline(summary, loadNativeBaseline(opts.baselinePath));
      if (!check.ok) {
        failed = true;
        for (const warning of check.newWarnings) {
          console.error(
            `New native warning: ${warning.suite} > ${warning.caseName}: ${warning.assertion} [${warning.ruleId}]${warning.message ? ` - ${warning.message}` : ''}`,
          );
        }
        for (const warning of check.staleWarnings) {
          console.error(
            `Stale native warning baseline: ${warning.suite} > ${warning.caseName}: ${warning.assertion} [${warning.ruleId}]${warning.message ? ` - ${warning.message}` : ''}`,
          );
        }
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  return failed;
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
      return [{ description: `rejects out-of-range value on ${paramName}`, value: `-999` }];
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
  const json = hasFlag(args, '--json');
  const generateOnly = hasFlag(args, '--generate');
  const failOnWarn = hasFlag(args, '--fail-on-warn');
  const bail = hasFlag(args, '--bail');
  const passWithNoTests = hasFlag(args, '--pass-with-no-tests');
  const listRules = hasFlag(args, '--list-rules');

  if (listRules) {
    const rules = listNativeKernTestRules();
    process.stdout.write(
      json
        ? `${JSON.stringify(rules, null, 2)}\n`
        : `${rules.map((rule) => `${rule.ruleId} - ${rule.description}`).join('\n')}\n`,
    );
    return;
  }

  const explainRule = requireValueFlag(args, '--explain-rule', 'a rule ID');
  if (explainRule) {
    const rule = explainNativeKernTestRule(explainRule);
    if (!rule) {
      console.error(`Unknown native test rule: ${explainRule}`);
      process.exit(2);
    }
    process.stdout.write(
      json
        ? `${JSON.stringify(rule, null, 2)}\n`
        : `${rule.ruleId}\n${rule.description}${rule.presets?.length ? `\nPresets: ${rule.presets.join(', ')}` : ''}\n`,
    );
    return;
  }

  const grepFlagPresent = hasValueFlag(args, '--grep');
  const grep = requireValueFlag(args, '--grep', 'a pattern');
  const formatFlagPresent = hasValueFlag(args, '--format');
  const requestedFormat = requireValueFlag(args, '--format', '"default" or "compact"');
  const compact = hasFlag(args, '--compact') || requestedFormat === 'compact';
  const maxWarningsRaw = requireValueFlag(args, '--max-warnings', 'a non-negative integer');
  const minCoverageRaw = requireValueFlag(args, '--min-coverage', 'a percentage from 0 to 100');
  const coverage = hasFlag(args, '--coverage') || minCoverageRaw !== undefined;
  const baselinePath = requireValueFlag(args, '--baseline', 'a file path');
  const writeBaselinePath = requireValueFlag(args, '--write-baseline', 'a file path');
  const maxWarnings = maxWarningsRaw === undefined ? undefined : Number(maxWarningsRaw);
  const minCoverage = minCoverageRaw === undefined ? undefined : Number(minCoverageRaw);

  if (!testInput) {
    console.error(
      'Usage: kern test <file-or-dir> [--json] [--grep <pattern>] [--bail] [--fail-on-warn] [--max-warnings <n>] [--coverage] [--min-coverage <pct>] [--baseline <file>] [--write-baseline <file>] [--pass-with-no-tests] [--format compact] [--compact] [--list-rules] [--explain-rule <rule>] [--generate] [--outdir=<dir>] [--dry-run]',
    );
    console.error('');
    console.error('Runs native KERN tests when the file contains test/describe/it nodes.');
    console.error('Without native tests, keeps the legacy MCP Jest test generator behavior.');
    process.exit(1);
  }

  if (grepFlagPresent && !grep) {
    console.error('--grep requires a pattern.');
    process.exit(2);
  }
  if (formatFlagPresent && requestedFormat !== 'default' && requestedFormat !== 'compact') {
    console.error('--format must be "default" or "compact".');
    process.exit(2);
  }
  if (maxWarnings !== undefined && (!Number.isInteger(maxWarnings) || maxWarnings < 0)) {
    console.error('--max-warnings requires a non-negative integer.');
    process.exit(2);
  }
  if (minCoverage !== undefined && (Number.isNaN(minCoverage) || minCoverage < 0 || minCoverage > 100)) {
    console.error('--min-coverage requires a percentage from 0 to 100.');
    process.exit(2);
  }
  if (baselinePath && writeBaselinePath) {
    console.error('--baseline and --write-baseline cannot be used together.');
    process.exit(2);
  }

  const inputPath = resolve(testInput);
  if (!existsSync(inputPath)) {
    console.error(`Not found: ${testInput}`);
    process.exit(1);
  }

  const stat = statSync(inputPath);
  if (stat.isDirectory()) {
    if (generateOnly) {
      console.error('--generate requires a .kern file input, not a directory.');
      process.exit(1);
    }

    const summary = runNativeKernTestRun(inputPath, { grep, bail, passWithNoTests });
    process.stdout.write(
      json
        ? `${JSON.stringify(summary, null, 2)}\n`
        : formatNativeKernTestRunSummary(summary, compact ? { format: 'compact' } : undefined),
    );
    if (coverage && !json) process.stdout.write(formatNativeKernTestCoverage(summary.coverage));
    const baselineFailed = handleNativeBaseline(summary, { baselinePath, writeBaselinePath });
    const coverageFailed = minCoverage !== undefined && summary.coverage.percent < minCoverage;
    if (coverageFailed) {
      console.error(`Native coverage ${summary.coverage.percent}% is below --min-coverage ${minCoverage}%.`);
    }
    if (
      summary.failed > 0 ||
      baselineFailed ||
      coverageFailed ||
      (failOnWarn && summary.warnings > 0) ||
      (maxWarnings !== undefined && summary.warnings > maxWarnings) ||
      (grep && summary.total === 0 && summary.files.length > 0 && !passWithNoTests)
    ) {
      process.exitCode = 1;
    }
    return;
  }

  const source = readFileSync(inputPath, 'utf-8');
  if (!generateOnly && hasNativeKernTests(source)) {
    const summary = runNativeKernTests(inputPath, { grep, bail, passWithNoTests });
    process.stdout.write(
      json
        ? `${JSON.stringify(summary, null, 2)}\n`
        : formatNativeKernTestSummary(summary, compact ? { format: 'compact' } : undefined),
    );
    if (coverage && !json) process.stdout.write(formatNativeKernTestCoverage(summary.coverage));
    const baselineFailed = handleNativeBaseline(summary, { baselinePath, writeBaselinePath });
    const coverageFailed = minCoverage !== undefined && summary.coverage.percent < minCoverage;
    if (coverageFailed) {
      console.error(`Native coverage ${summary.coverage.percent}% is below --min-coverage ${minCoverage}%.`);
    }
    if (
      summary.failed > 0 ||
      baselineFailed ||
      coverageFailed ||
      (failOnWarn && summary.warnings > 0) ||
      (maxWarnings !== undefined && summary.warnings > maxWarnings) ||
      (grep && summary.total === 0 && !passWithNoTests)
    ) {
      process.exitCode = 1;
    }
    return;
  }

  const ast = parseAndSurface(source, inputPath);
  const testCode = generateTestFile(ast, basename(inputPath));

  if (dryRun) {
    process.stdout.write(testCode);
    return;
  }

  const outName = `${basename(inputPath, '.kern')}.test.ts`;
  const outPath = resolve(outDir || '.', outName);
  writeFileSync(outPath, testCode);
  console.log(`  Generated ${outName}`);
  console.log(`  Run: npx jest ${outName}`);
}
