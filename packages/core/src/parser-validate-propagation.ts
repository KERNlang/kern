/** Slice 7 — `?` and `!` propagation operators.
 *
 *  Walks every `fn` / `method` node whose handler body uses a postfix `?`
 *  or `!` after a call to a Result/Option-producing function, and rewrites
 *  the body with statement-level hoisting:
 *
 *    const u = parseUser(raw)?;       →   const __k_t1 = parseUser(raw);
 *                                          if (__k_t1.kind === 'err') return __k_t1;
 *                                          const u = __k_t1.value;
 *
 *    const u = parseUser(raw)!;       →   const __k_t1 = parseUser(raw);
 *                                          if (__k_t1.kind === 'err') throw new KernUnwrapError(__k_t1);
 *                                          const u = __k_t1.value;
 *
 *  IIFE wrappers were tried in v0 and rejected: their `return` exits the
 *  IIFE, not the enclosing handler, so propagation fell through silently.
 *
 *  Recognition is **name-anchored** at call expressions and accepts a tiny
 *  statement grammar:
 *    1. `(const|let|var) <name>(:<type>)? = <call><op>;`
 *    2. `return <call><op>;`
 *    3. `<call><op>;`
 *  Everything else (mid-expression, `await call()?`, ternary surroundings,
 *  for-headers, JSX attributes, template `${…}`) is rejected with a clear
 *  diagnostic. Bare `obj.prop!` (TypeScript non-null assertion) is preserved
 *  verbatim because pass B skips member-access call sites.
 *
 *  The failure discriminator (`'err'` vs `'none'`) comes from the CALLEE's
 *  kind, not the enclosing function's return type — `Option.some(x)?` always
 *  branches on `'none'` regardless of whether the enclosing fn returns
 *  Result or Option. Mixed cases (`?` on Option callee inside a Result fn)
 *  are rejected.
 *
 *  Diagnostics:
 *    - INVALID_PROPAGATION         — `?` outside a Result/Option fn,
 *                                    mismatched callee/container kind,
 *                                    closure-nested, mid-expression, or
 *                                    `await` in front of the call
 *    - UNSAFE_UNWRAP_IN_RESULT_FN  — soft warning when `!` lives inside
 *                                    a Result/Option-returning fn (`?`
 *                                    keeps the rich error shape)
 *    - NESTED_PROPAGATION          — `expr??` chains rejected; bind to
 *                                    a let between steps */

import type { ParseState } from './parser-diagnostics.js';
import { emitDiagnostic } from './parser-diagnostics.js';
import type { IRNode } from './types.js';

/** The full return string must be exactly `Result<…>` (or `Option<…>`).
 *  Nested generics like `Promise<Result<…>>` or unions like `Result<…> | null`
 *  do NOT classify as Result/Option for propagation purposes — those are
 *  out-of-scope for slice 7 v1 (await? fusion is deferred to v2). */
const RESULT_RETURN_RE = /^Result<[\s\S]*>$/;
const OPTION_RETURN_RE = /^Option<[\s\S]*>$/;

/** Companion-object helpers from slice 4 that actually propagate (return
 *  Result / Option). The non-propagating helpers (`isOk`, `isErr`, `isSome`,
 *  `isNone`, `unwrapOr`) return booleans / unwrapped values and must NOT be
 *  recognised as propagation targets — `Result.isOk(r) ? a : b` is a ternary,
 *  `Result.unwrapOr(null, r)!` is a TS non-null on a plain value. */
const RESULT_PROPAGATING_HELPERS = new Set(['ok', 'err', 'map', 'mapErr', 'andThen']);
const OPTION_PROPAGATING_HELPERS = new Set(['some', 'none', 'map', 'andThen']);

interface PropagationContext {
  /** Identifiers known to return Result<…> in this module. */
  resultFns: Set<string>;
  /** Identifiers known to return Option<…> in this module. */
  optionFns: Set<string>;
  /** Slice 7 v2.1 — identifiers known to return Promise<Result<…>>. */
  asyncResultFns?: Set<string>;
  /** Slice 7 v2.1 — identifiers known to return Promise<Option<…>>. */
  asyncOptionFns?: Set<string>;
}

/** Slice 7 v2 — exported fn signatures of a single KERN module, narrowed
 *  to the names whose `returns` is `Result<…>` / `Option<…>` (sync) or
 *  `Promise<Result<…>>` / `Promise<Option<…>>` (async). */
export interface ModuleExports {
  /** Names of fns / methods exported by the module that return `Result<…>`. */
  resultFns: Set<string>;
  /** Names of fns / methods exported by the module that return `Option<…>`. */
  optionFns: Set<string>;
  /** Slice 7 v2.1 — async fns that return `Promise<Result<…>>` (or any
   *  fn marked `async=true` with a `Result<…>` return). Recognised at
   *  `await call()?` propagation sites. */
  asyncResultFns?: Set<string>;
  /** Slice 7 v2.1 — async fns that return `Promise<Option<…>>`. */
  asyncOptionFns?: Set<string>;
}

/** Slice 7 v2 — caller-supplied resolver mapping a `use path="…"` value to
 *  the imported KERN module's exported fn signatures. Returning `null`
 *  means "this import does not resolve to a KERN module" (bare npm import,
 *  unresolved path, or non-KERN file) — those are skipped silently. The
 *  CLI builds and supplies the resolver after a project-wide pre-pass.
 *  Pure-parse callers (browser playground, tests) can omit it; cross-
 *  module recognition is then disabled. */
export type ImportResolver = (path: string) => ModuleExports | null;

/** Containing-fn return-type classification for the current handler.
 *  `result`/`option` cover the slice 7 v1 sync shapes; `asyncResult` /
 *  `asyncOption` cover slice 7 v2.1 — async fns whose declared return is
 *  `Promise<Result<…>>` / `Promise<Option<…>>` (or marked `async=true`
 *  with the inner Result/Option return). */
type FnReturn = 'result' | 'option' | 'asyncResult' | 'asyncOption' | 'other';

/** Strip an outer `Promise<…>` wrapper if present, returning the inner
 *  text and a flag. Used by `classifyReturn` and the cross-module
 *  registry's identical classifier. */
function unwrapPromise(returns: string): { inner: string; wasPromise: boolean } {
  const trimmed = returns.trim();
  if (trimmed.startsWith('Promise<') && trimmed.endsWith('>')) {
    return { inner: trimmed.slice('Promise<'.length, -1).trim(), wasPromise: true };
  }
  return { inner: trimmed, wasPromise: false };
}

function classifyReturn(returns: unknown, isAsync = false): FnReturn {
  if (typeof returns !== 'string') return 'other';
  const { inner, wasPromise } = unwrapPromise(returns);
  const effectivelyAsync = wasPromise || isAsync;
  if (RESULT_RETURN_RE.test(inner)) return effectivelyAsync ? 'asyncResult' : 'result';
  if (OPTION_RETURN_RE.test(inner)) return effectivelyAsync ? 'asyncOption' : 'option';
  return 'other';
}

/** Inner-kind helper — strips async to its underlying Result/Option family,
 *  used when checking that a callee's kind matches its container. */
function innerKind(k: FnReturn): 'result' | 'option' | 'other' {
  if (k === 'result' || k === 'asyncResult') return 'result';
  if (k === 'option' || k === 'asyncOption') return 'option';
  return 'other';
}

/** Strip JS comments and string literals while preserving byte offsets —
 *  replaces contents with same-length whitespace so positions in the cleaned
 *  string still index back into the original. Mirrors the slice 6 walker. */
function stripCommentsAndStrings(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => `"${' '.repeat(Math.max(0, m.length - 2))}"`)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => `'${' '.repeat(Math.max(0, m.length - 2))}'`)
    .replace(/`(?:[^`\\]|\\.)*`/g, (m) => `\`${' '.repeat(Math.max(0, m.length - 2))}\``);
}

/** Find the matching `)` for the `(` at `openIdx`. */
function findMatchingClose(cleaned: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0 && ch === ')') return i;
    }
  }
  return -1;
}

/** Scan forward from `qPos+1` at depth 0 to determine whether the `?` at
 *  `qPos` is the start of a ternary expression (`expr ? a : b`). Returns
 *  true if a `:` appears at the same paren/brace depth before any `;`/`}`. */
function isTernaryQuestion(cleaned: string, qPos: number): boolean {
  let depth = 0;
  for (let i = qPos + 1; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return false;
      depth--;
    } else if (depth === 0) {
      if (c === ';') return false;
      if (c === ':') return true;
    }
  }
  return false;
}

/** Names that must NOT be treated as method-shorthand bodies even when they
 *  precede a `(...)<ws>{` shape. Control-flow constructs use parentheses
 *  for the test/init expression and braces for the body, but those bodies
 *  are NOT closures — they share the enclosing fn's scope. */
const NOT_A_METHOD_NAME = new Set(['if', 'else', 'while', 'for', 'switch', 'catch', 'with', 'do', 'try', 'finally']);

/** Inspect the `{` at `lbracePos` to decide whether it opens a function
 *  body (one of: `function …() {…}`, `<id>() {…}` method shorthand,
 *  getter/setter `<id>() {…}`). Arrow bodies are handled separately at
 *  `=>` since the back-scan from `{` lands on `>` rather than `)`. */
function looksLikeFunctionBody(cleaned: string, lbracePos: number): boolean {
  let j = lbracePos - 1;
  while (j >= 0 && /\s/.test(cleaned[j])) j--;
  if (j < 0 || cleaned[j] !== ')') return false;

  let openParen = -1;
  {
    let pd = 1;
    for (let k = j - 1; k >= 0; k--) {
      const c = cleaned[k];
      if (c === ')') pd++;
      else if (c === '(') {
        pd--;
        if (pd === 0) {
          openParen = k;
          break;
        }
      }
    }
  }
  if (openParen < 0) return false;

  let k = openParen - 1;
  while (k >= 0 && /\s/.test(cleaned[k])) k--;
  // Optional generic params `<…>` — skip.
  if (k >= 0 && cleaned[k] === '>') {
    let gd = 1;
    k--;
    while (k >= 0 && gd > 0) {
      if (cleaned[k] === '>') gd++;
      else if (cleaned[k] === '<') gd--;
      k--;
    }
    while (k >= 0 && /\s/.test(cleaned[k])) k--;
  }
  const nameEnd = k + 1;
  while (k >= 0 && /[A-Za-z0-9_$]/.test(cleaned[k])) k--;
  const name = cleaned.slice(k + 1, nameEnd);
  if (!name) return false; // `(args) {` standalone — not a recognised shape
  if (name === 'function') return true;
  if (NOT_A_METHOD_NAME.has(name)) return false;
  // Method shorthand, getter, setter, named function expression, etc.
  return true;
}

/** Track function-nesting depth to detect "inside a closure". A `?` inside
 *  a nested arrow / function-expression / method body cannot propagate to
 *  the outer fn — its `return` would belong to the inner closure. */
function buildClosureMap(cleaned: string): boolean[] {
  const depthAt = new Array<boolean>(cleaned.length).fill(false);
  let depth = 0;
  let braceDepth = 0;
  const closingBraceForFn: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];

    if (c === '{') {
      braceDepth++;
      // Decide whether this brace opens a function body (closure) by
      // looking back at the surrounding shape.
      if (looksLikeFunctionBody(cleaned, i)) {
        depth++;
        closingBraceForFn.push(braceDepth);
      }
    } else if (c === '}') {
      if (closingBraceForFn.length > 0 && closingBraceForFn[closingBraceForFn.length - 1] === braceDepth) {
        depth--;
        closingBraceForFn.pop();
      }
      braceDepth--;
    }

    // Arrow function: `=>` (with or without preceding `()`/`x`).
    if (c === '=' && cleaned[i + 1] === '>') {
      let j = i + 2;
      while (j < cleaned.length && /\s/.test(cleaned[j])) j++;
      if (cleaned[j] === '{') {
        // Arrow body is a block — the `{` will be processed in this same
        // loop at index j, but `looksLikeFunctionBody` returns false there
        // (back-scan finds `>` not `)`), so we explicitly mark the body's
        // expected closing brace here.
        depth++;
        closingBraceForFn.push(braceDepth + 1);
      } else {
        // `=> expr` form — body extends until the next unmatched `,`/`;`/closer
        // at the same depth. Mark the whole expression as inside-closure.
        let k = j;
        let pd = 0;
        while (k < cleaned.length) {
          const ch = cleaned[k];
          if (ch === '(' || ch === '[' || ch === '{') pd++;
          else if (ch === ')' || ch === ']' || ch === '}') {
            if (pd === 0) break;
            pd--;
          } else if ((ch === ',' || ch === ';') && pd === 0) break;
          k++;
        }
        for (let m = j; m < k; m++) depthAt[m] = true;
      }
    }

    if (depth > 0) depthAt[i] = true;
  }

  return depthAt;
}

/** A statement shape we can hoist before. Anything that does not match one
 *  of these three shapes is rejected as mid-expression / unsupported. */
type StmtShape =
  | { kind: 'declInit'; declKw: 'const' | 'let' | 'var'; declId: string; typeAnnot: string }
  | { kind: 'return' }
  | { kind: 'exprStmt' };

interface StatementBounds {
  start: number;
  end: number;
  /** True when the back-scan or forward-scan terminated at an unmatched
   *  paren/bracket — the site is inside a parenthesised sub-expression
   *  (e.g. `foo(parse(x)?)`) and must be rejected as mid-expression. */
  insideGrouping: boolean;
}

/** Find the bounds of the statement containing `opPos`. Statement starts
 *  after the previous `;` at depth 0, or after an opening `{` (block start),
 *  or at start-of-body. Ends at the next `;` at depth 0 (inclusive of the
 *  `;`) or end-of-body. If the back-scan or forward-scan encounters an
 *  unmatched `(`/`[` or `)`/`]`, the site is inside a sub-expression. */
function statementBounds(cleaned: string, opPos: number): StatementBounds {
  let start = 0;
  let insideGrouping = false;
  {
    let depth = 0;
    for (let i = opPos - 1; i >= 0; i--) {
      const c = cleaned[i];
      if (c === ')' || c === ']') depth++;
      else if (c === '(' || c === '[') {
        if (depth === 0) {
          start = i + 1;
          insideGrouping = true;
          break;
        }
        depth--;
      } else if (c === '}') depth++;
      else if (c === '{') {
        if (depth === 0) {
          start = i + 1;
          break;
        }
        depth--;
      } else if (depth === 0 && c === ';') {
        start = i + 1;
        break;
      }
    }
  }
  let end = cleaned.length;
  {
    let depth = 0;
    for (let i = opPos + 1; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') {
        if (depth === 0) {
          end = i;
          insideGrouping = true;
          break;
        }
        depth--;
      } else if (c === '{') depth++;
      else if (c === '}') {
        if (depth === 0) {
          end = i;
          break;
        }
        depth--;
      } else if (depth === 0 && c === ';') {
        end = i + 1;
        break;
      }
    }
  }
  return { start, end, insideGrouping };
}

/** Classify the statement around the propagation site. Returns either a
 *  recognised shape or null with a reason for the diagnostic. The optional
 *  `hasAwait` flag indicates whether the call was preceded by `await` — set
 *  by stripping a trailing `await` token from the head before re-matching
 *  the accepted statement grammar. */
function classifyStatement(
  cleaned: string,
  callStart: number,
  opPos: number,
  bounds: StatementBounds,
): { ok: true; shape: StmtShape; hasAwait: boolean } | { ok: false; reason: string } {
  if (bounds.insideGrouping) {
    return { ok: false, reason: 'mid-expression — propagation operator inside a parenthesised sub-expression' };
  }
  // Tail must be empty (or just `;`).
  let tailStart = opPos + 1;
  while (tailStart < bounds.end && /\s/.test(cleaned[tailStart])) tailStart++;
  const tail = cleaned.slice(tailStart, bounds.end).replace(/;\s*$/, '').trim();
  if (tail.length > 0) {
    return { ok: false, reason: 'mid-expression — characters between operator and statement end' };
  }

  // Head is everything before the call within the statement.
  const headRaw = cleaned.slice(bounds.start, callStart).trim();

  // Slice 7 v2.1 — strip a trailing `await` token (or a sole `await`) so the
  // shape matchers can run against the same accepted grammar as the sync
  // forms. `hasAwait` is propagated to the site for validation + lowering.
  let hasAwait = false;
  let head = headRaw;
  const awaitSuffix = /(?:^|\s)await$/;
  if (awaitSuffix.test(head)) {
    hasAwait = true;
    head = head.replace(awaitSuffix, '').trim();
  }

  if (head === '') return { ok: true, shape: { kind: 'exprStmt' }, hasAwait };
  if (head === 'return') return { ok: true, shape: { kind: 'return' }, hasAwait };

  const declMatch = head.match(/^(const|let|var)\s+([A-Za-z_$][\w$]*)(\s*:\s*[\s\S]+?)?\s*=$/);
  if (declMatch) {
    return {
      ok: true,
      shape: {
        kind: 'declInit',
        declKw: declMatch[1] as 'const' | 'let' | 'var',
        declId: declMatch[2],
        typeAnnot: declMatch[3] ?? '',
      },
      hasAwait,
    };
  }

  return {
    ok: false,
    reason: `unsupported statement shape — only declaration init, \`return\`, and expression-statement are accepted (got: "${headRaw}")`,
  };
}

type CalleeKind = 'result' | 'option' | 'asyncResult' | 'asyncOption';

interface PropagationSite {
  callStart: number;
  callEnd: number;
  opPos: number;
  op: '?' | '!';
  callExpr: string;
  callee: string;
  calleeKind: CalleeKind;
  bounds: StatementBounds;
  shape: StmtShape | null; // null when classification failed (we still emit one diagnostic)
  insideClosure: boolean;
  chained: boolean;
  /** Slice 7 v2.1 — `await` was present immediately before the call. */
  hasAwait: boolean;
  /** Reason captured when classification failed (for diagnostic). */
  rejectReason: string | null;
}

/** Walk the cleaned handler body looking for recognised `<callee>(…)<op>`
 *  patterns and classify each. Recognition negatives (optional chaining,
 *  ternary `?:`, comparison `!=`, member access, non-propagating Result/Option
 *  helpers) are SILENTLY skipped. Recognition positives that fail downstream
 *  validation (mid-expression, await, closure-nested) carry a reject reason
 *  for the diagnostic. */
function findPropagationSites(original: string, cleaned: string, ctx: PropagationContext): PropagationSite[] {
  const sites: PropagationSite[] = [];
  const closureMap = buildClosureMap(cleaned);

  const reA = /\b(Result|Option)\.(\w+)\s*\(/g;
  const reB = /\b(\w+)\s*\(/g;

  function maybeRecord(callStart: number, openParen: number, calleeText: string, calleeKind: CalleeKind): void {
    const closeParen = findMatchingClose(cleaned, openParen);
    if (closeParen < 0) return;
    let after = closeParen + 1;
    while (after < cleaned.length && /\s/.test(cleaned[after])) after++;
    const ch = cleaned[after];
    if (ch !== '?' && ch !== '!') return;
    const opPos = after;

    // Recognition negatives — silent skip.
    if (ch === '?' && cleaned[opPos + 1] === '.') return; // `?.` optional chaining
    if (ch === '!' && cleaned[opPos + 1] === '=') return; // `!=` / `!==` comparison
    if (ch === '?' && isTernaryQuestion(cleaned, opPos)) return; // `expr ? a : b`

    const op: '?' | '!' = ch;
    const chained = op === '?' && cleaned[opPos + 1] === '?';
    const insideClosure = !!closureMap[opPos];

    const bounds = statementBounds(cleaned, opPos);
    const cls = classifyStatement(cleaned, callStart, opPos, bounds);

    sites.push({
      callStart,
      callEnd: closeParen,
      opPos,
      op,
      callExpr: original.slice(callStart, closeParen + 1),
      callee: calleeText,
      calleeKind,
      bounds,
      shape: cls.ok ? cls.shape : null,
      insideClosure,
      chained,
      hasAwait: cls.ok ? cls.hasAwait : false,
      rejectReason: cls.ok ? null : cls.reason,
    });
  }

  // Pass A — Result.<helper>(…) / Option.<helper>(…), whitelisted to the
  // helpers that actually return Result / Option.
  for (const m of cleaned.matchAll(reA)) {
    const start = m.index ?? 0;
    const ns = m[1] as 'Result' | 'Option';
    const helper = m[2];
    const propagating =
      ns === 'Result' ? RESULT_PROPAGATING_HELPERS.has(helper) : OPTION_PROPAGATING_HELPERS.has(helper);
    if (!propagating) continue;
    const openParen = start + m[0].length - 1;
    const calleeText = original.slice(start, openParen).trim();
    maybeRecord(start, openParen, calleeText, ns === 'Result' ? 'result' : 'option');
  }

  // Pass B — bare identifier calls, restricted to known result/option fns
  // (sync or async) and excluding member-access (preceded by `.`) so
  // `obj.parse(x)?` is skipped instead of producing an invalid
  // `obj.(() => …)()` rewrite.
  for (const m of cleaned.matchAll(reB)) {
    const start = m.index ?? 0;
    const ident = m[1];
    if (ident === 'Result' || ident === 'Option') continue;
    if (start > 0 && cleaned[start - 1] === '.') continue;
    let calleeKind: CalleeKind | null = null;
    if (ctx.asyncResultFns?.has(ident)) calleeKind = 'asyncResult';
    else if (ctx.asyncOptionFns?.has(ident)) calleeKind = 'asyncOption';
    else if (ctx.resultFns.has(ident)) calleeKind = 'result';
    else if (ctx.optionFns.has(ident)) calleeKind = 'option';
    if (!calleeKind) continue;
    if (sites.some((s) => s.callStart === start)) continue;
    const openParen = start + m[0].length - 1;
    const calleeText = original.slice(start, openParen).trim();
    maybeRecord(start, openParen, calleeText, calleeKind);
  }

  sites.sort((a, b) => a.callStart - b.callStart);
  return sites;
}

let gensymCounter = 0;
function nextGensym(): string {
  gensymCounter += 1;
  return `__k_t${gensymCounter}`;
}

export interface PropagationRewriteResult {
  code: string;
  usedUnwrap: boolean;
}

type DiagCode = 'INVALID_PROPAGATION' | 'NESTED_PROPAGATION' | 'UNSAFE_UNWRAP_IN_RESULT_FN';
type Emit = (code: DiagCode, message: string) => void;

/** Build the hoisted lowering for a single site. */
function buildLowering(site: PropagationSite, tmp: string): string {
  const calleeInner = innerKind(site.calleeKind);
  const failureKind = calleeInner === 'option' ? 'none' : 'err';
  const failBranch = site.op === '?' ? `return ${tmp};` : `throw new KernUnwrapError(${tmp});`;
  // Slice 7 v2.1 — preserve `await` on the awaited call expression so the
  // hoisted temp resolves the Promise BEFORE the discriminant check.
  const callRhs = site.hasAwait ? `await ${site.callExpr}` : site.callExpr;
  const hoist = `const ${tmp} = ${callRhs};\nif (${tmp}.kind === '${failureKind}') ${failBranch}`;
  const shape = site.shape;
  if (!shape) return hoist; // shouldn't reach if shape was null we skipped earlier
  switch (shape.kind) {
    case 'declInit':
      return `${hoist}\n${shape.declKw} ${shape.declId}${shape.typeAnnot ?? ''} = ${tmp}.value;`;
    case 'return':
      return `${hoist}\nreturn ${tmp}.value;`;
    case 'exprStmt':
      return hoist;
  }
}

/** Rewrite a single handler body. Public entry exported for tests. */
export function rewritePropagationInBody(
  code: string,
  fnReturn: FnReturn,
  ctx: PropagationContext,
  emit: Emit,
): PropagationRewriteResult {
  gensymCounter = 0; // deterministic temp names per handler
  const cleaned = stripCommentsAndStrings(code);
  const sites = findPropagationSites(code, cleaned, ctx);
  if (sites.length === 0) return { code, usedUnwrap: false };

  let usedUnwrap = false;
  // Validate + assign temp names in source order so __k_t1, __k_t2, … appear
  // in source order in the rewritten output.
  type AppliedSite = PropagationSite & { tmp: string; apply: boolean };
  const applied: AppliedSite[] = [];
  for (const site of sites) {
    let apply = true;

    if (site.chained) {
      emit(
        'NESTED_PROPAGATION',
        `Chained \`??\` is not supported — bind \`${site.callExpr}\` to a \`const\`/\`let\` between propagations.`,
      );
      apply = false;
    } else if (site.insideClosure) {
      emit(
        'INVALID_PROPAGATION',
        `\`${site.op}\` after \`${site.callExpr}\` sits inside a nested closure — its early-return would belong to the inner function. Lift the propagation outside the closure or use \`match\`.`,
      );
      apply = false;
    } else if (!site.shape) {
      emit(
        'INVALID_PROPAGATION',
        `\`${site.op}\` after \`${site.callExpr}\` is rejected: ${site.rejectReason ?? 'unsupported context'}. Slice 7 v1 supports only \`<call>${site.op};\`, \`return <call>${site.op};\`, and \`(const|let|var) name = <call>${site.op};\`.`,
      );
      apply = false;
    } else {
      // Slice 7 v2.1 — async/await checks BEFORE the kind-match checks so a
      // missing-`await` or stray-`await` site gets a clearer diagnostic
      // (otherwise the kind-match error would dominate).
      const calleeIsAsync = site.calleeKind === 'asyncResult' || site.calleeKind === 'asyncOption';
      const containerIsAsync = fnReturn === 'asyncResult' || fnReturn === 'asyncOption';
      const calleeInner = innerKind(site.calleeKind);
      const containerInner = innerKind(fnReturn);
      const calleeLabel = calleeInner === 'result' ? 'Result' : 'Option';

      if (site.hasAwait && !calleeIsAsync) {
        emit(
          'INVALID_PROPAGATION',
          `\`await\` before \`${site.callee}(...)\` is unnecessary — \`${site.callee}\` returns a sync ${calleeLabel}, not a Promise.`,
        );
        apply = false;
      } else if (!site.hasAwait && calleeIsAsync) {
        emit(
          'INVALID_PROPAGATION',
          `\`${site.callee}(...)\` returns Promise<${calleeLabel}<…>> — write \`await ${site.callee}(...)${site.op}\` so the discriminant check sees the resolved value.`,
        );
        apply = false;
      } else if (site.hasAwait && !containerIsAsync) {
        emit(
          'INVALID_PROPAGATION',
          `\`await\` is only valid inside an \`async=true\` fn or one whose \`returns\` is \`Promise<…>\`. Mark the containing fn async or drop the \`await\`.`,
        );
        apply = false;
      } else if (site.op === '?') {
        if (containerInner === 'other') {
          emit(
            'INVALID_PROPAGATION',
            `\`?\` requires the containing fn to return Result<T, E> or Option<T> — got a fn whose \`returns\` does not match. Use \`!\` to panic, or change the fn's return type.`,
          );
          apply = false;
        } else if (containerInner !== calleeInner) {
          const containerLabel = containerInner === 'result' ? 'Result' : 'Option';
          emit(
            'INVALID_PROPAGATION',
            `\`?\` on a ${calleeLabel} call cannot propagate from a ${containerLabel}-returning fn. Use \`!\` to panic, or convert with \`match\`.`,
          );
          apply = false;
        }
      } else if (site.op === '!' && containerInner === calleeInner) {
        emit(
          'UNSAFE_UNWRAP_IN_RESULT_FN',
          `\`${site.callExpr}!\` panics inside a fn that returns ${calleeLabel} — use \`?\` to propagate the error/none case instead of throwing.`,
        );
        // Soft warning — still rewrite.
      }
    }

    const tmp = apply ? nextGensym() : '';
    applied.push({ ...site, tmp, apply });
    if (apply && site.op === '!') usedUnwrap = true;
  }

  // Apply rewrites in REVERSE statement-bound order so earlier offsets stay
  // valid. Each rewrite replaces the entire enclosing statement
  // [bounds.start, bounds.end) with the lowering.
  let outCode = code;
  for (let i = applied.length - 1; i >= 0; i--) {
    const site = applied[i];
    if (!site.apply) continue;
    const lowering = buildLowering(site, site.tmp);
    outCode = outCode.slice(0, site.bounds.start) + lowering + outCode.slice(site.bounds.end);
  }

  return { code: outCode, usedUnwrap };
}

/** Walk the IR collecting fn/method names whose `returns` is Result/Option.
 *  When `resolveImport` is supplied, also walks `use` nodes and merges in
 *  exported fn signatures from imported KERN modules — `from name=parseUser`
 *  contributes `parseUser` (or its `as=alias` if present) to the local
 *  resultFns/optionFns set. Imports the resolver returns `null` for are
 *  skipped silently. */
function collectKnownFns(root: IRNode, resolveImport?: ImportResolver): PropagationContext {
  const resultFns = new Set<string>();
  const optionFns = new Set<string>();
  const asyncResultFns = new Set<string>();
  const asyncOptionFns = new Set<string>();

  function walk(node: IRNode): void {
    if (node.type === 'fn' || node.type === 'method') {
      const props = node.props || {};
      const name = typeof props.name === 'string' ? props.name : null;
      const returns = props.returns;
      const isAsync = props.async === true || props.async === 'true';
      if (name && typeof returns === 'string') {
        const cls = classifyReturn(returns, isAsync);
        if (cls === 'result') resultFns.add(name);
        else if (cls === 'option') optionFns.add(name);
        else if (cls === 'asyncResult') asyncResultFns.add(name);
        else if (cls === 'asyncOption') asyncOptionFns.add(name);
      }
    } else if (node.type === 'use' && resolveImport) {
      const path = node.props?.path;
      if (typeof path === 'string') {
        const exports = resolveImport(path);
        if (exports) {
          for (const child of node.children || []) {
            if (child.type !== 'from') continue;
            const importedName = child.props?.name;
            if (typeof importedName !== 'string') continue;
            const aliasRaw = child.props?.as;
            const localName = typeof aliasRaw === 'string' && aliasRaw ? aliasRaw : importedName;
            if (exports.resultFns.has(importedName)) resultFns.add(localName);
            if (exports.optionFns.has(importedName)) optionFns.add(localName);
            if (exports.asyncResultFns?.has(importedName)) asyncResultFns.add(localName);
            if (exports.asyncOptionFns?.has(importedName)) asyncOptionFns.add(localName);
          }
        }
      }
    }
    if (node.children) for (const child of node.children) walk(child);
  }

  walk(root);
  return { resultFns, optionFns, asyncResultFns, asyncOptionFns };
}

/** Walk the IR and rewrite every fn/method handler body in place. Returns
 *  the set of nodes whose handlers used `!` so the codegen can decide
 *  whether to add `KernUnwrapError` to the auto-emitted preamble.
 *
 *  Slice 7 v2 — when `resolveImport` is supplied, fn names imported via
 *  `use path="…"` get merged into the recognised set so cross-module
 *  `parseUser(raw)?` calls propagate. The CLI builds the resolver from a
 *  project-wide pre-pass; pure-parse callers omit it and cross-module
 *  recognition is disabled. */
export function validateAndRewritePropagation(
  state: ParseState,
  root: IRNode,
  resolveImport?: ImportResolver,
): { unwrapUsedAnywhere: boolean } {
  const ctx = collectKnownFns(root, resolveImport);
  let unwrapUsedAnywhere = false;

  function walk(node: IRNode): void {
    if (node.type === 'fn' || node.type === 'method') {
      const isAsync = node.props?.async === true || node.props?.async === 'true';
      const fnReturn: FnReturn = classifyReturn(node.props?.returns, isAsync);
      for (const child of node.children || []) {
        if (child.type !== 'handler') continue;
        const code = child.props?.code;
        if (typeof code !== 'string') continue;
        const out = rewritePropagationInBody(code, fnReturn, ctx, (codeName, message) => {
          emitDiagnostic(
            state,
            codeName,
            codeName === 'UNSAFE_UNWRAP_IN_RESULT_FN' ? 'warning' : 'error',
            message,
            node.loc?.line ?? 0,
            node.loc?.col ?? 0,
          );
        });
        if (out.usedUnwrap) unwrapUsedAnywhere = true;
        if (out.code !== code) {
          (child.props as Record<string, unknown>).code = out.code;
        }
      }
    }
    if (node.children) for (const child of node.children) walk(child);
  }

  walk(root);
  return { unwrapUsedAnywhere };
}
