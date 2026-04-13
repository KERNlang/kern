/**
 * Next.js review rules — active when target = nextjs (on top of React rules).
 *
 * Catches Server Component / App Router pitfalls.
 */

import { readFileSync } from 'fs';
import { basename } from 'path';
import { SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding } from './utils.js';

function isClientComponent(fullText: string): boolean {
  // Check for 'use client' directive (must be at the top of the file)
  return /^['"]use client['"];?\s*$/m.test(fullText.substring(0, 200));
}

/**
 * Check if a file is actually a React file — has JSX syntax or React imports.
 * Backend/utility files in a Next.js project should not trigger React rules.
 */
function isReactFile(ctx: RuleContext): boolean {
  const fullText = ctx.sourceFile.getFullText();
  // Has React/Next imports
  if (/\bfrom\s+['"]react['"]/.test(fullText) || /\bfrom\s+['"]next\//.test(fullText)) return true;
  // Has JSX syntax (opening tags or self-closing)
  if (ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement).length > 0) return true;
  if (ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0) return true;
  // Has React hooks
  if (/\buse(?:State|Effect|Ref|Callback|Memo|Reducer|Context)\s*[<(]/.test(fullText)) return true;
  return false;
}

// ── Rule 21: server-hook ─────────────────────────────────────────────────
// React hooks (useState, useEffect, etc.) in a Server Component.
// Only fires on runtime files — codegen/examples/rules/barrels are skipped.

const CLIENT_HOOKS = new Set([
  'useState',
  'useEffect',
  'useRef',
  'useCallback',
  'useMemo',
  'useReducer',
  'useContext',
  'useLayoutEffect',
  'useTransition',
  'useDeferredValue',
  'useImperativeHandle',
  'useSyncExternalStore',
]);

function serverHook(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Gate: only run on runtime files (skip codegen, rules, examples, barrels, tests)
  if (ctx.fileRole !== 'runtime') return findings;

  const fullText = ctx.sourceFile.getFullText();
  if (isClientComponent(fullText)) return findings;

  // Gate: if import graph says this file is within a client boundary, hooks are fine
  if (ctx.fileContext?.isClientBoundary) return findings;
  if (ctx.fileContext?.boundary === 'client') return findings;

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
    if (
      parent &&
      (parent.getKind() === SyntaxKind.TemplateExpression ||
        parent.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral ||
        parent.getKind() === SyntaxKind.TemplateSpan)
    )
      continue;

    const line = call.getStartLineNumber();
    findings.push(
      finding(
        'server-hook',
        'error',
        'bug',
        `'${hookName}' used in Server Component — add 'use client' directive or move to a Client Component`,
        ctx.filePath,
        line,
        1,
        { suggestion: "Add 'use client' at the top of the file" },
      ),
    );
  }

  return findings;
}

// ── Rule 22: hydration-mismatch ──────────────────────────────────────────
// Nondeterministic expressions (Date.now, Math.random, new Date) in render

function hydrationMismatch(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Gate: skip non-React files — backend code with Date.now()/Math.random() is fine
  if (!isReactFile(ctx)) return findings;

  // Gate: if import graph says this file is purely client-side, hydration mismatch
  // is less of a concern (no SSR). But still relevant for SSR'd client components.
  // Skip only for API routes and middleware — they never render.
  if (ctx.fileContext?.boundary === 'api' || ctx.fileContext?.boundary === 'middleware') return findings;

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
      if (fullText[i] === ')') {
        if (depth === 0) {
          rangeEnd = i;
          break;
        }
        depth--;
      }
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

      findings.push(
        finding(
          'hydration-mismatch',
          'warning',
          'bug',
          `${name} in render produces different values on server vs client — hydration mismatch`,
          ctx.filePath,
          line,
          1,
          { suggestion: `Move to useEffect or use a stable seed. For IDs, use React.useId()` },
        ),
      );
    }
  }

  return findings;
}

// ── Rule 23: missing-use-client ──────────────────────────────────────────
// Event handlers (onClick, onChange, etc.) without 'use client' directive
// Import-graph-aware: severity depends on who imports this file.

/** Find importers that are NOT within a client boundary (i.e. server components). */
function findServerImporters(ctx: RuleContext): string[] {
  const importedBy = ctx.fileContext?.importedBy || [];
  if (importedBy.length === 0) return [];

  const fileContextMap = ctx.config?.fileContextMap;
  const serverImporters: string[] = [];

  for (const imp of importedBy) {
    const impCtx = fileContextMap?.get(imp);
    if (impCtx) {
      // Use computed boundary — accounts for transitive 'use client' propagation
      if (!impCtx.isClientBoundary && !impCtx.hasUseClientDirective) {
        serverImporters.push(imp);
      }
    } else {
      // Fallback: read file directly (no graph entry for this importer)
      try {
        const content = readFileSync(imp, 'utf-8');
        if (!isClientComponent(content)) {
          serverImporters.push(imp);
        }
      } catch {
        /* unreadable — skip */
      }
    }
  }

  return serverImporters;
}

function missingUseClient(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Gate: skip non-React files — only JSX files can have event handler props
  if (!isReactFile(ctx)) return findings;

  // Gate: if import graph says this file is already within a client boundary,
  // it doesn't need its own 'use client' directive
  if (ctx.fileContext?.isClientBoundary) return findings;
  if (ctx.fileContext?.boundary === 'client') return findings;

  const fullText = ctx.sourceFile.getFullText();

  if (isClientComponent(fullText)) return findings;

  // ── Import-graph-aware severity ─────────────────────────────────────
  // error   → imported from a server component (will break at runtime)
  // warning → only client importers, or no import graph available
  // info    → file has no importers (dead code or entry point)
  let severity: 'error' | 'warning' | 'info' = 'warning';
  let category: 'bug' | 'pattern' = 'pattern';
  let serverImporterNames: string | undefined;

  if (ctx.fileContext) {
    const importedBy = ctx.fileContext.importedBy;
    const serverImporters = findServerImporters(ctx);

    if (serverImporters.length > 0) {
      severity = 'error';
      category = 'bug';
      serverImporterNames = serverImporters.map((p) => basename(p)).join(', ');
    } else if (importedBy.length > 0) {
      severity = 'warning';
    } else if (ctx.fileContext.depth === 0) {
      // Entry point (page.tsx, layout.tsx) — Next.js loads directly as server component
      severity = 'warning';
    } else {
      severity = 'info';
    }
  }
  // No fileContext → keep default 'warning' (single-file review fallback)

  const eventHandlers = [
    'onClick',
    'onChange',
    'onSubmit',
    'onKeyDown',
    'onKeyUp',
    'onMouseEnter',
    'onMouseLeave',
    'onFocus',
    'onBlur',
    'onInput',
    'onTouchStart',
    'onTouchEnd',
    'onScroll',
    'onDrag',
  ];

  const found = new Set<string>();

  for (const handler of eventHandlers) {
    const regex = new RegExp(`\\b${handler}=\\{`, 'g');
    let match;
    while ((match = regex.exec(fullText)) !== null) {
      if (found.has(handler)) continue;
      found.add(handler);
      const line = fullText.substring(0, match.index).split('\n').length;

      let message: string;
      if (severity === 'error') {
        message = `Missing 'use client' — uses ${handler} and is imported from server component (${serverImporterNames})`;
      } else if (ctx.fileContext && ctx.fileContext.importedBy.length > 0) {
        message = `Consider adding 'use client' — ${handler} used here, all importers are already client components`;
      } else if (ctx.fileContext && ctx.fileContext.depth === 0) {
        message = `'${handler}' in server entry point — needs 'use client' directive`;
      } else if (ctx.fileContext) {
        message = `Consider adding 'use client' — ${handler} used but file has no importers`;
      } else {
        message = `'${handler}' in Server Component — needs 'use client' directive`;
      }

      findings.push(
        finding('missing-use-client', severity, category, message, ctx.filePath, line, 1, {
          suggestion: "Add 'use client' at the top of the file, or extract to a Client Component",
          autofix: {
            type: 'insert-before',
            span: { file: ctx.filePath, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
            replacement: "'use client';\n\n",
            description: "Prepend 'use client' directive",
          },
        }),
      );
    }
  }

  return findings;
}

// ── Exported Next.js Rules ───────────────────────────────────────────────

export const nextjsRules = [serverHook, hydrationMismatch, missingUseClient];
