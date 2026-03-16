/**
 * Next.js review rules — active when target = nextjs (on top of React rules).
 *
 * Catches Server Component / App Router pitfalls.
 */

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
// React hooks (useState, useEffect, etc.) in a Server Component

function serverHook(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();

  if (isClientComponent(fullText)) return findings;

  const clientHooks = ['useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
    'useReducer', 'useContext', 'useLayoutEffect', 'useTransition',
    'useDeferredValue', 'useImperativeHandle', 'useSyncExternalStore'];

  for (const hook of clientHooks) {
    const hookRegex = new RegExp(`\\b${hook}\\s*[<(]`, 'g');
    let match;
    while ((match = hookRegex.exec(fullText)) !== null) {
      const line = fullText.substring(0, match.index).split('\n').length;
      findings.push(finding('server-hook', 'error', 'bug',
        `'${hook}' used in Server Component — add 'use client' directive or move to a Client Component`,
        ctx.filePath, line,
        { suggestion: "Add 'use client' at the top of the file" }));
    }
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
