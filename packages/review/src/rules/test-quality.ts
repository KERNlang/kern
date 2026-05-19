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
const STORYBOOK_FILE_RE = /\.stories\.(ts|tsx|js|jsx)$/;
/** Function names that register a test case. */
const TEST_REGISTRAR_NAMES = new Set(['it', 'test', 'fit', 'xit', 'xtest']);

function isTestFile(filePath: string): boolean {
  return TEST_FILE_RE.test(filePath);
}

function isStorybookFile(filePath: string): boolean {
  return STORYBOOK_FILE_RE.test(filePath);
}

function isPlaywrightFile(ctx: RuleContext): boolean {
  if (!isTestFile(ctx.filePath)) return false;
  if (/(^|[/\\])(?:e2e|playwright)([/\\]|$)/i.test(ctx.filePath)) return true;
  return ctx.sourceFile.getImportDeclarations().some((imp) => {
    const moduleSpecifier = imp.getModuleSpecifierValue();
    return moduleSpecifier === '@playwright/test' || moduleSpecifier.startsWith('playwright');
  });
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

  function flag(_node: Node, line: number) {
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

// ── Rule: focused-test-only ───────────────────────────────────────────────
//
// `.only` is useful while debugging, but committed focused tests hide the rest
// of the suite in most Jest/Vitest/Playwright runners.

function focusedTestOnly(ctx: RuleContext): ReviewFinding[] {
  if (!isTestFile(ctx.filePath)) return [];

  const findings: ReviewFinding[] = [];
  const reported = new Set<string>();
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const onlyMatch = call
      .getExpression()
      .getText()
      .match(/\b((?:test\.)?describe|it|test)\.only\b|\b(fdescribe|fit)\b/);
    if (!onlyMatch) continue;
    const root = onlyMatch[1] === 'test.describe' ? 'describe' : (onlyMatch[1] ?? onlyMatch[2]);
    const reportKey = `${root}:${call.getStartLineNumber()}`;
    if (reported.has(reportKey)) continue;
    reported.add(reportKey);

    findings.push(
      finding(
        'focused-test-only',
        'error',
        'bug',
        `Committed ${root}.only() focuses the test runner and can skip the rest of the suite`,
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion: `Replace ${root}.only(...) with ${root}(...) before committing.`,
        },
      ),
    );
  }

  return findings;
}

// ── Rule: playwright-wait-for-timeout ────────────────────────────────────
//
// Hard sleeps make Playwright tests slow and flaky. Prefer web-first
// assertions, locator auto-waiting, or waiting for a specific request/state.

function playwrightWaitForTimeout(ctx: RuleContext): ReviewFinding[] {
  if (!isPlaywrightFile(ctx)) return [];

  const findings: ReviewFinding[] = [];
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'waitForTimeout') continue;

    findings.push(
      finding(
        'playwright-wait-for-timeout',
        'warning',
        'bug',
        'Playwright test uses waitForTimeout() — fixed sleeps make tests slower and flaky under CI load',
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Wait for a locator/assertion, response, URL, or app-specific signal instead of sleeping for a fixed duration.',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: playwright-networkidle ─────────────────────────────────────────
//
// `networkidle` is brittle for modern apps with analytics, polling, streaming,
// and background prefetches. Playwright recommends web-first assertions.

function hasNetworkIdleLiteral(node: Node | undefined): boolean {
  if (!node) return false;
  if (
    (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) &&
    node.getLiteralText() === 'networkidle'
  )
    return true;
  if (!Node.isObjectLiteralExpression(node)) return false;
  return node.getProperties().some((prop) => {
    if (!Node.isPropertyAssignment(prop)) return false;
    const name = prop.getNameNode().getText().replace(/['"`]/g, '');
    if (name !== 'waitUntil') return false;
    const init = prop.getInitializer();
    return Boolean(
      init &&
        (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) &&
        init.getLiteralText() === 'networkidle',
    );
  });
}

function playwrightNetworkIdle(ctx: RuleContext): ReviewFinding[] {
  if (!isPlaywrightFile(ctx)) return [];

  const findings: ReviewFinding[] = [];
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    const method = callee.getName();
    if (method !== 'waitForLoadState' && method !== 'goto') continue;
    if (!call.getArguments().some(hasNetworkIdleLiteral)) continue;

    findings.push(
      finding(
        'playwright-networkidle',
        'warning',
        'bug',
        "Playwright test waits for 'networkidle' — background requests can make this flaky or mask the actual readiness condition",
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Wait for a specific locator assertion, URL, response, or app-ready signal that represents the user-visible state under test.',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: storybook-secret-arg ───────────────────────────────────────────
//
// Story args/parameters are client-visible and often published in docs builds.
// Secret-looking props should not carry literal secrets or server env values.

const SECRET_STORYBOOK_KEY_RE = /(?:api[_-]?key|token|secret|password|credential|authorization|bearer)/i;

function getPropertyNameText(node: Node): string | undefined {
  if (Node.isPropertyAssignment(node) || Node.isShorthandPropertyAssignment(node)) {
    return Node.isPropertyAssignment(node) ? node.getNameNode().getText().replace(/['"`]/g, '') : node.getName();
  }
  return undefined;
}

function isSecretStoryValue(node: Node | undefined): boolean {
  if (!node) return false;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    const value = node.getLiteralText();
    if (/(?:mock|fake|test|demo|dummy|example|placeholder|changeme|xxx)/i.test(value)) return false;
    return (
      value.length >= 24 || /^(?:sk|pk|ghp|gho|ghu|ghs|glpat|xox[baprs]|AIza|AKIA|eyJ)[A-Za-z0-9_-]{8,}/.test(value)
    );
  }
  const text = node.getText();
  return [...text.matchAll(/process\.env\.(?!NEXT_PUBLIC_)([A-Z0-9_]+)/g)].some((match) =>
    SECRET_STORYBOOK_KEY_RE.test(match[1]),
  );
}

function storybookSecretArg(ctx: RuleContext): ReviewFinding[] {
  if (!isStorybookFile(ctx.filePath)) return [];

  const findings: ReviewFinding[] = [];
  for (const prop of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    const name = getPropertyNameText(prop);
    if (!name || !SECRET_STORYBOOK_KEY_RE.test(name)) continue;
    if (!isSecretStoryValue(prop.getInitializer())) continue;

    findings.push(
      finding(
        'storybook-secret-arg',
        'warning',
        'bug',
        `Storybook story exposes secret-looking prop '${name}' in args/parameters — stories run in the browser and may be published`,
        ctx.filePath,
        prop.getStartLineNumber(),
        1,
        {
          suggestion:
            'Use inert placeholder values in stories and keep real secrets on the server or in test-only mock handlers.',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: storybook-random-story-data ────────────────────────────────────
//
// Random/time-derived data makes visual snapshots and interaction tests drift
// between runs.

function storybookRandomStoryData(ctx: RuleContext): ReviewFinding[] {
  if (!isStorybookFile(ctx.filePath)) return [];

  const findings: ReviewFinding[] = [];
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const calleeText = callee.getText();
    const isRandomOrNow = calleeText === 'Math.random' || calleeText === 'Date.now';
    if (!isRandomOrNow) continue;

    findings.push(
      finding(
        'storybook-random-story-data',
        'warning',
        'bug',
        'Storybook story uses random or current-time data — visual snapshots and interaction tests can drift between runs',
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion: 'Use fixed fixture data, seeded generators, or deterministic dates inside stories.',
        },
      ),
    );
  }

  for (const expr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (expr.getExpression().getText() !== 'Date') continue;
    if (expr.getArguments().length > 0) continue;
    findings.push(
      finding(
        'storybook-random-story-data',
        'warning',
        'bug',
        'Storybook story uses random or current-time data — visual snapshots and interaction tests can drift between runs',
        ctx.filePath,
        expr.getStartLineNumber(),
        1,
        {
          suggestion: 'Use fixed fixture data, seeded generators, or deterministic dates inside stories.',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: storybook-network-call-without-mock ────────────────────────────
//
// Stories should be hermetic. Direct network calls without obvious MSW/mock
// evidence make Storybook docs and tests depend on live services.

function hasStorybookMockEvidence(ctx: RuleContext): boolean {
  const text = ctx.sourceFile.getFullText();
  return /\bmsw\b|mockServiceWorker|MockedProvider|createMock|mockData|parameters\s*:\s*{[^}]*\bmsw\b/s.test(text);
}

function isNetworkClientCall(call: import('ts-morph').CallExpression): boolean {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText() === 'fetch';
  if (!Node.isPropertyAccessExpression(callee)) return false;
  const receiver = callee.getExpression().getText();
  return receiver === 'axios';
}

function storybookNetworkCallWithoutMock(ctx: RuleContext): ReviewFinding[] {
  if (!isStorybookFile(ctx.filePath)) return [];
  if (hasStorybookMockEvidence(ctx)) return [];

  const findings: ReviewFinding[] = [];
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isNetworkClientCall(call)) continue;
    findings.push(
      finding(
        'storybook-network-call-without-mock',
        'warning',
        'bug',
        'Storybook story performs a network call without obvious mock/MSW setup — stories should be deterministic and offline-safe',
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Move live calls behind MSW/mock handlers or pass deterministic fixture data through args/loaders.',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: storybook-play-without-assertion ───────────────────────────────
//
// Interaction stories that drive user events but assert nothing often pass
// even when the expected UI state never appears.

function storybookPlayWithoutAssertion(ctx: RuleContext): ReviewFinding[] {
  if (!isStorybookFile(ctx.filePath)) return [];

  const findings: ReviewFinding[] = [];
  for (const prop of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    const name = getPropertyNameText(prop);
    if (name !== 'play') continue;
    const init = prop.getInitializer();
    if (!init || (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init))) continue;
    const bodyText = init.getBody().getText();
    if (!/\b(?:userEvent|fireEvent)\./.test(bodyText)) continue;
    if (/\bexpect\s*\(|\bwaitFor\s*\(|\bfindBy[A-Z]/.test(bodyText)) continue;

    findings.push(
      finding(
        'storybook-play-without-assertion',
        'warning',
        'bug',
        'Storybook play function performs interactions without an assertion — interaction tests can pass without verifying UI state',
        ctx.filePath,
        prop.getStartLineNumber(),
        1,
        {
          suggestion: 'Assert the expected post-interaction UI with expect(...), findBy*, or waitFor(...).',
        },
      ),
    );
  }

  return findings;
}

export const testQualityRules = [
  expectNoMatcher,
  emptyTestFile,
  focusedTestOnly,
  playwrightWaitForTimeout,
  playwrightNetworkIdle,
  storybookSecretArg,
  storybookRandomStoryData,
  storybookNetworkCallWithoutMock,
  storybookPlayWithoutAssertion,
];
