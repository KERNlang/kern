/** Serialize ValueIR to a TypeScript expression string. */

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
  expandRegexIFold,
  isZeroWidthCapableRegex,
  normalizeRegexClasses,
  REGEX_EXEC_FAILCLOSE,
  REGEX_MATCHALL_NO_G_FAILCLOSE,
  REGEX_REPLACE_NONLITERAL_REPL_FAILCLOSE,
  REGEX_REPLACEALL_NO_G_FAILCLOSE,
  REGEX_SPLIT_LIMIT_FAILCLOSE,
  REGEX_SPLIT_ZEROWIDTH_FAILCLOSE,
  REGEX_TEST_G_FAILCLOSE,
  regexCaptureMeta,
  regexIFoldFailMessage,
  validateRegexNamedGroupsPortable,
  validateReplStringForTS,
} from './codegen/regex-normalize.js';
import type { ValueIR } from './value-ir.js';

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

export function emitExpression(node: ValueIR): string {
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
        if (i < node.expressions.length) out += `\${${emitExpression(node.expressions[i])}}`;
      }
      out += '`';
      return out;
    }
    case 'ident':
      return node.name;
    case 'member': {
      const stdlib = applyStdlibPropertyLoweringTS(node);
      if (stdlib !== null) return stdlib;
      const obj = emitExpression(node.object);
      const wrapped = needsReceiverParens(node.object) ? `(${obj})` : obj;
      return `${wrapped}${node.optional ? '?.' : '.'}${node.property}`;
    }
    case 'index': {
      rejectKnownStdlibIndexTS(node);
      const obj = emitExpression(node.object);
      const wrapped = needsReceiverParens(node.object) ? `(${obj})` : obj;
      return `${wrapped}${node.optional ? '?.' : ''}[${emitExpression(node.index)}]`;
    }
    case 'call': {
      // Slice 2a — KERN-stdlib dispatch. When the callee is `Module.method`
      // and `Module` is a known stdlib module, route through the per-target
      // lowering table instead of the default emit path.
      const stdlib = applyStdlibLoweringTS(node);
      if (stdlib !== null) return stdlib;
      // Milestone C, Slice 3 — portable regex match-set methods. Adapt `.match`
      // (no /g) to the canonical KERN shape and fail-close the non-portable
      // shapes IDENTICALLY to the Python target (shared messages + predicate).
      const regexMethod = lowerRegexCallTS(node);
      if (regexMethod !== null) return regexMethod;
      const callee = emitExpression(node.callee);
      const wrapped = needsReceiverParens(node.callee) ? `(${callee})` : callee;
      const args = node.args.map((arg) => emitExpression(arg)).join(', ');
      const typeArgs = node.typeArgs ? `<${node.typeArgs}>` : '';
      return node.optional ? `${wrapped}?.${typeArgs}(${args})` : `${wrapped}${typeArgs}(${args})`;
    }
    case 'lambda': {
      const params =
        !node.parenthesized && node.params.length === 1 && !node.params[0].type
          ? node.params[0].name
          : `(${node.params.map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(', ')})`;
      const returnType = node.returnType ? `: ${node.returnType}` : '';
      // Block-bodied arrow (slices 0+1): re-emit the raw block verbatim. The
      // raw text INCLUDES the outer braces, so emission adds nothing inside it
      // and `parse(emit(x))` reproduces `raw` byte-identically — the round-trip
      // invariant `canonicalKernExpression` relies on.
      if (node.bodyBlock) {
        return `${params}${returnType} => ${node.bodyBlock.raw}`;
      }
      return `${params}${returnType} => ${emitExpression(node.body as ValueIR)}`;
    }
    case 'binary': {
      const left = emitExpression(node.left);
      const right = emitExpression(node.right);
      const lp = needsParens(node.left, node.op, 'left') ? `(${left})` : left;
      const rp = needsParens(node.right, node.op, 'right') ? `(${right})` : right;
      return `${lp} ${node.op} ${rp}`;
    }
    case 'unary': {
      // Slice-2 review fix: wrap binary/unary/spread args in parens to preserve
      // unary's tight binding. `!(a === b)` would otherwise emit `!a === b`.
      const arg = emitExpression(node.argument);
      const wrapped = needsArgParens(node.argument) ? `(${arg})` : arg;
      const sep = node.op === 'typeof' || node.op === 'void' ? ' ' : '';
      return `${node.op}${sep}${wrapped}`;
    }
    case 'spread':
      return `...${emitExpression(node.argument)}`;
    case 'await': {
      const arg = emitExpression(node.argument);
      const wrapped = needsPrefixArgParens(node.argument) ? `(${arg})` : arg;
      return `await ${wrapped}`;
    }
    case 'new': {
      const arg = emitExpression(node.argument);
      const wrapped = needsPrefixArgParens(node.argument) ? `(${arg})` : arg;
      return `new ${wrapped}`;
    }
    case 'typeAssert': {
      const expr = emitExpression(node.expression);
      const wrapped = needsTypeAssertionParens(node.expression) ? `(${expr})` : expr;
      return `${wrapped} as ${node.type}`;
    }
    case 'nonNull': {
      const expr = emitExpression(node.expression);
      const wrapped = needsTypeAssertionParens(node.expression) ? `(${expr})` : expr;
      return `${wrapped}!`;
    }
    case 'objectLit': {
      // Slice 2d — TS object literal. Bare-key when valid identifier; else JSON-quote.
      // Empty object emits `{}` to match JS convention.
      if (node.entries.length === 0) return '{}';
      const entries = node.entries.map((e) => {
        if ('kind' in e && (e as any).kind === 'spread') {
          return `...${emitExpression((e as any).argument)}`;
        }
        const prop = e as { key: string; rawKey?: string; value: ValueIR };
        const k = prop.rawKey ?? (isValidJSIdent(prop.key) ? prop.key : JSON.stringify(prop.key));
        return `${k}: ${emitExpression(prop.value)}`;
      });
      return `{ ${entries.join(', ')} }`;
    }
    case 'arrayLit':
      return `[${node.items.map((item) => emitExpression(item)).join(', ')}]`;
    case 'conditional': {
      // Slice α-2: ternary `test ? consequent : alternate`. Right-associative
      // and lower precedence than every binary op — paren-wrap any non-atomic
      // child to keep the round-tripped TS unambiguous to humans and tools.
      const test = emitExpression(node.test);
      const consequent = emitExpression(node.consequent);
      const alternate = emitExpression(node.alternate);
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

function applyStdlibLoweringTS(call: Extract<ValueIR, { kind: 'call' }>): string | null {
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
  const listLambda = lowerListLambdaTS(moduleName, methodName, call);
  if (listLambda !== null) return listLambda;
  const args = call.args.map((a, index) => {
    const emitted = emitExpression(a);
    return needsStdlibArgParens(a, entry.ts, index) ? `(${emitted})` : emitted;
  });
  return typeof entry.ts === 'function' ? entry.ts(args) : applyTemplate(entry.ts, args);
}

/** Resolve a node to a regex literal IR, mirroring the Python `resolveRegexExpr`.
 *  The pure-expression TS emitter has no binding table, so only a direct
 *  `regexLit` is resolved (the Python target additionally follows an ident
 *  binding; the lowered shapes/fail-closes are otherwise identical). */
function resolveRegexLitTS(node: ValueIR): Extract<ValueIR, { kind: 'regexLit' }> | null {
  return node.kind === 'regexLit' ? node : null;
}

/** Emit the normalized TS regex literal (`/pat/flags`) for a regexLit IR — the
 *  same class/`/i`-fold transform the bare-`regexLit` emit path applies, so a
 *  regex used as a method arg lowers byte-identically to a standalone literal. */
function emitTsRegexLiteral(node: Extract<ValueIR, { kind: 'regexLit' }>): string {
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
): string | null {
  if (moduleName !== 'List') return null;
  if (methodName !== 'map' && methodName !== 'filter') return null;
  const callback = call.args[1];
  if (callback.kind !== 'lambda') return null;
  const source = emitExpression(call.args[0]);
  const wrappedSource = needsArgParens(call.args[0]) ? `(${source})` : source;
  return `${wrappedSource}.${methodName}(${emitExpression(callback)})`;
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
