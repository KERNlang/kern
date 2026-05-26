/**
 * Response helpers for the FastAPI transpiler.
 *
 * generateRespondFastAPI — IR respond node → Python return/raise statements
 * rewriteFastAPIExpr    — rewrite portable request references to FastAPI equivalents
 * extractExprCode       — extract expression code from IR prop
 * addRespondImports     — add necessary imports for respond node
 */

import type { IRNode } from '@kernlang/core';
import { getProps } from '@kernlang/core';
import { escapePyStr, quoteObjectKeysOutsideStrings } from './fastapi-utils.js';
import { toSnakeCase } from './type-map.js';

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

// One level of nested parens inside the arrow body: matches `(u.age > 18)`,
// `Math.max(a, b)`, etc. Two-or-more levels still fall through (acceptable
// fallback per the lift-rate metric).
const ARROW_BODY = '((?:[^()]|\\([^()]*\\))+)';
// Receiver allows brackets + spaces so chained calls work after the inner
// call has already been rewritten to a list-comprehension (which contains
// brackets). The outer iteration re-runs the regex on the rewritten form.
const ARROW_RECEIVER = '([\\w.\\[\\] ]+?)';

const FILTER_RE = new RegExp(`${ARROW_RECEIVER}\\.filter\\(\\((\\w+)\\)\\s*=>\\s*${ARROW_BODY}\\)`, 'g');
const MAP_RE = new RegExp(`${ARROW_RECEIVER}\\.map\\(\\((\\w+)\\)\\s*=>\\s*${ARROW_BODY}\\)`, 'g');
const FIND_RE = new RegExp(`${ARROW_RECEIVER}\\.find\\(\\((\\w+)\\)\\s*=>\\s*${ARROW_BODY}\\)`, 'g');
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

function lowerJsArrayMethods(expr: string): string {
  // Iterate so chained calls (`.filter(...).map(...)`) collapse fully.
  // Each pass rewrites the innermost matchable call; the broadened
  // receiver picks up the list-comprehension produced by the prior pass.
  // Bounded at 8 iterations to prevent any accidental infinite-loop bug;
  // realistic chains rarely exceed 3-4 calls.
  let prev = '';
  let next = expr;
  let i = 0;
  while (prev !== next && i < 8) {
    prev = next;
    next = next
      .replace(FILTER_RE, (_m, arr, varName, pred) => `[${varName} for ${varName} in ${arr} if ${pred}]`)
      .replace(MAP_RE, (_m, arr, varName, body) => `[${body} for ${varName} in ${arr}]`)
      .replace(FIND_RE, (_m, arr, varName, pred) => `next((${varName} for ${varName} in ${arr} if ${pred}), None)`);
    i += 1;
  }
  return next;
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
      .match(/^(?:(?:Number|Math)\.(floor|ceil|round|abs|trunc|isFinite|isNaN)|Math\.(min|max|pow|sqrt|hypot|random))\(/);
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

// Lower JS string builtins to Python methods:
//   x.toUpperCase() -> x.upper()
//   x.toLowerCase() -> x.lower()
//   x.trim()        -> x.strip()
// Skip string literals so text like "a.toUpperCase()" stays unchanged.
function lowerStringBuiltinCalls(expr: string): string {
  return expr.replace(
    new RegExp(
      `${STRING_LITERAL_ALT}|\\.toUpperCase\\(\\)|\\.toLowerCase\\(\\)|\\.trim\\(\\)|\\.startsWith\\(|\\.endsWith\\(`,
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
      return match;
    },
  );
}

// Lower JS String.prototype.replace (string-arg form) to Python's first-only
// replace. JS `s.replace("a", "b")` replaces only the FIRST occurrence, but
// Python str.replace replaces ALL — so emit the count=1 third arg for parity.
// Only the 2-arg form is lowered; a regex first arg (`s.replace(/re/, b)`) is
// out of scope and left unchanged. `.replaceAll(` never matches (it isn't
// `.replace(`). String-aware + balanced so args with commas/parens survive.
function lowerStringReplaceFirstOnly(expr: string): string {
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
          const a0 = lowerStringReplaceFirstOnly(args[0]).trim();
          const a1 = lowerStringReplaceFirstOnly(args[1]).trim();
          out += `.replace(${a0}, ${a1}, 1)`;
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
  result = lowerJsArrayMethods(result);

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
  // String builtins in portable expressions.
  result = lowerStringBuiltinCalls(result);
  // String .replace → first-only parity (JS replaces first; Python replaces all).
  result = lowerStringReplaceFirstOnly(result);
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
