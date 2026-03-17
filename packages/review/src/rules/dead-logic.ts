/**
 * Dead logic rules — catches code that can't do what it claims.
 *
 * Covers: identical conditions, identical expressions, all-identical branches,
 * constant conditions, one-iteration loops, unused collections, empty collections,
 * redundant jumps.
 *
 * All AST-based. Always active. High signal, cheap to run.
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

// ── Helpers ──────────────────────────────────────────────────────────────

/** Normalize whitespace for structural comparison */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ── Rule D1: identical-conditions ────────────────────────────────────────
// if (a) ... else if (a) — same condition in if/else-if chain

function identicalConditions(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const ifStmt of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    const conditions: Array<{ text: string; line: number }> = [];
    let current: import('ts-morph').IfStatement | undefined = ifStmt;

    // Walk the if/else-if chain
    while (current) {
      const condText = normalize(current.getExpression().getText());
      const condLine = current.getStartLineNumber();

      // Check for duplicate
      const duplicate = conditions.find(c => c.text === condText);
      if (duplicate) {
        findings.push(finding('identical-conditions', 'error', 'bug',
          `Duplicate condition '${condText.substring(0, 60)}' — already checked at line ${duplicate.line}`,
          ctx.filePath, condLine,
          { relatedSpans: [span(ctx.filePath, duplicate.line)] }));
      }
      conditions.push({ text: condText, line: condLine });

      // Follow else-if chain
      const elseStmt = current.getElseStatement();
      current = elseStmt?.getKind() === SyntaxKind.IfStatement
        ? elseStmt as import('ts-morph').IfStatement
        : undefined;
    }
  }

  return findings;
}

// ── Rule D2: identical-expressions ───────────────────────────────────────
// a === a, x - x, x && x — both sides of binary operator are the same

const IDENTITY_OPERATORS = new Set([
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.MinusToken,
  SyntaxKind.SlashToken,
  SyntaxKind.PercentToken,
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.LessThanToken,
  SyntaxKind.LessThanEqualsToken,
  SyntaxKind.GreaterThanToken,
  SyntaxKind.GreaterThanEqualsToken,
]);

function identicalExpressions(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const binExpr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const op = binExpr.getOperatorToken().getKind();
    if (!IDENTITY_OPERATORS.has(op)) continue;

    const leftText = normalize(binExpr.getLeft().getText());
    const rightText = normalize(binExpr.getRight().getText());

    if (leftText === rightText && leftText.length > 0) {
      // Skip intentional patterns: NaN check (x !== x)
      if (op === SyntaxKind.ExclamationEqualsEqualsToken || op === SyntaxKind.ExclamationEqualsToken) {
        if (/^\w+$/.test(leftText)) continue; // x !== x is NaN check
      }

      // Skip simple literals like 0 - 0 in constant expressions
      if (/^[0-9]+$/.test(leftText)) continue;

      const opText = binExpr.getOperatorToken().getText();
      findings.push(finding('identical-expressions', 'error', 'bug',
        `Identical expressions on both sides of '${opText}': ${leftText.substring(0, 40)}`,
        ctx.filePath, binExpr.getStartLineNumber()));
    }
  }

  return findings;
}

// ── Rule D3: all-identical-branches ──────────────────────────────────────
// if (x) { A } else { A } — all branches do the same thing

function allIdenticalBranches(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const ifStmt of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    // Only check top-level if (not else-if in a chain we already processed)
    const parent = ifStmt.getParent();
    if (parent?.getKind() === SyntaxKind.IfStatement) continue;

    const branches: string[] = [];
    let current: import('ts-morph').IfStatement | undefined = ifStmt;
    let hasElse = false;

    while (current) {
      const thenBlock = current.getThenStatement();
      branches.push(normalize(thenBlock.getText()));

      const elseStmt = current.getElseStatement();
      if (!elseStmt) break;

      if (elseStmt.getKind() === SyntaxKind.IfStatement) {
        current = elseStmt as import('ts-morph').IfStatement;
      } else {
        // Final else
        branches.push(normalize(elseStmt.getText()));
        hasElse = true;
        current = undefined;
      }
    }

    // Need at least if + else to flag, and all branches must be identical
    if (!hasElse || branches.length < 2) continue;
    const allSame = branches.every(b => b === branches[0]);
    if (allSame) {
      findings.push(finding('all-identical-branches', 'error', 'bug',
        `All ${branches.length} branches have identical code — condition has no effect`,
        ctx.filePath, ifStmt.getStartLineNumber()));
    }
  }

  // Ternary: x ? A : A
  for (const ternary of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ConditionalExpression)) {
    const whenTrue = normalize(ternary.getWhenTrue().getText());
    const whenFalse = normalize(ternary.getWhenFalse().getText());
    if (whenTrue === whenFalse) {
      findings.push(finding('all-identical-branches', 'warning', 'bug',
        'Ternary has identical true/false expressions — condition has no effect',
        ctx.filePath, ternary.getStartLineNumber()));
    }
  }

  return findings;
}

// ── Rule D4: constant-condition ──────────────────────────────────────────
// if (true), if (false), while (false), x ? ... where x is literal

function constantCondition(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const ifStmt of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    const exprKind = ifStmt.getExpression().getKind();
    if (exprKind === SyntaxKind.TrueKeyword) {
      findings.push(finding('constant-condition', 'warning', 'bug',
        'Condition is always true — else branch is dead code',
        ctx.filePath, ifStmt.getStartLineNumber()));
    }
    if (exprKind === SyntaxKind.FalseKeyword) {
      findings.push(finding('constant-condition', 'error', 'bug',
        'Condition is always false — then branch is dead code',
        ctx.filePath, ifStmt.getStartLineNumber()));
    }
  }

  // while (false) — dead loop
  for (const whileStmt of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.WhileStatement)) {
    if (whileStmt.getExpression().getKind() === SyntaxKind.FalseKeyword) {
      findings.push(finding('constant-condition', 'error', 'bug',
        'while(false) — loop body is dead code',
        ctx.filePath, whileStmt.getStartLineNumber()));
    }
  }

  // Ternary with constant
  for (const ternary of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ConditionalExpression)) {
    const condKind = ternary.getCondition().getKind();
    if (condKind === SyntaxKind.TrueKeyword || condKind === SyntaxKind.FalseKeyword) {
      const branch = condKind === SyntaxKind.TrueKeyword ? 'false' : 'true';
      findings.push(finding('constant-condition', 'warning', 'bug',
        `Ternary condition is always ${condKind === SyntaxKind.TrueKeyword ? 'true' : 'false'} — ${branch} branch is dead`,
        ctx.filePath, ternary.getStartLineNumber()));
    }
  }

  return findings;
}

// ── Rule D5: one-iteration-loop ──────────────────────────────────────────
// Loop that always breaks/returns on first iteration

function oneIterationLoop(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  const loopKinds = [
    SyntaxKind.ForStatement,
    SyntaxKind.ForOfStatement,
    SyntaxKind.ForInStatement,
    SyntaxKind.WhileStatement,
    SyntaxKind.DoStatement,
  ];

  for (const kind of loopKinds) {
    for (const loop of ctx.sourceFile.getDescendantsOfKind(kind)) {
      // Get the loop body block
      let bodyBlock: import('ts-morph').Block | undefined;
      const body = (loop as { getStatement?: () => import('ts-morph').Node }).getStatement?.();
      if (body?.getKind() === SyntaxKind.Block) {
        bodyBlock = body as import('ts-morph').Block;
      }
      if (!bodyBlock) continue;

      const stmts = bodyBlock.getStatements();
      if (stmts.length === 0) continue;

      // Check if every path through the first level of statements exits the loop
      const lastStmt = stmts[stmts.length - 1];
      const lastKind = lastStmt.getKind();

      // Unconditional break/return/throw at end of body
      if (lastKind === SyntaxKind.BreakStatement ||
          lastKind === SyntaxKind.ReturnStatement ||
          lastKind === SyntaxKind.ThrowStatement) {
        // Make sure there's no continue before it (which would indicate real looping)
        const hasContinue = bodyBlock.getDescendantsOfKind(SyntaxKind.ContinueStatement).length > 0;
        if (!hasContinue) {
          findings.push(finding('one-iteration-loop', 'warning', 'bug',
            'Loop runs at most one iteration — unconditional exit at end of body',
            ctx.filePath, loop.getStartLineNumber(),
            { suggestion: 'If intentional, use an if statement instead of a loop' }));
        }
      }
    }
  }

  return findings;
}

// ── Rule D6: unused-collection ───────────────────────────────────────────
// Array/Map/Set populated but never read

function unusedCollection(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const writeOps = new Set(['push', 'add', 'set', 'unshift', 'splice', 'fill']);
  const readOps = new Set(['get', 'has', 'includes', 'indexOf', 'find', 'filter', 'map',
    'reduce', 'some', 'every', 'forEach', 'entries', 'values', 'keys', 'join',
    'flat', 'flatMap', 'slice', 'at', 'length', 'size']);

  // Find collection declarations: new Array/Map/Set or [] or new Map()
  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;
      const initText = init.getText();
      const isCollection = init.getKind() === SyntaxKind.ArrayLiteralExpression ||
        initText.startsWith('new Map') || initText.startsWith('new Set') ||
        initText.startsWith('new Array');
      if (!isCollection) continue;

      const varName = decl.getName();
      const declLine = stmt.getStartLineNumber();

      // Scan all references to this variable in the file
      let hasWrite = false;
      let hasRead = false;

      for (const ident of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
        if (ident.getText() !== varName) continue;
        if (ident.getStartLineNumber() === declLine) continue; // skip declaration

        const parent = ident.getParent();
        if (!parent) continue;

        if (parent.getKind() === SyntaxKind.PropertyAccessExpression) {
          const pa = parent as import('ts-morph').PropertyAccessExpression;
          if (pa.getExpression() === ident) {
            const method = pa.getName();
            if (writeOps.has(method)) hasWrite = true;
            if (readOps.has(method)) hasRead = true;
            // Spread, destructure, or iteration counts as read
          }
        } else {
          // Any other usage is a read (passed as arg, returned, spread, etc.)
          hasRead = true;
        }
      }

      if (hasWrite && !hasRead) {
        findings.push(finding('unused-collection', 'warning', 'bug',
          `Collection '${varName}' is populated but never read`,
          ctx.filePath, declLine));
      }
    }
  }

  return findings;
}

// ── Rule D7: empty-collection-access ─────────────────────────────────────
// Collection read but never populated

function emptyCollectionAccess(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const writeOps = new Set(['push', 'add', 'set', 'unshift', 'splice', 'fill']);

  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;

      // Only flag collections initialized as empty
      const initText = init.getText().trim();
      const isEmpty = initText === '[]' || initText === 'new Map()' ||
        initText === 'new Set()' || initText === 'new Array()';
      if (!isEmpty) continue;

      const varName = decl.getName();
      const declLine = stmt.getStartLineNumber();

      let hasWrite = false;
      let hasRead = false;

      for (const ident of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
        if (ident.getText() !== varName) continue;
        if (ident.getStartLineNumber() === declLine) continue;

        const parent = ident.getParent();
        if (!parent) continue;

        if (parent.getKind() === SyntaxKind.PropertyAccessExpression) {
          const pa = parent as import('ts-morph').PropertyAccessExpression;
          if (pa.getExpression() === ident) {
            if (writeOps.has(pa.getName())) hasWrite = true;
            else hasRead = true;
          }
        } else {
          // Could be assignment target or read — be conservative
          if (parent.getKind() === SyntaxKind.BinaryExpression) {
            const bin = parent as import('ts-morph').BinaryExpression;
            if (bin.getOperatorToken().getKind() === SyntaxKind.EqualsToken && bin.getLeft() === ident) {
              hasWrite = true;
              continue;
            }
          }
          hasRead = true;
        }
      }

      if (hasRead && !hasWrite) {
        findings.push(finding('empty-collection-access', 'warning', 'bug',
          `Collection '${varName}' is initialized empty and never populated — reads will always be empty`,
          ctx.filePath, declLine));
      }
    }
  }

  return findings;
}

// ── Rule D8: redundant-jump ──────────────────────────────────────────────
// return/continue at end of block where it's the natural flow

function redundantJump(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Redundant continue at end of loop body
  const loopKinds = [
    SyntaxKind.ForStatement,
    SyntaxKind.ForOfStatement,
    SyntaxKind.ForInStatement,
    SyntaxKind.WhileStatement,
  ];

  for (const kind of loopKinds) {
    for (const loop of ctx.sourceFile.getDescendantsOfKind(kind)) {
      const body = (loop as { getStatement?: () => import('ts-morph').Node }).getStatement?.();
      if (body?.getKind() !== SyntaxKind.Block) continue;
      const block = body as import('ts-morph').Block;
      const stmts = block.getStatements();
      if (stmts.length === 0) continue;

      const last = stmts[stmts.length - 1];
      if (last.getKind() === SyntaxKind.ContinueStatement) {
        const contStmt = last as import('ts-morph').ContinueStatement;
        // Only flag unlabeled continue
        if (!contStmt.getLabel()) {
          findings.push(finding('redundant-jump', 'info', 'style',
            'Redundant continue at end of loop body',
            ctx.filePath, last.getStartLineNumber(),
            { suggestion: 'Remove — loop naturally continues at end of body' }));
        }
      }
    }
  }

  // Redundant return at end of void function
  for (const fn of ctx.sourceFile.getFunctions()) {
    const body = fn.getBody();
    if (!body || body.getKind() !== SyntaxKind.Block) continue;
    const block = body as import('ts-morph').Block;
    const stmts = block.getStatements();
    if (stmts.length === 0) continue;

    const last = stmts[stmts.length - 1];
    if (last.getKind() === SyntaxKind.ReturnStatement) {
      const retStmt = last as import('ts-morph').ReturnStatement;
      // Only flag bare return (no value)
      if (!retStmt.getExpression()) {
        findings.push(finding('redundant-jump', 'info', 'style',
          'Redundant return at end of function',
          ctx.filePath, last.getStartLineNumber(),
          { suggestion: 'Remove — function returns void naturally' }));
        }
    }
  }

  return findings;
}

// ── Exported Dead Logic Rules ────────────────────────────────────────────

export const deadLogicRules = [
  identicalConditions,
  identicalExpressions,
  allIdenticalBranches,
  constantCondition,
  oneIterationLoop,
  unusedCollection,
  emptyCollectionAccess,
  redundantJump,
];
