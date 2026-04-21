/**
 * Ground Layer Generators — derive, transform, action, guard, assume, invariant,
 * collect, resolve, expect, recover, pattern, apply.
 *
 * NOTE: generateEach and generateBranch remain in codegen-core.ts because they
 * call generateCoreNode recursively (avoiding circular imports).
 *
 * Extracted from codegen-core.ts for modular codegen architecture.
 */

import { KernCodegenError } from '../errors.js';
import { propsOf } from '../node-props.js';
import { expandTemplateNode, isTemplateNode } from '../template-engine.js';
import type { ExprObject, IRNode } from '../types.js';
import { emitIdentifier, emitTypeAnnotation } from './emitters.js';
import {
  capitalize,
  emitLowConfidenceTodo,
  emitReasonAnnotations,
  exportPrefix,
  getChildren,
  getFirstChild,
  getProps,
  handlerCode,
  parseParamList,
} from './helpers.js';

const p = getProps;
const kids = getChildren;
const firstChild = getFirstChild;

// ── Ground Layer: derive ─────────────────────────────────────────────────

export function generateDerive(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'derive'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'derived', node);
  // expr is by-design raw code (escape hatch)
  const expr = props.expr;
  const constType = props.type;
  const exp = exportPrefix(node);

  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = ${expr};`];
}

// ── Ground Layer: fmt ────────────────────────────────────────────────────
// `fmt name=label template="${count} files"` →
//   const label = `${count} files`;
//
// Why a dedicated node: string interpolation is ~15-20% of handler-block
// volume in agon (2026-04-20 scan). Expressing it as a named primitive keeps
// the IR declarative and lets tooling (reviewers, decompiler, codegen)
// recognise "this is a formatted string" without parsing a handler body.
//
// The template body is spliced verbatim into a JS template literal, so
// `${expr}` placeholders work exactly as in JS. Raw backticks in the author
// input are escaped to `\`` so the emitted template literal cannot be closed
// accidentally — `${...}` is the contract, arbitrary JS injection is not.

export function generateFmt(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'fmt'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'formatted', node);
  const template = props.template;
  if (template === undefined || template === null) {
    throw new KernCodegenError("fmt node requires a 'template' prop", node);
  }
  const constType = props.type;
  const exp = exportPrefix(node);

  // Escape backticks so the emitted template literal can't be closed
  // prematurely. `${...}` is intentionally passed through untouched — that's
  // the whole reason fmt exists.
  const escapedTemplate = String(template).replace(/\\/g, '\\\\').replace(/`/g, '\\`');

  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = \`${escapedTemplate}\`;`];
}

// ── Ground Layer: transform ──────────────────────────────────────────────

export function generateTransform(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'transform'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'transform', node);
  // target and via are by-design raw code (escape hatches)
  const target = props.target;
  const via = props.via;
  const constType = props.type;
  const exp = exportPrefix(node);
  const code = handlerCode(node);

  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';

  if (code) {
    // Handler block form — generate a function
    const lines: string[] = [...todo, ...annotations];
    lines.push(`${exp}function ${name}(state: unknown)${typeAnnotation} {`);
    for (const line of code.split('\n')) {
      lines.push(`  ${line}`);
    }
    lines.push('}');
    return lines;
  }

  if (target && via) {
    return [
      ...todo,
      ...annotations,
      `${exp}const ${name}${typeAnnotation} = ${via.replace(/\(/, `(${target}, `).replace(/, \)/, ')')};`,
    ];
  }
  if (via) {
    return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = ${via};`];
  }
  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation};`];
}

// ── Ground Layer: action ─────────────────────────────────────────────────

export function generateAction(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'action'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'action', node);
  const idempotent =
    (props as Record<string, unknown>).idempotent === 'true' || (props as Record<string, unknown>).idempotent === true;
  const reversible =
    (props as Record<string, unknown>).reversible === 'true' || (props as Record<string, unknown>).reversible === true;
  const params = props.params || '';
  const returns = props.returns;
  const exp = exportPrefix(node);
  const code = handlerCode(node);

  const lines: string[] = [...todo, ...annotations];

  // JSDoc for action metadata
  const metaParts: string[] = [];
  if (idempotent) metaParts.push('idempotent=true');
  if (reversible) metaParts.push('reversible=true');
  if (metaParts.length > 0) {
    lines.push(`/** @action ${metaParts.join(' ')} */`);
  }

  const paramList = params ? parseParamList(params) : '';
  const retClause = returns ? `: Promise<${emitTypeAnnotation(returns, 'void', node)}>` : ': Promise<void>';
  lines.push(`${exp}async function ${name}(${paramList})${retClause} {`);
  if (code) {
    for (const line of code.split('\n')) {
      lines.push(`  ${line}`);
    }
  }
  lines.push('}');
  return lines;
}

// ── Ground Layer: actionRegistry ─────────────────────────────────────────
//
// Emits `<target>({ "<key>": async (<params>) => { <body> }, ... });` so that
// files like `registerActions({ 'share': async () => {...}, ... })` become
// first-class KERN nodes instead of IIFE-wrapped handler escape hatches.
// `target` accepts a bare identifier (`target=registerActions`) or a rawExpr
// block (`target={{ router.register }}`). Each child action uses `key=` for
// the registration string (or falls back to `name=`).

export function generateActionRegistry(node: IRNode): string[] {
  const props = propsOf<'actionRegistry'>(node);
  const rawTarget = props.target;
  const target =
    typeof rawTarget === 'object' && rawTarget !== null && '__expr' in rawTarget
      ? (rawTarget as { code: string }).code
      : typeof rawTarget === 'string'
        ? rawTarget
        : '';
  if (!target) {
    throw new KernCodegenError('actionRegistry requires a `target` prop', node);
  }

  const actions = kids(node, 'action');
  if (actions.length === 0) {
    return [`${target}({});`];
  }

  const lines: string[] = [`${target}({`];
  for (let i = 0; i < actions.length; i++) {
    const child = actions[i];
    const cp = propsOf<'action'>(child);
    const key = cp.key ?? cp.name;
    if (!key) {
      throw new KernCodegenError('action inside actionRegistry requires `key` or `name`', child);
    }
    const params = cp.params ? parseParamList(cp.params) : '';
    const code = handlerCode(child);
    const comma = i === actions.length - 1 ? '' : ',';
    lines.push(`  ${JSON.stringify(key)}: async (${params}) => {`);
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push(`  }${comma}`);
  }
  lines.push('});');
  return lines;
}

// ── Ground Layer: guard ──────────────────────────────────────────────────

export function generateGuard(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'guard'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = props.name || 'guard';
  const expr = (props as Record<string, unknown>).expr as string;
  const elseCode = (props as Record<string, unknown>).else as string | undefined;

  const lines: string[] = [...todo, ...annotations];

  if (elseCode && /^\d+$/.test(elseCode)) {
    lines.push(`if (!(${expr})) { throw new HttpError(${elseCode}, 'Guard: ${name}'); }`);
  } else if (elseCode) {
    lines.push(`if (!(${expr})) { ${elseCode}; }`);
  } else {
    lines.push(`if (!(${expr})) { throw new Error('Guard failed: ${name}'); }`);
  }
  return lines;
}

// ── Ground Layer: assume ─────────────────────────────────────────────────

export function generateAssume(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'assume'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const expr = props.expr;
  const scope = ((props as Record<string, unknown>).scope as string) || 'request';
  const evidence = (props as Record<string, unknown>).evidence as string | undefined;
  const fallback = (props as Record<string, unknown>).fallback as string | undefined;

  if (!evidence) throw new KernCodegenError('assume requires evidence prop', node);
  if (!fallback) throw new KernCodegenError('assume requires fallback prop', node);

  const lines: string[] = [...todo, ...annotations];
  lines.push(`/** @assume ${expr} @scope ${scope} @evidence ${evidence} */`);
  lines.push(`if (process.env.NODE_ENV !== 'production') {`);
  lines.push(`  if (!(${expr})) { ${fallback}; }`);
  lines.push(`}`);
  return lines;
}

// ── Ground Layer: invariant ──────────────────────────────────────────────

export function generateInvariant(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'invariant'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = props.name || 'invariant';
  const expr = props.expr;

  const lines: string[] = [...todo, ...annotations];
  lines.push(`console.assert(${expr}, 'Invariant: ${name}');`);
  return lines;
}

// ── Ground Layer: collect ────────────────────────────────────────────────

export function generateCollect(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'collect'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'collected', node);
  const from = props.from;
  const where = props.where;
  const limit = props.limit;
  const order = props.order;
  const exp = exportPrefix(node);

  let chain = from;
  if (where) chain += `.filter(item => ${where})`;
  if (order) chain += `.sort((a, b) => ${order})`;
  if (limit) chain += `.slice(0, ${limit})`;

  return [...todo, ...annotations, `${exp}const ${name} = ${chain};`];
}

// ── Ground Layer: resolve / candidate / discriminator ────────────────────

export function generateResolve(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'resolve'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'resolver', node);
  const candidates = kids(node, 'candidate');
  const discriminator = firstChild(node, 'discriminator');

  if (!discriminator) throw new KernCodegenError('resolve requires discriminator', node);

  const lines: string[] = [...todo, ...annotations];
  const dp = p(discriminator);
  const method = (dp.method as string) || 'select';
  const metric = (dp.metric as string) || '';

  // Candidate array
  lines.push(`/** resolve: ${name} */`);
  lines.push(`const _${name}_candidates = [`);
  for (const c of candidates) {
    const cp = p(c);
    const cname = emitIdentifier(cp.name as string, 'candidate', c);
    const code = handlerCode(c);
    lines.push(`  { name: '${cname}', fn: (signal: unknown) => { ${code.trim()} } },`);
  }
  lines.push(`];`);
  lines.push('');

  // Resolver function
  const discCode = handlerCode(discriminator);
  lines.push(`async function resolve${capitalize(name)}(signal: unknown): Promise<unknown> {`);
  lines.push(`  const candidates = _${name}_candidates;`);
  lines.push(`  // discriminator: ${method}(${metric})`);
  if (discCode) {
    for (const line of discCode.split('\n')) {
      lines.push(`  ${line}`);
    }
  }
  lines.push(`  return candidates[winnerIdx].fn(signal);`);
  lines.push('}');
  return lines;
}

// ── Ground Layer: expect ─────────────────────────────────────────────────

export function generateExpect(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'expect'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = props.name || 'expected';
  const expr = props.expr;
  const within = props.within;
  const max = props.max;
  const min = props.min;

  const lines: string[] = [...todo, ...annotations];
  lines.push(`if (process.env.NODE_ENV !== 'production') {`);
  lines.push(`  const _${name} = ${expr};`);

  if (within) {
    const [lo, hi] = within.split('..');
    lines.push(
      `  console.assert(_${name} >= ${lo} && _${name} <= ${hi}, 'Expected ${name} in [${lo}, ${hi}], got ' + _${name});`,
    );
  } else if (min && max) {
    lines.push(
      `  console.assert(_${name} >= ${min} && _${name} <= ${max}, 'Expected ${name} in [${min}, ${max}], got ' + _${name});`,
    );
  } else if (max) {
    lines.push(`  console.assert(_${name} <= ${max}, 'Expected ${name} <= ${max}, got ' + _${name});`);
  } else if (min) {
    lines.push(`  console.assert(_${name} >= ${min}, 'Expected ${name} >= ${min}, got ' + _${name});`);
  } else {
    lines.push(`  console.assert(_${name} != null, 'Expected ${name} to be defined');`);
  }

  lines.push('}');
  return lines;
}

// ── Ground Layer: array methods ──────────────────────────────────────────
// Seven declarative array-method primitives:
//   filter / find / some / every → predicate-over-collection (share helper)
//   reduce  → accumulation with two bindings (acc + item)
//   flatMap → projection + flatten
//   slice   → range copy, no per-item binding
//
// Why seven distinct names instead of one generic: KERN is an LLM-authored
// language. Giving each method a named structural anchor lets tooling
// (decompiler, review, codegen) recognise author intent without grepping
// a method name out of a string. `.map` already has `each` and so is not
// repeated here. The `where` / `expr` prop split mirrors the semantic
// distinction: `where` = boolean predicate, `expr` = arrow body returning
// a value.

/** Unwrap an `{ __expr: true, code }` shape or pass through a plain string. */
function unwrapExpr(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'object' && (raw as ExprObject).__expr) {
    return (raw as ExprObject).code;
  }
  return typeof raw === 'string' ? raw : String(raw);
}

function generateArrayMethod(node: IRNode, method: 'filter' | 'find' | 'some' | 'every'): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<typeof method>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, method, node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError(`${method} node requires an 'in' prop`, node);

  const predicate = unwrapExpr(props.where);
  if (!predicate) throw new KernCodegenError(`${method} node requires a 'where' prop`, node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = (${collection}).${method}((${item}) => ${predicate});`,
  ];
}

export function generateFilter(node: IRNode): string[] {
  return generateArrayMethod(node, 'filter');
}

// ── Ground Layer: reduce ─────────────────────────────────────────────────
// `reduce name=total in=items initial="0" expr="acc + item.value"`
//   → const total = items.reduce((acc, item) => acc + item.value, 0);
// Two bound names (acc, item) default to those identifiers; override with
// `acc=` / `item=`. Body (`expr`) and seed (`initial`) are both required.

export function generateReduce(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'reduce'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'reduced', node);
  const acc = emitIdentifier((props.acc as string) || 'acc', 'acc', node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("reduce node requires an 'in' prop", node);
  const initial = unwrapExpr(props.initial);
  if (!initial) throw new KernCodegenError("reduce node requires an 'initial' prop", node);
  const body = unwrapExpr(props.expr);
  if (!body) throw new KernCodegenError("reduce node requires an 'expr' prop", node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = (${collection}).reduce((${acc}, ${item}) => ${body}, ${initial});`,
  ];
}

// ── Ground Layer: flatMap ────────────────────────────────────────────────
// `flatMap name=tags in=posts expr="item.tags"`
//   → const tags = posts.flatMap((item) => item.tags);
// `expr` is the arrow body (array/iterable), not a predicate. Use the same
// shape as `filter` etc., but with `expr` instead of `where`.

export function generateFlatMap(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'flatMap'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'flatMapped', node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("flatMap node requires an 'in' prop", node);
  const body = unwrapExpr(props.expr);
  if (!body) throw new KernCodegenError("flatMap node requires an 'expr' prop", node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = (${collection}).flatMap((${item}) => ${body});`,
  ];
}

// ── Ground Layer: slice ──────────────────────────────────────────────────
// `slice name=first5 in=items start=0 end=5`
//   → const first5 = items.slice(0, 5);
// Both indices are optional — `.slice()` with no args copies the whole
// array, `.slice(2)` copies from index 2 onward. Emit exactly what was
// supplied, in that order.

export function generateSlice(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'slice'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'sliced', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("slice node requires an 'in' prop", node);
  const start = unwrapExpr(props.start);
  const end = unwrapExpr(props.end);

  const args: string[] = [];
  if (start !== undefined) args.push(start);
  if (end !== undefined) {
    if (start === undefined) args.push('0');
    args.push(end);
  }

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = (${collection}).slice(${args.join(', ')});`];
}

export function generateFind(node: IRNode): string[] {
  return generateArrayMethod(node, 'find');
}

export function generateSome(node: IRNode): string[] {
  return generateArrayMethod(node, 'some');
}

export function generateEvery(node: IRNode): string[] {
  return generateArrayMethod(node, 'every');
}

// ── Ground Layer: async ──────────────────────────────────────────────────
// `async name=loadUser` with a `handler` child runs its body inside an IIFE.
// With an optional trailing `recover` child, delegates recovery to the
// existing `recover`/`strategy` machinery (see `generateRecover` below) —
// the emitted `<name>WithRecovery<T>` wrapper is invoked with the body as
// its Promise-returning `fn`.
//
// Design: the `async` primitive reuses existing recover/strategy semantics
// rather than inventing a new error-handling path. `derive` and `set` are
// intentionally NOT made awaitable — their identity as direct bindings /
// state updates stays pure.

export function generateAsync(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'async'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'asyncBlock', node);

  const handler = firstChild(node, 'handler');
  if (!handler) {
    throw new KernCodegenError('async block requires a `handler <<<>>>` child with the body', node);
  }
  // handlerCode() takes the PARENT that has a handler child — pass `node`, not `handler`.
  const body = handlerCode(node);

  const recover = firstChild(node, 'recover');

  const lines: string[] = [...todo, ...annotations];

  if (!recover) {
    // Bare IIFE — fire-and-forget. Parent context decides whether to await it.
    lines.push(`(async () => {`);
    if (body) {
      for (const line of body.split('\n')) {
        lines.push(`  ${line}`);
      }
    }
    lines.push(`})();`);
    return lines;
  }

  // With recovery: emit the reusable wrapper, then invoke it. The recover
  // node inherits the async block's name so generateRecover emits
  // `<name>WithRecovery<T>(...)` — one symbol that ties the two together.
  const namedRecover: IRNode = {
    ...recover,
    props: { ...(recover.props || {}), name },
  };
  lines.push(...generateRecover(namedRecover));
  lines.push(`${name}WithRecovery(async () => {`);
  if (body) {
    for (const line of body.split('\n')) {
      lines.push(`  ${line}`);
    }
  }
  lines.push(`});`);
  return lines;
}

// ── Ground Layer: recover / strategy ─────────────────────────────────────

export function generateRecover(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'recover'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'recovery', node);
  const strategies = kids(node, 'strategy');

  const hasFallback = strategies.some((s) => (p(s).name as string) === 'fallback');
  if (!hasFallback) throw new KernCodegenError('recover requires a fallback strategy', node);

  const lines: string[] = [...todo, ...annotations];
  lines.push(`/** recover: ${name} */`);
  lines.push(`async function ${name}WithRecovery<T>(fn: () => Promise<T>): Promise<T> {`);

  for (const strategy of strategies) {
    const sp = p(strategy);
    const sname = emitIdentifier(sp.name as string, 'strategy', strategy);
    const code = handlerCode(strategy);

    if (sname === 'retry') {
      const max = Number(sp.max) || 3;
      const delay = Number(sp.delay) || 1000;
      lines.push(`  // strategy: retry (max=${max}, delay=${delay}ms)`);
      lines.push(`  for (let _attempt = 0; _attempt < ${max}; _attempt++) {`);
      lines.push(`    try { return await fn(); }`);
      lines.push(`    catch { if (_attempt < ${max - 1}) await new Promise(r => setTimeout(r, ${delay})); }`);
      lines.push(`  }`);
    } else if (sname === 'fallback') {
      lines.push(`  // strategy: fallback (terminal)`);
      if (code) {
        for (const line of code.split('\n')) {
          lines.push(`  ${line}`);
        }
      } else {
        lines.push(`  throw new Error('All recovery strategies exhausted for ${name}');`);
      }
    } else {
      // compensate, degrade, or custom
      lines.push(`  // strategy: ${sname}`);
      lines.push(`  try {`);
      if (code) {
        for (const line of code.split('\n')) {
          lines.push(`    ${line}`);
        }
      }
      lines.push(`  } catch {}`);
    }
  }

  lines.push('}');
  return lines;
}

// ── Ground Layer: pattern / apply ────────────────────────────────────────

export function generatePattern(_node: IRNode): string[] {
  // pattern nodes are registered as templates — no direct output
  return [];
}

export function generateApply(node: IRNode, _depth = 0): string[] {
  // apply nodes expand the referenced pattern
  const props = propsOf<'pattern'>(node);
  const patternName = props.pattern;
  if (!patternName) return [];

  // Delegate to template expansion — propagate depth to prevent infinite recursion
  const syntheticNode: IRNode = { ...node, type: patternName };
  if (isTemplateNode(patternName)) {
    return expandTemplateNode(syntheticNode, _depth + 1);
  }
  return [`// apply: pattern '${patternName}' not found`];
}
