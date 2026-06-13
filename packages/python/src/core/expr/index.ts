/**
 * Shared Python expression lowering — framework-agnostic.
 */

import { PORTABLE_LOGIC_PRIMITIVES, type PortableLogicPrimitiveId } from '@kernlang/core';
import { lowerJsClosureBodyToPython } from '@kernlang/core/node';
import { toSnakeCase } from '../../type-map.js';
import {
  KERN_I32_HELPER_PY,
  KERN_JS_ARRAY_HELPERS_PY,
  KERN_JS_HELPER_PY,
  KERN_JS_OBJECT_HELPERS_PY,
  KERN_JS_STRING_HELPERS_PY,
  KERN_TMOD_HELPER_PY,
} from './helpers.js';
import {
  isSharedPortableArrayMethod,
  isSharedPortableArrayProperty,
  lowerPortableArrayMethodPy,
  lowerPortableArrayPropertyPy,
} from './list-ops.js';

export {
  KERN_FMT_HELPER_PY,
  KERN_I32_HELPER_PY,
  KERN_JS_ARRAY_FROM_HELPER_PY,
  KERN_JS_ARRAY_HELPERS_PY,
  KERN_JS_HELPER_PY,
  KERN_JS_MATH_HELPERS_PY,
  KERN_JS_NUMBER_HELPERS_PY,
  KERN_JS_OBJECT_HELPERS_PY,
  KERN_JS_STRING_HELPERS_PY,
  // Slice S7 — sentinel-aware Json.stringify shim (`_kern_json_stringify`).
  KERN_JSON_STRINGIFY_SHIM_PY,
  // Slice S7 — dual-sentinel nullish/equality substrate
  // (`_kern_is_nullish` / `_kern_strict_equal` / `_kern_loose_equal`).
  KERN_NULLISH_HELPER_PY,
  KERN_PAIR_HELPERS_PY,
  KERN_TMOD_HELPER_PY,
  // Slice-0.75 ToNumericPrimitive substrate. PURE ADDITION: not yet wired into
  // any prelude/helper-block registry and not routed through production — the
  // differential battery (ir-semantics-to-number-py.test.ts) is its only
  // consumer until the future routing slice.
  KERN_TO_NUMBER_HELPER_PY,
} from './helpers.js';

// Quoted strings absorbed by the alternation; only literal `===`/`!==`
// outside strings get rewritten. Both single and double quotes AND
// backtick template literals are covered so a message like
// `` `use ===` `` is preserved. Escape sequences are honored so
// `"\""` / `` `\`` `` etc. don't terminate the string early.
const STRING_LITERAL_ALT = '"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`';
const STRICT_EQ_RE = new RegExp(`${STRING_LITERAL_ALT}|===|!==`, 'g');
// Same trick for JS-literal lowering: any literal text inside a quoted
// string OR after a `.` (property accessor — `obj.true` must NOT become
// `obj.True`, which is a Python SyntaxError) is preserved untouched.
// Variable-width lookbehind `(?<!\.\s*)` handles both tight (`obj.true`)
// and loose (`obj . true`) forms.
const JS_LITERAL_RE = new RegExp(`${STRING_LITERAL_ALT}|(?<!\\.\\s*)\\b(?:undefined|null|true|false)\\b`, 'g');

// Within an arrow body/predicate, rewrite member access on the bound element
// variable to dict-subscript form so iterating a list of dicts works at
// runtime: `x.n` → `x["n"]`, `x.meta.tag` → `x["meta"]["tag"]`. A chain that is
// immediately followed by `(` is a METHOD call (`x.toUpperCase()`) and is left
// untouched for the string-method pass. String-aware (literal `"x.n"` is kept)
// and skips a chain that is itself a property of something else (`body.x.n`).
// Manual scan (no RegExp sticky matching) so single-char fields like `.n` are
// handled — the prior regex required two-plus-char field names.
function lowerDictMemberAccess(text: string, varName: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    const prev = text[i - 1];
    const boundaryOk = !(prev && /[\w.$]/.test(prev));
    const afterVar = text[i + varName.length] ?? '';
    if (boundaryOk && text.startsWith(varName, i) && !/[\w$]/.test(afterVar)) {
      let k = i + varName.length;
      const fields: string[] = [];
      while (text[k] === '.') {
        const fm = text.slice(k + 1).match(/^[A-Za-z_$]\w*/);
        if (!fm) break;
        fields.push(fm[0]);
        k += 1 + fm[0].length;
      }
      if (fields.length > 0) {
        if (text[k] === '(') {
          // Method call: subscript the leading DATA fields but keep the final
          // segment as attribute access (the method name) so the string-method
          // / nested-array passes still see it — `x.name.toUpperCase()` →
          // `x["name"].toUpperCase()`, `x.tags.map(...)` → `x["tags"].map(...)`.
          // A lone `x.method()` is unchanged.
          const dataFields = fields.slice(0, -1);
          const methodField = fields[fields.length - 1];
          out += `${varName + dataFields.map((field) => `[${JSON.stringify(field)}]`).join('')}.${methodField}`;
        } else {
          out += varName + fields.map((field) => `[${JSON.stringify(field)}]`).join('');
        }
        i = k;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

// A statement body that is EXACTLY `{ return E; }` is semantically identical to the
// expression body `E`, so unwrap it to reuse the expression-bodied lowering.
// Richer statement bodies (locals, control flow, side effects
// before the return) need full closure lowering (hoisted nested defs) and are NOT handled
// here — they stay untouched (still unsupported) rather than mis-lowered. The scan is
// string/bracket-aware so `{ return f({a:1}); }` unwraps but `{ return a; more(); }` does not.
function unwrapSingleReturnBlock(body: string): string {
  const t = body.trim();
  if (t.length < 2 || t[0] !== '{' || t[t.length - 1] !== '}') return body;
  const topLevelBreaks = (s: string, breakOnSemicolon: boolean): boolean => {
    let depth = 0;
    let inStr: string | null = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (c === inStr && s[i - 1] !== '\\') inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') inStr = c;
      else if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') {
        depth--;
        // the opening brace must match the FINAL char, else `{..}{..}` etc.
        if (!breakOnSemicolon && depth === 0 && i !== s.length - 1) return true;
      } else if (breakOnSemicolon && c === ';' && depth === 0) return true;
    }
    return false;
  };
  if (topLevelBreaks(t, false)) return body; // outer braces don't span the whole body
  let inner = t.slice(1, -1).trim();
  if (!/^return\b/.test(inner)) return body;
  inner = inner.slice(6).trim();
  if (inner.endsWith(';')) inner = inner.slice(0, -1).trim();
  if (!inner || topLevelBreaks(inner, true)) return body; // empty or multi-statement
  return inner;
}

// Parse an arrow callback's argument text into `{ params, body }`, or null when
// it isn't a single arrow function (e.g. `.map(fn)` with a bare reference, which
// is left unchanged). Handles `(p) => body`, `p => body`, and `(p, i) => body`.
function parseArrowCallback(inner: string): { params: string[]; body: string } | null {
  const trimmed = inner.trim();
  if (trimmed.startsWith('(')) {
    const close = matchBalancedParen(trimmed, 0);
    if (close === -1) return null;
    const after = trimmed.slice(close + 1).trim();
    if (!after.startsWith('=>')) return null;
    const params = splitTopLevelArgs(trimmed.slice(1, close))
      .map((s) => s.trim())
      .filter(Boolean);
    return { params, body: unwrapSingleReturnBlock(after.slice(2).trim()) };
  }
  const m = trimmed.match(/^([A-Za-z_$][\w$]*)\s*=>\s*([\s\S]+)$/);
  if (!m) return null;
  return { params: [m[1]], body: unwrapSingleReturnBlock(m[2].trim()) };
}

// Lower JS arrow-callback array methods to Python comprehensions:
//   arr.filter((x) => pred)      -> [x for x in arr if pred]
//   arr.map((x) => body)         -> [body for x in arr]
//   arr.map((x, i) => body)      -> [body for i, x in enumerate(arr)]
//   arr.find((x) => pred)        -> next((x for x in arr if pred), None)
// Balanced + string-aware scan (NOT regex): the receiver is taken from the
// already-emitted output via findReceiverStart, so chained calls compose
// naturally and the quotes/brackets of a lowered comprehension can never desync the
// receiver. Member access on the bound element is dict-subscripted so a list-of-dicts iterates correctly.
const ARROW_ARRAY_METHODS = new Set(['filter', 'map', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap']);
const PORTABLE_ARRAY_METHODS = new Set([
  'includes',
  'indexOf',
  'join',
  'slice',
  'some',
  'every',
  'reduce',
  'sort',
  'flat',
  'at',
  'push',
  'reverse',
  'concat',
  'fill',
  'lastIndexOf',
  'reduceRight',
]);
const LAMBDA_COLON_PLACEHOLDER = '__KERN_LAMBDA_COLON__';

interface ExprRewriteContext {
  pathParams: string[];
  bodyFields: Set<string>;
  authUser: boolean;
  imports?: Set<string>;
  hoistedDefs?: string[];
  closureSeq?: { n: number };
}

function lowerArrowBlockClosure(arrow: { params: string[]; body: string }, ctx: ExprRewriteContext): string | null {
  if (!arrow.body.trim().startsWith('{')) return null;
  const seq = ctx.closureSeq ?? { n: 0 };
  const name = `__kern_closure_${seq.n++}`;
  if (!ctx.closureSeq) ctx.closureSeq = seq;
  const result = lowerJsClosureBodyToPython(arrow.body, {
    lowerExpression: (raw) =>
      rewriteExpr(
        lowerDictMemberAccess(raw, arrow.params[0]),
        ctx.pathParams,
        ctx.bodyFields,
        ctx.authUser,
        ctx.imports,
        undefined,
        ctx.closureSeq,
      ),
    lowerCondition: (raw) =>
      `js_truthy(${rewriteExpr(
        lowerDictMemberAccess(raw, arrow.params[0]),
        ctx.pathParams,
        ctx.bodyFields,
        ctx.authUser,
        ctx.imports,
        undefined,
        ctx.closureSeq,
      )})`,
    // Closure params are def-locals (never `nonlocal`); the lowerer excludes
    // them and block-locals from the written-free set.
    paramNames: arrow.params,
  });
  if (!result.ok) return null;
  ctx.imports?.add(KERN_JS_HELPER_PY);
  const params = arrow.params.join(', ');
  // Mutation v1 — free-variable WRITES need `nonlocal`. The route hoisted def
  // nests INSIDE the route handler function, so a free capture that the closure
  // writes is a handler-local (a `derive`/method-local). Unlike the class/
  // native path (`emitBlockClosurePy`), the route path has NO loop-pinning
  // concept — every written free name is an outer handler binding and ALL of
  // them get a `nonlocal` declaration. Without it the def shadows the name and
  // raises `UnboundLocalError` (read+write) or silently writes a dead local
  // (write-only) — a live route bug this fixes. `nonlocal` is the def's FIRST
  // body statement (Python requires it before any use). Member/index writes
  // never appear in `writtenFreeNames` (by-reference mutation needs no decl).
  const sortedFreeWrites = [...result.writtenFreeNames].sort();
  const nonlocalLines = sortedFreeWrites.length > 0 ? [`    nonlocal ${sortedFreeWrites.join(', ')}`] : [];
  const bodyLines = result.lines.length > 0 ? result.lines : ['    pass'];
  const def = [`def ${name}(${params}):`, ...nonlocalLines, ...bodyLines].join('\n');
  if (ctx.hoistedDefs) {
    ctx.hoistedDefs.push(def);
  } else {
    ctx.imports?.add(def);
  }
  return `${name}(${arrow.params.join(', ')})`;
}

function lowerJsArrayMethods(expr: string, ctx: ExprRewriteContext): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < expr.length) {
    const c = expr[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += expr[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    const m = expr.slice(i).match(/^\.([A-Za-z]\w*)\(/);
    if (m && ARROW_ARRAY_METHODS.has(m[1])) {
      const method = m[1];
      const openIdx = i + m[0].length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      const recvStart = findReceiverStart(out);
      if (closeIdx !== -1 && recvStart !== -1) {
        const arrow = parseArrowCallback(expr.slice(openIdx + 1, closeIdx));
        if (arrow && arrow.params.length >= 1) {
          const receiver = out.slice(recvStart);
          const pre = out.slice(0, recvStart);
          const elemVar = arrow.params[0];
          const idxVar = arrow.params[1];
          // Recurse for nested array methods in the body; subscript the element
          // var's member access. The index var (if any) stays a bare int.
          const blockClosure = lowerArrowBlockClosure(arrow, ctx);
          const body = blockClosure ?? lowerJsArrayMethods(lowerDictMemberAccess(arrow.body, elemVar), ctx);
          // A second callback param is the element index — bind it via
          // enumerate() for every method, not just map, so a predicate that
          // references the index (`(x, i) => i > 0`) doesn't emit an unbound
          // name.
          const loopTarget = idxVar ? `${idxVar}, ${elemVar}` : elemVar;
          const source = idxVar ? `enumerate(${receiver})` : receiver;
          // filter/find-family predicates wrap the body in `js_truthy(...)`:
          // a predicate that yields a JS-truthy empty container ([] / {}) must be
          // KEPT, but Python treats [] / {} as falsy, so a bare `if body` would
          // wrongly drop it. `js_truthy` restores JS truthiness. (`map`/`flatMap`
          // have no predicate and are left untouched.) The helper lands once.
          ctx.imports?.add(KERN_JS_HELPER_PY);
          let lowered: string;
          if (method === 'filter') {
            lowered = `[${elemVar} for ${loopTarget} in ${source} if js_truthy(${body})]`;
          } else if (method === 'find') {
            lowered = `next((${elemVar} for ${loopTarget} in ${source} if js_truthy(${body})), None)`;
          } else if (method === 'findIndex') {
            // index of the first match, or -1 (never raises). Bind the user's
            // own index var when the callback has one, so `(x, i) => …i…` works.
            const ix = idxVar ?? '__i';
            lowered = `next((${ix} for ${ix}, ${elemVar} in enumerate(${receiver}) if js_truthy(${body})), -1)`;
          } else if (method === 'findLast') {
            // last matching element, or None
            lowered = idxVar
              ? `next((${elemVar} for ${idxVar}, ${elemVar} in reversed(list(enumerate(${receiver}))) if js_truthy(${body})), None)`
              : `next((${elemVar} for ${elemVar} in reversed(${receiver}) if js_truthy(${body})), None)`;
          } else if (method === 'findLastIndex') {
            // index of the last match, or -1
            const ix = idxVar ?? '__i';
            lowered = `next((${ix} for ${ix}, ${elemVar} in reversed(list(enumerate(${receiver}))) if js_truthy(${body})), -1)`;
          } else if (method === 'flatMap') {
            // map, then flatten ONE level — JS flatMap only flattens arrays, so
            // a scalar/string callback result is appended as a single element.
            lowered =
              `[__y for ${loopTarget} in ${source} for __y in (__x if isinstance(__x, list) else [__x])]`.replace(
                /__x/g,
                body,
              );
          } else {
            lowered = `[${body} for ${loopTarget} in ${source}]`;
          }
          out = `${pre}${lowered}`;
          i = closeIdx + 1;
          continue;
        }
      }
    }
    const mArray = expr.slice(i).match(/^\.([A-Za-z]\w*)\(/);
    if (mArray && PORTABLE_ARRAY_METHODS.has(mArray[1])) {
      const method = mArray[1];
      const openIdx = i + mArray[0].length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      const recvStart = findReceiverStart(out);
      if (closeIdx !== -1 && recvStart !== -1) {
        const receiver = out.slice(recvStart);
        const pre = out.slice(0, recvStart);
        const rawArgs = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx));
        const args = rawArgs.map((a) =>
          method === 'fill' ? lowerJsFillArgument(a.trim(), ctx) : lowerJsArrayMethods(a.trim(), ctx),
        );
        let lowered: string | null = null;
        if (isSharedPortableArrayMethod(method)) {
          // Delegate the argument-shape (non-lambda) scalar methods —
          // push/slice/concat/includes/indexOf/join/flat/reverse/at/fill/
          // lastIndexOf — to the single shared list-ops lowering (also used by
          // the class-method body emitter) so routes and class methods can't
          // drift. The shared helper returns null for arg-count shapes it
          // doesn't support (e.g. multi-arg concat), and `lowered` stays null so
          // the caller falls through unchanged — the same gap as the pre-sweep
          // inline branches. The method names here are disjoint from the
          // lambda-bearing some/every/reduce/reduceRight/sort branches below, so
          // chain order does not matter.
          const imports = ctx.imports;
          const portable = method === 'fill' && !imports ? null : lowerPortableArrayMethodPy(receiver, method, args);
          if (portable !== null) {
            if (method === 'fill') {
              imports?.add(KERN_JS_ARRAY_HELPERS_PY);
            }
            lowered = portable;
          }
        } else if (method === 'some' || method === 'every') {
          const arrow = parseArrowCallback(expr.slice(openIdx + 1, closeIdx));
          if (arrow && arrow.params.length >= 1) {
            const elemVar = arrow.params[0];
            const idxVar = arrow.params[1];
            // Only the element var is dict-subscripted; the index var stays a
            // bare int and must be bound via enumerate() when present.
            const blockClosure = lowerArrowBlockClosure(arrow, ctx);
            const pred = blockClosure ?? lowerJsArrayMethods(lowerDictMemberAccess(arrow.body, elemVar), ctx);
            const loopTarget = idxVar ? `${idxVar}, ${elemVar}` : elemVar;
            const source = idxVar ? `enumerate(${receiver})` : receiver;
            // Wrap the predicate in `js_truthy(...)` for JS truthiness parity (a
            // predicate yielding [] / {} is JS-truthy but Python-falsy). Skip the
            // wrap when `pred` is ALREADY a js_truthy(...) call — the block-closure
            // path's `lowerCondition` can emit one — to avoid emit-noise double
            // wrapping (harmless but ugly). The helper lands once.
            const wrappedPred = pred.startsWith('js_truthy(') ? pred : `js_truthy(${pred})`;
            ctx.imports?.add(KERN_JS_HELPER_PY);
            lowered =
              method === 'some'
                ? `any(${wrappedPred} for ${loopTarget} in ${source})`
                : `all(${wrappedPred} for ${loopTarget} in ${source})`;
          }
        } else if (method === 'reduce') {
          const rawArgs = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx));
          const arrow = parseArrowCallback(rawArgs[0] ?? '');
          if (arrow && arrow.params.length >= 2) {
            const accVar = arrow.params[0];
            const elemVar = arrow.params[1];
            let body = lowerDictMemberAccess(arrow.body, accVar);
            body = lowerDictMemberAccess(body, elemVar);
            const loweredBody = lowerJsArrayMethods(body, ctx);
            ctx.imports?.add('import functools');
            if (rawArgs.length >= 2) {
              const seed = lowerJsArrayMethods(rawArgs[1].trim(), ctx);
              lowered = `functools.reduce(lambda ${accVar}, ${elemVar}${LAMBDA_COLON_PLACEHOLDER} ${loweredBody}, ${receiver}, ${seed})`;
            } else {
              lowered = `functools.reduce(lambda ${accVar}, ${elemVar}${LAMBDA_COLON_PLACEHOLDER} ${loweredBody}, ${receiver})`;
            }
          }
        } else if (method === 'reduceRight') {
          // reduce from the right: same callback (acc, cur), reversed sequence.
          const rawArgs = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx));
          const arrow = parseArrowCallback(rawArgs[0] ?? '');
          if (arrow && arrow.params.length >= 2) {
            const accVar = arrow.params[0];
            const elemVar = arrow.params[1];
            let body = lowerDictMemberAccess(arrow.body, accVar);
            body = lowerDictMemberAccess(body, elemVar);
            const loweredBody = lowerJsArrayMethods(body, ctx);
            ctx.imports?.add('import functools');
            if (rawArgs.length >= 2) {
              const seed = lowerJsArrayMethods(rawArgs[1].trim(), ctx);
              lowered = `functools.reduce(lambda ${accVar}, ${elemVar}${LAMBDA_COLON_PLACEHOLDER} ${loweredBody}, ${receiver}[::-1], ${seed})`;
            } else {
              lowered = `functools.reduce(lambda ${accVar}, ${elemVar}${LAMBDA_COLON_PLACEHOLDER} ${loweredBody}, ${receiver}[::-1])`;
            }
          }
        } else if (method === 'sort') {
          // JS default sort is LEXICOGRAPHIC and returns a NEW array.
          // A 2-arg comparator sorts numerically; anything else falls back to the string key.
          const arrow = parseArrowCallback(expr.slice(openIdx + 1, closeIdx));
          if (arrow && arrow.params.length >= 2) {
            const a = arrow.params[0];
            const b = arrow.params[1];
            const body = lowerJsArrayMethods(arrow.body, ctx);
            ctx.imports?.add('import functools');
            lowered = `sorted(${receiver}, key=functools.cmp_to_key(lambda ${a}, ${b}${LAMBDA_COLON_PLACEHOLDER} ${body}))`;
          } else {
            lowered = `sorted(${receiver}, key=lambda __v${LAMBDA_COLON_PLACEHOLDER} str(__v))`;
          }
        }
        if (lowered) {
          out = `${pre}${lowered}`;
          i = closeIdx + 1;
          continue;
        }
      }
    }
    // Portable Array *property* access (non-call `.length`). Matched only when
    // NOT immediately followed by `(` (the method scan above owns call forms),
    // so `arr.length` lowers to `len(arr)` while a hypothetical `arr.length(...)`
    // call is left for the method path. Receiver taken from already-emitted
    // `out` like the method path, so chained forms (`arr.slice(1).length`)
    // compose naturally.
    const mProp = expr.slice(i).match(/^\.([A-Za-z]\w*)(?!\s*\()/);
    if (mProp && isSharedPortableArrayProperty(mProp[1])) {
      const recvStart = findReceiverStart(out);
      if (recvStart !== -1) {
        const receiver = out.slice(recvStart);
        const pre = out.slice(0, recvStart);
        const lowered = lowerPortableArrayPropertyPy(receiver, mProp[1]);
        if (lowered !== null) {
          out = `${pre}${lowered}`;
          i += mProp[0].length;
          continue;
        }
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

// Index of the bracket that closes the one at `openIdx`, tracking ()[]{} depth
// and skipping string/template literals. -1 if unbalanced.
function matchBalancedParen(expr: string, openIdx: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIdx; i < expr.length; i++) {
    const c = expr[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripOuterParens(raw: string): string {
  let trimmed = raw.trim();
  while (trimmed.startsWith('(')) {
    const close = matchBalancedParen(trimmed, 0);
    if (close !== trimmed.length - 1) break;
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function exactVoidOperand(raw: string): string | null {
  const trimmed = stripOuterParens(raw);
  if (!trimmed.startsWith('void')) return null;
  const rest = trimmed.slice('void'.length);
  if (rest === '' || (!/^\s/.test(rest) && !rest.startsWith('('))) return null;
  const operand = rest.trim();
  if (!operand) return null;
  if (operand.startsWith('(')) {
    const close = matchBalancedParen(operand, 0);
    return close === operand.length - 1 ? operand : null;
  }
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < operand.length; i += 1) {
    const c = operand[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      depth += 1;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth < 0) return null;
      continue;
    }
    if (depth === 0 && /[,+\-*/%|&^?:<>=]/.test(c) && !(i === 0 && /[+-]/.test(c))) return null;
  }
  return depth === 0 && !quote ? operand : null;
}

function rewriteExprInContext(raw: string, ctx: ExprRewriteContext): string {
  return rewriteExpr(raw, ctx.pathParams, ctx.bodyFields, ctx.authUser, ctx.imports, ctx.hoistedDefs, ctx.closureSeq);
}

function lowerLogicalAndOr(expr: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < expr.length) {
    const c = expr[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += expr[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (expr.startsWith('&&', i)) {
      out += ' and ';
      i += 2;
      continue;
    }
    if (expr.startsWith('||', i)) {
      out += ' or ';
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function lowerJsVoidExpression(raw: string, ctx: ExprRewriteContext): string {
  const voidOperand = exactVoidOperand(raw);
  if (voidOperand === null) {
    throw new Error(
      'Array.fill void argument lowering expects an exact unary void expression; bind complex void expressions first.',
    );
  }
  return `(${lowerJsVoidOperand(voidOperand, ctx)}, _KERN_UNDEFINED)[1]`;
}

function lowerJsVoidOperand(raw: string, ctx: ExprRewriteContext): string {
  const nestedVoidOperand = exactVoidOperand(raw);
  if (nestedVoidOperand !== null) {
    return lowerJsVoidExpression(raw, ctx);
  }
  return lowerLogicalAndOr(rewriteExprInContext(raw, ctx));
}

function lowerJsFillArgument(raw: string, ctx: ExprRewriteContext): string {
  const trimmed = stripOuterParens(raw);
  if (trimmed === 'undefined') return '_KERN_UNDEFINED';
  const voidOperand = exactVoidOperand(trimmed);
  if (voidOperand !== null) {
    return `(${lowerJsVoidOperand(voidOperand, ctx)}, _KERN_UNDEFINED)[1]`;
  }
  // Fail-closed ONLY on a true `void` OPERATOR with a complex operand
  // (exactVoidOperand already rejected it above). A bare identifier that
  // merely STARTS with "void" (voidValue, voidFn()) is ordinary code and
  // must lower normally — `void` is followed by whitespace or `(` when it
  // is the operator.
  if (/^void(?:\s|\()/.test(trimmed)) {
    return lowerJsVoidExpression(trimmed, ctx);
  }
  return rewriteExprInContext(trimmed, ctx);
}

// Split a call's inner argument text on top-level commas, ignoring commas
// inside nested ()[]{} or string literals.
function splitTopLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(inner.slice(start).trim());
  return args;
}

// ── Host-builtin lowering: Set.has / Date.getTime / logical-not ─────────────
// Portable-pure constructs lifted from the fitvt/job-central R1 audit. Math/
// Number/String/Array builtins are handled by the lower*BuiltinCalls passes
// above; these three were the residual gap (Set membership, epoch-ms dates,
// `!`). Same balanced-scan approach as the sibling passes.

function isCustomReceiverChar(c: string | undefined): boolean {
  return !!c && /[\w.]/.test(c);
}

function lowerSetOperandMemberRead(expr: string): string {
  const simple = expr.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
  if (simple) {
    const [, obj, field] = simple;
    return `(${obj}.get("${field}") if isinstance(${obj}, dict) else ${obj}.${field})`;
  }
  const projection = expr.match(/^\[([A-Za-z_]\w*)\.([A-Za-z_]\w*) for \1 in ([\s\S]+)\]$/);
  if (projection) {
    const [, obj, field, source] = projection;
    return `[${obj}.get("${field}") if isinstance(${obj}, dict) else ${obj}.${field} for ${obj} in ${source}]`;
  }
  return expr;
}

// new Set(arr).has(x) → (x) in set(arr). Runs AFTER array-method lowering so a
// `.map(...)` arg is already a comprehension.
function lowerSetHasCalls(expr: string, _imports?: Set<string>): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < expr.length) {
    const c = expr[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += expr[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }

    const m = expr.slice(i).match(/^new\s+Set\s*\(/);
    if (m && !isCustomReceiverChar(expr[i - 1])) {
      const setOpen = i + m[0].length - 1;
      const setClose = matchBalancedParen(expr, setOpen);
      const afterSet = setClose === -1 ? '' : expr.slice(setClose + 1);
      const hasMatch = afterSet.match(/^\s*\.has\s*\(/);
      if (setClose !== -1 && hasMatch) {
        const hasOpen = setClose + 1 + hasMatch[0].length - 1;
        const hasClose = matchBalancedParen(expr, hasOpen);
        if (hasClose !== -1) {
          // Recurse so nested `new Set(...)` inside the args lowers too.
          const setArg = lowerSetOperandMemberRead(lowerSetHasCalls(expr.slice(setOpen + 1, setClose).trim()));
          const hasArg = lowerSetOperandMemberRead(lowerSetHasCalls(expr.slice(hasOpen + 1, hasClose).trim()));
          out += `(${hasArg}) in set(${setArg})`;
          i = hasClose + 1;
          continue;
        }
      }
    }

    out += c;
    i += 1;
  }
  return out;
}

// new Date(arg).getTime() → epoch milliseconds. Runs BEFORE Math builtins so a
// surrounding Math.round sees an integer.
function lowerDateGetTimeCalls(expr: string, imports?: Set<string>): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < expr.length) {
    const c = expr[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += expr[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }

    const m = expr.slice(i).match(/^new\s+Date\s*\(/);
    if (m && !isCustomReceiverChar(expr[i - 1])) {
      const openIdx = i + m[0].length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1 && expr.slice(closeIdx + 1).match(/^\s*\.getTime\s*\(\s*\)/)) {
        const tail = expr.slice(closeIdx + 1).match(/^\s*\.getTime\s*\(\s*\)/)![0];
        // Recurse so nested new Date(...).getTime() inside the arg lowers too.
        const arg = lowerDateGetTimeCalls(expr.slice(openIdx + 1, closeIdx).trim(), imports);
        imports?.add('from datetime import datetime, timezone');
        // Branch on the runtime value: JS `new Date(n)` accepts epoch-ms numbers
        // (getTime() returns n), else parse an ISO string. Case-insensitive Z.
        // KNOWN LIMITATIONS (tracked follow-ups, beyond the R1 surface): a
        // date-only string carrying a TZ offset ("2026-06-03Z") and non-ISO
        // formats still raise in fromisoformat.
        out +=
          `(lambda __k_v: int(__k_v) if isinstance(__k_v, (int, float)) ` +
          `else int((lambda __k_dt: (__k_dt if __k_dt.tzinfo is not None else __k_dt.replace(tzinfo=timezone.utc)).timestamp() * 1000)` +
          `(datetime.fromisoformat(str(__k_v).replace("Z", "+00:00").replace("z", "+00:00")))))(${arg})`;
        i = closeIdx + 1 + tail.length;
        continue;
      }
    }

    out += c;
    i += 1;
  }
  return out;
}

// `!` → Python `not `. Skips `!=`/`!==`. Runs after the operator/Set passes.
function lowerLogicalNot(expr: string, _imports?: Set<string>): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < expr.length) {
    const c = expr[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += expr[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    // KNOWN LIMITATION (tracked follow-up): `not` binds looser than comparison
    // in Python, so `!a < b` (JS: `(!a) < b`) lowers to `not a < b` (Python:
    // `not (a < b)`). Safe for the boolean-connective uses in the R1 surface.
    if (c === '!' && expr[i + 1] !== '=') {
      out += 'not ';
      i += 1;
      while (i < expr.length && /\s/.test(expr[i])) i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

type PythonPortableLogicPhase = 'beforeMath' | 'afterArrayMethods' | 'final';

interface PythonPortableLogicLowering {
  primitive: PortableLogicPrimitiveId;
  phase: PythonPortableLogicPhase;
  lower: (expr: string, imports?: Set<string>) => string;
}

const PYTHON_PORTABLE_LOGIC_LOWERINGS: readonly PythonPortableLogicLowering[] = [
  {
    primitive: 'time.epochMs',
    phase: 'beforeMath',
    lower: lowerDateGetTimeCalls,
  },
  {
    primitive: 'collection.has',
    phase: 'afterArrayMethods',
    lower: lowerSetHasCalls,
  },
  {
    primitive: 'logic.not',
    phase: 'final',
    lower: lowerLogicalNot,
  },
] as const;

for (const entry of PYTHON_PORTABLE_LOGIC_LOWERINGS) {
  if (PORTABLE_LOGIC_PRIMITIVES[entry.primitive].targets.python !== 'stable') {
    throw new Error(`Portable logic primitive '${entry.primitive}' is not stable on the Python target.`);
  }
}

function lowerPortableLogicPrimitives(
  expr: string,
  imports: Set<string> | undefined,
  phase: PythonPortableLogicPhase,
): string {
  let result = expr;
  for (const entry of PYTHON_PORTABLE_LOGIC_LOWERINGS) {
    if (entry.phase !== phase) continue;
    result = entry.lower(result, imports);
  }
  return result;
}

// Lower JSON.stringify(...) / JSON.parse(...) to json.dumps/loads. Uses a
// balanced, string-aware scan because the single argument can itself contain
// commas, nested parens, brackets, braces, or string literals.
function lowerJsonBuiltinCalls(expr: string, imports?: Set<string>): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < expr.length) {
    const c = expr[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += expr[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    const m = expr.slice(i).match(/^JSON\.(stringify|parse)\(/);
    const prev = expr[i - 1];
    if (m && !(prev && /[\w.]/.test(prev))) {
      const method = m[1];
      const openIdx = i + m[0].length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const args = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx));
        // Recurse so a nested builtin in the argument is lowered too.
        const a0 = lowerJsonBuiltinCalls(args[0] ?? '', imports);
        imports?.add('import json');
        if (method === 'parse') {
          out += `json.loads(${a0})`;
        } else if (args.length >= 3 && /^(None|null)$/.test(args[1]) && /^\d+$/.test(args[2])) {
          out += `json.dumps(${a0}, indent=${args[2]})`;
        } else {
          out += `json.dumps(${a0})`;
        }
        i = closeIdx + 1;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

// Lower Number/Math arithmetic builtins used in portable expressions.
function lowerMathBuiltinCalls(expr: string, imports?: Set<string>): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < expr.length) {
    const c = expr[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += expr[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    const m = expr
      .slice(i)
      .match(
        /^(?:(?:Number|Math)\.(floor|ceil|round|abs|trunc|isFinite|isNaN)|Math\.(min|max|pow|sqrt|hypot|random|sign|log10|log2|log|exp|sin|cos|atan2))\(/,
      );
    const prev = expr[i - 1];
    const cm = expr.slice(i).match(/^Math\.(PI|E)\b/);
    if (cm && !(prev && /[\w.]/.test(prev))) {
      imports?.add('import math as __k_math');
      out += cm[1] === 'PI' ? '__k_math.pi' : '__k_math.e';
      i += cm[0].length;
      continue;
    }
    if (m && !(prev && /[\w.]/.test(prev))) {
      const method = m[1] ?? m[2];
      const openIdx = i + m[0].length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const inner = expr.slice(openIdx + 1, closeIdx);
        const rawArgs = inner.trim() === '' ? [] : splitTopLevelArgs(inner);
        const loweredArgs = rawArgs.map((a) => lowerMathBuiltinCalls(a, imports).trim());
        const arg = loweredArgs[0] ?? '';
        switch (method) {
          case 'floor':
            imports?.add('import math as __k_math');
            out += `__k_math.floor(${arg})`;
            break;
          case 'ceil':
            imports?.add('import math as __k_math');
            out += `__k_math.ceil(${arg})`;
            break;
          case 'round':
            imports?.add('import math as __k_math');
            out += legacyJsRoundExpr(arg);
            break;
          case 'abs':
            out += `abs(${arg})`;
            break;
          case 'trunc':
            imports?.add('import math as __k_math');
            out += `__k_math.trunc(${arg})`;
            break;
          case 'isFinite':
            imports?.add('import math as __k_math');
            out += `(isinstance(${arg}, (int, float)) and __k_math.isfinite(${arg}))`;
            break;
          case 'isNaN':
            imports?.add('import math as __k_math');
            out += `(isinstance(${arg}, (int, float)) and __k_math.isnan(${arg}))`;
            break;
          case 'min':
            if (loweredArgs.length === 0) out += 'float("inf")';
            else if (loweredArgs.length === 1) out += `(${arg})`;
            else out += `min(${loweredArgs.join(', ')})`;
            break;
          case 'max':
            if (loweredArgs.length === 0) out += 'float("-inf")';
            else if (loweredArgs.length === 1) out += `(${arg})`;
            else out += `max(${loweredArgs.join(', ')})`;
            break;
          case 'pow':
            out += loweredArgs.length >= 2 ? `(${loweredArgs[0]} ** ${loweredArgs[1]})` : 'float("nan")';
            break;
          case 'sqrt':
            imports?.add('import math as __k_math');
            out += `__k_math.sqrt(${arg})`;
            break;
          case 'hypot':
            imports?.add('import math as __k_math');
            out += `__k_math.hypot(${loweredArgs.join(', ')})`;
            break;
          case 'random':
            imports?.add('import random as __k_random');
            out += '__k_random.random()';
            break;
          case 'sign':
            out += loweredArgs.length === 0 ? 'float("nan")' : `(1 if ${arg} > 0 else (-1 if ${arg} < 0 else 0))`;
            break;
          case 'log':
            imports?.add('import math as __k_math');
            out += `__k_math.log(${arg})`;
            break;
          case 'log2':
            imports?.add('import math as __k_math');
            out += `__k_math.log2(${arg})`;
            break;
          case 'log10':
            imports?.add('import math as __k_math');
            out += `__k_math.log10(${arg})`;
            break;
          case 'exp':
            imports?.add('import math as __k_math');
            out += `__k_math.exp(${arg})`;
            break;
          case 'sin':
            imports?.add('import math as __k_math');
            out += `__k_math.sin(${arg})`;
            break;
          case 'cos':
            imports?.add('import math as __k_math');
            out += `__k_math.cos(${arg})`;
            break;
          case 'atan2':
            imports?.add('import math as __k_math');
            out += loweredArgs.length >= 2 ? `__k_math.atan2(${loweredArgs[0]}, ${loweredArgs[1]})` : 'float("nan")';
            break;
          default:
            out += expr.slice(i, closeIdx + 1);
            break;
        }
        i = closeIdx + 1;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

function legacyJsRoundExpr(arg: string): string {
  return `(lambda __k_n: __k_n if __k_n != __k_n or __k_n in (float("inf"), float("-inf")) or __k_n == 0 else (lambda __k_floor: (lambda __k_r: -0.0 if __k_r == 0 and __k_n < 0 else __k_r)(__k_floor + (1 if __k_n - __k_floor >= 0.5 else 0)))(__k_math.floor(__k_n)))(${arg})`;
}

// Find the start of the JS expression that ends just before the current position.
function findReceiverStart(s: string): number {
  let j = s.length - 1;
  while (j >= 0 && /\s/.test(s[j])) j--;
  if (j < 0) return -1;

  let depth = 0;
  while (j >= 0) {
    const c = s[j];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      let k = j - 1;
      while (k >= 0) {
        if (s[k] === q) {
          let b = 0;
          let p = k - 1;
          while (p >= 0 && s[p] === '\\') {
            b++;
            p--;
          }
          if (b % 2 === 0) break;
        }
        k--;
      }
      if (depth === 0) return k < 0 ? 0 : k;
      j = k - 1;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth++;
    } else if (c === '(' || c === '[' || c === '{') {
      depth--;
      if (depth < 0) return j + 1;
    } else if (depth === 0) {
      if (!/[\w.$]/.test(c)) return j + 1;
    }
    j--;
  }
  return 0;
}

// Lower Number parsing and formatting builtins.
function lowerNumberBuiltinCalls(expr: string, imports?: Set<string>): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < expr.length) {
    const c = expr[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += expr[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }

    const m = expr
      .slice(i)
      .match(
        /^(?:Number\.isInteger|Number\.isSafeInteger|Number\.parseInt|Number\.parseFloat|Number|parseInt|parseFloat|isNaN|isFinite)\(/,
      );
    const prev = expr[i - 1];
    if (m && !(prev && /[\w.]/.test(prev))) {
      const match = m[0];
      const method = match.slice(0, -1);
      const openIdx = i + match.length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const inner = expr.slice(openIdx + 1, closeIdx);
        const args = splitTopLevelArgs(inner);
        const a0 = lowerNumberBuiltinCalls(args[0] ?? '', imports).trim();
        if (method === 'parseInt' || method === 'Number.parseInt') {
          if (args.length === 1 || (args.length === 2 && args[1].trim() === '10')) {
            out += `int(${a0})`;
          } else {
            const a1 = args[1] ? lowerNumberBuiltinCalls(args[1], imports).trim() : '';
            out += `int(${a0}, ${a1})`;
          }
        } else if (method === 'parseFloat' || method === 'Number.parseFloat') {
          out += `float(${a0})`;
        } else if (method === 'Number.isInteger') {
          out += `(isinstance(${a0}, int) and not isinstance(${a0}, bool))`;
        } else if (method === 'Number.isSafeInteger') {
          imports?.add('import math as __k_math');
          out += `(isinstance(${a0}, (int, float)) and not isinstance(${a0}, bool) and __k_math.isfinite(${a0}) and __k_math.floor(${a0}) == ${a0} and abs(${a0}) <= 9007199254740991)`;
        } else if (method === 'isNaN') {
          imports?.add('import math as __k_math');
          out += `__k_math.isnan(${a0})`;
        } else if (method === 'isFinite') {
          imports?.add('import math as __k_math');
          out += `__k_math.isfinite(${a0})`;
        } else if (method === 'Number') {
          out += `float(${a0})`;
        }
        i = closeIdx + 1;
        continue;
      }
    }

    if (expr.startsWith('.toFixed(', i)) {
      const openIdx = i + '.toFixed('.length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const inner = expr.slice(openIdx + 1, closeIdx);
        const args = splitTopLevelArgs(inner);
        const precision = args[0] ? lowerNumberBuiltinCalls(args[0], imports).trim() : '0';
        const receiverStart = findReceiverStart(out);
        if (receiverStart !== -1) {
          const receiver = out.slice(receiverStart);
          const pre = out.slice(0, receiverStart);
          out = `${pre}format(${receiver}, '.' + str(${precision}) + 'f')`;
          i = closeIdx + 1;
          continue;
        }
      }
    }

    if (expr.startsWith('.toString(', i)) {
      const openIdx = i + '.toString('.length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const args = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx));
        const radix = (args[0] ?? '').trim();
        const spec = radix === '2' ? 'b' : radix === '8' ? 'o' : radix === '16' ? 'x' : null;
        const receiverStart = findReceiverStart(out);
        if (receiverStart !== -1 && (spec || radix === '10')) {
          const receiver = out.slice(receiverStart);
          const pre = out.slice(0, receiverStart);
          out = spec ? `${pre}format(${receiver}, '${spec}')` : `${pre}str(${receiver})`;
          i = closeIdx + 1;
          continue;
        }
      }
    }

    if (expr.startsWith('.toExponential(', i)) {
      const openIdx = i + '.toExponential('.length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const args = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx));
        const digits = args[0] ? lowerNumberBuiltinCalls(args[0], imports).trim() : '';
        const receiverStart = findReceiverStart(out);
        if (receiverStart !== -1 && digits !== '') {
          const receiver = out.slice(receiverStart);
          const pre = out.slice(0, receiverStart);
          imports?.add('import re as __k_re');
          out = `${pre}__k_re.sub(r"e([+-])0*(\\d)", r"e\\1\\2", ('%.' + str(${digits}) + 'e') % (${receiver}))`;
          i = closeIdx + 1;
          continue;
        }
      }
    }

    out += c;
    i += 1;
  }
  return out;
}

// Lower JS string builtins to Python methods.
function lowerStringBuiltinCalls(expr: string): string {
  return expr.replace(
    new RegExp(
      `${STRING_LITERAL_ALT}|\\.toUpperCase\\(\\)|\\.toLowerCase\\(\\)|\\.trim\\(\\)|\\.startsWith\\(|\\.endsWith\\(|\\.padStart\\(|\\.padEnd\\(`,
      'g',
    ),
    (match) => {
      if (match === '.toUpperCase()') return '.upper()';
      if (match === '.toLowerCase()') return '.lower()';
      if (match === '.trim()') return '.strip()';
      if (match === '.startsWith(') return '.startswith(';
      if (match === '.endsWith(') return '.endswith(';
      if (match === '.padStart(') return '.rjust(';
      if (match === '.padEnd(') return '.ljust(';
      return match;
    },
  );
}

// Lower the argument-taking JS String methods.
function lowerStringArgMethods(expr: string, imports?: Set<string>): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < expr.length) {
    const c = expr[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += expr[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (expr.startsWith('.replaceAll(', i)) {
      const openIdx = i + '.replaceAll('.length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const args = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx));
        if (args.length === 2 && !args[0].trim().startsWith('/')) {
          const a0 = lowerStringArgMethods(args[0], imports).trim();
          const a1 = lowerStringArgMethods(args[1], imports).trim();
          const receiverStart = findReceiverStart(out);
          if (receiverStart !== -1 && !isStringLiteralWithoutDollar(a1)) {
            imports?.add(KERN_JS_STRING_HELPERS_PY);
            const receiver = out.slice(receiverStart);
            const pre = out.slice(0, receiverStart);
            out = `${pre}_kern_js_replace(${receiver}, ${a0}, ${a1}, True)`;
          } else {
            out += `.replace(${a0}, ${a1})`;
          }
          i = closeIdx + 1;
          continue;
        }
      }
    }
    if (expr.startsWith('.replace(', i)) {
      const openIdx = i + '.replace('.length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const args = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx));
        if (args.length === 2 && !args[0].trim().startsWith('/')) {
          const a0 = lowerStringArgMethods(args[0], imports).trim();
          const a1 = lowerStringArgMethods(args[1], imports).trim();
          const receiverStart = findReceiverStart(out);
          if (receiverStart !== -1 && !isStringLiteralWithoutDollar(a1)) {
            imports?.add(KERN_JS_STRING_HELPERS_PY);
            const receiver = out.slice(receiverStart);
            const pre = out.slice(0, receiverStart);
            out = `${pre}_kern_js_replace(${receiver}, ${a0}, ${a1}, False)`;
          } else {
            out += `.replace(${a0}, ${a1}, 1)`;
          }
          i = closeIdx + 1;
          continue;
        }
      }
    }
    if (expr.startsWith('.trimStart()', i)) {
      out += '.lstrip()';
      i += '.trimStart()'.length;
      continue;
    }
    if (expr.startsWith('.trimEnd()', i)) {
      out += '.rstrip()';
      i += '.trimEnd()'.length;
      continue;
    }
    if (expr.startsWith('.charAt(', i)) {
      const openIdx = i + '.charAt('.length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const args = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx)).map((a) => lowerStringArgMethods(a).trim());
        const idx = args[0] ?? '0';
        const receiverStart = findReceiverStart(out);
        if (receiverStart !== -1) {
          const receiver = out.slice(receiverStart);
          const pre = out.slice(0, receiverStart);
          out = `${pre}(${receiver}[${idx}] if 0 <= ${idx} < len(${receiver}) else "")`;
          i = closeIdx + 1;
          continue;
        }
      }
    }
    if (expr.startsWith('.charCodeAt(', i) || expr.startsWith('.codePointAt(', i)) {
      const tok = expr.startsWith('.charCodeAt(', i) ? '.charCodeAt(' : '.codePointAt(';
      const openIdx = i + tok.length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const args = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx)).map((a) => lowerStringArgMethods(a).trim());
        const idx = args[0] ?? '0';
        const receiverStart = findReceiverStart(out);
        if (receiverStart !== -1) {
          const receiver = out.slice(receiverStart);
          const pre = out.slice(0, receiverStart);
          out = `${pre}(ord(${receiver}[${idx}]) if 0 <= ${idx} < len(${receiver}) else None)`;
          i = closeIdx + 1;
          continue;
        }
      }
    }
    if (expr.startsWith('.substring(', i)) {
      const openIdx = i + '.substring('.length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const args = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx)).map((a) => lowerStringArgMethods(a).trim());
        const start = args[0] ?? '';
        const end = args[1] ?? '';
        out += `[${start}:${end}]`;
        i = closeIdx + 1;
        continue;
      }
    }
    if (expr.startsWith('.repeat(', i)) {
      const openIdx = i + '.repeat('.length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const args = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx)).map((a) =>
          lowerStringArgMethods(a, imports).trim(),
        );
        const n = args[0] ?? '0';
        const receiverStart = findReceiverStart(out);
        if (receiverStart !== -1) {
          const receiver = out.slice(receiverStart);
          const pre = out.slice(0, receiverStart);
          out = `${pre}(${receiver} * ${n})`;
          i = closeIdx + 1;
          continue;
        }
      }
    }
    if (expr.startsWith('.split(', i)) {
      const openIdx = i + '.split('.length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const args = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx)).map((a) =>
          lowerStringArgMethods(a, imports).trim(),
        );
        if (args.length >= 1 && isEmptyStringLiteral(args[0])) {
          const receiverStart = findReceiverStart(out);
          if (receiverStart !== -1) {
            const receiver = out.slice(receiverStart);
            const pre = out.slice(0, receiverStart);
            out = `${pre}list(${receiver})${args.length === 2 ? `[:${lowerSplitLimit(args[1], imports)}]` : ''}`;
            i = closeIdx + 1;
            continue;
          }
        }
        if (args.length === 2) {
          out += `.split(${args[0]})[:${lowerSplitLimit(args[1], imports)}]`;
          i = closeIdx + 1;
          continue;
        }
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

function isEmptyStringLiteral(expr: string): boolean {
  const t = expr.trim();
  return t === '""' || t === "''" || t === '``';
}

function isStringLiteralWithoutDollar(expr: string): boolean {
  const t = expr.trim();
  if (t.includes('$') || t.includes('\\')) return false;
  return /^(?:"[^"]*"|'[^']*'|`[^`]*`)$/.test(t);
}

function lowerSplitLimit(limit: string, imports?: Set<string>): string {
  imports?.add(KERN_JS_STRING_HELPERS_PY);
  return `_kern_js_split_limit(${limit})`;
}

// Lower selected Object/Array/Date host builtins in portable expressions.
function lowerObjectArrayDateBuiltinCalls(expr: string, imports?: Set<string>): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < expr.length) {
    const c = expr[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += expr[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    const m = expr
      .slice(i)
      .match(/^(Object\.(keys|values|entries|assign|fromEntries)|Array\.(isArray|of)|String\.fromCharCode)\(/);
    const prev = expr[i - 1];
    if (m && !(prev && /[\w.]/.test(prev))) {
      const method = m[1];
      const openIdx = i + m[0].length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const rawArgs = expr.slice(openIdx + 1, closeIdx);
        if (method === 'Object.assign') {
          const args = splitTopLevelArgs(rawArgs)
            .map((a) => lowerObjectArrayDateBuiltinCalls(a, imports).trim())
            .filter(Boolean);
          if (args.length >= 1) {
            out += `{${args.map((a) => (a === 'body' ? '**body.model_dump()' : `**${a}`)).join(', ')}}`;
          } else {
            out += '{}';
          }
        } else if (method === 'Object.fromEntries') {
          const arg = lowerObjectArrayDateBuiltinCalls(rawArgs, imports).trim();
          out += `dict(${arg})`;
        } else if (method === 'Array.of') {
          const args =
            rawArgs.trim() === ''
              ? []
              : splitTopLevelArgs(rawArgs).map((a) => lowerObjectArrayDateBuiltinCalls(a, imports).trim());
          out += `[${args.join(', ')}]`;
        } else if (method === 'String.fromCharCode') {
          const args =
            rawArgs.trim() === ''
              ? []
              : splitTopLevelArgs(rawArgs).map((a) => lowerObjectArrayDateBuiltinCalls(a, imports).trim());
          out +=
            args.length === 0
              ? '""'
              : args.length === 1
                ? `chr(${args[0]})`
                : `''.join(chr(__c) for __c in [${args.join(', ')}])`;
        } else {
          const arg = lowerObjectArrayDateBuiltinCalls(rawArgs, imports).trim();
          if (method === 'Object.keys') {
            imports?.add(KERN_JS_OBJECT_HELPERS_PY);
            out += `_kern_js_object_keys(${arg})`;
          } else if (method === 'Object.values') {
            imports?.add(KERN_JS_OBJECT_HELPERS_PY);
            out += `_kern_js_object_values(${arg})`;
          } else if (method === 'Object.entries') {
            imports?.add(KERN_JS_OBJECT_HELPERS_PY);
            out += `_kern_js_object_entries(${arg})`;
          } else out += `isinstance(${arg}, list)`;
        }
        i = closeIdx + 1;
        continue;
      }
    }
    if (expr.startsWith('Date.now()', i) && !(expr[i - 1] && /[\w.]/.test(expr[i - 1]))) {
      imports?.add('from datetime import datetime, timezone');
      out += 'int(datetime.now(timezone.utc).timestamp() * 1000)';
      i += 'Date.now()'.length;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// Build the Python comprehension for one `Array.from(...)` call's argument list.
function tryLowerArrayFrom(args: string[]): string | null {
  if (args.length < 2) return null;
  const arg0 = args[0].trim();
  if (!arg0.startsWith('{') || matchBalancedParen(arg0, 0) !== arg0.length - 1) return null;
  let count: string | null = null;
  for (const prop of splitTopLevelArgs(arg0.slice(1, -1))) {
    const mm = prop.match(/^(?:length|["']length["'])\s*:\s*([\s\S]+)$/);
    if (mm) {
      count = mm[1].trim();
      break;
    }
  }
  if (count === null) return null;
  const arrowStr = args[1].trim();
  let params: string[];
  let body: string;
  if (arrowStr.startsWith('(')) {
    const pClose = matchBalancedParen(arrowStr, 0);
    if (pClose === -1) return null;
    const after = arrowStr.slice(pClose + 1).trim();
    if (!after.startsWith('=>')) return null;
    params = splitTopLevelArgs(arrowStr.slice(1, pClose))
      .map((s) => s.trim())
      .filter(Boolean);
    body = after.slice(2).trim();
  } else {
    const am = arrowStr.match(/^([A-Za-z_$][\w$]*)\s*=>\s*([\s\S]+)$/);
    if (!am) return null;
    params = [am[1]];
    body = am[2].trim();
  }
  const idxVar = params[1] || '_';
  if (!/^[A-Za-z_$][\w$]*$/.test(idxVar)) return null;
  if (body.startsWith('(') && matchBalancedParen(body, 0) === body.length - 1) {
    const inner = body.slice(1, -1).trim();
    if (inner.startsWith('{')) body = inner;
  }
  return `[${lowerArrayFromCalls(body)} for ${idxVar} in range(${lowerArrayFromCalls(count)})]`;
}

// Expand JS object-literal shorthand properties to explicit `key: key`.
function expandObjectShorthand(expr: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < expr.length) {
    const c = expr[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += expr[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '{') {
      const close = matchBalancedParen(expr, i);
      if (close !== -1) {
        const rebuilt = splitTopLevelArgs(expr.slice(i + 1, close)).map((entry) => {
          const t = entry.trim();
          if (t === '') return entry;
          if (/^[A-Za-z_$][\w$]*$/.test(t)) return `${t}: ${t}`;
          return expandObjectShorthand(entry);
        });
        out += `{${rebuilt.join(', ')}}`;
        i = close + 1;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

// Lower `Array.from({ length: N }, (_, i) => BODY)` to a Python list comprehension.
function lowerArrayFromCalls(expr: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < expr.length) {
    const c = expr[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += expr[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    const m = expr.slice(i).match(/^Array\.from\(/);
    const prev = expr[i - 1];
    if (m && !(prev && /[\w.]/.test(prev))) {
      const openIdx = i + m[0].length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1 && expr[closeIdx + 1] !== '.') {
        const lowered = tryLowerArrayFrom(splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx)));
        if (lowered !== null) {
          out += lowered;
          i = closeIdx + 1;
          continue;
        }
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

type ParsedTemplateLiteral = {
  endIndex: number;
  textParts: string[];
  interpolationParts: string[];
};

function scanQuotedString(expr: string, startIndex: number, quote: '"' | "'"): number {
  for (let i = startIndex + 1; i < expr.length; i++) {
    if (expr[i] === '\\') {
      i += 1;
      continue;
    }
    if (expr[i] === quote) return i;
  }
  return -1;
}

function scanTemplateInterpolationEnd(expr: string, startIndex: number): number {
  let depth = 1;
  for (let i = startIndex; i < expr.length; i++) {
    const c = expr[i];
    if (c === '"' || c === "'") {
      const quotedEnd = scanQuotedString(expr, i, c);
      if (quotedEnd === -1) return -1;
      i = quotedEnd;
      continue;
    }
    if (c === '`') {
      const templateEnd = scanTemplateLiteralEnd(expr, i);
      if (templateEnd === -1) return -1;
      i = templateEnd;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function scanTemplateLiteralEnd(expr: string, startIndex: number): number {
  for (let i = startIndex + 1; i < expr.length; i++) {
    const c = expr[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '`') return i;
    if (c === '$' && expr[i + 1] === '{') {
      const interpolationEnd = scanTemplateInterpolationEnd(expr, i + 2);
      if (interpolationEnd === -1) return -1;
      i = interpolationEnd;
    }
  }
  return -1;
}

function parseTemplateLiteral(expr: string, startIndex: number): ParsedTemplateLiteral | undefined {
  const textParts: string[] = [];
  const interpolationParts: string[] = [];
  let text = '';

  for (let i = startIndex + 1; i < expr.length; ) {
    const c = expr[i];
    if (c === '\\') {
      text += c;
      if (i + 1 < expr.length) text += expr[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      textParts.push(text);
      return { endIndex: i, textParts, interpolationParts };
    }
    if (c === '$' && expr[i + 1] === '{') {
      textParts.push(text);
      text = '';
      const interpolationEnd = scanTemplateInterpolationEnd(expr, i + 2);
      if (interpolationEnd === -1) return undefined;
      interpolationParts.push(expr.slice(i + 2, interpolationEnd));
      i = interpolationEnd + 1;
      continue;
    }
    text += c;
    i += 1;
  }

  return undefined;
}

function escapeJsTemplateTextForPy(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === '`' || next === '$' || next === "'") {
        out += next;
      } else {
        out += `\\${next}`;
      }
      i += 1;
      continue;
    }
    if (c === '\\') out += '\\\\';
    else if (c === '"') out += '\\"';
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else out += c;
  }
  return out;
}

function escapePythonTemplateText(text: string, forFormatTemplate: boolean): string {
  const escaped = escapeJsTemplateTextForPy(text);
  if (!forFormatTemplate) return escaped;
  return escaped.replace(/{/g, '{{').replace(/}/g, '}}');
}

function lowerTemplateLiteralToPython(
  parsed: ParsedTemplateLiteral,
  pathParams: string[],
  bodyFields: Set<string>,
  authUser: boolean,
  imports?: Set<string>,
): string {
  if (parsed.interpolationParts.length === 0) {
    return `"${escapePythonTemplateText(parsed.textParts.join(''), false)}"`;
  }

  const rewrittenInterpolations = parsed.interpolationParts.map((part) =>
    rewriteExpr(part.trim(), pathParams, bodyFields, authUser, imports),
  );

  let fmt = '';
  for (let i = 0; i < parsed.textParts.length; i++) {
    fmt += escapePythonTemplateText(parsed.textParts[i], true);
    if (i < parsed.interpolationParts.length) fmt += '{}';
  }

  return `"${fmt}".format(${rewrittenInterpolations.join(', ')})`;
}

function extractTemplateLiterals(
  expr: string,
  pathParams: string[],
  bodyFields: Set<string>,
  authUser: boolean,
  imports?: Set<string>,
): { maskedExpr: string; replacements: Array<{ placeholder: string; lowered: string }> } {
  let maskedExpr = '';
  const replacements: Array<{ placeholder: string; lowered: string }> = [];
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < expr.length; ) {
    const c = expr[i];
    if (quote) {
      maskedExpr += c;
      if (c === '\\') {
        maskedExpr += expr[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'") {
      quote = c;
      maskedExpr += c;
      i += 1;
      continue;
    }

    if (c === '`') {
      const parsed = parseTemplateLiteral(expr, i);
      if (!parsed) {
        maskedExpr += c;
        i += 1;
        continue;
      }
      const placeholder = `__KERN_TEMPLATE_${replacements.length}__`;
      const lowered = lowerTemplateLiteralToPython(parsed, pathParams, bodyFields, authUser, imports);
      replacements.push({ placeholder, lowered });
      maskedExpr += placeholder;
      i = parsed.endIndex + 1;
      continue;
    }

    maskedExpr += c;
    i += 1;
  }

  return { maskedExpr, replacements };
}

// Lower JS spread elements to Python unpacking.
function lowerSpreadElements(expr: string): string {
  let out = '';
  const stack: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      out += ch;
      i++;
      while (i < expr.length) {
        out += expr[i];
        if (expr[i] === '\\') {
          i++;
          if (i < expr.length) out += expr[i];
          i++;
          continue;
        }
        if (expr[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') {
      stack.push(ch);
      out += ch;
      i++;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      stack.pop();
      out += ch;
      i++;
      continue;
    }
    if (ch === '.' && expr[i + 1] === '.' && expr[i + 2] === '.') {
      out += stack[stack.length - 1] === '{' ? '**' : '*';
      i += 3;
      while (i < expr.length && /\s/.test(expr[i])) i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function isUnarySign(expr: string, index: number): boolean {
  const c = expr[index];
  if (c !== '+' && c !== '-') return false;
  let j = index - 1;
  while (j >= 0 && /\s/.test(expr[j])) j--;
  return j < 0 || /[({[,:?+\-*/%<>=!&|^~]/.test(expr[j]);
}

function findLeftOperandStart(expr: string, opIndex: number, stopChars: string): number {
  let j = opIndex - 1;
  while (j >= 0 && /\s/.test(expr[j])) j--;
  let depth = 0;
  for (; j >= 0; j--) {
    const c = expr[j];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      let k = j - 1;
      while (k >= 0) {
        if (expr[k] === q) {
          let b = 0;
          let p = k - 1;
          while (p >= 0 && expr[p] === '\\') {
            b++;
            p--;
          }
          if (b % 2 === 0) break;
        }
        k--;
      }
      j = k;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      if (depth === 0) return j + 1;
      depth--;
      continue;
    }
    if (depth === 0 && stopChars.includes(c) && !isUnarySign(expr, j)) return j + 1;
  }
  return 0;
}

function findRightOperandEnd(expr: string, startIndex: number, stopChars: string): number {
  let j = startIndex;
  while (j < expr.length && /\s/.test(expr[j])) j++;
  let depth = 0;
  let quote: string | null = null;
  for (; j < expr.length; j++) {
    const c = expr[j];
    if (quote) {
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return j;
      depth--;
      continue;
    }
    if (depth === 0 && stopChars.includes(c) && !isUnarySign(expr, j)) return j;
  }
  return expr.length;
}

function findNextJsOperator(expr: string, op: string, from: number): number {
  let quote: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (i >= from && expr.startsWith(op, i)) return i;
  }
  return -1;
}

function replaceJsOperator(
  expr: string,
  op: string,
  stopChars: string,
  lower: (left: string, right: string) => string,
): string {
  let result = expr;
  let from = 0;
  while (true) {
    const opIndex = findNextJsOperator(result, op, from);
    if (opIndex === -1) return result;
    const leftStart = findLeftOperandStart(result, opIndex, stopChars);
    const rightEnd = findRightOperandEnd(result, opIndex + op.length, stopChars);
    const left = result.slice(leftStart, opIndex).trim();
    const right = result.slice(opIndex + op.length, rightEnd).trim();
    if (!left || !right) {
      from = opIndex + op.length;
      continue;
    }
    const lowered = lower(left, right);
    result = `${result.slice(0, leftStart)}${lowered}${result.slice(rightEnd)}`;
    from = leftStart + lowered.length;
  }
}

function lowerPortableJsOperators(expr: string, imports?: Set<string>): string {
  const multiplicativeStops = ',:?+-*/%<>=!&|^';
  const looseBinaryStops = ',:?';
  let result = expr;
  result = replaceJsOperator(result, '>>>', looseBinaryStops, (l, r) => `((${l} & 0xFFFFFFFF) >> (${r} & 31))`);
  result = replaceJsOperator(result, '%', multiplicativeStops, (l, r) => {
    imports?.add('import math as __k_math');
    return `__k_math.fmod(${l}, ${r})`;
  });
  result = replaceJsOperator(result, '??', looseBinaryStops, (l, r) => `(${l} if ${l} is not None else ${r})`);
  return result;
}

export function quoteObjectKeysOutsideStrings(expr: string): string {
  let output = '';
  let index = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  while (index < expr.length) {
    const char = expr[index];

    if (quote) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      output += char;
      index += 1;
      continue;
    }

    if (char !== '{' && char !== ',') {
      output += char;
      index += 1;
      continue;
    }

    output += char;
    index += 1;
    const whitespaceStart = index;
    while (index < expr.length && /\s/.test(expr[index])) index += 1;
    const whitespace = expr.slice(whitespaceStart, index);
    const keyStart = index;
    if (index < expr.length && /[A-Za-z_$]/.test(expr[index])) {
      index += 1;
      while (index < expr.length && /[\w$]/.test(expr[index])) index += 1;
      const key = expr.slice(keyStart, index);
      const afterKeyStart = index;
      while (index < expr.length && /\s/.test(expr[index])) index += 1;
      if (expr[index] === ':') {
        output += `${whitespace}"${key}"${expr.slice(afterKeyStart, index)}:`;
        index += 1;
        continue;
      }
    }

    output += whitespace;
    output += expr.slice(keyStart, index);
  }

  return output;
}

export function rewriteExpr(
  expr: string,
  pathParams: string[],
  bodyFields: Set<string> = new Set(),
  authUser = false,
  imports?: Set<string>,
  hoistedDefs?: string[],
  closureSeq?: { n: number },
): string {
  try {
    const tokens = tokenizeJSExpr(expr);
    const comparisonProbe = expr.replace(/>>>|>>|<</g, '');
    const hasLooseComparison = /(?:===|!==|==|!=|<=|>=|<|>)/.test(comparisonProbe);
    const hasVoidOperator = /\bvoid\b/.test(expr);
    const hasBitwiseOrModulo =
      !hasVoidOperator &&
      !expr.includes('=>') &&
      !hasLooseComparison &&
      tokens.some((t) => t.type === 'UNARY' || t.type === 'OP');
    if (hasBitwiseOrModulo) {
      const ast = parseTokens(tokens);
      expr = codegenASTToPython(ast, imports);
    }
  } catch (_err) {
    // Graceful fallback
  }

  const { maskedExpr, replacements } = extractTemplateLiterals(expr, pathParams, bodyFields, authUser, imports);
  let result = maskedExpr;
  result = lowerSpreadElements(result);
  result = expandObjectShorthand(result);
  result = lowerArrayFromCalls(result);
  for (const param of pathParams) {
    result = result.replace(new RegExp(`\\bparams\\.${param}\\b`, 'g'), param);
  }
  result = result.replace(/\bparams\.([A-Za-z_]\w*)/g, '$1');
  if (authUser) {
    const USER_FIELD_RE = new RegExp(`${STRING_LITERAL_ALT}|(?<!\\.)\\buser\\.([A-Za-z_]\\w*)`, 'g');
    result = result.replace(USER_FIELD_RE, (match, field) => (field ? `user["${field}"]` : match));
  }
  result = result.replace(/\bbody\.([A-Za-z_]\w*)/g, (match, field) =>
    bodyFields.has(field) ? `body.${toSnakeCase(field)}` : match,
  );
  result = result.replace(/\*\*body\b(?!\s*\.)/g, '**body.model_dump()');
  result = result.replace(/\bquery\.([A-Za-z_]\w*)/g, '$1');
  result = result.replace(/\bheaders\.([A-Za-z_][\w-]*)/g, (_m, key) => `request.headers.get("${key}")`);
  result = result.replace(/\b([A-Za-z_]\w*)\.result\b/g, (_m, name) => toSnakeCase(name));

  result = lowerJsArrayMethods(result, { pathParams, bodyFields, authUser, imports, hoistedDefs, closureSeq });

  result = result.replace(STRICT_EQ_RE, (match) => {
    if (match === '===') return '==';
    if (match === '!==') return '!=';
    return match;
  });

  result = result.replace(JS_LITERAL_RE, (match) => {
    if (match === 'undefined' || match === 'null') return 'None';
    if (match === 'true') return 'True';
    if (match === 'false') return 'False';
    return match;
  });

  result = result.replace(new RegExp(`${STRING_LITERAL_ALT}|(?<![\\w.])crypto\\.randomUUID\\(\\)`, 'g'), (match) => {
    if (match === 'crypto.randomUUID()') {
      imports?.add('import uuid');
      return 'str(uuid.uuid4())';
    }
    return match;
  });

  result = result.replace(
    new RegExp(`${STRING_LITERAL_ALT}|(?<![\\w.])new Date\\(\\)\\.toISOString\\(\\)`, 'g'),
    (match) => {
      if (match === 'new Date().toISOString()') {
        imports?.add('from datetime import datetime, timezone');
        return 'datetime.now(timezone.utc).isoformat()';
      }
      return match;
    },
  );

  result = lowerPortableJsOperators(result, imports);
  result = lowerJsonBuiltinCalls(result, imports);
  result = lowerPortableLogicPrimitives(result, imports, 'beforeMath'); // before Math: Math.round wraps date diffs
  result = lowerMathBuiltinCalls(result, imports);
  result = lowerNumberBuiltinCalls(result, imports);
  result = lowerStringBuiltinCalls(result);
  result = lowerStringArgMethods(result, imports);
  result = lowerObjectArrayDateBuiltinCalls(result, imports);
  result = lowerPortableLogicPrimitives(result, imports, 'afterArrayMethods'); // Set arg may be a .map() comprehension
  result = lowerPortableLogicPrimitives(result, imports, 'final'); // applies to lowered membership/boolean
  result = quoteObjectKeysOutsideStrings(result);

  for (const replacement of replacements) {
    result = result.split(replacement.placeholder).join(replacement.lowered);
  }
  result = result.split(LAMBDA_COLON_PLACEHOLDER).join(':');

  return result;
}

export function extractExprCode(prop: unknown): string {
  if (typeof prop === 'object' && prop !== null && (prop as any).__expr) return (prop as any).code;
  return typeof prop === 'string' ? prop : '';
}

type Token =
  | { type: 'LP' }
  | { type: 'RP' }
  | { type: 'OP'; value: '|' | '&' | '^' | '<<' | '>>' | '%' }
  | { type: 'UNARY'; value: '~' }
  | { type: 'TEXT'; value: string };

function tokenizeJSExpr(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    while (i < expr.length && /\s/.test(expr[i])) {
      i++;
    }
    if (i >= expr.length) break;

    const char = expr[i];

    if (char === '(') {
      tokens.push({ type: 'LP' });
      i++;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'RP' });
      i++;
      continue;
    }
    if (char === '~') {
      tokens.push({ type: 'UNARY', value: '~' });
      i++;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      let val = quote;
      i++;
      while (i < expr.length) {
        const c = expr[i];
        val += c;
        if (c === '\\') {
          val += expr[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (c === quote) {
          i++;
          break;
        }
        i++;
      }
      tokens.push({ type: 'TEXT', value: val });
      continue;
    }

    if (char === '&') {
      if (expr[i + 1] === '&') {
        // Fall through
      } else {
        tokens.push({ type: 'OP', value: '&' });
        i++;
        continue;
      }
    }
    if (char === '|') {
      if (expr[i + 1] === '|') {
        // Fall through
      } else {
        tokens.push({ type: 'OP', value: '|' });
        i++;
        continue;
      }
    }
    if (char === '^' || char === '%') {
      tokens.push({ type: 'OP', value: char });
      i++;
      continue;
    }
    if (char === '<' && expr[i + 1] === '<') {
      tokens.push({ type: 'OP', value: '<<' });
      i += 2;
      continue;
    }
    if (char === '>' && expr[i + 1] === '>' && expr[i + 2] === '>') {
      throw new Error('unsupported-operator: >>> (defer to string lowering)');
    }
    if (char === '>' && expr[i + 1] === '>') {
      tokens.push({ type: 'OP', value: '>>' });
      i += 2;
      continue;
    }

    let text = '';
    while (i < expr.length) {
      const c = expr[i];
      if (c === '(' || c === ')' || c === '~' || c === '^' || c === '%') {
        break;
      }
      if (c === '"' || c === "'" || c === '`') {
        break;
      }
      if (c === '&') {
        if (expr[i + 1] === '&') {
          text += '&&';
          i += 2;
          continue;
        } else {
          break;
        }
      }
      if (c === '|') {
        if (expr[i + 1] === '|') {
          text += '||';
          i += 2;
          continue;
        } else {
          break;
        }
      }
      if (c === '<' && expr[i + 1] === '<') {
        break;
      }
      if (c === '>' && expr[i + 1] === '>') {
        break;
      }
      text += c;
      i++;
    }
    if (text) {
      tokens.push({ type: 'TEXT', value: text.trimEnd() });
    }
  }
  return tokens;
}

interface ASTNode {
  type: 'binary' | 'unary' | 'text' | 'group';
  op?: string;
  left?: ASTNode;
  right?: ASTNode;
  arg?: ASTNode;
  value?: string;
}

function parseTokens(tokens: Token[]): ASTNode {
  let index = 0;

  function peek(): Token | undefined {
    return tokens[index];
  }

  function consume(): Token {
    return tokens[index++];
  }

  function getPrecedence(op: string): number {
    switch (op) {
      case '|':
        return 1;
      case '^':
        return 2;
      case '&':
        return 3;
      case '<<':
      case '>>':
        return 4;
      case '%':
        return 5;
      default:
        return 0;
    }
  }

  function parseExpression(precedence: number): ASTNode {
    let left = parsePrimary();

    while (true) {
      const next = peek();
      if (next?.type !== 'OP') break;

      const opPrecedence = getPrecedence(next.value);
      if (opPrecedence < precedence) break;

      consume();
      const right = parseExpression(opPrecedence + 1);
      left = { type: 'binary', op: next.value, left, right };
    }

    return left;
  }

  function parsePrimary(): ASTNode {
    const t = peek();
    if (!t) throw new Error('Unexpected EOF');

    if (t.type === 'UNARY') {
      consume();
      const arg = parseExpression(6);
      return { type: 'unary', op: t.value, arg };
    }

    if (t.type === 'LP') {
      consume();
      const inner = parseExpression(0);
      const next = peek();
      if (next && next.type === 'RP') {
        consume();
      }
      return { type: 'group', arg: inner };
    }

    if (t.type === 'TEXT') {
      consume();
      return { type: 'text', value: t.value };
    }

    consume();
    return { type: 'text', value: t.type === 'OP' ? t.value : '' };
  }

  return parseExpression(0);
}

function codegenASTToPython(node: ASTNode, imports?: Set<string>): string {
  switch (node.type) {
    case 'text':
      return node.value!;
    case 'group':
      return `(${codegenASTToPython(node.arg!, imports)})`;
    case 'unary': {
      const argStr = codegenASTToPython(node.arg!, imports);
      if (node.op === '~') {
        imports?.add(KERN_I32_HELPER_PY);
        return `_i32(~_i32(${argStr}))`;
      }
      return `${node.op}${argStr}`;
    }
    case 'binary': {
      const leftStr = codegenASTToPython(node.left!, imports);
      const rightStr = codegenASTToPython(node.right!, imports);
      if (node.op === '|') {
        imports?.add(KERN_I32_HELPER_PY);
        return `_i32(_i32(${leftStr}) | _i32(${rightStr}))`;
      }
      if (node.op === '&') {
        imports?.add(KERN_I32_HELPER_PY);
        return `_i32(_i32(${leftStr}) & _i32(${rightStr}))`;
      }
      if (node.op === '^') {
        imports?.add(KERN_I32_HELPER_PY);
        return `_i32(_i32(${leftStr}) ^ _i32(${rightStr}))`;
      }
      if (node.op === '<<') {
        imports?.add(KERN_I32_HELPER_PY);
        return `_i32(_i32(${leftStr}) << (_i32(${rightStr}) & 31))`;
      }
      if (node.op === '>>') {
        imports?.add(KERN_I32_HELPER_PY);
        return `_i32(_i32(${leftStr}) >> (_i32(${rightStr}) & 31))`;
      }
      if (node.op === '%') {
        imports?.add(KERN_TMOD_HELPER_PY);
        return `_tmod(${leftStr}, ${rightStr})`;
      }
      return `${leftStr} ${node.op} ${rightStr}`;
    }
  }
}
