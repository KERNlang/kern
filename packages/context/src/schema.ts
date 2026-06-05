/**
 * Kern Project Context Graph — the artifact schema.
 *
 * A compact, language-agnostic description of a project's structure that any
 * LLM/agent can consume for instant whole-project context: which symbols exist,
 * where they are defined, and — crucially — WHERE each one is USED. It is the
 * stable wire contract behind both the per-batch review "spine" (see spine.ts)
 * and the `kern context` CLI artifact (kern-context.json).
 *
 * This package is intentionally PURE: types + serialization + budgeting only.
 * The heavy ts-morph graph builders live in `@kernlang/review`, which maps its
 * import graph / call graph / taint analysis into this schema. Keeping the
 * builders out of here means `@kernlang/context` stays a light dependency that
 * codegen, MCP servers, and external agents can pull in without ts-morph.
 */

/** Bump when the artifact shape changes incompatibly. Consumers must check it. */
export const CONTEXT_SCHEMA_VERSION = 1;

/** What a symbol is. Drives the usage verb in the spine (call vs read). */
export type SymbolKind = 'function' | 'method' | 'class' | 'const' | 'type' | 'module';

/**
 * How sure we are an edge is real.
 * - `resolved`   — statically proven (direct call, named import binding).
 * - `heuristic`  — inferred but plausibly wrong (alias chains, re-export hops).
 * - `unresolved` — could not be tied to a target (dynamic import, HOF callback,
 *   computed property). NEVER rendered as a fact; marked `~` or omitted.
 */
export type EdgeConfidence = 'resolved' | 'heuristic' | 'unresolved';

/** A file in the project. `id` is stable within one artifact (e.g. "f1"). */
export interface FileNode {
  id: string;
  /** Canonical (realpath) or display path — the builder decides; keep it consistent. */
  path: string;
  language?: string;
  /** Hash of file contents, so a consumer can detect a stale graph vs the tree. */
  contentHash?: string;
  /** Files this file imports, with the named bindings it pulls in. Powers `deps`. */
  imports?: ImportRef[];
}

/** One import edge out of a file: a target path plus the names bound from it. */
export interface ImportRef {
  path: string;
  symbols?: string[];
}

/** A named, reviewable symbol (function/class/const/...). `id` e.g. "s1". */
export interface SymbolNode {
  id: string;
  /** FileNode.id where this symbol is defined. */
  fileId: string;
  name: string;
  kind: SymbolKind;
  exported: boolean;
  /** True if part of the package's public API (re-exported from an entry/barrel). */
  publicApi?: boolean;
  line: number;
}

/** A single place a symbol is used (called/read). */
export interface UseSite {
  /** File path where the use occurs. */
  path: string;
  line: number;
  confidence: EdgeConfidence;
  via?: string;
}

/** Reverse-usage for one symbol: who uses it, and how many total. */
export interface UsageEntry {
  /** Concrete use-sites. May be capped by the builder; `totalCount` is the truth. */
  callers: UseSite[];
  /** Total number of use-sites (>= callers.length when capped). */
  totalCount: number;
}

/** A cross-file taint flow: source → through a symbol → sink. */
export interface TaintFlow {
  source: string;
  through: string;
  sink: string;
  confidence: EdgeConfidence;
}

/**
 * The whole-project context artifact.
 *
 * `usage` is keyed by SymbolNode.id. `generatedAt` is metadata only and is
 * deliberately NOT consumed by the spine renderer, so spine output stays
 * deterministic (and therefore cacheable) for a given structural input.
 */
export interface ProjectContextGraph {
  schemaVersion: number;
  /** Hash over the (path, contentHash) set — a cache key for the whole artifact. */
  rootHash?: string;
  /** ISO timestamp; metadata only, never rendered into the spine. */
  generatedAt?: string;
  files: FileNode[];
  symbols: SymbolNode[];
  usage: Record<string, UsageEntry>;
  taint?: TaintFlow[];
}
