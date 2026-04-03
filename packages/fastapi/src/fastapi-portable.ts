/**
 * Portable handler generation for the FastAPI transpiler.
 *
 * Converts IR portable nodes (derive, guard, handler, respond, branch, each, collect, effect)
 * into Python/FastAPI handler code.
 */

import type { IRNode } from '@kernlang/core';
import { getChildren, getFirstChild, getProps } from '@kernlang/core';
import { toSnakeCase } from './type-map.js';
import { escapePyStr, indentHandler } from './fastapi-utils.js';
import {
  generateRespondFastAPI,
  rewriteFastAPIExpr,
  extractExprCode,
  addRespondImports,
} from './fastapi-response.js';

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
      const elseMessage = typeof p.message === 'string' ? p.message : (name ? `${name} guard failed` : 'Guard failed');
      if (exprCode) {
        imports.add('from fastapi import HTTPException');
        lines.push(`${indent}if not (${rewriteFastAPIExpr(exprCode, pathParams)}):`);
        lines.push(`${indent}    raise HTTPException(status_code=${elseStatus}, detail="${escapePyStr(elseMessage)}")`);
      }
      break;
    }
    case 'handler': {
      const code = String(p.code || '');
      if (code) lines.push(...indentHandler(code, indent));
      break;
    }
    case 'respond': {
      // Clone props to avoid mutating shared AST, then rewrite portable refs
      const clonedRespond: IRNode = { ...child, props: { ...child.props } };
      if (clonedRespond.props!.json) clonedRespond.props!.json = rewriteFastAPIExpr(String(clonedRespond.props!.json), pathParams);
      if (clonedRespond.props!.text) clonedRespond.props!.text = rewriteFastAPIExpr(String(clonedRespond.props!.text), pathParams);
      addRespondImports(clonedRespond, imports);
      lines.push(...generateRespondFastAPI(clonedRespond, indent));
      break;
    }
    case 'branch': {
      const on = rewriteFastAPIExpr(String(p.on || ''), pathParams);
      const paths = getChildren(child, 'path');
      for (let i = 0; i < paths.length; i++) {
        const pathNode = paths[i];
        const pp = getProps(pathNode);
        const value = String(pp.value || '');
        const keyword = i === 0 ? 'if' : 'elif';
        lines.push(`${indent}${keyword} ${on} == "${escapePyStr(value)}":`);
        const bodyStart = lines.length;
        for (const pathChild of pathNode.children || []) {
          lines.push(...generatePortableChildFastAPI(pathChild, indent + '    ', pathParams, imports));
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
        lines.push(...generatePortableChildFastAPI(eachChild, indent + '    ', pathParams, imports));
      }
      if (lines.length === bodyStart) lines.push(`${indent}    pass`);
      break;
    }
    case 'collect': {
      const rawName = toSnakeCase(String(p.name || ''));
      // Avoid shadowing Python built-ins
      const PY_BUILTINS = new Set(['sorted', 'list', 'dict', 'set', 'map', 'filter', 'type', 'id', 'input', 'print', 'range', 'len', 'min', 'max', 'sum', 'any', 'all']);
      const collectName = PY_BUILTINS.has(rawName) ? `${rawName}_result` : rawName;
      const from = rewriteFastAPIExpr(String(p.from || ''), pathParams);
      const where = p.where ? extractExprCode(p.where) : undefined;
      const limit = p.limit ? String(p.limit) : undefined;
      const order = p.order ? String(p.order) : undefined;
      if (where && !order && !limit) {
        lines.push(`${indent}${collectName} = [item for item in ${from} if ${rewriteFastAPIExpr(where, pathParams)}]`);
      } else {
        lines.push(`${indent}${collectName} = ${from}`);
        if (where) lines.push(`${indent}${collectName} = [item for item in ${collectName} if ${rewriteFastAPIExpr(where, pathParams)}]`);
        if (order) lines.push(`${indent}${collectName} = sorted(${collectName}, key=lambda item: ${rewriteFastAPIExpr(order, pathParams)})`);
        if (limit) lines.push(`${indent}${collectName} = ${collectName}[:${limit}]`);
      }
      break;
    }
    case 'effect': {
      const effectName = toSnakeCase(String(p.name || 'effect'));
      const triggerNode = getFirstChild(child, 'trigger');
      const recoverNode = getFirstChild(child, 'recover');
      const triggerProps = triggerNode ? getProps(triggerNode) : {};
      const triggerExpr = extractExprCode(triggerProps.expr) || String(triggerProps.query || triggerProps.url || triggerProps.call || '');
      const retryCount = recoverNode ? parseInt(String(getProps(recoverNode).retry || '0'), 10) : 0;
      const fallback = recoverNode ? String(getProps(recoverNode).fallback || 'None') : 'None';
      const pyFallback = fallback === 'null' ? 'None' : fallback;

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
