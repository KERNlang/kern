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
}

export interface InterfaceProps extends BaseProps {
  extends?: string;
}

export interface UnionProps extends BaseProps {
  discriminant?: string;
}

export interface ServiceProps extends BaseProps {
  implements?: string;
}

export interface ClassProps extends BaseProps {
  extends?: string;
  implements?: string;
  abstract?: string | boolean;
}

export interface ConstProps extends BaseProps {
  type?: string;
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
}

export interface TransformProps extends BaseProps {
  target?: string;
  via?: string;
  type?: string;
}

export interface ActionProps extends BaseProps {
  params?: string;
  returns?: string;
}

export interface GuardProps extends BaseProps {
  when?: string;
  message?: string;
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
}

export interface RecoverProps extends BaseProps {}

export interface PatternProps extends BaseProps {
  pattern?: string;
}

// ── UI Controls ─────────────────────────────────────────────────────────

export interface ConditionalProps extends BaseProps {
  if?: string | ExprObject;
}

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
  default?: string;
  private?: string | boolean;
}

export interface VariantProps extends BaseProps {
  type?: string;
}

export interface MethodProps extends BaseProps {
  params?: string;
  returns?: string;
}

export interface TransitionProps extends BaseProps {
  from?: string;
  to?: string;
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
}

// ── Props Map ───────────────────────────────────────────────────────────

/** Maps known node types to their typed prop interface. */
export interface NodePropsMap {
  doc: DocProps;
  type: TypeProps;
  interface: InterfaceProps;
  union: UnionProps;
  service: ServiceProps;
  class: ClassProps;
  const: ConstProps;
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
  transform: TransformProps;
  action: ActionProps;
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
  select: SelectProps;
  module: ModuleProps;
  import: ImportProps;
  field: FieldProps;
  variant: VariantProps;
  method: MethodProps;
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
