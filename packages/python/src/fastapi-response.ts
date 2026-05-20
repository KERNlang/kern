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

export function rewriteFastAPIExpr(
  expr: string,
  pathParams: string[],
  bodyFields: Set<string> = new Set(),
  authUser = false,
  imports?: Set<string>,
): string {
  let result = expr;
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
  // Each pattern skips string literals (STRING_LITERAL_ALT) and requires the
  // global NOT be a property of something else via `(?<![\w.])`, so a custom
  // receiver like `myJSON.stringify(x)` or `some.crypto.randomUUID()` is left
  // untouched (Codex review on 6f53c0bd). HB_ARG matches a single argument
  // with one level of nested parens and no top-level comma, so `JSON.parse(
  // load())` works while multi-arg forms don't mis-capture (Codex review).
  const HB_ARG = '(?:[^(),]|\\([^()]*\\))+';

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

  // JSON.stringify(x, null, n) → json.dumps(x, indent=n) — the pretty-print
  // form (the literal pass already mapped null→None). Matched before the
  // 1-arg form so the spacer args become `indent=` instead of breaking
  // json.dumps with extra positionals (Codex review on 6f53c0bd).
  result = result.replace(
    new RegExp(`${STRING_LITERAL_ALT}|(?<![\\w.])JSON\\.stringify\\((${HB_ARG}),\\s*(?:None|null)\\s*,\\s*(\\d+)\\)`, 'g'),
    (match, arg, indent) => {
      if (arg !== undefined) {
        imports?.add('import json');
        return `json.dumps(${arg.trim()}, indent=${indent})`;
      }
      return match;
    },
  );

  // JSON.stringify(x) → json.dumps(x)
  result = result.replace(
    new RegExp(`${STRING_LITERAL_ALT}|(?<![\\w.])JSON\\.stringify\\((${HB_ARG})\\)`, 'g'),
    (match, arg) => {
      if (arg !== undefined) {
        imports?.add('import json');
        return `json.dumps(${arg.trim()})`;
      }
      return match;
    },
  );

  // JSON.parse(x) → json.loads(x)
  result = result.replace(
    new RegExp(`${STRING_LITERAL_ALT}|(?<![\\w.])JSON\\.parse\\((${HB_ARG})\\)`, 'g'),
    (match, arg) => {
      if (arg !== undefined) {
        imports?.add('import json');
        return `json.loads(${arg.trim()})`;
      }
      return match;
    },
  );

  // Object-literal keys → quoted Python dict keys (`{userId: x}` →
  // `{"userId": x}`). Applied last, mirroring the raw `res.json(...)` path's
  // outer quote-after-lower order; runs after array-method lowering so dicts
  // produced inside list comprehensions are quoted too.
  result = quoteObjectKeysOutsideStrings(result);

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
