/**
 * Test-quality rules — high-precision patterns that catch tests which appear
 * to assert something but in fact assert nothing.
 *
 *   - expect-no-matcher  — `expect(x);` with no chained matcher (a no-op)
 *   - empty-test-file    — `*.test.{ts,tsx}` / `*.spec.{ts,tsx}` with zero
 *                          `it()` / `test()` calls (likely a stub left behind
 *                          after a refactor)
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding } from './utils.js';

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts)$/;
/** Function names that register a test case. */
const TEST_REGISTRAR_NAMES = new Set(['it', 'test', 'fit', 'xit', 'xtest']);

function isTestFile(filePath: string): boolean {
  return TEST_FILE_RE.test(filePath);
}

/** Unwrap `await` / parens to get to the underlying expression. */
function unwrapAwaitAndParens(node: Node): Node {
  let cur = node;
  while (Node.isAwaitExpression(cur) || Node.isParenthesizedExpression(cur)) {
    cur = cur.getExpression();
  }
  return cur;
}

/** True when `expr` is a CallExpression whose callee is the bare identifier `expect`. */
function isBareExpectCall(expr: Node): boolean {
  if (!Node.isCallExpression(expr)) return false;
  const callee = expr.getExpression();
  return Node.isIdentifier(callee) && callee.getText() === 'expect';
}

// ── Rule: expect-no-matcher ────────────────────────────────────────────────
//
// Flags an `expect(x)` call used in a position where no matcher is chained —
// a no-op assertion that silently passes. Covers:
//   - bare statement `expect(x);`
//   - awaited bare statement `await expect(p);`
//   - bare return `return expect(x);`

function expectNoMatcher(ctx: RuleContext): ReviewFinding[] {
  if (!isTestFile(ctx.filePath)) return [];

  const findings: ReviewFinding[] = [];
  const reported = new Set<number>();

  function flag(node: Node, line: number) {
    if (reported.has(line)) return;
    reported.add(line);
    findings.push(
      finding(
        'expect-no-matcher',
        'error',
        'bug',
        '`expect(x)` with no matcher chained — this is a no-op and silently passes',
        ctx.filePath,
        line,
        1,
        {
          suggestion: 'Chain a matcher (e.g. .toBe(...), .toEqual(...), .toThrow()) or remove the line',
        },
      ),
    );
  }

  for (const stmt of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ExpressionStatement)) {
    const inner = unwrapAwaitAndParens(stmt.getExpression());
    if (!isBareExpectCall(inner)) continue;
    flag(stmt, stmt.getStartLineNumber());
  }

  for (const ret of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    const value = ret.getExpression();
    if (!value) continue;
    const inner = unwrapAwaitAndParens(value);
    if (!isBareExpectCall(inner)) continue;
    flag(ret, ret.getStartLineNumber());
  }

  return findings;
}

// ── Rule: empty-test-file ──────────────────────────────────────────────────
//
// Flags a `.test.{ts,tsx}` / `.spec.{ts,tsx}` file that registers no test
// cases — likely a stub left behind after a refactor.
//
// Scope reductions:
//   - skip files that export anything (fixtures, mocks, setup helpers)
//   - skip files whose name contains `setup`, `fixture`, `mock`, `helper`
//     (matches `setupTests.ts`, `fixtures.ts`, `mocks.ts`, etc. — intentionally
//     does not require word-boundary, since `setupTests` is one identifier)
//   - recognises both regular call form `it(...)` and tagged template form
//     `` it.each`a | b ${1} | ${2}`('...', ...) `` used by Jest/Vitest

const TEST_HELPER_PATH_RE = /(^|[/\\])(setup|fixture|mock|helper|util)/i;

function isTestRegistrarName(name: string): boolean {
  return TEST_REGISTRAR_NAMES.has(name);
}

function getRegistrarRootName(callee: Node): string | undefined {
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) {
    const left = callee.getExpression();
    if (Node.isIdentifier(left)) return left.getText();
  }
  return undefined;
}

function emptyTestFile(ctx: RuleContext): ReviewFinding[] {
  if (!isTestFile(ctx.filePath)) return [];
  if (TEST_HELPER_PATH_RE.test(ctx.filePath)) return [];

  // A file that exports anything is treated as a fixture / helper, not a test.
  for (const stmt of ctx.sourceFile.getStatements()) {
    if (Node.isExportDeclaration(stmt)) return [];
    if (Node.isExportAssignment(stmt)) return [];
    if (
      (Node.isFunctionDeclaration(stmt) ||
        Node.isVariableStatement(stmt) ||
        Node.isClassDeclaration(stmt) ||
        Node.isTypeAliasDeclaration(stmt) ||
        Node.isInterfaceDeclaration(stmt)) &&
      stmt.getModifiers().some((m) => m.getText() === 'export')
    ) {
      return [];
    }
  }

  // Regular call form: `it('name', fn)` / `test.only(...)` / `it.each([...])(...)`
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const root = getRegistrarRootName(call.getExpression());
    if (root && isTestRegistrarName(root)) return [];
  }

  // Tagged-template form: `` it.each`a | b ${1} | ${2}`('...', fn) `` —
  // this produces a TaggedTemplateExpression (the table) wrapped in a
  // CallExpression (the test name + fn). Walk all tagged templates so we
  // also accept the bare-tagged style without arguments (defensive).
  for (const tag of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression)) {
    const root = getRegistrarRootName(tag.getTag());
    if (root && isTestRegistrarName(root)) return [];
  }

  return [
    finding(
      'empty-test-file',
      'warning',
      'structure',
      'Test file registers no test cases (no `it()` / `test()` calls) — likely a stub left behind after a refactor',
      ctx.filePath,
      1,
      1,
      {
        suggestion: 'Add at least one `it()` / `test()` block, or delete the file if the tests moved elsewhere',
      },
    ),
  ];
}

export const testQualityRules = [expectNoMatcher, emptyTestFile];
