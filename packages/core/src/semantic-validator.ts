/**
 * Semantic Validation — cross-reference checks that go beyond structural schema validation.
 *
 * Currently validates:
 *   1. Machine transitions reference valid states
 *   2. No duplicate sibling names (e.g., two `field name=id` in the same interface)
 *   3. `derive` cannot be a direct child of `each` when that `each` is inside
 *      a `render` block — `derive` compiles to `useMemo`, which violates React's
 *      Rules of Hooks when called inside a `.map()` callback.
 *   4. `set name=X` must have a matching `state name=X` declared in an ancestor
 *      screen/component. Otherwise codegen emits `setX(...)` with no bound
 *      setter, which fails at React runtime with no compile-time signal.
 *   5. `module > export` bindings must reference names visible in that module
 *      when the source is local, and resolver-enriched re-exports must name
 *      symbols that the resolver proved exist.
 */

import { hasDirectSuperCtorCall } from './constructor-super.js';
import {
  type CoreShapeDiagnostic,
  type CoreShapeInterfaceFact,
  collectCoreShapeFacts,
} from './core-runtime/shape-validator.js';
import { collectExternalImportSymbols, type ExternalImportSymbolTable } from './external-symbols.js';
import { importRegistryOf } from './import-metadata.js';
import { parseExpression } from './parser-expression.js';
import { RAG_ASSERTION_KIND_SET, RAG_ASSERTION_KINDS } from './rag-assertions.js';
import type { IRNode } from './types.js';
import type { ValueIR } from './value-ir.js';

export interface SemanticViolation {
  rule: string;
  nodeType: string;
  message: string;
  line?: number;
  col?: number;
}

export type ClassSemanticMemberKind = 'field' | 'method' | 'getter' | 'setter';

export type ClassSemanticOverrideStatus =
  | 'compatible'
  | 'kind-mismatch'
  | 'arity-mismatch'
  | 'return-mismatch'
  | 'param-mismatch';

export interface ClassSemanticLocation {
  readonly line: number;
  readonly col: number;
}

export interface ClassSemanticMemberFact {
  readonly className: string;
  readonly owner: string;
  readonly name: string;
  readonly kind: ClassSemanticMemberKind;
  readonly static: boolean;
  readonly private?: boolean;
  readonly async?: boolean;
  readonly stream?: boolean;
  readonly generator?: boolean;
  readonly type?: string;
  readonly returns?: string;
  readonly paramTypes?: readonly string[];
  readonly arity: number;
  readonly readable: boolean;
  readonly writable: boolean;
  readonly inheritedFrom?: string;
  readonly loc?: ClassSemanticLocation;
}

export interface ClassSemanticClassFact {
  readonly name: string;
  readonly baseName?: string;
  readonly hasConstructor: boolean;
  readonly constructorCount: number;
  readonly members: readonly ClassSemanticMemberFact[];
  readonly effectiveMembers: readonly ClassSemanticMemberFact[];
  readonly loc?: ClassSemanticLocation;
}

export type ClassSemanticConstructorSuperStatus =
  | 'not-required'
  | 'satisfied'
  | 'missing'
  | 'conditional'
  | 'double'
  | 'this-before-super';

export interface ClassSemanticConstructorFact {
  readonly className: string;
  readonly hasConstructor: boolean;
  readonly constructorCount: number;
  readonly hasBase: boolean;
  readonly requiresSuper: boolean;
  readonly superStatus: ClassSemanticConstructorSuperStatus;
  readonly superCallCount: number;
  readonly thisBeforeSuper: boolean;
  readonly declaredFields: readonly string[];
  readonly initializedFields: readonly string[];
  readonly uninitializedRequiredFields: readonly string[];
  readonly provenance: 'static-analysis';
  readonly loc?: ClassSemanticLocation;
}

export interface ClassSemanticInheritanceEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: 'extends';
  readonly resolved: boolean;
  readonly builtin: boolean;
}

export interface ClassSemanticImplementsEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: 'implements';
  readonly resolved: boolean;
  readonly external: boolean;
}

export interface ClassSemanticOverrideFact {
  readonly className: string;
  readonly memberName: string;
  readonly static: boolean;
  readonly kind: ClassSemanticMemberKind;
  readonly arity: number;
  readonly baseClassName: string;
  readonly baseKind: ClassSemanticMemberKind;
  readonly baseArity: number;
  readonly status: ClassSemanticOverrideStatus;
  readonly loc?: ClassSemanticLocation;
}

export type ClassSemanticProtocolStatus =
  | 'satisfied'
  | 'missing-members'
  | 'external'
  | 'unknown-interface'
  | 'invalid-interface'
  | 'unsupported-protocol';

export interface ClassSemanticProtocolConformanceFact {
  readonly className: string;
  readonly interfaceName: string;
  readonly status: ClassSemanticProtocolStatus;
  readonly missingMembers: readonly string[];
  readonly satisfiedMembers: readonly string[];
  readonly missingStaticMembers: readonly string[];
  readonly satisfiedStaticMembers: readonly string[];
  readonly diagnostics?: readonly string[];
  readonly unsupportedReasons?: readonly string[];
  readonly loc?: ClassSemanticLocation;
}

export interface ClassSemanticFacts {
  readonly classes: readonly ClassSemanticClassFact[];
  readonly constructorFacts: readonly ClassSemanticConstructorFact[];
  readonly inheritanceEdges: readonly ClassSemanticInheritanceEdge[];
  readonly implementsEdges: readonly ClassSemanticImplementsEdge[];
  readonly overrides: readonly ClassSemanticOverrideFact[];
  readonly unresolvedBases: readonly string[];
  readonly unresolvedImplements: readonly string[];
  readonly protocolConformance: readonly ClassSemanticProtocolConformanceFact[];
  readonly cycles: readonly (readonly string[])[];
}

export interface RagSemanticLocation {
  readonly line: number;
  readonly col: number;
}

export interface RagSemanticSourceFact {
  readonly name?: string;
  readonly corpusName?: string;
  readonly kind?: string;
  readonly uri: string;
  readonly resourceName?: string;
  readonly media?: string;
  readonly acl?: string;
  readonly loc?: RagSemanticLocation;
}

export interface RagSemanticChunkingFact {
  readonly name?: string;
  readonly corpusName?: string;
  readonly sourceName?: string;
  readonly strategy?: string;
  readonly maxTokens?: number;
  readonly overlap?: number;
  readonly unit?: string;
  readonly loc?: RagSemanticLocation;
}

export interface RagSemanticEmbedFact {
  readonly name: string;
  readonly corpusName: string;
  readonly model?: string;
  readonly dims?: number;
  readonly metric?: string;
  readonly loc?: RagSemanticLocation;
}

export interface RagSemanticCorpusFact {
  readonly name: string;
  readonly title?: string;
  readonly tenant?: string;
  readonly refresh?: string;
  readonly sources: readonly RagSemanticSourceFact[];
  readonly chunking: readonly RagSemanticChunkingFact[];
  readonly embeds: readonly RagSemanticEmbedFact[];
  readonly loc?: RagSemanticLocation;
}

export interface RagSemanticRetrieverFact {
  readonly name: string;
  readonly corpusName: string;
  readonly embedName?: string;
  readonly mode?: string;
  readonly topK?: number;
  readonly minScore?: number;
  readonly rerank?: string;
  readonly loc?: RagSemanticLocation;
}

export interface RagSemanticGroundingFact {
  readonly name?: string;
  readonly ragName?: string;
  readonly requireCitations: boolean;
  readonly policy?: string;
  readonly maxContext?: number;
  readonly loc?: RagSemanticLocation;
}

export interface RagSemanticEvalFact {
  readonly name?: string;
  readonly ragName?: string;
  readonly metric?: string;
  readonly threshold?: number;
  readonly mode?: string;
  readonly caseCount?: number;
  readonly assertCount?: number;
  readonly cases?: readonly RagSemanticEvalCaseFact[];
  readonly loc?: RagSemanticLocation;
}

export interface RagSemanticEvalCaseFact {
  readonly name: string;
  readonly ragName?: string;
  readonly evalName?: string;
  readonly query: string;
  readonly tags: readonly string[];
  readonly expected: {
    readonly topK?: number;
    readonly minScore?: number;
    readonly chunkCount?: number;
    readonly sources?: readonly string[];
  };
  readonly asserts: readonly RagSemanticEvalAssertFact[];
  readonly loc?: RagSemanticLocation;
}

export interface RagSemanticEvalAssertFact {
  readonly ragName?: string;
  readonly evalName?: string;
  readonly caseName?: string;
  readonly kind: string;
  readonly target: 'retrieved-chunk' | 'retrieved-chunks' | 'grounding' | 'latency';
  readonly op: 'eq' | 'gte' | 'lte' | 'contains' | 'glob' | 'present';
  readonly value?: string | number | boolean;
  readonly required: boolean;
  readonly loc?: RagSemanticLocation;
}

export interface RagSemanticAnswerSpanFact {
  readonly start: number;
  readonly end: number;
  readonly chunkIds: readonly string[];
  readonly required: boolean;
  readonly loc?: RagSemanticLocation;
}

export interface RagSemanticAnswerContractFact {
  readonly name: string;
  readonly ragName?: string;
  readonly query: string;
  readonly answer: string;
  readonly prompt?: string;
  readonly requireCitations: boolean;
  readonly minGroundingCoverage?: number;
  readonly spans: readonly RagSemanticAnswerSpanFact[];
  readonly loc?: RagSemanticLocation;
}

export interface RagSemanticPipelineFact {
  readonly name: string;
  readonly retrieverName: string;
  readonly prompt?: string;
  readonly answer?: string;
  readonly citations: boolean;
  readonly groundings: readonly RagSemanticGroundingFact[];
  readonly evals: readonly RagSemanticEvalFact[];
  readonly answerContracts: readonly RagSemanticAnswerContractFact[];
  readonly loc?: RagSemanticLocation;
}

export interface RagSemanticMcpRetrievalFact {
  readonly containerKind?: 'tool' | 'prompt';
  readonly containerName?: string;
  readonly targetKind: 'retriever' | 'rag';
  readonly targetName: string;
  readonly name?: string;
  readonly queryParam?: string;
  readonly query?: string;
  readonly as?: string;
  readonly topK?: number;
  readonly minScore?: number;
  readonly requireGrounding: boolean;
  readonly outputShape?: string;
  readonly outputItemShape?: string;
  readonly requireCitations?: boolean;
  readonly effectiveRequiresCitations: boolean;
  readonly provenance?: string;
  readonly citationField?: string;
  readonly sourceField?: string;
  readonly scoreField?: string;
  readonly contractStatus: 'absent' | 'valid' | 'invalid';
  readonly loc?: RagSemanticLocation;
}

export interface RagSemanticResourceFeedFact {
  readonly corpusName?: string;
  readonly sourceName?: string;
  readonly resourceName: string;
  readonly uri: string;
  readonly loc?: RagSemanticLocation;
}

export interface RagSemanticFacts {
  readonly corpora: readonly RagSemanticCorpusFact[];
  readonly retrievers: readonly RagSemanticRetrieverFact[];
  readonly pipelines: readonly RagSemanticPipelineFact[];
  readonly mcpRetrievals: readonly RagSemanticMcpRetrievalFact[];
  readonly resourceFeedsCorpora: readonly RagSemanticResourceFeedFact[];
  readonly unresolvedCorpusRefs: readonly string[];
  readonly unresolvedRetrieverRefs: readonly string[];
  readonly unresolvedEmbedRefs: readonly string[];
  readonly unresolvedRagRefs: readonly string[];
  readonly unresolvedSourceRefs: readonly string[];
  readonly unresolvedResourceRefs: readonly string[];
}

/**
 * Run semantic validation on an IR tree.
 * Returns an empty array when the tree is valid.
 */
export function validateSemantics(root: IRNode): SemanticViolation[] {
  const violations: SemanticViolation[] = [];
  validateClassGraph(root, violations);
  validateRagGraph(root, violations);
  validateEnumAccess(root, violations);
  validateNode(root, violations, [], []);
  return violations;
}

export function validateClassSemantics(root: IRNode | readonly IRNode[]): SemanticViolation[] {
  const violations: SemanticViolation[] = [];
  validateClassGraphRoots(Array.isArray(root) ? root : [root], violations);
  return violations;
}

export function validateRagSemantics(root: IRNode | readonly IRNode[]): SemanticViolation[] {
  const violations: SemanticViolation[] = [];
  validateRagGraphRoots(Array.isArray(root) ? root : [root], violations);
  return violations;
}

// True when the *innermost* handler ancestor is opted into native body-
// statement mode (`lang="kern"`). Body statements like `let`/`assign`/`do`/
// `if`/`try` nest freely inside that scope, so the let-parent rule has to
// be context-aware rather than a hardcoded sibling list. Walks back to the
// first `handler` ancestor and stops — a raw (non-`lang=kern`) handler
// nested inside a native handler must NOT inherit native-body permissions,
// or `let` would be silently accepted inside the raw boundary. Body-
// statement containers allowed as a `let` parent inside native body:
// handler, if, else, try, catch, finally, while, for, each.
function insideNativeBodyHandler(ancestorNodes: IRNode[]): boolean {
  for (let i = ancestorNodes.length - 1; i >= 0; i--) {
    const ancestor = ancestorNodes[i];
    if (ancestor.type === 'handler') return ancestor.props?.lang === 'kern';
  }
  return false;
}

function validateNode(
  node: IRNode,
  violations: SemanticViolation[],
  ancestry: string[],
  ancestorNodes: IRNode[],
): void {
  // ── Machine transition cross-ref ───────────────────────────────────
  if (node.type === 'machine' && node.children) {
    const stateNames = new Set<string>();
    for (const child of node.children) {
      if (child.type === 'state' && child.props?.name) {
        stateNames.add(child.props.name as string);
      }
    }

    for (const child of node.children) {
      if (child.type === 'transition') {
        const from = child.props?.from as string | undefined;
        const to = child.props?.to as string | undefined;
        const name = (child.props?.name as string) || '(unnamed)';

        if (from) {
          for (const source of from
            .split('|')
            .map((part) => part.trim())
            .filter(Boolean)) {
            if (!stateNames.has(source)) {
              violations.push({
                rule: 'machine-transition-from',
                nodeType: 'transition',
                message: `Transition '${name}' references unknown state '${source}' in 'from'. Available states: ${[...stateNames].join(', ') || '(none)'}`,
                line: child.loc?.line,
                col: child.loc?.col,
              });
            }
          }
        }
        if (to && !stateNames.has(to)) {
          violations.push({
            rule: 'machine-transition-to',
            nodeType: 'transition',
            message: `Transition '${name}' references unknown state '${to}' in 'to'. Available states: ${[...stateNames].join(', ') || '(none)'}`,
            line: child.loc?.line,
            col: child.loc?.col,
          });
        }
      }
    }
  }

  // ── Module export cross-refs ────────────────────────────────────────
  if (node.type === 'module' && node.children) {
    const externalImports = collectExternalImportSymbols(node);
    validateModuleExternalImportConflicts(externalImports, violations);
    validateModuleExports(node, violations, externalImports);
  }

  // ── Duplicate sibling names ────────────────────────────────────────
  if (node.children && node.children.length > 1) {
    const seen = new Map<string, IRNode>();
    for (const child of node.children) {
      const name = child.props?.name as string | undefined;
      if (!name) continue;
      const key = `${child.type}:${name}`;
      const prev = seen.get(key);
      if (prev) {
        violations.push({
          rule: 'duplicate-sibling-name',
          nodeType: child.type,
          message: `Duplicate '${child.type}' named '${name}' — first defined at line ${prev.loc?.line ?? '?'}`,
          line: child.loc?.line,
          col: child.loc?.col,
        });
      } else {
        seen.set(key, child);
      }
    }
  }

  // ── derive-inside-render-each — Rules-of-Hooks guard ───────────────
  // derive → useMemo (see packages/react/src/codegen-react.ts).
  // useMemo inside .map((item) => ...) violates React's Rules of Hooks.
  if (node.type === 'each' && ancestry.includes('render') && node.children) {
    for (const child of node.children) {
      if (child.type === 'derive') {
        violations.push({
          rule: 'no-derive-inside-render-each',
          nodeType: 'derive',
          message:
            '`derive` compiles to `useMemo`, which cannot run inside an `each`/`.map` callback (React Rules of Hooks). Move the derive above the `each`, or inline the expression in the handler.',
          line: child.loc?.line,
          col: child.loc?.col,
        });
      }
    }
  }

  // ── keyed each modes are body-stmt only (2026-05-06/2026-05-12) ───────
  // `pairKey`/`pairValue` and `entryKey`/`entryValue` lower to target-native
  // keyed collection loops. The render-path JSX emitter (codegen/screens.ts)
  // doesn't read these props, so a render-position keyed `each` would silently
  // emit `m.map((item, __i) => ...)` and lose the destructure.
  // Reject in render/group ancestor scope so the LLM sees the error rather
  // than a silently-wrong `.map()`.
  if (
    node.type === 'each' &&
    ('pairKey' in (node.props ?? {}) ||
      'pairValue' in (node.props ?? {}) ||
      'entryKey' in (node.props ?? {}) ||
      'entryValue' in (node.props ?? {}))
  ) {
    if (ancestry.includes('render') || ancestry.includes('group')) {
      violations.push({
        rule: 'each-keyed-mode-body-stmt-only',
        nodeType: 'each',
        message:
          '`each pairKey=/pairValue=/entryKey=/entryValue=` is a body-statement keyed collection form and cannot appear inside a `render`/`group` JSX context. Iterate the keyed collection ahead of the render block, or use the `name=` form with a render-key.',
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── each type= is body-stmt only (2026-05-07) ─────────────────────────
  // `type=` annotates a TS `for...of` binding. The render-path JSX emitter
  // lowers `each` to `.map(...)` and does not preserve that annotation, so
  // reject it in render/group scope instead of silently dropping it.
  if (node.type === 'each' && 'type' in (node.props ?? {})) {
    if (ancestry.includes('render') || ancestry.includes('group')) {
      violations.push({
        rule: 'each-type-body-stmt-only',
        nodeType: 'each',
        message:
          '`each type=` is a body-statement form for TS for...of bindings and cannot appear inside a `render`/`group` JSX context. Move the typed iteration above the render block, or omit type= in JSX composition.',
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── let must be a direct child of each OR a native body-stmt container ──
  // `let` has two valid parent contexts:
  //   1. `each` — iteration-scoped binding (emits `const` inside the `.map`
  //      callback). Valid in both render and native-body contexts.
  //   2. A body-statement container whose innermost handler ancestor is
  //      `handler lang="kern"`. The schema already accepts `let` as a
  //      child of handler/if/else/try/catch/finally/while/for, and the
  //      native body emitter lowers it correctly. The previous hardcoded
  //      sibling list (each/handler/if/else only) rejected legitimate
  //      uses of `let` inside try/catch/while/for and forced authors
  //      back to raw `<<<…>>>` bodies.
  //
  // Outside both contexts there's no codegen target and the binding is
  // silently dropped — fail loudly instead.
  //
  // OpenCode review fix: `parent === 'handler'` alone is not safe. The
  // body-statement parser-validator's `inNativeBody` is sticky once set,
  // so a raw handler nested inside a native handler would NOT have its
  // raw boundary detected by that validator. The semantic check below
  // verifies the immediate handler's lang=kern.
  if (node.type === 'let') {
    const parent = ancestry[ancestry.length - 1];
    const nativeBodyContainers = new Set(['if', 'else', 'try', 'catch', 'finally', 'while', 'for']);
    let approved = false;
    if (parent === 'each' || parent === 'fanout' || parent === 'stream') {
      // `fanout` is the concurrent iteration scope (slice 4c); a per-iteration
      // `let` binding lowers to a `const` inside the async producer callback,
      // exactly as `let` does inside `each`. A `let` directly under `stream` is
      // a generator-scope binding the portable SSE emitter lowers the same way.
      approved = true;
    } else if (parent === 'handler') {
      // Immediate handler boundary must be opted into kern body-stmt mode.
      const immediateHandler = ancestorNodes[ancestorNodes.length - 1];
      approved = immediateHandler?.props?.lang === 'kern';
    } else if (parent !== undefined && nativeBodyContainers.has(parent)) {
      approved = insideNativeBodyHandler(ancestorNodes);
    }
    if (!approved) {
      violations.push({
        rule: 'let-must-be-inside-each',
        nodeType: 'let',
        message:
          '`let` must be a direct child of `each`/`fanout`/`stream`, or of `handler`/`if`/`else`/`try`/`catch`/`finally`/`while`/`for` inside a `handler lang="kern"` scope. Use `derive` for component-scoped bindings, or `const` at file scope.',
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── emit / fanout require an enclosing `stream` ──────────────────────
  // Both are streaming primitives with no codegen target outside a `stream`
  // response body: `emit` writes through the SSE `emit()` helper / fan-in
  // queue, and `fanout` lowers to the concurrent producer scaffold. Placed
  // anywhere else they would silently drop (no stream to attach to), so flag
  // at source level with a line number rather than emit broken code.
  if ((node.type === 'emit' || node.type === 'fanout') && !ancestry.includes('stream')) {
    violations.push({
      rule: 'emit-fanout-require-stream',
      nodeType: node.type,
      message:
        `\`${node.type}\` is a streaming primitive and is only valid inside a \`stream\` response body. ` +
        (node.type === 'emit'
          ? 'Use `respond` for a single buffered HTTP response.'
          : 'Use `each` for sequential iteration outside a stream.'),
      line: node.loc?.line,
      col: node.loc?.col,
    });
  }

  // ── HTTP-response nodes are forbidden anywhere inside a `stream` ──────
  // `each`/`branch` are unrestricted containers, so `stream > each > respond`
  // or `stream > branch > path > guard` passes schema validation — but the
  // portable walker would emit a buffered HTTP response inside the SSE
  // generator: a value-returning `return`/`raise` in a Python async generator
  // (SyntaxError) or an Express `res.json` after the SSE headers are already
  // sent. Push `guard`/`respond` BEFORE the `stream` block as a route sibling,
  // and use `emit` for streamed output (Codex review on slice 4c).
  if ((node.type === 'respond' || node.type === 'guard') && ancestry.includes('stream')) {
    violations.push({
      rule: 'no-http-response-in-stream',
      nodeType: node.type,
      message: `\`${node.type}\` emits a buffered HTTP response and cannot appear inside a \`stream\` body — SSE headers are already sent. Use \`emit\` to push events. Validate the request up front with \`schema\`/\`validate\`/\`middleware\` (these run before streaming begins); a route-level \`guard\`/\`respond\` is not lowered on a stream route.`,
      line: node.loc?.line,
      col: node.loc?.col,
    });
  }

  // ── step / catch must be direct children of try ──────────────────────
  // Both are consumed by `generateTry`'s walk — placed elsewhere they hit
  // the defensive throw in the core dispatcher. Flagging semantically
  // surfaces the error with a line number during validation.
  if (node.type === 'step' || node.type === 'catch' || node.type === 'finally') {
    const parent = ancestry[ancestry.length - 1];
    if (parent !== 'try') {
      violations.push({
        rule: `${node.type}-must-be-inside-try`,
        nodeType: node.type,
        message: `\`${node.type}\` must be a direct child of \`try\`. Placing it elsewhere has no codegen target.`,
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── try may have at most one catch ───────────────────────────────────
  // JS only supports a single catch clause, so `generateTry` uses
  // `firstChild(node, 'catch')` — a second or third `catch` sibling would
  // be silently ignored. Flag it during validation so authors don't
  // assume a second catch handles a different error class.
  if (node.type === 'try' && node.children) {
    const catches = node.children.filter((c) => c.type === 'catch');
    if (catches.length > 1) {
      for (const extra of catches.slice(1)) {
        violations.push({
          rule: 'try-single-catch-only',
          nodeType: 'catch',
          message:
            '`try` supports at most one `catch` child — JavaScript has no multi-catch. Merge the error-handling logic or switch on `err instanceof …` inside a single catch.',
          line: extra.loc?.line,
          col: extra.loc?.col,
        });
      }
    }

    // ── try may have at most one finally (Codex review fix) ─────────────
    // Both JS and Python only model a single `finally` clause. The body-
    // statement emitter uses `findIndex` and would silently ignore a
    // second `finally` sibling; flag it during validation so the author
    // sees the duplicate at source level with a line number.
    const finallies = node.children.filter((c) => c.type === 'finally');
    if (finallies.length > 1) {
      for (const extra of finallies.slice(1)) {
        violations.push({
          rule: 'try-single-finally-only',
          nodeType: 'finally',
          message:
            '`try` supports at most one `finally` child — both JS and Python model a single finally clause. Merge the cleanup logic into one block.',
          line: extra.loc?.line,
          col: extra.loc?.col,
        });
      }
    }

    // ── finally is body-statement only (Codex review fix) ──────────────
    // Async-orchestration `try name=…` is consumed by `generateTry` in
    // `codegen/ground-layer.ts`, which only reads `step`/`handler`/`catch`.
    // A `finally` child of an orchestration `try` would pass the schema
    // (allowedChildren is shared between both shapes) but be silently
    // dropped at codegen. Reject it here so the author sees the mistake
    // at source level rather than discovering at runtime that cleanup
    // never ran.
    if (typeof node.props?.name === 'string' && node.props.name.length > 0 && finallies.length > 0) {
      for (const f of finallies) {
        violations.push({
          rule: 'finally-only-in-body-statement-try',
          nodeType: 'finally',
          message:
            '`finally` is only supported on body-statement `try` (inside `handler lang="kern"`). Async-orchestration `try name=…` does not have a finally codegen path; move cleanup into the surrounding handler or use a body-statement `try` for the protected block.',
          line: f.loc?.line,
          col: f.loc?.col,
        });
      }
    }
  }

  // ── group must be a direct child of render or another group ─────────
  // `group wrapper=...` is consumed by the composed-render walk in
  // `collectComposedPieces`, which only visits direct `render`/`group`
  // children. Placements like `render > each > group` or
  // `render > conditional > group` pass the schema but get silently dropped
  // at codegen because `generateEachJSX` / `generateConditionalJSX` don't
  // compose groups. Require a direct `render`/`group` parent so that silent
  // failure is caught as a validation error.
  if (node.type === 'group') {
    const parent = ancestry[ancestry.length - 1];
    if (parent !== 'render' && parent !== 'group') {
      violations.push({
        rule: 'group-must-be-inside-render',
        nodeType: 'group',
        message:
          '`group` must be a direct child of `render` or another `group`. Placing it inside `each`, `conditional`, or any other parent silently drops the wrapper at codegen.',
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── fmt inline-JSX form must sit inside render/group ─────────────────
  // `fmt template="..."` with no `name` and no `return=true` is the
  // inline-JSX form — it emits `{\`...\`}` as a JSX piece via
  // `collectComposedPieces`. Anywhere else (top-level, inside `fn`, inside
  // `each`/`conditional`, etc.) the codegen dispatcher throws. Flag the
  // misplacement semantically so authors get a line number.
  if (node.type === 'fmt') {
    const p = node.props || {};
    const returnMode = p.return === true || p.return === 'true';
    const isInline = !returnMode && !('name' in p);
    if (isInline) {
      const parent = ancestry[ancestry.length - 1];
      if (parent !== 'render' && parent !== 'group') {
        violations.push({
          rule: 'fmt-inline-must-be-inside-render',
          nodeType: 'fmt',
          message:
            '`fmt template="..."` without `name` or `return=true` is the inline-JSX form — it must be a direct child of `render` or `group`. Use `fmt name=X` for a binding or `fmt return=true` inside a `fn` body.',
          line: node.loc?.line,
          col: node.loc?.col,
        });
      }
    }
  }

  // ── set must match a state declaration ─────────────────────────────
  // `set name=X` lowers to `setX(...)` using the React useState convention.
  // If no ancestor declares `state name=X`, the emitted setter is unbound
  // and fails at React runtime with no compile-time signal.
  if (node.type === 'set') {
    const targetName = node.props?.name as string | undefined;
    if (targetName && !hasMatchingState(targetName, ancestorNodes)) {
      const declared = collectDeclaredStateNames(ancestorNodes);
      const hint =
        declared.length > 0
          ? ` Available in scope: ${declared.join(', ')}.`
          : ' No `state` declarations found in scope.';
      violations.push({
        rule: 'set-requires-matching-state',
        nodeType: 'set',
        message: `\`set name=${targetName}\` has no matching \`state name=${targetName}\` in scope — the emitted \`set${capitalize(targetName)}(...)\` will be unbound at runtime.${hint}`,
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // Recurse
  if (node.children) {
    const nextAncestry = node.type ? [...ancestry, node.type] : ancestry;
    const nextAncestorNodes = node.type ? [...ancestorNodes, node] : ancestorNodes;
    for (const child of node.children) {
      validateNode(child, violations, nextAncestry, nextAncestorNodes);
    }
  }
}

interface RagCorpusInfo {
  node: IRNode;
  rootIndex: number;
  name: string;
}

interface RagSourceInfo {
  node: IRNode;
  rootIndex: number;
  name?: string;
  corpusName?: string;
}

interface RagChunkingInfo {
  node: IRNode;
  rootIndex: number;
  name?: string;
  corpusName?: string;
  sourceName?: string;
}

interface RagEmbedInfo {
  node: IRNode;
  rootIndex: number;
  name: string;
  corpusName: string;
}

interface RagRetrieverInfo {
  node: IRNode;
  rootIndex: number;
  name: string;
  corpusName: string;
  embedName?: string;
}

interface RagPipelineInfo {
  node: IRNode;
  rootIndex: number;
  name: string;
  retrieverName: string;
}

interface RagGroundingInfo {
  node: IRNode;
  rootIndex: number;
  ragName?: string;
}

interface RagEvalInfo {
  node: IRNode;
  rootIndex: number;
  ragName?: string;
}

interface RagCaseInfo {
  node: IRNode;
  rootIndex: number;
  name?: string;
  query?: string;
  ragName?: string;
  evalName?: string;
  evalNode?: IRNode;
  evalBound: boolean;
}

interface RagAssertInfo {
  node: IRNode;
  rootIndex: number;
  ragName?: string;
  evalName?: string;
  caseName?: string;
  evalNode?: IRNode;
  caseNode?: IRNode;
  evalBound: boolean;
  caseBound: boolean;
}

interface RagAnswerContractInfo {
  node: IRNode;
  rootIndex: number;
  name?: string;
  ragName?: string;
}

interface RagAnswerSpanInfo {
  node: IRNode;
  rootIndex: number;
  contractName?: string;
  contractNode?: IRNode;
  contractBound: boolean;
}

interface RagMcpContainerInfo {
  node: IRNode;
  rootIndex: number;
  kind: 'tool' | 'prompt';
  name?: string;
  paramNames: ReadonlySet<string>;
}

interface RagMcpRetrievalInfo {
  node: IRNode;
  rootIndex: number;
  container?: RagMcpContainerInfo;
}

interface RagMcpSymbolInfo {
  node: IRNode;
  rootIndex: number;
  kind: 'resource' | 'tool' | 'prompt';
  name: string;
}

interface RagInfos {
  corpora: RagCorpusInfo[];
  sources: RagSourceInfo[];
  chunking: RagChunkingInfo[];
  embeds: RagEmbedInfo[];
  retrievers: RagRetrieverInfo[];
  pipelines: RagPipelineInfo[];
  groundings: RagGroundingInfo[];
  evals: RagEvalInfo[];
  cases: RagCaseInfo[];
  asserts: RagAssertInfo[];
  answerContracts: RagAnswerContractInfo[];
  answerSpans: RagAnswerSpanInfo[];
  mcpRetrievals: RagMcpRetrievalInfo[];
  mcpResources: RagMcpSymbolInfo[];
  mcpTools: RagMcpSymbolInfo[];
  mcpPrompts: RagMcpSymbolInfo[];
}

function validateRagGraph(root: IRNode, violations: SemanticViolation[]): void {
  validateRagGraphRoots([root], violations);
}

function validateRagGraphRoots(roots: readonly IRNode[], violations: SemanticViolation[]): void {
  const infos = collectRagInfosForRoots(roots);
  if (
    infos.corpora.length === 0 &&
    infos.sources.length === 0 &&
    infos.chunking.length === 0 &&
    infos.embeds.length === 0 &&
    infos.retrievers.length === 0 &&
    infos.pipelines.length === 0 &&
    infos.groundings.length === 0 &&
    infos.evals.length === 0 &&
    infos.cases.length === 0 &&
    infos.asserts.length === 0 &&
    infos.answerContracts.length === 0 &&
    infos.answerSpans.length === 0 &&
    infos.mcpRetrievals.length === 0 &&
    infos.mcpResources.length === 0 &&
    infos.mcpTools.length === 0 &&
    infos.mcpPrompts.length === 0
  ) {
    return;
  }

  const corpusByName = new Map(infos.corpora.map((info) => [info.name, info]));
  const embedByName = new Map(infos.embeds.map((info) => [info.name, info]));
  const retrieverByName = new Map(infos.retrievers.map((info) => [info.name, info]));
  const ragByName = new Map(infos.pipelines.map((info) => [info.name, info]));
  const mcpResourcesByName = collectRagMcpSymbolsByName(infos.mcpResources);
  const mcpCallableByName = new Map([
    ...infos.mcpTools.map((info) => [info.name, info] as const),
    ...infos.mcpPrompts.map((info) => [info.name, info] as const),
  ]);
  const citationRequiredRagNames = collectRagCitationRequiredNames(infos.pipelines, infos.groundings);
  const sourceNamesByCorpus = collectRagSourceNamesByCorpus(infos.sources);
  const globalSourceNames = new Set(infos.sources.map((info) => info.name).filter((name): name is string => !!name));

  validateRagUniqueNames(infos, violations);

  for (const source of infos.sources) {
    validateRagSource(source, mcpResourcesByName, mcpCallableByName, violations);
  }
  for (const chunking of infos.chunking) {
    validateRagChunking(chunking, corpusByName, sourceNamesByCorpus, globalSourceNames, violations);
  }
  for (const embed of infos.embeds) {
    validateRagEmbed(embed, corpusByName, violations);
  }
  for (const retriever of infos.retrievers) {
    validateRagRetriever(retriever, corpusByName, embedByName, violations);
  }
  for (const pipeline of infos.pipelines) {
    validateRagPipeline(pipeline, retrieverByName, infos.groundings, violations);
  }
  for (const grounding of infos.groundings) {
    validateRagGrounding(grounding, ragByName, violations);
  }
  for (const evaluation of infos.evals) {
    validateRagEval(evaluation, ragByName, violations);
  }
  for (const evaluationCase of infos.cases) {
    validateRagCase(evaluationCase, citationRequiredRagNames, violations);
  }
  for (const assertion of infos.asserts) {
    validateRagAssert(assertion, citationRequiredRagNames, violations);
  }
  for (const contract of infos.answerContracts) {
    validateRagAnswerContract(contract, infos.answerSpans, ragByName, citationRequiredRagNames, violations);
  }
  for (const span of infos.answerSpans) {
    validateRagAnswerSpan(span, violations);
  }
  validateRagMcpRetrievalDuplicates(infos.mcpRetrievals, violations);
  for (const retrieval of infos.mcpRetrievals) {
    validateRagMcpRetrieval(retrieval, retrieverByName, ragByName, citationRequiredRagNames, violations);
  }
}

function collectRagInfosForRoots(roots: readonly IRNode[]): RagInfos {
  const out: RagInfos = {
    corpora: [],
    sources: [],
    chunking: [],
    embeds: [],
    retrievers: [],
    pipelines: [],
    groundings: [],
    evals: [],
    cases: [],
    asserts: [],
    answerContracts: [],
    answerSpans: [],
    mcpRetrievals: [],
    mcpResources: [],
    mcpTools: [],
    mcpPrompts: [],
  };
  for (const [rootIndex, root] of roots.entries()) {
    collectRagInfos(root, rootIndex, out);
  }
  return out;
}

function collectRagInfos(root: IRNode, rootIndex: number, out: RagInfos): void {
  function visit(
    node: IRNode,
    nearestCorpusName?: string,
    nearestRagName?: string,
    nearestRagEvalName?: string,
    nearestRagCaseName?: string,
    nearestRagEvalBound = false,
    nearestRagCaseBound = false,
    nearestRagEvalNode?: IRNode,
    nearestRagCaseNode?: IRNode,
    nearestRagAnswerContractName?: string,
    nearestRagAnswerContractNode?: IRNode,
    nearestRagAnswerContractBound = false,
    nearestMcpContainer?: RagMcpContainerInfo,
    nearestMcpName?: string,
  ): void {
    const nextCorpusName = node.type === 'corpus' ? stringProp(node, 'name') || nearestCorpusName : nearestCorpusName;
    const nextRagName =
      node.type === 'rag'
        ? stringProp(node, 'name') || nearestRagName
        : node.type === 'ragEval'
          ? stringProp(node, 'rag') || nearestRagName
          : nearestRagName;
    const nextRagEvalName = node.type === 'ragEval' ? stringProp(node, 'name') : nearestRagEvalName;
    const nextRagCaseName = node.type === 'ragCase' ? stringProp(node, 'name') : nearestRagCaseName;
    const nextRagEvalBound = node.type === 'ragEval' || nearestRagEvalBound;
    const nextRagCaseBound = node.type === 'ragCase' || nearestRagCaseBound;
    const nextRagEvalNode = node.type === 'ragEval' ? node : nearestRagEvalNode;
    const nextRagCaseNode = node.type === 'ragCase' ? node : nearestRagCaseNode;
    const nextRagAnswerContractName =
      node.type === 'ragAnswerContract' ? stringProp(node, 'name') : nearestRagAnswerContractName;
    const nextRagAnswerContractNode = node.type === 'ragAnswerContract' ? node : nearestRagAnswerContractNode;
    const nextRagAnswerContractBound = node.type === 'ragAnswerContract' || nearestRagAnswerContractBound;
    const nextMcpName = node.type === 'mcp' ? stringProp(node, 'name') || '' : nearestMcpName;
    const nextMcpContainer =
      node.type === 'tool' || node.type === 'prompt'
        ? ragMcpContainerInfo(node, rootIndex, node.type === 'tool' ? 'tool' : 'prompt')
        : nearestMcpContainer;

    if (node.type === 'corpus') {
      const name = stringProp(node, 'name');
      if (name) out.corpora.push({ node, rootIndex, name });
    } else if (node.type === 'source') {
      out.sources.push({ node, rootIndex, name: stringProp(node, 'name'), corpusName: nearestCorpusName });
    } else if (node.type === 'chunking') {
      out.chunking.push({
        node,
        rootIndex,
        name: stringProp(node, 'name'),
        corpusName: stringProp(node, 'corpus') || nearestCorpusName,
        sourceName: stringProp(node, 'source'),
      });
    } else if (node.type === 'embed') {
      const name = stringProp(node, 'name');
      const corpusName = stringProp(node, 'corpus') || nearestCorpusName;
      if (name && corpusName) out.embeds.push({ node, rootIndex, name, corpusName });
    } else if (node.type === 'retriever') {
      const name = stringProp(node, 'name');
      const corpusName = stringProp(node, 'corpus');
      if (name && corpusName) {
        out.retrievers.push({ node, rootIndex, name, corpusName, embedName: stringProp(node, 'embed') });
      }
    } else if (node.type === 'rag') {
      const name = stringProp(node, 'name');
      const retrieverName = stringProp(node, 'retriever');
      if (name && retrieverName) out.pipelines.push({ node, rootIndex, name, retrieverName });
    } else if (node.type === 'grounding') {
      out.groundings.push({ node, rootIndex, ragName: stringProp(node, 'rag') || nearestRagName });
    } else if (node.type === 'ragEval') {
      out.evals.push({ node, rootIndex, ragName: stringProp(node, 'rag') || nearestRagName });
    } else if (node.type === 'ragCase') {
      out.cases.push({
        node,
        rootIndex,
        name: stringProp(node, 'name'),
        query: stringProp(node, 'query'),
        ragName: nearestRagName,
        evalName: nearestRagEvalName,
        evalNode: nearestRagEvalNode,
        evalBound: nearestRagEvalBound,
      });
    } else if (node.type === 'ragAssert') {
      out.asserts.push({
        node,
        rootIndex,
        ragName: nearestRagName,
        evalName: nearestRagEvalName,
        caseName: nearestRagCaseName,
        evalNode: nearestRagEvalNode,
        caseNode: nearestRagCaseNode,
        evalBound: nearestRagEvalBound,
        caseBound: nearestRagCaseBound,
      });
    } else if (node.type === 'ragAnswerContract') {
      out.answerContracts.push({
        node,
        rootIndex,
        name: stringProp(node, 'name'),
        ragName: stringProp(node, 'rag') || nearestRagName,
      });
    } else if (node.type === 'answerSpan') {
      out.answerSpans.push({
        node,
        rootIndex,
        contractName: nearestRagAnswerContractName,
        contractNode: nearestRagAnswerContractNode,
        contractBound: nearestRagAnswerContractBound,
      });
    } else if (node.type === 'retrieve') {
      out.mcpRetrievals.push({ node, rootIndex, container: nearestMcpContainer });
    } else if (
      nextMcpName !== undefined &&
      (node.type === 'resource' || node.type === 'tool' || node.type === 'prompt')
    ) {
      const name = stringProp(node, 'name');
      if (name) {
        const kind = node.type === 'resource' ? 'resource' : node.type === 'tool' ? 'tool' : 'prompt';
        const info: RagMcpSymbolInfo = { node, rootIndex, kind, name };
        if (node.type === 'resource') out.mcpResources.push(info);
        else if (node.type === 'tool') out.mcpTools.push(info);
        else out.mcpPrompts.push(info);
      }
    }

    for (const child of node.children ?? [])
      visit(
        child,
        nextCorpusName,
        nextRagName,
        nextRagEvalName,
        nextRagCaseName,
        nextRagEvalBound,
        nextRagCaseBound,
        nextRagEvalNode,
        nextRagCaseNode,
        nextRagAnswerContractName,
        nextRagAnswerContractNode,
        nextRagAnswerContractBound,
        nextMcpContainer,
        nextMcpName,
      );
  }
  visit(root);
}

function ragMcpContainerInfo(node: IRNode, rootIndex: number, kind: 'tool' | 'prompt'): RagMcpContainerInfo {
  const name = stringProp(node, 'name');
  const paramNames = new Set<string>();
  for (const child of node.children ?? []) {
    if (child.type !== 'param') continue;
    const paramName = stringProp(child, 'name');
    if (paramName) paramNames.add(paramName);
  }
  return { node, rootIndex, kind, ...optionalStringValue('name', name), paramNames };
}

function collectRagSourceNamesByCorpus(sources: readonly RagSourceInfo[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const source of sources) {
    if (!source.corpusName || !source.name) continue;
    const names = out.get(source.corpusName) ?? new Set<string>();
    names.add(source.name);
    out.set(source.corpusName, names);
  }
  return out;
}

function collectRagMcpSymbolsByName(symbols: readonly RagMcpSymbolInfo[]): Map<string, RagMcpSymbolInfo[]> {
  const out = new Map<string, RagMcpSymbolInfo[]>();
  for (const symbol of symbols) {
    const matches = out.get(symbol.name) ?? [];
    matches.push(symbol);
    out.set(symbol.name, matches);
  }
  return out;
}

function validateRagUniqueNames(infos: RagInfos, violations: SemanticViolation[]): void {
  validateRagUniqueNameSet('corpus', infos.corpora, violations);
  validateRagUniqueSourceNames(infos.sources, violations);
  validateRagUniqueNameSet('embed', infos.embeds, violations);
  validateRagUniqueNameSet('retriever', infos.retrievers, violations);
  validateRagUniqueNameSet('rag', infos.pipelines, violations);
  validateRagUniqueEvalNames(infos.evals, violations);
  validateRagUniqueCaseNames(infos.cases, violations);
  validateRagUniqueAnswerContractNames(infos.answerContracts, violations);
}

function validateRagUniqueNameSet(
  kind: string,
  infos: readonly { name: string; node: IRNode }[],
  violations: SemanticViolation[],
): void {
  const seen = new Map<string, IRNode>();
  for (const info of infos) {
    const prev = seen.get(info.name);
    if (prev) {
      pushRagViolation(
        violations,
        `rag-duplicate-${kind}-name`,
        info.node,
        `Duplicate RAG ${kind} named '${info.name}' — first defined at line ${prev.loc?.line ?? '?'}.`,
      );
    } else {
      seen.set(info.name, info.node);
    }
  }
}

function validateRagUniqueSourceNames(sources: readonly RagSourceInfo[], violations: SemanticViolation[]): void {
  const seen = new Map<string, IRNode>();
  for (const source of sources) {
    if (!source.name || !source.corpusName) continue;
    const key = `${source.corpusName}:${source.name}`;
    const prev = seen.get(key);
    if (prev) {
      pushRagViolation(
        violations,
        'rag-duplicate-source-name',
        source.node,
        `Duplicate RAG source named '${source.name}' in corpus '${source.corpusName}' — first defined at line ${prev.loc?.line ?? '?'}.`,
      );
    } else {
      seen.set(key, source.node);
    }
  }
}

function validateRagUniqueEvalNames(evals: readonly RagEvalInfo[], violations: SemanticViolation[]): void {
  const seen = new Map<string, IRNode>();
  for (const evaluation of evals) {
    const name = stringProp(evaluation.node, 'name');
    if (!name || !evaluation.ragName) continue;
    const key = `${evaluation.ragName}:${name}`;
    const prev = seen.get(key);
    if (prev) {
      pushRagViolation(
        violations,
        'rag-duplicate-eval-name',
        evaluation.node,
        `Duplicate RAG eval named '${name}' in rag '${evaluation.ragName}' — first defined at line ${prev.loc?.line ?? '?'}.`,
      );
    } else {
      seen.set(key, evaluation.node);
    }
  }
}

function validateRagUniqueCaseNames(cases: readonly RagCaseInfo[], violations: SemanticViolation[]): void {
  const seen = new Map<IRNode, Map<string, IRNode>>();
  for (const evaluationCase of cases) {
    if (!evaluationCase.name || !evaluationCase.evalNode) continue;
    const evalCases = seen.get(evaluationCase.evalNode) ?? new Map<string, IRNode>();
    const prev = evalCases.get(evaluationCase.name);
    if (prev) {
      pushRagViolation(
        violations,
        'rag-duplicate-case-name',
        evaluationCase.node,
        `Duplicate RAG eval case named '${evaluationCase.name}' in eval '${evaluationCase.evalName ?? '?'}' — first defined at line ${prev.loc?.line ?? '?'}.`,
      );
    } else {
      evalCases.set(evaluationCase.name, evaluationCase.node);
      seen.set(evaluationCase.evalNode, evalCases);
    }
  }
}

function validateRagUniqueAnswerContractNames(
  contracts: readonly RagAnswerContractInfo[],
  violations: SemanticViolation[],
): void {
  const seen = new Map<string, IRNode>();
  for (const contract of contracts) {
    if (!contract.name || !contract.ragName) continue;
    const key = `${contract.ragName}:${contract.name}`;
    const prev = seen.get(key);
    if (prev) {
      pushRagViolation(
        violations,
        'rag-duplicate-answer-contract-name',
        contract.node,
        `Duplicate RAG answer contract named '${contract.name}' in rag '${contract.ragName}' — first defined at line ${prev.loc?.line ?? '?'}.`,
      );
    } else {
      seen.set(key, contract.node);
    }
  }
}

function validateRagSource(
  source: RagSourceInfo,
  mcpResourcesByName: ReadonlyMap<string, readonly RagMcpSymbolInfo[]>,
  mcpCallableByName: ReadonlyMap<string, RagMcpSymbolInfo>,
  violations: SemanticViolation[],
): void {
  if (!source.corpusName) {
    pushRagViolation(violations, 'rag-source-missing-corpus', source.node, 'RAG source must be nested under a corpus.');
  }

  const kind = stringProp(source.node, 'kind');
  const resourceName = stringProp(source.node, 'resource');
  if (kind === 'mcp') {
    if (!resourceName) {
      pushRagViolation(
        violations,
        'rag-source-mcp-resource-required',
        source.node,
        'RAG source kind=mcp requires resource=<mcp resource name>.',
      );
    } else {
      const resources = mcpResourcesByName.get(resourceName) ?? [];
      if (resources.length > 1) {
        pushRagViolation(
          violations,
          'rag-source-mcp-resource-ambiguous',
          source.node,
          `RAG source resource '${resourceName}' is ambiguous because multiple MCP resources use that name.`,
        );
      } else if (resources.length === 0) {
        const callable = mcpCallableByName.get(resourceName);
        if (callable) {
          pushRagViolation(
            violations,
            'rag-source-mcp-resource-kind',
            source.node,
            `RAG source resource '${resourceName}' resolves to MCP ${callable.kind}, expected MCP resource.`,
          );
        } else {
          pushRagViolation(
            violations,
            'rag-source-mcp-resource-unknown',
            source.node,
            `RAG source references unknown MCP resource '${resourceName}'.`,
          );
        }
      }
    }
  } else if (resourceName) {
    pushRagViolation(
      violations,
      'rag-source-resource-requires-mcp-kind',
      source.node,
      'RAG source resource=<name> is only valid with kind=mcp.',
    );
  }

  const uri = stringProp(source.node, 'uri');
  if (uri !== undefined && uri.trim() === '') {
    pushRagViolation(
      violations,
      'rag-source-uri-empty',
      source.node,
      "RAG source 'uri=' must be a non-empty document location.",
    );
  }
}

function validateRagChunking(
  chunking: RagChunkingInfo,
  corpusByName: ReadonlyMap<string, RagCorpusInfo>,
  sourceNamesByCorpus: ReadonlyMap<string, ReadonlySet<string>>,
  globalSourceNames: ReadonlySet<string>,
  violations: SemanticViolation[],
): void {
  if (!chunking.corpusName) {
    pushRagViolation(
      violations,
      'rag-chunking-missing-corpus',
      chunking.node,
      'RAG chunking must be nested under a corpus or declare corpus=<name>.',
    );
  }
  if (chunking.corpusName && !corpusByName.has(chunking.corpusName)) {
    pushRagViolation(
      violations,
      'rag-chunking-unknown-corpus',
      chunking.node,
      `RAG chunking references unknown corpus '${chunking.corpusName}'. Declare a corpus before chunking it.`,
    );
  }

  if (chunking.sourceName) {
    const sourceNames = chunking.corpusName ? sourceNamesByCorpus.get(chunking.corpusName) : undefined;
    const sourceKnown = chunking.corpusName
      ? Boolean(sourceNames?.has(chunking.sourceName))
      : globalSourceNames.has(chunking.sourceName);
    if (!sourceKnown) {
      pushRagViolation(
        violations,
        'rag-chunking-unknown-source',
        chunking.node,
        `RAG chunking references unknown source '${chunking.sourceName}'. Declare a named source in the same corpus.`,
      );
    }
  }

  const maxTokens = numberProp(chunking.node, 'maxTokens');
  if (
    invalidNumberProp(chunking.node, 'maxTokens') ||
    (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens <= 0))
  ) {
    pushRagViolation(
      violations,
      'rag-chunking-max-tokens-invalid',
      chunking.node,
      'RAG chunking maxTokens must be a positive integer.',
    );
  }

  const overlap = numberProp(chunking.node, 'overlap');
  if (
    invalidNumberProp(chunking.node, 'overlap') ||
    (overlap !== undefined && (!Number.isInteger(overlap) || overlap < 0))
  ) {
    pushRagViolation(
      violations,
      'rag-chunking-overlap-invalid',
      chunking.node,
      'RAG chunking overlap must be a non-negative integer.',
    );
  } else if (overlap !== undefined && maxTokens !== undefined && overlap >= maxTokens) {
    pushRagViolation(
      violations,
      'rag-chunking-overlap-invalid',
      chunking.node,
      'RAG chunking overlap must be smaller than maxTokens.',
    );
  }
}

function validateRagEmbed(
  embed: RagEmbedInfo,
  corpusByName: ReadonlyMap<string, RagCorpusInfo>,
  violations: SemanticViolation[],
): void {
  if (!corpusByName.has(embed.corpusName)) {
    pushRagViolation(
      violations,
      'rag-embed-unknown-corpus',
      embed.node,
      `RAG embed '${embed.name}' references unknown corpus '${embed.corpusName}'.`,
    );
  }

  const dims = numberProp(embed.node, 'dims');
  if (invalidNumberProp(embed.node, 'dims') || (dims !== undefined && (!Number.isInteger(dims) || dims <= 0))) {
    pushRagViolation(violations, 'rag-embed-dims-invalid', embed.node, 'RAG embed dims must be a positive integer.');
  }
}

function validateRagRetriever(
  retriever: RagRetrieverInfo,
  corpusByName: ReadonlyMap<string, RagCorpusInfo>,
  embedByName: ReadonlyMap<string, RagEmbedInfo>,
  violations: SemanticViolation[],
): void {
  if (!corpusByName.has(retriever.corpusName)) {
    pushRagViolation(
      violations,
      'rag-retriever-unknown-corpus',
      retriever.node,
      `RAG retriever '${retriever.name}' references unknown corpus '${retriever.corpusName}'.`,
    );
  }

  if (retriever.embedName) {
    const embed = embedByName.get(retriever.embedName);
    if (!embed) {
      pushRagViolation(
        violations,
        'rag-retriever-unknown-embed',
        retriever.node,
        `RAG retriever '${retriever.name}' references unknown embed '${retriever.embedName}'.`,
      );
    } else if (embed.corpusName !== retriever.corpusName) {
      pushRagViolation(
        violations,
        'rag-retriever-embed-corpus-mismatch',
        retriever.node,
        `RAG retriever '${retriever.name}' uses embed '${retriever.embedName}' for corpus '${embed.corpusName}', not '${retriever.corpusName}'.`,
      );
    }
  }

  const topK = numberProp(retriever.node, 'topK');
  if (invalidNumberProp(retriever.node, 'topK') || (topK !== undefined && (!Number.isInteger(topK) || topK <= 0))) {
    pushRagViolation(
      violations,
      'rag-retriever-topk-invalid',
      retriever.node,
      'RAG retriever topK must be a positive integer.',
    );
  }

  const minScore = numberProp(retriever.node, 'minScore');
  if (invalidNumberProp(retriever.node, 'minScore') || (minScore !== undefined && (minScore < 0 || minScore > 1))) {
    pushRagViolation(
      violations,
      'rag-retriever-minscore-invalid',
      retriever.node,
      'RAG retriever minScore must be between 0 and 1.',
    );
  }
}

function validateRagPipeline(
  pipeline: RagPipelineInfo,
  retrieverByName: ReadonlyMap<string, RagRetrieverInfo>,
  groundings: readonly RagGroundingInfo[],
  violations: SemanticViolation[],
): void {
  if (!retrieverByName.has(pipeline.retrieverName)) {
    pushRagViolation(
      violations,
      'rag-unknown-retriever',
      pipeline.node,
      `RAG pipeline '${pipeline.name}' references unknown retriever '${pipeline.retrieverName}'.`,
    );
  }

  if (ragBooleanProp(pipeline.node, 'citations')) {
    const hasCitationGrounding = groundings.some(
      (grounding) => grounding.ragName === pipeline.name && ragBooleanProp(grounding.node, 'requireCitations'),
    );
    if (!hasCitationGrounding) {
      pushRagViolation(
        violations,
        'rag-citations-require-grounding',
        pipeline.node,
        `RAG pipeline '${pipeline.name}' requires citations but has no grounding requireCitations=true policy.`,
      );
    }
  }
}

function validateRagGrounding(
  grounding: RagGroundingInfo,
  ragByName: ReadonlyMap<string, RagPipelineInfo>,
  violations: SemanticViolation[],
): void {
  if (!grounding.ragName) {
    pushRagViolation(
      violations,
      'rag-grounding-missing-rag',
      grounding.node,
      'RAG grounding must be nested under a rag pipeline or declare rag=<name>.',
    );
  }
  if (grounding.ragName && !ragByName.has(grounding.ragName)) {
    pushRagViolation(
      violations,
      'rag-grounding-unknown-rag',
      grounding.node,
      `RAG grounding references unknown rag '${grounding.ragName}'.`,
    );
  }

  const maxContext = numberProp(grounding.node, 'maxContext');
  if (
    invalidNumberProp(grounding.node, 'maxContext') ||
    (maxContext !== undefined && (!Number.isInteger(maxContext) || maxContext <= 0))
  ) {
    pushRagViolation(
      violations,
      'rag-grounding-max-context-invalid',
      grounding.node,
      'RAG grounding maxContext must be a positive integer.',
    );
  }
}

function validateRagEval(
  evaluation: RagEvalInfo,
  ragByName: ReadonlyMap<string, RagPipelineInfo>,
  violations: SemanticViolation[],
): void {
  if (!evaluation.ragName) {
    pushRagViolation(
      violations,
      'rag-eval-missing-rag',
      evaluation.node,
      'RAG eval must be nested under a rag pipeline or declare rag=<name>.',
    );
  }
  if (evaluation.ragName && !ragByName.has(evaluation.ragName)) {
    pushRagViolation(
      violations,
      'rag-eval-unknown-rag',
      evaluation.node,
      `RAG eval references unknown rag '${evaluation.ragName}'.`,
    );
  }

  const threshold = numberProp(evaluation.node, 'threshold');
  if (
    invalidNumberProp(evaluation.node, 'threshold') ||
    (threshold !== undefined && (threshold < 0 || threshold > 1))
  ) {
    pushRagViolation(
      violations,
      'rag-eval-threshold-invalid',
      evaluation.node,
      'RAG eval threshold must be between 0 and 1.',
    );
  }

  const mode = stringProp(evaluation.node, 'mode');
  const hasCases = (evaluation.node.children ?? []).some((child) => child.type === 'ragCase');
  if (hasCases && !stringProp(evaluation.node, 'name')) {
    pushRagViolation(
      violations,
      'rag-eval-name-required',
      evaluation.node,
      'RAG eval with ragCase children must declare name=<id> for stable eval facts.',
    );
  }
  if (hasCases && !mode) {
    pushRagViolation(
      violations,
      'rag-eval-mode-required',
      evaluation.node,
      'RAG eval with ragCase children must declare mode=contract.',
    );
  }
  if (mode && mode !== 'contract') {
    pushRagViolation(
      violations,
      'rag-eval-mode-invalid',
      evaluation.node,
      "RAG eval mode only supports 'contract' in this slice.",
    );
  }
}

function validateRagCase(
  evaluationCase: RagCaseInfo,
  citationRequiredRagNames: ReadonlySet<string>,
  violations: SemanticViolation[],
): void {
  if (!evaluationCase.evalBound) {
    pushRagViolation(
      violations,
      'rag-case-missing-eval',
      evaluationCase.node,
      'RAG eval case must be nested under ragEval.',
    );
  }
  if (!evaluationCase.name) {
    pushRagViolation(violations, 'rag-case-name-required', evaluationCase.node, 'RAG eval case requires name=<id>.');
  }
  if (!evaluationCase.query) {
    pushRagViolation(
      violations,
      'rag-case-query-required',
      evaluationCase.node,
      'RAG eval case requires query=<text>.',
    );
  }

  const topK = numberProp(evaluationCase.node, 'topK');
  if (
    invalidNumberProp(evaluationCase.node, 'topK') ||
    (topK !== undefined && (!Number.isInteger(topK) || topK <= 0))
  ) {
    pushRagViolation(
      violations,
      'rag-case-topk-invalid',
      evaluationCase.node,
      'RAG eval case topK must be a positive integer.',
    );
  }

  const minScore = numberProp(evaluationCase.node, 'minScore');
  if (
    invalidNumberProp(evaluationCase.node, 'minScore') ||
    (minScore !== undefined && (minScore < 0 || minScore > 1))
  ) {
    pushRagViolation(
      violations,
      'rag-case-minscore-invalid',
      evaluationCase.node,
      'RAG eval case minScore must be between 0 and 1.',
    );
  }

  const chunkCount = numberProp(evaluationCase.node, 'chunkCount');
  if (
    invalidNumberProp(evaluationCase.node, 'chunkCount') ||
    (chunkCount !== undefined && (!Number.isInteger(chunkCount) || chunkCount < 0))
  ) {
    pushRagViolation(
      violations,
      'rag-case-chunk-count-invalid',
      evaluationCase.node,
      'RAG eval case chunkCount must be a non-negative integer.',
    );
  }

  if (
    stringProp(evaluationCase.node, 'sources') &&
    (!evaluationCase.ragName || !citationRequiredRagNames.has(evaluationCase.ragName))
  ) {
    pushRagViolation(
      violations,
      'rag-case-sources-require-citations',
      evaluationCase.node,
      'RAG eval case sources=<...> requires a citation-grounded rag.',
    );
  }
}

function validateRagAssert(
  assertion: RagAssertInfo,
  citationRequiredRagNames: ReadonlySet<string>,
  violations: SemanticViolation[],
): void {
  if (!assertion.evalBound) {
    pushRagViolation(violations, 'rag-assert-missing-eval', assertion.node, 'RAG assert must be nested under ragEval.');
  }
  if (!assertion.caseBound) {
    pushRagViolation(violations, 'rag-assert-missing-case', assertion.node, 'RAG assert must be nested under ragCase.');
  }

  const kind = stringProp(assertion.node, 'kind');
  if (!kind || !RAG_ASSERTION_KIND_SET.has(kind)) {
    pushRagViolation(
      violations,
      'rag-assert-kind-invalid',
      assertion.node,
      `RAG assert kind must be one of ${RAG_ASSERTION_KINDS.join(', ')}.`,
    );
    return;
  }

  if (
    ['factId', 'chunkHash', 'contains', 'sourceEq', 'sourceGlob'].includes(kind) &&
    !stringProp(assertion.node, 'value')
  ) {
    pushRagViolation(
      violations,
      'rag-assert-value-required',
      assertion.node,
      `RAG assert kind=${kind} requires value=<text>.`,
    );
  }

  const chunkHash = kind === 'chunkHash' ? stringProp(assertion.node, 'value') : undefined;
  if (chunkHash && !/^[a-fA-F0-9]{32,128}$/.test(chunkHash)) {
    pushRagViolation(
      violations,
      'rag-assert-chunk-hash-invalid',
      assertion.node,
      'RAG assert kind=chunkHash value must be a 32-128 character hex hash.',
    );
  }

  if (kind === 'scoreGte' || kind === 'scoreLte') {
    const threshold = numberProp(assertion.node, 'threshold');
    if (threshold === undefined && !invalidNumberProp(assertion.node, 'threshold')) {
      pushRagViolation(
        violations,
        'rag-assert-threshold-required',
        assertion.node,
        `RAG assert kind=${kind} requires threshold=<number>.`,
      );
    } else if (
      invalidNumberProp(assertion.node, 'threshold') ||
      threshold === undefined ||
      threshold < 0 ||
      threshold > 1
    ) {
      pushRagViolation(
        violations,
        'rag-assert-threshold-invalid',
        assertion.node,
        `RAG assert kind=${kind} threshold must be between 0 and 1.`,
      );
    }
  }

  if (
    kind === 'citesRequired' &&
    assertion.caseBound &&
    (!assertion.ragName || !citationRequiredRagNames.has(assertion.ragName))
  ) {
    pushRagViolation(
      violations,
      'rag-assert-citations-require-grounding',
      assertion.node,
      'RAG assert kind=citesRequired requires a citation-grounded rag.',
    );
  }

  if (kind === 'uniqueSourcesGte' || kind === 'chunkCountEq') {
    const count = numberProp(assertion.node, 'count');
    if (invalidNumberProp(assertion.node, 'count') || count === undefined || !Number.isInteger(count) || count < 0) {
      pushRagViolation(
        violations,
        'rag-assert-count-invalid',
        assertion.node,
        `RAG assert kind=${kind} requires a non-negative integer count.`,
      );
    }
  }

  if (kind === 'latencyLte') {
    const valueMs = numberProp(assertion.node, 'valueMs');
    if (
      invalidNumberProp(assertion.node, 'valueMs') ||
      valueMs === undefined ||
      !Number.isInteger(valueMs) ||
      valueMs < 0
    ) {
      pushRagViolation(
        violations,
        'rag-assert-value-ms-invalid',
        assertion.node,
        'RAG assert kind=latencyLte requires a non-negative integer valueMs.',
      );
    }
  }
}

function validateRagAnswerContract(
  contract: RagAnswerContractInfo,
  spans: readonly RagAnswerSpanInfo[],
  ragByName: ReadonlyMap<string, RagPipelineInfo>,
  citationRequiredRagNames: ReadonlySet<string>,
  violations: SemanticViolation[],
): void {
  if (!contract.ragName) {
    pushRagViolation(
      violations,
      'rag-answer-contract-missing-rag',
      contract.node,
      'RAG answer contract must be nested under a rag pipeline or declare rag=<name>.',
    );
  } else if (!ragByName.has(contract.ragName)) {
    pushRagViolation(
      violations,
      'rag-answer-contract-unknown-rag',
      contract.node,
      `RAG answer contract references unknown rag '${contract.ragName}'.`,
    );
  }

  if (!contract.name) {
    pushRagViolation(
      violations,
      'rag-answer-contract-name-required',
      contract.node,
      'RAG answer contract requires name=<id>.',
    );
  }
  if (!stringProp(contract.node, 'query')) {
    pushRagViolation(
      violations,
      'rag-answer-contract-query-required',
      contract.node,
      'RAG answer contract requires query=<text>.',
    );
  }
  if (!stringProp(contract.node, 'answer')) {
    pushRagViolation(
      violations,
      'rag-answer-contract-answer-required',
      contract.node,
      'RAG answer contract requires answer=<text>.',
    );
  }

  const minGroundingCoverage = numberProp(contract.node, 'minGroundingCoverage');
  if (
    invalidNumberProp(contract.node, 'minGroundingCoverage') ||
    (minGroundingCoverage !== undefined && (minGroundingCoverage < 0 || minGroundingCoverage > 1))
  ) {
    pushRagViolation(
      violations,
      'rag-answer-contract-min-grounding-coverage-invalid',
      contract.node,
      'RAG answer contract minGroundingCoverage must be between 0 and 1.',
    );
  }

  validateRagAnswerContractCoverage(contract, spans, minGroundingCoverage, violations);

  if (
    ragBooleanProp(contract.node, 'requireCitations') &&
    (!contract.ragName || !citationRequiredRagNames.has(contract.ragName))
  ) {
    pushRagViolation(
      violations,
      'rag-answer-contract-citations-require-grounding',
      contract.node,
      'RAG answer contract requireCitations=true requires a citation-grounded rag.',
    );
  }
}

function validateRagAnswerContractCoverage(
  contract: RagAnswerContractInfo,
  spans: readonly RagAnswerSpanInfo[],
  minGroundingCoverage: number | undefined,
  violations: SemanticViolation[],
): void {
  const answer = stringProp(contract.node, 'answer');
  if (!answer) return;

  const contractSpans = spans.filter((span) => span.contractNode === contract.node);
  const grounded = new Array(answer.length).fill(false) as boolean[];
  for (const span of contractSpans) {
    const start = numberProp(span.node, 'start');
    const end = numberProp(span.node, 'end');
    if (
      start !== undefined &&
      end !== undefined &&
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end > start &&
      end <= answer.length
    ) {
      for (let index = start; index < end; index += 1) grounded[index] = true;
    } else if (end !== undefined && end > answer.length) {
      pushRagViolation(
        violations,
        'rag-answer-span-range-invalid',
        span.node,
        'RAG answer span end must not exceed the parent answer length.',
      );
    }
  }

  if (minGroundingCoverage === undefined || minGroundingCoverage < 0 || minGroundingCoverage > 1) return;
  const answerChars = countRagAnswerChars(answer);
  const groundedChars = countRagGroundedAnswerChars(answer, grounded);
  const coverage = answerChars === 0 ? 0 : groundedChars / answerChars;
  if (answerChars > 0 && coverage < minGroundingCoverage) {
    pushRagViolation(
      violations,
      'rag-answer-contract-grounding-coverage-insufficient',
      contract.node,
      `RAG answer contract grounding coverage ${coverage.toFixed(3)} is below minGroundingCoverage ${minGroundingCoverage.toFixed(3)}.`,
    );
  }
}

function validateRagAnswerSpan(span: RagAnswerSpanInfo, violations: SemanticViolation[]): void {
  if (!span.contractBound) {
    pushRagViolation(
      violations,
      'rag-answer-span-missing-contract',
      span.node,
      'RAG answer span must be nested under ragAnswerContract.',
    );
  }

  const start = numberProp(span.node, 'start');
  const end = numberProp(span.node, 'end');
  if (
    invalidNumberProp(span.node, 'start') ||
    invalidNumberProp(span.node, 'end') ||
    start === undefined ||
    end === undefined ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start
  ) {
    pushRagViolation(
      violations,
      'rag-answer-span-range-invalid',
      span.node,
      'RAG answer span start/end must be non-negative integers with start < end.',
    );
  }

  if (splitRagList(stringProp(span.node, 'chunks')).length === 0) {
    pushRagViolation(
      violations,
      'rag-answer-span-chunks-required',
      span.node,
      'RAG answer span requires chunks=<chunk-id[,chunk-id...]>.',
    );
  }
}

function validateRagMcpRetrievalDuplicates(
  retrievals: readonly RagMcpRetrievalInfo[],
  violations: SemanticViolation[],
): void {
  const seen = new Map<IRNode, IRNode>();
  for (const retrieval of retrievals) {
    const containerNode = retrieval.container?.node;
    if (!containerNode) continue;
    const prev = seen.get(containerNode);
    if (prev) {
      pushRagViolation(
        violations,
        'mcp-retrieve-duplicate',
        retrieval.node,
        `MCP ${retrieval.container?.kind} '${retrieval.container?.name ?? '<unnamed>'}' cannot declare more than one retrieve binding — first defined at line ${prev.loc?.line ?? '?'}.`,
      );
    } else {
      seen.set(containerNode, retrieval.node);
    }
  }
}

function validateRagMcpRetrieval(
  retrieval: RagMcpRetrievalInfo,
  retrieverByName: ReadonlyMap<string, RagRetrieverInfo>,
  ragByName: ReadonlyMap<string, RagPipelineInfo>,
  citationRequiredRagNames: ReadonlySet<string>,
  violations: SemanticViolation[],
): void {
  if (!retrieval.container) {
    pushRagViolation(
      violations,
      'mcp-retrieve-missing-container',
      retrieval.node,
      'MCP retrieve must be nested under a tool or prompt.',
    );
  }

  const retrieverName = stringProp(retrieval.node, 'retriever');
  const ragName = stringProp(retrieval.node, 'rag');
  if (!retrieverName && !ragName) {
    pushRagViolation(
      violations,
      'mcp-retrieve-target-required',
      retrieval.node,
      'MCP retrieve must declare retriever=<name> or rag=<name>.',
    );
  }
  if (retrieverName && ragName) {
    pushRagViolation(
      violations,
      'mcp-retrieve-target-exclusive',
      retrieval.node,
      'MCP retrieve cannot combine retriever=<name> and rag=<name>.',
    );
  }
  if (retrieverName && !retrieverByName.has(retrieverName)) {
    pushRagViolation(
      violations,
      'mcp-retrieve-unknown-retriever',
      retrieval.node,
      `MCP retrieve references unknown retriever '${retrieverName}'.`,
    );
  }
  if (ragName && !ragByName.has(ragName)) {
    pushRagViolation(
      violations,
      'mcp-retrieve-unknown-rag',
      retrieval.node,
      `MCP retrieve references unknown rag '${ragName}'.`,
    );
  }

  const queryParam = stringProp(retrieval.node, 'queryParam');
  const query = expressionPropText(retrieval.node.props?.query);
  if (!queryParam && !query) {
    pushRagViolation(
      violations,
      'mcp-retrieve-query-required',
      retrieval.node,
      'MCP retrieve must declare queryParam=<param> or query={{...}}.',
    );
  }
  if (queryParam && query) {
    pushRagViolation(
      violations,
      'mcp-retrieve-query-exclusive',
      retrieval.node,
      'MCP retrieve cannot combine queryParam=<param> and query={{...}}.',
    );
  }
  if (queryParam && retrieval.container && !retrieval.container.paramNames.has(queryParam)) {
    pushRagViolation(
      violations,
      'mcp-retrieve-query-param-unknown',
      retrieval.node,
      `MCP retrieve queryParam '${queryParam}' is not declared on ${retrieval.container.kind} '${retrieval.container.name ?? '<unnamed>'}'.`,
    );
  }

  const topK = numberProp(retrieval.node, 'topK');
  if (invalidNumberProp(retrieval.node, 'topK') || (topK !== undefined && (!Number.isInteger(topK) || topK <= 0))) {
    pushRagViolation(
      violations,
      'mcp-retrieve-topk-invalid',
      retrieval.node,
      'MCP retrieve topK must be a positive integer.',
    );
  }

  const minScore = numberProp(retrieval.node, 'minScore');
  if (invalidNumberProp(retrieval.node, 'minScore') || (minScore !== undefined && (minScore < 0 || minScore > 1))) {
    pushRagViolation(
      violations,
      'mcp-retrieve-minscore-invalid',
      retrieval.node,
      'MCP retrieve minScore must be between 0 and 1.',
    );
  }

  if (ragName && ragBooleanPropIsFalse(retrieval.node, 'requireGrounding')) {
    const requiresCitations = citationRequiredRagNames.has(ragName);
    if (requiresCitations) {
      pushRagViolation(
        violations,
        'mcp-retrieve-citations-require-grounding',
        retrieval.node,
        `MCP retrieve references citation-grounded rag '${ragName}' but sets requireGrounding=false.`,
      );
    }
  }

  validateRagMcpRetrievalOutput(retrieval, ragName, citationRequiredRagNames, violations);
}

function validateRagMcpRetrievalOutput(
  retrieval: RagMcpRetrievalInfo,
  ragName: string | undefined,
  citationRequiredRagNames: ReadonlySet<string>,
  violations: SemanticViolation[],
): void {
  const outputShape = stringProp(retrieval.node, 'output');
  const provenance = stringProp(retrieval.node, 'provenance');
  const citationField = stringProp(retrieval.node, 'citationField');
  const sourceField = stringProp(retrieval.node, 'sourceField');
  const scoreField = stringProp(retrieval.node, 'scoreField');
  const hasRequireCitations = Object.hasOwn(retrieval.node.props ?? {}, 'requireCitations');
  const hasOutputField = Boolean(provenance || citationField || sourceField || scoreField);

  if (outputShape === RAG_MCP_RETRIEVE_OUTPUT_ITEM_SHAPE) {
    pushRagViolation(
      violations,
      'mcp-retrieve-output-array-required',
      retrieval.node,
      'MCP retrieve output must be RetrievedChunk[] because retrieval bindings expose ranked context sets.',
    );
  } else if (outputShape && outputShape !== RAG_MCP_RETRIEVE_OUTPUT_SHAPE) {
    pushRagViolation(
      violations,
      'mcp-retrieve-output-unknown',
      retrieval.node,
      `MCP retrieve output '${outputShape}' is not supported; use RetrievedChunk[] for this slice.`,
    );
  }

  if (!outputShape && hasOutputField) {
    pushRagViolation(
      violations,
      'mcp-retrieve-output-field-without-output',
      retrieval.node,
      'MCP retrieve output fields require output=RetrievedChunk[].',
    );
  }
  if (!outputShape && hasRequireCitations) {
    pushRagViolation(
      violations,
      'mcp-retrieve-output-required',
      retrieval.node,
      'MCP retrieve requireCitations=<bool> requires output=RetrievedChunk[].',
    );
  }

  const targetRequiresCitations = ragName ? citationRequiredRagNames.has(ragName) : false;
  if (ragBooleanPropIsFalse(retrieval.node, 'requireCitations') && targetRequiresCitations) {
    pushRagViolation(
      violations,
      'mcp-retrieve-output-citations-cannot-weaken-rag',
      retrieval.node,
      `MCP retrieve references citation-grounded rag '${ragName}' but sets requireCitations=false.`,
    );
  }

  if (outputShape !== RAG_MCP_RETRIEVE_OUTPUT_SHAPE) return;

  const explicitRequiresCitations = ragBooleanProp(retrieval.node, 'requireCitations');
  const effectiveRequiresCitations = explicitRequiresCitations || targetRequiresCitations;
  if (effectiveRequiresCitations && !citationField) {
    pushRagViolation(
      violations,
      'mcp-retrieve-output-citation-field-required',
      retrieval.node,
      'MCP retrieve output requires citationField=<field> when citations are required.',
    );
  }
  if (effectiveRequiresCitations && !sourceField && provenance !== 'source') {
    pushRagViolation(
      violations,
      'mcp-retrieve-output-source-required',
      retrieval.node,
      'MCP retrieve output requires sourceField=<field> or provenance=source when citations are required.',
    );
  }
}

function collectRagCitationRequiredNames(
  pipelines: readonly RagPipelineInfo[],
  groundings: readonly RagGroundingInfo[],
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const pipeline of pipelines) {
    if (ragBooleanProp(pipeline.node, 'citations')) out.add(pipeline.name);
  }
  for (const grounding of groundings) {
    if (grounding.ragName && ragBooleanProp(grounding.node, 'requireCitations')) out.add(grounding.ragName);
  }
  return out;
}

function pushRagViolation(violations: SemanticViolation[], rule: string, node: IRNode, message: string): void {
  violations.push({ rule, nodeType: node.type, message, line: node.loc?.line, col: node.loc?.col });
}

export function collectRagSemanticFacts(root: IRNode | readonly IRNode[]): RagSemanticFacts {
  const roots = Array.isArray(root) ? root : [root];
  const infos = collectRagInfosForRoots(roots);
  const corpusNames = new Set(infos.corpora.map((info) => info.name));
  const embedNames = new Set(infos.embeds.map((info) => info.name));
  const retrieverNames = new Set(infos.retrievers.map((info) => info.name));
  const ragNames = new Set(infos.pipelines.map((info) => info.name));
  const citationRequiredRagNames = collectRagCitationRequiredNames(infos.pipelines, infos.groundings);
  const mcpResourcesByName = collectRagMcpSymbolsByName(infos.mcpResources);
  const mcpCallableNames = new Set([
    ...infos.mcpTools.map((info) => info.name),
    ...infos.mcpPrompts.map((info) => info.name),
  ]);
  const sourceNamesByCorpus = collectRagSourceNamesByCorpus(infos.sources);
  const globalSourceNames = new Set(infos.sources.map((info) => info.name).filter((name): name is string => !!name));

  return {
    corpora: infos.corpora.map((info) => ragCorpusFact(info, infos)),
    retrievers: infos.retrievers.map(ragRetrieverFact),
    pipelines: infos.pipelines.map((info) =>
      ragPipelineFact(
        info,
        infos.groundings,
        infos.evals,
        infos.cases,
        infos.asserts,
        infos.answerContracts,
        infos.answerSpans,
      ),
    ),
    mcpRetrievals: infos.mcpRetrievals.map((info) => ragMcpRetrievalFact(info, citationRequiredRagNames)),
    resourceFeedsCorpora: infos.sources
      .filter(
        (info) =>
          stringProp(info.node, 'kind') === 'mcp' &&
          (mcpResourcesByName.get(stringProp(info.node, 'resource') ?? '')?.length ?? 0) === 1,
      )
      .map(ragResourceFeedFact),
    unresolvedCorpusRefs: sortedUnique([
      ...infos.chunking
        .map((info) => info.corpusName)
        .filter((name): name is string => !!name && !corpusNames.has(name)),
      ...infos.embeds.map((info) => info.corpusName).filter((name) => !corpusNames.has(name)),
      ...infos.retrievers.map((info) => info.corpusName).filter((name) => !corpusNames.has(name)),
    ]),
    unresolvedRetrieverRefs: sortedUnique(
      [
        ...infos.pipelines.map((info) => info.retrieverName),
        ...infos.mcpRetrievals.map((info) => stringProp(info.node, 'retriever')),
      ].filter((name): name is string => !!name && !retrieverNames.has(name)),
    ),
    unresolvedEmbedRefs: sortedUnique(
      infos.retrievers.map((info) => info.embedName).filter((name): name is string => !!name && !embedNames.has(name)),
    ),
    unresolvedRagRefs: sortedUnique(
      [
        ...infos.groundings.map((info) => info.ragName),
        ...infos.evals.map((info) => info.ragName),
        ...infos.answerContracts.map((info) => info.ragName),
        ...infos.mcpRetrievals.map((info) => stringProp(info.node, 'rag')),
      ].filter((name): name is string => !!name && !ragNames.has(name)),
    ),
    unresolvedSourceRefs: sortedUnique(
      infos.chunking
        .filter((info) => {
          if (!info.sourceName) return false;
          const sourceNames = info.corpusName ? sourceNamesByCorpus.get(info.corpusName) : undefined;
          return info.corpusName ? !sourceNames?.has(info.sourceName) : !globalSourceNames.has(info.sourceName);
        })
        .map((info) => info.sourceName)
        .filter((name): name is string => !!name),
    ),
    unresolvedResourceRefs: sortedUnique(
      infos.sources
        .filter((info) => stringProp(info.node, 'kind') === 'mcp')
        .map((info) => stringProp(info.node, 'resource'))
        .filter((name): name is string => !!name && !mcpResourcesByName.has(name) && !mcpCallableNames.has(name)),
    ),
  };
}

function ragCorpusFact(info: RagCorpusInfo, all: RagInfos): RagSemanticCorpusFact {
  return {
    name: info.name,
    ...optionalStringFact(info.node, 'title', 'title'),
    ...optionalStringFact(info.node, 'tenant', 'tenant'),
    ...optionalStringFact(info.node, 'refresh', 'refresh'),
    sources: all.sources.filter((source) => source.corpusName === info.name).map(ragSourceFact),
    chunking: all.chunking.filter((chunking) => chunking.corpusName === info.name).map(ragChunkingFact),
    embeds: all.embeds.filter((embed) => embed.corpusName === info.name).map(ragEmbedFact),
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragSourceFact(info: RagSourceInfo): RagSemanticSourceFact {
  return {
    ...optionalStringValue('name', info.name),
    ...optionalStringValue('corpusName', info.corpusName),
    ...optionalStringFact(info.node, 'kind', 'kind'),
    uri: stringProp(info.node, 'uri') ?? '',
    ...optionalStringFact(info.node, 'resource', 'resourceName'),
    ...optionalStringFact(info.node, 'media', 'media'),
    ...optionalStringFact(info.node, 'acl', 'acl'),
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragResourceFeedFact(info: RagSourceInfo): RagSemanticResourceFeedFact {
  return {
    ...optionalStringValue('corpusName', info.corpusName),
    ...optionalStringValue('sourceName', info.name),
    resourceName: stringProp(info.node, 'resource') ?? '',
    uri: stringProp(info.node, 'uri') ?? '',
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragChunkingFact(info: RagChunkingInfo): RagSemanticChunkingFact {
  return {
    ...optionalStringValue('name', info.name),
    ...optionalStringValue('corpusName', info.corpusName),
    ...optionalStringValue('sourceName', info.sourceName),
    ...optionalStringFact(info.node, 'strategy', 'strategy'),
    ...optionalNumberFact(info.node, 'maxTokens', 'maxTokens'),
    ...optionalNumberFact(info.node, 'overlap', 'overlap'),
    ...optionalStringFact(info.node, 'unit', 'unit'),
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragEmbedFact(info: RagEmbedInfo): RagSemanticEmbedFact {
  return {
    name: info.name,
    corpusName: info.corpusName,
    ...optionalStringFact(info.node, 'model', 'model'),
    ...optionalNumberFact(info.node, 'dims', 'dims'),
    ...optionalStringFact(info.node, 'metric', 'metric'),
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragRetrieverFact(info: RagRetrieverInfo): RagSemanticRetrieverFact {
  return {
    name: info.name,
    corpusName: info.corpusName,
    ...optionalStringValue('embedName', info.embedName),
    ...optionalStringFact(info.node, 'mode', 'mode'),
    ...optionalNumberFact(info.node, 'topK', 'topK'),
    ...optionalNumberFact(info.node, 'minScore', 'minScore'),
    ...optionalStringFact(info.node, 'rerank', 'rerank'),
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragPipelineFact(
  info: RagPipelineInfo,
  groundings: readonly RagGroundingInfo[],
  evals: readonly RagEvalInfo[],
  cases: readonly RagCaseInfo[],
  asserts: readonly RagAssertInfo[],
  answerContracts: readonly RagAnswerContractInfo[],
  answerSpans: readonly RagAnswerSpanInfo[],
): RagSemanticPipelineFact {
  return {
    name: info.name,
    retrieverName: info.retrieverName,
    ...optionalStringFact(info.node, 'prompt', 'prompt'),
    ...optionalStringFact(info.node, 'answer', 'answer'),
    citations: ragBooleanProp(info.node, 'citations'),
    groundings: groundings.filter((grounding) => grounding.ragName === info.name).map(ragGroundingFact),
    evals: evals
      .filter((evaluation) => evaluation.ragName === info.name)
      .map((evaluation) => ragEvalFact(evaluation, cases, asserts)),
    answerContracts: answerContracts
      .filter((contract) => contract.ragName === info.name)
      .map((contract) => ragAnswerContractFact(contract, answerSpans)),
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragGroundingFact(info: RagGroundingInfo): RagSemanticGroundingFact {
  return {
    ...optionalStringFact(info.node, 'name', 'name'),
    ...optionalStringValue('ragName', info.ragName),
    requireCitations: ragBooleanProp(info.node, 'requireCitations'),
    ...optionalStringFact(info.node, 'policy', 'policy'),
    ...optionalNumberFact(info.node, 'maxContext', 'maxContext'),
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragEvalFact(
  info: RagEvalInfo,
  cases: readonly RagCaseInfo[],
  asserts: readonly RagAssertInfo[],
): RagSemanticEvalFact {
  const evalCases = cases.filter((evaluationCase) => evaluationCase.evalNode === info.node);
  const caseFacts = evalCases.map((evaluationCase) => ragEvalCaseFact(evaluationCase, asserts));
  return {
    ...optionalStringFact(info.node, 'name', 'name'),
    ...optionalStringValue('ragName', info.ragName),
    ...optionalStringFact(info.node, 'metric', 'metric'),
    ...optionalNumberFact(info.node, 'threshold', 'threshold'),
    ...optionalStringFact(info.node, 'mode', 'mode'),
    caseCount: caseFacts.length,
    assertCount: caseFacts.reduce((count, evaluationCase) => count + evaluationCase.asserts.length, 0),
    cases: caseFacts,
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragEvalCaseFact(info: RagCaseInfo, asserts: readonly RagAssertInfo[]): RagSemanticEvalCaseFact {
  const caseAsserts = asserts.filter((assertion) => assertion.caseNode === info.node);
  return {
    name: info.name ?? '',
    ...optionalStringValue('ragName', info.ragName),
    ...optionalStringValue('evalName', info.evalName),
    query: info.query ?? '',
    tags: splitRagList(stringProp(info.node, 'tags')),
    expected: {
      ...optionalNumberFact(info.node, 'topK', 'topK'),
      ...optionalNumberFact(info.node, 'minScore', 'minScore'),
      ...optionalNumberFact(info.node, 'chunkCount', 'chunkCount'),
      ...(stringProp(info.node, 'sources') ? { sources: splitRagList(stringProp(info.node, 'sources')) } : {}),
    },
    asserts: caseAsserts.map(ragEvalAssertFact),
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragEvalAssertFact(info: RagAssertInfo): RagSemanticEvalAssertFact {
  const kind = stringProp(info.node, 'kind') ?? '';
  return {
    ...optionalStringValue('ragName', info.ragName),
    ...optionalStringValue('evalName', info.evalName),
    ...optionalStringValue('caseName', info.caseName),
    kind,
    target: ragAssertTarget(kind),
    op: ragAssertOp(kind),
    ...ragAssertValueFact(info.node, kind),
    required: ragBooleanProp(info.node, 'required'),
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragAnswerContractFact(
  info: RagAnswerContractInfo,
  spans: readonly RagAnswerSpanInfo[],
): RagSemanticAnswerContractFact {
  const contractSpans = spans.filter((span) => span.contractNode === info.node);
  return {
    name: info.name ?? '',
    ...optionalStringValue('ragName', info.ragName),
    query: stringProp(info.node, 'query') ?? '',
    answer: stringProp(info.node, 'answer') ?? '',
    ...optionalStringFact(info.node, 'prompt', 'prompt'),
    requireCitations: ragBooleanProp(info.node, 'requireCitations'),
    ...optionalNumberFact(info.node, 'minGroundingCoverage', 'minGroundingCoverage'),
    spans: contractSpans.map(ragAnswerSpanFact),
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragAnswerSpanFact(info: RagAnswerSpanInfo): RagSemanticAnswerSpanFact {
  return {
    start: numberProp(info.node, 'start') ?? 0,
    end: numberProp(info.node, 'end') ?? 0,
    chunkIds: splitRagList(stringProp(info.node, 'chunks')),
    required: ragBooleanProp(info.node, 'required'),
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragAssertTarget(kind: string): RagSemanticEvalAssertFact['target'] {
  if (kind === 'uniqueSourcesGte' || kind === 'chunkCountEq') return 'retrieved-chunks';
  if (kind === 'latencyLte') return 'latency';
  if (kind === 'citesRequired') return 'grounding';
  return 'retrieved-chunk';
}

function ragAssertOp(kind: string): RagSemanticEvalAssertFact['op'] {
  switch (kind) {
    case 'scoreGte':
    case 'uniqueSourcesGte':
      return 'gte';
    case 'scoreLte':
    case 'latencyLte':
      return 'lte';
    case 'contains':
      return 'contains';
    case 'sourceGlob':
      return 'glob';
    case 'citesRequired':
      return 'present';
    default:
      return 'eq';
  }
}

function ragAssertValueFact(node: IRNode, kind: string): Record<string, string | number | boolean> {
  if (kind === 'scoreGte' || kind === 'scoreLte') {
    const threshold = numberProp(node, 'threshold');
    return threshold === undefined ? {} : { value: threshold };
  }
  if (kind === 'uniqueSourcesGte' || kind === 'chunkCountEq') {
    const count = numberProp(node, 'count');
    return count === undefined ? {} : { value: count };
  }
  if (kind === 'latencyLte') {
    const valueMs = numberProp(node, 'valueMs');
    return valueMs === undefined ? {} : { value: valueMs };
  }
  if (kind === 'citesRequired') return { value: true };
  return optionalStringFact(node, 'value', 'value');
}

function splitRagList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function countRagAnswerChars(answer: string): number {
  let count = 0;
  for (let index = 0; index < answer.length; index += 1) {
    if (!/\s/u.test(answer[index] ?? '')) count += 1;
  }
  return count;
}

function countRagGroundedAnswerChars(answer: string, grounded: readonly boolean[]): number {
  let count = 0;
  for (let index = 0; index < answer.length; index += 1) {
    if (grounded[index] && !/\s/u.test(answer[index] ?? '')) count += 1;
  }
  return count;
}

function ragMcpRetrievalFact(
  info: RagMcpRetrievalInfo,
  citationRequiredRagNames: ReadonlySet<string>,
): RagSemanticMcpRetrievalFact {
  const ragName = stringProp(info.node, 'rag');
  const retrieverName = stringProp(info.node, 'retriever');
  const targetKind = ragName ? 'rag' : 'retriever';
  const targetName = ragName || retrieverName || '';
  const outputShape = stringProp(info.node, 'output');
  const targetRequiresCitations = ragName ? citationRequiredRagNames.has(ragName) : false;
  const explicitRequiresCitations = ragBooleanProp(info.node, 'requireCitations');
  return {
    ...(info.container ? { containerKind: info.container.kind, containerName: info.container.name ?? '' } : {}),
    targetKind,
    targetName,
    ...optionalStringFact(info.node, 'name', 'name'),
    ...optionalStringFact(info.node, 'queryParam', 'queryParam'),
    ...optionalStringValue('query', expressionPropText(info.node.props?.query)),
    ...optionalStringFact(info.node, 'as', 'as'),
    ...optionalNumberFact(info.node, 'topK', 'topK'),
    ...optionalNumberFact(info.node, 'minScore', 'minScore'),
    requireGrounding: ragMcpRetrieveRequiresGrounding(info.node, ragName, citationRequiredRagNames),
    ...optionalStringValue('outputShape', outputShape),
    ...(outputShape === RAG_MCP_RETRIEVE_OUTPUT_SHAPE ? { outputItemShape: RAG_MCP_RETRIEVE_OUTPUT_ITEM_SHAPE } : {}),
    ...(Object.hasOwn(info.node.props ?? {}, 'requireCitations')
      ? { requireCitations: explicitRequiresCitations }
      : {}),
    effectiveRequiresCitations: explicitRequiresCitations || targetRequiresCitations,
    ...optionalStringFact(info.node, 'provenance', 'provenance'),
    ...optionalStringFact(info.node, 'citationField', 'citationField'),
    ...optionalStringFact(info.node, 'sourceField', 'sourceField'),
    ...optionalStringFact(info.node, 'scoreField', 'scoreField'),
    contractStatus: ragMcpRetrieveContractStatus(info.node, targetRequiresCitations),
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragMcpRetrieveContractStatus(
  node: IRNode,
  targetRequiresCitations: boolean,
): RagSemanticMcpRetrievalFact['contractStatus'] {
  const outputShape = stringProp(node, 'output');
  const hasRequireCitations = Object.hasOwn(node.props ?? {}, 'requireCitations');
  const hasOutputField = ['provenance', 'citationField', 'sourceField', 'scoreField'].some((prop) =>
    Boolean(stringProp(node, prop)),
  );
  if (!outputShape) return hasOutputField || hasRequireCitations ? 'invalid' : 'absent';
  if (outputShape !== RAG_MCP_RETRIEVE_OUTPUT_SHAPE) return 'invalid';
  if (ragBooleanPropIsFalse(node, 'requireCitations') && targetRequiresCitations) return 'invalid';
  if (ragBooleanProp(node, 'requireCitations') || targetRequiresCitations) {
    const citationField = stringProp(node, 'citationField');
    const sourceField = stringProp(node, 'sourceField');
    const provenance = stringProp(node, 'provenance');
    if (!citationField) return 'invalid';
    if (!sourceField && provenance !== 'source') return 'invalid';
  }
  return 'valid';
}

function ragMcpRetrieveRequiresGrounding(
  node: IRNode,
  ragName: string | undefined,
  citationRequiredRagNames: ReadonlySet<string>,
): boolean {
  if (ragBooleanPropIsFalse(node, 'requireGrounding')) return false;
  if (ragBooleanProp(node, 'requireGrounding')) return true;
  return ragName ? citationRequiredRagNames.has(ragName) : false;
}

function ragLocation(node: IRNode): RagSemanticLocation | undefined {
  return node.loc ? { line: node.loc.line, col: node.loc.col } : undefined;
}

function optionalStringFact(node: IRNode, prop: string, factName: string): Record<string, string> {
  return optionalStringValue(factName, stringProp(node, prop));
}

function optionalStringValue(factName: string, value: string | undefined): Record<string, string> {
  return value ? { [factName]: value } : {};
}

function optionalNumberFact(node: IRNode, prop: string, factName: string): Record<string, number> {
  const value = numberProp(node, prop);
  return value === undefined ? {} : { [factName]: value };
}

function numberProp(node: IRNode, prop: string): number | undefined {
  const raw = node.props?.[prop];
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function invalidNumberProp(node: IRNode, prop: string): boolean {
  const raw = node.props?.[prop];
  if (raw === undefined || raw === null || raw === '') return false;
  if (typeof raw === 'number') return !Number.isFinite(raw);
  if (typeof raw === 'string') return raw.trim() !== '' && !Number.isFinite(Number(raw));
  return true;
}

function ragBooleanProp(node: IRNode, prop: string): boolean {
  const raw = node.props?.[prop];
  return raw === true || (typeof raw === 'string' && raw.trim().toLowerCase() === 'true');
}

function ragBooleanPropIsFalse(node: IRNode, prop: string): boolean {
  const raw = node.props?.[prop];
  return raw === false || (typeof raw === 'string' && raw.trim().toLowerCase() === 'false');
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export type ClassMemberKind = 'field' | 'method' | 'getter' | 'setter';

export interface ClassInfo {
  node: IRNode;
  rootIndex: number;
  name: string;
  baseName?: string;
  implementsNames: string[];
  implementsMalformed: boolean;
  members: ClassMemberInfo[];
  constructors: IRNode[];
}

export interface ClassMemberInfo {
  node: IRNode;
  owner: string;
  name: string;
  kind: ClassMemberKind;
  static: boolean;
  private: boolean;
  async: boolean;
  stream: boolean;
  generator: boolean;
  type?: string;
  returns?: string;
  paramTypes: readonly string[];
  arity: number;
}

interface InterfaceInfo {
  node: IRNode;
  rootIndex: number;
  name: string;
  extendsNames: string[];
  fields: InterfaceFieldInfo[];
  methods: InterfaceMethodInfo[];
}

interface InterfaceFieldInfo {
  name: string;
  type?: string;
  optional: boolean;
  static: boolean;
}

interface InterfaceMethodInfo {
  name: string;
  returns?: string;
  paramTypes: readonly string[];
  arity: number;
  async: boolean;
  stream: boolean;
  generator: boolean;
  static: boolean;
}

interface ClassProtocolShapeContext {
  shapeByName: ReadonlyMap<string, CoreShapeInterfaceFact>;
  diagnosticsByName: ReadonlyMap<string, readonly CoreShapeDiagnostic[]>;
}

interface ClassInterfaceConformanceResult {
  status: Exclude<ClassSemanticProtocolStatus, 'external' | 'unknown-interface'>;
  missingMembers: string[];
  satisfiedMembers: string[];
  missingStaticMembers: string[];
  satisfiedStaticMembers: string[];
  diagnostics: string[];
  unsupportedReasons: string[];
}

const BUILTIN_CLASS_BASES = new Set(['Error']);
export const RAG_MCP_RETRIEVE_OUTPUT_SHAPE = 'RetrievedChunk[]';
export const RAG_MCP_RETRIEVE_OUTPUT_ITEM_SHAPE = 'RetrievedChunk';
const BODY_EXPRESSION_PROPS = [
  'value',
  'expr',
  'target',
  'cond',
  'on',
  'in',
  'from',
  'to',
  'initial',
  'source',
  'sources',
  'cleanup',
  'min',
  'max',
] as const;

function validateClassGraph(root: IRNode, violations: SemanticViolation[]): void {
  validateClassGraphRoots([root], violations);
}

function validateClassGraphRoots(roots: readonly IRNode[], violations: SemanticViolation[]): void {
  const classesByRoot = roots.map((root, rootIndex) => collectClassInfos(root, rootIndex));
  const classes = classesByRoot.flat();
  if (classes.length === 0) return;

  const interfaces = roots.flatMap((root, rootIndex) => collectInterfaceInfos(root, rootIndex));
  const interfaceByName = new Map<string, InterfaceInfo>();
  for (const info of interfaces) {
    if (!interfaceByName.has(info.name)) interfaceByName.set(info.name, info);
  }
  const protocolShapeContext = collectClassProtocolShapeContext(roots);
  const classByName = new Map<string, ClassInfo>();
  const declaredClassNames = new Set<string>();
  for (const info of classes) {
    const prev = classByName.get(info.name);
    if (!prev) {
      classByName.set(info.name, info);
    }
    declaredClassNames.add(info.name);
  }
  const visibleNamesByRoot = roots.map((root) => {
    const visibleNames = collectVisibleClassBaseNames(root);
    for (const className of declaredClassNames) visibleNames.add(className);
    return visibleNames;
  });
  const visibleProtocolNamesByRoot = roots.map((root) => collectVisibleProtocolNames(root));

  for (const info of classes) {
    validateClassBaseReference(info, visibleNamesByRoot[info.rootIndex] ?? declaredClassNames, violations);
    validateClassImplements(
      info,
      interfaceByName,
      visibleProtocolNamesByRoot[info.rootIndex] ?? new Set(),
      protocolShapeContext,
      classByName,
      violations,
    );
    validateClassConstructors(info, violations);
    validateClassMemberConflicts(info, violations);
    validateClassSuperUsage(info, classByName, violations);
    validateClassAbstractMembers(info, classByName, violations);
  }

  validateClassInheritanceCycles(classes, classByName, violations);
  validateClassOverrides(classes, classByName, violations);
  validateClassShapeUsage(classes, classByName, violations);
  validateAbstractInstantiations(roots, classByName, visibleNamesByRoot, violations);
}

export function collectClassInfos(root: IRNode, rootIndex = 0): ClassInfo[] {
  const out: ClassInfo[] = [];
  walkSemanticTree(root, (node) => {
    if (node.type !== 'class') return;
    const name = stringProp(node, 'name');
    if (!name) return;
    out.push({
      node,
      rootIndex,
      name,
      baseName: classBaseName(node.props?.extends),
      implementsNames: classReferenceNames(node.props?.implements, 'class implements='),
      implementsMalformed: classReferenceListMalformed(node.props?.implements, 'class implements='),
      members: collectClassMembers(node, name),
      constructors: (node.children ?? []).filter((child) => child.type === 'constructor'),
    });
  });
  return out;
}

function collectInterfaceInfos(root: IRNode, rootIndex = 0): InterfaceInfo[] {
  const out: InterfaceInfo[] = [];
  walkSemanticTree(root, (node) => {
    if (node.type !== 'interface') return;
    const name = stringProp(node, 'name');
    if (!name) return;
    out.push({
      node,
      rootIndex,
      name,
      extendsNames: classReferenceNames(node.props?.extends, 'interface extends='),
      fields: collectInterfaceFields(node),
      methods: collectInterfaceMethods(node),
    });
  });
  return out;
}

function collectInterfaceFields(node: IRNode): InterfaceFieldInfo[] {
  const fields: InterfaceFieldInfo[] = [];
  for (const child of node.children ?? []) {
    if (child.type !== 'field') continue;
    const name = stringProp(child, 'name');
    if (!name) continue;
    fields.push({
      name,
      ...(stringProp(child, 'type') ? { type: stringProp(child, 'type') } : {}),
      optional: isTrueFlag(child.props?.optional),
      static: isTrueFlag(child.props?.static),
    });
  }
  return fields;
}

function collectInterfaceMethods(node: IRNode): InterfaceMethodInfo[] {
  const methods: InterfaceMethodInfo[] = [];
  for (const child of node.children ?? []) {
    if (child.type !== 'method') continue;
    const name = stringProp(child, 'name');
    if (!name) continue;
    methods.push({
      name,
      ...(stringProp(child, 'returns') ? { returns: stringProp(child, 'returns') } : {}),
      paramTypes: memberParamTypes(child),
      arity: memberArity(child),
      async: isTrueFlag(child.props?.async),
      stream: isTrueFlag(child.props?.stream),
      generator: isTrueFlag(child.props?.generator),
      static: isTrueFlag(child.props?.static),
    });
  }
  return methods;
}

function collectClassProtocolShapeContext(roots: readonly IRNode[]): ClassProtocolShapeContext {
  const facts = collectCoreShapeFacts(roots);
  const shapeByName = new Map<string, CoreShapeInterfaceFact>();
  for (const shape of facts.interfaces) shapeByName.set(shape.name, shape);
  const diagnosticsByName = new Map<string, CoreShapeDiagnostic[]>();
  for (const diagnostic of facts.validationDiagnostics) {
    if (!diagnostic.interfaceName) continue;
    const diagnostics = diagnosticsByName.get(diagnostic.interfaceName) ?? [];
    diagnostics.push(diagnostic);
    diagnosticsByName.set(diagnostic.interfaceName, diagnostics);
  }
  return { shapeByName, diagnosticsByName };
}

function collectClassMembers(node: IRNode, owner: string): ClassMemberInfo[] {
  const members: ClassMemberInfo[] = [];
  for (const child of node.children ?? []) {
    if (!isClassMemberNode(child)) continue;
    const name = stringProp(child, 'name');
    if (!name) continue;
    members.push({
      node: child,
      owner,
      name,
      kind: child.type,
      static: isTrueFlag(child.props?.static),
      private: isTrueFlag(child.props?.private),
      async: isTrueFlag(child.props?.async),
      stream: isTrueFlag(child.props?.stream),
      generator: isTrueFlag(child.props?.generator),
      ...(stringProp(child, 'type') ? { type: stringProp(child, 'type') } : {}),
      ...(stringProp(child, 'returns') ? { returns: stringProp(child, 'returns') } : {}),
      paramTypes: memberParamTypes(child),
      arity: memberArity(child),
    });
  }
  return members;
}

export function collectClassSemanticFacts(root: IRNode | readonly IRNode[]): ClassSemanticFacts {
  const roots = Array.isArray(root) ? root : [root];
  const classes = roots.flatMap((candidate, rootIndex) => collectClassInfos(candidate, rootIndex));
  const interfaces = roots.flatMap((candidate, rootIndex) => collectInterfaceInfos(candidate, rootIndex));
  const classByName = new Map<string, ClassInfo>();
  for (const info of classes) {
    if (!classByName.has(info.name)) classByName.set(info.name, info);
  }
  const interfaceByName = new Map<string, InterfaceInfo>();
  for (const info of interfaces) {
    if (!interfaceByName.has(info.name)) interfaceByName.set(info.name, info);
  }
  const protocolShapeContext = collectClassProtocolShapeContext(roots);
  const visibleNamesByRoot = roots.map((candidate) => collectVisibleClassBaseNames(candidate));
  const visibleProtocolNamesByRoot = roots.map((candidate) => collectVisibleProtocolNames(candidate));

  const inheritanceEdges: ClassSemanticInheritanceEdge[] = [];
  const unresolvedBases = new Set<string>();
  for (const info of classes) {
    if (!info.baseName) continue;
    const resolved =
      classByName.has(info.baseName) || (visibleNamesByRoot[info.rootIndex] ?? BUILTIN_CLASS_BASES).has(info.baseName);
    const builtin = BUILTIN_CLASS_BASES.has(info.baseName);
    inheritanceEdges.push({
      from: info.name,
      to: info.baseName,
      relation: 'extends',
      resolved,
      builtin,
    });
    if (!resolved) unresolvedBases.add(info.baseName);
  }

  const implementsEdges: ClassSemanticImplementsEdge[] = [];
  const unresolvedImplements = new Set<string>();
  for (const info of classes) {
    for (const interfaceName of info.implementsNames) {
      const external =
        !interfaceByName.has(interfaceName) &&
        (visibleProtocolNamesByRoot[info.rootIndex] ?? new Set()).has(interfaceName);
      const resolved = interfaceByName.has(interfaceName) || external;
      implementsEdges.push({
        from: info.name,
        to: interfaceName,
        relation: 'implements',
        resolved,
        external,
      });
      if (!resolved) unresolvedImplements.add(interfaceName);
    }
  }

  return {
    classes: classes.map((info) => classSemanticFact(info, classByName)),
    constructorFacts: classes.map((info) => classConstructorSemanticFact(info)),
    inheritanceEdges,
    implementsEdges,
    overrides: collectClassOverrideFacts(classes, classByName),
    unresolvedBases: [...unresolvedBases].sort(),
    unresolvedImplements: [...unresolvedImplements].sort(),
    protocolConformance: collectClassProtocolConformanceFacts(
      classes,
      interfaceByName,
      visibleProtocolNamesByRoot,
      protocolShapeContext,
      classByName,
    ),
    cycles: collectClassCycleFacts(classes, classByName),
  };
}

function classSemanticFact(info: ClassInfo, classByName: ReadonlyMap<string, ClassInfo>): ClassSemanticClassFact {
  return {
    name: info.name,
    ...(info.baseName ? { baseName: info.baseName } : {}),
    hasConstructor: info.constructors.length > 0,
    constructorCount: info.constructors.length,
    members: info.members.map((member) => classMemberSemanticFact(member)),
    effectiveMembers: effectiveClassMemberFacts(info, classByName),
    ...(info.node.loc ? { loc: semanticLocation(info.node) } : {}),
  };
}

function classConstructorSemanticFact(info: ClassInfo): ClassSemanticConstructorFact {
  const superDiagnostics = constructorSuperDiagnostics(info);
  const superCallCount = info.constructors.reduce(
    (count, ctor) =>
      count + constructorBodyStatements(ctor).reduce((sum, statement) => sum + superCallCountInNode(statement), 0),
    0,
  );
  const declaredFields = declaredInstanceFieldNames(info);
  const declaredFieldSet = new Set(declaredFields);
  const initializedFields = sortedUnique(
    [...fieldInitializerNames(info), ...constructorThisAssignmentNames(info)].filter((name) =>
      declaredFieldSet.has(name),
    ),
  );
  return {
    className: info.name,
    hasConstructor: info.constructors.length > 0,
    constructorCount: info.constructors.length,
    hasBase: Boolean(info.baseName),
    requiresSuper: Boolean(info.baseName) && info.constructors.length > 0,
    superStatus: constructorSuperStatus(info, superDiagnostics),
    superCallCount,
    thisBeforeSuper: superDiagnostics.some((diagnostic) => diagnostic.rule === 'class-constructor-this-before-super'),
    declaredFields,
    initializedFields,
    uninitializedRequiredFields: uninitializedRequiredFieldNames(info, initializedFields),
    provenance: 'static-analysis',
    ...(info.node.loc ? { loc: semanticLocation(info.node) } : {}),
  };
}

function classMemberSemanticFact(
  member: ClassMemberInfo,
  className = member.owner,
  inheritedFrom?: string,
): ClassSemanticMemberFact {
  return {
    className,
    owner: member.owner,
    name: member.name,
    kind: member.kind,
    static: member.static,
    ...(member.private ? { private: true } : {}),
    ...(member.async ? { async: true } : {}),
    ...(member.stream ? { stream: true } : {}),
    ...(member.generator ? { generator: true } : {}),
    ...(member.type ? { type: member.type } : {}),
    ...(member.returns ? { returns: member.returns } : {}),
    ...(member.kind === 'method' && member.paramTypes.length > 0 ? { paramTypes: member.paramTypes } : {}),
    arity: member.arity,
    readable: member.kind === 'field' || member.kind === 'getter' || member.kind === 'method',
    writable: member.kind === 'field' || member.kind === 'setter',
    ...(inheritedFrom ? { inheritedFrom } : {}),
    ...(member.node.loc ? { loc: semanticLocation(member.node) } : {}),
  };
}

function constructorSuperDiagnostics(info: ClassInfo): SemanticViolation[] {
  const violations: SemanticViolation[] = [];
  if (!info.baseName) return violations;
  for (const ctor of info.constructors) validateDerivedConstructorDiscipline(info, ctor, violations);
  return violations;
}

function constructorSuperStatus(
  info: ClassInfo,
  diagnostics: readonly SemanticViolation[],
): ClassSemanticConstructorSuperStatus {
  if (!info.baseName || info.constructors.length === 0) return 'not-required';
  const rules = new Set(diagnostics.map((diagnostic) => diagnostic.rule));
  if (rules.has('class-constructor-this-before-super')) return 'this-before-super';
  if (rules.has('class-constructor-double-super')) return 'double';
  if (rules.has('class-constructor-conditional-super')) return 'conditional';
  if (rules.has('class-constructor-missing-super')) return 'missing';
  return 'satisfied';
}

function declaredInstanceFieldNames(info: ClassInfo): string[] {
  return sortedUnique(
    info.members.filter((member) => member.kind === 'field' && !member.static).map((member) => member.name),
  );
}

function requiredInstanceFieldNames(info: ClassInfo): string[] {
  return sortedUnique(
    info.members
      .filter((member) => member.kind === 'field' && !member.static && !isTrueFlag(member.node.props?.optional))
      .map((member) => member.name),
  );
}

function fieldInitializerNames(info: ClassInfo): string[] {
  return sortedUnique(
    info.members
      .filter(
        (member) =>
          member.kind === 'field' &&
          !member.static &&
          (Object.hasOwn(member.node.props ?? {}, 'value') || Object.hasOwn(member.node.props ?? {}, 'default')),
      )
      .map((member) => member.name),
  );
}

function constructorThisAssignmentNames(info: ClassInfo): string[] {
  if (info.constructors.length === 0) return [];
  const constructorAssignments = info.constructors.map((ctor) => [
    ...definiteThisAssignmentsInStatements(constructorBodyStatements(ctor)),
  ]);
  const [first = [], ...rest] = constructorAssignments;
  return sortedUnique([...rest.reduce((common, names) => setIntersection(common, new Set(names)), new Set(first))]);
}

interface ThisAssignmentPathStates {
  readonly continuing: Set<string>[];
  readonly exited: Set<string>[];
}

function definiteThisAssignmentsInStatements(statements: readonly IRNode[], initial = new Set<string>()): Set<string> {
  const states = thisAssignmentPathStatesInStatements(statements, [new Set(initial)]);
  const [first = new Set<string>(), ...rest] = states.exited.concat(states.continuing);
  return rest.reduce((common, names) => setIntersection(common, names), new Set(first));
}

function thisAssignmentPathStatesInStatements(
  statements: readonly IRNode[],
  initialStates: readonly ReadonlySet<string>[],
): ThisAssignmentPathStates {
  let continuing = initialStates.map((state) => new Set(state));
  const exited: Set<string>[] = [];
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    if (statement.type === 'else') continue;
    const nextContinuing: Set<string>[] = [];
    if (statement.type === 'if') {
      const maybeElse = statements[index + 1]?.type === 'else' ? statements[index + 1] : undefined;
      for (const state of continuing) {
        const thenStates = thisAssignmentPathStatesInStatements(statement.children ?? [], [state]);
        const elseStates = maybeElse
          ? thisAssignmentPathStatesInStatements(maybeElse.children ?? [], [state])
          : { continuing: [new Set(state)], exited: [] };
        nextContinuing.push(...thenStates.continuing, ...elseStates.continuing);
        exited.push(...thenStates.exited, ...elseStates.exited);
      }
      continuing = nextContinuing;
      if (maybeElse) index += 1;
      continue;
    }
    if (statement.type === 'try') {
      const tryStates = thisAssignmentTryPathStates(statement, continuing);
      continuing = tryStates.continuing;
      exited.push(...tryStates.exited);
      continue;
    }
    if (statement.type === 'return') {
      exited.push(...continuing.map((state) => new Set(state)));
      continuing = [];
      continue;
    }
    if (statement.type === 'throw' || statement.type === 'break' || statement.type === 'continue') {
      continuing = [];
      continue;
    }
    if (statement.type === 'while' || statement.type === 'for' || statement.type === 'each') {
      continue;
    }
    for (const state of continuing) {
      const next = new Set(state);
      const directName =
        statement.type === 'assign' && isSimpleAssignment(statement)
          ? thisMemberName(expressionPropText(statement.props?.target))
          : undefined;
      if (directName) next.add(directName);
      nextContinuing.push(next);
    }
    continuing = nextContinuing;
  }
  return { continuing, exited };
}

function thisAssignmentTryPathStates(
  statement: IRNode,
  initialStates: readonly ReadonlySet<string>[],
): ThisAssignmentPathStates {
  const children = statement.children ?? [];
  const catchNode = children.find((child) => child.type === 'catch');
  const finallyNode = children.find((child) => child.type === 'finally');
  const tryChildren = children.filter((child) => child.type !== 'catch' && child.type !== 'finally');
  const tryStates = thisAssignmentPathStatesInStatements(tryChildren, initialStates);
  const catchStates = catchNode
    ? thisAssignmentPathStatesInStatements(catchNode.children ?? [], initialStates)
    : { continuing: [], exited: [] };
  const continuing = [...tryStates.continuing, ...catchStates.continuing];
  const exited = [...tryStates.exited, ...catchStates.exited];
  if (!finallyNode) return { continuing, exited };

  const continuingAfterFinally = thisAssignmentPathStatesInStatements(finallyNode.children ?? [], continuing);
  const exitingAfterFinally = thisAssignmentPathStatesInStatements(finallyNode.children ?? [], exited);
  return {
    continuing: continuingAfterFinally.continuing,
    exited: [...continuingAfterFinally.exited, ...exitingAfterFinally.continuing, ...exitingAfterFinally.exited],
  };
}

function isSimpleAssignment(statement: IRNode): boolean {
  const op = statement.props?.op;
  return op === undefined || op === null || op === '' || op === '=';
}

function setIntersection(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const value of left) {
    if (right.has(value)) out.add(value);
  }
  return out;
}

function uninitializedRequiredFieldNames(info: ClassInfo, initializedFields: readonly string[]): string[] {
  const initialized = new Set(initializedFields);
  return requiredInstanceFieldNames(info).filter((name) => !initialized.has(name));
}

function thisMemberName(text: string | undefined): string | undefined {
  if (!text) return undefined;
  try {
    const value = parseExpression(text);
    if (value.kind === 'member' && value.object.kind === 'ident' && value.object.name === 'this') {
      return value.property;
    }
    if (
      value.kind === 'index' &&
      value.object.kind === 'ident' &&
      value.object.name === 'this' &&
      value.index.kind === 'strLit'
    ) {
      return value.index.value;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function superCallCountInNode(node: IRNode): number {
  let count = 0;
  walkSemanticTreeUntil(node, (candidate) => {
    if (candidate !== node && candidate.type === 'class') return 'stop';
    for (const prop of BODY_EXPRESSION_PROPS) {
      const text = expressionPropText(candidate.props?.[prop]);
      if (!text) continue;
      try {
        count += valueIRSuperConstructorCallCount(parseExpression(text));
      } catch {
        // Unparseable expression text contributes no super() calls.
      }
    }
    return 'continue';
  });
  return count;
}

function valueIRSuperConstructorCallCount(value: ValueIR): number {
  if (value.kind === 'lambda') return 0;
  const own = value.kind === 'call' && value.callee.kind === 'ident' && value.callee.name === 'super' ? 1 : 0;
  return own + valueIRChildren(value).reduce((count, child) => count + valueIRSuperConstructorCallCount(child), 0);
}

function effectiveClassMemberFacts(
  info: ClassInfo,
  classByName: ReadonlyMap<string, ClassInfo>,
  seen: ReadonlySet<string> = new Set(),
): ClassSemanticMemberFact[] {
  const effective = new Map<string, ClassSemanticMemberFact>();
  if (seen.has(info.name) || classInfoParticipatesInCycle(info, classByName)) {
    return info.members.map((member) => classMemberSemanticFact(member, info.name));
  }
  const nextSeen = new Set(seen);
  nextSeen.add(info.name);
  const base = info.baseName ? classByName.get(info.baseName) : undefined;
  if (base) {
    for (const member of effectiveClassMemberFacts(base, classByName, nextSeen)) {
      effective.set(classMemberEffectiveKey(member), {
        ...member,
        className: info.name,
        inheritedFrom: member.inheritedFrom ?? member.owner,
      });
    }
  }
  const ownGroups = new Map<string, ClassMemberInfo[]>();
  for (const member of info.members) {
    const group = ownGroups.get(classMemberShapeKey(member)) ?? [];
    group.push(member);
    ownGroups.set(classMemberShapeKey(member), group);
  }
  for (const [shapeKey, members] of ownGroups) {
    const first = members[0];
    if (!first) continue;
    for (const key of [...effective.keys()]) {
      if (classMemberShapeKey(effective.get(key) ?? first) === shapeKey) effective.delete(key);
    }
    for (const member of members) {
      effective.set(classMemberEffectiveKey(member), classMemberSemanticFact(member, info.name));
    }
  }
  return [...effective.values()];
}

function classMemberShapeKey(member: { readonly static: boolean; readonly name: string }): string {
  return `${member.static ? 'static' : 'instance'}:${member.name}`;
}

function classMemberEffectiveKey(member: {
  readonly static: boolean;
  readonly name: string;
  readonly kind: ClassSemanticMemberKind | ClassMemberKind;
}): string {
  return `${classMemberShapeKey(member)}:${member.kind}`;
}

function classInfoParticipatesInCycle(info: ClassInfo, classByName: ReadonlyMap<string, ClassInfo>): boolean {
  const seen = new Set<string>();
  let current: ClassInfo | undefined = info;
  while (current) {
    if (seen.has(current.name)) return true;
    seen.add(current.name);
    current = current.baseName ? classByName.get(current.baseName) : undefined;
  }
  return false;
}

// ── Abstract-class contract enforcement ──────────────────────────────────────
// KERN owns its abstract contract at the VALIDATOR layer (codegen/runtime stay
// the loud backstop): a concrete class must implement every abstract member it
// inherits, and an abstract class may never be instantiated. The validator runs
// before codegen, so enforcement is parity-free — TS and Python reject the same
// programs by construction.
//
// PR3 convention: an "abstract member" is a handler-less method/getter/setter
// declared under an `abstract=true` class. Fields always carry a value, so they
// are never abstract.

function isAbstractClassNode(node: IRNode): boolean {
  const raw = node.props?.abstract;
  return raw === true || raw === 'true';
}

function memberHasHandler(node: IRNode): boolean {
  return (node.children ?? []).some((child) => child.type === 'handler');
}

interface AbstractObligation {
  readonly name: string;
  readonly kind: ClassMemberKind;
  readonly static: boolean;
  // The nearest abstract ancestor that left this member unimplemented.
  readonly declaredIn: string;
}

function abstractObligationKey(member: {
  readonly static: boolean;
  readonly name: string;
  readonly kind: ClassMemberKind;
}): string {
  return `${member.static ? 'static' : 'instance'}:${member.name}:${member.kind}`;
}

// Walk the lineage base→derived and return the abstract members still owed by
// `info`. Keyed by (static, name, kind) so a getter override never clears the
// sibling setter obligation, and a same-name different-kind member never erases
// an inherited abstract member (the exact soundness hole that drove this off
// `effectiveClassMemberFacts`, which collapses members by name+static only).
function collectAbstractObligations(
  info: ClassInfo,
  classByName: ReadonlyMap<string, ClassInfo>,
  seen: ReadonlySet<string> = new Set(),
): AbstractObligation[] {
  // Inheritance cycles carry their own primary diagnostic; do not also walk a
  // cyclic chain here (it would never terminate cleanly nor add signal).
  if (seen.has(info.name) || classInfoParticipatesInCycle(info, classByName)) return [];
  const nextSeen = new Set(seen);
  nextSeen.add(info.name);
  const obligations = new Map<string, AbstractObligation>();
  const base = info.baseName ? classByName.get(info.baseName) : undefined;
  if (base) {
    for (const obligation of collectAbstractObligations(base, classByName, nextSeen)) {
      obligations.set(abstractObligationKey(obligation), obligation);
    }
  }
  const ownIsAbstract = isAbstractClassNode(info.node);
  for (const member of info.members) {
    if (member.kind === 'field') continue; // fields are never abstract
    const key = abstractObligationKey(member);
    if (memberHasHandler(member.node)) {
      // A concrete definition for this exact (static,name,kind) satisfies the
      // obligation — same-kind only.
      obligations.delete(key);
    } else if (ownIsAbstract) {
      // Handler-less member under an abstract owner declares an obligation.
      obligations.set(key, {
        name: member.name,
        kind: member.kind,
        static: member.static,
        declaredIn: info.name,
      });
    }
    // A handler-less member under a CONCRETE owner neither satisfies nor
    // declares: any inherited obligation stands and is flagged below.
  }
  return [...obligations.values()].sort((a, b) => abstractObligationKey(a).localeCompare(abstractObligationKey(b)));
}

function validateClassAbstractMembers(
  info: ClassInfo,
  classByName: ReadonlyMap<string, ClassInfo>,
  violations: SemanticViolation[],
): void {
  // Abstract classes are allowed to carry (and inherit) abstract members.
  if (isAbstractClassNode(info.node)) return;
  for (const obligation of collectAbstractObligations(info, classByName)) {
    violations.push({
      rule: 'class-abstract-member-unimplemented',
      nodeType: info.node.type,
      message: `Concrete class '${info.name}' must implement abstract ${obligation.kind} '${obligation.name}' inherited from '${obligation.declaredIn}'.`,
      line: info.node.loc?.line,
      col: info.node.loc?.col,
    });
  }
}

// Resolve the class a `new` expression constructs. KERN parses `new` greedily
// (the argument is a full postfix chain), and codegen prefixes `new ` to the
// emitted chain, so KERN follows JS `new` precedence:
//   new Shape           -> Shape
//   new Shape()         -> Shape
//   new Shape().area()  -> Shape   (new binds to Shape(); `.area()` is after)
//   new pkg.Shape()     -> pkg.Shape  (qualified) -> not a bare local class, skip
//   new makeShape()()   -> makeShape (head ident; not a class -> skipped on lookup)
// We descend the spine to the head ident and skip qualified constructors (a head
// reached as a member's object, e.g. `pkg.Shape`).
function newExpressionClassName(argument: ValueIR): string | undefined {
  let node: ValueIR = argument;
  let edge: 'root' | 'callee' | 'object' = 'root';
  while (true) {
    switch (node.kind) {
      case 'ident':
        // A member-object head (`pkg.Shape`) is a qualified constructor; every
        // other head (root, or a called ident) is a bare construction target.
        return edge === 'object' ? undefined : node.name;
      case 'call':
        node = node.callee;
        edge = 'callee';
        continue;
      case 'member':
        node = node.object;
        edge = 'object';
        continue;
      case 'index':
        node = node.object;
        edge = 'object';
        continue;
      case 'nonNull':
        node = node.expression;
        continue;
      default:
        return undefined; // dynamic / non-resolvable constructor
    }
  }
}

// `default` is an executable initializer site (field `default=` and
// `param default=`) that is NOT in BODY_EXPRESSION_PROPS — field initializers
// treat `value` and `default` equivalently and both lower to runtime code, so a
// `new Abstract()` in a default must be checked too. Scanned local to this pass
// so the shared super-detection / shape-usage walks are unaffected. A non-`new`
// default just parses to a harmless expression that matches nothing.
const INSTANTIATION_EXPRESSION_PROPS: readonly string[] = [...BODY_EXPRESSION_PROPS, 'default'];

// ── Enum reverse-index / iteration gate (symmetric, fail-closed) ──────────
//
// KERN enums lower to plain int/str members on BOTH targets — a TS `enum`
// (reverse-map only on NON-const enums) and a Python namespace class (no
// reverse map, no iteration protocol). Two enum operations are therefore NOT
// representable identically and are rejected at compile time on BOTH targets so
// neither silently diverges:
//   1. REVERSE-INDEX  `Status[0]`  — TS non-const enums build a numeric→name
//      reverse map; the Python namespace class has none. (const enums forbid it
//      on TS already.)
//   2. ITERATION      `Object.keys(Status)` / `Object.values(Status)` /
//      `Object.entries(Status)` — TS enumerates BOTH forward and reverse keys;
//      the Python class would enumerate only the forward names (plus dunders).
//
// Scope honesty (documented in the diagnostic): this rejects DYNAMIC-key access
// on enums in v1. Static member access (`Status.Pending`) is unaffected.
const ENUM_REFLECTION_CALLEES: ReadonlySet<string> = new Set(['keys', 'values', 'entries']);

function validateEnumAccess(root: IRNode, violations: SemanticViolation[]): void {
  const enumNames = new Set<string>();
  walkSemanticTree(root, (node) => {
    if (node.type === 'enum') {
      const name = typeof node.props?.name === 'string' ? node.props.name : undefined;
      if (name) enumNames.add(name);
    }
  });
  if (enumNames.size === 0) return;

  // ZERO-FP shadowing guard (kern-codex probe): a value binding of the same
  // name ANYWHERE in the program (`let Status = [10, 20]`) makes `Status[0]`
  // plain indexing in that scope. This pass is scope-blind, so it must be
  // conservative: drop a shadowed name from the gate entirely rather than
  // false-reject legal code. Real scope tracking is a later slice.
  const SHADOWING_DECL_TYPES: ReadonlySet<string> = new Set(['let', 'const', 'param']);
  walkSemanticTree(root, (node) => {
    if (!SHADOWING_DECL_TYPES.has(node.type)) return;
    const name = typeof node.props?.name === 'string' ? node.props.name : undefined;
    if (name) enumNames.delete(name);
  });
  if (enumNames.size === 0) return;

  walkSemanticTree(root, (node) => {
    // An enum `member`'s value prop is an initializer literal, not a body
    // expression — scanning it false-flagged quoted string values like
    // `value="Object.keys(E)"` as enum-iteration (kern-codex probe). Members
    // carry no body expressions, so skip the node entirely.
    if (node.type === 'member') return;
    for (const prop of INSTANTIATION_EXPRESSION_PROPS) {
      const text = expressionPropText(node.props?.[prop]);
      if (!text) continue;
      let value: ValueIR;
      try {
        value = parseExpression(text);
      } catch {
        continue;
      }
      collectEnumAccessViolations(value, node, enumNames, violations);
    }
  });
}

function collectEnumAccessViolations(
  value: ValueIR,
  node: IRNode,
  enumNames: ReadonlySet<string>,
  violations: SemanticViolation[],
): void {
  // Reverse-index: `Status[<anything>]` where the object is a bare enum ident.
  if (value.kind === 'index' && value.object.kind === 'ident' && enumNames.has(value.object.name)) {
    violations.push({
      rule: 'enum-reverse-index',
      nodeType: node.type,
      message: `Reverse-index access on enum '${value.object.name}' (e.g. \`${value.object.name}[...]\`) is not supported in v1 — it diverges between targets (TS builds a numeric→name reverse map; the Python namespace class has none). Use a static member like '${value.object.name}.MemberName' instead.`,
      line: node.loc?.line,
      col: node.loc?.col,
    });
  }
  // Iteration: `Object.keys(Status)` / `.values(...)` / `.entries(...)`.
  if (
    value.kind === 'call' &&
    value.callee.kind === 'member' &&
    value.callee.object.kind === 'ident' &&
    value.callee.object.name === 'Object' &&
    ENUM_REFLECTION_CALLEES.has(value.callee.property)
  ) {
    const firstArg = value.args[0];
    if (firstArg && firstArg.kind === 'ident' && enumNames.has(firstArg.name)) {
      violations.push({
        rule: 'enum-iteration',
        nodeType: node.type,
        message: `Enum iteration via \`Object.${value.callee.property}(${firstArg.name})\` is not supported in v1 — it diverges between targets (TS enumerates both forward and reverse-map keys; the Python namespace class enumerates only forward member names). Dynamic-key access on enums is not available in v1.`,
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }
  for (const child of valueIRChildren(value)) {
    collectEnumAccessViolations(child, node, enumNames, violations);
  }
}

// Module-wide pass: reject `new <AbstractClass>(...)` anywhere — including inside
// the abstract class's own static factory (KERN matches TS: abstract is not
// self-instantiable). Conservative by design — non-ident callees, names not
// resolving to a visible local class, and (consistent with every other
// class-name resolution in this validator) names rebound by a local binding are
// not pursued; the validator does not track lexical shadowing for any class
// reference, so abstract instantiation follows the same name+visibility rule.
// Multi-root note: visibleNamesByRoot unions every root's declared class names
// (as extends/implements resolution already does), so this resolves classes
// across roots; all production callers validate a single root, so the
// cross-root union is not a false-positive surface in practice.
function validateAbstractInstantiations(
  roots: readonly IRNode[],
  classByName: ReadonlyMap<string, ClassInfo>,
  visibleNamesByRoot: readonly ReadonlySet<string>[],
  violations: SemanticViolation[],
): void {
  roots.forEach((root, rootIndex) => {
    const visible = visibleNamesByRoot[rootIndex];
    walkSemanticTree(root, (node) => {
      for (const prop of INSTANTIATION_EXPRESSION_PROPS) {
        const text = expressionPropText(node.props?.[prop]);
        if (!text) continue;
        let value: ValueIR;
        try {
          value = parseExpression(text);
        } catch {
          continue;
        }
        collectAbstractInstantiations(value, node, visible, classByName, violations);
      }
    });
  });
}

function collectAbstractInstantiations(
  value: ValueIR,
  node: IRNode,
  visible: ReadonlySet<string> | undefined,
  classByName: ReadonlyMap<string, ClassInfo>,
  violations: SemanticViolation[],
): void {
  if (value.kind === 'new') {
    const name = newExpressionClassName(value.argument);
    if (name && (!visible || visible.has(name))) {
      const target = classByName.get(name);
      if (target && isAbstractClassNode(target.node)) {
        violations.push({
          rule: 'class-abstract-instantiation',
          nodeType: node.type,
          message: `Cannot instantiate abstract class '${name}'.`,
          line: node.loc?.line,
          col: node.loc?.col,
        });
      }
    }
  }
  for (const child of valueIRChildren(value)) {
    collectAbstractInstantiations(child, node, visible, classByName, violations);
  }
}

function collectClassOverrideFacts(
  classes: readonly ClassInfo[],
  classByName: ReadonlyMap<string, ClassInfo>,
): ClassSemanticOverrideFact[] {
  const overrides: ClassSemanticOverrideFact[] = [];
  for (const info of classes) {
    for (const member of info.members) {
      const baseMember = findBaseMember(info, member, classByName);
      if (!baseMember) continue;
      overrides.push({
        className: info.name,
        memberName: member.name,
        static: member.static,
        kind: member.kind,
        arity: member.arity,
        baseClassName: baseMember.owner,
        baseKind: baseMember.kind,
        baseArity: baseMember.arity,
        status: classOverrideStatus(member, baseMember, classByName),
        ...(member.node.loc ? { loc: semanticLocation(member.node) } : {}),
      });
    }
  }
  return overrides;
}

function classOverrideStatus(
  member: ClassMemberInfo,
  baseMember: ClassMemberInfo,
  classByName: ReadonlyMap<string, ClassInfo>,
): ClassSemanticOverrideStatus {
  if (!sameOverrideKind(member, baseMember)) return 'kind-mismatch';
  if (member.kind === 'method' && baseMember.kind === 'method' && member.arity !== baseMember.arity) {
    return 'arity-mismatch';
  }
  const variance = checkOverrideVariance(member, baseMember, classByName);
  if (variance) return variance;
  return 'compatible';
}

/**
 * Liskov substitutability check for a member override against its base member.
 *
 * Runs ONLY when kinds are strictly equal (method/method, getter/getter,
 * setter/setter). Mixed accessor pairs (getter overriding setter, or vice
 * versa) and fields return null (skip) to preserve existing behavior. For
 * methods, it assumes arity has already matched (arity-mismatch fires first).
 *
 * Variance rules:
 *  - Return position is COVARIANT: an override may narrow the return type
 *    (override.returns must be a subtype of base.returns). A non-subtype is a
 *    'return-mismatch'.
 *  - Param positions are CONTRAVARIANT: an override may widen a param type
 *    (base.paramTypes[i] must be a subtype of override.paramTypes[i]). A
 *    non-subtype is a 'param-mismatch'.
 *
 * 'unknown' subtype results (gradual typing — primitives, unannotated, or
 * non-class names) are skipped, so the check produces zero false positives.
 */
export function checkOverrideVariance(
  member: ClassMemberInfo,
  baseMember: ClassMemberInfo,
  classByName: ReadonlyMap<string, ClassInfo>,
): 'return-mismatch' | 'param-mismatch' | null {
  if (member.kind !== baseMember.kind) return null;
  if (member.kind === 'field') return null;
  if (member.kind === 'method') {
    if (member.arity !== baseMember.arity) return null;
    if (isNominalSubtype(member.returns, baseMember.returns, classByName) === false) {
      return 'return-mismatch';
    }
    for (let index = 0; index < member.paramTypes.length; index += 1) {
      if (isNominalSubtype(baseMember.paramTypes[index], member.paramTypes[index], classByName) === false) {
        return 'param-mismatch';
      }
    }
    return null;
  }
  if (member.kind === 'getter') {
    if (isNominalSubtype(member.returns, baseMember.returns, classByName) === false) {
      return 'return-mismatch';
    }
    return null;
  }
  // setter: param position 0 only, same contravariant direction.
  if (isNominalSubtype(baseMember.paramTypes[0], member.paramTypes[0], classByName) === false) {
    return 'param-mismatch';
  }
  return null;
}

/**
 * Nominal subtype check: is `sub` a (non-strict) subtype of `sup`?
 *  - undefined on either side → 'unknown' (gradual: caller skips).
 *  - sub === sup → true.
 *  - either name not a known class in classByName → 'unknown' (primitives /
 *    external / unresolved types are not compared).
 *  - else cycle-safe walk of sub's baseName chain; reaching sup → true; chain
 *    ends or cycles without reaching sup → false.
 */
export function isNominalSubtype(
  sub: string | undefined,
  sup: string | undefined,
  classByName: ReadonlyMap<string, ClassInfo>,
): true | false | 'unknown' {
  if (sub === undefined || sup === undefined) return 'unknown';
  if (sub === sup) return true;
  if (!classByName.has(sub) || !classByName.has(sup)) return 'unknown';
  let current = classByName.get(sub);
  const visited = new Set<string>();
  while (current) {
    if (current.name === sup) return true;
    if (visited.has(current.name)) return false;
    visited.add(current.name);
    current = current.baseName ? classByName.get(current.baseName) : undefined;
  }
  return false;
}

function collectClassCycleFacts(
  classes: readonly ClassInfo[],
  classByName: ReadonlyMap<string, ClassInfo>,
): readonly (readonly string[])[] {
  const cycles: string[][] = [];
  const emitted = new Set<string>();
  for (const info of classes) {
    const path: string[] = [];
    const seen = new Set<string>();
    let current: ClassInfo | undefined = info;
    while (current) {
      if (seen.has(current.name)) {
        const cycleStart = path.indexOf(current.name);
        const cycleNames = path.slice(cycleStart);
        const cycleKey = normalizedCycleKey(cycleNames);
        if (!emitted.has(cycleKey)) {
          emitted.add(cycleKey);
          cycles.push([...cycleNames, current.name]);
        }
        break;
      }
      seen.add(current.name);
      path.push(current.name);
      current = current.baseName ? classByName.get(current.baseName) : undefined;
    }
  }
  return cycles;
}

function collectClassProtocolConformanceFacts(
  classes: readonly ClassInfo[],
  interfaceByName: ReadonlyMap<string, InterfaceInfo>,
  visibleProtocolNamesByRoot: readonly ReadonlySet<string>[],
  protocolShapeContext: ClassProtocolShapeContext,
  classByName: ReadonlyMap<string, ClassInfo>,
): ClassSemanticProtocolConformanceFact[] {
  const facts: ClassSemanticProtocolConformanceFact[] = [];
  for (const info of classes) {
    for (const interfaceName of info.implementsNames) {
      const protocol = interfaceByName.get(interfaceName);
      if (!protocol) {
        const visible = (visibleProtocolNamesByRoot[info.rootIndex] ?? new Set()).has(interfaceName);
        facts.push({
          className: info.name,
          interfaceName,
          status: visible ? 'external' : 'unknown-interface',
          missingMembers: [],
          satisfiedMembers: [],
          missingStaticMembers: [],
          satisfiedStaticMembers: [],
          ...(info.node.loc ? { loc: semanticLocation(info.node) } : {}),
        });
        continue;
      }
      const result = classInterfaceConformance(info, protocol, protocolShapeContext, classByName, interfaceByName);
      facts.push({
        className: info.name,
        interfaceName,
        status: result.status,
        missingMembers: result.missingMembers,
        satisfiedMembers: result.satisfiedMembers,
        missingStaticMembers: result.missingStaticMembers,
        satisfiedStaticMembers: result.satisfiedStaticMembers,
        ...(result.diagnostics.length > 0 ? { diagnostics: result.diagnostics } : {}),
        ...(result.unsupportedReasons.length > 0 ? { unsupportedReasons: result.unsupportedReasons } : {}),
        ...(info.node.loc ? { loc: semanticLocation(info.node) } : {}),
      });
    }
  }
  return facts;
}

function classInterfaceConformance(
  info: ClassInfo,
  protocol: InterfaceInfo,
  protocolShapeContext: ClassProtocolShapeContext,
  classByName: ReadonlyMap<string, ClassInfo>,
  interfaceByName: ReadonlyMap<string, InterfaceInfo>,
): ClassInterfaceConformanceResult {
  const shape = protocolShapeContext.shapeByName.get(protocol.name);
  const diagnostics = (protocolShapeContext.diagnosticsByName.get(protocol.name) ?? []).map(
    (diagnostic) => diagnostic.code,
  );
  if (diagnostics.length > 0) {
    return {
      status: 'invalid-interface',
      missingMembers: [],
      satisfiedMembers: [],
      missingStaticMembers: [],
      satisfiedStaticMembers: [],
      diagnostics: sortedUnique(diagnostics),
      unsupportedReasons: [],
    };
  }
  if (shape && (shape.indexers.length > 0 || !shape.validatorAvailable)) {
    return {
      status: 'unsupported-protocol',
      missingMembers: [],
      satisfiedMembers: [],
      missingStaticMembers: [],
      satisfiedStaticMembers: [],
      diagnostics: [],
      unsupportedReasons: sortedUnique([
        ...shape.unsupportedReasons,
        ...(shape.indexers.length > 0 ? ['indexer'] : []),
      ]),
    };
  }
  const effectiveMembers = effectiveClassMemberFacts(info, classByName);
  const fields = effectiveInterfaceFields(protocol, interfaceByName);
  const requiredFields = fields.filter((field) => !field.optional && !field.static);
  const requiredStaticFields = fields.filter((field) => !field.optional && field.static);
  const requiredMethods = effectiveInterfaceMethods(protocol, interfaceByName);
  const requiredInstanceMethods = requiredMethods.filter((method) => !method.static);
  const requiredStaticMethods = requiredMethods.filter((method) => method.static);
  const missingMembers: string[] = [];
  const satisfiedMembers: string[] = [];
  const missingStaticMembers: string[] = [];
  const satisfiedStaticMembers: string[] = [];
  for (const field of requiredFields) {
    if (classHasReadableMember(effectiveMembers, field, false)) {
      satisfiedMembers.push(field.name);
    } else {
      missingMembers.push(field.name);
    }
  }
  for (const field of requiredStaticFields) {
    if (classHasReadableMember(effectiveMembers, field, true)) {
      satisfiedStaticMembers.push(field.name);
    } else {
      missingStaticMembers.push(field.name);
    }
  }
  for (const method of requiredInstanceMethods) {
    if (classHasCallableMethod(effectiveMembers, method, false)) {
      satisfiedMembers.push(method.name);
    } else {
      missingMembers.push(method.name);
    }
  }
  for (const method of requiredStaticMethods) {
    if (classHasCallableMethod(effectiveMembers, method, true)) {
      satisfiedStaticMembers.push(method.name);
    } else {
      missingStaticMembers.push(method.name);
    }
  }
  const missing = sortedUnique(missingMembers);
  const satisfied = sortedUnique(satisfiedMembers);
  const missingStatic = sortedUnique(missingStaticMembers);
  const satisfiedStatic = sortedUnique(satisfiedStaticMembers);
  return {
    status: missing.length > 0 || missingStatic.length > 0 ? 'missing-members' : 'satisfied',
    missingMembers: missing,
    satisfiedMembers: satisfied,
    missingStaticMembers: missingStatic,
    satisfiedStaticMembers: satisfiedStatic,
    diagnostics: [],
    unsupportedReasons: [],
  };
}

function effectiveInterfaceFields(
  protocol: InterfaceInfo,
  interfaceByName: ReadonlyMap<string, InterfaceInfo>,
  seen: ReadonlySet<string> = new Set(),
): InterfaceFieldInfo[] {
  if (seen.has(protocol.name)) return [];
  const nextSeen = new Set(seen);
  nextSeen.add(protocol.name);
  const fields = new Map<string, InterfaceFieldInfo>();
  for (const baseName of protocol.extendsNames) {
    const base = interfaceByName.get(baseName);
    if (!base) continue;
    for (const field of effectiveInterfaceFields(base, interfaceByName, nextSeen)) {
      fields.set(interfaceMemberShapeKey(field), field);
    }
  }
  for (const field of protocol.fields) fields.set(interfaceMemberShapeKey(field), field);
  return [...fields.values()];
}

function effectiveInterfaceMethods(
  protocol: InterfaceInfo,
  interfaceByName: ReadonlyMap<string, InterfaceInfo>,
  seen: ReadonlySet<string> = new Set(),
): InterfaceMethodInfo[] {
  if (seen.has(protocol.name)) return [];
  const nextSeen = new Set(seen);
  nextSeen.add(protocol.name);
  const methods = new Map<string, InterfaceMethodInfo>();
  for (const baseName of protocol.extendsNames) {
    const base = interfaceByName.get(baseName);
    if (!base) continue;
    for (const method of effectiveInterfaceMethods(base, interfaceByName, nextSeen)) {
      methods.set(interfaceMemberShapeKey(method), method);
    }
  }
  for (const method of protocol.methods) methods.set(interfaceMemberShapeKey(method), method);
  return [...methods.values()];
}

function interfaceMemberShapeKey(member: { readonly name: string; readonly static: boolean }): string {
  return `${member.static ? 'static' : 'instance'}:${member.name}`;
}

function classHasReadableMember(
  members: readonly ClassSemanticMemberFact[],
  field: { readonly name: string; readonly type?: string },
  staticOnly: boolean,
): boolean {
  return members.some((member) => {
    if (member.name !== field.name || member.static !== staticOnly || member.private) return false;
    if (member.kind !== 'field' && member.kind !== 'getter') return false;
    const actualType = member.kind === 'getter' ? member.returns : member.type;
    return !field.type || actualType === field.type;
  });
}

function classHasCallableMethod(
  members: readonly ClassSemanticMemberFact[],
  method: InterfaceMethodInfo,
  staticOnly: boolean,
): boolean {
  return members.some((member) => {
    if (member.name !== method.name || member.static !== staticOnly || member.private || member.kind !== 'method') {
      return false;
    }
    if (member.arity !== method.arity) return false;
    if (!methodParamTypesCompatible(member.paramTypes ?? [], method.paramTypes)) return false;
    if ((member.async === true) !== method.async) return false;
    if ((member.stream === true) !== method.stream) return false;
    if ((member.generator === true) !== method.generator) return false;
    return methodReturnTypesCompatible(
      member.returns,
      {
        async: member.async === true,
        stream: member.stream === true,
        generator: member.generator === true,
      },
      method.returns,
      method,
    );
  });
}

function methodParamTypesCompatible(actual: readonly string[], expected: readonly string[]): boolean {
  return expected.every((type, index) => !type || normalizeProtocolType(actual[index]) === normalizeProtocolType(type));
}

function normalizeProtocolType(type: string | undefined): string {
  return compactProtocolTypeWhitespace(type);
}

function compactProtocolTypeWhitespace(type: string | undefined): string {
  let out = '';
  let quote: '"' | "'" | '`' | null = null;
  for (let index = 0; index < (type ?? '').length; index += 1) {
    const ch = (type ?? '')[index];
    if (quote !== null) {
      out += ch;
      if (ch === '\\' && index + 1 < (type ?? '').length) out += (type ?? '')[++index];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }
    if (!/\s/.test(ch)) out += ch;
  }
  return out;
}

function methodReturnTypesCompatible(
  actual: string | undefined,
  actualFlags: { readonly async: boolean; readonly stream: boolean; readonly generator: boolean },
  expected: string | undefined,
  expectedFlags: { readonly async: boolean; readonly stream: boolean; readonly generator: boolean },
): boolean {
  return normalizeMethodReturnType(actual, actualFlags) === normalizeMethodReturnType(expected, expectedFlags);
}

function normalizeMethodReturnType(
  returns: string | undefined,
  flags: { readonly async: boolean; readonly stream: boolean; readonly generator: boolean },
): string {
  if (flags.stream) {
    if (returns?.startsWith('AsyncGenerator<')) return returns;
    return `AsyncGenerator<${returns || 'unknown'}>`;
  }
  if (flags.generator) {
    if (returns?.startsWith('Generator<') || returns?.startsWith('AsyncGenerator<')) return returns;
    return `${flags.async ? 'AsyncGenerator' : 'Generator'}<${returns || 'unknown'}>`;
  }
  return !returns || returns === 'void' ? 'void' : returns;
}

function semanticLocation(node: IRNode): ClassSemanticLocation | undefined {
  return node.loc ? { line: node.loc.line, col: node.loc.col } : undefined;
}

function isClassMemberNode(node: IRNode): node is IRNode & { type: ClassMemberKind } {
  return node.type === 'field' || node.type === 'method' || node.type === 'getter' || node.type === 'setter';
}

function validateClassBaseReference(
  info: ClassInfo,
  visibleNames: ReadonlySet<string>,
  violations: SemanticViolation[],
): void {
  if (!info.baseName) return;
  if (visibleNames.has(info.baseName) || BUILTIN_CLASS_BASES.has(info.baseName)) return;
  violations.push({
    rule: 'class-extends-unknown',
    nodeType: 'class',
    message: `Class '${info.name}' extends unknown base '${info.baseName}'. Declare or import the base class before extending it.`,
    line: info.node.loc?.line,
    col: info.node.loc?.col,
  });
}

function validateClassImplements(
  info: ClassInfo,
  interfaceByName: ReadonlyMap<string, InterfaceInfo>,
  visibleProtocolNames: ReadonlySet<string>,
  protocolShapeContext: ClassProtocolShapeContext,
  classByName: ReadonlyMap<string, ClassInfo>,
  violations: SemanticViolation[],
): void {
  if (info.implementsMalformed) {
    violations.push({
      rule: 'class-implements-invalid-reference-list',
      nodeType: 'class',
      message: `Class '${info.name}' has an invalid implements= reference list. Use a comma-separated list of interface names.`,
      line: info.node.loc?.line,
      col: info.node.loc?.col,
    });
  }
  for (const interfaceName of info.implementsNames) {
    const protocol = interfaceByName.get(interfaceName);
    if (!protocol) {
      if (!visibleProtocolNames.has(interfaceName)) {
        violations.push({
          rule: 'class-implements-unknown',
          nodeType: 'class',
          message: `Class '${info.name}' implements unknown interface '${interfaceName}'. Declare or import the interface before implementing it.`,
          line: info.node.loc?.line,
          col: info.node.loc?.col,
        });
      }
      continue;
    }
    const conformance = classInterfaceConformance(info, protocol, protocolShapeContext, classByName, interfaceByName);
    if (conformance.status === 'invalid-interface') {
      violations.push({
        rule: 'class-implements-invalid-interface',
        nodeType: 'class',
        message: `Class '${info.name}' implements invalid interface '${interfaceName}' (${conformance.diagnostics.join(', ')}). Fix the interface shape before relying on protocol conformance.`,
        line: info.node.loc?.line,
        col: info.node.loc?.col,
      });
      continue;
    }
    if (conformance.status === 'unsupported-protocol') {
      violations.push({
        rule: 'class-implements-unsupported-protocol',
        nodeType: 'class',
        message: `Class '${info.name}' implements interface '${interfaceName}' whose shape is not class-satisfiable in protocol v1 (${conformance.unsupportedReasons.join(', ')}).`,
        line: info.node.loc?.line,
        col: info.node.loc?.col,
      });
      continue;
    }
    if (conformance.missingMembers.length === 0 && conformance.missingStaticMembers.length === 0) continue;
    const missingParts = [
      ...(conformance.missingMembers.length > 0
        ? [`instance member(s): ${conformance.missingMembers.join(', ')}`]
        : []),
      ...(conformance.missingStaticMembers.length > 0
        ? [`static member(s): ${conformance.missingStaticMembers.join(', ')}`]
        : []),
    ];
    violations.push({
      rule: 'class-implements-missing-member',
      nodeType: 'class',
      message: `Class '${info.name}' does not satisfy interface '${interfaceName}'. Missing readable ${missingParts.join('; ')}.`,
      line: info.node.loc?.line,
      col: info.node.loc?.col,
    });
  }
}

function validateClassConstructors(info: ClassInfo, violations: SemanticViolation[]): void {
  if (info.constructors.length <= 1) return;
  for (const extra of info.constructors.slice(1)) {
    violations.push({
      rule: 'class-single-constructor-only',
      nodeType: 'constructor',
      message: `Class '${info.name}' declares more than one constructor. KERN classes have exactly one construction path.`,
      line: extra.loc?.line,
      col: extra.loc?.col,
    });
  }
}

function validateClassMemberConflicts(info: ClassInfo, violations: SemanticViolation[]): void {
  const seen = new Map<string, ClassMemberInfo[]>();
  for (const member of info.members) {
    const key = `${member.static ? 'static' : 'instance'}:${member.name}`;
    const prev = seen.get(key) ?? [];
    const next = [...prev, member];
    if (isAllowedMemberGroup(next)) {
      seen.set(key, next);
      continue;
    }
    const first = prev[0] ?? member;
    violations.push({
      rule: 'class-member-conflict',
      nodeType: member.node.type,
      message: `Class '${info.name}' has conflicting ${member.static ? 'static' : 'instance'} member '${member.name}' (${first.kind} and ${member.kind}). Use one field/method/accessor surface per name.`,
      line: member.node.loc?.line,
      col: member.node.loc?.col,
    });
    seen.set(key, next);
  }
}

function validateClassSuperUsage(
  info: ClassInfo,
  classByName: ReadonlyMap<string, ClassInfo>,
  violations: SemanticViolation[],
): void {
  const hasBase = Boolean(info.baseName);
  const argRequiringBaseName = hasBase ? argRequiringEffectiveBaseName(info, classByName) : undefined;
  for (const ctor of info.constructors) {
    if (hasBase) {
      validateDerivedConstructorSuper(info, ctor, argRequiringBaseName, violations);
    }
    if (!hasBase && nodeBodyUsesSuper(ctor)) {
      violations.push({
        rule: 'class-super-without-base',
        nodeType: 'constructor',
        message: `Class '${info.name}' uses \`super\` but does not extend a base class.`,
        line: ctor.loc?.line,
        col: ctor.loc?.col,
      });
    }
  }

  if (!hasBase) {
    for (const member of info.members) {
      if (!nodeBodyUsesSuper(member.node)) continue;
      violations.push({
        rule: 'class-super-without-base',
        nodeType: member.node.type,
        message: `Class '${info.name}' member '${member.name}' uses \`super\` but the class does not extend a base class.`,
        line: member.node.loc?.line,
        col: member.node.loc?.col,
      });
    }
  }
}

type ConstructorSuperState = 'uninit' | 'init' | 'maybe';

interface ConstructorDisciplineContext {
  info: ClassInfo;
  violations: SemanticViolation[];
  sawSuper: boolean;
  emittedConditionalSuper: boolean;
}

interface ConstructorAnalysis {
  state: ConstructorSuperState;
  sawSuper: boolean;
}

// DESCRIPTIVE analyzer — feeds the `superStatus` substrate fact (via
// `constructorSuperDiagnostics`), NOT user-facing violations. It still classifies
// an omitted super as `missing` and a pre-super `this` access as `this-before-super`
// so the FACT keeps describing the constructor's structure faithfully. The
// user-facing legality judgment lives in `validateDerivedConstructorSuper`, which
// applies KERN's Option-C semantics on top of this description.
function validateDerivedConstructorDiscipline(info: ClassInfo, ctor: IRNode, violations: SemanticViolation[]): void {
  const ctx: ConstructorDisciplineContext = {
    info,
    violations,
    sawSuper: false,
    emittedConditionalSuper: false,
  };
  const analysis = analyzeConstructorStatements(constructorBodyStatements(ctor), 'uninit', ctx);
  if (analysis.state !== 'init') {
    if (ctx.sawSuper) {
      emitConstructorConditionalSuper(ctx, ctor);
    } else {
      violations.push({
        rule: 'class-constructor-missing-super',
        nodeType: 'constructor',
        message: `Class '${info.name}' extends '${info.baseName}' but its constructor does not call \`super(...)\`. Derived constructors must initialize the base class explicitly.`,
        line: ctor.loc?.line,
        col: ctor.loc?.col,
      });
    }
  }
}

/**
 * User-facing derived-constructor validation under KERN's Option-C super
 * semantics. The mode is decided by the canonical `hasDirectSuperCtorCall`
 * predicate — shared verbatim with the runtime and both codegen targets so all
 * four layers agree on whether a constructor opted into explicit-super mode:
 *
 *  - No direct `super(...)` call (implicit mode): KERN injects base init at
 *    constructor entry, so omitting super is LEGAL and `this`/super-member access
 *    is always safe. The only error is when the base constructor REQUIRES
 *    arguments — an arg-less implicit super cannot satisfy it.
 *  - A direct `super(...)` call exists (explicit mode): the author owns its
 *    placement, so the full discipline applies — reject double-super,
 *    conditional-super (not on every path), and `this`/super before super.
 *
 * `class-constructor-missing-super` is intentionally unreachable here: an omitted
 * super is no longer an error, and an explicit super means a direct call exists.
 */
function validateDerivedConstructorSuper(
  info: ClassInfo,
  ctor: IRNode,
  argRequiringBaseName: string | undefined,
  violations: SemanticViolation[],
): void {
  if (!hasDirectSuperCtorCall(ctor)) {
    if (argRequiringBaseName) {
      // Name the class whose constructor actually requires args — which may be a
      // transitive ancestor reached through constructor-less bases, not the
      // immediate base — so the diagnostic points the author at the real source.
      violations.push({
        rule: 'class-constructor-implicit-super-needs-args',
        nodeType: 'constructor',
        message: `Class '${info.name}' omits \`super(...)\` but base class '${argRequiringBaseName}' has a constructor that requires arguments. Call \`super(...)\` explicitly to pass them.`,
        line: ctor.loc?.line,
        col: ctor.loc?.col,
      });
    }
    return;
  }
  // Explicit-super mode: replay the discipline analysis. Its walk emits
  // double-super / this-before-super as side effects; the tail covers "super
  // present but not on every path" (conditional-super).
  const ctx: ConstructorDisciplineContext = {
    info,
    violations,
    sawSuper: false,
    emittedConditionalSuper: false,
  };
  const analysis = analyzeConstructorStatements(constructorBodyStatements(ctor), 'uninit', ctx);
  if (analysis.state !== 'init') emitConstructorConditionalSuper(ctx, ctor);
}

/**
 * The name of the EFFECTIVE base class whose constructor an implicit no-arg
 * `super()` would reach and fail to satisfy — i.e. the first ancestor that
 * declares a constructor with a required (no-default) parameter — or `undefined`
 * when implicit init succeeds. The effective base ctor is found by walking up the
 * inheritance chain through constructor-less bases, exactly as the runtime does:
 * `initializeClassLayer` forwards `[]` through a base that has no constructor
 * (`base && !ctor`) to ITS base, so the first ancestor that actually declares a
 * constructor is the one invoked with no args. Checking only the immediate base
 * would let `C extends B extends A` (B ctor-less, A arg-requiring) pass validation
 * yet throw at runtime — re-creating the validator/runtime split this
 * reconciliation closes. Returning the name (not a bool) lets the diagnostic point
 * at the real source rather than the immediate base. Mirrors the runtime's
 * required-arg rule (a param is required unless it carries a `value`/`default`); a
 * chain with no constructor anywhere (or an unresolved base) needs no args.
 */
function argRequiringEffectiveBaseName(
  info: ClassInfo,
  classByName: ReadonlyMap<string, ClassInfo>,
): string | undefined {
  const seen = new Set<string>();
  let current = info.baseName ? classByName.get(info.baseName) : undefined;
  while (current && !seen.has(current.name)) {
    seen.add(current.name);
    const ctor = current.constructors[0];
    if (ctor) {
      const requiresArgs = (ctor.children ?? []).some(
        (child) =>
          child.type === 'param' &&
          !Object.hasOwn(child.props ?? {}, 'value') &&
          !Object.hasOwn(child.props ?? {}, 'default'),
      );
      return requiresArgs ? current.name : undefined;
    }
    // Constructor-less base: the runtime forwards [] to its base — keep walking.
    current = current.baseName ? classByName.get(current.baseName) : undefined;
  }
  return undefined;
}

function analyzeConstructorStatements(
  statements: readonly IRNode[],
  initialState: ConstructorSuperState,
  ctx: ConstructorDisciplineContext,
): ConstructorAnalysis {
  let state = initialState;
  let sawSuper = false;
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    if (statement.type === 'else') continue;
    const maybeElse =
      statement.type === 'if' && statements[index + 1]?.type === 'else' ? statements[index + 1] : undefined;
    const result = analyzeConstructorStatement(statement, maybeElse, state, ctx);
    state = result.state;
    sawSuper = sawSuper || result.sawSuper;
    if (maybeElse) index += 1;
  }
  return { state, sawSuper };
}

function analyzeConstructorStatement(
  statement: IRNode,
  maybeElse: IRNode | undefined,
  state: ConstructorSuperState,
  ctx: ConstructorDisciplineContext,
): ConstructorAnalysis {
  if (statement.type === 'class') return { state, sawSuper: false };
  const directSuper = directSuperConstructorCall(statement);
  if (directSuper) {
    scanValueIRForPreSuperAccess(directSuper, state, ctx, statement);
    ctx.sawSuper = true;
    if (state === 'init' || state === 'maybe' || directSuper.args.some(valueIRCallsSuperConstructor)) {
      emitConstructorDoubleSuper(ctx, statement);
    }
    if (state === 'maybe') emitConstructorConditionalSuper(ctx, statement);
    return { state: 'init', sawSuper: true };
  }
  if (statement.type === 'if') return analyzeConstructorIf(statement, maybeElse, state, ctx);

  const sawSuper = scanConstructorStatementExpressions(statement, state, ctx);
  if (sawSuper && state === 'init') emitConstructorDoubleSuper(ctx, statement);
  if (sawSuper && state !== 'init') emitConstructorConditionalSuper(ctx, statement);
  return { state, sawSuper };
}

function analyzeConstructorIf(
  statement: IRNode,
  maybeElse: IRNode | undefined,
  state: ConstructorSuperState,
  ctx: ConstructorDisciplineContext,
): ConstructorAnalysis {
  const cond = expressionPropText(statement.props?.cond);
  if (cond) scanExpressionForConstructorEffects(cond, state, ctx, statement);
  const thenResult = analyzeConstructorStatements(statement.children ?? [], state, ctx);
  const elseResult = maybeElse
    ? analyzeConstructorStatements(maybeElse.children ?? [], state, ctx)
    : { state, sawSuper: false };
  const merged = mergeConstructorStates(thenResult.state, elseResult.state);
  const sawSuper = thenResult.sawSuper || elseResult.sawSuper;
  if (sawSuper && merged !== 'init') emitConstructorConditionalSuper(ctx, statement);
  return { state: merged, sawSuper };
}

function mergeConstructorStates(left: ConstructorSuperState, right: ConstructorSuperState): ConstructorSuperState {
  if (left === 'init' && right === 'init') return 'init';
  if (left === 'uninit' && right === 'uninit') return 'uninit';
  return 'maybe';
}

function constructorBodyStatements(node: IRNode): IRNode[] {
  const handler = node.children?.find((child) => child.type === 'handler');
  const body = handler ? (handler.children ?? []) : (node.children ?? []);
  return body.filter((child) => child.type !== 'param' && child.type !== 'decorator');
}

function directSuperConstructorCall(node: IRNode): Extract<ValueIR, { kind: 'call' }> | undefined {
  if (node.type !== 'do') return undefined;
  const text = expressionPropText(node.props?.value);
  if (!text) return undefined;
  try {
    const value = parseExpression(text);
    return value.kind === 'call' && value.callee.kind === 'ident' && value.callee.name === 'super' ? value : undefined;
  } catch {
    return undefined;
  }
}

function scanConstructorStatementExpressions(
  node: IRNode,
  state: ConstructorSuperState,
  ctx: ConstructorDisciplineContext,
): boolean {
  let sawSuper = false;
  walkSemanticTreeUntil(node, (candidate) => {
    if (candidate !== node && candidate.type === 'class') return 'stop';
    for (const prop of BODY_EXPRESSION_PROPS) {
      const text = expressionPropText(candidate.props?.[prop]);
      if (!text) continue;
      sawSuper = scanExpressionForConstructorEffects(text, state, ctx, candidate) || sawSuper;
    }
    return 'continue';
  });
  return sawSuper;
}

function scanExpressionForConstructorEffects(
  text: string,
  state: ConstructorSuperState,
  ctx: ConstructorDisciplineContext,
  node: IRNode,
): boolean {
  try {
    const value = parseExpression(text);
    scanValueIRForPreSuperAccess(value, state, ctx, node);
    const sawSuper = valueIRCallsSuperConstructor(value);
    if (sawSuper) ctx.sawSuper = true;
    return sawSuper;
  } catch {
    return false;
  }
}

function scanValueIRForPreSuperAccess(
  value: ValueIR,
  state: ConstructorSuperState,
  ctx: ConstructorDisciplineContext,
  node: IRNode,
): void {
  if (state === 'init') return;
  if (!valueIRUsesThisOrSuperMember(value)) return;
  ctx.violations.push({
    rule: 'class-constructor-this-before-super',
    nodeType: node.type,
    message: `Class '${ctx.info.name}' constructor uses \`this\` or \`super\` member access before \`super(...)\`. Derived constructors must initialize the base class first.`,
    line: node.loc?.line,
    col: node.loc?.col,
  });
}

function emitConstructorDoubleSuper(ctx: ConstructorDisciplineContext, node: IRNode): void {
  ctx.violations.push({
    rule: 'class-constructor-double-super',
    nodeType: node.type,
    message: `Class '${ctx.info.name}' constructor calls \`super(...)\` more than once. Derived constructors may initialize the base class once.`,
    line: node.loc?.line,
    col: node.loc?.col,
  });
}

function emitConstructorConditionalSuper(ctx: ConstructorDisciplineContext, node: IRNode): void {
  if (ctx.emittedConditionalSuper) return;
  ctx.emittedConditionalSuper = true;
  ctx.violations.push({
    rule: 'class-constructor-conditional-super',
    nodeType: node.type,
    message: `Class '${ctx.info.name}' constructor must call \`super(...)\` definitely on every path before using derived state. Move \`super(...)\` to a straight-line statement or cover every branch.`,
    line: node.loc?.line,
    col: node.loc?.col,
  });
}

function validateClassInheritanceCycles(
  classes: readonly ClassInfo[],
  classByName: ReadonlyMap<string, ClassInfo>,
  violations: SemanticViolation[],
): void {
  const emitted = new Set<string>();
  for (const info of classes) {
    const path: string[] = [];
    const seen = new Set<string>();
    let current: ClassInfo | undefined = info;
    while (current) {
      if (seen.has(current.name)) {
        const cycleStart = path.indexOf(current.name);
        const cycleNames = path.slice(cycleStart);
        const cycleKey = normalizedCycleKey(cycleNames);
        const cycle = [...cycleNames, current.name].join(' -> ');
        if (!emitted.has(cycleKey)) {
          emitted.add(cycleKey);
          violations.push({
            rule: 'class-inheritance-cycle',
            nodeType: 'class',
            message: `Class inheritance cycle detected: ${cycle}.`,
            line: current.node.loc?.line,
            col: current.node.loc?.col,
          });
        }
        break;
      }
      seen.add(current.name);
      path.push(current.name);
      current = current.baseName ? classByName.get(current.baseName) : undefined;
    }
  }
}

function validateClassOverrides(
  classes: readonly ClassInfo[],
  classByName: ReadonlyMap<string, ClassInfo>,
  violations: SemanticViolation[],
): void {
  for (const info of classes) {
    for (const member of info.members) {
      const baseMember = findBaseMember(info, member, classByName);
      if (!baseMember) continue;
      if (!sameOverrideKind(member, baseMember)) {
        violations.push({
          rule: 'class-override-kind-mismatch',
          nodeType: member.node.type,
          message: `Class '${info.name}' member '${member.name}' overrides base ${baseMember.kind} with ${member.kind}. Overrides must preserve field/method/accessor kind.`,
          line: member.node.loc?.line,
          col: member.node.loc?.col,
        });
        continue;
      }
      if (member.kind === 'method' && baseMember.kind === 'method' && member.arity !== baseMember.arity) {
        violations.push({
          rule: 'class-override-arity-mismatch',
          nodeType: member.node.type,
          message: `Class '${info.name}' method '${member.name}' overrides a base method with ${baseMember.arity} parameter(s), but declares ${member.arity}.`,
          line: member.node.loc?.line,
          col: member.node.loc?.col,
        });
      }
      const variance = checkOverrideVariance(member, baseMember, classByName);
      if (variance === 'return-mismatch') {
        violations.push({
          rule: 'class-override-return-mismatch',
          nodeType: member.node.type,
          message: `Class '${info.name}' member '${member.name}' overrides a base member returning '${baseMember.returns}' with return type '${member.returns}'. Overrides must be covariant in their return type (the override's return must be a subtype of the base's).`,
          line: member.node.loc?.line,
          col: member.node.loc?.col,
        });
        continue;
      }
      if (variance === 'param-mismatch') {
        violations.push({
          rule: 'class-override-param-mismatch',
          nodeType: member.node.type,
          message: `Class '${info.name}' member '${member.name}' narrows a parameter type when overriding a base member. Overrides must be contravariant in their parameter types (the override's parameter must be a supertype of the base's).`,
          line: member.node.loc?.line,
          col: member.node.loc?.col,
        });
      }
    }
  }
}

type ClassShapeAccessKind = 'read' | 'write';

function validateClassShapeUsage(
  classes: readonly ClassInfo[],
  classByName: ReadonlyMap<string, ClassInfo>,
  violations: SemanticViolation[],
): void {
  for (const info of classes) {
    for (const ctor of info.constructors) validateClassShapeNode(info, ctor, false, classByName, violations);
    for (const member of info.members)
      validateClassShapeNode(info, member.node, member.static, classByName, violations);
  }
}

function validateClassShapeNode(
  info: ClassInfo,
  node: IRNode,
  staticContext: boolean,
  classByName: ReadonlyMap<string, ClassInfo>,
  violations: SemanticViolation[],
): void {
  walkSemanticTreeUntil(node, (candidate) => {
    if (candidate !== node && candidate.type === 'class') return 'stop';
    if (candidate.type === 'assign') {
      const target = expressionPropText(candidate.props?.target);
      if (target && validateClassShapeTarget(info, candidate, target, staticContext, classByName, violations)) {
        const value = expressionPropText(candidate.props?.value);
        if (value) validateClassShapeExpression(info, candidate, value, staticContext, classByName, violations);
        return 'continue';
      }
    }
    for (const prop of BODY_EXPRESSION_PROPS) {
      const text = expressionPropText(candidate.props?.[prop]);
      if (!text) continue;
      validateClassShapeExpression(info, candidate, text, staticContext, classByName, violations);
    }
    return 'continue';
  });
}

function validateClassShapeTarget(
  info: ClassInfo,
  node: IRNode,
  text: string,
  staticContext: boolean,
  classByName: ReadonlyMap<string, ClassInfo>,
  violations: SemanticViolation[],
): boolean {
  try {
    const value = parseExpression(text);
    if (value.kind !== 'member') return false;
    if (value.object.kind !== 'ident' || (value.object.name !== 'this' && value.object.name !== 'super')) return false;
    validateClassShapeAccess(
      info,
      node,
      value.object.name,
      value.property,
      'write',
      staticContext,
      classByName,
      violations,
    );
    return true;
  } catch {
    return false;
  }
}

function validateClassShapeExpression(
  info: ClassInfo,
  node: IRNode,
  text: string,
  staticContext: boolean,
  classByName: ReadonlyMap<string, ClassInfo>,
  violations: SemanticViolation[],
): void {
  try {
    validateClassShapeValueIR(info, node, parseExpression(text), staticContext, classByName, violations);
  } catch {
    return;
  }
}

function validateClassShapeValueIR(
  info: ClassInfo,
  node: IRNode,
  value: ValueIR,
  staticContext: boolean,
  classByName: ReadonlyMap<string, ClassInfo>,
  violations: SemanticViolation[],
): void {
  if (value.kind === 'member' && value.object.kind === 'ident') {
    if (value.object.name === 'this' || value.object.name === 'super') {
      validateClassShapeAccess(
        info,
        node,
        value.object.name,
        value.property,
        'read',
        staticContext,
        classByName,
        violations,
      );
    }
  }
  for (const child of valueIRChildren(value)) {
    validateClassShapeValueIR(info, node, child, staticContext, classByName, violations);
  }
}

function validateClassShapeAccess(
  info: ClassInfo,
  node: IRNode,
  receiver: 'this' | 'super',
  property: string,
  accessKind: ClassShapeAccessKind,
  staticContext: boolean,
  classByName: ReadonlyMap<string, ClassInfo>,
  violations: SemanticViolation[],
): void {
  const start = receiver === 'super' ? (info.baseName ? classByName.get(info.baseName) : undefined) : info;
  if (!start) return;
  const member = findClassShapeMember(start, property, staticContext, classByName, accessKind);
  if (!member) {
    violations.push({
      rule: 'class-member-undeclared',
      nodeType: node.type,
      message: `Class '${info.name}' ${receiver}.${property} is not declared on the ${staticContext ? 'static' : 'instance'} class shape.`,
      line: node.loc?.line,
      col: node.loc?.col,
    });
    return;
  }
  if (accessKind === 'read' && member.kind === 'setter') {
    violations.push({
      rule: 'class-member-read-not-readable',
      nodeType: node.type,
      message: `Class '${info.name}' reads setter-only ${receiver}.${property}. Add a getter or read a declared field.`,
      line: node.loc?.line,
      col: node.loc?.col,
    });
  }
  if (accessKind === 'write' && (member.kind === 'getter' || member.kind === 'method')) {
    violations.push({
      rule: 'class-member-write-not-writable',
      nodeType: node.type,
      message: `Class '${info.name}' writes non-writable ${receiver}.${property}. Declare a field or setter for writes.`,
      line: node.loc?.line,
      col: node.loc?.col,
    });
  }
}

function findClassShapeMember(
  info: ClassInfo,
  property: string,
  staticContext: boolean,
  classByName: ReadonlyMap<string, ClassInfo>,
  accessKind: ClassShapeAccessKind,
): ClassMemberInfo | undefined {
  const precedence: readonly ClassMemberKind[] =
    accessKind === 'read' ? ['field', 'getter', 'method', 'setter'] : ['field', 'setter', 'getter', 'method'];
  for (const kind of precedence) {
    const found = info.members.find(
      (member) => member.name === property && member.static === staticContext && member.kind === kind,
    );
    if (found) return found;
  }
  const base = info.baseName ? classByName.get(info.baseName) : undefined;
  return base ? findClassShapeMember(base, property, staticContext, classByName, accessKind) : undefined;
}

function normalizedCycleKey(cycleNames: readonly string[]): string {
  if (cycleNames.length === 0) return '';
  let best = cycleNames.join('\0');
  for (let index = 1; index < cycleNames.length; index++) {
    const rotated = [...cycleNames.slice(index), ...cycleNames.slice(0, index)].join('\0');
    if (rotated < best) best = rotated;
  }
  return best;
}

function findBaseMember(
  info: ClassInfo,
  member: ClassMemberInfo,
  classByName: ReadonlyMap<string, ClassInfo>,
): ClassMemberInfo | undefined {
  let current = info.baseName ? classByName.get(info.baseName) : undefined;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.name)) return undefined;
    visited.add(current.name);
    const found = current.members.find(
      (candidate) => candidate.name === member.name && candidate.static === member.static,
    );
    if (found) return found;
    current = current.baseName ? classByName.get(current.baseName) : undefined;
  }
  return undefined;
}

function sameOverrideKind(member: ClassMemberInfo, baseMember: ClassMemberInfo): boolean {
  if (isAccessorPair(member, baseMember)) return true;
  return member.kind === baseMember.kind;
}

function isAccessorPair(a: ClassMemberInfo, b: ClassMemberInfo): boolean {
  return (a.kind === 'getter' && b.kind === 'setter') || (a.kind === 'setter' && b.kind === 'getter');
}

function isAllowedMemberGroup(members: readonly ClassMemberInfo[]): boolean {
  if (members.length <= 1) return true;
  if (members.length > 2) return false;
  if (!members.every((member) => member.kind === 'getter' || member.kind === 'setter')) return false;
  return isAccessorPair(members[0], members[1]);
}

function collectVisibleClassBaseNames(root: IRNode): Set<string> {
  const names = new Set<string>(BUILTIN_CLASS_BASES);
  walkSemanticTree(root, (node) => {
    const name = stringProp(node, 'name');
    if (name && isVisibleClassBaseDeclaration(node.type)) names.add(name);
    if (node.type === 'import') {
      for (const binding of importLocalBindings(node)) names.add(binding.name);
    }
    if (node.type === 'use') {
      for (const child of node.children ?? []) {
        if (child.type !== 'from') continue;
        if (!isUseClassBaseBinding(child)) continue;
        const localName = stringProp(child, 'as') ?? stringProp(child, 'name');
        if (localName) names.add(localName);
      }
    }
  });
  return names;
}

function collectVisibleProtocolNames(root: IRNode): Set<string> {
  const names = new Set<string>();
  walkSemanticTree(root, (node) => {
    const name = stringProp(node, 'name');
    if (name && node.type === 'interface') names.add(name);
    if (node.type === 'import') {
      for (const binding of importLocalBindings(node)) names.add(binding.name);
    }
    if (node.type === 'use') {
      for (const child of node.children ?? []) {
        if (child.type !== 'from') continue;
        const kind = stringProp(child, 'kind');
        if (kind && kind !== 'interface' && kind !== 'type') continue;
        const localName = stringProp(child, 'as') ?? stringProp(child, 'name');
        if (localName) names.add(localName);
      }
    }
  });
  return names;
}

function isVisibleClassBaseDeclaration(nodeType: string): boolean {
  return nodeType === 'class' || nodeType === 'error';
}

function isUseClassBaseBinding(node: IRNode): boolean {
  const kind = stringProp(node, 'kind');
  return !kind || kind === 'class' || kind === 'error';
}

function memberArity(node: IRNode): number {
  const childParams = node.children?.filter((child) => child.type === 'param').length ?? 0;
  if (childParams > 0) return childParams;
  const params = node.props?.params;
  if (typeof params !== 'string' || !params.trim()) return 0;
  try {
    return splitSemanticParamList(params, `${node.type} params=`).length;
  } catch {
    return 0;
  }
}

function memberParamTypes(node: IRNode): string[] {
  const childParams = node.children?.filter((child) => child.type === 'param') ?? [];
  if (childParams.length > 0) {
    return childParams.map((param) => stringProp(param, 'type') ?? '');
  }
  const params = node.props?.params;
  if (typeof params !== 'string' || !params.trim()) return [];
  try {
    return splitSemanticParamList(params, `${node.type} params=`).map((part) => {
      const typeIndex = part.indexOf(':');
      if (typeIndex < 0) return '';
      const typeAndMaybeDefault = part.slice(typeIndex + 1);
      const defaultIndex = paramDefaultSeparatorIndex(typeAndMaybeDefault);
      return (defaultIndex >= 0 ? typeAndMaybeDefault.slice(0, defaultIndex) : typeAndMaybeDefault).trim();
    });
  } catch {
    return [];
  }
}

function paramDefaultSeparatorIndex(value: string): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index];
    if (quote !== null) {
      if (ch === '\\' && index + 1 < value.length) index += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '<' || ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if ((ch === '>' || ch === ')' || ch === '}' || ch === ']') && depth > 0) depth -= 1;
    else if (ch === '=' && depth === 0) {
      if (
        value[index + 1] === '>' ||
        value[index + 1] === '=' ||
        value[index - 1] === '=' ||
        value[index - 1] === '<' ||
        value[index - 1] === '>' ||
        value[index - 1] === '!'
      ) {
        continue;
      }
      return index;
    }
  }
  return -1;
}

function splitSemanticParamList(raw: string, propName: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  let angleDepth = 0;
  let inDefault = false;
  let quote: '"' | "'" | '`' | null = null;
  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw[index];
    if (quote !== null) {
      current += ch;
      if (ch === '\\' && index + 1 < raw.length) current += raw[++index];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === '=' && depth === 0 && angleDepth === 0 && raw[index + 1] !== '>') inDefault = true;
    else if (ch === '<' && (!inDefault || angleClosesBeforeNextTopLevelComma(raw, index + 1))) angleDepth += 1;
    else if (!inDefault && ch === '>' && angleDepth > 0) angleDepth -= 1;
    else if (inDefault && ch === '>' && angleDepth > 0) angleDepth -= 1;
    if (depth < 0 || angleDepth < 0) throw new Error(`${propName} has unbalanced delimiters.`);
    if (ch === ',' && depth === 0 && angleDepth === 0) {
      const part = current.trim();
      if (part.length === 0) throw new Error(`${propName} contains an empty expression.`);
      out.push(part);
      current = '';
      inDefault = false;
      continue;
    }
    current += ch;
  }
  if (quote !== null || depth !== 0 || angleDepth !== 0) throw new Error(`${propName} has unbalanced delimiters.`);
  const tail = current.trim();
  if (tail.length === 0 && raw.trim().endsWith(',')) throw new Error(`${propName} contains an empty expression.`);
  if (tail.length > 0) out.push(tail);
  return out;
}

function angleClosesBeforeNextTopLevelComma(raw: string, start: number): boolean {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  for (let index = start; index < raw.length; index += 1) {
    const ch = raw[index];
    if (quote !== null) {
      if (ch === '\\' && index + 1 < raw.length) index += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if ((ch === ')' || ch === ']' || ch === '}') && depth > 0) depth -= 1;
    else if (ch === '>' && depth === 0) return true;
    else if (ch === ',' && depth === 0) return false;
  }
  return false;
}

function nodeBodyUsesSuper(node: IRNode): boolean {
  return nodeBodyExpressions(node).some((expr) => {
    try {
      return valueIRUsesSuper(parseExpression(expr));
    } catch {
      return false;
    }
  });
}

function nodeBodyExpressions(node: IRNode): string[] {
  const out: string[] = [];
  walkSemanticTreeUntil(node, (candidate) => {
    for (const prop of BODY_EXPRESSION_PROPS) {
      const text = expressionPropText(candidate.props?.[prop]);
      if (text) out.push(text);
    }
    return candidate !== node && candidate.type === 'class' ? 'stop' : 'continue';
  });
  return out;
}

function expressionPropText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isExpressionObject(value)) return value.code;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function valueIRCallsSuperConstructor(value: ValueIR): boolean {
  if (value.kind === 'call' && value.callee.kind === 'ident' && value.callee.name === 'super') return true;
  if (value.kind === 'lambda') return false;
  return valueIRChildren(value).some(valueIRCallsSuperConstructor);
}

function valueIRUsesSuper(value: ValueIR): boolean {
  if (value.kind === 'ident' && value.name === 'super') return true;
  return valueIRChildren(value).some(valueIRUsesSuper);
}

function valueIRUsesThisOrSuperMember(value: ValueIR): boolean {
  if (value.kind === 'ident' && value.name === 'this') return true;
  if (
    (value.kind === 'member' || value.kind === 'index') &&
    value.object.kind === 'ident' &&
    value.object.name === 'super'
  ) {
    return true;
  }
  if (value.kind === 'lambda') return false;
  return valueIRChildren(value).some(valueIRUsesThisOrSuperMember);
}

function valueIRChildren(value: ValueIR): ValueIR[] {
  switch (value.kind) {
    case 'call':
      return [value.callee, ...value.args];
    case 'member':
      return [value.object];
    case 'index':
      return [value.object, value.index];
    case 'tmplLit':
      return [...value.expressions];
    case 'arrayLit':
      return [...value.items];
    case 'objectLit':
      return value.entries.map((entry) => ('kind' in entry ? entry.argument : entry.value));
    case 'unary':
    case 'await':
    case 'new':
    case 'spread':
    case 'propagate':
      return [value.argument];
    case 'typeAssert':
    case 'nonNull':
      return [value.expression];
    case 'binary':
      return [value.left, value.right];
    case 'conditional':
      return [value.test, value.consequent, value.alternate];
    case 'lambda':
      // Block-bodied arrows carry `bodyBlock` (raw text) instead of an
      // expression `body`; they contribute no ValueIR children here.
      return value.body ? [value.body] : [];
    case 'numLit':
    case 'strLit':
    case 'boolLit':
    case 'nullLit':
    case 'undefLit':
    case 'regexLit':
    case 'ident':
      return [];
  }
  return [];
}

function classBaseName(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const match = /^([A-Za-z_$][\w$]*)/.exec(value.trim());
  return match?.[1];
}

function classReferenceNames(value: unknown, propName: string): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  let parts: string[];
  try {
    parts = splitClassReferenceList(value, propName);
  } catch {
    parts = [];
  }
  const names = new Set<string>();
  for (const part of parts) {
    const name = classBaseName(part);
    if (name) names.add(name);
  }
  return [...names];
}

function classReferenceListMalformed(value: unknown, propName: string): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    splitClassReferenceList(value, propName);
    return false;
  } catch {
    return true;
  }
}

function splitClassReferenceList(raw: string, propName: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  let angleDepth = 0;
  let quote: '"' | "'" | '`' | null = null;
  for (let index = 0; index < raw.length; index++) {
    const ch = raw[index];
    if (quote !== null) {
      current += ch;
      if (ch === '\\' && index + 1 < raw.length) current += raw[++index];
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
    else if (ch === '<') angleDepth++;
    else if (ch === '>' && angleDepth > 0) angleDepth--;
    if (depth < 0 || angleDepth < 0) throw new Error(`${propName} has unbalanced delimiters.`);
    if (ch === ',' && depth === 0 && angleDepth === 0) {
      const part = current.trim();
      if (part.length === 0) throw new Error(`${propName} contains an empty reference.`);
      out.push(part);
      current = '';
      continue;
    }
    current += ch;
  }
  if (quote !== null || depth !== 0 || angleDepth !== 0) throw new Error(`${propName} has unbalanced delimiters.`);
  const tail = current.trim();
  if (tail.length === 0 && raw.trim().endsWith(',')) throw new Error(`${propName} contains an empty reference.`);
  if (tail.length > 0) out.push(tail);
  return out;
}

function stringProp(node: IRNode, prop: string): string | undefined;
function stringProp(props: IRNode['props'] | undefined, prop: string): string | undefined;
function stringProp(nodeOrProps: IRNode | IRNode['props'] | undefined, prop: string): string | undefined {
  const props = nodeOrProps && 'type' in nodeOrProps ? nodeOrProps.props : nodeOrProps;
  const value = props ? (props as Record<string, unknown>)[prop] : undefined;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function walkSemanticTree(node: IRNode, visit: (node: IRNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walkSemanticTree(child, visit);
}

function walkSemanticTreeUntil(node: IRNode, visit: (node: IRNode) => 'continue' | 'stop'): void {
  if (visit(node) === 'stop') return;
  for (const child of node.children ?? []) walkSemanticTreeUntil(child, visit);
}

function isExpressionObject(value: unknown): value is { code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly __expr?: unknown }).__expr === true &&
    typeof (value as { readonly code?: unknown }).code === 'string'
  );
}

interface ExportBinding {
  source: string;
  alias?: string;
}

type ExportBindingKind = 'value' | 'type';

interface ExportSourceBinding extends ExportBinding {
  kind: ExportBindingKind;
}

interface ModuleVisibleNames {
  all: Set<string>;
  untypedLocal: Set<string>;
  values: Set<string>;
  types: Set<string>;
}

function validateModuleExports(
  node: IRNode,
  violations: SemanticViolation[],
  externalImports: ExternalImportSymbolTable,
): void {
  const visibleNames = collectModuleVisibleNames(node, externalImports);

  for (const child of node.children ?? []) {
    if (child.type !== 'export') continue;
    const from = child.props?.from;
    const sourceNames = exportedSourceBindings(child);
    const resolvedSymbols =
      typeof child.props?.resolvedExportNames === 'string' ? parseNameSet(child.props.resolvedExportNames) : null;

    for (const sourceName of sourceNames) {
      const binding = parseExportBinding(sourceName.raw, sourceName.kind);
      if (!binding) {
        violations.push({
          rule: 'export-binding-invalid',
          nodeType: 'export',
          message: `Export binding '${sourceName.raw}' is invalid. Use 'Name' or 'Name as Alias' with valid identifiers.`,
          line: child.loc?.line,
          col: child.loc?.col,
        });
        continue;
      }

      if (typeof from === 'string' && from.length > 0) {
        if (resolvedSymbols && !resolvedSymbols.has(binding.source)) {
          violations.push({
            rule: 'export-from-unknown-symbol',
            nodeType: 'export',
            message: `Re-export references '${binding.source}', but resolver metadata for '${from}' does not include that symbol.`,
            line: child.loc?.line,
            col: child.loc?.col,
          });
        }
        continue;
      }

      if (!visibleNames.all.has(binding.source)) {
        const available = [...visibleNames.all].sort();
        const hint = available.length > 0 ? ` Available names: ${available.join(', ')}.` : ' No visible names found.';
        violations.push({
          rule: 'export-local-unknown-symbol',
          nodeType: 'export',
          message: `Local export references unknown symbol '${binding.source}'.${hint}`,
          line: child.loc?.line,
          col: child.loc?.col,
        });
        continue;
      }

      if (!hasVisibleExportKind(visibleNames, binding.source, binding.kind)) {
        const expected = binding.kind === 'type' ? 'type-only' : 'runtime value';
        const actual = binding.kind === 'type' ? 'runtime value' : 'type-only';
        violations.push({
          rule: 'export-local-kind-mismatch',
          nodeType: 'export',
          message: `Local ${binding.kind} export references '${binding.source}', but that binding is only visible as a ${actual} symbol. Use \`export ${binding.kind === 'type' ? 'names' : 'types'}=${binding.source}\` or ensure '${binding.source}' is available as a ${expected} binding.`,
          line: child.loc?.line,
          col: child.loc?.col,
        });
      }
    }
  }
}

function collectModuleVisibleNames(moduleNode: IRNode, externalImports: ExternalImportSymbolTable): ModuleVisibleNames {
  const names: ModuleVisibleNames = {
    all: new Set(),
    untypedLocal: new Set(),
    values: new Set(),
    types: new Set(),
  };
  for (const symbol of externalImports.symbols) {
    addKindedVisibleName(names, symbol.localName, symbol.kind === 'type' ? 'type' : 'value');
  }
  for (const child of moduleNode.children ?? []) {
    const name = child.props?.name;
    if (typeof name === 'string' && name.length > 0 && child.type !== 'export' && child.type !== 'import') {
      addDeclaredVisibleName(names, child.type, name);
    }

    if (child.type === 'use') {
      for (const fromChild of child.children ?? []) {
        if (fromChild.type !== 'from') continue;
        const importedName = fromChild.props?.name;
        const alias = fromChild.props?.as;
        const localName =
          typeof alias === 'string' && alias.length > 0
            ? alias
            : typeof importedName === 'string' && importedName.length > 0
              ? importedName
              : null;
        if (localName) addUseVisibleName(names, fromChild, localName);
      }
    }

    if (child.type === 'import' && !isExternalImportNode(child)) {
      addHostImportBindings(names, child);
    }

    if (child.type === 'extern' && isHostExternNode(child)) {
      addHostExternBindings(names, child);
    }

    if (child.type === 'island') {
      addIslandVisibleNames(names, child);
    }
  }
  return names;
}

function addUntypedLocalVisibleName(names: ModuleVisibleNames, name: string): void {
  names.all.add(name);
  names.untypedLocal.add(name);
}

function addKindedVisibleName(names: ModuleVisibleNames, name: string, kind: ExportBindingKind | 'both'): void {
  names.all.add(name);
  if (kind === 'value' || kind === 'both') names.values.add(name);
  if (kind === 'type' || kind === 'both') names.types.add(name);
}

function addDeclaredVisibleName(names: ModuleVisibleNames, nodeType: string, name: string): void {
  switch (nodeType) {
    case 'type':
    case 'interface':
    case 'event':
    case 'union':
      addKindedVisibleName(names, name, 'type');
      return;
    case 'class':
    case 'enum':
    case 'service':
      addKindedVisibleName(names, name, 'both');
      return;
    case 'const':
    case 'let':
    case 'fn':
    case 'function':
    case 'screen':
      addKindedVisibleName(names, name, 'value');
      return;
    default:
      addUntypedLocalVisibleName(names, name);
  }
}

function addUseVisibleName(names: ModuleVisibleNames, fromNode: IRNode, name: string): void {
  const kind = typeof fromNode.props?.kind === 'string' ? fromNode.props.kind : '';
  switch (kind) {
    case 'type':
    case 'interface':
    case 'event':
    case 'union':
      addKindedVisibleName(names, name, 'type');
      return;
    case 'class':
    case 'enum':
    case 'service':
      addKindedVisibleName(names, name, 'both');
      return;
    case 'const':
    case 'let':
    case 'fn':
    case 'function':
    case 'screen':
      addKindedVisibleName(names, name, 'value');
      return;
    default:
      addUntypedLocalVisibleName(names, name);
  }
}

function hasVisibleExportKind(names: ModuleVisibleNames, name: string, kind: ExportBindingKind): boolean {
  if (names.untypedLocal.has(name)) return true;
  return kind === 'type' ? names.types.has(name) : names.values.has(name);
}

function isExternalImportNode(node: IRNode): boolean {
  if (node.type !== 'import') return false;
  return importRegistryOf(node.props?.registry) !== 'host';
}

function isHostExternNode(node: IRNode): boolean {
  if (node.type !== 'extern') return false;
  return importRegistryOf(node.props?.registry) === 'host';
}

function addHostImportBindings(names: ModuleVisibleNames, node: IRNode): void {
  for (const imported of importLocalBindings(node)) {
    addKindedVisibleName(names, imported.name, imported.kind);
  }
}

function addHostExternBindings(names: ModuleVisibleNames, node: IRNode): void {
  addHostImportBindings(names, node);
  for (const child of node.children ?? []) {
    if (child.type === 'import' && !isExternalImportNode(child)) {
      addHostImportBindings(names, child);
    }
  }
}

function addIslandVisibleNames(names: ModuleVisibleNames, node: IRNode): void {
  for (const child of node.children ?? []) {
    const childName = child.props?.name;
    if (child.type === 'fn' && typeof childName === 'string' && childName.length > 0) {
      addDeclaredVisibleName(names, child.type, childName);
    }
    if (child.type === 'import' && !isExternalImportNode(child)) {
      addHostImportBindings(names, child);
    }
    if (child.type === 'extern' && isHostExternNode(child)) {
      addHostExternBindings(names, child);
    }
  }
}

function validateModuleExternalImportConflicts(
  externalImports: ExternalImportSymbolTable,
  violations: SemanticViolation[],
): void {
  for (const conflict of externalImports.conflicts) {
    const conflictingSymbols = conflictingExternalImportSymbols(conflict.symbols);
    const locationSymbol = conflictingSymbols[conflictingSymbols.length - 1];
    if (!locationSymbol) continue;
    const sources = conflictingSymbols
      .map((symbol) => `${symbol.registry}:${symbol.package}${symbol.sourceName ? `#${symbol.sourceName}` : ''}`)
      .join(', ');
    violations.push({
      rule: 'external-import-local-conflict',
      nodeType: 'import',
      message: `External import local name '${conflict.localName}' is declared by multiple imports (${sources}). Use an alias so native KERN has one binding for that name.`,
      // Point at the latest declaration so the diagnostic lands on the import
      // that made the name ambiguous.
      line: locationSymbol.line,
      col: locationSymbol.col,
    });
  }
}

function conflictingExternalImportSymbols(
  symbols: ExternalImportSymbolTable['symbols'],
): ExternalImportSymbolTable['symbols'] {
  const valueSymbols = symbols.filter((symbol) => symbol.kind !== 'type');
  const typeSymbols = symbols.filter((symbol) => symbol.kind === 'type');
  if (valueSymbols.length > 1 && typeSymbols.length > 1) return symbols;
  if (valueSymbols.length > 1) return valueSymbols;
  if (typeSymbols.length > 1) return typeSymbols;
  return symbols;
}

function importLocalBindings(node: IRNode): Array<{ name: string; kind: ExportBindingKind }> {
  const names: Array<{ name: string; kind: ExportBindingKind }> = [];
  const props = node.props ?? {};
  const kind = isTrueFlag(props.types) ? 'type' : 'value';
  if (typeof props.default === 'string' && props.default.length > 0 && props.default !== 'true') {
    names.push({ name: props.default, kind });
  }
  if (typeof props.names === 'string') {
    for (const raw of props.names.split(',')) {
      const name = raw.trim();
      const aliasMatch = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u.exec(name);
      if (aliasMatch) names.push({ name: aliasMatch[2] ?? aliasMatch[1], kind });
      else if (isIdentifier(name)) names.push({ name, kind });
    }
  }
  return names;
}

function isTrueFlag(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

function exportedSourceBindings(node: IRNode): Array<{ raw: string; kind: ExportBindingKind }> {
  const props = node.props ?? {};
  const names = [
    ...splitCsv(props.names).map((raw) => ({ raw, kind: 'value' as const })),
    ...splitCsv(props.types).map((raw) => ({ raw, kind: 'type' as const })),
  ];
  if (
    typeof props.default === 'string' &&
    props.default.length > 0 &&
    !(typeof props.from === 'string' && props.from.length > 0)
  ) {
    names.push({ raw: `${props.default} as default`, kind: 'value' });
  }
  return names;
}

function splitCsv(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseExportBinding(raw: string, kind: ExportBindingKind): ExportSourceBinding | null {
  const match = raw.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u);
  if (!match) return null;
  return { source: match[1], alias: match[2], kind };
}

function parseNameSet(raw: string): Set<string> {
  return new Set(splitCsv(raw));
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/u.test(value);
}

function hasMatchingState(name: string, ancestors: IRNode[]): boolean {
  for (const ancestor of ancestors) {
    if (!ancestor.children) continue;
    for (const child of ancestor.children) {
      // `cell` (body-stmt) and `state` (top-level / screen) both register a
      // setter binding. `set name=X` matches either declaration form.
      if ((child.type === 'state' || child.type === 'cell') && (child.props?.name as string | undefined) === name) {
        return true;
      }
    }
  }
  return false;
}

function collectDeclaredStateNames(ancestors: IRNode[]): string[] {
  const names: string[] = [];
  for (const ancestor of ancestors) {
    if (!ancestor.children) continue;
    for (const child of ancestor.children) {
      if (child.type === 'state' || child.type === 'cell') {
        const n = child.props?.name as string | undefined;
        if (n) names.push(n);
      }
    }
  }
  return names;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
