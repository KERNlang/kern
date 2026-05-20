import type { IRNode } from '@kernlang/core';
import { getChildren, getFirstChild, getProps } from '@kernlang/core';
import { derivePathParams, escapeSingleQuotes, generateRespondExpress, indentBlock } from './express-utils.js';

// ── Portable request reference rewriting ──────────────────────────────────

// Match a single/double-quoted string literal (escapes honored) so portable-ref
// rewrites are applied only OUTSIDE quoted-string contents. Backticks are NOT
// matched: a template literal stays valid JS on the Express target and its
// `${...}` interpolations are real expressions that MUST be rewritten
// (`${params.id}` → `${req.params.id}`), so templates are treated as code.
const EXPRESS_STRING_LITERAL = '"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'';

export function rewriteExpressExpr(expr: string, path: string): string {
  const _pathParams = derivePathParams(path);
  // Rewrite portable request references to their Express equivalents. Applied
  // only to text OUTSIDE string literals so a payload like `{ label: "user.id" }`
  // isn't corrupted into `"req.user.id"` (Codex review on ff924afe).
  const rewriteSegment = (seg: string): string => {
    let result = seg;
    result = result.replace(/\bparams\.([A-Za-z_]\w*)/g, 'req.params.$1');
    result = result.replace(/\bbody\.([A-Za-z_]\w*)/g, 'req.body.$1');
    result = result.replace(/\bquery\.([A-Za-z_]\w*)/g, 'req.query.$1');
    result = result.replace(/\bheaders\.([A-Za-z_][\w-]*)/g, (_m, key) => `req.headers['${key}']`);
    result = result.replace(/\buser\.([A-Za-z_]\w*)/g, 'req.user.$1');
    result = result.replace(/\b([A-Za-z_]\w*)\.result\b/g, '$1');
    return result;
  };

  let out = '';
  let last = 0;
  for (const m of expr.matchAll(new RegExp(EXPRESS_STRING_LITERAL, 'g'))) {
    out += rewriteSegment(expr.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  out += rewriteSegment(expr.slice(last));
  return out;
}

// ── Portable handler generation (derive → guard → handler → respond) ─────

export interface PortableExpressOptions {
  errorMessagesByStatus?: ReadonlyMap<number, string>;
}

export function extractExprCode(prop: unknown): string {
  if (typeof prop === 'object' && prop !== null && (prop as any).__expr) return (prop as any).code;
  return typeof prop === 'string' ? prop : '';
}

export function generatePortableChildExpress(
  child: IRNode,
  indent: string,
  path: string,
  options: PortableExpressOptions = {},
): string[] {
  const lines: string[] = [];
  const p = getProps(child);

  switch (child.type) {
    case 'derive': {
      const name = String(p.name || '');
      const exprCode = extractExprCode(p.expr);
      if (name && exprCode) {
        lines.push(`${indent}const ${name} = ${rewriteExpressExpr(exprCode, path)};`);
      }
      break;
    }
    case 'guard': {
      const name = String(p.name || '');
      const exprCode = extractExprCode(p.expr);
      const elseStatus = p.else ? parseInt(String(p.else), 10) : 404;
      const elseMessage =
        typeof p.message === 'string'
          ? p.message
          : options.errorMessagesByStatus?.get(elseStatus) || (name ? `${name} guard failed` : 'Guard failed');
      if (exprCode) {
        lines.push(`${indent}if (!(${rewriteExpressExpr(exprCode, path)})) {`);
        lines.push(
          `${indent}  return res.status(${elseStatus}).json({ error: '${escapeSingleQuotes(elseMessage)}' });`,
        );
        lines.push(`${indent}}`);
      }
      break;
    }
    case 'handler': {
      const code = String(p.code || '');
      if (code) lines.push(...indentBlock(code, indent));
      break;
    }
    case 'respond': {
      // Clone props to avoid mutating shared AST, then rewrite portable refs.
      // Use extractExprCode (as derive does) so a curly-expression value
      // (`json={{ {a: 1} }}`) yields its code instead of String({__expr}) →
      // "[object Object]" → invalid `res.json([object Object])` (Codex review
      // on f61f987f). Plain identifiers (`json=user`) pass through unchanged.
      const clonedRespond: IRNode = { ...child, props: { ...child.props } };
      if (clonedRespond.props!.json)
        clonedRespond.props!.json = rewriteExpressExpr(extractExprCode(clonedRespond.props!.json), path);
      if (clonedRespond.props!.text)
        clonedRespond.props!.text = rewriteExpressExpr(extractExprCode(clonedRespond.props!.text), path);
      lines.push(...generateRespondExpress(clonedRespond, indent));
      break;
    }
    case 'branch': {
      const on = rewriteExpressExpr(String(p.on || ''), path);
      const paths = getChildren(child, 'path');
      for (let i = 0; i < paths.length; i++) {
        const pathNode = paths[i];
        const pp = getProps(pathNode);
        const value = String(pp.value || '');
        const keyword = i === 0 ? 'if' : 'else if';
        lines.push(`${indent}${keyword} (${on} === '${escapeSingleQuotes(value)}') {`);
        // Recurse into path children
        for (const pathChild of pathNode.children || []) {
          lines.push(...generatePortableChildExpress(pathChild, `${indent}  `, path, options));
        }
        lines.push(`${indent}}`);
      }
      break;
    }
    case 'each': {
      const name = String(p.name || 'item');
      const collection = rewriteExpressExpr(extractExprCode(p.in) || String(p.in || ''), path);
      const index = p.index ? String(p.index) : undefined;
      if (index) {
        lines.push(`${indent}for (const [${index}, ${name}] of (${collection}).entries()) {`);
      } else {
        lines.push(`${indent}for (const ${name} of ${collection}) {`);
      }
      for (const eachChild of child.children || []) {
        lines.push(...generatePortableChildExpress(eachChild, `${indent}  `, path, options));
      }
      lines.push(`${indent}}`);
      break;
    }
    case 'collect': {
      const name = String(p.name || '');
      const from = rewriteExpressExpr(String(p.from || ''), path);
      const where = p.where ? extractExprCode(p.where) : undefined;
      const limit = p.limit ? String(p.limit) : undefined;
      const order = p.order ? rewriteExpressExpr(extractExprCode(p.order) || String(p.order), path) : undefined;
      let chain = from;
      if (where) chain += `.filter(item => ${rewriteExpressExpr(where, path)})`;
      if (order) chain += `.sort((a, b) => ${order})`;
      if (limit) chain += `.slice(0, ${limit})`;
      if (name) lines.push(`${indent}const ${name} = ${chain};`);
      break;
    }
    case 'effect': {
      const effectName = String(p.name || 'effect');
      const triggerNode = getFirstChild(child, 'trigger');
      const recoverNode = getFirstChild(child, 'recover');
      const triggerProps = triggerNode ? getProps(triggerNode) : {};
      const triggerExpr =
        extractExprCode(triggerProps.expr) || String(triggerProps.query || triggerProps.url || triggerProps.call || '');
      const retryCount = recoverNode ? parseInt(String(getProps(recoverNode).retry || '0'), 10) : 0;
      const fallback = recoverNode ? String(getProps(recoverNode).fallback || 'null') : 'null';

      if (retryCount > 0) {
        lines.push(`${indent}let ${effectName} = ${fallback};`);
        lines.push(`${indent}for (let _attempt = 0; _attempt < ${retryCount}; _attempt++) {`);
        lines.push(`${indent}  try {`);
        lines.push(`${indent}    ${effectName} = ${rewriteExpressExpr(triggerExpr, path)};`);
        lines.push(`${indent}    break;`);
        lines.push(`${indent}  } catch (_err) {`);
        lines.push(`${indent}    if (_attempt === ${retryCount - 1}) ${effectName} = ${fallback};`);
        lines.push(`${indent}  }`);
        lines.push(`${indent}}`);
      } else {
        lines.push(`${indent}let ${effectName} = ${fallback};`);
        lines.push(`${indent}try {`);
        lines.push(`${indent}  ${effectName} = ${rewriteExpressExpr(triggerExpr, path)};`);
        lines.push(`${indent}} catch (_err) {`);
        lines.push(`${indent}  ${effectName} = ${fallback};`);
        lines.push(`${indent}}`);
      }
      break;
    }
    default:
      break;
  }

  return lines;
}

export function generatePortableHandlerExpress(
  routeNode: IRNode,
  indent: string,
  path: string,
  options: PortableExpressOptions = {},
): string[] {
  const lines: string[] = [];
  const children = routeNode.children || [];

  // Walk all route children in document order — portable nodes are emitted inline
  const PORTABLE_TYPES = new Set(['derive', 'guard', 'handler', 'respond', 'branch', 'each', 'collect', 'effect']);
  for (const child of children) {
    if (PORTABLE_TYPES.has(child.type)) {
      lines.push(...generatePortableChildExpress(child, indent, path, options));
    }
  }

  return lines;
}
