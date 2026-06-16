/** Serialize ValueIR to a TypeScript expression string. */

import {
  assertDecimalOperands,
  assertNoDecimalOperator,
  assertNonZeroDecimalDivisor,
  assertPortableDecimalLiteral,
  assertPortableDecimalPow,
  decimalBareConstructionFailMessage,
  decimalNonStringLiteralFailMessage,
} from './codegen/decimal-contract.js';
import { isHostNamespaceRoot, unmappedHostNamespaceMessage } from './codegen/host-namespace.js';
import type { StdlibCallEntry } from './codegen/kern-stdlib.js';
import {
  applyTemplate,
  KERN_STDLIB_MODULES,
  lookupStdlibCall,
  lookupStdlibProperty,
  suggestStdlibMethod,
} from './codegen/kern-stdlib.js';
// Milestone C, Slice 1 — shared regex emission-normalization. The class
// transform (`\d \w \s` → ASCII classes) must be byte-identical across the TS
// and Python emitters, so both import it from this one core module. Anchor
// lowering is Python-only (JS `$`/`^` without `/m` already mean input-end/start).
import {
  classifyRegexLiteralIndexReadFailClose,
  classifyRegexLiteralMemberReadFailClose,
  expandRegexIFold,
  isZeroWidthCapableRegex,
  normalizeRegexClasses,
  REGEX_EXEC_FAILCLOSE,
  REGEX_HOST_REGEXP_FAILCLOSE,
  REGEX_MATCHALL_NO_G_FAILCLOSE,
  REGEX_REPLACE_NONLITERAL_REPL_FAILCLOSE,
  REGEX_REPLACEALL_NO_G_FAILCLOSE,
  REGEX_SPLIT_LIMIT_FAILCLOSE,
  REGEX_SPLIT_ZEROWIDTH_FAILCLOSE,
  REGEX_TEST_G_FAILCLOSE,
  regexAstralFailMessage,
  regexCaptureMeta,
  regexIFoldFailMessage,
  regexLiteralReceiverIR,
  scanRegexAstral,
  unwrapTransparentReceiverIR,
  validateRegexNamedGroupsPortable,
  validateReplStringForTS,
} from './codegen/regex-normalize.js';
import type { ValueIR } from './value-ir.js';

export interface ExprEmitContext {
  isUserBinding(name: string): boolean;
  validateRawBlock?(rawBlock: string, isUserBinding: (name: string) => boolean): void;
  /** DECIMAL Slice 1 — TS-leg import-requirement sink, the additive mirror of the
   *  Python expression emitter's `ctx.imports`. When a stdlib lowering declares
   *  `requires.ts` (currently only the Decimal namespace, which needs the EXTERNAL
   *  `decimal.js` npm package — not a global like Math/JSON/RegExp), the emitter
   *  records the requirement key here so a caller using `emitExpressionWithImports`
   *  can render the corresponding `import` line. `emitExpression` (legacy
   *  string-only entry point) passes no sink, so the existing global-only lowerings
   *  are completely unaffected. */
  imports?: Set<string>;
}

/** DECIMAL Slice 1 — public return shape for the TS expression emitter, parity
 *  with the Python `emitPyExpressionWithImports` `{ code, imports }`. */
export interface ExpressionEmitResult {
  code: string;
  imports: Set<string>;
}

const DIRECT_HOST_CALL_ROOTS: ReadonlySet<string> = new Set([
  'Date',
  'Map',
  'Set',
  'Promise',
  'Reflect',
  'Symbol',
  'WeakMap',
  'WeakSet',
  'Proxy',
  'BigInt',
  'Intl',
  'URL',
]);

function rejectUnmappedHostNamespaceTS(root: string, member: string, ctx: ExprEmitContext | undefined): void {
  if (!isHostNamespaceRoot(root)) return;
  if (isUserBinding(ctx, root)) return;
  throw new Error(unmappedHostNamespaceMessage('TypeScript', root, member));
}

/** Milestone C, Slice 2 — host-`RegExp` fail-close (TS emit). Closes the residual
 *  RegExp positions the generic `Module.member` host-namespace screen does NOT
 *  cover, with the SAME shared message the Python emitter throws:
 *   - a BARE-VALUE reference (`const R = RegExp`, `RegExp` passed as an argument):
 *     `isHostNamespaceRoot('RegExp')` is now true, so a non-user-bound `RegExp`
 *     ident is the host root. Rejecting it at the value site SUBSUMES alias
 *     following — `const R = RegExp` is refused at the initializer, so `new R(...)`
 *     can never silently diverge.
 *   - a BARE CALL `RegExp(p, f)` (callee is an ident, not a `Module.member`, so the
 *     existing member-callee screen misses it; `RegExp` is also not in
 *     `DIRECT_HOST_CALL_ROOTS`).
 *  Honors user shadowing via `isUserBinding` (so `const RegExp = x; RegExp` is the
 *  user value). `new RegExp(...)` and `RegExp.prototype`/`RegExp.$1` already
 *  fail-close through the existing `new`/`member` host-root screens once RegExp is
 *  reserved — they emit the generic host-namespace message and are not re-routed
 *  here (one diagnostic per site). */
function rejectHostRegExpValueTS(name: string, ctx: ExprEmitContext | undefined): void {
  if (name !== 'RegExp') return;
  if (isUserBinding(ctx, name)) return;
  throw new Error(REGEX_HOST_REGEXP_FAILCLOSE);
}

/** Round-6 fix — `typeof <bare host-namespace root>` fails-close. The round-5
 *  carve-out special-cased `typeof <ANY bare ident>` to dodge the bare-`RegExp`
 *  reject, but that over-broadly RE-OPENED reserved host roots: `typeof Date`,
 *  `typeof process` are NON-PORTABLE — TS emits the native `typeof Date` (JS
 *  reads the host `Date` global → "function"), but the Python leg lowers `typeof`
 *  to a runtime `isinstance` ladder over the Python name `Date`, which does not
 *  exist (NameError). So `typeof <host root>` is a genuine TS↔Python divergence
 *  and must fail-close on BOTH targets. This is the TARGETED replacement: it fires
 *  ONLY when the operand is a reserved host-namespace root (and not user-bound),
 *  so an ORDINARY `typeof userLocal` / `typeof undeclaredFeatureFlag` (the
 *  feature-detection idiom — `window`/`document`/`setTimeout` are NOT host roots)
 *  stays accepted. `RegExp` keeps the regex-specific message (matching the
 *  bare-value reject); every other host root takes the generic host message with a
 *  synthetic `typeof` member (same shape as the `call`/`constructor` sentinels).
 *  Bare VALUE refs (`const c = Date`) are DELIBERATELY left accepted here — that is
 *  a wider, separately-charted slice; this fix closes only the typeof divergence. */
function rejectTypeofHostRootTS(name: string, ctx: ExprEmitContext | undefined): void {
  if (isUserBinding(ctx, name)) return;
  if (name === 'RegExp') throw new Error(REGEX_HOST_REGEXP_FAILCLOSE);
  if (!isHostNamespaceRoot(name)) return;
  throw new Error(unmappedHostNamespaceMessage('TypeScript', name, 'typeof'));
}

function isUserBinding(ctx: ExprEmitContext | undefined, name: string): boolean {
  return ctx?.isUserBinding(name) === true;
}

function withAdditionalUserBindings(ctx: ExprEmitContext | undefined, names: string[]): ExprEmitContext | undefined {
  if (names.length === 0) return ctx;
  const local = new Set(names);
  const next: ExprEmitContext = {
    isUserBinding(name: string): boolean {
      return local.has(name) || ctx?.isUserBinding(name) === true;
    },
  };
  if (ctx?.validateRawBlock) {
    next.validateRawBlock = (rawBlock: string, isUserBinding: (name: string) => boolean): void => {
      ctx.validateRawBlock?.(rawBlock, isUserBinding);
    };
  }
  return next;
}

// Slice 2c — extended precedence table covering equality, relational,
// additive, multiplicative ops alongside the existing nullish/logical.
// Numbers follow MDN's precedence ordering (higher = binds tighter).
const PREC: Record<string, number> = {
  '??': 1,
  '||': 2,
  '&&': 3,
  // Slice 6 — bitwise OR/XOR/AND sit between `&&` and equality (JS order:
  // `|` < `^` < `&` < `==`). The gap (4..6 free) leaves room above `&&`.
  '|': 7,
  '^': 8,
  '&': 9,
  '==': 10,
  '!=': 10,
  '===': 10,
  '!==': 10,
  '<': 11,
  '<=': 11,
  '>': 11,
  '>=': 11,
  instanceof: 11,
  // Slice 6 — shift sits between relational (11) and additive (13).
  '<<': 12,
  '>>': 12,
  '>>>': 12,
  '+': 13,
  '-': 13,
  '*': 14,
  '/': 14,
  '%': 14,
};

/** DECIMAL Slice 1 — context-aware entry point returning `{ code, imports }`.
 *  Mirrors the Python `emitPyExpressionWithImports`: lowers `node` to TS and
 *  collects any external-package import requirements (e.g. `decimal.js` for the
 *  Decimal namespace) into the returned `imports` set. `emitExpression` is the
 *  legacy code-only wrapper; it discards imports, which is correct for every
 *  global-backed lowering (Math/JSON/Object/Array/Number/RegExp). */
export function emitExpressionWithImports(node: ValueIR, ctx?: ExprEmitContext): ExpressionEmitResult {
  const imports = ctx?.imports ?? new Set<string>();
  const next: ExprEmitContext = {
    isUserBinding: (name: string) => ctx?.isUserBinding(name) === true,
    imports,
  };
  if (ctx?.validateRawBlock) next.validateRawBlock = ctx.validateRawBlock;
  const code = emitExpression(node, next);
  return { code, imports };
}

/** DECIMAL Slice 1 — record a TS-side `requires.ts` import requirement into the
 *  context sink, when present. The requirement key (e.g. `'decimal.js'`) is the
 *  npm package the caller must import; rendering the actual `import` line is the
 *  caller's job (see `decimalImportLineTS`). No-op when no sink is threaded, so
 *  the string-only `emitExpression` path is unaffected. */
function registerStdlibRequirementTS(requirement: string | undefined, ctx: ExprEmitContext | undefined): void {
  if (!requirement) return;
  ctx?.imports?.add(requirement);
}

export function emitExpression(node: ValueIR, ctx?: ExprEmitContext): string {
  switch (node.kind) {
    case 'numLit':
      return node.raw;
    case 'strLit': {
      const q = node.quote;
      const escaped = escapeControlChars(node.value.replace(/\\/g, '\\\\')).replace(new RegExp(q, 'g'), `\\${q}`);
      return `${q}${escaped}${q}`;
    }
    case 'boolLit':
      return node.value ? 'true' : 'false';
    case 'nullLit':
      return 'null';
    case 'undefLit':
      return 'undefined';
    case 'regexLit': {
      // Slice 1: normalize `\d \w \s` to explicit ASCII classes. Anchors and
      // flags are kept verbatim on TS (JS `$`/`^` without `/m` are already
      // input-anchored; JS shorthand `\d`/`\w` are already ASCII — the `\s`
      // narrowing is the one match-affecting rewrite here).
      // Slice-/i: class-expand non-ASCII Set(A) letters under /i (Set(B) → throw),
      // applied AFTER class-normalization (Slice-1 classes are pure-ASCII, so the
      // fold scan leaves them untouched) and on the SAME shared transform Python
      // uses, so the residual pattern is byte-identical across targets. `/i` is
      // kept in the flags.
      // Slice 5: fail-close any non-BMP (astral) construct in the PATTERN before
      // class/fold normalization, on the RAW pattern (same decision both targets).
      const astral = scanRegexAstral(node.pattern);
      if (astral !== null) throw new Error(regexAstralFailMessage(astral.char));
      // FIX 2: a non-portable named group (`(?<café>…)`) fail-closes on BOTH
      // targets (Python `pyRegexPattern` runs the same validator), so a bare regex
      // literal with a Unicode/illegal group name is refused symmetrically.
      validateRegexNamedGroupsPortable(node.pattern);
      const classed = normalizeRegexClasses(node.pattern);
      const folded = expandRegexIFold(classed, node.flags);
      if ('failClose' in folded) throw new Error(regexIFoldFailMessage(folded.char, folded.reason));
      return `/${folded.pattern}/${node.flags}`;
    }
    case 'tmplLit': {
      let out = '`';
      for (let i = 0; i < node.quasis.length; i++) {
        out += escapeTemplateQuasi(node.quasis[i]);
        if (i < node.expressions.length) out += `\${${emitExpression(node.expressions[i], ctx)}}`;
      }
      out += '`';
      return out;
    }
    case 'ident':
      // Slice 2 — a BARE-VALUE host `RegExp` reference (not a member receiver,
      // which the `member`/`call`/`new` cases own) fails-close. This is the
      // alias-soundness site: `const R = RegExp` is refused at the initializer.
      rejectHostRegExpValueTS(node.name, ctx);
      return node.name;
    case 'member': {
      const stdlib = applyStdlibPropertyLoweringTS(node);
      if (stdlib !== null) return stdlib;
      // Slice 2 — a bare property READ on a regex LITERAL (`/x/.source`,
      // `/x/.flags`) launders the pattern/flags back into a string. Routed through
      // the SHARED classifier (via the ValueIR adapter) so this site agrees with
      // the IR-validate + Python emit legs and the closure walk BY CONSTRUCTION.
      // The portable METHODS (.test/.exec/…) are routed by the CALL path (which
      // returns BEFORE this bare-read member emit), so this only ever sees a
      // genuine bare read (always non-null today — the empty read allowlist).
      // The receiver is UNWRAPPED first (`regexLiteralReceiverIR`) so a wrapped
      // read `(/x/ as any).source` / `(/x/!).source` fails-close identically to
      // the bare `/x/.source`.
      if (regexLiteralReceiverIR(node.object) !== null) {
        const message = classifyRegexLiteralMemberReadFailClose(node);
        if (message !== null) throw new Error(message);
      }
      const receiverRoot = hostNamespaceReceiverRoot(node.object);
      if (receiverRoot)
        rejectUnmappedHostNamespaceTS(receiverRoot, hostNamespaceMemberLabel(node.object, node.property), ctx);
      const obj = emitExpression(node.object, ctx);
      const wrapped = needsReceiverParens(node.object) ? `(${obj})` : obj;
      return `${wrapped}${node.optional ? '?.' : '.'}${node.property}`;
    }
    case 'index': {
      rejectKnownStdlibIndexTS(node);
      // Slice 2 review fix — the bracket (`index`) form of a regex-literal
      // property access (`/x/["source"]`, `/x/["flags"]`, `/x/["test"](s)`)
      // must fail-close IDENTICALLY to the dotted member form. A STRING-literal
      // index is the same launder-the-pattern-to-a-string read the member case
      // screens against the (empty) portable-property allowlist; a COMPUTED /
      // non-literal index is even worse — the property is unknowable, so it is a
      // laundering risk and also fails-close. Throws the regex-specific message,
      // not the generic host one.
      // Receiver UNWRAPPED first so a wrapped bracket read `(/x/!)["source"]` /
      // `(/x/ as any)["test"](s)` fails-close identically to the bare bracket form.
      if (regexLiteralReceiverIR(node.object) !== null) {
        // Routed through the SHARED classifier (a STRING index classifies like the
        // dotted read; a COMPUTED index is unknowable → fail-close), so the bracket
        // form (`/x/["source"]`, `/x/["test"](s)` — a bracket call whose callee is
        // this `index`) agrees with the dotted member form and the other legs.
        const message = classifyRegexLiteralIndexReadFailClose(node);
        if (message !== null) throw new Error(message);
      }
      const receiverRoot = hostNamespaceReceiverRoot(node.object);
      if (receiverRoot) {
        const label = node.index.kind === 'strLit' ? node.index.value : '[computed]';
        rejectUnmappedHostNamespaceTS(receiverRoot, hostNamespaceMemberLabel(node.object, label), ctx);
      }
      const obj = emitExpression(node.object, ctx);
      const wrapped = needsReceiverParens(node.object) ? `(${obj})` : obj;
      return `${wrapped}${node.optional ? '?.' : ''}[${emitExpression(node.index, ctx)}]`;
    }
    case 'call': {
      // Slice 2a — KERN-stdlib dispatch. When the callee is `Module.method`
      // and `Module` is a known stdlib module, route through the per-target
      // lowering table instead of the default emit path.
      const stdlib = applyStdlibLoweringTS(node, ctx);
      if (stdlib !== null) return stdlib;
      if (node.callee.kind === 'ident') {
        if (!isUserBinding(ctx, node.callee.name) && (node.callee.name === 'Array' || node.callee.name === 'Object')) {
          throwUnknownStdlibMember(node.callee.name, 'call');
        }
        // Slice 2 — a bare `RegExp(p, f)` call (callee is an ident, so the
        // member-callee screen below misses it, and RegExp is not in
        // DIRECT_HOST_CALL_ROOTS) fails-close with the shared regex message.
        rejectHostRegExpValueTS(node.callee.name, ctx);
        // DECIMAL Slice 1 — bare `Decimal(...)` (ident callee) fail-closes
        // symmetrically. Only the namespace forms `Decimal.of`/`Decimal.add`
        // (member callees, handled by `applyStdlibLoweringTS` above) are portable.
        if (!isUserBinding(ctx, node.callee.name) && node.callee.name === 'Decimal') {
          throw new Error(decimalBareConstructionFailMessage());
        }
        if (DIRECT_HOST_CALL_ROOTS.has(node.callee.name)) rejectUnmappedHostNamespaceTS(node.callee.name, 'call', ctx);
      }
      if (node.callee.kind === 'member') {
        const receiverRoot = hostNamespaceReceiverRoot(node.callee.object);
        if (receiverRoot)
          rejectUnmappedHostNamespaceTS(
            receiverRoot,
            hostNamespaceMemberLabel(node.callee.object, node.callee.property),
            ctx,
          );
      }
      // Milestone C, Slice 3 — portable regex match-set methods. Adapt `.match`
      // (no /g) to the canonical KERN shape and fail-close the non-portable
      // shapes IDENTICALLY to the Python target (shared messages + predicate).
      const regexMethod = lowerRegexCallTS(node);
      if (regexMethod !== null) return regexMethod;
      const callee = emitExpression(node.callee, ctx);
      const wrapped = needsReceiverParens(node.callee) ? `(${callee})` : callee;
      const args = node.args.map((arg) => emitExpression(arg, ctx)).join(', ');
      const typeArgs = node.typeArgs ? `<${node.typeArgs}>` : '';
      return node.optional ? `${wrapped}?.${typeArgs}(${args})` : `${wrapped}${typeArgs}(${args})`;
    }
    case 'lambda': {
      const params =
        !node.parenthesized && node.params.length === 1 && !node.params[0].type
          ? node.params[0].name
          : `(${node.params.map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(', ')})`;
      const returnType = node.returnType ? `: ${node.returnType}` : '';
      const lambdaCtx = withAdditionalUserBindings(
        ctx,
        node.params.map((p) => p.name),
      );
      // Block-bodied arrow (slices 0+1): re-emit the raw block verbatim. The
      // raw text INCLUDES the outer braces, so emission adds nothing inside it
      // and `parse(emit(x))` reproduces `raw` byte-identically — the round-trip
      // invariant `canonicalKernExpression` relies on.
      if (node.bodyBlock) {
        validateRawBlockHostNamespacesTS(node.bodyBlock.raw, lambdaCtx);
        return `${params}${returnType} => ${node.bodyBlock.raw}`;
      }
      return `${params}${returnType} => ${emitExpression(node.body as ValueIR, lambdaCtx)}`;
    }
    case 'binary': {
      // DECIMAL Slice 2 (item 3) — fail closed on `+`/`-`/`*` over a syntactically-
      // proven Decimal operand (`Decimal.of(...)`/`Decimal.<m>(...)`). decimal.js's
      // `+` calls .valueOf() → float (silent precision loss + TS↔Python divergence).
      // Conservative: a no-op for plain numeric arithmetic. The Python leg makes the
      // identical decision with the same shared message, so the refusal is symmetric.
      //
      // Slice-2 remediation (Finding 2): lower the operands FIRST, then assert. An
      // operand that is a bad Decimal call — an unknown member (`Decimal.nope(...)`)
      // or a non-canonical literal (`Decimal.of("1.10")`) — throws its OWN specific
      // diagnostic during lowering, instead of being masked by the generic operator
      // error. Lowering a VALID Decimal producer (`Decimal.of("1")`) succeeds, so the
      // operator fail-close below still fires for real Decimal arithmetic. The Python
      // leg mirrors this lower-then-assert order for symmetric diagnostics.
      const left = emitExpression(node.left, ctx);
      const right = emitExpression(node.right, ctx);
      assertNoDecimalOperator(node);
      const lp = needsParens(node.left, node.op, 'left') ? `(${left})` : left;
      const rp = needsParens(node.right, node.op, 'right') ? `(${right})` : right;
      return `${lp} ${node.op} ${rp}`;
    }
    case 'unary': {
      // Round-6 fix — `typeof <bare ident>` whose operand is a reserved
      // host-namespace root fails-close (`typeof RegExp`/`typeof Date`/
      // `typeof process` are non-portable; see `rejectTypeofHostRootTS`). The
      // round-5 carve-out blanket-accepted EVERY bare `typeof` operand, which
      // re-opened those reserved roots. A non-host operand (`typeof userLocal`,
      // `typeof undeclaredFeatureFlag`) takes no host reject and emits the native
      // `typeof <name>` directly — bypassing the `ident` recursion so an ordinary
      // identifier never trips a value-position screen. `typeof RegExp.prototype`
      // is a `member` operand (not an `ident`), so it is owned by the recursion
      // below and still fails-close.
      //
      // Round-7 fix — a WRAPPED operand (`typeof (Date as any)`, `typeof (Date!)`,
      // parenthesized `typeof (Date)`) reached this site as a `typeAssert`/`nonNull`
      // node, NOT an `ident`, so the round-6 reject was bypassed: TS emitted the
      // wrapper verbatim while Python lowered a runtime Date/process lookup →
      // divergence. We RECURSIVELY peel the transparent wrappers via the round-5
      // `unwrapTransparentReceiverIR` (fixpoint over `typeAssert`/`nonNull`, so
      // nested `typeof (Date as any as unknown)` also collapses) and apply the
      // host-root reject to the UNWRAPPED operand.
      //
      // Round-8 fix — the unwrapped operand is used ONLY to DECIDE the host-root
      // reject; it must NOT be the emitted form. Round-7 emitted `typeof
      // <unwrapped.name>`, which STRIPPED the wrappers from ACCEPTED operands
      // (`typeof (x as string)` → `typeof x`, `typeof (x!)` → `typeof x`) — that
      // breaks emitter round-tripping (the `as`/`!`/parens carry valid syntax on
      // the TS leg). For an accepted operand we FALL THROUGH to the normal unary
      // emission below, which re-emits from the ORIGINAL `node.argument` and so
      // preserves every wrapper. Only the reject decision keys off the unwrapped
      // root.
      if (node.op === 'typeof') {
        const operand = unwrapTransparentReceiverIR(node.argument);
        if (operand.kind === 'ident') {
          rejectTypeofHostRootTS(operand.name, ctx);
        }
        // accepted operands fall through to the normal unary emission below,
        // preserving the original wrappers (`as`/`!`/parens/`satisfies`).
      }
      // Slice-2 review fix: wrap binary/unary/spread args in parens to preserve
      // unary's tight binding. `!(a === b)` would otherwise emit `!a === b`.
      const arg = emitExpression(node.argument, ctx);
      const wrapped = needsArgParens(node.argument) ? `(${arg})` : arg;
      const sep = node.op === 'typeof' || node.op === 'void' ? ' ' : '';
      return `${node.op}${sep}${wrapped}`;
    }
    case 'spread':
      return `...${emitExpression(node.argument, ctx)}`;
    case 'await': {
      const arg = emitExpression(node.argument, ctx);
      const wrapped = needsPrefixArgParens(node.argument) ? `(${arg})` : arg;
      return `await ${wrapped}`;
    }
    case 'new': {
      const ctorRoot = newExpressionRootIdentifier(node.argument);
      // Slice 2 — `new RegExp(p)` throws the regex-specific message (BEFORE the
      // generic constructor reject) so construction fails-close byte-identically
      // across the TS emit, the IR-validate pass, and the Python target.
      if (ctorRoot === 'RegExp') rejectHostRegExpValueTS(ctorRoot, ctx);
      if (ctorRoot && !(ctorRoot === 'Error' && isSimpleErrorConstructor(node.argument))) {
        rejectUnmappedHostNamespaceTS(ctorRoot, 'constructor', ctx);
      }
      const arg = emitExpression(node.argument, ctx);
      const wrapped = needsPrefixArgParens(node.argument) ? `(${arg})` : arg;
      return `new ${wrapped}`;
    }
    case 'typeAssert': {
      const expr = emitExpression(node.expression, ctx);
      const wrapped = needsTypeAssertionParens(node.expression) ? `(${expr})` : expr;
      return `${wrapped} as ${node.type}`;
    }
    case 'nonNull': {
      const expr = emitExpression(node.expression, ctx);
      const wrapped = needsTypeAssertionParens(node.expression) ? `(${expr})` : expr;
      return `${wrapped}!`;
    }
    case 'objectLit': {
      // Slice 2d — TS object literal. Bare-key when valid identifier; else JSON-quote.
      // Empty object emits `{}` to match JS convention.
      if (node.entries.length === 0) return '{}';
      const entries = node.entries.map((e) => {
        if ('kind' in e && (e as any).kind === 'spread') {
          return `...${emitExpression((e as any).argument, ctx)}`;
        }
        const prop = e as { key: string; rawKey?: string; value: ValueIR };
        const k = prop.rawKey ?? (isValidJSIdent(prop.key) ? prop.key : JSON.stringify(prop.key));
        return `${k}: ${emitExpression(prop.value, ctx)}`;
      });
      return `{ ${entries.join(', ')} }`;
    }
    case 'arrayLit':
      return `[${node.items.map((item) => emitExpression(item, ctx)).join(', ')}]`;
    case 'conditional': {
      // Slice α-2: ternary `test ? consequent : alternate`. Right-associative
      // and lower precedence than every binary op — paren-wrap any non-atomic
      // child to keep the round-tripped TS unambiguous to humans and tools.
      const test = emitExpression(node.test, ctx);
      const consequent = emitExpression(node.consequent, ctx);
      const alternate = emitExpression(node.alternate, ctx);
      const wrap = (child: ValueIR, emitted: string): string =>
        needsConditionalChildParens(child) ? `(${emitted})` : emitted;
      return `${wrap(node.test, test)} ? ${wrap(node.consequent, consequent)} : ${wrap(node.alternate, alternate)}`;
    }
    case 'propagate':
      throw new Error(
        `Propagation '${node.op}' is only allowed at statement level (top of \`let value=\` or \`return value=\`). ` +
          `Mid-expression \`${node.op}\` (e.g., \`Text.upper(call()${node.op})\`) is rejected — bind the call to a \`let\` first, then use the bound name.`,
      );
  }
}

function newExpressionRootIdentifier(node: ValueIR): string | null {
  if (node.kind === 'ident') return node.name;
  if (node.kind === 'call' && node.callee.kind === 'ident') return node.callee.name;
  if (node.kind === 'member' || node.kind === 'index') return hostNamespaceReceiverRoot(node);
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') return newExpressionRootIdentifier(node.expression);
  return null;
}

function isSimpleErrorConstructor(node: ValueIR): boolean {
  return (
    (node.kind === 'ident' && node.name === 'Error') ||
    (node.kind === 'call' && node.callee.kind === 'ident' && node.callee.name === 'Error')
  );
}

function hostNamespaceReceiverRoot(node: ValueIR): string | null {
  if (node.kind === 'ident') return node.name;
  if (node.kind === 'member' || node.kind === 'index') return hostNamespaceReceiverRoot(node.object);
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') return hostNamespaceReceiverRoot(node.expression);
  return null;
}

function hostNamespaceMemberLabel(receiver: ValueIR, fallback: string): string {
  return firstMemberAfterRoot(receiver) ?? fallback;
}

function firstMemberAfterRoot(node: ValueIR): string | null {
  if (node.kind === 'ident') return null;
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') return firstMemberAfterRoot(node.expression);
  if (node.kind === 'member') return firstMemberAfterRoot(node.object) ?? node.property;
  if (node.kind === 'index') {
    const label = node.index.kind === 'strLit' ? node.index.value : '[computed]';
    return firstMemberAfterRoot(node.object) ?? label;
  }
  return null;
}

export function validateRawHostNamespacesTS(source: string, ctx?: ExprEmitContext): void {
  for (const access of collectRawHostNamespaceAccesses(source)) {
    rejectUnmappedHostNamespaceTS(access.root, access.member, ctx);
  }
}

function validateRawBlockHostNamespacesTS(rawBlock: string, ctx: ExprEmitContext | undefined): void {
  if (ctx?.validateRawBlock) {
    ctx.validateRawBlock(rawBlock, ctx.isUserBinding);
    return;
  }
  validateRawHostNamespacesTS(rawBlock, ctx);
}

function collectRawHostNamespaceAccesses(source: string): Array<{ root: string; member: string }> {
  const accesses: Array<{ root: string; member: string }> = [];
  const roots = [
    'Math',
    'JSON',
    'Object',
    'Array',
    'Map',
    'Set',
    'Date',
    'RegExp',
    'Promise',
    'Reflect',
    'Symbol',
    'WeakMap',
    'WeakSet',
    'Proxy',
    'BigInt',
    'Error',
    'Number',
    'String',
    'Boolean',
    'Function',
    'console',
    'process',
    'globalThis',
    'crypto',
    'Intl',
    'URL',
  ].filter(isHostNamespaceRoot);
  if (roots.length === 0) return accesses;
  const rootAlt = roots.map(escapeRegExp).join('|');
  const memberRe = new RegExp(
    `(?<![\\w$])(${rootAlt})(?:\\s*(?:as\\s+[^.\\[)!]+|!))*\\s*(?:\\.\\s*([A-Za-z_$][\\w$]*)|\\[\\s*(['"])([^'"]+)\\3\\s*\\])`,
    'g',
  );
  let memberMatch: RegExpExecArray | null;
  while ((memberMatch = memberRe.exec(source)) !== null) {
    accesses.push({ root: memberMatch[1], member: memberMatch[2] ?? memberMatch[4] ?? '[computed]' });
  }
  const callRe = new RegExp(`(?<![\\w$.])(${rootAlt})\\s*\\(`, 'g');
  let callMatch: RegExpExecArray | null;
  while ((callMatch = callRe.exec(source)) !== null) {
    if (callMatch[1] === 'Error' && isRawNewErrorCall(source, callMatch.index)) continue;
    accesses.push({ root: callMatch[1], member: 'call' });
  }
  return accesses;
}

function isRawNewErrorCall(source: string, rootIndex: number): boolean {
  const prefix = source.slice(0, rootIndex).trimEnd();
  return /\bnew$/.test(prefix);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/** Precedence-aware paren-wrap predicate for binary children — exported so
 *  the Python target can share the same logic. The Python `binary` emitter
 *  doesn't have its own parent-op context outside this helper. */
export function needsBinaryParens(child: ValueIR, parentOp: string, side: 'left' | 'right'): boolean {
  if (child.kind !== 'binary') return false;
  // ?? mixed with || or && requires parens (either direction).
  if (parentOp === '??' && (child.op === '||' || child.op === '&&')) return true;
  if ((parentOp === '||' || parentOp === '&&') && child.op === '??') return true;
  const cp = PREC[child.op];
  const pp = PREC[parentOp];
  if (cp === undefined || pp === undefined) return false;
  if (cp < pp) return true;
  // Same precedence, left-associative: right child needs parens to preserve grouping.
  if (cp === pp && side === 'right') return true;
  return false;
}

function needsParens(child: ValueIR, parentOp: string, side: 'left' | 'right'): boolean {
  if (child.kind === 'typeAssert') return true;
  return needsBinaryParens(child, parentOp, side);
}

function needsReceiverParens(child: ValueIR): boolean {
  return (
    child.kind === 'binary' ||
    child.kind === 'unary' ||
    child.kind === 'spread' ||
    child.kind === 'typeAssert' ||
    child.kind === 'conditional' ||
    child.kind === 'await' ||
    child.kind === 'lambda'
  );
}

function needsTypeAssertionParens(child: ValueIR): boolean {
  return (
    child.kind === 'binary' ||
    child.kind === 'conditional' ||
    child.kind === 'unary' ||
    child.kind === 'spread' ||
    child.kind === 'await' ||
    child.kind === 'new' ||
    child.kind === 'typeAssert' ||
    child.kind === 'lambda'
  );
}

function needsPrefixArgParens(child: ValueIR): boolean {
  return (
    child.kind === 'binary' ||
    child.kind === 'conditional' ||
    child.kind === 'unary' ||
    child.kind === 'spread' ||
    child.kind === 'typeAssert' ||
    child.kind === 'lambda'
  );
}

/** Slice α-2: paren-wrap predicate for ternary children. Ternary has very
 *  low precedence — only `,` and assignment are lower. Atoms (idents,
 *  literals, calls, members, parenthesized) emit without extra parens.
 *  Binary/unary/await/spread/new/conditional get wrapped for clarity. */
function needsConditionalChildParens(child: ValueIR): boolean {
  switch (child.kind) {
    case 'binary':
    case 'unary':
    case 'spread':
    case 'await':
    case 'new':
    case 'typeAssert':
    case 'conditional':
    case 'lambda':
      return true;
    default:
      return false;
  }
}

function escapeTemplateQuasi(s: string): string {
  return escapeControlChars(s.replace(/\\/g, '\\\\')).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

// Control chars that have no readable named escape — re-emitted as \xHH.
// Excludes \x08 \x09 \x0a \x0b \x0c \x0d (named: \b \t \n \v \f \r).
const UNNAMED_CONTROL_RE = /[\x00-\x07\x0e-\x1f\x7f]/g;

function escapeControlChars(s: string): string {
  return s
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\x08/g, '\\b')
    .replace(/\f/g, '\\f')
    .replace(/\v/g, '\\v')
    .replace(UNNAMED_CONTROL_RE, hexEscape);
}

function hexEscape(ch: string): string {
  return `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`;
}

/** Slice 2d — used by objectLit emit to decide between bare-key (`{a: 1}`)
 *  and JSON-quoted key (`{"a-b": 1}`) in TS output. Mirrors the lexical-form
 *  rule for TS object-literal property names. */
function isValidJSIdent(s: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
}

/** Slice 2a — KERN-stdlib dispatch for TS. Returns the lowered TS string when
 *  the call matches `<KnownModule>.<method>(args)`, or null when it doesn't.
 *  Throws on `<KnownModule>.<unknownMethod>(...)` with a did-you-mean.
 *
 *  Args whose ValueIR is `binary`/`unary`/`spread` are wrapped in parens
 *  before template substitution so templates like `'$0.length'` produce
 *  correct precedence even when `$0` is `a + b` (→ `(a + b).length`). */
function applyStdlibPropertyLoweringTS(member: Extract<ValueIR, { kind: 'member' }>): string | null {
  if (member.optional) return null;
  if (member.object.kind !== 'ident') return null;
  const moduleName = member.object.name;
  if (!KERN_STDLIB_MODULES.has(moduleName)) return null;
  const entry = lookupStdlibProperty(moduleName, member.property);
  if (entry === null) {
    const callEntry = lookupStdlibCall(moduleName, member.property);
    if (callEntry !== null) {
      throw new Error(
        `KERN-stdlib method '${moduleName}.${member.property}' cannot be referenced as a value in portable expression lowering; call it directly.`,
      );
    }
    throwUnknownStdlibMember(moduleName, member.property);
  }
  return entry.ts;
}

function rejectKnownStdlibIndexTS(index: Extract<ValueIR, { kind: 'index' }>): void {
  if (index.object.kind !== 'ident') return;
  const moduleName = index.object.name;
  if (!KERN_STDLIB_MODULES.has(moduleName)) return;
  const member = index.index.kind === 'strLit' ? index.index.value : '[computed]';
  throwUnknownStdlibMember(moduleName, member);
}

function applyStdlibLoweringTS(call: Extract<ValueIR, { kind: 'call' }>, ctx?: ExprEmitContext): string | null {
  const callee = call.callee;
  if (callee.kind !== 'member') return null;
  if (callee.object.kind !== 'ident') return null;
  const moduleName = callee.object.name;
  if (!KERN_STDLIB_MODULES.has(moduleName)) return null;
  const methodName = callee.property;
  const entry = lookupStdlibCall(moduleName, methodName);
  if (entry === null) {
    const propertyEntry = lookupStdlibProperty(moduleName, methodName);
    if (propertyEntry !== null) {
      throw new Error(`KERN-stdlib property '${moduleName}.${methodName}' is not callable.`);
    }
    throwUnknownStdlibMember(moduleName, methodName);
  }
  // Slice-2 review fix: enforce declared arity. Silently ignoring extra args
  // hides bugs (`Text.upper(s, extra)` would emit `s.toUpperCase()` and drop
  // `extra` without warning).
  validateStdlibCallArity(moduleName, methodName, entry, call.args.length);
  if (moduleName === 'Array' && methodName === 'from' && call.args.some((arg) => arg.kind === 'spread')) {
    throw new Error('Array.from portable lowering does not accept spread arguments; pass source and mapper directly.');
  }
  // DECIMAL Slice 1 — `Decimal.of(arg)` accepts ONLY a portable string literal:
  // reject a non-string-literal arg AND any literal carrying scale/significance
  // the two engines render divergently. The SAME shared-core checks run on the
  // Python leg, so the refusal is byte-identical across targets.
  validateDecimalConstructionArg(moduleName, methodName, call);
  // DECIMAL Slice 3 — `Decimal.pow(base, exp)` ships INTEGER exponent on a
  // non-negative base ONLY; the shared validator fail-closes a non-integer /
  // non-literal exponent or a negative base with the byte-identical message the
  // Python leg throws.
  validateDecimalPowArgs(moduleName, methodName, call);
  // DECIMAL Slice 3 (robustness) — a Decimal binary/unary op (add/sub/mul/div/mod/
  // pow, neg/abs, the comparators — everything but `of`) takes ONLY Decimal
  // operands. Reject a provably-non-Decimal LITERAL operand (a host number/string/…)
  // with the byte-identical shared diagnostic, closing the silent cross-target
  // divergence `Decimal.eq(Decimal.of("1"), 0.1)` would otherwise emit (TS coerces
  // `0.1`, Python compares the exact binary float). Variables/calls flow through —
  // they MAY be a Decimal (no typed IR yet), the conservative/sound default.
  validateDecimalOperands(moduleName, methodName, call);
  // DECIMAL Slice 3 — a SYNTACTICALLY-ZERO `Decimal.div`/`Decimal.mod` divisor literal
  // (`Decimal.of("0")`) is a provable zero-divide: fail it closed at COMPILE time with
  // the same byte-identical diagnostic the emitted runtime guard throws (a dynamic
  // zero is still caught at runtime). The early-error twin of `assertPortableDecimalPow`.
  validateDecimalDivModArgs(moduleName, methodName, call);
  const listLambda = lowerListLambdaTS(moduleName, methodName, call, ctx);
  if (listLambda !== null) return listLambda;
  // DECIMAL Slice 1 — record the external-package import requirement (e.g.
  // `decimal.js`) into the context sink, mirroring the Python `requires.py` path.
  registerStdlibRequirementTS(entry.requires?.ts, ctx);
  const args = call.args.map((a, index) => {
    const emitted = emitExpression(a, ctx);
    return needsStdlibArgParens(a, entry.ts, index) ? `(${emitted})` : emitted;
  });
  return typeof entry.ts === 'function' ? entry.ts(args) : applyTemplate(entry.ts, args);
}

/** Resolve a node to a regex literal IR, mirroring the Python `resolveRegexExpr`.
 *  The pure-expression TS emitter has no binding table, so only a direct (or
 *  transparently-wrapped) `regexLit` is resolved (the Python target additionally
 *  follows an ident binding; the lowered shapes/fail-closes are otherwise
 *  identical). Transparent wrappers (`as`/`!`) are peeled via
 *  `regexLiteralReceiverIR` so a wrapped portable call `(/x/).test(s)` /
 *  `(/x/ as any).test(s)` lowers, and a wrapped non-portable one
 *  `(/x/ as any).exec(s)` fails-close through `lowerRegexCallTS`. */
function resolveRegexLitTS(node: ValueIR): Extract<ValueIR, { kind: 'regexLit' }> | null {
  return regexLiteralReceiverIR(node);
}

/** Emit the normalized TS regex literal (`/pat/flags`) for a regexLit IR — the
 *  same class/`/i`-fold transform the bare-`regexLit` emit path applies, so a
 *  regex used as a method arg lowers byte-identically to a standalone literal. */
function emitTsRegexLiteral(node: Extract<ValueIR, { kind: 'regexLit' }>): string {
  // Slice 5: fail-close a non-BMP (astral) construct symmetrically with the
  // Python target, so every TS regex-method path (.test/.match/.split/.replace/…)
  // refuses an astral codepoint identically to a standalone literal.
  const astral = scanRegexAstral(node.pattern);
  if (astral !== null) throw new Error(regexAstralFailMessage(astral.char));
  // FIX 2: refuse a non-portable named group symmetrically with the Python target
  // (the same validator runs in `pyRegexPattern`), so every TS regex-method path
  // (.test/.match/.split/.replace/…) fail-closes a Unicode/illegal group name.
  validateRegexNamedGroupsPortable(node.pattern);
  const classed = normalizeRegexClasses(node.pattern);
  const folded = expandRegexIFold(classed, node.flags);
  if ('failClose' in folded) throw new Error(regexIFoldFailMessage(folded.char, folded.reason));
  return `/${folded.pattern}/${node.flags}`;
}

/**
 * Milestone C, Slice 3 — portable regex match-set method lowering (TS side).
 *
 * The TS target uses NATIVE `RegExp` methods, whose results already align with
 * the canonical KERN shapes for `.test` / `.replace` / `.split` / `.matchAll`
 * (boolean / string / array / match-object iterator). The ONE shape that needs a
 * TS-side adapter is `.match` WITHOUT `/g`: native `String.match` returns a
 * `RegExpMatchArray` (`m[0]`, `m[1..n]`, `m.index`, `m.groups`) which carries the
 * same data as the canonical `{full, groups, index, named}` but on a different
 * surface — so a downstream `m.full` / `m.named` would break across targets. We
 * adapt it inline (mirroring the Slice-3 oracle `canonMatchObj`), `null`-safe.
 *
 * Every fail-close decision is made HERE with the SAME shared predicate +
 * messages the Python emitter uses, so the rejection is byte-identical across
 * targets (the parity contract): `.test(/g)`, `.exec`, `.matchAll`/`.replaceAll`
 * without `/g`, and `.split` with a zero-width-capable pattern or a limit arg.
 *
 * Returns `null` when the call is not a regex match-set method on a resolvable
 * regex literal (falls through to the default call emit — e.g. `s.replace(str,…)`
 * with a string first arg is plain `String.replace`, not a regex method).
 */
function lowerRegexCallTS(call: Extract<ValueIR, { kind: 'call' }>): string | null {
  const callee = call.callee;
  if (callee.kind !== 'member') return null;
  if (callee.optional) return null; // `?.match(...)` — leave to default emit

  // --- Receiver-is-regex shapes: `regex.test(s)`, `regex.exec(s)` ---
  const receiverRegex = resolveRegexLitTS(callee.object);
  if (callee.property === 'test' && receiverRegex !== null && call.args.length === 1) {
    if (receiverRegex.flags.includes('g')) throw new Error(REGEX_TEST_G_FAILCLOSE);
    const re = emitTsRegexLiteral(receiverRegex);
    const arg = emitExpression(call.args[0]);
    const wrapped = needsArgParens(call.args[0]) ? `(${arg})` : arg;
    return `${re}.test(${wrapped})`;
  }
  if (callee.property === 'exec' && receiverRegex !== null) {
    throw new Error(REGEX_EXEC_FAILCLOSE);
  }

  // --- Receiver-is-string shapes: arg[0] is the regex ---
  const firstArgRegex = call.args.length >= 1 ? resolveRegexLitTS(call.args[0]) : null;
  const subject = (): string => {
    const obj = emitExpression(callee.object);
    return needsReceiverParens(callee.object) ? `(${obj})` : obj;
  };

  // `.match(s)` — no /g: adapt to the canonical {full,groups,index,named}|null
  // shape (the load-bearing portability fix). With /g: native `String.match`
  // already yields the array of full-match strings | null — emit it verbatim.
  if (callee.property === 'match' && firstArgRegex !== null && call.args.length === 1) {
    const re = emitTsRegexLiteral(firstArgRegex);
    if (firstArgRegex.flags.includes('g')) {
      return `${subject()}.match(${re})`;
    }
    // Inline `null`-safe adapter mirroring the oracle's canonMatchObj. `__m` is a
    // local arrow param (no collision with user names).
    //
    // NAMED-GROUP normalization (Slice-3b parity fix): an UNMATCHED optional
    // named group is `undefined` on the native `RegExpMatchArray.groups`, but
    // Python's `re.Match.groupdict()` returns `None` (= KERN null) for the same
    // key. Copying `.groups` verbatim would diverge the canonical shape for
    // optional named captures (`/(?<a>x)(?<b>y)?/` on "x" → TS `{a:"x"}` vs
    // Python `{a:"x", b:null}`). We map each named value `undefined → null` the
    // SAME way positional groups are normalized, so `named` is shape-identical
    // across targets.
    return (
      `((__m) => __m === null ? null : ` +
      `{ full: __m[0], groups: Array.from(__m).slice(1).map((g) => g === undefined ? null : g), ` +
      `index: __m.index, named: __m.groups ? Object.fromEntries(Object.entries(__m.groups).map(([__k, __v]) => [__k, __v === undefined ? null : __v])) : {} })(${subject()}.match(${re}))`
    );
  }

  // `.matchAll(s)` — requires /g (non-global throws TypeError in JS). Shape the
  // native iterator into [{full,groups,index}, …], incl. zero-width advances.
  if (callee.property === 'matchAll' && firstArgRegex !== null && call.args.length === 1) {
    if (!firstArgRegex.flags.includes('g')) throw new Error(REGEX_MATCHALL_NO_G_FAILCLOSE);
    const re = emitTsRegexLiteral(firstArgRegex);
    return (
      `[...${subject()}.matchAll(${re})].map((__m) => ` +
      `({ full: __m[0], groups: Array.from(__m).slice(1).map((g) => g === undefined ? null : g), index: __m.index }))`
    );
  }

  // `.split(s)` — IN-CORE for a non-zero-width pattern with no limit arg.
  // FAIL-CLOSE on a zero-width-capable pattern or any limit/2nd arg.
  if (callee.property === 'split' && firstArgRegex !== null) {
    if (call.args.length > 1) throw new Error(REGEX_SPLIT_LIMIT_FAILCLOSE);
    if (isZeroWidthCapableRegex(firstArgRegex.pattern)) throw new Error(REGEX_SPLIT_ZEROWIDTH_FAILCLOSE);
    return `${subject()}.split(${emitTsRegexLiteral(firstArgRegex)})`;
  }

  // `.replace(s, r)` / `.replaceAll(s, r)` — native methods produce the right
  // string both with and without /g; `.replaceAll` additionally requires /g.
  //
  // Milestone C, Slice 4 — the JS `$`-surface replacement string IS native on the
  // TS target, so it is emitted VERBATIM (no byte rewrite). But the SHARED
  // fail-close validator runs so the TS target rejects the SAME non-portable
  // tokens the Python translator rejects (`$\``/`$'`, out-of-range numbered ref,
  // unknown/illegal named ref, and a non-literal replacement) — the ts-python
  // lockstep, both targets refuse the same inputs.
  const replaceRegex = call.args.length === 2 ? resolveRegexLitTS(call.args[0]) : null;
  if (callee.property === 'replace' && replaceRegex !== null) {
    validateReplArgTS(call.args[1], replaceRegex);
    const re = emitTsRegexLiteral(replaceRegex);
    return `${subject()}.replace(${re}, ${emitExpression(call.args[1])})`;
  }
  if (callee.property === 'replaceAll' && replaceRegex !== null) {
    if (!replaceRegex.flags.includes('g')) throw new Error(REGEX_REPLACEALL_NO_G_FAILCLOSE);
    validateReplArgTS(call.args[1], replaceRegex);
    const re = emitTsRegexLiteral(replaceRegex);
    return `${subject()}.replaceAll(${re}, ${emitExpression(call.args[1])})`;
  }

  return null;
}

/**
 * Milestone C, Slice 4 — TS-side replacement-argument validation (no rewrite).
 *
 * A STRING-LITERAL replacement is run through the shared validator so a
 * non-portable token (`$\``/`$'`, out-of-range numbered ref, unknown/illegal
 * named ref) fail-closes byte-identically with the Python target. A NON-LITERAL
 * replacement fail-closes symmetrically (it cannot be statically translated on
 * Python). The repl string is otherwise emitted verbatim — JS is the native
 * surface — so there is no byte rewrite here.
 */
function validateReplArgTS(arg: ValueIR, replaceRegex: Extract<ValueIR, { kind: 'regexLit' }>): void {
  if (arg.kind !== 'strLit') {
    throw new Error(REGEX_REPLACE_NONLITERAL_REPL_FAILCLOSE);
  }
  validateReplStringForTS(arg.value, regexCaptureMeta(replaceRegex.pattern));
}

function needsStdlibArgParens(arg: ValueIR, template: StdlibCallEntry['ts'], index: number): boolean {
  if (arg.kind === 'spread') return false;
  if (arg.kind !== 'typeAssert') return needsArgParens(arg);
  if (typeof template === 'function') return true;
  return new RegExp(`\\$${index}(?:\\.|\\[)`).test(template);
}

function throwUnknownStdlibMember(moduleName: string, memberName: string): never {
  const suggestion = suggestStdlibMethod(moduleName, memberName);
  const hint = suggestion ? ` Did you mean '${moduleName}.${suggestion}'?` : '';
  throw new Error(`Unknown KERN-stdlib method/member '${moduleName}.${memberName}'.${hint}`);
}

/** DECIMAL Slice 1 — validate the `Decimal.of(arg)` argument: it must be a STRING
 *  literal carrying canonical (non-divergent) scale. Throws the shared-core
 *  fail-close (identical text on both legs) otherwise. No-op for any other
 *  module/method. Called from BOTH `applyStdlibLoweringTS` and its Python twin. */
export function validateDecimalConstructionArg(
  moduleName: string,
  methodName: string,
  call: Extract<ValueIR, { kind: 'call' }>,
): void {
  if (moduleName !== 'Decimal' || methodName !== 'of') return;
  const arg = call.args[0];
  // Arity (1) is enforced by the table; guard defensively for the 0-arg case.
  if (arg === undefined || arg.kind !== 'strLit') {
    throw new Error(decimalNonStringLiteralFailMessage());
  }
  assertPortableDecimalLiteral(arg.value);
}

/** DECIMAL Slice 3 — compile-time fail-close for `Decimal.pow(base, exp)`: only an
 *  integer-literal exponent on a non-negative base is portable across the two
 *  engines. Delegates to the shared `assertPortableDecimalPow` (byte-identical
 *  message on both legs). No-op for any other module/method. Called from BOTH
 *  `applyStdlibLoweringTS` and its Python twin. */
export function validateDecimalPowArgs(
  moduleName: string,
  methodName: string,
  call: Extract<ValueIR, { kind: 'call' }>,
): void {
  if (moduleName !== 'Decimal' || methodName !== 'pow') return;
  // Arity (2) is enforced by the table before this runs; read positionally.
  assertPortableDecimalPow(call.args[0], call.args[1]);
}

/** DECIMAL Slice 3 (robustness) — reject a provably-non-Decimal LITERAL operand
 *  passed to a Decimal binary/unary op (everything but the `Decimal.of` string
 *  constructor). Delegates to the shared `assertDecimalOperands` (byte-identical
 *  message on both legs). No-op for any other module/method. Called from BOTH
 *  `applyStdlibLoweringTS` and its Python twin so the fail-close is symmetric. */
export function validateDecimalOperands(
  moduleName: string,
  methodName: string,
  call: Extract<ValueIR, { kind: 'call' }>,
): void {
  if (moduleName !== 'Decimal') return;
  assertDecimalOperands(methodName, call.args);
}

/** DECIMAL Slice 3 — compile-time fail-close for a SYNTACTICALLY-ZERO `Decimal.div`/
 *  `Decimal.mod` divisor literal (`Decimal.of("0")`): the early-error twin of the
 *  emitted runtime `b.isZero()` guard. Delegates to the shared
 *  `assertNonZeroDecimalDivisor` (byte-identical message on both legs). A dynamic
 *  zero is still caught by the runtime helper. No-op for any other module/method.
 *  Called from BOTH `applyStdlibLoweringTS` and its Python twin. */
export function validateDecimalDivModArgs(
  moduleName: string,
  methodName: string,
  call: Extract<ValueIR, { kind: 'call' }>,
): void {
  if (moduleName !== 'Decimal') return;
  // Arity (2) is enforced by the table before this runs; the divisor is arg[1].
  assertNonZeroDecimalDivisor(methodName, call.args[1]);
}

function validateStdlibCallArity(
  moduleName: string,
  methodName: string,
  entry: NonNullable<ReturnType<typeof lookupStdlibCall>>,
  got: number,
): void {
  if (entry.arity !== undefined && got !== entry.arity) {
    throw new Error(
      `KERN-stdlib '${moduleName}.${methodName}' takes ${entry.arity} arg${entry.arity === 1 ? '' : 's'}, got ${got}.`,
    );
  }
  if (entry.minArity !== undefined && got < entry.minArity) {
    throw new Error(`KERN-stdlib '${moduleName}.${methodName}' takes at least ${entry.minArity} args, got ${got}.`);
  }
  if (entry.maxArity !== undefined && got > entry.maxArity) {
    throw new Error(`KERN-stdlib '${moduleName}.${methodName}' takes at most ${entry.maxArity} args, got ${got}.`);
  }
}

function lowerListLambdaTS(
  moduleName: string,
  methodName: string,
  call: Extract<ValueIR, { kind: 'call' }>,
  ctx?: ExprEmitContext,
): string | null {
  if (moduleName !== 'List') return null;
  if (methodName !== 'map' && methodName !== 'filter') return null;
  const callback = call.args[1];
  if (callback.kind !== 'lambda') return null;
  const source = emitExpression(call.args[0], ctx);
  const wrappedSource = needsArgParens(call.args[0]) ? `(${source})` : source;
  return `${wrappedSource}.${methodName}(${emitExpression(callback, ctx)})`;
}

/** Slice 2b helper — wrap an arg in parens when it's structurally a binary,
 *  unary, or spread expression. Templates like `'$0.length'` would otherwise
 *  bind member-access tighter than the arg's own ops. */
export function needsArgParens(arg: ValueIR): boolean {
  return (
    arg.kind === 'binary' ||
    arg.kind === 'unary' ||
    arg.kind === 'spread' ||
    arg.kind === 'typeAssert' ||
    arg.kind === 'conditional' ||
    arg.kind === 'await' ||
    arg.kind === 'lambda'
  );
}
