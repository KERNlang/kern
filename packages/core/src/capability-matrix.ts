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
