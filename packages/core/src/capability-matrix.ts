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

const TS_CORE_CAPABILITIES: CapabilityEntry[] = [
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
  // Slice 2e — function overloads via `overload` child node. Each overload
  // emits a `function name(params): R;` line before the implementation.
  { feature: 'function-overloads', position: 'top-level', support: 'native' },
  // Slice 2f — generics: `generics="<T>"` / `<T extends Base>` / `<T = Default>` /
  // `<K, V>` on type, interface, fn, class. Routed through emitTypeAnnotation
  // (whitespace + bracket-balance).
  { feature: 'generics', position: 'top-level', support: 'native' },
  // Slice 2g — cross-`.kern` symbol resolution via `use path="..."` parent
  // with `from name=X as=Y export=true` children. `.kern` paths translate to
  // `.js` in the emitted TS import; `export=true` produces an additional
  // `export { ... } from '...'` re-export line.
  { feature: 'cross-kern-import', position: 'top-level', support: 'native' },
  // Slice 3a — `let.value` extends iteration-scoped bindings to use the
  // ValueIR-canonicalised native expression form (mirrors `const.value`
  // from slice 1j). `expr=` remains as the rawExpr passthrough fallback.
  { feature: 'let-native-value', position: 'top-level', support: 'native' },
  // Slice 3b — `field.value` extends class/service/config field initializers
  // to the ValueIR-canonicalised native form (mirrors slice 1j/3a). `default=`
  // remains as the rawExpr passthrough fallback for back-compat with seeds
  // that author bare-string defaults like `default=plan` for string-typed
  // fields, where the legacy type-aware coercion still applies.
  { feature: 'field-native-value', position: 'top-level', support: 'native' },
  // Slice 3c — `param.value` extends fn/method/constructor parameter defaults
  // to the ValueIR-canonicalised native form via structured `param` child
  // nodes. Mirrors slice 1j/3a/3b. Legacy `params="..."` string with embedded
  // defaults remains supported for back-compat. Importer + migrate-class-body
  // emit `param` children all-or-nothing per signature, gated to skip
  // signatures with optional/variadic/destructured params (those stay legacy).
  { feature: 'param-native-value', position: 'top-level', support: 'native' },
  // Slice 3d — `destructure` adds a native node for TS-style destructured
  // const/let bindings: `const {a, b: rename} = obj` (object pattern with
  // `binding` children) and `const [x, y] = arr` (array pattern with
  // `element` children). For complex patterns (rest `...`, defaults `=v`,
  // nested `{a:{b}}`), the importer falls back to `expr={{...}}` carrying
  // the raw TS statement verbatim. Codegen, importer, and decompiler all
  // round-trip simple patterns; complex patterns survive but stay opaque.
  { feature: 'destructure-native', position: 'top-level', support: 'native' },
  // Slice 3e — `mapLit`/`setLit` add native top-level nodes for Map/Set
  // declarations: `mapLit name=cache type="Map<string,number>"` with
  // `mapEntry key=k value=v` children emits `new Map([[k, v]])`; same for
  // `setLit`/`setItem`. Complex shapes (computed keys, spread, conditional
  // entries) fall through to legacy `const` with handler block. Inline
  // Map/Set literals inside expression-typed props still use the
  // `value={{ new Map([...]) }}` escape hatch — slice 3e is statement-level
  // sugar only, not a parser-grammar extension.
  { feature: 'maplit-setlit-native', position: 'top-level', support: 'native' },
];

const PY_CORE_CAPABILITIES: CapabilityEntry[] = [
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
  // Slice 2e — Python has `@typing.overload` decorators, but the FastAPI
  // generator does not yet emit @overload-decorated stubs from `overload`
  // children.
  {
    feature: 'function-overloads',
    position: 'top-level',
    support: 'unsupported',
    note: 'FastAPI codegen does not yet emit @typing.overload stubs',
  },
  // Slice 2f — Python has TypeVar / Generic[T] for parameterised types but
  // the FastAPI generator does not yet emit `T = TypeVar("T")` / `class X(Generic[T])`.
  {
    feature: 'generics',
    position: 'top-level',
    support: 'unsupported',
    note: 'FastAPI codegen does not yet emit TypeVar / Generic[T] declarations',
  },
  // Slice 2g — Python could in principle map `.kern → .py` via `from <module>
  // import <name> as <alias>`, but the FastAPI generator has no such branch
  // yet. Default to unsupported until the path is wired explicitly.
  {
    feature: 'cross-kern-import',
    position: 'top-level',
    support: 'unsupported',
    note: 'FastAPI codegen does not yet translate `.kern` paths to Python `from x import y` syntax',
  },
  // Slice 3b — Python (FastAPI) field codegen reads `fp.default` directly
  // and has no ValueIR pipeline yet, so `field.value` is unsupported until a
  // dedicated Python emitter for canonicalised field initializers lands.
  {
    feature: 'field-native-value',
    position: 'top-level',
    support: 'unsupported',
    note: 'FastAPI codegen has not been wired to ValueIR for field initializers; `value=` would emit raw',
  },
  // Slice 3c P2 follow-up (shipped) — FastAPI's 4 ad-hoc param parsers were
  // consolidated behind `buildPythonParamList` in packages/fastapi/src/codegen-helpers.ts,
  // which reads structured `param` children first (slice 3c+ canonical form)
  // and falls back to legacy `params="..."` for back-compat. Optional `?`
  // emits `Optional[T] = None`, variadic `...` emits `*args: T`, destructured
  // `{a,b}` patterns are skipped (Python has no equivalent — caller unpacks
  // in body).
  {
    feature: 'param-native-value',
    position: 'top-level',
    support: 'native',
    note: 'FastAPI codegen wired through `buildPythonParamList` (slice 3c P2 follow-up); reads structured param children with value=/default=/optional=/variadic=',
  },
  // Slice 3d — Python has no native syntactic equivalent of TS object/array
  // destructuring on `const`/`let`. FastAPI codegen would have to lower
  // `destructure` to a sequence of bindings (`a = obj.a; b = obj.b`) which
  // is a separate work item. Marked unsupported per slice 3b/3c precedent.
  {
    feature: 'destructure-native',
    position: 'top-level',
    support: 'unsupported',
    note: 'FastAPI codegen has not been wired to lower `destructure` nodes; would need per-binding assignment lowering',
  },
  // Slice 3e — Python's `dict`/`set` literals are syntactically different
  // from TS `Map`/`Set` and FastAPI codegen has not been wired to lower
  // `mapLit`/`setLit` to either form. Marked unsupported per slice 3b/3c/3d
  // precedent until a dedicated Python emitter exists.
  {
    feature: 'maplit-setlit-native',
    position: 'top-level',
    support: 'unsupported',
    note: 'FastAPI codegen has not been wired to lower `mapLit`/`setLit` to Python `dict`/`set` literals',
  },
];

export const CAPABILITY_MATRIX: CapabilityMatrix = {
  auto: TS_CORE_CAPABILITIES,
  lib: TS_CORE_CAPABILITIES,
  nextjs: TS_CORE_CAPABILITIES,
  tailwind: TS_CORE_CAPABILITIES,
  web: TS_CORE_CAPABILITIES,
  native: TS_CORE_CAPABILITIES,
  express: TS_CORE_CAPABILITIES,
  cli: TS_CORE_CAPABILITIES,
  terminal: TS_CORE_CAPABILITIES,
  ink: TS_CORE_CAPABILITIES,
  vue: TS_CORE_CAPABILITIES,
  nuxt: TS_CORE_CAPABILITIES,
  fastapi: PY_CORE_CAPABILITIES,
  mcp: TS_CORE_CAPABILITIES,
};

export function capabilitySupport(target: KernTarget, feature: string, position: FeaturePosition): Support {
  const entries = CAPABILITY_MATRIX[target] ?? [];
  return entries.find((e) => e.feature === feature && e.position === position)?.support ?? 'unsupported';
}
