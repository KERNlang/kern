/** (target × feature × position) capability matrix.
 *  Per-slice codegen declares which features compile in which contexts on which targets.
 *  Populated incrementally as language evolution slices ship. */

import type { KernTarget } from './config.js';

export type FeaturePosition = 'top-level' | 'fn-body' | 'render' | 'template' | 'expression';

export type Support = 'native' | 'lowered' | 'unsupported';

export interface CapabilityEntry {
  feature: string;
  position: FeaturePosition;
  support: Support;
  note?: string;
}

export type CapabilityMatrix = Record<KernTarget, CapabilityEntry[]>;

const TS_NUMERIC_LITERALS: CapabilityEntry[] = [
  { feature: 'literal-float', position: 'expression', support: 'native' },
  { feature: 'literal-numeric-separator', position: 'expression', support: 'native' },
  { feature: 'literal-bigint', position: 'expression', support: 'native' },
  { feature: 'literal-hex', position: 'expression', support: 'native' },
  { feature: 'literal-binary', position: 'expression', support: 'native' },
  { feature: 'literal-octal', position: 'expression', support: 'native' },
  {
    feature: 'literal-string-single-quote',
    position: 'expression',
    support: 'lowered',
    note: 'normalized to double-quote on output',
  },
  { feature: 'optional-chain', position: 'expression', support: 'native' },
  { feature: 'nullish-coalesce', position: 'expression', support: 'native' },
  { feature: 'spread', position: 'expression', support: 'native' },
  { feature: 'template-literal', position: 'expression', support: 'native' },
  // Slice 1j — const.value is emitted via ValueIR expression codegen on TS targets.
  // Quoted strings round-trip through JSON.stringify; bare expressions canonicalize via emitExpression.
  { feature: 'const-value-as-expression', position: 'top-level', support: 'native' },
  // Slice 2a — tuple types via type.alias / field.type / fn.returns / fn.params,
  // including optional, rest, labeled, nested, and empty forms. Routed through
  // emitTypeAnnotation's bracket-balance pass; no new node type required.
  { feature: 'tuple-type', position: 'top-level', support: 'native' },
  // Slice 2b — `enum` node for numeric (values=A|B|C) and string-valued
  // (member name=X value="..." children) enums; `const enum` form supported.
  { feature: 'enum-type', position: 'top-level', support: 'native' },
  // Slice 2c — `indexer` child node on interface, emits `[key: K]: V` index
  // signature with optional `readonly` modifier.
  { feature: 'index-signature', position: 'top-level', support: 'native' },
  // Slice 2d — type guards (predicate return types: `value is T`, `asserts x is T`,
  // `this is T`). Already supported today via fn.returns + emitTypeAnnotation
  // passthrough; formalised with regression tests in slice 2d.
  { feature: 'type-guard', position: 'top-level', support: 'native' },
];

const PY_NUMERIC_LITERALS: CapabilityEntry[] = [
  { feature: 'literal-float', position: 'expression', support: 'native' },
  { feature: 'literal-numeric-separator', position: 'expression', support: 'native' },
  {
    feature: 'literal-bigint',
    position: 'expression',
    support: 'lowered',
    note: 'Python int is arbitrary precision; n suffix dropped',
  },
  { feature: 'literal-hex', position: 'expression', support: 'native' },
  { feature: 'literal-binary', position: 'expression', support: 'native' },
  { feature: 'literal-octal', position: 'expression', support: 'native' },
  { feature: 'literal-string-single-quote', position: 'expression', support: 'native' },
  {
    feature: 'optional-chain',
    position: 'expression',
    support: 'lowered',
    note: 'lowered to (x if x is not None else None).y pattern',
  },
  {
    feature: 'nullish-coalesce',
    position: 'expression',
    support: 'lowered',
    note: 'lowered to x if x is not None else y',
  },
  { feature: 'spread', position: 'expression', support: 'lowered', note: 'lowered to *iter / **mapping' },
  { feature: 'template-literal', position: 'expression', support: 'lowered', note: 'lowered to f-string' },
  // Slice 1j — Python codegen has its own const path (FastAPI generator); ValueIR consumption is deferred.
  {
    feature: 'const-value-as-expression',
    position: 'top-level',
    support: 'unsupported',
    note: 'Python const codegen has not yet been wired to ValueIR; bare values emit raw',
  },
  // Slice 2a — mapTsTypeToPython has no tuple branch yet, so a TS alias like
  // `[string, number]` falls through unchanged and would emit invalid Python.
  // Until lowering lands (`[T, U]` → `tuple[T, U]`), report unsupported so feature
  // gates don't permit broken output.
  {
    feature: 'tuple-type',
    position: 'top-level',
    support: 'unsupported',
    note: 'mapTsTypeToPython has no tuple branch; alias passthrough emits raw TS form',
  },
  // Slice 2b — Python has Enum class via `from enum import Enum`, but the
  // FastAPI generator does not yet emit class-based enums for the `enum` node.
  // Mark unsupported until that path lands; flipping to `lowered` requires a
  // dedicated Python generator (would emit `class Status(str, Enum): ...`).
  {
    feature: 'enum-type',
    position: 'top-level',
    support: 'unsupported',
    note: 'FastAPI codegen does not yet handle the enum node; would produce no output',
  },
  // Slice 2c — Python has dict[K, V] / TypedDict but the FastAPI generator
  // does not yet emit either form from an `indexer` child. Mark unsupported.
  {
    feature: 'index-signature',
    position: 'top-level',
    support: 'unsupported',
    note: 'FastAPI codegen does not yet handle indexer; would produce no output',
  },
  // Slice 2d — Python has `TypeGuard[T]` and `TypeIs[T]` (3.13+) from typing,
  // but mapTsTypeToPython has no `value is T` / `asserts x is T` translation.
  // Passthrough would emit invalid Python.
  {
    feature: 'type-guard',
    position: 'top-level',
    support: 'unsupported',
    note: 'mapTsTypeToPython has no predicate-return-type branch (TypeGuard/TypeIs)',
  },
];

export const CAPABILITY_MATRIX: CapabilityMatrix = {
  auto: TS_NUMERIC_LITERALS,
  lib: TS_NUMERIC_LITERALS,
  nextjs: TS_NUMERIC_LITERALS,
  tailwind: TS_NUMERIC_LITERALS,
  web: TS_NUMERIC_LITERALS,
  native: TS_NUMERIC_LITERALS,
  express: TS_NUMERIC_LITERALS,
  cli: TS_NUMERIC_LITERALS,
  terminal: TS_NUMERIC_LITERALS,
  ink: TS_NUMERIC_LITERALS,
  vue: TS_NUMERIC_LITERALS,
  nuxt: TS_NUMERIC_LITERALS,
  fastapi: PY_NUMERIC_LITERALS,
  mcp: TS_NUMERIC_LITERALS,
};

export function capabilitySupport(target: KernTarget, feature: string, position: FeaturePosition): Support {
  const entries = CAPABILITY_MATRIX[target] ?? [];
  return entries.find((e) => e.feature === feature && e.position === position)?.support ?? 'unsupported';
}
