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

export type ConceptEdgeKind = 'call' | 'dependency';

// ── Typed Payloads ───────────────────────────────────────────────────────

export interface EntrypointPayload {
  readonly kind: 'entrypoint';
  subtype: 'route' | 'handler' | 'main' | 'export' | 'event-listener' | 'route-mount';
  /**
   * - `'route'`: the route path (e.g. `/current`, `/api/users/{id}`).
   * - `'route-mount'`: the URL prefix applied by the mount (e.g. `/api/nutrition-goals`).
   * - Others: the function/handler name.
   */
  name: string;
  httpMethod?: string;
  /**
   * For Python/FastAPI-style route decorators, the declared response shape
   * from `response_model=...`. Omitted when the mapper cannot prove one is
   * present.
   */
  responseModel?: string;
  /**
   * For route entrypoints whose mapper can inspect the backing handler.
   * Omitted when the route abstraction does not expose handler async-ness.
   */
  isAsync?: boolean;
  /**
   * For `'route'` and `'route-mount'` only — the variable name the
   * decorator was applied to (`router`, `app`) or the target of
   * `include_router(<name>, ...)`. Used by `collectRoutes` to join per-file
   * route decorators with the `include_router(prefix=…)` call that mounts
   * them under a URL prefix.
   */
  routerName?: string;
  /**
   * For `'route-mount'` only — the imported module specifier hosting the
   * router. FastAPI example: `from app.api import nutrition_goals;
   * app.include_router(nutrition_goals.router, prefix="/api/nutrition-goals")`
   * → `sourceModule: 'app.api.nutrition_goals'`. The cross-stack collector
   * resolves this against route file paths to attach the prefix.
   */
  sourceModule?: string;
  /**
   * For `'route'` only, and only when the handler is an INLINE arrow /
   * function expression on the same call (e.g. `app.get('/x', (req, res) => {})`).
   * Holds the concept id of the handler's `function_declaration` concept.
   * Undefined when the handler is an imported identifier or not resolvable.
   *
   * Rules that reason about the handler body (what fields it reads from
   * `req.body`, whether it calls `res.status()` etc.) resolve this id back
   * to the `function_declaration` concept in the same file, then walk the
   * primary span.
   */
  handlerConceptId?: string;
}

export interface EffectPayload {
  readonly kind: 'effect';
  subtype: 'network' | 'db' | 'fs' | 'process' | 'time' | 'random';
  target?: string;
  async: boolean;
  /**
   * For `network` subtype only. `true` when the call's eventual JSON value is
   * consumed with a type annotation, `as T` cast, or `satisfies T` clause;
   * `false` when `.json()` is awaited without any assertion; `undefined` when
   * the mapper can't tell (no `.json()` in scope, or the shape is too
   * complex to analyze statically). Feeds the `untyped-api-response` rule.
   */
  responseAsserted?: boolean;
  /**
   * For `network` subtype only. Classifies what the call sends on the wire:
   *   - `'none'` — no body (GET, or no options arg at all).
   *   - `'static'` — body is a string literal or literal object without any
   *     dynamic interpolation.
   *   - `'dynamic'` — body is built from variables, template literals with
   *     `${…}`, or `JSON.stringify(x)` for some non-literal `x`.
   * Feeds the `tainted-across-wire` rule so it can fire only on the class
   * of calls that actually carry user-controlled data.
   */
  bodyKind?: 'none' | 'static' | 'dynamic';
  /**
   * For `network` subtype only. Uppercase HTTP method (`GET`, `POST`, …) when
   * the mapper can derive it confidently: axios-style `axios.post(…)`, wrapped
   * `apiClient.get(…)`, or raw `fetch(url, { method: 'POST' })`. Undefined
   * when the call is a generic `axios(config)` whose method lives in a runtime
   * variable — we'd rather stay silent than guess. Feeds the
   * `contract-method-drift` rule.
   */
  method?: string;
  /**
   * For `network` subtype only. `true` when the call's options literal carries
   * an `Authorization` header (any value — we don't inspect the token). `false`
   * when the options literal is present but no Authorization header exists.
   * `undefined` when the options arg is a variable, spread, or missing. Feeds
   * the `auth-drift` cross-stack rule.
   */
  hasAuthHeader?: boolean;
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

export type ConceptEdgePayload = CallPayload | DependencyPayload;

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
