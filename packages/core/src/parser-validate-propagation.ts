/** Slice 7 — `?` and `!` propagation operators.
 *
 *  Walks every `fn` / `method` node whose handler body uses a postfix `?`
 *  or `!` after a call to a Result/Option-producing function, and rewrites
 *  the body to the discriminant-tagged early-return / panic shape:
 *
 *    const u = parseUser(raw)?;       →   const __k_t1 = parseUser(raw);
 *                                          if (__k_t1.kind === 'err') return __k_t1;
 *                                          const u = __k_t1.value;
 *
 *    const u = parseUser(raw)!;       →   const __k_t1 = parseUser(raw);
 *                                          if (__k_t1.kind === 'err') throw new KernUnwrapError(__k_t1);
 *                                          const u = __k_t1.value;
 *
 *  Recognition is **name-anchored** — only calls to known Result/Option-
 *  returning identifiers are rewritten. Bare `obj.prop!` (TypeScript's
 *  non-null assertion) is preserved verbatim. Same-module calls are
 *  recognised by walking the IR for `fn`/`method` nodes whose `returns`
 *  prop matches `Result<…>` or `Option<…>` (compact or explicit form).
 *
 *  This file ships three diagnostics:
 *    - INVALID_PROPAGATION         — `?` outside a Result/Option fn,
 *                                    or applied to an unrecognised callee
 *    - UNSAFE_UNWRAP_IN_RESULT_FN  — soft warning when `!` lives inside
 *                                    a Result/Option-returning fn (`?`
 *                                    keeps the rich error shape)
 *    - NESTED_PROPAGATION          — `expr??` chains rejected; bind to
 *                                    a let between steps */

import type { ParseState } from './parser-diagnostics.js';
import { emitDiagnostic } from './parser-diagnostics.js';
import type { IRNode } from './types.js';

const RESULT_RE = /\bResult<[\s\S]*?>/;
const OPTION_RE = /\bOption<[\s\S]*?>/;

interface PropagationContext {
  /** Set of identifier names that are known to return Result<…> in this module. */
  resultFns: Set<string>;
  /** Set of identifier names that are known to return Option<…> in this module. */
  optionFns: Set<string>;
}

/** Containing-fn return-type classification for the current handler. */
type FnReturn = 'result' | 'option' | 'other';

function classifyReturn(returns: unknown): FnReturn {
  if (typeof returns !== 'string') return 'other';
  if (RESULT_RE.test(returns)) return 'result';
  if (OPTION_RE.test(returns)) return 'option';
  return 'other';
}

/** Strip JS comments and string literals from the source while preserving
 *  byte offsets — replaces contents with same-length whitespace so positions
 *  in the cleaned string still index back into the original. Mirrors the
 *  slice 6 walker (`parser-validate-effects.ts:88`). */
function stripCommentsAndStrings(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => `"${' '.repeat(Math.max(0, m.length - 2))}"`)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => `'${' '.repeat(Math.max(0, m.length - 2))}'`)
    .replace(/`(?:[^`\\]|\\.)*`/g, (m) => `\`${' '.repeat(Math.max(0, m.length - 2))}\``);
}

/** Find the matching `)` for the `(` at `openIdx` in `cleaned`. Returns the
 *  index of the close, or -1 if unbalanced. Brackets `[]` and `{}` are
 *  also balanced so we don't mistake a `)` inside an object literal for
 *  the call's terminator. */
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

interface PropagationSite {
  /** Position in the ORIGINAL code where the call expression starts. */
  callStart: number;
  /** Position immediately AFTER the `?` or `!`. */
  afterOp: number;
  /** Position of the closing `)` of the call (inclusive). */
  callEnd: number;
  /** Position of the operator itself. */
  opPos: number;
  op: '?' | '!';
  callee: string;
  /** True when the call is in a position where its expression value
   *  can be hoisted to a temp (i.e. NOT inside a nested arrow or
   *  function expression within the handler body). */
  hoistable: boolean;
  /** True when followed immediately by another `?` (`expr??`). */
  chained: boolean;
}

/** Track function-nesting depth to detect "inside a closure". A `?` inside
 *  a nested arrow / function-expression cannot propagate to the outer fn —
 *  its `return` would belong to the inner closure. */
function buildClosureMap(cleaned: string): boolean[] {
  // Returns an array indexed by character position. `true` at index i means
  // position i sits inside a nested arrow/function expression (depth > 0).
  const depthAt = new Array<boolean>(cleaned.length).fill(false);
  let depth = 0;
  let braceDepth = 0;
  // Track open `{` of nested functions on a stack, so we know when to pop.
  const closingBraceForFn: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '{') {
      braceDepth++;
    } else if (cleaned[i] === '}') {
      if (closingBraceForFn.length > 0 && closingBraceForFn[closingBraceForFn.length - 1] === braceDepth) {
        depth--;
        closingBraceForFn.pop();
      }
      braceDepth--;
    }

    // Detect arrow function: `=>` (with or without preceding `()`/`x`).
    if (cleaned[i] === '=' && cleaned[i + 1] === '>') {
      // Skip whitespace after `=>` — body could be `=> expr` or `=> { … }`.
      let j = i + 2;
      while (j < cleaned.length && /\s/.test(cleaned[j])) j++;
      if (cleaned[j] === '{') {
        depth++;
        closingBraceForFn.push(braceDepth + 1);
      }
      // For `=> expr` (no brace), the arrow body extends until the next
      // statement boundary. We approximate: anything up to the next
      // unmatched `,` `;` `)` `]` `}` at the same depth is inside the
      // closure. Simpler approximation for v1: just mark the whole
      // remainder of the line as inside-closure. False-positives are OK
      // (we conservatively reject); false-negatives are not.
      else {
        // Mark from j until the end of the current statement.
        let k = j;
        let pd = 0;
        while (k < cleaned.length) {
          const c = cleaned[k];
          if (c === '(' || c === '[' || c === '{') pd++;
          else if (c === ')' || c === ']' || c === '}') {
            if (pd === 0) break;
            pd--;
          } else if ((c === ',' || c === ';') && pd === 0) break;
          k++;
        }
        for (let m = j; m < k; m++) depthAt[m] = true;
      }
    }

    // Detect `function` keyword as the start of a function expression.
    if (
      cleaned.slice(i, i + 8) === 'function' &&
      (i === 0 || /[^A-Za-z0-9_$]/.test(cleaned[i - 1])) &&
      /[^A-Za-z0-9_$]/.test(cleaned[i + 8] ?? ' ')
    ) {
      // Find the next `{` and treat its body as nested.
      let j = i + 8;
      while (j < cleaned.length && cleaned[j] !== '{') j++;
      if (j < cleaned.length) {
        depth++;
        closingBraceForFn.push(braceDepth + 1);
      }
    }

    if (depth > 0) depthAt[i] = true;
  }

  return depthAt;
}

/** Walk the cleaned handler body looking for recognised `<callee>(…)<op>`
 *  patterns. Returns sites in order of appearance. The original code is
 *  passed as well so the returned `callee` substring is the exact source
 *  text (the cleaned code has whitespace where strings used to be).
 *
 *  Recognition rules (name-anchored):
 *    1. `Result.<helper>(…)<op>`    — slice 4 companion-object methods
 *    2. `Option.<helper>(…)<op>`    — slice 4 companion-object methods
 *    3. `<knownFn>(…)<op>`          — calls to fn/method declared in the
 *                                      same module with Result/Option return */
function findPropagationSites(original: string, cleaned: string, ctx: PropagationContext): PropagationSite[] {
  const sites: PropagationSite[] = [];
  const closureMap = buildClosureMap(cleaned);

  // Match call-expression starts. Two patterns:
  //   (a) `Result.<ident>(` or `Option.<ident>(`
  //   (b) `<ident>(` where `<ident>` is in resultFns ∪ optionFns
  // The trailing `(` is consumed; we then balance and look for `?`/`!`.
  const reA = /\b(Result|Option)\.(\w+)\s*\(/g;
  const reB = /\b(\w+)\s*\(/g;

  function recordSiteAt(callStart: number, openParen: number, calleeText: string): void {
    const closeParen = findMatchingClose(cleaned, openParen);
    if (closeParen < 0) return;
    let after = closeParen + 1;
    while (after < cleaned.length && /\s/.test(cleaned[after])) after++;
    const ch = cleaned[after];
    if (ch !== '?' && ch !== '!') return;
    const opPos = after;
    const op: '?' | '!' = ch;
    const next = cleaned[opPos + 1];
    const chained = next === '?';
    sites.push({
      callStart,
      callEnd: closeParen,
      opPos,
      afterOp: opPos + 1,
      op,
      callee: calleeText,
      hoistable: !closureMap[opPos],
      chained,
    });
  }

  // Pass A — Result.* / Option.*
  for (const m of cleaned.matchAll(reA)) {
    const start = m.index ?? 0;
    const openParen = start + m[0].length - 1;
    const calleeText = original.slice(start, start + m[0].length - 1).trim();
    recordSiteAt(start, openParen, calleeText);
  }
  // Pass B — same-module fn/method names with Result/Option return.
  // Skip any starts already covered by pass A so we don't double-record
  // (the bare regex would also match `Result` then `(` separately for
  // `Result.ok(...)` if pass-B were greedy — anchor on word boundary plus
  // the name being in our known set).
  for (const m of cleaned.matchAll(reB)) {
    const start = m.index ?? 0;
    const ident = m[1];
    if (ident === 'Result' || ident === 'Option') continue; // pass A handled this
    if (!ctx.resultFns.has(ident) && !ctx.optionFns.has(ident)) continue;
    // Avoid double-matching if a previous site already starts here.
    if (sites.some((s) => s.callStart === start)) continue;
    const openParen = start + m[0].length - 1;
    const calleeText = original.slice(start, start + m[0].length - 1).trim();
    recordSiteAt(start, openParen, calleeText);
  }

  // Sort by position so rewrites apply left-to-right.
  sites.sort((a, b) => a.callStart - b.callStart);
  return sites;
}

let gensymCounter = 0;
function nextGensym(): string {
  gensymCounter += 1;
  return `__k_t${gensymCounter}`;
}

/** Apply propagation rewrites to a single handler body string.
 *
 *  Returns the rewritten code plus a flag indicating whether any `!`
 *  rewrite happened (so the codegen can pull `KernUnwrapError` into the
 *  module's preamble). Diagnostics are emitted via the supplied state. */
export interface PropagationRewriteResult {
  code: string;
  usedUnwrap: boolean;
}

function rewriteOneSite(
  result: { code: string; offsetDelta: number },
  site: PropagationSite,
  fnReturn: FnReturn,
  diagSink: (d: {
    code: 'INVALID_PROPAGATION' | 'NESTED_PROPAGATION' | 'UNSAFE_UNWRAP_IN_RESULT_FN';
    message: string;
  }) => void,
): { mutated: boolean; usedUnwrap: boolean } {
  // Adjust positions for prior rewrites in the same body.
  const callStart = site.callStart + result.offsetDelta;
  const callEnd = site.callEnd + result.offsetDelta;
  const opPos = site.opPos + result.offsetDelta;
  const callExpr = result.code.slice(callStart, callEnd + 1);

  if (site.chained) {
    diagSink({
      code: 'NESTED_PROPAGATION',
      message: `Chained \`??\` is not supported — bind \`${callExpr}\` to a \`const\`/\`let\` between propagations.`,
    });
    return { mutated: false, usedUnwrap: false };
  }

  if (!site.hoistable) {
    diagSink({
      code: 'INVALID_PROPAGATION',
      message: `\`${site.op}\` after \`${callExpr}\` sits inside a nested closure — its early-return would belong to the inner function. Lift the propagation outside the closure or use \`match\`.`,
    });
    return { mutated: false, usedUnwrap: false };
  }

  if (site.op === '?' && fnReturn === 'other') {
    diagSink({
      code: 'INVALID_PROPAGATION',
      message: `\`?\` requires the containing fn to return Result<T, E> or Option<T> — got a fn whose \`returns\` does not match. Use \`!\` to panic, or change the fn's return type.`,
    });
    return { mutated: false, usedUnwrap: false };
  }

  if (site.op === '!' && (fnReturn === 'result' || fnReturn === 'option')) {
    diagSink({
      code: 'UNSAFE_UNWRAP_IN_RESULT_FN',
      message: `\`${callExpr}!\` panics inside a fn that returns ${fnReturn === 'result' ? 'Result' : 'Option'} — use \`?\` to propagate the error/none case instead of throwing.`,
    });
    // Soft warning — still rewrite.
  }

  // Build the lowering. We replace `callExpr<op>` with a sequence:
  //   const __k_tN = callExpr;
  //   if (__k_tN.kind === 'err'/'none') return __k_tN; OR throw …
  //   __k_tN.value
  //
  // The replacement covers the call, the operator, and is inserted in
  // place of the original `<call><op>` slice. The trailing `;` (if any)
  // belongs to the surrounding statement and is left alone.
  const tmp = nextGensym();
  const failureKind = fnReturn === 'option' ? 'none' : 'err';
  const failBranch = site.op === '?' ? `return ${tmp};` : `throw new KernUnwrapError(${tmp});`;
  const replacement = `(() => { const ${tmp} = ${callExpr}; if (${tmp}.kind === '${failureKind}') ${failBranch} return ${tmp}.value; })()`;

  const before = result.code.slice(0, callStart);
  const after = result.code.slice(opPos + 1);
  result.code = before + replacement + after;
  result.offsetDelta += replacement.length - (callExpr.length + 1);

  return { mutated: true, usedUnwrap: site.op === '!' };
}

/** Rewrite a single handler body. Public entry exported for tests. */
export function rewritePropagationInBody(
  code: string,
  fnReturn: FnReturn,
  ctx: PropagationContext,
  emit: (code: 'INVALID_PROPAGATION' | 'NESTED_PROPAGATION' | 'UNSAFE_UNWRAP_IN_RESULT_FN', message: string) => void,
): PropagationRewriteResult {
  const cleaned = stripCommentsAndStrings(code);
  const sites = findPropagationSites(code, cleaned, ctx);
  if (sites.length === 0) return { code, usedUnwrap: false };

  const acc = { code, offsetDelta: 0 };
  let usedUnwrap = false;
  for (const site of sites) {
    const out = rewriteOneSite(acc, site, fnReturn, (d) => emit(d.code, d.message));
    if (out.usedUnwrap) usedUnwrap = true;
  }
  return { code: acc.code, usedUnwrap };
}

/** Walk the IR collecting fn/method names whose `returns` is Result/Option. */
function collectKnownFns(root: IRNode): PropagationContext {
  const resultFns = new Set<string>();
  const optionFns = new Set<string>();

  function walk(node: IRNode): void {
    if (node.type === 'fn' || node.type === 'method') {
      const props = node.props || {};
      const name = typeof props.name === 'string' ? props.name : null;
      const returns = props.returns;
      if (name && typeof returns === 'string') {
        const cls = classifyReturn(returns);
        if (cls === 'result') resultFns.add(name);
        if (cls === 'option') optionFns.add(name);
      }
    }
    if (node.children) for (const child of node.children) walk(child);
  }

  walk(root);
  return { resultFns, optionFns };
}

/** Walk the IR and rewrite every fn/method handler body in place. Returns
 *  the set of nodes whose handlers used `!` so the codegen can decide
 *  whether to add `KernUnwrapError` to the auto-emitted preamble. */
export function validateAndRewritePropagation(state: ParseState, root: IRNode): { unwrapUsedAnywhere: boolean } {
  const ctx = collectKnownFns(root);
  let unwrapUsedAnywhere = false;

  function walk(node: IRNode): void {
    if (node.type === 'fn' || node.type === 'method') {
      const fnReturn: FnReturn = classifyReturn(node.props?.returns);
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
          // Mutate in place — codegen reads `child.props.code` directly.
          (child.props as Record<string, unknown>).code = out.code;
        }
      }
    }
    if (node.children) for (const child of node.children) walk(child);
  }

  walk(root);
  return { unwrapUsedAnywhere };
}
