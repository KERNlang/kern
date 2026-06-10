/** v1 closure gate — fail-closed eligibility predicate AND emission
 *  precondition for block-bodied arrow functions in native KERN bodies.
 *
 *  Architecture (council + tribunal decided, Option B′ "TS-AST-grounded raw
 *  body"): the lambda IR carries the raw block text (`bodyBlock.raw`) for
 *  verbatim TS re-emit ONLY. Every analyzer/consumer reads the TS AST obtained
 *  through `parseClosureBlockAst` here — never scans the string. The IR does
 *  NOT store the `ts.Block` (serialization safety); this helper recomputes it
 *  (cheap; memoized via a module-level `Map`).
 *
 *  The gate is the SINGLE owner of "is this block body supported" — used by:
 *   - the parser (parse-time validation, fail-closed)
 *   - the migrator eligibility classifier (`native-eligibility-ast.ts`)
 *   - the Python lowerer precondition (`codegen-body-python.ts`)
 *  so nothing eligible can fail to lower.
 *
 *  v1 is deliberately NARROWER than the lowering machinery
 *  (`lowerJsClosureBodyToPython` supports try/for-of; the gate rejects them).
 *  Widening the gate is a future slice. */

import ts from 'typescript';

/** Memoize parsed blocks. Keyed by the raw (trimmed) source. A `null` value is
 *  a cached "does not parse / not a single block" verdict. */
const blockCache = new Map<string, ts.Block | null>();

/** Parse a raw closure block (`{ ... }`, braces included) into a `ts.Block`,
 *  or `null` if it does not parse cleanly as a single function body block.
 *
 *  Generalized from the former `parseClosureBlock` in
 *  closure-python-lowering.ts (which now imports this). Route behavior is
 *  unchanged: the lowerer still validates the same way. */
export function parseClosureBlockAst(raw: string): ts.Block | null {
  const trimmed = raw.trim();
  if (blockCache.has(trimmed)) return blockCache.get(trimmed) ?? null;
  const result = parseClosureBlockUncached(trimmed);
  blockCache.set(trimmed, result);
  return result;
}

function parseClosureBlockUncached(trimmed: string): ts.Block | null {
  if (trimmed.length < 2 || trimmed[0] !== '{' || trimmed[trimmed.length - 1] !== '}') return null;
  const source = `function __kern_closure__() ${trimmed}`;
  const sf = ts.createSourceFile('__kern_closure__.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics;
  if (diags && diags.length > 0) return null;
  const fn = sf.statements[0];
  if (!fn || !ts.isFunctionDeclaration(fn) || !fn.body) return null;
  return fn.body;
}

/** Collect identifier names bound by `let`/`const` declarations directly inside
 *  the closure block (including inside nested if/else branches the gate
 *  accepts). Used to distinguish a free-variable write (rejected) from an
 *  assignment to a closure-local (allowed). v1 only admits identifier-named
 *  declarations, so destructured names never enter this set. */
function collectLocalDeclaredNames(block: ts.Block): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(block, visit);
  return names;
}

/** Root identifier of an assignment target (`acc`, `acc.x`, `acc[i]` → `acc`),
 *  or `null` if the target is not rooted at a plain identifier. */
function assignmentTargetRoot(target: ts.Expression): string | null {
  let current: ts.Expression = target;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : null;
}

/** True when `target` is itself a bare identifier (not a member/index). A bare
 *  identifier write rebinds the variable; a member/index write mutates an
 *  object the closure captured (allowed when the root is captured). */
function isBareIdentifierTarget(target: ts.Expression): boolean {
  return ts.isIdentifier(target);
}

/** v1 reject reason for an assignment/update TARGET inside a closure block.
 *  All assignment shapes reject in v1 (the class-path lowering has no
 *  assignment grammar — see the call-site comment); the reason distinguishes
 *  the semantically-wrong case (free-variable write) from the merely
 *  not-yet-supported ones. */
function classifyAssignTarget(target: ts.Expression, localNames: Set<string>): string {
  if (isBareIdentifierTarget(target)) {
    const root = assignmentTargetRoot(target);
    if (root !== null && !localNames.has(root)) return 'closure-free-var-assign';
    return 'closure-local-assign';
  }
  if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
    // A `this`-rooted target (`this.x = …`) is first and foremost a `this`
    // usage — surface the more precise reason the rest of the gate uses.
    let current: ts.Expression = target;
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = current.expression;
    }
    if (current.kind === ts.SyntaxKind.ThisKeyword) return 'closure-this';
    return 'closure-member-assign';
  }
  return 'closure-unsupported-assign-target';
}

/** Walk the whole block rejecting any v1-unsupported construct. Returns a
 *  distinct reject reason string, or `null` if no unsupported construct is
 *  found. Statement-level shape (only let/const/return/expr/if accepted) is
 *  checked separately by `classifyStatementShape`. */
function findUnsupportedConstruct(block: ts.Block): string | null {
  const localNames = collectLocalDeclaredNames(block);
  let reason: string | null = null;
  const visit = (node: ts.Node): void => {
    if (reason !== null) return;

    // Nested functions of any kind — closures cannot nest in v1.
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
      reason = 'closure-nested-function';
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      reason = 'closure-class';
      return;
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      reason = 'closure-this';
      return;
    }
    if (ts.isYieldExpression(node)) {
      reason = 'closure-yield';
      return;
    }
    if (ts.isAwaitExpression(node)) {
      reason = 'closure-await';
      return;
    }
    if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) {
      reason = 'closure-spread';
      return;
    }
    // Any loop.
    if (
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node)
    ) {
      reason = 'closure-loop';
      return;
    }
    if (ts.isThrowStatement(node)) {
      reason = 'closure-throw';
      return;
    }
    if (ts.isTryStatement(node)) {
      reason = 'closure-try';
      return;
    }
    if (ts.isSwitchStatement(node)) {
      reason = 'closure-switch';
      return;
    }
    if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) {
      reason = 'closure-break-continue';
      return;
    }
    if (ts.isLabeledStatement(node)) {
      reason = 'closure-labeled';
      return;
    }
    if (ts.isWithStatement(node)) {
      reason = 'closure-with';
      return;
    }

    // `var` declarations.
    if (ts.isVariableStatement(node)) {
      const flags = node.declarationList.flags;
      if ((flags & ts.NodeFlags.Let) === 0 && (flags & ts.NodeFlags.Const) === 0) {
        reason = 'closure-var';
        return;
      }
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) {
          reason = 'closure-destructure';
          return;
        }
        if (!decl.initializer) {
          reason = 'closure-uninitialized-decl';
          return;
        }
      }
    }

    // Parameter default values (params live on the closure itself, but the
    // gate is also called on nested constructs defensively; closures with
    // their own params are the only legal owner and have no defaults in v1).
    if (ts.isParameter(node) && node.initializer) {
      reason = 'closure-param-default';
      return;
    }

    // ASSIGNMENT EXPRESSIONS — all rejected in v1 (agon review, codex 0.94
    // gate/lowerer-drift finding). The class-path statement lowering routes
    // expression statements through KERN's `parseExpression`, which has no
    // assignment grammar (`=`/`+=`/`++` throw) — so ANY gate-approved
    // assignment would surface as an eligible-handler compile error, not
    // working code. Fail closed with a precise reason instead; a follow-up
    // "closure local mutation" slice lifts this by lowering assignments
    // structurally. `acc.push(x)` is a CALL on a captured object — fine and
    // the v1 mutation story.
    //  - bare free identifier (`count = …` where count is captured):
    //    'closure-free-var-assign' (would ALSO be semantically wrong without
    //    `nonlocal` — the most important reject).
    //  - bare local identifier: 'closure-local-assign' (lowerable in
    //    principle, unsupported v1).
    //  - member/index target (`acc.x = 1`): 'closure-member-assign'
    //    (semantically fine, unsupported by the v1 lowering).
    //  - anything else (destructuring `({a} = obj)`, parenthesized `(x) = 1`):
    //    'closure-unsupported-assign-target' (agy blocking finding — could
    //    smuggle a free write past the bare-identifier check).
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) {
        reason = classifyAssignTarget(node.left, localNames);
        return;
      }
    }
    if (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) {
      const op = node.operator;
      if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
        reason = classifyAssignTarget(node.operand, localNames);
        return;
      }
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(block, visit);
  return reason;
}

/** True when `stmt` is one of the v1-accepted statement shapes (let/const with
 *  identifier names + initializers, return, expression statement, if/else).
 *  Branch bodies may be blocks or single statements; this recurses into them. */
function isAcceptedStatementShape(stmt: ts.Statement): boolean {
  if (ts.isVariableStatement(stmt)) {
    const flags = stmt.declarationList.flags;
    if ((flags & ts.NodeFlags.Let) === 0 && (flags & ts.NodeFlags.Const) === 0) return false;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) return false;
    }
    return true;
  }
  if (ts.isReturnStatement(stmt)) return true;
  if (ts.isExpressionStatement(stmt)) return true;
  if (ts.isIfStatement(stmt)) {
    if (!isAcceptedBranch(stmt.thenStatement)) return false;
    if (stmt.elseStatement && !isAcceptedBranch(stmt.elseStatement)) return false;
    return true;
  }
  return false;
}

function isAcceptedBranch(node: ts.Statement): boolean {
  if (ts.isBlock(node)) return node.statements.every(isAcceptedStatementShape);
  return isAcceptedStatementShape(node);
}

/** Classify a closure block body. Returns `null` if the body is supported by
 *  the v1 gate, or a distinct reject-reason string otherwise.
 *
 *  ACCEPT set: `let`/`const` (identifier names + initializers, no
 *  destructuring), `return` (with or without expression), expression
 *  statements, `if`/`else` (block or single-statement branches, nesting fine).
 *
 *  REJECT (whole-block walk): `this`, nested arrow/function/class, `yield`,
 *  `await`, any loop, `throw`, `try`, `switch`, `break`/`continue`, `var`,
 *  parameter default values, spread, labeled statements, `with`, and any
 *  assignment (`=`/`+=`/`++`/`--`) to a free variable (one not declared inside
 *  the closure block). Member/index mutation on a captured object
 *  (`acc.push(x)`) is allowed. Any statement outside the accept set rejects. */
export function classifyClosureBlock(raw: string): null | string {
  const block = parseClosureBlockAst(raw);
  if (block === null) return 'closure-parse-error';

  // Whole-block walk for unsupported constructs (this/await/loops/…).
  const constructReason = findUnsupportedConstruct(block);
  if (constructReason !== null) return constructReason;

  // Statement-level shape: every top-level (and nested if/else branch)
  // statement must be in the accept set.
  for (const stmt of block.statements) {
    if (!isAcceptedStatementShape(stmt)) {
      return `closure-unsupported-stmt-${ts.SyntaxKind[stmt.kind]}`;
    }
  }
  return null;
}
