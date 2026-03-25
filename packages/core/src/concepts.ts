/**
 * KERN Concept Model — universal code concepts for cross-language review.
 *
 * Concepts model MEANING, not syntax. A mapper per language translates
 * language-specific syntax into universal concepts. Rules operate on concepts.
 *
 * ConceptNode: entity (entrypoint, effect, guard, error, state mutation)
 * ConceptEdge: relation (call, dependency)
 */

// ── Source Span (reusable) ───────────────────────────────────────────────

export interface ConceptSpan {
  file: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

// ── Concept Node Kinds ───────────────────────────────────────────────────

export type ConceptNodeKind =
  | 'entrypoint'
  | 'effect'
  | 'state_mutation'
  | 'error_raise'
  | 'error_handle'
  | 'guard'
  | 'function_declaration';

// ── Concept Edge Kinds ───────────────────────────────────────────────────

export type ConceptEdgeKind =
  | 'call'
  | 'dependency';

// ── Typed Payloads ───────────────────────────────────────────────────────

export interface EntrypointPayload {
  readonly kind: 'entrypoint';
  subtype: 'route' | 'handler' | 'main' | 'export' | 'event-listener';
  name: string;
  httpMethod?: string;
}

export interface EffectPayload {
  readonly kind: 'effect';
  subtype: 'network' | 'db' | 'fs' | 'process' | 'time' | 'random';
  target?: string;
  async: boolean;
}

export interface StateMutationPayload {
  readonly kind: 'state_mutation';
  target: string;
  scope: 'local' | 'module' | 'global' | 'shared';
  via?: 'assignment' | 'increment' | 'call';
  api?: string;
}

export interface FunctionDeclarationPayload {
  readonly kind: 'function_declaration';
  name: string;
  async: boolean;
  hasAwait: boolean;
  isComponent: boolean;
  isExport: boolean;
}

export interface ErrorRaisePayload {
  readonly kind: 'error_raise';
  subtype: 'throw' | 'reject' | 'err-return' | 'panic';
  errorType?: string;
}

export interface ErrorHandlePayload {
  readonly kind: 'error_handle';
  disposition: 'ignored' | 'logged' | 'wrapped' | 'returned' | 'rethrown' | 'retried';
  errorVariable?: string;
}

export interface GuardPayload {
  readonly kind: 'guard';
  subtype: 'auth' | 'validation' | 'policy' | 'rate-limit';
  name?: string;
}

export interface CallPayload {
  readonly kind: 'call';
  async: boolean;
  name: string;
}

export interface DependencyPayload {
  readonly kind: 'dependency';
  subtype: 'internal' | 'external' | 'stdlib';
  specifier: string;
}

export type ConceptNodePayload =
  | EntrypointPayload
  | EffectPayload
  | StateMutationPayload
  | ErrorRaisePayload
  | ErrorHandlePayload
  | GuardPayload
  | FunctionDeclarationPayload;

export type ConceptEdgePayload =
  | CallPayload
  | DependencyPayload;

// ── ConceptNode ──────────────────────────────────────────────────────────

export interface ConceptNode {
  /** Deterministic ID: `${filePath}#${kind}@${offset}` */
  id: string;
  kind: ConceptNodeKind;
  primarySpan: ConceptSpan;
  evidenceSpans?: ConceptSpan[];
  /** The actual code that was classified */
  evidence: string;
  /** 0.0–1.0: how confident the mapper is */
  confidence: number;
  /** Source language: 'ts', 'py', 'go', etc. */
  language: string;
  /** Parent function/class ID for scoping */
  containerId?: string;
  /** Typed payload — specific to kind */
  payload: ConceptNodePayload;
}

// ── ConceptEdge ──────────────────────────────────────────────────────────

export interface ConceptEdge {
  /** Deterministic ID */
  id: string;
  kind: ConceptEdgeKind;
  sourceId: string;
  targetId: string;
  primarySpan: ConceptSpan;
  evidence: string;
  confidence: number;
  language: string;
  payload: ConceptEdgePayload;
}

// ── ConceptMap (output of a mapper) ──────────────────────────────────────

export interface ConceptMap {
  filePath: string;
  language: string;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  extractorVersion: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

export function conceptId(filePath: string, kind: string, offset: number): string {
  return `${filePath}#${kind}@${offset}`;
}

export function conceptSpan(
  file: string,
  startLine: number,
  startCol: number,
  endLine?: number,
  endCol?: number,
): ConceptSpan {
  return { file, startLine, startCol, endLine: endLine ?? startLine, endCol: endCol ?? startCol };
}
