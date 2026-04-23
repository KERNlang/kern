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
import { emitFmtTemplate, emitIdentifier, emitTypeAnnotation } from './emitters.js';
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
// `fmt return=true template="${ms}ms"` (inside a fn body) →
//   return `${ms}ms`;
//
// Why a dedicated node: string interpolation is ~15-20% of handler-block
// volume in agon (2026-04-20 scan). Expressing it as a named primitive keeps
// the IR declarative and lets tooling (reviewers, decompiler, codegen)
// recognise "this is a formatted string" without parsing a handler body. The
// return-position form (gap #6) covers the ~50% of template-literal sites
// that appear as the `return` expression of small formatter fns.
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
  const template = props.template;
  if (template === undefined || template === null) {
    throw new KernCodegenError("fmt node requires a 'template' prop", node);
  }

  // `${...}` is intentionally passed through untouched — that's the whole
  // reason fmt exists. `emitFmtTemplate` escapes backslashes and raw
  // backticks so the literal can't be closed prematurely.
  const escapedTemplate = emitFmtTemplate(String(template));

  const returnMode = props.return === true || props.return === 'true';
  if (returnMode) {
    if (props.name !== undefined) {
      throw new KernCodegenError(
        "fmt with return=true must not carry a 'name' prop — return-position emits `return `...``;`",
        node,
      );
    }
    return [...todo, ...annotations, `return \`${escapedTemplate}\`;`];
  }

  // Inline-JSX form (no `name`, no `return=true`) is consumed by the parent
  // `render`/`group` walk in codegen/screens.ts. If it reaches this
  // statement-level dispatcher, it was placed where no consumer can read
  // it — fail loudly instead of emitting a surprise `const formatted = …;`.
  if (props.name === undefined) {
    throw new KernCodegenError(
      'fmt without `name` or `return=true` is the inline-JSX form — it must be a direct child of `render` or `group`.',
      node,
    );
  }

  const name = emitIdentifier(props.name, 'formatted', node);
  const constType = props.type;
  const exp = exportPrefix(node);
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
// Declarative array-method primitives — each is its own named node type:
//   filter / find / some / every / findIndex → predicate-over-collection
//   map / flatMap                             → projection (arrow body)
//   reduce                                    → accumulation (acc + item)
//   sort                                      → optional compare function (immutable via spread)
//   reverse / flat / slice / at               → shape-preserving or range ops
//   join / includes / indexOf / lastIndexOf   → value-returning lookups
//   concat                                    → array concatenation
//   forEach                                   → side-effect loop (statement, no binding)
//
// Why distinct names instead of one generic: KERN is an LLM-authored
// language. Giving each method a named structural anchor lets tooling
// (decompiler, review, codegen) recognise author intent without grepping
// a method name out of a string. The `where` / `expr` prop split mirrors
// the semantic distinction: `where` = boolean predicate, `expr` = arrow
// body returning a value. `each` remains the render-block JSX iteration
// primitive; `map` is its expression-form sibling for data-transformation.

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

// ── Ground Layer: map ────────────────────────────────────────────────────
// `map name=names in=users expr="item.name"`
//   → const names = (users).map((item) => item.name);
// Sibling to `each` (JSX form). Shape mirrors flatMap exactly — expr is the
// arrow body, not a predicate.

export function generateMap(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'map'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'mapped', node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("map node requires an 'in' prop", node);
  const body = unwrapExpr(props.expr);
  if (!body) throw new KernCodegenError("map node requires an 'expr' prop", node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = (${collection}).map((${item}) => ${body});`];
}

// ── Ground Layer: findIndex ──────────────────────────────────────────────
// `findIndex name=i in=users where="item.active"`
//   → const i = (users).findIndex((item) => item.active);
// Predicate-shaped like find, but returns a number. Defaults the binding
// type suggestion to `number` in comments; author-supplied `type=` wins.

export function generateFindIndex(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'findIndex'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'index', node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("findIndex node requires an 'in' prop", node);
  const predicate = unwrapExpr(props.where);
  if (!predicate) throw new KernCodegenError("findIndex node requires a 'where' prop", node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = (${collection}).findIndex((${item}) => ${predicate});`,
  ];
}

// ── Ground Layer: sort ───────────────────────────────────────────────────
// `sort name=sorted in=items compare="a.age - b.age"`
//   → const sorted = [...(items)].sort((a, b) => a.age - b.age);
// With no `compare`, emits `[...(items)].sort()` — JS lexicographic default.
// Immutable via spread so the source collection is not mutated.

export function generateSort(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'sort'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'sorted', node);
  const a = emitIdentifier((props.a as string) || 'a', 'a', node);
  const b = emitIdentifier((props.b as string) || 'b', 'b', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("sort node requires an 'in' prop", node);
  const compare = unwrapExpr(props.compare);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  const call = compare ? `sort((${a}, ${b}) => ${compare})` : 'sort()';
  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = [...(${collection})].${call};`];
}

// ── Ground Layer: reverse ────────────────────────────────────────────────
// `reverse name=reversed in=items` → const reversed = [...(items)].reverse();
// Immutable via spread; matches sort's shape for consistency.

export function generateReverse(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'reverse'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'reversed', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("reverse node requires an 'in' prop", node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = [...(${collection})].reverse();`];
}

// ── Ground Layer: flat ───────────────────────────────────────────────────
// `flat name=flattened in=nested depth=2` → const flattened = (nested).flat(2);
// `depth` omitted → bare `.flat()` (default depth 1).

export function generateFlat(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'flat'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'flattened', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("flat node requires an 'in' prop", node);
  const depth = unwrapExpr(props.depth);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  const call = depth !== undefined ? `flat(${depth})` : 'flat()';
  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = (${collection}).${call};`];
}

// ── Ground Layer: at ─────────────────────────────────────────────────────
// `at name=first in=items index=0` → const first = (items).at(0);

export function generateAt(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'at'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'element', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("at node requires an 'in' prop", node);
  const index = unwrapExpr(props.index);
  if (index === undefined) throw new KernCodegenError("at node requires an 'index' prop", node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = (${collection}).at(${index});`];
}

// ── Ground Layer: join ───────────────────────────────────────────────────
// `join name=csv in=fields separator=","` → const csv = (fields).join(',');
// `separator` omitted → bare `.join()` (default "," per JS).
// The separator is emitted as a quoted string literal when plain, or as a
// raw expression when wrapped as `{{ expr }}`.

export function generateJoin(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'join'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'joined', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("join node requires an 'in' prop", node);

  const sepRaw = props.separator;
  let sepArg = '';
  if (sepRaw !== undefined && sepRaw !== null) {
    if (typeof sepRaw === 'object' && (sepRaw as ExprObject).__expr) {
      sepArg = (sepRaw as ExprObject).code;
    } else {
      const s = String(sepRaw);
      sepArg = `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    }
  }

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = (${collection}).join(${sepArg});`];
}

// ── Ground Layer: includes / indexOf / lastIndexOf ───────────────────────
// All three share shape: `<method> name=X in=Y value="..." [from=N]`.
// `value` is always a raw expression (no implicit quoting — authors write
// `value="'fatal'"` for a string literal, `value=target` for a variable).

function generateValueLookup(node: IRNode, method: 'includes' | 'indexOf' | 'lastIndexOf'): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<typeof method>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const fallback = method === 'includes' ? 'has' : 'idx';
  const name = emitIdentifier(props.name, fallback, node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError(`${method} node requires an 'in' prop`, node);
  const value = unwrapExpr(props.value);
  if (value === undefined) throw new KernCodegenError(`${method} node requires a 'value' prop`, node);
  const from = unwrapExpr(props.from);

  const args = from !== undefined ? `${value}, ${from}` : value;
  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = (${collection}).${method}(${args});`];
}

export function generateIncludes(node: IRNode): string[] {
  return generateValueLookup(node, 'includes');
}

export function generateIndexOf(node: IRNode): string[] {
  return generateValueLookup(node, 'indexOf');
}

export function generateLastIndexOf(node: IRNode): string[] {
  return generateValueLookup(node, 'lastIndexOf');
}

// ── Ground Layer: concat ─────────────────────────────────────────────────
// `concat name=all in=items with="a, b"` → const all = (items).concat(a, b);
// `with` is a raw expression injected directly — supports one arg or
// comma-separated spread. For a single array arg, write `with="other"`.

export function generateConcat(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'concat'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'combined', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("concat node requires an 'in' prop", node);
  const withArg = unwrapExpr(props.with);
  if (!withArg) throw new KernCodegenError("concat node requires a 'with' prop", node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = (${collection}).concat(${withArg});`];
}

// ── Ground Layer: forEach ────────────────────────────────────────────────
// Statement primitive — no `name`, no `const` binding. Takes a handler child
// and emits `(in).forEach((item[, index]) => { handlerBody });`.
// Distinct from `each` (JSX composition) and `map` (value binding).

export function generateForEach(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'forEach'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);
  const indexName = props.index ? emitIdentifier(props.index as string, 'index', node) : undefined;

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("forEach node requires an 'in' prop", node);

  const handler = firstChild(node, 'handler');
  if (!handler) {
    throw new KernCodegenError('forEach node requires a `handler <<<>>>` child with the loop body', node);
  }
  const body = handlerCode(node);

  const params = indexName ? `(${item}, ${indexName})` : `(${item})`;
  const lines: string[] = [...todo, ...annotations];
  lines.push(`(${collection}).forEach(${params} => {`);
  for (const line of body.split('\n')) lines.push(`  ${line}`);
  lines.push('});');
  return lines;
}

// ── Ground Layer: compact ────────────────────────────────────────────────
// `compact name=truthy in=items` → `const truthy = (items).filter(Boolean);`
// Lodash-style named primitive for the very common `.filter(Boolean)` pattern.
// Agon scan: 36 call sites. Zero runtime cost vs the raw form; pure naming win.

export function generateCompact(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'compact'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'compacted', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("compact node requires an 'in' prop", node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = (${collection}).filter(Boolean);`];
}

// ── Ground Layer: pluck ──────────────────────────────────────────────────
// `pluck name=names in=users prop=name`
//   → const names = (users).map((item) => item.name);
// `prop` is a raw identifier path — `prop=user.profile.name` emits
// `item.user.profile.name`. Distinct from `map` because the author's intent is
// just "lift one field out of each item" and the shape is fixed.

export function generatePluck(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'pluck'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'plucked', node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("pluck node requires an 'in' prop", node);
  const prop = unwrapExpr(props.prop);
  if (!prop) throw new KernCodegenError("pluck node requires a 'prop' prop", node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = (${collection}).map((${item}) => ${item}.${prop});`,
  ];
}

// ── Ground Layer: unique ─────────────────────────────────────────────────
// `unique name=distinct in=items` → `const distinct = [...new Set(items)];`
// Deduplicates by JS `Set` identity (triple-equals on primitives, reference
// equality on objects). For object arrays with a key selector, use
// `uniqueBy` (ships in the arrays-complete-pt2 PR).

export function generateUnique(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'unique'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'distinct', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("unique node requires an 'in' prop", node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = [...new Set(${collection})];`];
}

// ── Ground Layer: uniqueBy ───────────────────────────────────────────────
// `uniqueBy name=distinct in=users by="item.id"`
//   → const distinct = [...new Map((users).map((item) => [item.id, item])).values()];

export function generateUniqueBy(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'uniqueBy'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'distinct', node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("uniqueBy node requires an 'in' prop", node);
  const by = unwrapExpr(props.by);
  if (!by) throw new KernCodegenError("uniqueBy node requires a 'by' prop", node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  // First-wins semantics to match Lodash `uniqBy`. Uses Set+filter rather
  // than Map-constructor (which would keep the last occurrence).
  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = ((__seen) => (${collection}).filter((${item}) => {`,
    `  const __k = ${by};`,
    `  if (__seen.has(__k)) return false;`,
    `  __seen.add(__k);`,
    `  return true;`,
    `}))(new Set());`,
  ];
}

// ── Ground Layer: groupBy ────────────────────────────────────────────────
// `groupBy name=byType in=items by="item.type"`
//   → const byType = Object.groupBy(items, (item) => item.type);
// ES2024 Object.groupBy. Returns `Partial<Record<K, T[]>>`.

export function generateGroupBy(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'groupBy'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'grouped', node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("groupBy node requires an 'in' prop", node);
  const by = unwrapExpr(props.by);
  if (!by) throw new KernCodegenError("groupBy node requires a 'by' prop", node);

  const constType = (props.type as string | undefined) || 'Record<string, unknown[]>';
  const typeAnn = emitTypeAnnotation(constType, 'Record<string, unknown[]>', node);
  const exp = exportPrefix(node);

  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}: ${typeAnn} = (${collection}).reduce((acc, ${item}) => {`,
    `  const __k = ${by};`,
    `  (acc[__k] ??= []).push(${item});`,
    `  return acc;`,
    `}, Object.create(null) as ${typeAnn});`,
  ];
}

// ── Ground Layer: partition ──────────────────────────────────────────────
// Two-output primitive: emits a destructured const. Dual-filter shape for
// clarity (two passes but readable).

export function generatePartition(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'partition'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const passName = emitIdentifier(props.pass as string | undefined, 'pass', node);
  const failName = emitIdentifier(props.fail as string | undefined, 'fail', node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("partition node requires an 'in' prop", node);
  const predicate = unwrapExpr(props.where);
  if (!predicate) throw new KernCodegenError("partition node requires a 'where' prop", node);

  const constType = props.type as string | undefined;
  const elemType = constType ? emitTypeAnnotation(constType, 'unknown', node) : 'unknown';
  const typeAnnotation = constType ? `: [${elemType}[], ${elemType}[]]` : '';
  const exp = exportPrefix(node);

  // Single-pass reduce so the collection and predicate each evaluate once
  // per item — avoids double side effects from the dual-filter shape.
  return [
    ...todo,
    ...annotations,
    `${exp}const [${passName}, ${failName}]${typeAnnotation} = (${collection}).reduce<[${elemType}[], ${elemType}[]]>((acc, ${item}) => {`,
    `  (${predicate} ? acc[0] : acc[1]).push(${item});`,
    `  return acc;`,
    `}, [[], []]);`,
  ];
}

// ── Ground Layer: indexBy ────────────────────────────────────────────────
// `indexBy name=byId in=users by="item.id"`
//   → const byId = Object.fromEntries((users).map((item) => [item.id, item]));

export function generateIndexBy(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'indexBy'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'indexed', node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("indexBy node requires an 'in' prop", node);
  const by = unwrapExpr(props.by);
  if (!by) throw new KernCodegenError("indexBy node requires a 'by' prop", node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = Object.fromEntries((${collection}).map((${item}) => [${by}, ${item}]));`,
  ];
}

// ── Ground Layer: countBy ────────────────────────────────────────────────
// Multi-line reduce — `Record<string, number>` default type.

export function generateCountBy(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'countBy'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'counts', node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("countBy node requires an 'in' prop", node);
  const by = unwrapExpr(props.by);
  if (!by) throw new KernCodegenError("countBy node requires a 'by' prop", node);

  const constType = (props.type as string | undefined) || 'Record<string, number>';
  const typeAnn = emitTypeAnnotation(constType, 'Record<string, number>', node);
  const exp = exportPrefix(node);

  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}: ${typeAnn} = (${collection}).reduce((acc, ${item}) => {`,
    `  const __k = ${by};`,
    `  acc[__k] = (acc[__k] ?? 0) + 1;`,
    `  return acc;`,
    `}, Object.create(null) as ${typeAnn});`,
  ];
}

// ── Ground Layer: chunk ──────────────────────────────────────────────────
// Fixed-size splitting.

export function generateChunk(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'chunk'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'chunks', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("chunk node requires an 'in' prop", node);
  const size = unwrapExpr(props.size);
  if (!size) throw new KernCodegenError("chunk node requires a 'size' prop", node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  // IIFE so the collection and size expressions are evaluated once each —
  // important if either is expensive or has side effects.
  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = ((__src, __n) => Array.from({ length: Math.ceil(__src.length / __n) }, (_, i) => __src.slice(i * __n, (i + 1) * __n)))((${collection}), (${size}));`,
  ];
}

// ── Ground Layer: zip ────────────────────────────────────────────────────

export function generateZip(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'zip'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'pairs', node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);
  const indexName = emitIdentifier((props.index as string) || '__i', '__i', node);

  const left = unwrapExpr(props.in);
  if (!left) throw new KernCodegenError("zip node requires an 'in' prop", node);
  const right = unwrapExpr(props.with);
  if (!right) throw new KernCodegenError("zip node requires a 'with' prop", node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  // Bind the right collection once via IIFE — without this, `with=getOther()`
  // would call getOther() once per element inside the map callback.
  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = ((__r) => (${left}).map((${item}, ${indexName}) => [${item}, __r[${indexName}]]))((${right}));`,
  ];
}

// ── Ground Layer: range ──────────────────────────────────────────────────

export function generateRange(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'range'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'range', node);

  const end = unwrapExpr(props.end);
  if (!end) throw new KernCodegenError("range node requires an 'end' prop", node);
  const start = unwrapExpr(props.start) ?? '0';

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'number[]', node)}` : '';
  const exp = exportPrefix(node);

  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = Array.from({ length: (${end}) - (${start}) }, (_, i) => i + (${start}));`,
  ];
}

// ── Ground Layer: take / drop ────────────────────────────────────────────

function generateTakeOrDrop(node: IRNode, which: 'take' | 'drop'): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<typeof which>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const fallback = which === 'take' ? 'taken' : 'dropped';
  const name = emitIdentifier(props.name, fallback, node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError(`${which} node requires an 'in' prop`, node);
  const n = unwrapExpr(props.n);
  if (!n) throw new KernCodegenError(`${which} node requires an 'n' prop`, node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);
  const call = which === 'take' ? `slice(0, ${n})` : `slice(${n})`;

  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = (${collection}).${call};`];
}

export function generateTake(node: IRNode): string[] {
  return generateTakeOrDrop(node, 'take');
}

export function generateDrop(node: IRNode): string[] {
  return generateTakeOrDrop(node, 'drop');
}

// ── Ground Layer: min / max ──────────────────────────────────────────────

// Reduce-based (not `Math.min(...arr)` / `Math.max(...arr)`) to avoid:
//   1. Stack overflow on huge arrays (spread blows the arg count limit).
//   2. `Math.min()` returning `Infinity` and `Math.max()` returning
//      `-Infinity` on empty arrays — we return `undefined` instead.

function generateMathAgg(node: IRNode, which: 'min' | 'max'): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<typeof which>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const fallback = which === 'min' ? 'lowest' : 'highest';
  const name = emitIdentifier(props.name, fallback, node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError(`${which} node requires an 'in' prop`, node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'number', node)} | undefined` : '';
  const exp = exportPrefix(node);
  const op = which === 'min' ? '<' : '>';

  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = ((__src) => __src.length === 0 ? undefined : __src.reduce((__a: number, __b: number) => __b ${op} __a ? __b : __a))((${collection}));`,
  ];
}

export function generateMin(node: IRNode): string[] {
  return generateMathAgg(node, 'min');
}

export function generateMax(node: IRNode): string[] {
  return generateMathAgg(node, 'max');
}

// ── Ground Layer: minBy / maxBy ──────────────────────────────────────────
// Emits a closure `__key = (item) => by` so the author's `by` expression is
// evaluated as an arrow body — no fragile regex over the raw expression
// text that would corrupt string literals like `by="item.tags.includes('item')"`.
// The collection is bound once, so expensive or side-effecting `in=` only
// runs one time. Returns `undefined` for empty collections.

function generateByReducer(node: IRNode, which: 'min' | 'max'): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'minBy' | 'maxBy'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const fallback = which === 'min' ? 'youngest' : 'oldest';
  const name = emitIdentifier(props.name, fallback, node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError(`${which}By node requires an 'in' prop`, node);
  const by = unwrapExpr(props.by);
  if (!by) throw new KernCodegenError(`${which}By node requires a 'by' prop`, node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)} | undefined` : '';
  const exp = exportPrefix(node);
  const op = which === 'min' ? '<' : '>';

  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = ((__src) => {`,
    `  if (__src.length === 0) return undefined;`,
    `  const __key = (${item}: typeof __src[number]) => ${by};`,
    `  return __src.reduce((__best, __cur) => __key(__cur) ${op} __key(__best) ? __cur : __best);`,
    `})((${collection}));`,
  ];
}

export function generateMinBy(node: IRNode): string[] {
  return generateByReducer(node, 'min');
}

export function generateMaxBy(node: IRNode): string[] {
  return generateByReducer(node, 'max');
}

// ── Ground Layer: sum / avg / sumBy ──────────────────────────────────────

export function generateSum(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'sum'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'total', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("sum node requires an 'in' prop", node);

  const constType = (props.type as string | undefined) || 'number';
  const typeAnnotation = `: ${emitTypeAnnotation(constType, 'number', node)}`;
  const exp = exportPrefix(node);

  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = (${collection}).reduce((acc, n) => acc + n, 0);`,
  ];
}

export function generateAvg(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'avg'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'mean', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("avg node requires an 'in' prop", node);

  const constType = (props.type as string | undefined) || 'number';
  const typeAnnotation = `: ${emitTypeAnnotation(constType, 'number', node)}`;
  const exp = exportPrefix(node);

  // Returns `NaN` on empty input (matches Lodash `_.mean([])` and math
  // convention — "no data" signal rather than a fake 0). Bound via IIFE so
  // the `in=` expression is evaluated exactly once.
  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = ((__src) => __src.length === 0 ? Number.NaN : __src.reduce((acc, n) => acc + n, 0) / __src.length)((${collection}));`,
  ];
}

export function generateSumBy(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'sumBy'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'total', node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError("sumBy node requires an 'in' prop", node);
  const by = unwrapExpr(props.by);
  if (!by) throw new KernCodegenError("sumBy node requires a 'by' prop", node);

  const constType = (props.type as string | undefined) || 'number';
  const typeAnnotation = `: ${emitTypeAnnotation(constType, 'number', node)}`;
  const exp = exportPrefix(node);

  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = (${collection}).reduce((acc, ${item}) => acc + (${by}), 0);`,
  ];
}

// ── Ground Layer: intersect ──────────────────────────────────────────────
// Uses `new Set(right)` for O(N+M) lookup instead of the naive O(N×M)
// `.filter(...includes...)` pair. The right collection is bound once so
// expensive `with=` expressions don't re-run per element.

export function generateIntersect(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'intersect'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = emitIdentifier(props.name, 'shared', node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);

  const left = unwrapExpr(props.in);
  if (!left) throw new KernCodegenError("intersect node requires an 'in' prop", node);
  const right = unwrapExpr(props.with);
  if (!right) throw new KernCodegenError("intersect node requires a 'with' prop", node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = ((__r) => (${left}).filter((${item}) => __r.has(${item})))(new Set((${right})));`,
  ];
}

// ── Ground Layer: findLast / findLastIndex (ES2023) ──────────────────────

function generateFindLastPair(node: IRNode, which: 'findLast' | 'findLastIndex'): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<typeof which>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const fallback = which === 'findLast' ? 'lastMatch' : 'lastIndex';
  const name = emitIdentifier(props.name, fallback, node);
  const item = emitIdentifier((props.item as string) || 'item', 'item', node);

  const collection = unwrapExpr(props.in);
  if (!collection) throw new KernCodegenError(`${which} node requires an 'in' prop`, node);
  const predicate = unwrapExpr(props.where);
  if (!predicate) throw new KernCodegenError(`${which} node requires a 'where' prop`, node);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
  const exp = exportPrefix(node);

  return [
    ...todo,
    ...annotations,
    `${exp}const ${name}${typeAnnotation} = (${collection}).${which}((${item}) => ${predicate});`,
  ];
}

export function generateFindLast(node: IRNode): string[] {
  return generateFindLastPair(node, 'findLast');
}

export function generateFindLastIndex(node: IRNode): string[] {
  return generateFindLastPair(node, 'findLastIndex');
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

// ── Ground Layer: try / step / catch ─────────────────────────────────────
// `try name=loadUser` orchestrates a sequential try/catch. Each child is
// emitted in source order:
//
//   try name=loadUser
//     step name=res  await="fetch(url)"       →  const res = await (fetch(url));
//     step name=body await="res.json()"        →  const body = await (res.json());
//     handler <<< setUser(body); >>>           →  setUser(body);
//     catch name=err                           →  } catch (err) {
//       handler <<< setUser(null); >>>         →    setUser(null);
//                                              →  }
//
// Step names are in scope for later steps, the optional `handler` body, and
// the optional `catch` block's error binding. A `try` without `catch`
// surrounds its steps + handler but lets rejections propagate (useful when
// the caller owns the failure path).
//
// Why a dedicated node: agon scan (2026-04-23) counts 445 `await` +
// `try/catch` combos inside handlers — the dominant async-orchestration
// shape. `async` covers fire-and-forget; `try` covers the sequential
// fetch-parse-store pipeline that wraps most real error paths.

export function generateTry(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'try'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);

  const steps = kids(node, 'step');
  const handler = firstChild(node, 'handler');
  const catchNode = firstChild(node, 'catch');

  if (steps.length === 0 && !handler) {
    throw new KernCodegenError(
      '`try` block needs at least one `step` or a `handler` child — an empty try has no effect.',
      node,
    );
  }

  const lines: string[] = [...todo, ...annotations];
  lines.push('try {');

  for (const step of steps) {
    const sp = step.props || {};
    const stepName = emitIdentifier(sp.name as string, 'step', step);
    const rawAwait = sp.await;
    if (rawAwait === undefined || rawAwait === null) {
      throw new KernCodegenError(`\`step name=${stepName}\` requires an 'await' prop`, step);
    }
    const awaitExpr =
      rawAwait && typeof rawAwait === 'object' && (rawAwait as ExprObject).__expr
        ? (rawAwait as ExprObject).code
        : (rawAwait as string);
    const stepType = sp.type;
    const typeAnn = stepType ? `: ${emitTypeAnnotation(stepType as string, 'unknown', step)}` : '';
    lines.push(`  const ${stepName}${typeAnn} = await (${awaitExpr});`);
  }

  if (handler) {
    const body = handlerCode(node);
    for (const line of body.split('\n')) {
      if (line.length > 0) lines.push(`  ${line}`);
    }
  }

  if (catchNode) {
    const catchName = emitIdentifier((catchNode.props || {}).name as string, 'e', catchNode);
    lines.push(`} catch (${catchName}) {`);
    const body = handlerCode(catchNode);
    for (const line of body.split('\n')) {
      if (line.length > 0) lines.push(`  ${line}`);
    }
  }

  lines.push('}');
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
