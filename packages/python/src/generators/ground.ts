/**
 * Ground Layer generators — Python generation for KERN's ground-truth nodes:
 * derive, transform, action, guard, assume, invariant, each, collect, branch, resolve, expect, recover
 */

import type { ExprObject, IRNode, ValueIR } from '@kernlang/core';
import { emitStringKeyArray, handlerCode, parseExpression, parseKeys } from '@kernlang/core';
import { typescriptClosureClassifier } from '@kernlang/core/node';
import { emitPyExpressionWithImports, type PyExpressionEmitResult } from '../codegen-body-python.js';
import {
  buildPythonParamList,
  emitPyLowConfidenceTodo,
  emitPyReasonAnnotations,
  firstChild,
  kids,
  p,
} from '../codegen-helpers.js';
import {
  KERN_FMT_HELPER_PY,
  KERN_I32_HELPER_PY,
  KERN_JS_ARRAY_HELPERS_PY,
  KERN_JS_HELPER_PY,
  KERN_JS_OBJECT_HELPERS_PY,
  KERN_JS_STRING_HELPERS_PY,
  KERN_PAIR_HELPERS_PY,
  KERN_TMOD_HELPER_PY,
} from '../core/expr/helpers.js';
import { mapTsTypeToPython, toPythonBindingName, toSnakeCase } from '../type-map.js';

/** Ground/React Layer generators emit module-level statements and have NO
 *  per-statement channel for JS value→string coercion, so ground expressions
 *  opt out of coercion and keep the pre-slice forms (raw `+`, raw f-string
 *  interpolation, `None` for undefined, None-only `??`). Helper-dependent
 *  non-coercion lowerings, such as Array.fill, surface helpers through
 *  emitGroundExpression and prepend them next to the generated statement. */
const GROUND_EMIT = { coerceJsValues: false } as const;

// Slice 0.9 review fix — ground generators are Node-only and re-parse raw
// expression props whose value lists may contain block-bodied arrows, so they
// inject the TypeScript-backed closure classifier. All `parseExpression` calls
// in this module route through `parseExpr`.
const TS_PARSE_OPTS = { closureClassifier: typescriptClosureClassifier };
function parseExpr(input: string): ReturnType<typeof parseExpression> {
  return parseExpression(input, TS_PARSE_OPTS);
}

function emitGroundExpression(valueIR: ValueIR): PyExpressionEmitResult {
  return emitPyExpressionWithImports(valueIR, GROUND_EMIT);
}

function groundExpressionPrelude(results: readonly PyExpressionEmitResult[]): string[] {
  const imports = new Set<string>();
  const helpers = new Set<string>();
  for (const result of results) {
    for (const mod of result.imports) imports.add(mod);
    for (const helper of result.helpers) helpers.add(helper);
  }
  const importLines = [...imports].sort().map((mod) => `import ${mod} as __k_${mod}`);
  return [...importLines, ...[...helpers].flatMap((helper) => helper.split('\n'))];
}

function withGroundExpressionCode(result: PyExpressionEmitResult, code: string): PyExpressionEmitResult {
  return { code, imports: result.imports, helpers: result.helpers };
}

/** The closed set of runtime helper blocks `groundExpressionPrelude` can inline
 *  ahead of a ground statement (via `result.helpers`). Each is a self-contained
 *  multi-line Python block; when two ground statements in the SAME module both
 *  need one, the per-statement inlining repeats it. `dedupeGroundPrelude` uses
 *  this registry to drop the repeats at module-assembly time. Block granularity
 *  (not line) is required: distinct helpers share boilerplate lines
 *  (`    try:`, `        return 0`), so line-level dedup would corrupt them. */
const GROUND_PRELUDE_HELPER_BLOCKS: readonly string[][] = [
  KERN_FMT_HELPER_PY,
  KERN_I32_HELPER_PY,
  KERN_JS_ARRAY_HELPERS_PY,
  KERN_JS_HELPER_PY,
  KERN_JS_OBJECT_HELPERS_PY,
  KERN_JS_STRING_HELPERS_PY,
  KERN_PAIR_HELPERS_PY,
  KERN_TMOD_HELPER_PY,
]
  .map((block) => block.split('\n'))
  // Longest-first so a block that happens to be a prefix of a longer one can
  // never shadow it at a match site (none prefix-collide today; this guards
  // the registry against future helper additions).
  .sort((a, b) => b.length - a.length);

/** `groundExpressionPrelude` surfaces module-name imports as
 *  `import <mod> as __k_<mod>` single lines. Match them to dedupe by exact text. */
const GROUND_PRELUDE_IMPORT_RE = /^import \S+ as __k_\S+$/;

function matchesBlockAt(lines: readonly string[], start: number, block: readonly string[]): boolean {
  if (start + block.length > lines.length) return false;
  for (let i = 0; i < block.length; i++) {
    if (lines[start + i] !== block[i]) return false;
  }
  return true;
}

/**
 * De-duplicate ground-expression helper/import prelude blocks across the
 * statements assembled into a single emitted Python module.
 *
 * Ground generators inline their prelude per-statement (so a standalone
 * generator call still emits the helper it needs, ahead of its use). When the
 * module assembler concatenates several such statements, identical helper
 * blocks and `import … as __k_…` lines repeat. This pass keeps the FIRST
 * occurrence of each unique block/import — preserving first-need order so the
 * helper still precedes its first use — and removes every later repeat, leaving
 * all non-prelude statement lines untouched.
 */
export function dedupeGroundPrelude(lines: readonly string[]): string[] {
  const seenBlocks = new Set<string>();
  const seenImports = new Set<string>();
  const out: string[] = [];

  for (let i = 0; i < lines.length; ) {
    const matchedBlock = GROUND_PRELUDE_HELPER_BLOCKS.find((block) => matchesBlockAt(lines, i, block));
    if (matchedBlock) {
      const key = matchedBlock.join('\n');
      if (seenBlocks.has(key)) {
        i += matchedBlock.length;
        continue;
      }
      seenBlocks.add(key);
      for (let j = 0; j < matchedBlock.length; j++) out.push(lines[i + j]);
      i += matchedBlock.length;
      continue;
    }

    const line = lines[i];
    if (GROUND_PRELUDE_IMPORT_RE.test(line)) {
      if (seenImports.has(line)) {
        i += 1;
        continue;
      }
      seenImports.add(line);
    }
    out.push(line);
    i += 1;
  }

  return out;
}

/**
 * Common preamble extracted from all ground layer generators.
 * Returns { annotations, todo, props, name } ready for use.
 */
function groundPreamble(node: IRNode) {
  const annotations = emitPyReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitPyLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = toSnakeCase(props.name as string);
  return { annotations, todo, props, name };
}

function unwrapExpr(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && (value as ExprObject).__expr) return (value as ExprObject).code;
  return String(value);
}

function emitJsObjectKeyCoercion(keyName: string): string[] {
  return [
    `    if ${keyName} is None:`,
    `        ${keyName} = "null"`,
    `    elif isinstance(${keyName}, bool):`,
    `        ${keyName} = "true" if ${keyName} else "false"`,
    `    elif isinstance(${keyName}, float):`,
    `        if ${keyName} != ${keyName}:`,
    `            ${keyName} = "NaN"`,
    `        elif ${keyName} == float("inf"):`,
    `            ${keyName} = "Infinity"`,
    `        elif ${keyName} == float("-inf"):`,
    `            ${keyName} = "-Infinity"`,
    `        elif ${keyName}.is_integer():`,
    `            ${keyName} = str(int(${keyName}))`,
    `        else:`,
    `            ${keyName} = str(${keyName})`,
    `    elif not isinstance(${keyName}, (str, int)):`,
    `        raise TypeError("keyed reshape selector must produce a scalar key")`,
    `    else:`,
    `        ${keyName} = str(${keyName})`,
  ];
}

function splitExpressionList(raw: string, propName: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote !== null) {
      current += ch;
      if (ch === '\\' && i + 1 < raw.length) current += raw[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (depth < 0) throw new Error(`${propName} has unbalanced delimiters.`);
    if (ch === ',' && depth === 0) {
      const part = current.trim();
      if (part.length === 0) throw new Error(`${propName} contains an empty expression.`);
      out.push(part);
      current = '';
      continue;
    }
    current += ch;
  }
  if (quote !== null || depth !== 0) throw new Error(`${propName} has unbalanced delimiters.`);
  const tail = current.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

// ── derive ──────────────────────────────────────────────────────────────

export function generateDerive(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  const expr = props.expr as string;
  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';
  return [...todo, ...annotations, `${name}${typeAnnotation} = ${expr}`];
}

// ── clamp ───────────────────────────────────────────────────────────────

export function generateClamp(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  const value = unwrapExpr(props.value);
  const min = unwrapExpr(props.min);
  const max = unwrapExpr(props.max);
  if (value === undefined || value === '') throw new Error("clamp node requires a 'value' prop");
  if (min === undefined || min === '') throw new Error("clamp node requires a 'min' prop");
  if (max === undefined || max === '') throw new Error("clamp node requires a 'max' prop");

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';
  return [...todo, ...annotations, `${name}${typeAnnotation} = max(${min}, min(${max}, ${value}))`];
}

// ── firstTruthy ────────────────────────────────────────────────────────

export function generateFirstTruthy(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  const rawValues = unwrapExpr(props.values);
  if (rawValues === undefined || rawValues === '') throw new Error("firstTruthy node requires a 'values' prop");
  const values = splitExpressionList(rawValues, 'firstTruthy values=');
  if (values.length < 2) throw new Error('firstTruthy requires at least two value expressions');

  const emitted = values.map((value) => {
    const valueIR = parseExpr(value);
    if (valueIR.kind === 'propagate') {
      throw new Error("Propagation '?' is not allowed in `firstTruthy values=` — bind the value first.");
    }
    return emitFirstTruthyOperandPy(valueIR);
  });

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';
  // Slice S4 — select the first KERN-truthy candidate (so `[]`/`{}` win and NaN
  // is skipped), not the first Python-truthy one. Same `_kern_truthy`-gated,
  // single-evaluation, lazy walrus chain as the native-body lowering. The ground
  // layer has no per-statement helper channel, so `_kern_truthy`/`js_truthy` is
  // surfaced through the emitted results' helpers set (prepended by the prelude).
  const withHelper = emitted.map((result) => ({
    ...result,
    helpers: new Set([...result.helpers, KERN_JS_HELPER_PY]),
  }));
  const chain = buildGroundFirstTruthyChain(
    withHelper.map((result) => result.code),
    name,
  );
  return [...todo, ...annotations, ...groundExpressionPrelude(withHelper), `${name}${typeAnnotation} = ${chain}`];
}

/** Module-level (ground) twin of the native-body `firstTruthy` walrus chain.
 *  No `ctx.gensymCounter` here, so temp names are seeded from the binding name
 *  plus a positional index — stable per statement and disjoint across siblings
 *  (each `firstTruthy` binds a distinct `name`). */
function buildGroundFirstTruthyChain(candidates: string[], bindingName: string): string {
  const last = candidates[candidates.length - 1];
  let chain = last;
  for (let i = candidates.length - 2; i >= 0; i--) {
    const tmp = `__k_ft_${bindingName}_${i}`;
    chain = `(${tmp} if _kern_truthy(${tmp} := ${candidates[i]}) else ${chain})`;
  }
  return chain;
}

function emitFirstTruthyOperandPy(valueIR: ValueIR): PyExpressionEmitResult {
  const emitted = emitGroundExpression(valueIR);
  return valueIR.kind === 'conditional' ? withGroundExpressionCode(emitted, `(${emitted.code})`) : emitted;
}

function buildNullishCoalesceIR(values: ValueIR[]): ValueIR {
  if (values.length === 1) return values[0];
  const [left, ...rest] = values;
  return { kind: 'binary', op: '??', left, right: buildNullishCoalesceIR(rest) };
}

export function generateCoalesce(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  const rawValues = unwrapExpr(props.values);
  if (rawValues === undefined || rawValues === '') throw new Error("coalesce node requires a 'values' prop");
  const values = splitExpressionList(rawValues, 'coalesce values=');
  if (values.length < 2) throw new Error('coalesce requires at least two value expressions');

  const valueIRs = values.map((value) => {
    const valueIR = parseExpr(value);
    if (valueIR.kind === 'propagate') {
      throw new Error("Propagation '?' is not allowed in `coalesce values=` — bind the value first.");
    }
    return valueIR;
  });

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';
  const chain = emitGroundExpression(buildNullishCoalesceIR(valueIRs));
  return [...todo, ...annotations, ...groundExpressionPrelude([chain]), `${name}${typeAnnotation} = ${chain.code}`];
}

export function generateFirstDefined(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  const rawValues = unwrapExpr(props.values);
  if (rawValues === undefined || rawValues === '') throw new Error("firstDefined node requires a 'values' prop");
  const values = splitExpressionList(rawValues, 'firstDefined values=');
  if (values.length < 2) throw new Error('firstDefined requires at least two value expressions');

  const valueIRs = values.map((value) => {
    const valueIR = parseExpr(value);
    if (valueIR.kind === 'propagate') {
      throw new Error("Propagation '?' is not allowed in `firstDefined values=` — bind the value first.");
    }
    return valueIR;
  });

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';
  const chain = emitGroundExpression(buildNullishCoalesceIR(valueIRs));
  return [...todo, ...annotations, ...groundExpressionPrelude([chain]), `${name}${typeAnnotation} = ${chain.code}`];
}

// ── objectMerge ─────────────────────────────────────────────────────────

export function generateObjectMerge(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  const rawSources = unwrapExpr(props.sources);
  if (rawSources === undefined || rawSources === '') throw new Error("objectMerge node requires a 'sources' prop");
  const sources = splitExpressionList(rawSources, 'objectMerge sources=');
  if (sources.length < 2) throw new Error('objectMerge requires at least two source expressions');
  const emitted: PyExpressionEmitResult[] = [];
  for (const source of sources) {
    if (source.startsWith('...'))
      throw new Error('objectMerge sources imply spreading; omit leading `...` in sources=');
    const sourceIR = parseExpr(source);
    if (sourceIR.kind === 'propagate') {
      throw new Error("Propagation '?' is not allowed in `objectMerge sources=` — bind the value first.");
    }
    const sourceExpr = emitGroundExpression(sourceIR);
    emitted.push(withGroundExpressionCode(sourceExpr, `**(${sourceExpr.code})`));
  }

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';
  return [
    ...todo,
    ...annotations,
    ...groundExpressionPrelude(emitted),
    `${name}${typeAnnotation} = {${emitted.map((result) => result.code).join(', ')}}`,
  ];
}

export function generateObjectPick(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  if (props.in === undefined) {
    throw new Error("objectPick node requires an 'in' prop");
  }
  const rawIn = unwrapExpr(props.in);
  if (rawIn === undefined || rawIn === '') throw new Error("objectPick node requires an 'in' prop");
  const rawKeys = unwrapExpr(props.keys);
  if (rawKeys === undefined || rawKeys === '') throw new Error("objectPick node requires a 'keys' prop");

  const inIR = parseExpr(rawIn);
  if (inIR.kind === 'propagate') {
    throw new Error("Propagation '?' is not allowed in objectPick in=");
  }
  const inExpr = emitGroundExpression(inIR);

  const keysList = parseKeys(rawKeys, node, 'objectPick keys=');
  const formattedKeys = emitStringKeyArray(keysList);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';

  return [
    ...todo,
    ...annotations,
    ...groundExpressionPrelude([inExpr]),
    `${name}${typeAnnotation} = (lambda __kern_source: {key: (__kern_source[key] if key in __kern_source else None) for key in ${formattedKeys}})(${inExpr.code})`,
  ];
}

export function generateObjectOmit(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  if (props.in === undefined) {
    throw new Error("objectOmit node requires an 'in' prop");
  }
  const rawIn = unwrapExpr(props.in);
  if (rawIn === undefined || rawIn === '') throw new Error("objectOmit node requires an 'in' prop");
  const rawKeys = unwrapExpr(props.keys);
  if (rawKeys === undefined || rawKeys === '') throw new Error("objectOmit node requires a 'keys' prop");

  const inIR = parseExpr(rawIn);
  if (inIR.kind === 'propagate') {
    throw new Error("Propagation '?' is not allowed in objectOmit in=");
  }
  const inExpr = emitGroundExpression(inIR);

  const keysList = parseKeys(rawKeys, node, 'objectOmit keys=');
  const formattedKeys = emitStringKeyArray(keysList);

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';

  return [
    ...todo,
    ...annotations,
    ...groundExpressionPrelude([inExpr]),
    `${name}${typeAnnotation} = {key: value for key, value in ${inExpr.code}.items() if key not in ${formattedKeys}}`,
  ];
}

// ── transform ───────────────────────────────────────────────────────────

export function generateTransform(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  const target = props.target as string | undefined;
  const via = props.via as string | undefined;
  const constType = props.type as string | undefined;
  const code = handlerCode(node);
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';

  if (code) {
    const lines: string[] = [...todo, ...annotations];
    lines.push(`def ${name}(state)${typeAnnotation}:`);
    for (const line of code.split('\n')) {
      lines.push(`    ${line}`);
    }
    return lines;
  }

  if (target && via) {
    return [
      ...todo,
      ...annotations,
      `${name}${typeAnnotation} = ${via.replace(/\(/, `(${target}, `).replace(/, \)/, ')')}`,
    ];
  }
  if (via) {
    return [...todo, ...annotations, `${name}${typeAnnotation} = ${via}`];
  }
  return [...todo, ...annotations, `${name}${typeAnnotation} = None`];
}

// ── action ──────────────────────────────────────────────────────────────

export function generateAction(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  const idempotent = props.idempotent === 'true' || props.idempotent === true;
  const reversible = props.reversible === 'true' || props.reversible === true;
  const returns = props.returns as string | undefined;
  const code = handlerCode(node);

  // Slice 3c P2 follow-up: target-neutral helper reads structured `param`
  // children when present, falls back to legacy `params="..."` otherwise.
  const paramList = buildPythonParamList(node);

  const retClause = returns ? ` -> ${mapTsTypeToPython(returns)}` : ' -> None';
  const lines: string[] = [...todo, ...annotations];

  lines.push(`async def ${name}(${paramList})${retClause}:`);

  // Docstring with metadata
  const metaParts: string[] = [];
  if (idempotent) metaParts.push('idempotent=True');
  if (reversible) metaParts.push('reversible=True');
  if (metaParts.length > 0) {
    lines.push(`    """@action ${metaParts.join(' ')}"""`);
  }

  if (code) {
    for (const line of code.split('\n')) {
      lines.push(`    ${line}`);
    }
  } else {
    lines.push('    pass');
  }
  return lines;
}

// ── guard ───────────────────────────────────────────────────────────────

export function generateGuard(node: IRNode): string[] {
  const annotations = emitPyReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitPyLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = (props.name as string) || 'guard';
  const expr = props.expr as string;
  const elseCode = props.else as string | undefined;

  if (elseCode && /^\d+$/.test(elseCode)) {
    return [
      ...todo,
      ...annotations,
      `if not (${expr}):\n    raise HTTPException(status_code=${elseCode}, detail="Guard: ${name}")`,
    ];
  } else if (elseCode) {
    return [...todo, ...annotations, `if not (${expr}):\n    ${elseCode}`];
  }
  return [...todo, ...annotations, `if not (${expr}):\n    raise ValueError("Guard failed: ${name}")`];
}

// ── assume ──────────────────────────────────────────────────────────────

export function generateAssume(node: IRNode): string[] {
  const annotations = emitPyReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitPyLowConfidenceTodo(node, conf);
  const props = p(node);
  const expr = props.expr as string;
  const name = (props.name as string) || 'assumption';
  return [...todo, ...annotations, `assert ${expr}, "Assume failed: ${name}"`];
}

// ── invariant ───────────────────────────────────────────────────────────

export function generateInvariant(node: IRNode): string[] {
  const annotations = emitPyReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitPyLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = (props.name as string) || 'invariant';
  const expr = props.expr as string;
  return [...todo, ...annotations, `assert ${expr}, "Invariant: ${name}"`];
}

// ── each ────────────────────────────────────────────────────────────────
// Note: generateEach calls generatePythonCoreNode recursively.
// We accept the dispatcher as a parameter to avoid circular imports.

export type CoreNodeDispatcher = (node: IRNode) => string[];

let _dispatcher: CoreNodeDispatcher = () => [];

/** Set the dispatcher function to break the circular dependency. */
export function setDispatcher(fn: CoreNodeDispatcher): void {
  _dispatcher = fn;
}

export function generateEach(node: IRNode): string[] {
  const annotations = emitPyReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitPyLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = (props.name as string) || 'item';
  const collection = props.in as string;
  const index = props.index as string | undefined;
  const isAwait = props.await === true || props.await === 'true';

  const lines: string[] = [...todo, ...annotations];
  if (index) {
    if (isAwait) {
      throw new Error('each await=true cannot be combined with index=');
    }
    lines.push(`for ${index}, ${name} in enumerate(${collection}):`);
  } else {
    lines.push(`${isAwait ? 'async ' : ''}for ${name} in ${collection}:`);
  }

  const children = kids(node);
  if (children.length === 0) {
    lines.push('    pass');
  } else {
    for (const child of children) {
      const childLines = _dispatcher(child);
      for (const line of childLines) {
        lines.push(`    ${line}`);
      }
    }
  }
  return lines;
}

// ── collect ─────────────────────────────────────────────────────────────

export function generateCollect(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  const from = props.from as string;
  const where = props.where as string | undefined;
  const limit = props.limit as string | undefined;
  const order = props.order as string | undefined;

  const lines: string[] = [...todo, ...annotations];
  let expr = where ? `[item for item in ${from} if ${where}]` : `list(${from})`;
  if (order) {
    lines.push('from functools import cmp_to_key');
    expr = `sorted(${expr}, key=cmp_to_key(lambda a, b: ${order}))`;
  }
  if (limit) {
    expr = `${expr}[:${limit}]`;
  }
  lines.push(`${name} = ${expr}`);
  return lines;
}

// ── count ───────────────────────────────────────────────────────────────

export function generateCount(node: IRNode): string[] {
  const { annotations, todo, props, name } = groundPreamble(node);
  const items = unwrapExpr(props.in);
  if (items === undefined || items === '') throw new Error("count node requires an 'in' prop");
  const where = unwrapExpr(props.where);
  const item = (props.item as string) || 'item';
  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';

  const rhs = where ? `sum(1 for ${item} in ${items} if ${where})` : `len(${items})`;

  return [...todo, ...annotations, `${name}${typeAnnotation} = ${rhs}`];
}

// ── branch / path ───────────────────────────────────────────────────────

export function generateBranch(node: IRNode): string[] {
  const annotations = emitPyReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitPyLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = (props.name as string) || 'branch';
  const on = props.on as string;
  const paths = kids(node, 'path');

  const lines: string[] = [...todo, ...annotations];
  lines.push(`# branch: ${name}`);
  lines.push(`match ${on}:`);

  for (const pathNode of paths) {
    const pp = p(pathNode);
    const value = pp.value as string;
    lines.push(`    case "${value}":`);
    const children = kids(pathNode);
    if (children.length === 0) {
      lines.push('        pass');
    } else {
      for (const child of children) {
        const childLines = _dispatcher(child);
        for (const line of childLines) {
          lines.push(`        ${line}`);
        }
      }
    }
  }
  return lines;
}

// ── resolve ─────────────────────────────────────────────────────────────

export function generateResolve(node: IRNode): string[] {
  const { annotations, todo, name } = groundPreamble(node);
  const candidates = kids(node, 'candidate');
  const discriminator = firstChild(node, 'discriminator');

  if (!discriminator) return [`# resolve: ${name} — missing discriminator`];

  const dp = p(discriminator);
  const method = (dp.method as string) || 'select';
  const metric = (dp.metric as string) || '';

  const lines: string[] = [...todo, ...annotations];
  lines.push(`# resolve: ${name}`);
  lines.push(`_${name}_candidates = [`);
  for (const c of candidates) {
    const cp = p(c);
    const cname = cp.name as string;
    const code = handlerCode(c);
    lines.push(`    {"name": "${cname}", "fn": lambda signal: ${code.trim() || 'None'}},`);
  }
  lines.push(`]`);
  lines.push('');

  const discCode = handlerCode(discriminator);
  lines.push(`async def resolve_${name}(signal):`);
  lines.push(`    candidates = _${name}_candidates`);
  lines.push(`    # discriminator: ${method}(${metric})`);
  if (discCode) {
    for (const line of discCode.split('\n')) {
      lines.push(`    ${line}`);
    }
  }
  lines.push(`    return candidates[winner_idx]["fn"](signal)`);
  return lines;
}

// ── expect ──────────────────────────────────────────────────────────────

export function generateExpect(node: IRNode): string[] {
  const annotations = emitPyReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitPyLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = toSnakeCase((props.name as string) || 'expected');
  const expr = props.expr as string;
  const within = props.within as string | undefined;
  const max = props.max as string | undefined;
  const min = props.min as string | undefined;

  if (within) {
    const [lo, hi] = within.split('..');
    return [
      ...todo,
      ...annotations,
      `assert ${lo} <= (${expr}) <= ${hi}, f"Expected ${name} in [${lo}, ${hi}], got {${expr}}"`,
    ];
  }
  if (min && max) {
    return [
      ...todo,
      ...annotations,
      `assert ${min} <= (${expr}) <= ${max}, f"Expected ${name} in [${min}, ${max}], got {${expr}}"`,
    ];
  }
  if (max) {
    return [...todo, ...annotations, `assert (${expr}) <= ${max}, f"Expected ${name} <= ${max}, got {${expr}}"`];
  }
  if (min) {
    return [...todo, ...annotations, `assert (${expr}) >= ${min}, f"Expected ${name} >= ${min}, got {${expr}}"`];
  }
  return [...todo, ...annotations, `assert (${expr}) is not None, "Expected ${name} to be defined"`];
}

// ── recover ─────────────────────────────────────────────────────────────

export function generateRecover(node: IRNode): string[] {
  const { annotations, todo, name } = groundPreamble(node);
  const strategies = kids(node, 'strategy');

  const lines: string[] = [...todo, ...annotations];
  lines.push(`# recover: ${name}`);
  lines.push(`async def ${name}_with_recovery(fn):`);

  for (const strategy of strategies) {
    const sp = p(strategy);
    const sname = sp.name as string;
    const code = handlerCode(strategy);

    if (sname === 'retry') {
      const max = Number(sp.max) || 3;
      const delay = Number(sp.delay) || 1000;
      lines.push(`    # strategy: retry (max=${max}, delay=${delay}ms)`);
      lines.push(`    import asyncio`);
      lines.push(`    for _attempt in range(${max}):`);
      lines.push(`        try:`);
      lines.push(`            return await fn()`);
      lines.push(`        except Exception:`);
      lines.push(`            if _attempt < ${max - 1}:`);
      lines.push(`                await asyncio.sleep(${delay / 1000})`);
    } else if (sname === 'fallback') {
      lines.push(`    # strategy: fallback (terminal)`);
      if (code) {
        for (const line of code.split('\n')) {
          lines.push(`    ${line}`);
        }
      } else {
        lines.push(`    raise RuntimeError("All recovery strategies exhausted for ${name}")`);
      }
    } else {
      lines.push(`    # strategy: ${sname}`);
      lines.push(`    try:`);
      if (code) {
        for (const line of code.split('\n')) {
          lines.push(`        ${line}`);
        }
      } else {
        lines.push(`        pass`);
      }
      lines.push(`    except Exception:`);
      lines.push(`        pass`);
    }
  }
  return lines;
}

// ── Ground Layer: uniqueBy ───────────────────────────────────────────────

export function generateUniqueBy(node: IRNode): string[] {
  const { annotations, todo, props } = groundPreamble(node);
  const name = toPythonBindingName(String(props.name || ''), 'uniqueBy');
  const item = (props.item as string) || 'item';
  const collection = unwrapExpr(props.in);
  if (!collection) throw new Error("uniqueBy node requires an 'in' prop");
  const by = unwrapExpr(props.by);
  if (!by) throw new Error("uniqueBy node requires a 'by' prop");
  const seenName = `__kern_seen_${name}`;
  const seenObjectsName = `__kern_seen_objects_${name}`;
  const keyName = `__kern_key_${name}`;
  const seenKeyName = `__kern_seen_key_${name}`;
  const seenObjectName = `__kern_seen_object_${name}`;

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';

  return [
    ...todo,
    ...annotations,
    `${name}${typeAnnotation} = []`,
    `${seenName} = set()`,
    `${seenObjectsName} = []`,
    `for ${item} in ${collection}:`,
    `    ${keyName} = ${by}`,
    `    if ${keyName} is None:`,
    `        ${seenKeyName} = ("null", None)`,
    `    elif isinstance(${keyName}, bool):`,
    `        ${seenKeyName} = ("boolean", ${keyName})`,
    `    elif isinstance(${keyName}, float) and ${keyName} != ${keyName}:`,
    `        ${seenKeyName} = ("number", "NaN")`,
    `    elif isinstance(${keyName}, (int, float)):`,
    `        ${seenKeyName} = ("number", ${keyName})`,
    `    elif isinstance(${keyName}, str):`,
    `        ${seenKeyName} = ("string", ${keyName})`,
    `    else:`,
    `        for ${seenObjectName} in ${seenObjectsName}:`,
    `            if ${keyName} is ${seenObjectName}:`,
    `                break`,
    `        else:`,
    `            ${seenObjectsName}.append(${keyName})`,
    `            ${name}.append(${item})`,
    `        continue`,
    `    if ${seenKeyName} not in ${seenName}:`,
    `        ${seenName}.add(${seenKeyName})`,
    `        ${name}.append(${item})`,
  ];
}

// ── Ground Layer: groupBy ────────────────────────────────────────────────

export function generateGroupBy(node: IRNode): string[] {
  const { annotations, todo, props } = groundPreamble(node);
  const name = toPythonBindingName(String(props.name || ''), 'groupBy');
  const item = (props.item as string) || 'item';
  const collection = unwrapExpr(props.in);
  if (!collection) throw new Error("groupBy node requires an 'in' prop");
  const by = unwrapExpr(props.by);
  if (!by) throw new Error("groupBy node requires a 'by' prop");
  const keyName = `__kern_key_${name}`;

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';

  return [
    ...todo,
    ...annotations,
    `${name}${typeAnnotation} = {}`,
    `for ${item} in ${collection}:`,
    `    ${keyName} = ${by}`,
    ...emitJsObjectKeyCoercion(keyName),
    `    ${name}.setdefault(${keyName}, []).append(${item})`,
  ];
}

// ── Ground Layer: partition ──────────────────────────────────────────────

export function generatePartition(node: IRNode): string[] {
  const annotations = emitPyReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitPyLowConfidenceTodo(node, conf);
  const props = p(node);
  const passRaw = props.pass as string | undefined;
  if (!passRaw) throw new Error("partition node requires a 'pass' prop");
  const failRaw = props.fail as string | undefined;
  if (!failRaw) throw new Error("partition node requires a 'fail' prop");
  const passName = toPythonBindingName(passRaw, 'partition');
  const failName = toPythonBindingName(failRaw, 'partition');
  const item = (props.item as string) || 'item';

  const collection = unwrapExpr(props.in);
  if (!collection) throw new Error("partition node requires an 'in' prop");
  const predicate = unwrapExpr(props.where);
  if (!predicate) throw new Error("partition node requires a 'where' prop");
  const elemType = props.type ? mapTsTypeToPython(props.type as string) : undefined;
  const typeAnnotation = elemType ? `: list[${elemType}]` : '';

  return [
    ...todo,
    ...annotations,
    `${passName}${typeAnnotation} = []`,
    `${failName}${typeAnnotation} = []`,
    `for ${item} in ${collection}:`,
    `    if ${predicate}:`,
    `        ${passName}.append(${item})`,
    `    else:`,
    `        ${failName}.append(${item})`,
  ];
}

// ── Ground Layer: indexBy ────────────────────────────────────────────────

export function generateIndexBy(node: IRNode): string[] {
  const { annotations, todo, props } = groundPreamble(node);
  const name = toPythonBindingName(String(props.name || ''), 'indexBy');
  const item = (props.item as string) || 'item';
  const collection = unwrapExpr(props.in);
  if (!collection) throw new Error("indexBy node requires an 'in' prop");
  const by = unwrapExpr(props.by);
  if (!by) throw new Error("indexBy node requires a 'by' prop");
  const keyName = `__kern_key_${name}`;

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';

  return [
    ...todo,
    ...annotations,
    `${name}${typeAnnotation} = {}`,
    `for ${item} in ${collection}:`,
    `    ${keyName} = ${by}`,
    ...emitJsObjectKeyCoercion(keyName),
    `    ${name}[${keyName}] = ${item}`,
  ];
}

// ── Ground Layer: countBy ────────────────────────────────────────────────

export function generateCountBy(node: IRNode): string[] {
  const { annotations, todo, props } = groundPreamble(node);
  const name = toPythonBindingName(String(props.name || ''), 'countBy');
  const item = (props.item as string) || 'item';
  const collection = unwrapExpr(props.in);
  if (!collection) throw new Error("countBy node requires an 'in' prop");
  const by = unwrapExpr(props.by);
  if (!by) throw new Error("countBy node requires a 'by' prop");
  const keyName = `__kern_key_${name}`;

  const constType = props.type as string | undefined;
  const typeAnnotation = constType ? `: ${mapTsTypeToPython(constType)}` : '';

  return [
    ...todo,
    ...annotations,
    `${name}${typeAnnotation} = {}`,
    `for ${item} in ${collection}:`,
    `    ${keyName} = ${by}`,
    ...emitJsObjectKeyCoercion(keyName),
    `    ${name}[${keyName}] = ${name}.get(${keyName}, 0) + 1`,
  ];
}
