/**
 * Typed prop interfaces for known IR node types.
 *
 * Each interface captures the props that generators actually access
 * for a given node type. Unknown/evolved types fall back to Record<string, unknown>.
 *
 * Usage:
 *   const props = propsOf<'fn'>(node);
 *   props.name   // string | undefined (no cast needed)
 *   props.params // string | undefined
 */

import type { ExprObject, IRNode } from './types.js';

// ── Common prop shape (shared by most nodes) ────────────────────────────

interface BaseProps {
  name?: string;
  export?: string | boolean;
  confidence?: string;
}

export interface DocProps extends BaseProps {
  text?: string;
}

// ── Type System ─────────────────────────────────────────────────────────

export interface TypeProps extends BaseProps {
  values?: string;
  alias?: string;
  generics?: string;
}

export interface InterfaceProps extends BaseProps {
  extends?: string;
  generics?: string;
}

export interface UnionProps extends BaseProps {
  discriminant?: string;
  /** Slice 4 — `result` | `option` | undefined (default: regular discriminated union). */
  kind?: string;
}

export interface EnumProps extends BaseProps {
  values?: string;
  const?: string | boolean;
}

export interface MemberProps extends BaseProps {
  value?: string | ExprObject;
}

export interface UseProps extends BaseProps {
  // Required at the schema level; optional in the type so propsOf<'use'>()
  // doesn't force every other prop intersection to provide it.
  path?: string;
}

export interface FromProps extends BaseProps {
  as?: string;
}

export interface LetProps extends BaseProps {
  // Slice 3a — `value` is the native ValueIR-canonicalised form; `expr` is
  // the raw passthrough escape hatch. One of the two must be present.
  value?: string | ExprObject;
  expr?: string | ExprObject;
  type?: string;
}

export interface IndexerProps extends BaseProps {
  keyName?: string;
  keyType?: string;
  type?: string;
  readonly?: string | boolean;
}

export interface OverloadProps extends BaseProps {
  params?: string;
  returns?: string;
  generics?: string;
}

export interface ServiceProps extends BaseProps {
  implements?: string;
  generics?: string;
}

export interface ClassProps extends BaseProps {
  extends?: string;
  implements?: string;
  abstract?: string | boolean;
  generics?: string;
}

export interface ConstProps extends BaseProps {
  type?: string;
  value?: string | ExprObject;
}

// Slice 3d — native destructuring
export interface DestructureProps extends BaseProps {
  kind?: 'const' | 'let';
  source?: string | ExprObject;
  type?: string;
  expr?: string | ExprObject;
}

export interface BindingProps extends BaseProps {
  key?: string;
}

export interface DestructureElementProps extends BaseProps {
  index?: string;
}

// Slice 3e — native Map/Set literals
export interface MapLitProps extends BaseProps {
  type?: string;
  kind?: 'const' | 'let';
  expr?: string | ExprObject;
}

export interface MapEntryProps extends BaseProps {
  key?: string | ExprObject;
  value?: string | ExprObject;
}

export interface SetLitProps extends BaseProps {
  type?: string;
  kind?: 'const' | 'let';
  expr?: string | ExprObject;
}

export interface SetItemProps extends BaseProps {
  value?: string | ExprObject;
}

// ── Functions ───────────────────────────────────────────────────────────

export interface FnProps extends BaseProps {
  params?: string;
  returns?: string;
  async?: string | boolean;
  stream?: string | boolean;
  generator?: string | boolean;
  expr?: string | ExprObject;
  generics?: string;
  /** Slice 6 — declares no observable side effects. Only `pure` accepted in v1. */
  effects?: string;
}

export interface MethodProps extends BaseProps {
  params?: string;
  returns?: string;
  async?: string | boolean;
  stream?: string | boolean;
  generator?: string | boolean;
  static?: string | boolean;
  private?: string | boolean;
  generics?: string;
}

export interface ConstructorProps extends BaseProps {
  params?: string;
  generics?: string;
}

export interface ErrorProps extends BaseProps {
  extends?: string;
  message?: string;
}

// ── Machines ────────────────────────────────────────────────────────────

export interface MachineProps extends BaseProps {
  initial?: string | boolean;
}

// ── Data Layer ──────────────────────────────────────────────────────────

export interface ConfigProps extends BaseProps {}

export interface StoreProps extends BaseProps {
  path?: string;
  key?: string;
  model?: string;
}

export interface RepositoryProps extends BaseProps {
  model?: string;
}

export interface CacheProps extends BaseProps {
  backend?: string;
  prefix?: string;
  ttl?: string;
}

export interface DependencyProps extends BaseProps {
  scope?: string;
  factory?: string;
}

export interface ModelProps extends BaseProps {
  table?: string;
  extends?: string;
}

// ── Events ──────────────────────────────────────────────────────────────

export interface EventProps extends BaseProps {
  payload?: string;
}

export interface OnProps extends BaseProps {
  handler?: string;
  key?: string;
}

export interface WebSocketProps extends BaseProps {
  url?: string;
}

// ── Ground Layer ────────────────────────────────────────────────────────

export interface DeriveProps extends BaseProps {
  expr?: string;
  type?: string;
  /** Slice 6 — see FnProps. */
  effects?: string;
}

export interface MemoProps extends BaseProps {
  deps?: string;
  /** Slice 6 — see FnProps. */
  effects?: string;
}

export interface FmtProps extends BaseProps {
  template?: string;
  type?: string;
  return?: string | boolean;
}

export interface SetProps extends BaseProps {
  to?: string | ExprObject;
}

export interface AsyncProps extends BaseProps {}

export interface TryProps extends BaseProps {}

export interface StepProps extends BaseProps {
  await?: string | ExprObject;
  type?: string;
}

export interface CatchProps extends BaseProps {}

export interface LocalProps extends BaseProps {
  expr?: string | ExprObject;
  type?: string;
}

export interface ArrayMethodProps extends BaseProps {
  in?: string | ExprObject;
  item?: string;
  where?: string | ExprObject;
  type?: string;
}

export interface ReduceProps extends BaseProps {
  in?: string | ExprObject;
  acc?: string;
  item?: string;
  initial?: string | ExprObject;
  expr?: string | ExprObject;
  type?: string;
}

export interface FlatMapProps extends BaseProps {
  in?: string | ExprObject;
  item?: string;
  expr?: string | ExprObject;
  type?: string;
}

export interface SliceProps extends BaseProps {
  in?: string | ExprObject;
  start?: string | ExprObject;
  end?: string | ExprObject;
  type?: string;
}

export interface MapProps extends BaseProps {
  in?: string | ExprObject;
  item?: string;
  expr?: string | ExprObject;
  type?: string;
}

export interface SortProps extends BaseProps {
  in?: string | ExprObject;
  a?: string;
  b?: string;
  compare?: string | ExprObject;
  type?: string;
}

export interface ReverseProps extends BaseProps {
  in?: string | ExprObject;
  type?: string;
}

export interface FlatProps extends BaseProps {
  in?: string | ExprObject;
  depth?: string | ExprObject;
  type?: string;
}

export interface AtProps extends BaseProps {
  in?: string | ExprObject;
  index?: string | ExprObject;
  type?: string;
}

export interface JoinProps extends BaseProps {
  in?: string | ExprObject;
  separator?: string | ExprObject;
  type?: string;
}

export interface ValueLookupProps extends BaseProps {
  in?: string | ExprObject;
  value?: string | ExprObject;
  from?: string | ExprObject;
  type?: string;
}

export interface ConcatProps extends BaseProps {
  in?: string | ExprObject;
  with?: string | ExprObject;
  type?: string;
}

export interface ForEachProps extends BaseProps {
  in?: string | ExprObject;
  item?: string;
  index?: string;
}

export interface CompactProps extends BaseProps {
  in?: string | ExprObject;
  type?: string;
}

export interface PluckProps extends BaseProps {
  in?: string | ExprObject;
  item?: string;
  prop?: string | ExprObject;
  type?: string;
}

export interface UniqueProps extends BaseProps {
  in?: string | ExprObject;
  type?: string;
}

// ── PR E array primitives ────────────────────────────────────────────────

export interface UniqueByProps extends BaseProps {
  in?: string | ExprObject;
  item?: string;
  by?: string | ExprObject;
  type?: string;
}

export interface GroupByProps extends BaseProps {
  in?: string | ExprObject;
  item?: string;
  by?: string | ExprObject;
  type?: string;
}

export interface PartitionProps extends BaseProps {
  pass?: string;
  fail?: string;
  in?: string | ExprObject;
  item?: string;
  where?: string | ExprObject;
  type?: string;
}

export interface IndexByProps extends BaseProps {
  in?: string | ExprObject;
  item?: string;
  by?: string | ExprObject;
  type?: string;
}

export interface CountByProps extends BaseProps {
  in?: string | ExprObject;
  item?: string;
  by?: string | ExprObject;
  type?: string;
}

export interface ChunkProps extends BaseProps {
  in?: string | ExprObject;
  size?: string | ExprObject;
  type?: string;
}

export interface ZipProps extends BaseProps {
  in?: string | ExprObject;
  with?: string | ExprObject;
  item?: string;
  index?: string;
  type?: string;
}

export interface RangeProps extends BaseProps {
  start?: string | ExprObject;
  end?: string | ExprObject;
  type?: string;
}

export interface TakeProps extends BaseProps {
  in?: string | ExprObject;
  n?: string | ExprObject;
  type?: string;
}

export interface DropProps extends BaseProps {
  in?: string | ExprObject;
  n?: string | ExprObject;
  type?: string;
}

export interface MinMaxProps extends BaseProps {
  in?: string | ExprObject;
  type?: string;
}

export interface MinMaxByProps extends BaseProps {
  in?: string | ExprObject;
  item?: string;
  by?: string | ExprObject;
  type?: string;
}

export interface SumProps extends BaseProps {
  in?: string | ExprObject;
  type?: string;
}

export interface SumByProps extends BaseProps {
  in?: string | ExprObject;
  item?: string;
  by?: string | ExprObject;
  type?: string;
}

export interface AvgProps extends BaseProps {
  in?: string | ExprObject;
  type?: string;
}

export interface IntersectProps extends BaseProps {
  in?: string | ExprObject;
  with?: string | ExprObject;
  item?: string;
  type?: string;
}

export interface TransformProps extends BaseProps {
  target?: string;
  via?: string;
  type?: string;
}

export interface ActionProps extends BaseProps {
  key?: string;
  params?: string;
  returns?: string;
  async?: string | boolean;
  idempotent?: string | boolean;
  reversible?: string | boolean;
}

export interface ActionRegistryProps extends BaseProps {
  target?: string | ExprObject;
}

export interface GuardProps extends BaseProps {
  when?: string;
  message?: string;
  covers?: string;
}

export interface AssumeProps extends BaseProps {
  expr?: string;
  message?: string;
}

export interface InvariantProps extends BaseProps {
  expr?: string;
  message?: string;
}

export interface EachProps extends BaseProps {
  in?: string;
  index?: string;
}

export interface CollectProps extends BaseProps {
  from?: string;
  where?: string;
  limit?: string;
  order?: string;
}

export interface BranchProps extends BaseProps {
  on?: string;
}

export interface ResolveProps extends BaseProps {}

export interface ExpectProps extends BaseProps {
  expr?: string;
  within?: string;
  max?: string;
  min?: string;
  message?: string;
  preset?: string;
  severity?: string;
  machine?: string;
  reaches?: string;
  via?: string;
  no?: string;
  guard?: string;
  exhaustive?: string | boolean;
  over?: string;
  union?: string;
  covers?: string;
}

export interface RecoverProps extends BaseProps {}

export interface PatternProps extends BaseProps {
  pattern?: string;
}

// ── UI Controls ─────────────────────────────────────────────────────────

export interface ConditionalProps extends BaseProps {
  if?: string | ExprObject;
}

export interface ElseIfProps extends BaseProps {
  expr?: string | ExprObject;
}

export interface ElseProps extends BaseProps {}

export interface SelectProps extends BaseProps {
  value?: string;
  placeholder?: string;
  onChange?: string;
}

// ── Modules / Imports ───────────────────────────────────────────────────

export interface ModuleProps extends BaseProps {}

export interface ImportProps extends BaseProps {
  from?: string;
  names?: string;
  types?: string | boolean;
  default?: string;
}

// ── Children Props (field, variant, etc.) ───────────────────────────────

export interface FieldProps extends BaseProps {
  type?: string;
  optional?: string | boolean;
  // Slice 3b — `value` is the ValueIR-canonicalised native form;
  // `default` is the rawExpr passthrough escape hatch. `value` takes
  // precedence at codegen time when both are present.
  value?: string | ExprObject;
  default?: string | ExprObject;
  private?: string | boolean;
  readonly?: string | boolean;
  static?: string | boolean;
}

export interface GetterProps extends BaseProps {
  returns?: string;
  private?: string | boolean;
  static?: string | boolean;
}

export interface SetterProps extends BaseProps {
  params?: string;
  private?: string | boolean;
  static?: string | boolean;
}

export interface VariantProps extends BaseProps {
  type?: string;
}

/**
 * Slice 3c — `param` child node for fn/method/constructor/etc. parameter
 * defaults via ValueIR. Same shape doubles as MCP tool/resource/prompt param
 * (type widened from identifier → typeAnnotation in slice 3c).
 *
 * `value` is the ValueIR-canonicalised native form (mirrors slice 3b
 * field.value); `default` is the rawExpr passthrough kept for back-compat
 * and existing MCP usage. `value` wins when both present.
 */
export interface ParamProps extends BaseProps {
  type?: string;
  value?: string | ExprObject;
  default?: string | ExprObject;
  required?: string | boolean;
  optional?: string | boolean;
  variadic?: string | boolean;
  description?: string;
  min?: string | number;
  max?: string | number;
}

export interface MethodProps extends BaseProps {
  params?: string;
  returns?: string;
  async?: string | boolean;
  stream?: string | boolean;
  generator?: string | boolean;
  static?: string | boolean;
  private?: string | boolean;
  generics?: string;
}

export interface ConstructorProps extends BaseProps {
  params?: string;
  generics?: string;
}

export interface TransitionProps extends BaseProps {
  from?: string;
  to?: string;
  params?: string;
  guard?: string | ExprObject;
}

export interface StateProps extends BaseProps {
  value?: string;
  initial?: string | boolean;
}

export interface ColumnProps extends BaseProps {
  type?: string;
  primary?: string | boolean;
  unique?: string | boolean;
  nullable?: string | boolean;
  default?: string;
  optional?: string | boolean;
}

export interface RelationProps extends BaseProps {
  type?: string;
  model?: string;
  foreignKey?: string;
  target?: string;
  kind?: string;
}

export interface OptionProps extends BaseProps {
  value?: string;
  label?: string;
}

// ── Test ─────────────────────────────────────────────────────────────────

export interface TestProps extends BaseProps {
  suite?: string;
  target?: string;
}

// ── Props Map ───────────────────────────────────────────────────────────

/** Maps known node types to their typed prop interface. */
export interface NodePropsMap {
  doc: DocProps;
  type: TypeProps;
  interface: InterfaceProps;
  union: UnionProps;
  enum: EnumProps;
  member: MemberProps;
  use: UseProps;
  from: FromProps;
  let: LetProps;
  indexer: IndexerProps;
  overload: OverloadProps;
  service: ServiceProps;
  class: ClassProps;
  const: ConstProps;
  destructure: DestructureProps;
  binding: BindingProps;
  element: DestructureElementProps;
  mapLit: MapLitProps;
  mapEntry: MapEntryProps;
  setLit: SetLitProps;
  setItem: SetItemProps;
  fn: FnProps;
  error: ErrorProps;
  machine: MachineProps;
  config: ConfigProps;
  store: StoreProps;
  repository: RepositoryProps;
  cache: CacheProps;
  dependency: DependencyProps;
  model: ModelProps;
  event: EventProps;
  on: OnProps;
  websocket: WebSocketProps;
  derive: DeriveProps;
  memo: MemoProps;
  fmt: FmtProps;
  set: SetProps;
  async: AsyncProps;
  try: TryProps;
  step: StepProps;
  catch: CatchProps;
  local: LocalProps;
  filter: ArrayMethodProps;
  find: ArrayMethodProps;
  some: ArrayMethodProps;
  every: ArrayMethodProps;
  findIndex: ArrayMethodProps;
  reduce: ReduceProps;
  map: MapProps;
  flatMap: FlatMapProps;
  flat: FlatProps;
  slice: SliceProps;
  at: AtProps;
  sort: SortProps;
  reverse: ReverseProps;
  join: JoinProps;
  includes: ValueLookupProps;
  indexOf: ValueLookupProps;
  lastIndexOf: ValueLookupProps;
  concat: ConcatProps;
  forEach: ForEachProps;
  compact: CompactProps;
  pluck: PluckProps;
  unique: UniqueProps;
  uniqueBy: UniqueByProps;
  groupBy: GroupByProps;
  partition: PartitionProps;
  indexBy: IndexByProps;
  countBy: CountByProps;
  chunk: ChunkProps;
  zip: ZipProps;
  range: RangeProps;
  take: TakeProps;
  drop: DropProps;
  min: MinMaxProps;
  max: MinMaxProps;
  minBy: MinMaxByProps;
  maxBy: MinMaxByProps;
  sum: SumProps;
  sumBy: SumByProps;
  avg: AvgProps;
  intersect: IntersectProps;
  findLast: ArrayMethodProps;
  findLastIndex: ArrayMethodProps;
  transform: TransformProps;
  action: ActionProps;
  actionRegistry: ActionRegistryProps;
  guard: GuardProps;
  assume: AssumeProps;
  invariant: InvariantProps;
  each: EachProps;
  collect: CollectProps;
  branch: BranchProps;
  resolve: ResolveProps;
  expect: ExpectProps;
  recover: RecoverProps;
  pattern: PatternProps;
  conditional: ConditionalProps;
  elseif: ElseIfProps;
  else: ElseProps;
  select: SelectProps;
  module: ModuleProps;
  import: ImportProps;
  field: FieldProps;
  param: ParamProps;
  getter: GetterProps;
  setter: SetterProps;
  variant: VariantProps;
  method: MethodProps;
  constructor: ConstructorProps;
  transition: TransitionProps;
  state: StateProps;
  column: ColumnProps;
  relation: RelationProps;
  option: OptionProps;
  test: TestProps;
}

// ── Helper ──────────────────────────────────────────────────────────────

/**
 * Get typed props for a known node type. Falls back to `Record<string, unknown>`
 * for custom/evolved types not in the map.
 *
 * @example
 * ```ts
 * const props = propsOf<'fn'>(node);
 * props.name    // string | undefined
 * props.params  // string | undefined
 * props.returns // string | undefined
 * ```
 */
export function propsOf<T extends keyof NodePropsMap>(node: IRNode): NodePropsMap[T] {
  return (node.props || {}) as NodePropsMap[T];
}

/**
 * Get props as a generic record — for custom/evolved types or when the
 * node type isn't known at compile time.
 */
export function propsUntyped(node: IRNode): Record<string, unknown> {
  return (node.props || {}) as Record<string, unknown>;
}
