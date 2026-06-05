/**
 * @kernlang/context — Kern Project Context Graph.
 *
 * The stable, pure (no ts-morph) contract for KERN's whole-project map:
 *  - {@link ProjectContextGraph} — the artifact schema (kern-context.json).
 *  - {@link buildSpine} — render a compact, budgeted `<kern-map>` per review batch.
 *
 * The heavy graph builders that produce a ProjectContextGraph live in
 * `@kernlang/review` (they depend on ts-morph). This package is what codegen,
 * MCP servers, and external agents import to consume or render the map.
 */
export {
  CONTEXT_SCHEMA_VERSION,
  type EdgeConfidence,
  type FileNode,
  type ImportRef,
  type ProjectContextGraph,
  type SymbolKind,
  type SymbolNode,
  type TaintFlow,
  type UsageEntry,
  type UseSite,
} from './schema.js';
export {
  buildSpine,
  DEFAULT_SPINE_TOKENS,
  estimateTokens,
  type OtherBatch,
  SPINE_BUDGET_FRACTION,
  type SpineOptions,
  type SpineTier,
  sanitize,
} from './spine.js';
