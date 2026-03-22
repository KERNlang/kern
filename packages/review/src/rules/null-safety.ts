/**
 * Null-safety rules — detect unchecked nullable values.
 *
 * Uses ts-morph type checker to find:
 * - .find() results used without null check
 * - Optional chaining immediately followed by non-null assertion
 * - Nullable function returns used without guard
 */

import { SyntaxKind, Node } from 'ts-morph';
import type { ReviewFinding, RuleContext, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';

function span(file: string, line: number, col = 1): SourceSpan {
  return { file, startLine: line, startCol: col, endLine: line, endCol: col };
}

function finding(
  ruleId: string,
  severity: 'error' | 'warning',
  message: string,
  file: string,
  line: number,
  col = 1,
  extra?: Partial<ReviewFinding>,
): ReviewFinding {
  return {
    source: 'kern',
    ruleId,
    severity,
    category: 'bug',
    message,
    primarySpan: span(file, line, col),
    fingerprint: createFingerprint(ruleId, line, col),
    ...extra,
  };
}

// ── Rule 1: unchecked-find ───────────────────────────────────────────────
// .find() returns T | undefined — using result without null check is a bug.

const NULLABLE_METHODS = new Set(['find', 'querySelector', 'getElementById', 'get']);

function uncheckedFind(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const sf = ctx.sourceFile;

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;

    const methodName = expr.getName();
    if (!NULLABLE_METHODS.has(methodName)) continue;

    const parent = call.getParent();
    if (!parent) continue;

    // If assigned to a variable, check if the variable is guarded before use
    if (Node.isVariableDeclaration(parent)) {
      const varName = parent.getName();
      const block = parent.getFirstAncestorByKind(SyntaxKind.Block);
      const container = block || sf;

      const line = call.getStartLineNumber();
      const statementsAfter = container.getStatements().filter(s => s.getStartLineNumber() > line);

      let guarded = false;
      for (const stmt of statementsAfter) {
        const text = stmt.getText();
        // Check for null guards: if (x), if (x != null), if (!x), x?, x ? (ternary)
        if (text.includes(`if (${varName}`) || text.includes(`if (!${varName}`) ||
            text.includes(`${varName} != null`) || text.includes(`${varName} !== null`) ||
            text.includes(`${varName} !== undefined`) || text.includes(`${varName} != undefined`) ||
            text.includes(`${varName}?`) || text.includes(`${varName} ?`)) {
          guarded = true;
          break;
        }
        // Used before guard — flag it
        if (text.includes(`${varName}.`) && !text.includes(`${varName}?.`)) {
          findings.push(finding(
            'unchecked-find',
            'warning',
            `Result of .${methodName}() used without null check. '${varName}' may be undefined.`,
            ctx.filePath,
            stmt.getStartLineNumber(),
            1,
            { suggestion: `Add a null check before accessing '${varName}', or use optional chaining (${varName}?.property).` },
          ));
          guarded = true; // Don't flag subsequent uses
          break;
        }
      }

      // Direct property access on the call result: arr.find(...)!.x or arr.find(...).x
      continue;
    }

    // Direct property access on .find() result: arr.find(x => x.id === id).name
    if (Node.isPropertyAccessExpression(parent)) {
      // Check for non-null assertion: arr.find(...)!.x — that's intentional
      if (Node.isNonNullExpression(parent.getParent()!)) continue;
      // Check for optional chaining: arr.find(...)?.x — that's safe
      if (parent.hasQuestionDotToken()) continue;

      findings.push(finding(
        'unchecked-find',
        'warning',
        `Direct property access on .${methodName}() result without null check. May throw at runtime.`,
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        { suggestion: `Use optional chaining: .${methodName}(...)?.property, or add a null guard.` },
      ));
    }
  }

  return findings;
}

// ── Rule 2: optional-chain-bang ──────────────────────────────────────────
// x?.foo! — optional chaining immediately negated by non-null assertion

function optionalChainBang(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const sf = ctx.sourceFile;

  for (const nonNull of sf.getDescendantsOfKind(SyntaxKind.NonNullExpression)) {
    const inner = nonNull.getExpression();
    // Check if the inner expression contains optional chaining
    const text = inner.getText();
    if (text.includes('?.')) {
      findings.push(finding(
        'optional-chain-bang',
        'warning',
        `Optional chain with non-null assertion (?.…!) — the ?. admits null but ! forces it away. Pick one.`,
        ctx.filePath,
        nonNull.getStartLineNumber(),
        1,
        { suggestion: 'Either remove the ?. (you trust it exists) or remove the ! (handle the null case).' },
      ));
    }
  }

  return findings;
}

// ── Rule 3: unchecked-cast ──────────────────────────────────────────────
// `as T` on a value that could be null/undefined — hides runtime errors

function uncheckedAssertion(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const sf = ctx.sourceFile;

  for (const asExpr of sf.getDescendantsOfKind(SyntaxKind.AsExpression)) {
    const inner = asExpr.getExpression();

    // Only flag when the inner expression is a call to a method known to return nullable
    if (!Node.isCallExpression(inner)) continue;
    const callExpr = inner.getExpression();
    if (!Node.isPropertyAccessExpression(callExpr)) continue;

    const methodName = callExpr.getName();
    if (!NULLABLE_METHODS.has(methodName)) continue;

    const targetType = asExpr.getTypeNode()?.getText() || '';
    // Skip if casting to a union that includes null/undefined
    if (targetType.includes('null') || targetType.includes('undefined')) continue;

    findings.push(finding(
      'unchecked-cast',
      'warning',
      `Casting .${methodName}() result 'as ${targetType}' hides potential null/undefined. Validate first.`,
      ctx.filePath,
      asExpr.getStartLineNumber(),
      1,
      { suggestion: `Check for null before casting, or use a type guard.` },
    ));
  }

  return findings;
}

export const nullSafetyRules = [uncheckedFind, optionalChainBang, uncheckedAssertion];
