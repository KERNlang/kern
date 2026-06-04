/**
 * Framework-agnostic Python handler emission — revised contract (post nero red-team).
 *
 * The `python` target (targets/python.ts) emits a list of `PurePythonHandler`
 * values. Framework adapters (Phase 3: fastapi, django, asgi) take that list
 * and wrap each in their own routing/validation skin.
 *
 * KEY: the boundary is EXPLICIT. A handler consumes a `PureRequest` (a plain
 * dict whose shape is defined HERE, not borrowed from FastAPI or Django) and
 * returns a `PureResponse` (status, body, optional headers). The adapter is
 * the ONLY place that knows about its framework's native request object —
 * the pure handler never sees `fastapi.Request`, `django.http.HttpRequest`,
 * or any framework type.
 *
 * Why explicit instead of `request: dict`? nero pointed out that "request:
 * dict" silently leaks FastAPI's auto-parsed shape into the handler (FastAPI
 * gives you parsed JSON in one place, Django gives you `.POST`/`.GET`/raw
 * body in another). By specifying PureRequest's shape here, the handler is
 * portable BY CONSTRUCTION and the Phase 2 smoke proves it: it hand-builds
 * a PureRequest (neither FastAPI- nor Django-shaped) and the handler still
 * works.
 *
 * EXPLICIT REQUEST/RESPONSE SHAPE (the contract every adapter must marshal to/from):
 *
 *   PureRequest:
 *     method:       str                    # 'GET' | 'POST' | ...
 *     path_params:  dict[str, str|int]     # already-coerced path params
 *     query:        dict[str, str|list]    # already-parsed (single or list per key)
 *     body:         Any (typically dict)   # JSON-decoded body if content-type is JSON
 *     headers:      dict[str, str]         # lowercased keys
 *     user:         Any (optional)         # auth-supplied user object, opaque to handler
 *
 *   PureResponse:
 *     tuple[int, Any]                      # (status, body) — body is JSON-serialisable
 *     tuple[int, Any, dict[str, str]]      # (status, body, extra_headers)
 *
 * Guard rejections return `(status, {"detail": "<msg>"})` — same unified
 * error shape used by the FastAPI and Go targets (#3 error-semantics).
 *
 * Phase 2 emitter detail: bodies wrap incoming `request`/`body` in a
 * `__DotDict` so the shared `rewriteExpr` lowering (which assumes JS
 * attribute access like `body.value`) is satisfied without each handler
 * needing to rewrite `body.x` → `body["x"]`. The wrapping is internal —
 * adapters and external callers always see a plain `dict`.
 */

import type { IRNode } from '@kernlang/core';
import { getChildren, getFirstChild, getProps } from '@kernlang/core';
import { isUnsupportedJsHandlerBody, unsupportedRawHandlerBody } from '../../fastapi-raw-handler.js';
import { derivePathParams, escapePyStr, indentHandler, slugify } from '../../fastapi-utils.js';
import { mapTsTypeToPython, toSnakeCase } from '../../type-map.js';
import { rewriteExpr } from '../expr/index.js';

/** A single route lowered to a framework-agnostic Python function. */
export interface PurePythonHandler {
  /** HTTP method, uppercase: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | ... */
  method: string;
  /** Route path with `:param` placeholders, e.g. `/api/users/:id`. */
  path: string;
  /** Python def name, sanitised + uniquified, e.g. `handle_get_api_users_by_id`. */
  fnName: string;
  /** Full Python `def` signature line (no body): `def <fnName>(request: dict) -> tuple:`. */
  signature: string;
  /** Indented Python body lines (4-space indent baked in). */
  bodyLines: string[];
  /** Imports the body needs — STDLIB ONLY (`'import json'`, `'from typing import Any'`). NO `from fastapi import`, NO `from pydantic import`, NO `from django import`. The Phase 2 oracle enforces this. */
  imports: Set<string>;
  /** Path parameter name → Python type annotation (`{ id: 'str', count: 'int' }`). Adapter uses these to coerce path param strings. */
  pathParamTypes: Record<string, string>;
  /** Query parameter name → Python type annotation. Adapter uses these to coerce query strings. */
  queryParamTypes: Record<string, string>;
  /** Body schema reference (interface name) if the route declared `validate <name>`. Adapter uses this to attach framework validation (FastAPI: Pydantic model; Django: serializer). */
  validatesSchema?: string;
  /** Extra response headers the handler always sets (e.g. for streaming). Empty by default. */
  responseHeaders: Record<string, string>;
}

function indentHoistedDef(def: string, indent: string): string[] {
  return def.split('\n').map((line) => `${indent}${line}`);
}

function findFieldsForSchema(root: IRNode, schemaName: string): Set<string> {
  const fields = new Set<string>();
  function search(node: IRNode) {
    if (
      (node.type === 'interface' || node.type === 'model' || node.type === 'type') &&
      getProps(node).name === schemaName
    ) {
      const fieldNodes = getChildren(node, 'field');
      for (const f of fieldNodes) {
        const name = getProps(f).name;
        if (name) fields.add(String(name));
      }
    }
    for (const child of node.children || []) {
      search(child);
    }
  }
  search(root);
  return fields;
}

// Extract the code from a prop that may arrive as a curly-expression
function extractExprCode(val: unknown): string {
  if (val && typeof val === 'object' && '__expr' in val && typeof (val as any).code === 'string') {
    return (val as any).code;
  }
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return '';
}

function extractCodeOrString(val: unknown): string {
  return extractExprCode(val);
}

function unsupportedPureRouteNode(nodeType: string): never {
  throw new Error(
    `pure Python handlers do not yet support portable route \`${nodeType}\`; use FastAPI route emission or add pure-handler parity.`,
  );
}

function mapJsDefaultToPython(def: string | undefined): string {
  if (def === undefined || def === null) return 'None';
  const s = String(def).trim();
  if (s === 'true') return 'True';
  if (s === 'false') return 'False';
  if (s === 'null' || s === 'undefined') return 'None';
  return s;
}

function generatePurePythonStmt(
  child: IRNode,
  indent: string,
  pathParams: string[],
  bodyFields: Set<string>,
  authUser: boolean,
  imports: Set<string>,
  hoistCtx: { seq: { n: number } },
): string[] {
  const lines: string[] = [];
  const p = getProps(child);

  function rewriteExprPure(expr: string, currentIndent: string): { expr: string; hoists: string[] } {
    const defs: string[] = [];
    const rewritten = rewriteExpr(expr, pathParams, bodyFields, authUser, imports, defs, hoistCtx.seq);
    return { expr: rewritten, hoists: defs.flatMap((def) => indentHoistedDef(def, currentIndent)) };
  }

  switch (child.type) {
    case 'derive': {
      const name = String(p.name || '');
      const exprCode = extractExprCode(p.expr);
      if (name && exprCode) {
        const rewritten = rewriteExprPure(exprCode, indent);
        lines.push(...rewritten.hoists, `${indent}${toSnakeCase(name)} = ${rewritten.expr}`);
      }
      break;
    }
    case 'assign': {
      const target = extractExprCode(p.target);
      if (!target) break;
      const op = p.op === undefined || p.op === '' ? '=' : String(p.op);
      const lhs = rewriteExprPure(target, indent);
      lines.push(...lhs.hoists);
      if (op === '++' || op === '--') {
        lines.push(`${indent}${lhs.expr} ${op === '++' ? '+=' : '-='} 1`);
      } else {
        const valueCode = extractExprCode(p.value);
        if (!valueCode) {
          throw new Error('portable route `assign` requires `value=` for a non-postfix operator.');
        }
        const rhs = rewriteExprPure(valueCode, indent);
        lines.push(...rhs.hoists, `${indent}${lhs.expr} ${op} ${rhs.expr}`);
      }
      break;
    }
    case 'do': {
      const value = extractExprCode(p.value);
      if (value) {
        const rewritten = rewriteExprPure(value, indent);
        lines.push(...rewritten.hoists, `${indent}${rewritten.expr}`);
      }
      break;
    }
    case 'guard': {
      const name = String(p.name || '');
      const exprCode = extractExprCode(p.expr);
      const elseStatus = p.else ? parseInt(String(p.else), 10) : 404;
      const elseMessage = typeof p.message === 'string' ? p.message : name ? `${name} guard failed` : 'Guard failed';
      if (exprCode) {
        const rewritten = rewriteExprPure(exprCode, indent);
        lines.push(...rewritten.hoists, `${indent}if not (${rewritten.expr}):`);
        lines.push(`${indent}    return ${elseStatus}, {"detail": "${escapePyStr(elseMessage)}"}`);
      }
      break;
    }
    case 'handler': {
      const code = String(p.code || '');
      if (code) {
        if (isUnsupportedJsHandlerBody(code)) {
          lines.push(...unsupportedRawHandlerBody(indent));
        } else {
          lines.push(...indentHandler(code, indent));
        }
      }
      break;
    }
    case 'respond': {
      const status = typeof p.status === 'number' ? p.status : 200;
      const json = p.json ? extractExprCode(p.json) : undefined;
      const text = p.text ? extractExprCode(p.text) : undefined;
      const redirect = p.redirect ? extractExprCode(p.redirect) : undefined;
      const error = p.error ? extractExprCode(p.error) : undefined;

      if (redirect) {
        const rewritten = rewriteExprPure(redirect, indent);
        lines.push(...rewritten.hoists, `${indent}return ${status || 302}, None, {"Location": ${rewritten.expr}}`);
      } else if (error) {
        const rewritten = rewriteExprPure(error, indent);
        lines.push(...rewritten.hoists, `${indent}return ${status || 500}, {"detail": ${rewritten.expr}}`);
      } else if (json) {
        const rewritten = rewriteExprPure(json, indent);
        lines.push(...rewritten.hoists, `${indent}return ${status}, ${rewritten.expr}`);
      } else if (text) {
        const rewritten = rewriteExprPure(text, indent);
        lines.push(...rewritten.hoists, `${indent}return ${status}, ${rewritten.expr}`);
      } else {
        lines.push(`${indent}return ${status}, None`);
      }
      break;
    }
    case 'branch': {
      const onSource = extractCodeOrString(p.on);
      const on =
        onSource.trim() === '' || onSource.trim() === 'null' || onSource.trim() === 'undefined'
          ? { expr: 'None', hoists: [] }
          : rewriteExprPure(onSource.trim(), indent);
      lines.push(...on.hoists);
      const paths = getChildren(child, 'path');
      for (let i = 0; i < paths.length; i++) {
        const pathNode = paths[i];
        const pp = getProps(pathNode);
        const value = String(pp.value || '');
        const keyword = i === 0 ? 'if' : 'elif';
        lines.push(`${indent}${keyword} ${on.expr} == "${escapePyStr(value)}":`);
        const bodyStart = lines.length;
        for (const pathChild of pathNode.children || []) {
          lines.push(
            ...generatePurePythonStmt(pathChild, `${indent}    `, pathParams, bodyFields, authUser, imports, hoistCtx),
          );
        }
        if (lines.length === bodyStart) lines.push(`${indent}    pass`);
      }
      break;
    }
    case 'let': {
      const name = String(p.name || '');
      if (!name) break;
      const valueCode = extractExprCode(p.value) || extractExprCode(p.expr);
      if (valueCode) {
        const rewritten = rewriteExprPure(valueCode, indent);
        lines.push(...rewritten.hoists, `${indent}${name} = ${rewritten.expr}`);
      }
      break;
    }
    case 'each': {
      const name = String(p.name || 'item');
      const collection = rewriteExprPure(extractExprCode(p.in) || String(p.in || ''), indent);
      lines.push(...collection.hoists);
      const index = p.index ? String(p.index) : undefined;
      if (index) {
        lines.push(`${indent}for ${index}, ${name} in enumerate(${collection.expr}):`);
      } else {
        lines.push(`${indent}for ${name} in ${collection.expr}:`);
      }
      const bodyStart = lines.length;
      for (const eachChild of child.children || []) {
        lines.push(
          ...generatePurePythonStmt(eachChild, `${indent}    `, pathParams, bodyFields, authUser, imports, hoistCtx),
        );
      }
      if (lines.length === bodyStart) lines.push(`${indent}    pass`);
      break;
    }
    case 'collect': {
      const rawName = toSnakeCase(String(p.name || ''));
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
      const from = rewriteExprPure(extractCodeOrString(p.from).trim(), indent);
      lines.push(...from.hoists);

      const where = p.where ? extractExprCode(p.where) : undefined;
      const limit =
        p.limit !== undefined && p.limit !== null && p.limit !== ''
          ? rewriteExprPure(extractCodeOrString(p.limit).trim(), indent)
          : undefined;

      const orderSourceTrimmed = extractCodeOrString(p.order).trim();
      const order =
        orderSourceTrimmed === '' || orderSourceTrimmed === 'null' || orderSourceTrimmed === 'undefined'
          ? undefined
          : rewriteExprPure(orderSourceTrimmed, indent);

      if (limit) lines.push(...limit.hoists);
      if (order) lines.push(...order.hoists);

      if (where && !order && !limit) {
        const whereExpr = rewriteExprPure(where, indent);
        lines.push(...whereExpr.hoists);
        lines.push(`${indent}${collectName} = [item for item in ${from.expr} if ${whereExpr.expr}]`);
      } else {
        lines.push(`${indent}${collectName} = ${from.expr}`);
        if (where) {
          const whereExpr = rewriteExprPure(where, indent);
          lines.push(
            ...whereExpr.hoists,
            `${indent}${collectName} = [item for item in ${collectName} if ${whereExpr.expr}]`,
          );
        }
        if (order) {
          imports.add('import functools');
          lines.push(
            `${indent}${collectName} = sorted(${collectName}, key=functools.cmp_to_key(lambda a, b: ${order.expr}))`,
          );
        }
        if (limit) lines.push(`${indent}${collectName} = ${collectName}[:${limit.expr}]`);
      }
      break;
    }
    case 'count': {
      const name = toSnakeCase(String(p.name || ''));
      if (!name) break;
      const collection = rewriteExprPure(extractCodeOrString(p.in).trim(), indent);
      lines.push(...collection.hoists);
      const item = String(p.item || 'item');
      const where = p.where ? extractCodeOrString(p.where) : undefined;
      const typeAnnotation = p.type ? `: ${mapTsTypeToPython(String(p.type))}` : '';
      if (where) {
        const whereExpr = rewriteExprPure(where, indent);
        lines.push(...whereExpr.hoists);
        lines.push(`${indent}${name}${typeAnnotation} = sum(1 for ${item} in ${collection.expr} if ${whereExpr.expr})`);
      } else {
        lines.push(`${indent}${name}${typeAnnotation} = len(${collection.expr})`);
      }
      break;
    }
    case 'uniqueBy':
    case 'groupBy':
    case 'partition':
    case 'indexBy':
    case 'countBy': {
      return unsupportedPureRouteNode(child.type);
    }
    case 'effect': {
      const effectName = toSnakeCase(String(p.name || 'effect'));
      const triggerNode = getFirstChild(child, 'trigger');
      const recoverNode = getFirstChild(child, 'recover');
      const triggerProps = triggerNode ? getProps(triggerNode) : {};
      const exprCode = extractExprCode(triggerProps.expr);
      const queryCode = extractCodeOrString(triggerProps.query);
      const urlCode = extractCodeOrString(triggerProps.url);
      const callCode = extractCodeOrString(triggerProps.call);
      let triggerExpr = '';
      if (exprCode) {
        triggerExpr = exprCode;
      } else if (queryCode) {
        triggerExpr = queryCode;
      } else if (triggerProps.url !== undefined && triggerProps.url !== null) {
        triggerExpr = `"${escapePyStr(urlCode)}"`;
      } else if (callCode) {
        triggerExpr = callCode;
      }

      const retryCount = recoverNode ? parseInt(String(getProps(recoverNode).retry || '0'), 10) : 0;
      const pyFallback = rewriteExprPure(
        extractCodeOrString(recoverNode ? getProps(recoverNode).fallback : undefined).trim() || 'None',
        indent,
      );
      const trigger = triggerExpr ? rewriteExprPure(triggerExpr, indent) : { expr: 'None', hoists: [] };

      lines.push(...pyFallback.hoists, ...trigger.hoists);

      if (retryCount > 0) {
        lines.push(`${indent}${effectName} = ${pyFallback.expr}`);
        lines.push(`${indent}for _attempt in range(${retryCount}):`);
        lines.push(`${indent}    try:`);
        lines.push(`${indent}        ${effectName} = ${trigger.expr}`);
        lines.push(`${indent}        break`);
        lines.push(`${indent}    except Exception:`);
        lines.push(`${indent}        if _attempt == ${retryCount - 1}:`);
        lines.push(`${indent}            ${effectName} = ${pyFallback.expr}`);
      } else {
        lines.push(`${indent}try:`);
        lines.push(`${indent}    ${effectName} = ${trigger.expr}`);
        lines.push(`${indent}except Exception:`);
        lines.push(`${indent}    ${effectName} = ${pyFallback.expr}`);
      }
      break;
    }
  }
  return lines;
}

/**
 * Phase 2 implements: scan the IR's server children, lower each route
 * to a `PurePythonHandler`.
 */
export function emitPureHandlers(serverNode: IRNode, imports: Set<string>, root?: IRNode): PurePythonHandler[] {
  const routeNodes = getChildren(serverNode, 'route');
  const handlers: PurePythonHandler[] = [];
  const rootNode = root || serverNode;

  for (const routeNode of routeNodes) {
    const props = getProps(routeNode);
    const method = String(props.method || 'get').toUpperCase();
    const path = String(props.path || '/');
    const fnName = `handle_${slugify(`${method}_${path.replace(/:([a-zA-Z0-9_]+)/g, 'by_$1')}`)}`;

    const pathParams = derivePathParams(path);
    const pathParamTypes: Record<string, string> = {};
    for (const p of pathParams) {
      pathParamTypes[p] = 'str';
    }

    const paramsNodes = getChildren(routeNode, 'params');
    const queryParams: Array<{ name: string; type: string; default?: string }> = [];
    for (const paramNode of paramsNodes) {
      const paramItems = getProps(paramNode).items as
        | Array<{ name: string; type: string; default?: string }>
        | undefined;
      if (paramItems) queryParams.push(...paramItems);
    }

    const queryParamTypes: Record<string, string> = {};
    for (const qp of queryParams) {
      let pyType = 'str';
      if (qp.type === 'number') pyType = 'float';
      else if (qp.type === 'integer') pyType = 'int';
      else if (qp.type === 'boolean') pyType = 'bool';
      queryParamTypes[qp.name] = pyType;
    }

    const validateNode = getFirstChild(routeNode, 'validate');
    const validateSchema = validateNode ? String(getProps(validateNode).schema || '') : undefined;
    const validatesSchema = validateSchema || undefined;

    const bodyFields = new Set<string>();
    if (validatesSchema) {
      const resolvedFields = findFieldsForSchema(rootNode, validatesSchema);
      for (const f of resolvedFields) bodyFields.add(f);
    }

    const authNode = getFirstChild(routeNode, 'auth');
    const authUser = !!authNode;

    const handlerImports = new Set<string>();
    const hoistCtx = { seq: { n: 0 } };

    const bodyLines: string[] = [];

    bodyLines.push('    request = __DotDict(request)');
    bodyLines.push('    body = __DotDict(request.get("body") or {})');

    if (pathParams.length > 0) {
      bodyLines.push('    # Path parameters');
      for (const p of pathParams) {
        bodyLines.push(`    ${p} = request.path_params.get("${p}")`);
      }
    }

    if (queryParams.length > 0) {
      bodyLines.push('    # Query parameters');
      for (const qp of queryParams) {
        const snakeName = toSnakeCase(qp.name);
        bodyLines.push(`    ${snakeName} = request.query.get("${qp.name}")`);
        if (qp.default !== undefined) {
          bodyLines.push(`    if ${snakeName} is None:`);
          bodyLines.push(`        ${snakeName} = ${mapJsDefaultToPython(qp.default)}`);
        }
      }
    }

    if (authUser) {
      bodyLines.push('    # Auth user');
      bodyLines.push('    user = request.get("user")');
    }

    const children = routeNode.children || [];
    const PORTABLE_TYPES = new Set([
      'derive',
      'guard',
      'handler',
      'respond',
      'branch',
      'each',
      'collect',
      'count',
      'uniqueBy',
      'groupBy',
      'partition',
      'indexBy',
      'countBy',
      'effect',
      'assign',
      'do',
    ]);

    for (const child of children) {
      if (PORTABLE_TYPES.has(child.type)) {
        const stmtLines = generatePurePythonStmt(
          child,
          '    ',
          pathParams,
          bodyFields,
          authUser,
          handlerImports,
          hoistCtx,
        );
        bodyLines.push(...stmtLines);
      }
    }

    for (const imp of handlerImports) {
      imports.add(imp);
    }

    const signature = `def ${fnName}(request: dict) -> tuple:`;

    handlers.push({
      method,
      path,
      fnName,
      signature,
      bodyLines,
      imports: handlerImports,
      pathParamTypes,
      queryParamTypes,
      validatesSchema,
      responseHeaders: {},
    });
  }

  return handlers;
}
