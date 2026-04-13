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
import { escapePyStr } from './fastapi-utils.js';
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

export function rewriteFastAPIExpr(expr: string, pathParams: string[]): string {
  let result = expr;
  // params.X → X (function param) for path params
  for (const param of pathParams) {
    result = result.replace(new RegExp(`\\bparams\\.${param}\\b`, 'g'), param);
  }
  // Fallback: any remaining params.X → X (for query params not in pathParams)
  result = result.replace(/\bparams\.([A-Za-z_]\w*)/g, '$1');
  // body.X → body.X (Pydantic model — already correct)
  // query.X → X (function param)
  result = result.replace(/\bquery\.([A-Za-z_]\w*)/g, '$1');
  // headers.X → request.headers.get("X")
  result = result.replace(/\bheaders\.([A-Za-z_][\w-]*)/g, (_m, key) => `request.headers.get("${key}")`);
  // effectName.result → effect_name (effect variables hold the result directly, snake_cased)
  result = result.replace(/\b([A-Za-z_]\w*)\.result\b/g, (_m, name) => toSnakeCase(name));
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
