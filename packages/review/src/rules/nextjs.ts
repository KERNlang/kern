/**
 * Next.js review rules — active when target = nextjs (on top of React rules).
 *
 * Catches Server Component / App Router pitfalls.
 */

import { SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';

function span(file: string, line: number, col = 1): SourceSpan {
  return { file, startLine: line, startCol: col, endLine: line, endCol: col };
}

function finding(
  ruleId: string,
  severity: 'error' | 'warning' | 'info',
  category: ReviewFinding['category'],
  message: string,
  file: string,
  line: number,
  extra?: Partial<ReviewFinding>,
): ReviewFinding {
  return {
    source: 'kern',
    ruleId,
    severity,
    category,
    message,
    primarySpan: span(file, line),
    fingerprint: createFingerprint(ruleId, line, 1),
    ...extra,
  };
}

function isClientComponent(fullText: string): boolean {
  // Check for 'use client' directive (must be at the top of the file)
  return /^['"]use client['"];?\s*$/m.test(fullText.substring(0, 200));
}

// ── Rule 21: server-hook ─────────────────────────────────────────────────
// React hooks (useState, useEffect, etc.) in a Server Component.
// Only fires on runtime files — codegen/examples/rules/barrels are skipped.

const CLIENT_HOOKS = new Set(['useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
  'useReducer', 'useContext', 'useLayoutEffect', 'useTransition',
  'useDeferredValue', 'useImperativeHandle', 'useSyncExternalStore']);

function serverHook(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Gate: only run on runtime files (skip codegen, rules, examples, barrels, tests)
  if (ctx.fileRole !== 'runtime') return findings;

  const fullText = ctx.sourceFile.getFullText();
  if (isClientComponent(fullText)) return findings;

  // AST-aware: walk actual CallExpression nodes, not regex on raw text
  const calls = ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const expr = call.getExpression();
    let hookName: string | undefined;

    // Direct call: useState(...)
    if (expr.getKind() === SyntaxKind.Identifier) {
      const name = expr.getText();
      if (CLIENT_HOOKS.has(name)) hookName = name;
    }
    // Property access: React.useState(...)
    else if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
      const prop = expr.asKind(SyntaxKind.PropertyAccessExpression);
      if (prop) {
        const name = prop.getName();
        if (CLIENT_HOOKS.has(name)) hookName = name;
      }
    }

    if (!hookName) continue;

    // Skip if inside a string literal, template literal, or comment (codegen output)
    const parent = call.getParent();
    if (parent && (
      parent.getKind() === SyntaxKind.TemplateExpression ||
      parent.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral ||
      parent.getKind() === SyntaxKind.TemplateSpan
    )) continue;

    const line = call.getStartLineNumber();
    findings.push(finding('server-hook', 'error', 'bug',
      `'${hookName}' used in Server Component — add 'use client' directive or move to a Client Component`,
      ctx.filePath, line,
      { suggestion: "Add 'use client' at the top of the file" }));
  }

  return findings;
}

// ── Rule 22: hydration-mismatch ──────────────────────────────────────────
// Nondeterministic expressions (Date.now, Math.random, new Date) in render

function hydrationMismatch(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();

  // Build a set of character ranges that are inside useEffect/useMemo/event handlers
  const safeRanges: Array<[number, number]> = [];
  const safeCallRegex = /(?:useEffect|useMemo|useCallback|onClick|onSubmit)\s*\(\s*/g;
  let safeMatch;
  while ((safeMatch = safeCallRegex.exec(fullText)) !== null) {
    const startIdx = safeMatch.index + safeMatch[0].length;
    let depth = 0;
    let rangeEnd = startIdx;
    for (let i = startIdx; i < fullText.length; i++) {
      if (fullText[i] === '(') depth++;
      if (fullText[i] === '{') depth++;
      if (fullText[i] === ')') { if (depth === 0) { rangeEnd = i; break; } depth--; }
      if (fullText[i] === '}') depth--;
    }
    safeRanges.push([safeMatch.index, rangeEnd]);
  }

  const isInSafeRange = (idx: number) => safeRanges.some(([s, e]) => idx >= s && idx <= e);

  const nondeterministic = [
    { pattern: /\bDate\.now\s*\(\s*\)/g, name: 'Date.now()' },
    { pattern: /\bMath\.random\s*\(\s*\)/g, name: 'Math.random()' },
    { pattern: /\bnew\s+Date\s*\(\s*\)/g, name: 'new Date()' },
    { pattern: /\bcrypto\.randomUUID\s*\(\s*\)/g, name: 'crypto.randomUUID()' },
  ];

  for (const { pattern, name } of nondeterministic) {
    let match;
    while ((match = pattern.exec(fullText)) !== null) {
      // Skip if inside useEffect, useMemo, event handler, or server action
      if (isInSafeRange(match.index)) continue;

      const line = fullText.substring(0, match.index).split('\n').length;
      const lineText = fullText.split('\n')[line - 1] || '';
      if (lineText.includes("'use server'")) continue;

      findings.push(finding('hydration-mismatch', 'warning', 'bug',
        `${name} in render produces different values on server vs client — hydration mismatch`,
        ctx.filePath, line,
        { suggestion: `Move to useEffect or use a stable seed. For IDs, use React.useId()` }));
    }
  }

  return findings;
}

// ── Rule 23: missing-use-client ──────────────────────────────────────────
// Event handlers (onClick, onChange, etc.) without 'use client' directive

function missingUseClient(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();

  if (isClientComponent(fullText)) return findings;

  const eventHandlers = ['onClick', 'onChange', 'onSubmit', 'onKeyDown', 'onKeyUp',
    'onMouseEnter', 'onMouseLeave', 'onFocus', 'onBlur', 'onInput',
    'onTouchStart', 'onTouchEnd', 'onScroll', 'onDrag'];

  const found = new Set<string>();

  for (const handler of eventHandlers) {
    const regex = new RegExp(`\\b${handler}=\\{`, 'g');
    let match;
    while ((match = regex.exec(fullText)) !== null) {
      if (found.has(handler)) continue;
      found.add(handler);
      const line = fullText.substring(0, match.index).split('\n').length;
      findings.push(finding('missing-use-client', 'warning', 'pattern',
        `'${handler}' in Server Component — needs 'use client' directive`,
        ctx.filePath, line,
        { suggestion: "Add 'use client' at the top of the file, or extract to a Client Component" }));
    }
  }

  return findings;
}

// ── Exported Next.js Rules ───────────────────────────────────────────────

export const nextjsRules = [
  serverHook,
  hydrationMismatch,
  missingUseClient,
];
