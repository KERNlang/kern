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
 *  ── Mutation v1 (the closure-mutation slice) ───────────────────────────────
 *  The gate now ACCEPTS in statement position:
 *   (a) assignments to bare identifiers — block-LOCAL or FREE alike. The gate
 *       is a SHAPE classifier: it sees only the block (params live on the arrow
 *       and are stripped before the block is parsed), so it CANNOT tell a free
 *       capture from a closure param. Both are accepted here; the Python
 *       EMITTER (`emitBlockClosurePy`) decides pinned-vs-`nonlocal` using the
 *       enclosing loop context it alone can see, and the LOWERER excludes
 *       params from the written-free set (so a param write stays a plain local
 *       assignment, never `nonlocal`). The compound forms `+=,-=,*=,/=,%=` are
 *       accepted; statement-position `++`/`--` lower to `+= 1`/`-= 1`.
 *   (b) member/index writes on any non-`this` base (`acc.total = 1`,
 *       `acc[i] = v`, compound forms) — by-reference parity, no `nonlocal`.
 *  It KEEPS REJECTING, with precise reasons:
 *   - `this`-rooted targets → `closure-this` (unchanged).
 *   - destructuring / parenthesized targets → `closure-unsupported-assign-target`.
 *   - assignment operators outside {=,+=,-=,*=,/=,%=} (e.g. `&=`, `|=`, `<<=`)
 *     → `closure-unsupported-operator`.
 *   - value-position `++`/`--` (operand of a larger expression, e.g.
 *     `arr.push(x++)`) → `closure-incdec-value-position`.
 *  The eligibility≢lowerability gap for PINNED captures (a free write to a
 *  per-iteration loop binding) is intentional and surfaces as a LOUD compile
 *  error at emission (`closure-pinned-write`), not here: the single-statement
 *  gate cannot see the enclosing loop header.
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

export interface ClosureBlockMemberAccess {
  root: string;
  member: string;
  locallyShadowed: boolean;
}

export function collectClosureBlockLocalBindingNames(raw: string): Set<string> {
  const block = parseClosureBlockAst(raw);
  return block === null ? new Set<string>() : collectLocalDeclaredNames(block);
}

export function collectClosureBlockMemberAccesses(raw: string): ClosureBlockMemberAccess[] {
  const block = parseClosureBlockAst(raw);
  if (block === null) return [];
  const accesses: ClosureBlockMemberAccess[] = [];
  const scopes: Array<Set<string>> = [new Set()];

  const isLocal = (name: string): boolean => scopes.some((scope) => scope.has(name));
  const declareLocal = (name: string): void => {
    scopes[scopes.length - 1].add(name);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isBlock(node)) {
      const isRootBlock = node === block;
      if (!isRootBlock) scopes.push(new Set());
      for (const statement of node.statements) visit(statement);
      if (!isRootBlock) scopes.pop();
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      if (node.initializer) visit(node.initializer);
      if (ts.isIdentifier(node.name)) declareLocal(node.name.text);
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const root = leftmostIdentifierName(node.expression);
      if (root) accesses.push({ root, member: propertyAccessMemberLabel(node), locallyShadowed: isLocal(root) });
    } else if (ts.isElementAccessExpression(node)) {
      const root = leftmostIdentifierName(node.expression);
      if (root) accesses.push({ root, member: elementAccessMemberLabel(node.argumentExpression), locallyShadowed: isLocal(root) });
    } else if (ts.isNewExpression(node)) {
      const root = leftmostIdentifierName(node.expression);
      if (root) accesses.push({ root, member: 'constructor', locallyShadowed: isLocal(root) });
    }
    ts.forEachChild(node, visit);
  };

  visit(block);
  return accesses;
}

function leftmostIdentifierName(node: ts.Expression): string | null {
  let current: ts.Expression = node;
  while (true) {
    if (ts.isIdentifier(current)) return current.text;
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    return null;
  }
}

function propertyAccessMemberLabel(node: ts.PropertyAccessExpression): string {
  const parts: string[] = [node.name.text];
  let current: ts.Expression = node.expression;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  return parts.join('.');
}

function elementAccessMemberLabel(argument: ts.Expression | undefined): string {
  return argument && ts.isStringLiteralLike(argument) ? argument.text : '[computed]';
}

/** Collect the set of free identifier NAMES referenced in a closure block —
 *  identifiers used in the block that are NOT declared inside the block and
 *  NOT in `paramNames` (the closure's own parameters). These are exactly the
 *  names the closure CAPTURES from its enclosing scope.
 *
 *  Slice-2 loop-variable pinning consumes this: a captured name whose binding
 *  resolves at-or-inside the enclosing loop body must be pinned via a Python
 *  default arg, so each closure sees its own iteration's value (JS per-iteration
 *  capture) instead of late-binding to the last value.
 *
 *  Uses the TS AST (via `parseClosureBlockAst`) — never string scanning.
 *  Excludes, per the spec:
 *   - the `.name` side of a member access (`a.b` references only `a`),
 *   - object-literal property keys (`{ a: 1 }` — `a` is a key, not a ref),
 *   - declaration names themselves (`const x = …` — `x` is the bound name),
 *   - shorthand-property assignment names are NOT excluded: `{ a }` reads `a`,
 *     so the shorthand identifier IS a real reference and stays in the set.
 *
 *  A name both declared-inside and referenced (a block-local, or a shadowing
 *  re-declaration) is NOT free — `collectLocalDeclaredNames` removes it. The
 *  block is parsed once (memoized); a parse failure yields an empty set (the
 *  gate already rejected such bodies, so this is defensive). */
export function collectFreeIdentifierNames(raw: string, paramNames: string[]): Set<string> {
  const block = parseClosureBlockAst(raw);
  if (block === null) return new Set<string>();
  const declared = collectLocalDeclaredNames(block);
  const params = new Set(paramNames);
  const free = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      // `a.b` — only `a` is a reference; skip the `.b` name side.
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === node) return;
      // `a?.b` qualified-name / similar — defensive (PropertyAccess covers the
      // common case; QualifiedName appears only in type positions, which the
      // gate rejects, but skip the right-hand name there too for safety).
      if (parent && ts.isQualifiedName(parent) && parent.right === node) return;
      // Object-literal property KEY (`{ a: 1 }`) — `a` is a key, not a ref.
      // Shorthand (`{ a }`) is a ShorthandPropertyAssignment whose `.name` IS
      // a real read of `a`, so it is NOT excluded here.
      if (parent && ts.isPropertyAssignment(parent) && parent.name === node) return;
      // Declaration name (`const x = …`, `let x`, a binding-element name).
      if (parent && ts.isVariableDeclaration(parent) && parent.name === node) return;
      if (parent && ts.isBindingElement(parent) && parent.name === node) return;
      // A binding element's property name (`const { p: local } = o` — `p`).
      if (parent && ts.isBindingElement(parent) && parent.propertyName === node) return;
      const name = node.text;
      if (declared.has(name) || params.has(name)) return;
      free.add(name);
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(block, visit);
  return free;
}

/** True when `target` is itself a bare identifier (not a member/index). A bare
 *  identifier write rebinds the variable; a member/index write mutates an
 *  object the closure captured. Both are accepted under mutation-v1. */
function isBareIdentifierTarget(target: ts.Expression): boolean {
  return ts.isIdentifier(target);
}

/** The assignment operators the mutation-v1 gate accepts (mirrored by the
 *  Python lowerer, which emits the same compound operator directly). Anything
 *  else (`&=`, `|=`, `^=`, `<<=`, `>>=`, `>>>=`, `**=`, `&&=`, `||=`, `??=`)
 *  rejects with `closure-unsupported-operator`. The lowerer SHARES this set so
 *  the gate and the emitter never drift. */
export const CLOSURE_ASSIGN_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
]);

/** Classify an assignment/update TARGET inside a closure block. Returns `null`
 *  when the target SHAPE is accepted (bare identifier — local or free; or a
 *  non-`this` member/index write), or a precise reject reason otherwise.
 *
 *  The gate is a shape classifier and cannot distinguish a free capture from a
 *  closure param (params are stripped before the block is parsed). Both bare
 *  cases accept here; `nonlocal`-vs-pinned-vs-local is the Python emitter's
 *  decision (see the header doc + `emitBlockClosurePy`). */
function classifyAssignTarget(target: ts.Expression): string | null {
  if (isBareIdentifierTarget(target)) {
    // Bare identifier — local OR free, both accepted. The lowerer/emitter
    // decide whether a `nonlocal` declaration is needed.
    return null;
  }
  if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
    // A `this`-rooted target (`this.x = …`) is first and foremost a `this`
    // usage — surface the more precise reason the rest of the gate uses.
    let current: ts.Expression = target;
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = current.expression;
    }
    if (current.kind === ts.SyntaxKind.ThisKeyword) return 'closure-this';
    // Member/index write on a non-`this` base — by-reference mutation, accepted.
    return null;
  }
  // Destructuring (`({a} = x)`, `[a] = x`) or parenthesized (`(a) = x`) target —
  // could smuggle a free write past the bare-identifier check. Fail closed.
  return 'closure-unsupported-assign-target';
}

/** Walk the whole block rejecting any v1-unsupported construct. Returns a
 *  distinct reject reason string, or `null` if no unsupported construct is
 *  found. Statement-level shape (only let/const/return/expr/if accepted) is
 *  checked separately by `classifyStatementShape`. */
function findUnsupportedConstruct(block: ts.Block): string | null {
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

    // ASSIGNMENT EXPRESSIONS — mutation v1 lowers them structurally (the
    // Python lowerer emits assignment STATEMENTS from this AST; the TS target
    // re-emits the raw block verbatim). The gate validates only the TARGET
    // SHAPE and the OPERATOR:
    //  - bare identifier (local or free): accepted (the emitter decides
    //    pinned-vs-`nonlocal`-vs-local). `acc.push(x)` is a CALL on a captured
    //    object — also accepted, the original v1 mutation story.
    //  - member/index target on a non-`this` base (`acc.x = 1`, `acc[i] = v`):
    //    accepted — by-reference mutation, no `nonlocal`.
    //  - `this`-rooted target (`this.x = …`): 'closure-this'.
    //  - destructuring (`({a} = obj)`) / parenthesized (`(x) = 1`) target:
    //    'closure-unsupported-assign-target' (could smuggle a free write past
    //    the bare-identifier check — fail closed).
    //  - assignment operator outside {=,+=,-=,*=,/=,%=}: 'closure-unsupported-
    //    operator'.
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) {
        // STATEMENT position only — mirror the ++/-- guard (agon review,
        // claude 0.85): a value-position assignment (`arr.push(x = 5)`,
        // `const y = (x = 5)`, `return (x = 5)`, chained `x = (y = 2)`)
        // passes shape checks but the lowerer can only emit an assignment
        // that is the direct expression of an ExpressionStatement — anything
        // else routes through the expression callback, which has no
        // assignment grammar. Reject here so eligible ≡ lowerable holds.
        // Paren-wrapped statement assignments (`({ a } = x);` — JS REQUIRES
        // the parens there) count as statement position: walk up through
        // parens so the precise TARGET reason (e.g. destructuring) survives.
        let posParent: ts.Node | undefined = node.parent;
        while (posParent && ts.isParenthesizedExpression(posParent)) posParent = posParent.parent;
        if (!posParent || !ts.isExpressionStatement(posParent)) {
          reason = 'closure-assign-value-position';
          return;
        }
        if (!CLOSURE_ASSIGN_OPERATORS.has(op)) {
          reason = 'closure-unsupported-operator';
          return;
        }
        const targetReason = classifyAssignTarget(node.left);
        if (targetReason !== null) {
          reason = targetReason;
          return;
        }
        // Accepted assignment — keep walking its subexpressions (the RHS may
        // contain an unsupported construct, e.g. a nested arrow or `this`).
        ts.forEachChild(node, visit);
        return;
      }
    }
    if (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) {
      const op = node.operator;
      if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
        // `++`/`--` is only a statement-position mutation when its IMMEDIATE
        // parent is an ExpressionStatement (`x++;`). In any other position
        // (`arr.push(x++)`, `f(--x)`, `a = x++`) it is a value-producing
        // sub-expression v1 does not lower — reject with the actionable reason.
        if (!node.parent || !ts.isExpressionStatement(node.parent)) {
          reason = 'closure-incdec-value-position';
          return;
        }
        const targetReason = classifyAssignTarget(node.operand);
        if (targetReason !== null) {
          reason = targetReason;
          return;
        }
        ts.forEachChild(node, visit);
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
 *  Statement-position MUTATIONS are now accepted: assignments to a bare
 *  identifier (local OR free) and to a non-`this` member/index target, with the
 *  operators {=,+=,-=,*=,/=,%=}, plus statement-position `++`/`--`.
 *
 *  REJECT (whole-block walk): `this` (incl. a `this`-rooted assign target →
 *  `closure-this`), nested arrow/function/class, `yield`, `await`, any loop,
 *  `throw`, `try`, `switch`, `break`/`continue`, `var`, parameter default
 *  values, spread, labeled statements, `with`; a destructuring/parenthesized
 *  assign target (`closure-unsupported-assign-target`); an assignment operator
 *  outside the accepted set (`closure-unsupported-operator`); and a
 *  value-position `++`/`--` (`closure-incdec-value-position`). Member/index
 *  mutation and method calls on a captured object (`acc.push(x)`) are allowed.
 *  Any statement outside the accept set rejects. NOTE: a free write to a
 *  PINNED per-iteration loop capture passes the gate but is rejected LOUDLY at
 *  Python emission (`closure-pinned-write`) — the single-statement gate cannot
 *  see the enclosing loop header (eligibility≢lowerability, by design). */
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
