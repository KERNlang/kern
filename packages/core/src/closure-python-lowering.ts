import ts from 'typescript';
import {
  bindingPatternIdentifierNames,
  CLOSURE_ASSIGN_OPERATORS,
  parseClosureBlockAst,
} from './closure-eligibility.js';

export interface LowerJsClosureBodyToPythonOptions {
  lowerExpression(expr: string): string;
  lowerCondition?(expr: string): string;
  /** The closure's own parameter names. A bare-identifier write to a param (or
   *  to a block-LOCAL declared inside the closure) is a def-local plain
   *  assignment — it must NOT be reported as a written FREE name (no
   *  `nonlocal`). Omitted = the closure has no params. */
  paramNames?: string[];
  /** Resolve a bare-identifier WRITE TARGET to its emitted Python name. The
   *  class path passes `resolveLocalRename` so a write to a shadow-renamed
   *  capture targets the SAME renamed binding its reads resolve to (without
   *  this, `x = x + 10` against a shadowed capture wrote the OUTER binding
   *  while reads hit the renamed inner one — silent wrong values both ways,
   *  probe-verified). The route path has no renames — omitted = identity.
   *  `writtenFreeNames` still reports SOURCE names; the consumer resolves
   *  again when building its `nonlocal` line. */
  lowerAssignTarget?(name: string): string;
  /** BLOCK-SCOPE hooks (Slice 2 review fix, round 3). The lowerer FLATTENS
   *  nested blocks into one Python suite, so the consumer's per-expression
   *  guards (e.g. the host-`RegExp` value screen) lose the lexical block scope
   *  unless told the boundaries. `enterBlockScope` is called with a block's
   *  TOP-LEVEL let/const/function/class names just BEFORE its statements lower
   *  (JS hoists them for the whole block, so a reference anywhere inside —
   *  even lexically before the declarator — sees the block-local); the matching
   *  `exitBlockScope` is called after, with the SAME names. The consumer uses
   *  them to push/pop block-local shadows so a `RegExp` reference fails-close
   *  ONLY when no in-scope block-local/param shadows it — byte-aligned with the
   *  TS-AST closure walk.
   *
   *  REQUIRED (round-7 — was silently `?`-optional). An optional hook let a
   *  consumer omit the wire and the lowerer silently no-op the block-scope
   *  tracking → the Python leg would FAIL-OPEN on a destructured / nested-block
   *  `RegExp` shadow while the TS leg stayed closed, a one-target divergence the
   *  type system could not catch. Making both REQUIRED turns a missing wire into
   *  a COMPILE ERROR. A consumer that genuinely wants NO block-scope tracking
   *  (the route path, which screens host names through a different rewriter and
   *  has no per-block shadow stack) passes EXPLICIT no-op (identity) functions —
   *  an intentional opt-out that is visible at the call site, not an accident. */
  enterBlockScope(names: string[]): void;
  exitBlockScope(names: string[]): void;
}

export interface LowerJsClosureBodyToPythonResult {
  ok: boolean;
  lines: string[];
  reason?: string;
  /** The set of FREE identifier names this closure WRITES (bare-identifier
   *  assignments / `++` / `--` to a name that is neither a closure param nor a
   *  block-local declared inside the body). The CONSUMER decides what to do
   *  with them: the Python class/native emitter (`emitBlockClosurePy`) throws
   *  `closure-pinned-write` for any that are per-iteration loop captures and
   *  prepends a `nonlocal` line for the rest; the route hoist wrapper
   *  (`lowerArrowBlockClosure`) prepends `nonlocal` for ALL of them (route
   *  hoisted defs nest in the handler function, with no pinning concept).
   *  Member/index writes (`acc.x = …`) mutate a captured object by reference
   *  and never appear here — Python needs no `nonlocal` for them. Empty when
   *  `ok` is false. */
  writtenFreeNames: Set<string>;
}

function hasUnsupportedNestedConstruct(node: ts.Node): boolean {
  let unsupported = false;
  const visit = (child: ts.Node) => {
    if (
      ts.isArrowFunction(child) ||
      ts.isFunctionExpression(child) ||
      ts.isFunctionDeclaration(child) ||
      child.kind === ts.SyntaxKind.ThisKeyword ||
      child.kind === ts.SyntaxKind.YieldExpression ||
      // Defense-in-depth (agon review): the gate rejects `await` already, but
      // this safety net runs for ALL consumers — keep it in lockstep so a
      // future gate widening cannot silently emit invalid sync Python.
      ts.isAwaitExpression(child)
    ) {
      unsupported = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return unsupported;
}

export function lowerJsClosureBodyToPython(
  body: string,
  opts: LowerJsClosureBodyToPythonOptions,
): LowerJsClosureBodyToPythonResult {
  // Shared block parse — single source of truth with the v1 closure gate
  // (`closure-eligibility.ts`). The block carries its own SourceFile (created
  // with parent nodes), which we need for `expr.getText(sf)`.
  const block = parseClosureBlockAst(body);
  if (!block) return { ok: false, lines: [], reason: 'parse', writtenFreeNames: new Set() };
  const sf = block.getSourceFile();
  if (hasUnsupportedNestedConstruct(block))
    return { ok: false, lines: [], reason: 'unsupported-nested', writtenFreeNames: new Set() };

  const lowerExpr = (expr: ts.Expression): string => opts.lowerExpression(expr.getText(sf));
  const lowerCond = (expr: ts.Expression): string =>
    opts.lowerCondition ? opts.lowerCondition(expr.getText(sf)) : `js_truthy(${lowerExpr(expr)})`;

  // A bare-identifier write needs `nonlocal` (it is FREE) only when its name is
  // neither a closure PARAM nor a block-LOCAL declared inside the body. Collect
  // both up front so the assignment branches can classify each target. Mirrors
  // `collectLocalDeclaredNames` in the gate (identifier-named let/const only;
  // destructuring never reaches here — the gate rejects it).
  const paramNames = new Set(opts.paramNames ?? []);
  const declaredLocals = new Set<string>();
  {
    const collect = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declaredLocals.add(node.name.text);
      ts.forEachChild(node, collect);
    };
    ts.forEachChild(block, collect);
  }
  const writtenFreeNames = new Set<string>();
  const recordIfFree = (name: string): void => {
    if (!paramNames.has(name) && !declaredLocals.has(name)) writtenFreeNames.add(name);
  };
  // Bare write targets resolve through the consumer's rename machinery (see
  // the option doc). Params and block-locals are def-locals the consumer never
  // renames, so applying the resolver to ALL bare targets is safe — it is the
  // identity for them.
  const lowerTarget = opts.lowerAssignTarget ?? ((name: string) => name);

  // Python compound-assignment operator for an accepted JS assignment op. `=`
  // → plain assignment; the five compound forms map 1:1. Returns null for any
  // operator the gate does not accept (defensive — the gate already rejected
  // them, so this is gate/lowerer-drift insurance, not a runtime path).
  const pyAssignOp = (op: ts.SyntaxKind): string | null => {
    switch (op) {
      case ts.SyntaxKind.EqualsToken:
        return '=';
      case ts.SyntaxKind.PlusEqualsToken:
        return '+=';
      case ts.SyntaxKind.MinusEqualsToken:
        return '-=';
      case ts.SyntaxKind.AsteriskEqualsToken:
        return '*=';
      case ts.SyntaxKind.SlashEqualsToken:
        return '/=';
      case ts.SyntaxKind.PercentEqualsToken:
        return '%=';
      default:
        return null;
    }
  };

  // Lower an accepted assignment EXPRESSION (`x = rhs`, `acc.p += rhs`,
  // `a[i] = rhs`) used in statement position to a Python assignment STATEMENT.
  // Subexpressions (base / index / rhs) flow through `lowerExpression` exactly
  // like every other native-body expression, so a captured renamed outer
  // variable resolves through the same rename stack. Returns null on a shape
  // the gate should already have rejected (drift insurance → the caller turns
  // null into a loud reason).
  const emitAssignment = (expr: ts.BinaryExpression, indent: string): string[] | null => {
    if (!CLOSURE_ASSIGN_OPERATORS.has(expr.operatorToken.kind)) return null;
    const pyOp = pyAssignOp(expr.operatorToken.kind);
    if (pyOp === null) return null;
    const target = expr.left;
    const rhs = lowerExpr(expr.right);
    if (ts.isIdentifier(target)) {
      recordIfFree(target.text);
      return [`${indent}${lowerTarget(target.text)} ${pyOp} ${rhs}`];
    }
    if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
      // `this`-rooted targets are gate-rejected; a non-this member/index write
      // mutates a captured object by reference — emit the whole target through
      // `lowerExpression` (so `acc.total` / `acc[i]` lower identically to how
      // they read elsewhere) and append the compound operator.
      const lhs = lowerExpr(target);
      return [`${indent}${lhs} ${pyOp} ${rhs}`];
    }
    return null;
  };

  // Lower a statement-position `++`/`--` on a bare identifier to `name += 1` /
  // `name -= 1`. Value-position inc/dec and member targets are gate-rejected.
  const emitIncDec = (expr: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression, indent: string): string[] | null => {
    if (expr.operator !== ts.SyntaxKind.PlusPlusToken && expr.operator !== ts.SyntaxKind.MinusMinusToken) return null;
    const step = expr.operator === ts.SyntaxKind.PlusPlusToken ? '+=' : '-=';
    if (ts.isIdentifier(expr.operand)) {
      recordIfFree(expr.operand.text);
      return [`${indent}${lowerTarget(expr.operand.text)} ${step} 1`];
    }
    // Member/index inc/dec (`acc.n++`, `acc[0]--`) — the gate accepts these
    // (mutating a captured object by reference, like the assignment forms), so
    // the lowerer must too (agon review, kimi 0.9 + zai 0.9 gate/lowerer
    // drift). The whole target lowers through `lowerExpression` exactly like
    // member ASSIGNMENT targets; NO `recordIfFree` — by-reference mutation
    // needs no `nonlocal`.
    if (ts.isPropertyAccessExpression(expr.operand) || ts.isElementAccessExpression(expr.operand)) {
      return [`${indent}${lowerExpr(expr.operand)} ${step} 1`];
    }
    return null;
  };

  const emitStatement = (stmt: ts.Statement, indent: string): string[] | null => {
    if (ts.isVariableStatement(stmt)) {
      const flags = stmt.declarationList.flags;
      if ((flags & ts.NodeFlags.Let) === 0 && (flags & ts.NodeFlags.Const) === 0) return null;
      const lines: string[] = [];
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) return null;
        lines.push(`${indent}${decl.name.text} = ${lowerExpr(decl.initializer)}`);
      }
      return lines;
    }

    if (ts.isReturnStatement(stmt)) {
      return [`${indent}return ${stmt.expression ? lowerExpr(stmt.expression) : 'None'}`];
    }

    if (ts.isExpressionStatement(stmt)) {
      let inner: ts.Expression = stmt.expression;
      // Unwrap parens: `({ a } = x);`-style statement assignments carry
      // syntactically-required parens — the gate counts them as statement
      // position (same unwrap), so the lowerer must reach the assignment
      // through them too (gate/lowerer lockstep).
      while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
      // Mutation v1: an assignment / inc-dec in statement position lowers to a
      // Python assignment STATEMENT (NOT through `lowerExpression`, which has
      // no assignment grammar). These branches sit BEFORE the generic fallback
      // so a method call (`acc.push(x)`) — which is neither — still flows
      // through `lowerExpression` unchanged.
      if (ts.isBinaryExpression(inner) && CLOSURE_ASSIGN_OPERATORS.has(inner.operatorToken.kind)) {
        return emitAssignment(inner, indent);
      }
      if (
        (ts.isPrefixUnaryExpression(inner) || ts.isPostfixUnaryExpression(inner)) &&
        (inner.operator === ts.SyntaxKind.PlusPlusToken || inner.operator === ts.SyntaxKind.MinusMinusToken)
      ) {
        return emitIncDec(inner, indent);
      }
      return [`${indent}${lowerExpr(stmt.expression)}`];
    }

    if (ts.isIfStatement(stmt)) {
      const consequent = emitStatementBody(stmt.thenStatement, `${indent}    `);
      if (!consequent) return null;
      const lines = [`${indent}if ${lowerCond(stmt.expression)}:`, ...nonEmptyBody(consequent, `${indent}    `)];
      if (stmt.elseStatement) {
        const alternate = emitStatementBody(stmt.elseStatement, `${indent}    `);
        if (!alternate) return null;
        lines.push(`${indent}else:`, ...nonEmptyBody(alternate, `${indent}    `));
      }
      return lines;
    }

    if (ts.isTryStatement(stmt)) {
      if (stmt.finallyBlock || !stmt.catchClause) return null;
      const tryLines = emitBlock(stmt.tryBlock, `${indent}    `);
      if (!tryLines) return null;
      const catchLines = emitBlock(stmt.catchClause.block, `${indent}    `);
      if (!catchLines) return null;
      const catchName = stmt.catchClause.variableDeclaration?.name;
      if (catchName && !ts.isIdentifier(catchName)) return null;
      return [
        `${indent}try:`,
        ...nonEmptyBody(tryLines, `${indent}    `),
        catchName ? `${indent}except Exception as ${catchName.text}:` : `${indent}except Exception:`,
        ...nonEmptyBody(catchLines, `${indent}    `),
      ];
    }

    if (ts.isForOfStatement(stmt)) {
      if (stmt.awaitModifier) return null;
      let target: string | null = null;
      const initializer = stmt.initializer;
      if (ts.isVariableDeclarationList(initializer)) {
        if (initializer.declarations.length !== 1) return null;
        const decl = initializer.declarations[0];
        if (!ts.isIdentifier(decl.name) || decl.initializer) return null;
        target = decl.name.text;
      } else if (ts.isIdentifier(initializer)) {
        target = initializer.text;
      }
      if (!target) return null;
      const bodyLines = emitStatementBody(stmt.statement, `${indent}    `);
      if (!bodyLines) return null;
      return [`${indent}for ${target} in ${lowerExpr(stmt.expression)}:`, ...nonEmptyBody(bodyLines, `${indent}    `)];
    }

    return null;
  };

  const emitStatementBody = (stmt: ts.Statement, indent: string): string[] | null => {
    if (ts.isBlock(stmt)) return emitBlock(stmt, indent);
    return emitStatement(stmt, indent);
  };

  // The TOP-LEVEL let/const/function/class names of a block (its DIRECT
  // statement children only). JS block-scoping hoists these to the whole block,
  // so they are pushed as block-local shadows for the entire block body.
  const blockTopLevelDeclaredNames = (b: ts.Block): string[] => {
    const names: string[] = [];
    for (const stmt of b.statements) {
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          // Use the SAME binding-pattern extraction as the TS-AST closure walk
          // (`topLevelBlockDeclaredNames`/`bindingPatternIdentifierNames`) so a
          // DESTRUCTURED shadow (`const { RegExp } = x`, `const [RegExp] = arr`)
          // registers its bound names as block-locals on the Python leg too —
          // honoring the shadow symmetrically (the plain-`isIdentifier` check
          // missed destructured names, fail-OPENING on Python while TS shadowed).
          names.push(...bindingPatternIdentifierNames(decl.name));
        }
      } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        names.push(stmt.name.text);
      } else if (ts.isClassDeclaration(stmt) && stmt.name) {
        names.push(stmt.name.text);
      }
    }
    return names;
  };

  const emitBlock = (b: ts.Block, indent: string): string[] | null => {
    // Push this block's top-level locals as shadows BEFORE lowering its
    // statements (JS hoisting), pop after — so a `RegExp` reference inside a
    // nested block sees the nested local, while a reference OUTSIDE it does not.
    const scopeNames = blockTopLevelDeclaredNames(b);
    opts.enterBlockScope(scopeNames);
    try {
      const lines: string[] = [];
      for (const stmt of b.statements) {
        const emitted = emitStatement(stmt, indent);
        if (!emitted) return null;
        lines.push(...emitted);
      }
      return lines;
    } finally {
      opts.exitBlockScope(scopeNames);
    }
  };

  const nonEmptyBody = (lines: string[], indent: string): string[] => (lines.length > 0 ? lines : [`${indent}pass`]);

  const lines = emitBlock(block, '    ');
  if (!lines) return { ok: false, lines: [], reason: 'unsupported-statement', writtenFreeNames: new Set() };
  return { ok: true, lines, writtenFreeNames };
}
