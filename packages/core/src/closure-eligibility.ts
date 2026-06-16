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
import { classifyRegexLiteralAccessFailClose, REGEX_HOST_REGEXP_FAILCLOSE } from './codegen/regex-normalize.js';

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

export interface LegacyParamSignature {
  /** Simple identifier binding name, or `null` for destructuring / non-identifier
   *  patterns (which contribute no single legacy-param name — structured bindings
   *  flow through the `param` child path instead). */
  name: string | null;
  /** Default-value expression text (`param.initializer`), or `null` when absent. */
  default: string | null;
}

/** BLOCKER 2 + IMPORTANT 3 — parse a legacy `params="..."` string with the REAL
 *  TypeScript parser and return one entry per parameter. Owns the
 *  `ts.createSourceFile` call (this module already statically imports
 *  `typescript`) so `host-namespace-ir.ts` need not — that keeps the core
 *  barrel's `typescript`-importer pin at 5 (browser-spine-import-graph.test.ts).
 *
 *  Wrapping the raw list in `function _(<params>){}` and reading each
 *  `ParameterDeclaration` auto-handles every case a hand-rolled char-scanner
 *  mis-split: `==`/`===`/`<=`/`>=` inside a default, regex literals with commas,
 *  nested generics, template literals.
 *
 *  Fails CLOSED on malformed input: if `source.parseDiagnostics` is non-empty
 *  (e.g. `params="process = ("`), returns `null` instead of producing phantom
 *  recovery-AST bindings — so a caller never treats a host root (`process`) as
 *  shadowed by a binding the user never actually wrote. A successful-but-empty
 *  parse (no params) returns `[]`. */
export function parseLegacyParamSignature(raw: string): LegacyParamSignature[] | null {
  const sf = ts.createSourceFile('__kern_legacy_params__.ts', `function _(${raw}){}`, ts.ScriptTarget.Latest, true);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics;
  if (diags && diags.length > 0) return null;
  const fn = sf.statements[0];
  if (!fn || !ts.isFunctionDeclaration(fn)) return null;
  return fn.parameters.map((param) => {
    const defaultText = param.initializer ? param.initializer.getText(sf).trim() : '';
    return {
      name: ts.isIdentifier(param.name) ? param.name.text : null,
      default: defaultText.length > 0 ? defaultText : null,
    };
  });
}

/** Collect identifier names bound by `let`/`const` declarations directly inside
 *  the closure block (including inside nested if/else branches the gate
 *  accepts). Used to distinguish a free-variable write (rejected) from an
 *  assignment to a closure-local (allowed). Binding patterns contribute every
 *  identifier they declare. */
function collectLocalDeclaredNames(block: ts.Block): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      for (const name of bindingPatternIdentifierNames(node.name)) names.add(name);
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
  const scopes: Array<Set<string>> = [];

  const isLocal = (name: string): boolean => scopes.some((scope) => scope.has(name));

  const visit = (node: ts.Node): void => {
    if (ts.isBlock(node)) {
      // Round-6 fix — REAL JS block scope: a block-scoped name shadows its WHOLE
      // block, including any initializer that lexically PRECEDES the declarator
      // (TDZ aside). PREDECLARE this block's top-level let/const/function/class
      // names BEFORE visiting its statements, so `{ let x = process.cwd(); const
      // process = fake; }` treats `process` in `x`'s initializer as the block-local
      // (`locallyShadowed: true`). Previously the `VariableDeclaration` case
      // declared the name only AFTER visiting its initializer, so the access in a
      // PRIOR initializer was seen as the host root — TS REJECTED while the Python
      // lowerer (which predeclares via `enterBlockScope`) ACCEPTED → a fresh
      // TS↔Python divergence for non-RegExp host roots. This matches the regex
      // walk's `collectClosureBlockRegexHostViolations` predeclaration exactly.
      scopes.push(new Set(topLevelBlockDeclaredNames(node.statements)));
      for (const statement of node.statements) visit(statement);
      scopes.pop();
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      // Names are predeclared on block entry (above); only the initializer needs a
      // visit. The declarator name itself is not a member/call/new access.
      if (node.initializer) visit(node.initializer);
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const root = leftmostIdentifierName(node.expression);
      if (root) accesses.push({ root, member: propertyAccessMemberLabel(node), locallyShadowed: isLocal(root) });
    } else if (ts.isElementAccessExpression(node)) {
      const root = leftmostIdentifierName(node.expression);
      if (root)
        accesses.push({
          root,
          member: elementAccessMemberLabel(node.argumentExpression),
          locallyShadowed: isLocal(root),
        });
    } else if (ts.isNewExpression(node)) {
      const root = leftmostIdentifierName(node.expression);
      if (root) accesses.push({ root, member: 'constructor', locallyShadowed: isLocal(root) });
    } else if (ts.isCallExpression(node)) {
      // GAP 2 — the callee may be wrapped in paren/as/satisfies/non-null/legacy
      // type-assert forms, or be the right operand of a comma (sequence)
      // expression — e.g. `(Math as any)()`, `(0, process)()`. NORMALIZE the
      // callee to its underlying identifier so the host-namespace root is still
      // detected (escalate-safe: an unwrapped non-identifier callee records
      // nothing, exactly as the prior bare-identifier guard did).
      const callee = unwrapCallCalleeExpression(node.expression);
      if (ts.isIdentifier(callee)) {
        accesses.push({ root: callee.text, member: 'call', locallyShadowed: isLocal(callee.text) });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(block);
  return accesses;
}

/** Slice 2 review fix (round 3) — a regex-host violation found INSIDE a
 *  block-bodied arrow. Carries the EXACT fail-close `message` the EXPRESSION-level
 *  path would emit, so the TS-verbatim block leg agrees with that path (and with
 *  the Python leg, which lowers the body through the IR) BY CONSTRUCTION rather
 *  than re-deriving the truth table:
 *   - `bareRegexp` — a bare VALUE reference to `RegExp` (`return RegExp`,
 *     `const R = RegExp`, `{ x: RegExp }`, `({ RegExp })`, `[RegExp]`, a ternary
 *     branch, an argument). The generic member scan never sees these (no
 *     identifier-rooted `Root.member`), so they slip the verbatim TS leg. The
 *     MEMBER-OBJECT position (`RegExp.prototype`, `RegExp[$1]`) is deliberately
 *     EXCLUDED — the generic scan owns it and emits the GENERIC host-namespace
 *     message there (matching the expression-level member-receiver screen).
 *     `message` is always `REGEX_HOST_REGEXP_FAILCLOSE`. `locallyShadowed`
 *     reports a block-scope re-declaration so the caller can also honor an outer
 *     user binding.
 *   - `regexLiteralAccess` — a property/element access on a regex LITERAL
 *     (`/x/.source`, `/x/["flags"]`, `/x/.test(s)`, `/x/.exec(s)`,
 *     `/x/.compile(y)`). The receiver is a literal (never user-bindable), so it
 *     never honors a binding (`locallyShadowed` is always false). `message` is
 *     the shared classifier's verdict: `null` when the access is PORTABLE
 *     (`/x/.test(s)` — NO violation pushed) or the exact fail-close message
 *     otherwise (regex-host for reads/non-portable methods, `REGEX_EXEC_FAILCLOSE`
 *     for `.exec`, `REGEX_TEST_G_FAILCLOSE` for `/g`-literal `.test`). */
export interface ClosureBlockRegexHostViolation {
  // NOTE: these `kind` discriminant literals are camelCase (NOT kebab-case)
  // deliberately. The eligibility-golden drift wall mechanically extracts
  // reason-code literals from this source file with a `'kebab-case'` regex
  // (requiring at least one hyphen); camelCasing these internal,
  // non-reason-code kinds keeps them from being mis-extracted as phantom
  // eligibility reason codes — while staying biome-clean (single quotes).
  kind: 'bareRegexp' | 'regexLiteralAccess';
  root: string;
  locallyShadowed: boolean;
  /** The exact fail-close message to throw (mirrors the expression-level path). */
  message: string;
}

/** Collect the const/let/function/class names declared at the TOP LEVEL of a
 *  single block (its DIRECT statement children only — NOT nested blocks). JS
 *  block-scoping hoists these to the whole enclosing block, so a reference
 *  ANYWHERE in the block (even lexically BEFORE the declarator) resolves to the
 *  block-local, not an outer binding. Predeclaring them before visiting the
 *  block's refs is what makes `() => { let x = RegExp; const RegExp = 1; … }`
 *  treat the `RegExp` in `x`'s initializer as the block-local (no false
 *  fail-close). `var` hoists to the function, not the block, but the v1 gate
 *  rejects `var`, so only let/const/function/class reach here. */
function topLevelBlockDeclaredNames(statements: readonly ts.Statement[]): string[] {
  const names: string[] = [];
  for (const stmt of statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        names.push(...bindingPatternIdentifierNames(decl.name));
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      names.push(stmt.name.text);
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      names.push(stmt.name.text);
    }
  }
  return names;
}

/** True when this `RegExp` identifier sits in a position where it is NOT a host
 *  VALUE use, so the bare-`RegExp` screen must NOT fire:
 *   - the member NAME of a property access (`obj.RegExp`) or `QualifiedName`;
 *   - the OBJECT of a member/element access (`RegExp.prototype`, `RegExp[$1]`) —
 *     the generic member scan owns these and emits the GENERIC host message,
 *     matching the expression-level member-receiver screen;
 *   - an object property KEY (`{ RegExp: 1 }`) — but NOT a shorthand
 *     (`{ RegExp }`), which IS a value reference;
 *   - an object-literal METHOD / GETTER / SETTER name or a class PROPERTY name
 *     (`{ RegExp() {} }`, `{ get RegExp() {} }`, `{ set RegExp(v) {} }`,
 *     `class { RegExp = … }`) — a member key, not a host value reference;
 *   - any DECLARATION name (variable/binding/parameter/enum-member/class/function);
 *   - a TYPE-ANNOTATION reference (`const x: RegExp = …`) — types are erased and
 *     are never a value use. */
function isRegExpNonValuePosition(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  // Member NAME side (`obj.RegExp`, qualified `A.RegExp`).
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  // Member OBJECT side (`RegExp.foo`, `RegExp[x]`) — generic scan owns it.
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return true;
  if (ts.isElementAccessExpression(parent) && parent.expression === node) return true;
  // Object property KEY (NOT shorthand — shorthand is a value reference).
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  // Object-literal METHOD / GETTER / SETTER NAMES, and a class PROPERTY name
  // (`{ RegExp() {} }`, `{ get RegExp() {} }`, `{ set RegExp(v) {} }`,
  // `class { RegExp = … }`). The NAME is a member key, NOT a value reference to
  // the host `RegExp` global — emitting the object/class never reads the host
  // root, so the bare-`RegExp` screen must NOT fire on it (over-rejection fix).
  if (
    (ts.isMethodDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isPropertyDeclaration(parent)) &&
    parent.name === node
  ) {
    return true;
  }
  // Declaration names of every flavor.
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true;
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) return true;
  if (ts.isParameter(parent) && parent.name === node) return true;
  if (ts.isEnumMember(parent) && parent.name === node) return true;
  if ((ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)) && parent.name === node) return true;
  // A reference inside a TYPE NODE is erased (`const x: RegExp = /a/`).
  if (isInTypePosition(node)) return true;
  // Round-6 fix — the round-5 carve-out exempted `typeof RegExp` here, which (with
  // its TS/IR-emit siblings) re-opened reserved host roots. `typeof RegExp` is NOT
  // portable (the Python leg lowers `typeof` to a runtime `isinstance` ladder over
  // the Python name `RegExp`, which does not exist), so it MUST fail-close — and
  // it does so through this bare-`RegExp` screen, which fires inside a `typeof`
  // operand just like any other value reference. (`typeof RegExp.prototype` is a
  // member read, owned by the member-OBJECT branch above, so it is unaffected.)
  // Non-RegExp host roots in `typeof` position (`typeof Date`/`typeof process`)
  // are caught by `collectClosureBlockTypeofHostRoots` with the generic host
  // message, keeping the closure-walk leg in lockstep with the expression legs.
  return false;
}

/** True when the node sits anywhere inside a TypeNode (a type annotation, type
 *  argument, type alias, etc.). Types are erased on emit, so a `RegExp` there is
 *  never a host VALUE use. Walks parents until a TypeNode (erased) or a
 *  value-bearing boundary (statement/block) is reached. */
function isInTypePosition(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isTypeNode(current)) return true;
    if (ts.isStatement(current) || ts.isBlock(current) || ts.isSourceFile(current)) return false;
    current = current.parent;
  }
  return false;
}

/** Walk a closure block's TS AST and collect the regex-host violations the
 *  generic member-access scan cannot see (bare `RegExp` VALUE references and
 *  regex-LITERAL property/element accesses). Tracks REAL JS block scope: each
 *  block predeclares its top-level let/const/function/class names BEFORE visiting
 *  its refs, so a name shadows only within its own block + nested blocks. A
 *  parse failure yields an empty list (the gate already rejected such bodies). */
export function collectClosureBlockRegexHostViolations(raw: string): ClosureBlockRegexHostViolation[] {
  const block = parseClosureBlockAst(raw);
  if (block === null) return [];
  const violations: ClosureBlockRegexHostViolation[] = [];
  const scopes: Array<Set<string>> = [];
  const isLocal = (name: string): boolean => scopes.some((scope) => scope.has(name));

  const visit = (node: ts.Node): void => {
    if (ts.isBlock(node)) {
      // JS block scope: hoist this block's top-level declarations for its WHOLE
      // body (order-independent), then visit. Pop on exit so a sibling/outer
      // reference no longer sees them.
      scopes.push(new Set(topLevelBlockDeclaredNames(node.statements)));
      for (const statement of node.statements) visit(statement);
      scopes.pop();
      return;
    }
    // A property/element access whose receiver is a regex LITERAL, possibly under
    // transparent type-only wrappers (`(/x/ as any).source`, `(/x/!)["source"]`,
    // nested `((/x/ as any)).source`). The receiver is UNWRAPPED first
    // (`unwrapRegexReceiverTS`) so a wrapped literal is screened identically to the
    // bare form — and to the IR legs, which peel the matching `typeAssert`/
    // `nonNull` IR wrappers (round-5 wrapped-receiver fail-close fix). The shared
    // classifier returns the exact message (or null = portable, e.g. `/x/.test`).
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      ts.isRegularExpressionLiteral(unwrapRegexReceiverTS(node.expression))
    ) {
      const receiver = unwrapRegexReceiverTS(node.expression) as ts.RegularExpressionLiteral;
      const property = regexLiteralAccessPropertyName(node);
      // Only a DOTTED property access can be the callee of a portable regex
      // method call — `lowerRegexCallTS` lowers `callee.kind === 'member'` only,
      // so a BRACKET-form call (`/x/["test"](s)`) is NOT portable.
      const isDottedCallee =
        ts.isPropertyAccessExpression(node) && ts.isCallExpression(node.parent) && node.parent.expression === node;
      const flags = regexLiteralFlags(receiver);
      const message = classifyRegexLiteralAccessFailClose(property, isDottedCallee, flags);
      if (message !== null) {
        violations.push({ kind: 'regexLiteralAccess', root: 'RegExp', locallyShadowed: false, message });
      }
      // Do NOT blindly `forEachChild` into this already-classified access: the
      // regexLit RECEIVER (`node.expression`) has no child violation, and
      // re-descending the access node as a whole risks re-visiting it. Descend
      // ONLY into a computed element INDEX (`/x/[k]`) so the index EXPRESSION is
      // still checked for its OWN host violations (`/x/[someObj.RegExp]`,
      // `/x/[/y/.source]`) — a property access (`/x/.source`) has only the static
      // member key, nothing value-bearing to recurse into.
      if (ts.isElementAccessExpression(node)) visit(node.argumentExpression);
      return;
    }
    if (ts.isIdentifier(node) && node.text === 'RegExp' && !isRegExpNonValuePosition(node)) {
      violations.push({
        kind: 'bareRegexp',
        root: node.text,
        locallyShadowed: isLocal(node.text),
        message: REGEX_HOST_REGEXP_FAILCLOSE,
      });
    }
    ts.forEachChild(node, visit);
  };

  // The root closure block is a `ts.Block`; `visit` pushes its top-level scope.
  visit(block);
  return violations;
}

/** A bare-identifier operand of a `typeof` expression found inside a closure
 *  block (`typeof Date`, `typeof process`). The host-root decision is made by the
 *  CONSUMER (`typescript-closure-classifier.ts`), so this collector stays free of
 *  host-namespace coupling — it only reports the operand `name` and whether a
 *  block-scope local shadows it. RegExp is NOT special-cased here: a bare `RegExp`
 *  in `typeof` position is already a value reference caught by
 *  `collectClosureBlockRegexHostViolations` (round-6 removed the `typeof` exemption
 *  in `isRegExpNonValuePosition`), so it fails-close there with the regex message.
 *  This collector covers the OTHER reserved host roots with the generic message. */
export interface ClosureBlockTypeofOperand {
  name: string;
  locallyShadowed: boolean;
}

/** Walk a closure block and collect every `typeof <bare identifier>` operand,
 *  tracking REAL JS block scope identically to
 *  {@link collectClosureBlockRegexHostViolations}: each block predeclares its
 *  top-level let/const/function/class names (incl. destructuring) BEFORE visiting
 *  its refs, so a block-local shadow is honored for the whole block. Only the
 *  bare-identifier operand of a `typeof` is reported, AFTER recursively peeling
 *  the transparent TS-AST wrappers via {@link unwrapRegexReceiverTS} — so a
 *  WRAPPED operand (`typeof (Date as any)`, `typeof (Date!)`, parenthesized
 *  `typeof (Date)`, nested `typeof (Date as any as unknown)`) records the
 *  underlying `Date` name, identically to the ValueIR legs that peel
 *  `typeAssert`/`nonNull` via `unwrapTransparentReceiverIR` (round-7 closes the
 *  wrapped-operand bypass on this leg too). `typeof Date.now` (a member operand)
 *  is owned by the generic member-access scan, and any operand that does NOT
 *  unwrap to a bare identifier records nothing. A parse failure yields an empty
 *  list (the gate already rejected such bodies). */
export function collectClosureBlockTypeofOperands(raw: string): ClosureBlockTypeofOperand[] {
  const block = parseClosureBlockAst(raw);
  if (block === null) return [];
  const operands: ClosureBlockTypeofOperand[] = [];
  const scopes: Array<Set<string>> = [];
  const isLocal = (name: string): boolean => scopes.some((scope) => scope.has(name));

  const visit = (node: ts.Node): void => {
    if (ts.isBlock(node)) {
      scopes.push(new Set(topLevelBlockDeclaredNames(node.statements)));
      for (const statement of node.statements) visit(statement);
      scopes.pop();
      return;
    }
    if (ts.isTypeOfExpression(node)) {
      // Round-7 — peel the transparent TS-AST wrappers (paren/`as`/`<T>`/`!`/
      // `satisfies`) via the round-5 `unwrapRegexReceiverTS` (fixpoint) BEFORE the
      // bare-identifier check, so a WRAPPED operand (`typeof (Date as any)`) is
      // recorded as the underlying `Date` — matching the ValueIR legs' unwrap.
      const operand = unwrapRegexReceiverTS(node.expression);
      if (ts.isIdentifier(operand)) {
        operands.push({ name: operand.text, locallyShadowed: isLocal(operand.text) });
      }
    }
    ts.forEachChild(node, visit);
  };

  // The root closure block is a `ts.Block`; `visit` pushes its top-level scope.
  visit(block);
  return operands;
}

/** The portable property NAME of a regex-literal property/element access, or
 *  null when it is a COMPUTED element index (`/x/[k]`) — unknowable, so the
 *  classifier treats it as non-portable. A STRING-literal element index
 *  (`/x/["test"]`) yields its string value so it classifies like the dotted form. */
function regexLiteralAccessPropertyName(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const arg = node.argumentExpression;
  if (ts.isStringLiteralLike(arg)) return arg.text;
  return null;
}

/** Recursively peel the transparent TS-AST wrappers off a regex-literal access
 *  RECEIVER until the underlying expression: `ParenthesizedExpression` (`(/x/)`),
 *  `AsExpression` (`/x/ as any`), `TypeAssertionExpression` (legacy `<any>/x/`),
 *  `NonNullExpression` (`/x/!`), and `SatisfiesExpression` (`/x/ satisfies T`).
 *  Fixpoint loop (not a single unwrap) so nested wrappers like `((/x/ as any))!`
 *  collapse to the `/x/` literal. This is the TS-AST projection of the IR-leg
 *  {@link unwrapTransparentReceiverIR} (which peels `typeAssert`/`nonNull`): the
 *  SAME logical wrapper set on each node universe, so a wrapped regex-literal
 *  access screens identically across the TS-AST closure leg and the ValueIR legs.
 *
 *  DELIBERATELY does NOT peel a comma-sequence `(0, /x/)`: KERN's value IR has no
 *  comma/sequence node, so the IR legs can never SEE that shape — peeling it on
 *  the TS-AST leg only would CREATE a one-target divergence, the opposite of the
 *  lockstep this round closes. (A comma-sequence regex-literal receiver is a
 *  vanishingly rare host shape; leaving it un-unwrapped is the parity-safe choice.) */
function unwrapRegexReceiverTS(expr: ts.Expression): ts.Expression {
  let current: ts.Expression = expr;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Extract the flags substring of a regex literal token (`/x/gi` → `gi`).
 *
 *  DEFENSIVE GUARD (round-5 over-rejection/soundness fix): a well-formed regex
 *  literal text is `/…/flags`, so the flags are everything after the LAST `/`.
 *  But if the token text is malformed (no closing slash, or a leading-slash-only
 *  shape where the only `/` is the opener at index 0), `lastIndexOf('/')` would
 *  return `-1` or `0` and we would mis-read the body AS flags — silently passing a
 *  pattern that should be screened. A malformed literal must never launder
 *  flags: when there is no closing `/` at index > 0, we FAIL SAFE by returning a
 *  `'g'`-bearing sentinel so the classifier takes the most-restrictive (`/g`)
 *  branch (`/x/.test` → `REGEX_TEST_G_FAILCLOSE`; every other access already
 *  fails-close flag-independently) — fail-CLOSE rather than fail-open. A real
 *  regex literal always has its closing slash at index > 0, so this never affects
 *  valid input; `ts` would not even produce a `RegularExpressionLiteral` token
 *  for an unterminated literal, but the guard is the cheap, sound belt-and-braces. */
function regexLiteralFlags(literal: ts.RegularExpressionLiteral): string {
  const text = literal.text;
  const lastSlash = text.lastIndexOf('/');
  // Valid `/…/flags` always has its closing slash at index > 0 (index 0 is the
  // opener). `<= 0` means no closing slash was found — fail SAFE with `/g`.
  if (lastSlash <= 0) return 'g';
  return text.slice(lastSlash + 1);
}

/** Peel the wrapper layers a call callee may carry until reaching the underlying
 *  expression: parenthesized, `as`, legacy `<T>` type-assertion, non-null `!`,
 *  and `satisfies` forms, plus the right operand of a comma (sequence) operator.
 *  Fixpoint loop — NOT a single unwrap — so stacked wrappers like
 *  `((process satisfies T) as any)!` collapse to `process`. */
function unwrapCallCalleeExpression(expr: ts.Expression): ts.Expression {
  let current: ts.Expression = expr;
  while (true) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    // `(a, b)` sequence — the produced value is the RIGHT operand, so
    // `(0, process)()` targets `process`.
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      current = current.right;
      continue;
    }
    return current;
  }
}

/** Flatten a binding NAME (plain identifier OR an object/array destructuring
 *  pattern) to the identifier names it binds. `const { RegExp } = x` →
 *  `['RegExp']`, `const [a, , b] = arr` → `['a','b']`. Exported so the Python
 *  closure lowerer's block-scope tracker (`blockTopLevelDeclaredNames` in
 *  closure-python-lowering.ts) extracts shadow names the SAME way as the TS-AST
 *  closure walk here — a destructured `RegExp` shadow is then honored
 *  symmetrically on both legs (no fail-open on one target). */
export function bindingPatternIdentifierNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const out: string[] = [];
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    out.push(...bindingPatternIdentifierNames(element.name));
  }
  return out;
}

function leftmostIdentifierName(node: ts.Expression): string | null {
  let current: ts.Expression = unwrapCallCalleeExpression(node);
  while (true) {
    if (ts.isIdentifier(current)) return current.text;
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = unwrapCallCalleeExpression(current.expression);
      continue;
    }
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
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

/** Collect the raw source text of every CALL expression nested anywhere in a
 *  closure block, via the shared TS AST (`parseClosureBlockAst`) — never a
 *  string scan. Returned to consumers that re-parse each call into their own
 *  IR (the TS body emitter's bound-regex-method fail-close), so those callers
 *  need no static `typescript` import of their own. Keeping the `ts` AST walk
 *  quarantined in this Node-only module is what keeps `body-ts.js` OFF the
 *  browser-spine TS-importer pin (`browser-spine-import-graph.test.ts`). A
 *  parse failure yields an empty list (the gate already rejected such bodies,
 *  so this is defensive). */
export function collectClosureBlockCallTexts(raw: string): string[] {
  const block = parseClosureBlockAst(raw);
  if (block === null) return [];
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) texts.push(node.getText());
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(block, visit);
  return texts;
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
