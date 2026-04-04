/**
 * Golden Test Runner — AST-based comparison of codegen output vs expected output.
 *
 * Whitespace-insensitive: normalizes both sides before comparing.
 * Used by validation pipeline and `kern evolve test` command.
 */

import { parse, registerParserHints, unregisterParserHints } from '@kernlang/core';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { EvolvedManifest } from './evolved-types.js';
import { loadSandboxedGenerator } from './sandboxed-generator.js';

export interface GoldenTestResult {
  keyword: string;
  pass: boolean;
  error?: string;
  actual?: string;
  expected?: string;
}

/**
 * Compare two code strings with whitespace normalization.
 * Returns true if they're structurally equivalent.
 */
export function compareGoldenOutput(actual: string, expected: string): boolean {
  return normalize(actual) === normalize(expected);
}

/**
 * Normalize code for comparison:
 * - Trim each line
 * - Remove empty lines
 * - Collapse multiple spaces
 * - Normalize line endings
 */
function normalize(code: string): string {
  return code
    .split('\n')
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter((l) => l.length > 0)
    .join('\n')
    .trim();
}

/**
 * Run golden tests for all evolved nodes in .kern/evolved/.
 * Each node must have template.kern + expected-output.ts.
 */
export function runGoldenTests(baseDir: string = process.cwd()): GoldenTestResult[] {
  const evolvedDir = resolve(baseDir, '.kern', 'evolved');
  const manifestPath = join(evolvedDir, 'manifest.json');

  if (!existsSync(manifestPath)) return [];

  let manifest: EvolvedManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return [{ keyword: '*', pass: false, error: 'Failed to parse manifest.json' }];
  }

  const results: GoldenTestResult[] = [];

  for (const [keyword, entry] of Object.entries(manifest.nodes)) {
    const nodeDir = join(evolvedDir, keyword);
    const templatePath = join(nodeDir, 'template.kern');
    const expectedPath = join(nodeDir, 'expected-output.ts');
    const codegenPath = join(nodeDir, 'codegen.js');

    // Check required files exist
    if (!existsSync(templatePath)) {
      results.push({ keyword, pass: false, error: 'Missing template.kern' });
      continue;
    }
    if (!existsSync(expectedPath)) {
      results.push({ keyword, pass: false, error: 'Missing expected-output.ts' });
      continue;
    }
    if (!existsSync(codegenPath)) {
      results.push({ keyword, pass: false, error: 'Missing codegen.js' });
      continue;
    }

    // Register parser hints temporarily
    if (entry.parserHints) {
      registerParserHints(keyword, entry.parserHints);
    }

    try {
      const kernSource = readFileSync(templatePath, 'utf-8');
      const expectedOutput = readFileSync(expectedPath, 'utf-8');
      const generator = loadSandboxedGenerator(codegenPath);

      const ast = parse(kernSource);
      const actual = generator(ast).join('\n');

      const pass = compareGoldenOutput(actual, expectedOutput);
      results.push({
        keyword,
        pass,
        ...(pass ? {} : { actual, expected: expectedOutput }),
      });
    } catch (err) {
      results.push({ keyword, pass: false, error: (err as Error).message });
    } finally {
      if (entry.parserHints) {
        unregisterParserHints(keyword);
      }
    }
  }

  return results;
}

/**
 * Format golden test results for terminal display.
 */
export function formatGoldenTestResults(results: GoldenTestResult[]): string {
  if (results.length === 0) return '  No evolved nodes to test.';

  const lines: string[] = [];
  let passed = 0;
  let failed = 0;

  for (const r of results) {
    if (r.pass) {
      lines.push(`  \u2713 ${r.keyword}`);
      passed++;
    } else {
      lines.push(`  \u2717 ${r.keyword}: ${r.error || 'Golden diff mismatch'}`);
      failed++;
    }
  }

  lines.push('');
  lines.push(`  ${passed} passed, ${failed} failed, ${results.length} total`);

  return lines.join('\n');
}
