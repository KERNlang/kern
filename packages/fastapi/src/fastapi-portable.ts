/**
 * Portable handler generation for the FastAPI transpiler.
 *
 * Converts IR portable nodes (derive, guard, handler, respond, branch, each, collect, effect)
 * into Python/FastAPI handler code.
 */

import type { IRNode } from '@kernlang/core';
import { getChildren, getFirstChild, getProps } from '@kernlang/core';
import { isUnsupportedJsHandlerBody, unsupportedRawHandlerBody } from './fastapi-raw-handler.js';
import { addRespondImports, extractExprCode, generateRespondFastAPI, rewriteFastAPIExpr } from './fastapi-response.js';
import { escapePyStr, indentHandler } from './fastapi-utils.js';
import { toSnakeCase } from './type-map.js';

// Extract the code from a prop that may arrive as a `{{ ... }}` curly-
// expression IR wrapper (`{ __expr: true, code: '...' }`), a plain string
// (legacy `name=value` form), OR a bare number/boolean primitive that the
// IR may carry through (e.g. `fallback=0`). Returns '' for anything else
// (objects without `__expr`, null/undefined).
//
// Review fix (Gemini B5 on 86e6b893): the previous `typeof val ===
// 'string' ? val : ''` branch silently dropped numeric/boolean primitives
// to '' and lowerPropToPython then emitted `None` — a data-loss
// regression versus the original naked `String(...)` which at least
// preserved `"0"`/`"false"`.
function extractCodeOrString(val: unknown): string {
  const fromExpr = extractExprCode(val);
  if (fromExpr) return fromExpr;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return '';
}

// Lower a prop value to a Python expression. Handles the JS-literal
// translations that KERN authors expect to flow across the language
// boundary: `null`/`undefined` → `None`, `true` → `True`, `false`
// → `False`. Anything else routes through `rewriteFastAPIExpr` so
// that KERN idioms (`params.X`, `effectName.result`, etc.) lower
// consistently regardless of which IR prop they live in.
//
// Review fix (Codex+Gemini B4 on 86e6b893): trim the extracted code
// before comparing against literal names so `{{ true }}` (with internal
// whitespace from KERN curly-expression syntax) maps to `True`, not the
// invalid Python identifier `true`.
function lowerPropToPython(val: unknown, pathParams: string[]): string {
  const raw = extractCodeOrString(val);
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') return 'None';
  if (trimmed === 'true') return 'True';
  if (trimmed === 'false') return 'False';
  // Pass the TRIMMED form to the rewriter — leading/trailing whitespace in
  // a curly-expression carries no semantic information and only risks
  // confusing any future anchor-based regex (Gemini defensive note on
  // commit 7a25348b).
  return rewriteFastAPIExpr(trimmed, pathParams);
}

export function generatePortableChildFastAPI(
  child: IRNode,
  indent: string,
  pathParams: string[],
  imports: Set<string>,
): string[] {
  const lines: string[] = [];
  const p = getProps(child);

  switch (child.type) {
    case 'derive': {
      const name = String(p.name || '');
      const exprCode = extractExprCode(p.expr);
      if (name && exprCode) {
        lines.push(`${indent}${toSnakeCase(name)} = ${rewriteFastAPIExpr(exprCode, pathParams)}`);
      }
      break;
    }
    case 'guard': {
      const name = String(p.name || '');
      const exprCode = extractExprCode(p.expr);
      const elseStatus = p.else ? parseInt(String(p.else), 10) : 404;
      const elseMessage = typeof p.message === 'string' ? p.message : name ? `${name} guard failed` : 'Guard failed';
      if (exprCode) {
        imports.add('from fastapi import HTTPException');
        lines.push(`${indent}if not (${rewriteFastAPIExpr(exprCode, pathParams)}):`);
        lines.push(`${indent}    raise HTTPException(status_code=${elseStatus}, detail="${escapePyStr(elseMessage)}")`);
      }
      break;
    }
    case 'handler': {
      const code = String(p.code || '');
      if (code) {
        // When a route uses portable nodes and ALSO has a raw `<<<...>>>`
        // handler child, the body is typically JS/TS (the legacy authoring
        // form). Emitting it verbatim into a Python `def` produces
        // `SyntaxError` on import. Apply the same JS-detection guard the
        // top-level handler path in fastapi-route.ts uses.
        if (isUnsupportedJsHandlerBody(code)) {
          lines.push(...unsupportedRawHandlerBody(indent));
        } else {
          lines.push(...indentHandler(code, indent));
        }
      }
      break;
    }
    case 'respond': {
      // Clone props to avoid mutating shared AST, then rewrite portable refs
      const clonedRespond: IRNode = { ...child, props: { ...child.props } };
      if (clonedRespond.props!.json)
        clonedRespond.props!.json = rewriteFastAPIExpr(String(clonedRespond.props!.json), pathParams);
      if (clonedRespond.props!.text)
        clonedRespond.props!.text = rewriteFastAPIExpr(String(clonedRespond.props!.text), pathParams);
      addRespondImports(clonedRespond, imports);
      lines.push(...generateRespondFastAPI(clonedRespond, indent));
      break;
    }
    case 'branch': {
      const on = lowerPropToPython(p.on, pathParams);
      const paths = getChildren(child, 'path');
      for (let i = 0; i < paths.length; i++) {
        const pathNode = paths[i];
        const pp = getProps(pathNode);
        const value = String(pp.value || '');
        const keyword = i === 0 ? 'if' : 'elif';
        lines.push(`${indent}${keyword} ${on} == "${escapePyStr(value)}":`);
        const bodyStart = lines.length;
        for (const pathChild of pathNode.children || []) {
          lines.push(...generatePortableChildFastAPI(pathChild, `${indent}    `, pathParams, imports));
        }
        if (lines.length === bodyStart) lines.push(`${indent}    pass`);
      }
      break;
    }
    case 'each': {
      const name = String(p.name || 'item');
      const collection = rewriteFastAPIExpr(extractExprCode(p.in) || String(p.in || ''), pathParams);
      const index = p.index ? String(p.index) : undefined;
      if (index) {
        lines.push(`${indent}for ${index}, ${name} in enumerate(${collection}):`);
      } else {
        lines.push(`${indent}for ${name} in ${collection}:`);
      }
      const bodyStart = lines.length;
      for (const eachChild of child.children || []) {
        lines.push(...generatePortableChildFastAPI(eachChild, `${indent}    `, pathParams, imports));
      }
      if (lines.length === bodyStart) lines.push(`${indent}    pass`);
      break;
    }
    case 'collect': {
      const rawName = toSnakeCase(String(p.name || ''));
      // Avoid shadowing Python built-ins
      const PY_BUILTINS = new Set([
        'sorted',
        'list',
        'dict',
        'set',
        'map',
        'filter',
        'type',
        'id',
        'input',
        'print',
        'range',
        'len',
        'min',
        'max',
        'sum',
        'any',
        'all',
      ]);
      const collectName = PY_BUILTINS.has(rawName) ? `${rawName}_result` : rawName;
      const from = lowerPropToPython(p.from, pathParams);
      const where = p.where ? extractExprCode(p.where) : undefined;
      // `limit` is typically a literal integer (`limit=10`) but can be a
      // curly-expression (`limit={{params.max}}`) — route through the same
      // helper used for from/order so the `[object Object]` bug class
      // doesn't lurk here either (Gemini M3 on 86e6b893).
      const limit =
        p.limit !== undefined && p.limit !== null && p.limit !== ''
          ? lowerPropToPython(p.limit, pathParams)
          : undefined;
      // Match the `from`/`limit` routing — `lowerPropToPython` applies
      // both the JS-literal mapping AND `rewriteFastAPIExpr`. Pre-fix,
      // `order` skipped the literal mapping, so `order=null` would emit
      // `sorted(items, key=lambda item: null)` (a Python `NameError`).
      // Presence-check (not truthy) so an empty/absent `order` correctly
      // disables the `sorted()` emission (Gemini review on commit 7a25348b).
      const order =
        p.order !== undefined && p.order !== null && p.order !== ''
          ? lowerPropToPython(p.order, pathParams)
          : undefined;
      if (where && !order && !limit) {
        lines.push(`${indent}${collectName} = [item for item in ${from} if ${rewriteFastAPIExpr(where, pathParams)}]`);
      } else {
        lines.push(`${indent}${collectName} = ${from}`);
        if (where)
          lines.push(
            `${indent}${collectName} = [item for item in ${collectName} if ${rewriteFastAPIExpr(where, pathParams)}]`,
          );
        if (order)
          // `order` already routed through `lowerPropToPython` above (which
          // includes the rewriter), so no second `rewriteFastAPIExpr` call.
          lines.push(`${indent}${collectName} = sorted(${collectName}, key=lambda item: ${order})`);
        if (limit) lines.push(`${indent}${collectName} = ${collectName}[:${limit}]`);
      }
      break;
    }
    case 'effect': {
      const effectName = toSnakeCase(String(p.name || 'effect'));
      const triggerNode = getFirstChild(child, 'trigger');
      const recoverNode = getFirstChild(child, 'recover');
      const triggerProps = triggerNode ? getProps(triggerNode) : {};
      // Source-of-truth ordering for the trigger expression:
      //   1. `expr={{...}}` — canonical expression form.
      //   2. `query=...` — typically SQL string; flows as expression
      //      (existing test behavior — emits as identifier chain that
      //      happens to ast.parse; runtime is up to the user's `db` var).
      //   3. `url=...` — ALWAYS a URL/path string; wrap as Python string
      //      literal so leading-`/` doesn't become Python division.
      //   4. `call=...` — function-call form, flows as expression.
      //
      // B8 (Codex review on 048ff1c1): I had silently reordered url
      // ahead of query in commit 048ff1c1. Restore the original
      // precedence (expr > query > url > call) so any existing
      // specs that set both `query` and `url` keep their prior
      // semantics, while still quoting `url` when it's selected.
      //
      // B9 (Codex review on 048ff1c1): use presence checks (`!== undefined`)
      // rather than truthiness, so `url=""` falls through correctly
      // instead of being treated as "missing" (truthy fallback).
      const exprCode = extractExprCode(triggerProps.expr);
      const queryCode = extractCodeOrString(triggerProps.query);
      const urlCode = extractCodeOrString(triggerProps.url);
      const callCode = extractCodeOrString(triggerProps.call);
      let triggerExpr: string;
      if (exprCode) {
        triggerExpr = exprCode;
      } else if (queryCode) {
        triggerExpr = queryCode;
      } else if (triggerProps.url !== undefined && triggerProps.url !== null) {
        // `url` is always a URL string — quote it. Empty string still
        // emits `""` (rather than falling through to `call`) because
        // the author explicitly set it.
        triggerExpr = `"${escapePyStr(urlCode)}"`;
      } else if (callCode) {
        triggerExpr = callCode;
      } else {
        triggerExpr = '';
      }
      const retryCount = recoverNode ? parseInt(String(getProps(recoverNode).retry || '0'), 10) : 0;
      const pyFallback = lowerPropToPython(recoverNode ? getProps(recoverNode).fallback : undefined, pathParams);

      if (retryCount > 0) {
        lines.push(`${indent}${effectName} = ${pyFallback}`);
        lines.push(`${indent}for _attempt in range(${retryCount}):`);
        lines.push(`${indent}    try:`);
        lines.push(`${indent}        ${effectName} = ${rewriteFastAPIExpr(triggerExpr, pathParams)}`);
        lines.push(`${indent}        break`);
        lines.push(`${indent}    except Exception:`);
        lines.push(`${indent}        if _attempt == ${retryCount - 1}:`);
        lines.push(`${indent}            ${effectName} = ${pyFallback}`);
      } else {
        lines.push(`${indent}try:`);
        lines.push(`${indent}    ${effectName} = ${rewriteFastAPIExpr(triggerExpr, pathParams)}`);
        lines.push(`${indent}except Exception:`);
        lines.push(`${indent}    ${effectName} = ${pyFallback}`);
      }
      break;
    }
    default:
      break;
  }

  return lines;
}

export function generatePortableHandlerFastAPI(
  routeNode: IRNode,
  indent: string,
  pathParams: string[],
  imports: Set<string>,
): string[] {
  const lines: string[] = [];
  const children = routeNode.children || [];

  // Walk all route children in document order
  const PORTABLE_TYPES = new Set(['derive', 'guard', 'handler', 'respond', 'branch', 'each', 'collect', 'effect']);
  for (const child of children) {
    if (PORTABLE_TYPES.has(child.type)) {
      lines.push(...generatePortableChildFastAPI(child, indent, pathParams, imports));
    }
  }

  return lines;
}
