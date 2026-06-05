import type { IRNode } from '@kernlang/core';
import {
  emitStringKeyArray,
  getChildren,
  getFirstChild,
  getProps,
  isPostfixMutationOperator,
  parseKeys,
  splitPortableExpressionList,
} from '@kernlang/core';
import { derivePathParams, escapeSingleQuotes, generateRespondExpress, indentBlock } from './express-utils.js';
import { emitExpressPredicateHelpers } from './portable-predicate-emitter.js';

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
    // Spread of a bare request namespace → its Express aggregate. Scoped to
    // `body` and `user` because only those have a portable Python aggregate to
    // spread (a Pydantic model / the auth dict); `query`/`params`/`headers` are
    // decomposed into individual params on the Python target, so spreading them
    // is not portable and is left to fail symmetrically on both targets rather
    // than silently working on Express only (agon/kimi review). Optional space
    // after `...` is valid JS (Codex). The `(?!\.)` guard leaves member operands
    // (`...user.roles`) to the `user.X` rule so they aren't double-prefixed to
    // `req.req.user.roles`.
    result = result.replace(/\.\.\.\s*(body|user)\b(?!\.)/g, '...req.$1');
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
  /**
   * When set (SSE `stream` body only), the name of an in-scope `AbortController`
   * whose `.signal` is checked so concurrent `fanout` producers skip work and
   * `each await` loops break once the client disconnects — mirroring the
   * hand-written `abortController.signal.aborted` guards in the raw SSE handler.
   * Unset for ordinary routes, so non-stream `each await` emits no abort code.
   */
  streamAbortVar?: string;
}

export function extractExprCode(prop: unknown): string {
  if (typeof prop === 'object' && prop !== null && (prop as any).__expr) return (prop as any).code;
  return typeof prop === 'string' ? prop : '';
}

function portableExprProp(prop: unknown): string {
  return extractExprCode(prop) || String(prop || '');
}

function requirePortableProp(nodeType: string, propName: string, value: string): string {
  if (!value) throw new Error(`portable route \`${nodeType}\` requires \`${propName}=\`.`);
  return value;
}

function portableTempSuffix(...parts: string[]): string {
  const joined = parts.filter(Boolean).join('_') || 'reshape';
  return joined.replace(/[^A-Za-z0-9_$]/g, '_');
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
    case 'assign': {
      // Portable side-effect: `assign target="provider.enabled" value="body.enabled"`
      // → `provider.enabled = req.body.enabled;`. Both sides flow through the same
      // rewriter as `derive`, so `body.x` lowers to `req.body.x`.
      const target = extractExprCode(p.target);
      if (!target) break;
      const op = p.op === undefined || p.op === '' ? '=' : String(p.op);
      const lhs = rewriteExpressExpr(target, path);
      if (isPostfixMutationOperator(op)) {
        lines.push(`${indent}${lhs}${op};`);
      } else {
        const valueCode = extractExprCode(p.value);
        // `value` is schema-required for a non-postfix `assign`; fail loud here
        // too rather than silently dropping the statement for a direct-IR caller.
        if (!valueCode) {
          throw new Error('portable route `assign` requires `value=` for a non-postfix operator.');
        }
        lines.push(`${indent}${lhs} ${op} ${rewriteExpressExpr(valueCode, path)};`);
      }
      break;
    }
    case 'do': {
      // Portable void side-effect: `do value="registry.register(provider)"`.
      const value = extractExprCode(p.value);
      if (value) lines.push(`${indent}${rewriteExpressExpr(value, path)};`);
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
          // Error-body parity (#3, council bb0g4njli): emit FastAPI's canonical {detail} shape so
          // guard failures are byte-equal across targets (FastAPI HTTPException already -> {detail}).
          `${indent}  return res.status(${elseStatus}).json({ detail: '${escapeSingleQuotes(elseMessage)}' });`,
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
    case 'let': {
      // Stream/route-body binding — `let name value=...` → `const name = ...;`
      // (or `let` when `kind=let`). Flows through the same rewriter as `derive`.
      const name = String(p.name || '');
      if (!name) break;
      const valueCode = extractExprCode(p.value) || extractExprCode(p.expr);
      if (valueCode) {
        const kw = p.kind === 'let' ? 'let' : 'const';
        lines.push(`${indent}${kw} ${name} = ${rewriteExpressExpr(valueCode, path)};`);
      }
      break;
    }
    case 'each': {
      const name = String(p.name || 'item');
      const collection = rewriteExpressExpr(extractExprCode(p.in) || String(p.in || ''), path);
      const index = p.index ? String(p.index) : undefined;
      const isAwait = p.await === true || p.await === 'true';
      if (isAwait) {
        // `each await=true` → `for await (const x of ...)`. Cannot combine with
        // `index=` (rejected by the core validator), so no entries() branch.
        lines.push(`${indent}for await (const ${name} of ${collection}) {`);
        if (options.streamAbortVar) {
          // Stop pulling from the upstream async iterable once the client is gone.
          lines.push(`${indent}  if (${options.streamAbortVar}.signal.aborted) break;`);
        }
      } else if (index) {
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
    case 'fanout': {
      // Concurrent fan-out → `await Promise.allSettled(coll.map(async (x) => {…}))`.
      // Each producer's emits interleave through the shared `emit()` helper.
      const name = String(p.name || 'item');
      const collection = rewriteExpressExpr(extractExprCode(p.in) || String(p.in || ''), path);
      // `Array.from(...)` so any sync iterable (Set/Map/generator), not just an
      // array, can be fanned out — matching Python's list-comprehension over
      // the same collection (Gemini review). `.map` alone would throw on a Set.
      lines.push(`${indent}await Promise.allSettled(Array.from(${collection}).map(async (${name}) => {`);
      if (options.streamAbortVar) {
        // Don't start a producer whose client has already disconnected.
        lines.push(`${indent}  if (${options.streamAbortVar}.signal.aborted) return;`);
      }
      for (const fanChild of child.children || []) {
        lines.push(...generatePortableChildExpress(fanChild, `${indent}  `, path, options));
      }
      lines.push(`${indent}}));`);
      break;
    }
    case 'emit': {
      // Push one SSE event through the scaffold's `emit(data, event?)` helper.
      const value = extractExprCode(p.value) || String(p.value || '');
      if (!value) break;
      const ev = typeof p.event === 'string' && p.event ? `, '${escapeSingleQuotes(p.event)}'` : '';
      lines.push(`${indent}emit(${rewriteExpressExpr(value, path)}${ev});`);
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
    case 'filter': {
      const name = requirePortableProp('filter', 'name', String(p.name || ''));
      const item = String(p.item || 'item');
      const collection = rewriteExpressExpr(requirePortableProp('filter', 'in', portableExprProp(p.in)), path);
      const typeAnnotation = p.type ? `: ${String(p.type)}[]` : '';

      const where = p.where ? extractExprCode(p.where) : undefined;
      const predicateStr = p.predicate ? extractExprCode(p.predicate) || String(p.predicate) : undefined;
      const predicateExpr = predicateStr ? rewriteExpressExpr(predicateStr, path) : undefined;

      if (predicateStr && where) {
        throw new Error("filter node cannot combine 'where' and 'predicate'");
      }

      if (predicateExpr) {
        const absentVar = `__kernAbsent_${name}`;
        const evalPredVar = `__kernEvalPredicate_${name}`;
        const getPathVar = `__kernGetPath_${name}`;
        const predicateValueVar = `__kernPredicate_${portableTempSuffix(name)}`;

        lines.push(...emitExpressPredicateHelpers(indent, absentVar, getPathVar, evalPredVar));

        lines.push(`${indent}const ${predicateValueVar} = ${predicateExpr};`);
        lines.push(
          `${indent}const ${name}${typeAnnotation} = (${collection}).filter((${item}) => ${evalPredVar}(${predicateValueVar}, ${item}));`,
        );
      } else if (where) {
        lines.push(
          `${indent}const ${name}${typeAnnotation} = (${collection}).filter((${item}) => ${rewriteExpressExpr(where, path)});`,
        );
      } else {
        throw new Error("filter node requires a 'where' or 'predicate' prop");
      }
      break;
    }
    case 'count': {
      const name = String(p.name || '');
      const collection = rewriteExpressExpr(extractExprCode(p.in) || String(p.in || ''), path);
      const item = String(p.item || 'item');
      const whereCode = p.where ? extractExprCode(p.where) || String(p.where) : undefined;
      const where = whereCode ? rewriteExpressExpr(whereCode, path) : undefined;
      const predicateStr = p.predicate ? extractExprCode(p.predicate) || String(p.predicate) : undefined;
      const predicateExpr = predicateStr ? rewriteExpressExpr(predicateStr, path) : undefined;

      if (predicateStr && whereCode) {
        throw new Error("count node cannot combine 'where' and 'predicate'");
      }

      if (name && collection) {
        const typeAnnotation = p.type ? `: ${String(p.type)}` : '';
        if (predicateExpr) {
          const absentVar = `__kernAbsent_${name}`;
          const evalPredVar = `__kernEvalPredicate_${name}`;
          const getPathVar = `__kernGetPath_${name}`;
          const predicateValueVar = `__kernPredicate_${name}`;

          lines.push(...emitExpressPredicateHelpers(indent, absentVar, getPathVar, evalPredVar));

          lines.push(`${indent}const ${predicateValueVar} = ${predicateExpr};`);
          const expr = `(${collection}).reduce((count, ${item}) => ${evalPredVar}(${predicateValueVar}, ${item}) ? count + 1 : count, 0)`;
          lines.push(`${indent}const ${name}${typeAnnotation} = ${expr};`);
        } else if (where) {
          const expr = `(${collection}).reduce((count, ${item}) => (${where}) ? count + 1 : count, 0)`;
          lines.push(`${indent}const ${name}${typeAnnotation} = ${expr};`);
        } else {
          lines.push(`${indent}const ${name}${typeAnnotation} = (${collection}).length;`);
        }
      }
      break;
    }
    case 'objectMerge': {
      const name = requirePortableProp('objectMerge', 'name', String(p.name || ''));
      const rawSources = requirePortableProp('objectMerge', 'sources', portableExprProp(p.sources));
      const sources = splitPortableExpressionList(rawSources, 'objectMerge sources=');
      if (sources.length < 2) throw new Error('portable route `objectMerge` requires at least two source expressions.');
      const spreadSources = sources.map((source) => {
        if (source.startsWith('...')) {
          throw new Error('portable route `objectMerge` sources must not start with `...`; spreading is implicit.');
        }
        return `...(${rewriteExpressExpr(source, path)})`;
      });
      const typeAnnotation = p.type ? `: ${String(p.type)}` : '';
      lines.push(`${indent}const ${name}${typeAnnotation} = { ${spreadSources.join(', ')} };`);
      break;
    }
    case 'objectPick': {
      const name = requirePortableProp('objectPick', 'name', String(p.name || ''));
      const source = rewriteExpressExpr(requirePortableProp('objectPick', 'in', portableExprProp(p.in)), path);
      const keys = emitStringKeyArray(
        parseKeys(requirePortableProp('objectPick', 'keys', portableExprProp(p.keys)), child, 'objectPick keys='),
      );
      const typeAnnotation = p.type ? `: ${String(p.type)}` : '';
      lines.push(
        `${indent}const ${name}${typeAnnotation} = ((__kernSource) => Object.fromEntries(${keys}.map((key) => [key, (__kernSource && Object.prototype.hasOwnProperty.call(__kernSource, key)) ? __kernSource[key] : null])))(${source});`,
      );
      break;
    }
    case 'objectOmit': {
      const name = requirePortableProp('objectOmit', 'name', String(p.name || ''));
      const source = rewriteExpressExpr(requirePortableProp('objectOmit', 'in', portableExprProp(p.in)), path);
      const keys = emitStringKeyArray(
        parseKeys(requirePortableProp('objectOmit', 'keys', portableExprProp(p.keys)), child, 'objectOmit keys='),
      );
      const typeAnnotation = p.type ? `: ${String(p.type)}` : '';
      lines.push(
        `${indent}const ${name}${typeAnnotation} = Object.fromEntries(Object.entries(${source} || {}).filter(([key]) => !${keys}.includes(key)));`,
      );
      break;
    }
    case 'uniqueBy': {
      const name = requirePortableProp('uniqueBy', 'name', String(p.name || ''));
      const item = String(p.item || 'item');
      const collection = rewriteExpressExpr(requirePortableProp('uniqueBy', 'in', portableExprProp(p.in)), path);
      const by = rewriteExpressExpr(requirePortableProp('uniqueBy', 'by', portableExprProp(p.by)), path);
      const typeAnnotation = p.type ? `: ${String(p.type)}` : '';
      const suffix = portableTempSuffix(name);
      lines.push(`${indent}const __kernSeen_${suffix} = new Set();`);
      lines.push(`${indent}const ${name}${typeAnnotation} = (${collection}).filter((${item}) => {`);
      lines.push(`${indent}  const __kernKey_${suffix} = ${by};`);
      lines.push(`${indent}  if (__kernSeen_${suffix}.has(__kernKey_${suffix})) return false;`);
      lines.push(`${indent}  __kernSeen_${suffix}.add(__kernKey_${suffix});`);
      lines.push(`${indent}  return true;`);
      lines.push(`${indent}});`);
      break;
    }
    case 'groupBy': {
      const name = requirePortableProp('groupBy', 'name', String(p.name || ''));
      const item = String(p.item || 'item');
      const collection = rewriteExpressExpr(requirePortableProp('groupBy', 'in', portableExprProp(p.in)), path);
      const by = rewriteExpressExpr(requirePortableProp('groupBy', 'by', portableExprProp(p.by)), path);
      const typeAnnotation = p.type ? `: ${String(p.type)}` : '';
      const suffix = portableTempSuffix(name);
      lines.push(`${indent}const ${name}${typeAnnotation} = (${collection}).reduce((acc, ${item}) => {`);
      lines.push(`${indent}  const __kernKey_${suffix} = ${by};`);
      lines.push(`${indent}  (acc[__kernKey_${suffix}] ??= []).push(${item});`);
      lines.push(`${indent}  return acc;`);
      lines.push(`${indent}}, Object.create(null));`);
      break;
    }
    case 'partition': {
      const passName = requirePortableProp('partition', 'pass', String(p.pass || ''));
      const failName = requirePortableProp('partition', 'fail', String(p.fail || ''));
      const item = String(p.item || 'item');
      const collection = rewriteExpressExpr(requirePortableProp('partition', 'in', portableExprProp(p.in)), path);
      const where = rewriteExpressExpr(requirePortableProp('partition', 'where', portableExprProp(p.where)), path);
      const typeAnnotation = p.type ? `: [${String(p.type)}[], ${String(p.type)}[]]` : '';
      lines.push(
        `${indent}const [${passName}, ${failName}]${typeAnnotation} = (${collection}).reduce((acc, ${item}) => {`,
      );
      lines.push(`${indent}  (${where} ? acc[0] : acc[1]).push(${item});`);
      lines.push(`${indent}  return acc;`);
      lines.push(`${indent}}, [[], []]);`);
      break;
    }
    case 'indexBy': {
      const name = requirePortableProp('indexBy', 'name', String(p.name || ''));
      const item = String(p.item || 'item');
      const collection = rewriteExpressExpr(requirePortableProp('indexBy', 'in', portableExprProp(p.in)), path);
      const by = rewriteExpressExpr(requirePortableProp('indexBy', 'by', portableExprProp(p.by)), path);
      const typeAnnotation = p.type ? `: ${String(p.type)}` : '';
      const suffix = portableTempSuffix(name);
      lines.push(`${indent}const ${name}${typeAnnotation} = (${collection}).reduce((acc, ${item}) => {`);
      lines.push(`${indent}  const __kernKey_${suffix} = ${by};`);
      lines.push(`${indent}  acc[__kernKey_${suffix}] = ${item};`);
      lines.push(`${indent}  return acc;`);
      lines.push(`${indent}}, Object.create(null));`);
      break;
    }
    case 'countBy': {
      const name = requirePortableProp('countBy', 'name', String(p.name || ''));
      const item = String(p.item || 'item');
      const collection = rewriteExpressExpr(requirePortableProp('countBy', 'in', portableExprProp(p.in)), path);
      const by = rewriteExpressExpr(requirePortableProp('countBy', 'by', portableExprProp(p.by)), path);
      const typeAnnotation = p.type ? `: ${String(p.type)}` : '';
      const suffix = portableTempSuffix(name);
      lines.push(`${indent}const ${name}${typeAnnotation} = (${collection}).reduce((acc, ${item}) => {`);
      lines.push(`${indent}  const __kernKey_${suffix} = ${by};`);
      lines.push(`${indent}  acc[__kernKey_${suffix}] = (acc[__kernKey_${suffix}] ?? 0) + 1;`);
      lines.push(`${indent}  return acc;`);
      lines.push(`${indent}}, Object.create(null));`);
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

// Portable SSE body node types (slice 4c) — the subset of route nodes that
// composes inside a `stream`, plus the streaming primitives `fanout`/`emit`.
const PORTABLE_STREAM_TYPES = new Set([
  'derive',
  'let',
  'each',
  'fanout',
  'emit',
  'do',
  'assign',
  'branch',
  'collect',
  'count',
]);

export function hasPortableStreamBody(streamNode: IRNode): boolean {
  return (streamNode.children || []).some((c) => PORTABLE_STREAM_TYPES.has(c.type));
}

/**
 * Lower a portable `stream` body (derive/let/each/fanout/emit/…) to the SSE
 * handler lines that slot into `generateStreamWrap`. Reuses the request-scoped
 * `ac` AbortController the route scaffold always declares for stream routes
 * (`needsAbortController` is true whenever `hasStream`), so concurrent `fanout`
 * producers and `each await` loops stop once the client disconnects — without a
 * redundant second controller (Gemini review on slice 4c).
 */
export function generatePortableStreamExpress(
  streamNode: IRNode,
  indent: string,
  path: string,
  options: PortableExpressOptions = {},
): string[] {
  const lines: string[] = [];
  const streamOptions: PortableExpressOptions = { ...options, streamAbortVar: 'ac' };
  for (const child of streamNode.children || []) {
    if (PORTABLE_STREAM_TYPES.has(child.type)) {
      lines.push(...generatePortableChildExpress(child, indent, path, streamOptions));
    }
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
  const PORTABLE_TYPES = new Set([
    'derive',
    'guard',
    'filter',
    'handler',
    'respond',
    'branch',
    'each',
    'collect',
    'count',
    'objectMerge',
    'objectOmit',
    'objectPick',
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
      lines.push(...generatePortableChildExpress(child, indent, path, options));
    }
  }

  return lines;
}
