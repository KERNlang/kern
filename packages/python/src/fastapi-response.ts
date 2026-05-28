/**
 * Response helpers for the FastAPI transpiler.
 *
 * generateRespondFastAPI — IR respond node → Python return/raise statements
 * rewriteFastAPIExpr    — rewrite portable request references to FastAPI equivalents
 * extractExprCode       — extract expression code from IR prop
 * addRespondImports     — add necessary imports for respond node
 */

import type { IRNode } from '@kernlang/core';
import { getProps, parseExpression, emitExpression } from '@kernlang/core';
import { escapePyStr, quoteObjectKeysOutsideStrings } from './fastapi-utils.js';
import { toSnakeCase } from './type-map.js';
import { lowerBitwiseAndModuloAST, registerHelpers, KERN_I32_HELPER_PY, KERN_TMOD_HELPER_PY } from './codegen-body-python.js';

export function generateRespondFastAPI(respondNode: IRNode, indent: string): string[] {
  const p = getProps(respondNode);
  const status = typeof p.status === 'number' ? p.status : undefined;
  const json = p.json as string | undefined;
  const error = p.error as string | undefined;
  const text = p.text as string | undefined;
  const redirect = p.redirect as string | undefined;

  if (redirect) {
    return [`${indent}return RedirectResponse(url="${escapePyStr(String(redirect))}")`];
  }
  if (error) {
    return [`${indent}raise HTTPException(status_code=${status || 500}, detail="${escapePyStr(String(error))}")`];
  }
  if (json) {
    if (!status || status === 200) {
      return [`${indent}return ${json}`];
    }
    return [`${indent}return JSONResponse(content=${json}, status_code=${status})`];
  }
  if (text) {
    if (!status || status === 200) {
      return [`${indent}return PlainTextResponse(content=${text})`];
    }
    return [`${indent}return PlainTextResponse(content=${text}, status_code=${status})`];
  }
  if (status === 204) {
    return [`${indent}return Response(status_code=204)`];
  }
  if (status) {
    return [`${indent}return Response(status_code=${status})`];
  }
  return [`${indent}return Response(status_code=200)`];
}

// Quoted strings absorbed by the alternation; only literal `===`/`!==`
// outside strings get rewritten. Both single and double quotes AND
// backtick template literals are covered so a message like
// `` `use ===` `` is preserved (review fix — Codex+Gemini on 0ddfcc3d
// flagged backticks as missing). Escape sequences are honored so
// `"\""` / `` `\`` `` etc. don't terminate the string early.
const STRING_LITERAL_ALT = '"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`';
const STRICT_EQ_RE = new RegExp(`${STRING_LITERAL_ALT}|===|!==`, 'g');
// Same trick for JS-literal lowering: any literal text inside a quoted
// string OR after a `.` (property accessor — `obj.true` must NOT become
// `obj.True`, which is a Python SyntaxError) is preserved untouched.
// Variable-width lookbehind `(?<!\.\s*)` handles both tight (`obj.true`)
// and loose (`obj . true`) forms; the latter caught by Codex review on
// commit 68565826.
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
          // `x["name"].toUpperCase()`, `x.tags.map(...)` → `x["tags"].map(...)`
          // (codex review of ab192611). A lone `x.method()` is unchanged.
          const dataFields = fields.slice(0, -1);
          const methodField = fields[fields.length - 1];
          out += varName + dataFields.map((field) => `[${JSON.stringify(field)}]`).join('') + `.${methodField}`;
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
    return { params, body: after.slice(2).trim() };
  }
  const m = trimmed.match(/^([A-Za-z_$][\w$]*)\s*=>\s*([\s\S]+)$/);
  if (!m) return null;
  return { params: [m[1]], body: m[2].trim() };
}

// Lower JS arrow-callback array methods to Python comprehensions:
//   arr.filter((x) => pred)      -> [x for x in arr if pred]
//   arr.map((x) => body)         -> [body for x in arr]
//   arr.map((x, i) => body)      -> [body for i, x in enumerate(arr)]
//   arr.find((x) => pred)        -> next((x for x in arr if pred), None)
// Balanced + string-aware scan (NOT regex): the receiver is taken from the
// already-emitted output via findReceiverStart, so chained calls compose
// naturally (`arr.filter(...).map(...)` nests one comprehension inside the
// next) and the quotes/brackets of a lowered comprehension can never desync the
// receiver — the failure mode of the prior regex form. Member access on the
// bound element is dict-subscripted so a list-of-dicts iterates correctly.
const ARROW_ARRAY_METHODS = new Set(['filter', 'map', 'find']);
const PORTABLE_ARRAY_METHODS = new Set(['includes', 'indexOf', 'join', 'slice', 'some', 'every', 'reduce']);
const LAMBDA_COLON_PLACEHOLDER = '__KERN_LAMBDA_COLON__';

function lowerJsArrayMethods(expr: string, imports?: Set<string>): string {
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
          const body = lowerJsArrayMethods(lowerDictMemberAccess(arrow.body, elemVar), imports);
          // A second callback param is the element index — bind it via
          // enumerate() for every method, not just map, so a predicate that
          // references the index (`(x, i) => i > 0`) doesn't emit an unbound
          // name (codex review of ab192611).
          const loopTarget = idxVar ? `${idxVar}, ${elemVar}` : elemVar;
          const source = idxVar ? `enumerate(${receiver})` : receiver;
          let lowered: string;
          if (method === 'filter') {
            lowered = `[${elemVar} for ${loopTarget} in ${source} if ${body}]`;
          } else if (method === 'find') {
            lowered = `next((${elemVar} for ${loopTarget} in ${source} if ${body}), None)`;
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
        const args = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx)).map((a) =>
          lowerJsArrayMethods(a.trim(), imports),
        );
        let lowered: string | null = null;
        if (method === 'includes') {
          const needle = args[0] ?? '';
          lowered = `(${needle} in ${receiver})`;
        } else if (method === 'indexOf') {
          const needle = args[0] ?? '';
          const fromIndex = args[1] ?? null;
          if (fromIndex) {
            lowered = `(next((__i for __i, __v in enumerate(${receiver}) if __i >= ${fromIndex} and __v == ${needle}), -1))`;
          } else {
            lowered = `(next((__i for __i, __v in enumerate(${receiver}) if __v == ${needle}), -1))`;
          }
        } else if (method === 'join') {
          const sep = args[0] ?? '","';
          lowered = `${sep}.join(str(__v) for __v in ${receiver})`;
        } else if (method === 'slice') {
          const start = args[0];
          const end = args[1];
          if (!start && !end) lowered = `${receiver}[:]`;
          else if (start && !end) lowered = `${receiver}[${start}:]`;
          else if (!start && end) lowered = `${receiver}[:${end}]`;
          else lowered = `${receiver}[${start}:${end}]`;
        } else if (method === 'some' || method === 'every') {
          const arrow = parseArrowCallback(expr.slice(openIdx + 1, closeIdx));
          if (arrow && arrow.params.length >= 1) {
            const elemVar = arrow.params[0];
            const idxVar = arrow.params[1];
            // Only the element var is dict-subscripted; the index var stays a
            // bare int and must be bound via enumerate() when present.
            const pred = lowerJsArrayMethods(lowerDictMemberAccess(arrow.body, elemVar), imports);
            const loopTarget = idxVar ? `${idxVar}, ${elemVar}` : elemVar;
            const source = idxVar ? `enumerate(${receiver})` : receiver;
            lowered =
              method === 'some'
                ? `any(${pred} for ${loopTarget} in ${source})`
                : `all(${pred} for ${loopTarget} in ${source})`;
          }
        } else if (method === 'reduce') {
          const rawArgs = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx));
          const arrow = parseArrowCallback(rawArgs[0] ?? '');
          if (arrow && arrow.params.length >= 2) {
            const accVar = arrow.params[0];
            const elemVar = arrow.params[1];
            let body = lowerDictMemberAccess(arrow.body, accVar);
            body = lowerDictMemberAccess(body, elemVar);
            const loweredBody = lowerJsArrayMethods(body, imports);
            imports?.add('import functools');
            if (rawArgs.length >= 2) {
              const seed = lowerJsArrayMethods(rawArgs[1].trim(), imports);
              lowered = `functools.reduce(lambda ${accVar}, ${elemVar}${LAMBDA_COLON_PLACEHOLDER} ${loweredBody}, ${receiver}, ${seed})`;
            } else {
              lowered = `functools.reduce(lambda ${accVar}, ${elemVar}${LAMBDA_COLON_PLACEHOLDER} ${loweredBody}, ${receiver})`;
            }
          }
        }
        if (lowered) {
          out = `${pre}${lowered}`;
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

// Lower JSON.stringify(...) / JSON.parse(...) to json.dumps/loads. Uses a
// balanced, string-aware scan because the single argument can itself contain
// commas, nested parens, brackets, braces, or string literals — which regex
// cannot reliably capture (three regex iterations were each holed by review).
// Skips occurrences inside string literals and those that are a property of
// another receiver (e.g. `myJSON.stringify`). Handles the pretty-print form
// `JSON.stringify(x, null, n)` → `json.dumps(x, indent=n)`.
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
        // Recurse so a nested builtin in the argument is lowered too, e.g.
        // JSON.stringify(JSON.parse(x)) → json.dumps(json.loads(x)) (Codex
        // review on 9d8ed8d0). Terminates: the argument is strictly shorter.
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
// String-aware + balanced-paren scan, so nested calls/expressions survive:
//   Number.floor(a + b) -> __k_math.floor(a + b)
//   Number.round(x)     -> __k_math.floor(x + 0.5)  (JS Math.round parity)
//   Math.max(a, b, c)   -> max(a, b, c)
// Guards skip member calls on custom receivers (e.g. myNumber.floor(x)).
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
        /^(?:(?:Number|Math)\.(floor|ceil|round|abs|trunc|isFinite|isNaN)|Math\.(min|max|pow|sqrt|hypot|random))\(/,
      );
    const prev = expr[i - 1];
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
            out += `__k_math.floor(${arg} + 0.5)`;
            break;
          case 'abs':
            out += `abs(${arg})`;
            break;
          case 'trunc':
            // JS Math.trunc truncates toward zero; math.trunc matches.
            imports?.add('import math as __k_math');
            out += `__k_math.trunc(${arg})`;
            break;
          case 'isFinite':
            imports?.add('import math as __k_math');
            // Type guard: Number.isFinite returns false for non-numbers; math.isfinite raises TypeError
            out += `(isinstance(${arg}, (int, float)) and __k_math.isfinite(${arg}))`;
            break;
          case 'isNaN':
            imports?.add('import math as __k_math');
            // Type guard: Number.isNaN returns false for non-numbers; math.isnan raises TypeError
            out += `(isinstance(${arg}, (int, float)) and __k_math.isnan(${arg}))`;
            break;
          case 'min':
            // JS Math.min(): 0 args → +Infinity; 1 arg → that value (Python
            // min(x) treats a lone arg as an iterable and raises).
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
            // JS Math.pow(a, b) === a ** b; fewer than 2 args is NaN in JS.
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

// Find the start of the JS expression that ends just before the current position.
// Uses a balanced-scan (backwards) to skip over () [] {}.
function findReceiverStart(s: string): number {
  let j = s.length - 1;
  while (j >= 0 && /\s/.test(s[j])) j--;
  if (j < 0) return -1;

  let depth = 0;
  while (j >= 0) {
    const c = s[j];
    if (c === ')' || c === ']' || c === '}') {
      depth++;
    } else if (c === '(' || c === '[' || c === '{') {
      depth--;
      if (depth < 0) return j + 1;
    } else if (depth === 0) {
      // At top level, we stop at anything that isn't part of an identifier,
      // property access, or indexed access.
      if (!/[\w.$]/.test(c)) return j + 1;
    }
    j--;
  }
  return 0;
}

// Lower Number parsing and formatting builtins:
//   parseInt(x) / parseInt(x, 10) -> int(x)
//   parseFloat(x)                 -> float(x)
//   Number.isInteger(x)           -> (isinstance(x, int) and not isinstance(x, bool))
//   Number(x)                     -> float(x)  (best-effort coercion)
//   (n).toFixed(d)                -> f"{n:.{d}f}"
// String-aware + balanced-paren scan so nested calls survive.
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
      .match(/^(?:Number\.isInteger|Number\.parseInt|Number\.parseFloat|Number|parseInt|parseFloat)\(/);
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
          // Quote-safe: a nested f-string `f"{receiver:.{p}f}"` is a SyntaxError
          // on CPython <3.12 when the receiver contains `"` (e.g. data["k"]).
          // `format(x, '.' + str(p) + 'f')` keeps the receiver as a bare arg.
          out = `${pre}format(${receiver}, '.' + str(${precision}) + 'f')`;
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

// Lower JS string builtins to Python methods:
//   x.toUpperCase() -> x.upper()
//   x.toLowerCase() -> x.lower()
//   x.trim()        -> x.strip()
//   x.padStart(n[, fill]) -> x.rjust(n[, fill])  (JS/Python both default to " ")
//   x.padEnd(n[, fill])   -> x.ljust(n[, fill])
// Skip string literals so text like "a.toUpperCase()" / ".padStart(" stays raw.
// pad*/startsWith/endsWith take args, so only the method+`(` is matched and the
// argument list flows through to Python unchanged. Note: JS pad* accept a
// multi-char fill while Python rjust/ljust require a single fill char — only the
// 1-char fixture form is in scope; a multi-char fill is left to raise on Python.
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
      // startsWith/endsWith take args; match only the method+`(` so the
      // argument list passes through to Python's str.startswith/endswith.
      if (match === '.startsWith(') return '.startswith(';
      if (match === '.endsWith(') return '.endswith(';
      if (match === '.padStart(') return '.rjust(';
      if (match === '.padEnd(') return '.ljust(';
      return match;
    },
  );
}

// Lower the argument-taking JS String methods that need more than a bare method
// rename (those are handled by lowerStringBuiltinCalls). One string-aware,
// balanced scan reused for all of them; the shared matchBalancedParen /
// splitTopLevelArgs / findReceiverStart helpers carve out args and receiver so
// no new char-loop matcher is introduced:
//   s.replace("a", "b")  -> s.replace("a", "b", 1)   (JS replaces FIRST only,
//                            Python str.replace replaces ALL — pin count=1)
//   s.substring(a, b)    -> s[a:b]      (and s.substring(a) -> s[a:])
//   s.repeat(n)          -> (s * n)
//   s.split(sep, limit)  -> s.split(sep)[:limit]      THE TRAP: Python's 2nd
//                            arg is maxsplit, which KEEPS the remainder; JS
//                            keeps only the first `limit` parts. The no-limit
//                            s.split(sep) form is left raw (Python matches JS).
// replace: only the 2-arg, non-regex form is lowered (`s.replace(/re/, b)` is
// out of scope); `.replaceAll(` never matches. A quoted `".repeat("` etc. is
// skipped by the quote tracking, so string-literal text stays raw.
// substring edge (scoped out): JS substring clamps negative args to 0 and SWAPS
// them when a > b; Python slicing does neither. Only the simple non-negative
// fixture case is lowered — a negative/swapped substring would diverge.
function lowerStringArgMethods(expr: string): string {
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
    if (expr.startsWith('.replace(', i)) {
      const openIdx = i + '.replace('.length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const args = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx));
        if (args.length === 2 && !args[0].trim().startsWith('/')) {
          const a0 = lowerStringArgMethods(args[0]).trim();
          const a1 = lowerStringArgMethods(args[1]).trim();
          out += `.replace(${a0}, ${a1}, 1)`;
          i = closeIdx + 1;
          continue;
        }
      }
    }
    if (expr.startsWith('.substring(', i)) {
      const openIdx = i + '.substring('.length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        // Receiver is already in `out`; `s.substring(a, b)` and `s[a:b]` both
        // trail the receiver, so just append the slice — no receiver surgery.
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
        const args = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx)).map((a) => lowerStringArgMethods(a).trim());
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
        const args = splitTopLevelArgs(expr.slice(openIdx + 1, closeIdx)).map((a) => lowerStringArgMethods(a).trim());
        // Only the 2-arg limit form needs rewriting; the no-limit form is left
        // raw (falls through) because Python str.split(sep) already matches JS.
        if (args.length === 2) {
          out += `.split(${args[0]})[:${args[1]}]`;
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

// Lower selected Object/Array/Date host builtins in portable expressions:
//   Object.keys(x)    -> list(x.keys())
//   Object.values(x)  -> list(x.values())
//   Object.entries(x) -> list(x.items())
//   Array.isArray(x)  -> isinstance(x, list)
//   Date.now()        -> int(datetime.now(timezone.utc).timestamp() * 1000)
// Uses the same string-aware balanced scan as other builtin lowerers.
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
    const m = expr.slice(i).match(/^(Object\.(keys|values|entries)|Array\.isArray)\(/);
    const prev = expr[i - 1];
    if (m && !(prev && /[\w.]/.test(prev))) {
      const method = m[1];
      const openIdx = i + m[0].length - 1;
      const closeIdx = matchBalancedParen(expr, openIdx);
      if (closeIdx !== -1) {
        const arg = lowerObjectArrayDateBuiltinCalls(expr.slice(openIdx + 1, closeIdx), imports).trim();
        if (method === 'Object.keys') out += `list(${arg}.keys())`;
        else if (method === 'Object.values') out += `list(${arg}.values())`;
        else if (method === 'Object.entries') out += `list(${arg}.items())`;
        else out += `isinstance(${arg}, list)`;
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

// Build the Python comprehension for one `Array.from(...)` call's argument list,
// or return null if the call isn't a lowerable length-form. Uses the balanced
// helpers (not regex) so a length value or arrow params containing braces/parens
// don't desync (codex/gemini review of cd7c40ae).
function tryLowerArrayFrom(args: string[]): string | null {
  if (args.length < 2) return null;
  // arg0 must be an object literal whose `length` property gives the count.
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
  // arg1 must be an arrow `(params) => body` or `param => body`.
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
  // Loop var = the INDEX (2nd param). The 1st param is the element, which is
  // undefined for the length form, so it is NOT promoted to the loop variable
  // (doing so would diverge from JS — `(x) => x` is [undefined…], not [0,1,…]).
  // A non-simple index (destructuring) isn't a valid Python loop target → bail.
  const idxVar = params[1] || '_';
  if (!/^[A-Za-z_$][\w$]*$/.test(idxVar)) return null;
  // `(_, i) => ({...})` parenthesizes the object body to disambiguate it from a
  // block; unwrap ONLY when the enclosed body is an object literal, so a comma
  // operator `(1, 2)` or grouped expr isn't mis-stripped (codex review).
  if (body.startsWith('(') && matchBalancedParen(body, 0) === body.length - 1) {
    const inner = body.slice(1, -1).trim();
    if (inner.startsWith('{')) body = inner;
  }
  // Recurse so a nested Array.from in the count or body is lowered too.
  return `[${lowerArrayFromCalls(body)} for ${idxVar} in range(${lowerArrayFromCalls(count)})]`;
}

// Expand JS object-literal shorthand properties to explicit `key: key` so the
// dict-key quoting pass can quote them: `{ items, page }` → `{ items: items,
// page: page }`. Bracket/string-aware: only an object-literal entry that is a
// bare identifier is expanded; `key: value`, `**spread`, computed keys, and
// array/comprehension contents (`[]`) are left alone, and nested objects are
// handled by recursing into each entry. Runs just before key quoting.
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

// Lower `Array.from({ length: N }, (_, i) => BODY)` to a Python list
// comprehension `[BODY for i in range(N)]` (Express keeps Array.from — valid
// JS). Balanced, string-aware scan; runs BEFORE the ref/key/template passes so
// they lower N and BODY in place. Only the `{ length: N }` form is handled;
// `Array.from(iterable, fn)` (map form) is left untouched. A call immediately
// followed by a method chain (`.map`, `.filter`, …) is left raw rather than
// lowered, because the array-method pass cannot consume a comprehension
// receiver and would emit malformed Python (codex review of cd7c40ae).
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

// Re-encode JS-template literal text (kept raw by parseTemplateLiteral, with `\x`
// as two characters) for a Python double-quoted string. Most JS escapes are
// ALSO valid Python escapes (`\n \t \r \b \f \v \\ \" \uXXXX \xXX \0`), so they
// are preserved verbatim — decoding then re-encoding them only risks corrupting
// the exotic ones (Codex reviews on 678e6bc1 and the escape-decoder commit).
// Only the JS-specific escapes that Python does not recognise are converted to
// the bare character: `\`` → backtick, `\$` → `$`, `\'` → `'`. A bare `"` (or a
// bare trailing backslash, or raw control char) is escaped so the literal stays
// valid.
function escapeJsTemplateTextForPy(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === '`' || next === '$' || next === "'") {
        out += next; // JS-only escape → bare char (Python has no such escape)
      } else {
        out += `\\${next}`; // valid Python escape (\n, \uXXXX, \0, ...) — keep
      }
      i += 1;
      continue;
    }
    if (c === '\\')
      out += '\\\\'; // lone trailing backslash
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
  // str.format treats { } as field markers, so literal braces must be doubled.
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
    rewriteFastAPIExpr(part.trim(), pathParams, bodyFields, authUser, imports),
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

// Lower JS spread elements to Python unpacking, choosing the operator from the
// enclosing bracket: `{...x}` → `{**x}`, `[...x]` / `f(...x)` → `[*x]` / `f(*x)`.
// Bracket-aware (a stack) and string-aware (skips quoted contents) so a literal
// "..." inside a string is left intact. Runs BEFORE the request-ref rewrites so
// that, e.g., `...user.roles` becomes `*user.roles` and the auth rewrite's
// `(?<!\.)` lookbehind no longer sees the spread's trailing dot.
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
      // Collapse whitespace after the operator so `{ ... body }` yields tight
      // `{**body}` — the model_dump pass matches `**body`, not `** body` (Codex).
      while (i < expr.length && /\s/.test(expr[i])) i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function rewriteFastAPIExpr(
  expr: string,
  pathParams: string[],
  bodyFields: Set<string> = new Set(),
  authUser = false,
  imports?: Set<string>,
): string {
  try {
    const tokens = tokenizeJSExpr(expr);
    const hasBitwiseOrModulo = tokens.some(t => t.type === 'UNARY' || t.type === 'OP');
    if (hasBitwiseOrModulo) {
      const ast = parseTokens(tokens);
      expr = codegenASTToPython(ast, imports);
    }
  } catch (err) {
    // Graceful fallback to original expr string if parsing/emission fails
  }

  const { maskedExpr, replacements } = extractTemplateLiterals(expr, pathParams, bodyFields, authUser, imports);
  let result = maskedExpr;
  // Spread → unpacking first, so the request-ref rewrites below see clean
  // operands (e.g. `*user.roles`, not `...user.roles`).
  result = lowerSpreadElements(result);
  // Expand object shorthand BEFORE Array.from lowering, so a shorthand length
  // object `Array.from({ length }, …)` becomes `{ length: length }` and is
  // recognised (codex review of d75a9d05). No later pass creates new object
  // literals, so this single early pass covers length objects, arrow bodies,
  // and every other object.
  result = expandObjectShorthand(result);
  // Array.from(length, arrow) → list comprehension. Runs before the ref/key
  // passes so they lower the count and body of the produced comprehension.
  result = lowerArrayFromCalls(result);
  // params.X → X (function param) for path params
  for (const param of pathParams) {
    result = result.replace(new RegExp(`\\bparams\\.${param}\\b`, 'g'), param);
  }
  // Fallback: any remaining params.X → X (for query params not in pathParams)
  result = result.replace(/\bparams\.([A-Za-z_]\w*)/g, '$1');
  // user.X → user["X"]: with auth, `user` is the decoded JWT payload (a dict
  // returned by auth_required/auth_optional), so attribute access would raise
  // AttributeError. Only applied when the route declares auth (Codex review).
  // Skip text inside string literals so `{{"user.id"}}` isn't corrupted to
  // `"user["id"]"` (Codex review on 02ecb2fa), and require `user` NOT be a
  // property of something else (negative lookbehind `(?<!\.)`) so a nested
  // body access like `body.user.id` is left intact (Kimi review on 02ecb2fa).
  if (authUser) {
    const USER_FIELD_RE = new RegExp(`${STRING_LITERAL_ALT}|(?<!\\.)\\buser\\.([A-Za-z_]\\w*)`, 'g');
    result = result.replace(USER_FIELD_RE, (match, field) => (field ? `user["${field}"]` : match));
  }
  // body.X → body.<snake_case(X)>: the generated Pydantic model snake-cases
  // every field, so a camelCase access would raise AttributeError at runtime.
  // Only remap fields the model actually declares; leave unknown `body.X`
  // (e.g. external validate schemas) untouched.
  result = result.replace(/\bbody\.([A-Za-z_]\w*)/g, (match, field) =>
    bodyFields.has(field) ? `body.${toSnakeCase(field)}` : match,
  );
  // Spreading the whole request body: `{**body}` raises TypeError because a
  // Pydantic model is not a mapping, so unpack its dict form instead. This is
  // unconditional: whenever the `body` symbol exists it is a Pydantic model
  // (inline `RequestBody`, or an external `validate` schema typed `body: X` for
  // POST/PUT/PATCH) — there is no `body: dict` codegen path, so model_dump() is
  // always correct. Keying on bodyFields would wrongly skip external schemas
  // (their field names are unknown but the param is still a model). A
  // `**body.field` member spread is left alone via the `(?!\s*\.)` guard.
  result = result.replace(/\*\*body\b(?!\s*\.)/g, '**body.model_dump()');
  // query.X → X (function param)
  result = result.replace(/\bquery\.([A-Za-z_]\w*)/g, '$1');
  // headers.X → request.headers.get("X")
  result = result.replace(/\bheaders\.([A-Za-z_][\w-]*)/g, (_m, key) => `request.headers.get("${key}")`);
  // effectName.result → effect_name (effect variables hold the result directly, snake_cased)
  result = result.replace(/\b([A-Za-z_]\w*)\.result\b/g, (_m, name) => toSnakeCase(name));

  // ── JS-to-Python expression lowerings ─────────────────────────────────
  // Array methods first (so any `===` inside an arrow body is hoisted into
  // a list-comprehension predicate that the strict-equality pass below
  // then catches).
  result = lowerJsArrayMethods(result, imports);

  // Strict equality: skip text inside quoted strings so a user message
  // like `"use === for strict equality"` doesn't get mangled to `==`.
  result = result.replace(STRICT_EQ_RE, (match) => {
    if (match === '===') return '==';
    if (match === '!==') return '!=';
    return match; // quoted string — return unchanged
  });

  // JS literals → Python equivalents. Same string-skip trick — a message
  // like `"undefined behavior"` must not be rewritten to `"None behavior"`.
  result = result.replace(JS_LITERAL_RE, (match) => {
    if (match === 'undefined' || match === 'null') return 'None';
    if (match === 'true') return 'True';
    if (match === 'false') return 'False';
    return match; // quoted string
  });

  // ── Host-builtin lowering (JS globals → Python stdlib) ────────────────
  // crypto / Date are fixed forms matched by regex with a `(?<![\w.])` guard so
  // a custom receiver (`some.crypto.randomUUID()`) is left untouched. The JSON
  // calls need balanced argument parsing (regex can't), so they go through the
  // string-aware scanner `lowerJsonBuiltinCalls`.

  // crypto.randomUUID() → str(uuid.uuid4())
  result = result.replace(new RegExp(`${STRING_LITERAL_ALT}|(?<![\\w.])crypto\\.randomUUID\\(\\)`, 'g'), (match) => {
    if (match === 'crypto.randomUUID()') {
      imports?.add('import uuid');
      return 'str(uuid.uuid4())';
    }
    return match; // string literal — leave untouched
  });

  // new Date().toISOString() → datetime.now(timezone.utc).isoformat()
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

  // JSON.stringify(...) → json.dumps(...) / JSON.parse(...) → json.loads(...)
  result = lowerJsonBuiltinCalls(result, imports);
  // Number/Math arithmetic builtins in portable expressions.
  result = lowerMathBuiltinCalls(result, imports);
  // Number parsing and formatting builtins.
  result = lowerNumberBuiltinCalls(result, imports);
  // String builtins in portable expressions (bare renames + pad → rjust/ljust).
  result = lowerStringBuiltinCalls(result);
  // Argument-taking string methods: replace (first-only), substring → slice,
  // repeat → `*`, and the split(sep, limit) maxsplit trap.
  result = lowerStringArgMethods(result);
  // Object/Array/Date host builtins in portable expressions.
  result = lowerObjectArrayDateBuiltinCalls(result, imports);

  // Object-literal keys → quoted Python dict keys (`{userId: x}` →
  // `{"userId": x}`). Applied last, mirroring the raw `res.json(...)` path's
  // outer quote-after-lower order; runs after array-method lowering so dicts
  // produced inside list comprehensions are quoted too.
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

export function addRespondImports(respondNode: IRNode, imports: Set<string>): void {
  const rp = getProps(respondNode);
  if (rp.redirect) imports.add('from fastapi.responses import RedirectResponse');
  if (rp.text) imports.add('from fastapi.responses import PlainTextResponse');
  if (typeof rp.status === 'number' && rp.status !== 200 && rp.json)
    imports.add('from fastapi.responses import JSONResponse');
  if (typeof rp.status === 'number' && !rp.json && !rp.text && !rp.redirect && !rp.error)
    imports.add('from fastapi.responses import Response');
  if (rp.error) imports.add('from fastapi import HTTPException');
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
        // Fall through to TEXT
      } else {
        tokens.push({ type: 'OP', value: '&' });
        i++;
        continue;
      }
    }
    if (char === '|') {
      if (expr[i + 1] === '|') {
        // Fall through to TEXT
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
      case '|': return 1;
      case '^': return 2;
      case '&': return 3;
      case '<<':
      case '>>': return 4;
      case '%': return 5;
      default: return 0;
    }
  }
  
  function parseExpression(precedence: number): ASTNode {
    let left = parsePrimary();
    
    while (true) {
      const next = peek();
      if (!next || next.type !== 'OP') break;
      
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
