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

import { collectExternalImportSymbols, type ExternalImportSymbolTable } from './external-symbols.js';
import { importRegistryOf } from './import-metadata.js';
import { parseExpression } from './parser-expression.js';
import { splitPortableExpressionList } from './portable-expression-list.js';
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

export type ClassSemanticOverrideStatus = 'compatible' | 'kind-mismatch' | 'arity-mismatch';

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
  readonly arity: number;
  readonly readable: boolean;
  readonly writable: boolean;
  readonly loc?: ClassSemanticLocation;
}

export interface ClassSemanticClassFact {
  readonly name: string;
  readonly baseName?: string;
  readonly hasConstructor: boolean;
  readonly constructorCount: number;
  readonly members: readonly ClassSemanticMemberFact[];
  readonly loc?: ClassSemanticLocation;
}

export interface ClassSemanticInheritanceEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: 'extends';
  readonly resolved: boolean;
  readonly builtin: boolean;
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

export interface ClassSemanticFacts {
  readonly classes: readonly ClassSemanticClassFact[];
  readonly inheritanceEdges: readonly ClassSemanticInheritanceEdge[];
  readonly overrides: readonly ClassSemanticOverrideFact[];
  readonly unresolvedBases: readonly string[];
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
  validateRagMcpRetrievalDuplicates(infos.mcpRetrievals, violations);
  for (const retrieval of infos.mcpRetrievals) {
    validateRagMcpRetrieval(retrieval, retrieverByName, ragByName, violations);
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
    nearestMcpContainer?: RagMcpContainerInfo,
    nearestMcpName?: string,
  ): void {
    const nextCorpusName = node.type === 'corpus' ? stringProp(node, 'name') || nearestCorpusName : nearestCorpusName;
    const nextRagName = node.type === 'rag' ? stringProp(node, 'name') || nearestRagName : nearestRagName;
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

    for (const child of node.children ?? []) visit(child, nextCorpusName, nextRagName, nextMcpContainer, nextMcpName);
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
    const pipeline = ragByName.get(ragName);
    const requiresCitations = pipeline && ragBooleanProp(pipeline.node, 'citations');
    if (requiresCitations) {
      pushRagViolation(
        violations,
        'mcp-retrieve-citations-require-grounding',
        retrieval.node,
        `MCP retrieve references citation-grounded rag '${ragName}' but sets requireGrounding=false.`,
      );
    }
  }
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
  const ragByName = new Map(infos.pipelines.map((info) => [info.name, info]));
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
    pipelines: infos.pipelines.map((info) => ragPipelineFact(info, infos.groundings, infos.evals)),
    mcpRetrievals: infos.mcpRetrievals.map((info) => ragMcpRetrievalFact(info, ragByName)),
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
): RagSemanticPipelineFact {
  return {
    name: info.name,
    retrieverName: info.retrieverName,
    ...optionalStringFact(info.node, 'prompt', 'prompt'),
    ...optionalStringFact(info.node, 'answer', 'answer'),
    citations: ragBooleanProp(info.node, 'citations'),
    groundings: groundings.filter((grounding) => grounding.ragName === info.name).map(ragGroundingFact),
    evals: evals.filter((evaluation) => evaluation.ragName === info.name).map(ragEvalFact),
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

function ragEvalFact(info: RagEvalInfo): RagSemanticEvalFact {
  return {
    ...optionalStringFact(info.node, 'name', 'name'),
    ...optionalStringValue('ragName', info.ragName),
    ...optionalStringFact(info.node, 'metric', 'metric'),
    ...optionalNumberFact(info.node, 'threshold', 'threshold'),
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragMcpRetrievalFact(
  info: RagMcpRetrievalInfo,
  ragByName: ReadonlyMap<string, RagPipelineInfo>,
): RagSemanticMcpRetrievalFact {
  const ragName = stringProp(info.node, 'rag');
  const retrieverName = stringProp(info.node, 'retriever');
  const targetKind = ragName ? 'rag' : 'retriever';
  const targetName = ragName || retrieverName || '';
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
    requireGrounding: ragMcpRetrieveRequiresGrounding(info.node, ragName, ragByName),
    ...(info.node.loc ? { loc: ragLocation(info.node) } : {}),
  };
}

function ragMcpRetrieveRequiresGrounding(
  node: IRNode,
  ragName: string | undefined,
  ragByName: ReadonlyMap<string, RagPipelineInfo>,
): boolean {
  if (ragBooleanPropIsFalse(node, 'requireGrounding')) return false;
  if (ragBooleanProp(node, 'requireGrounding')) return true;
  const pipeline = ragName ? ragByName.get(ragName) : undefined;
  return pipeline ? ragBooleanProp(pipeline.node, 'citations') : false;
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

type ClassMemberKind = 'field' | 'method' | 'getter' | 'setter';

interface ClassInfo {
  node: IRNode;
  rootIndex: number;
  name: string;
  baseName?: string;
  members: ClassMemberInfo[];
  constructors: IRNode[];
}

interface ClassMemberInfo {
  node: IRNode;
  owner: string;
  name: string;
  kind: ClassMemberKind;
  static: boolean;
  arity: number;
}

const BUILTIN_CLASS_BASES = new Set(['Error']);
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

  for (const info of classes) {
    validateClassBaseReference(info, visibleNamesByRoot[info.rootIndex] ?? declaredClassNames, violations);
    validateClassConstructors(info, violations);
    validateClassMemberConflicts(info, violations);
    validateClassSuperUsage(info, violations);
  }

  validateClassInheritanceCycles(classes, classByName, violations);
  validateClassOverrides(classes, classByName, violations);
  validateClassShapeUsage(classes, classByName, violations);
}

function collectClassInfos(root: IRNode, rootIndex = 0): ClassInfo[] {
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
      members: collectClassMembers(node, name),
      constructors: (node.children ?? []).filter((child) => child.type === 'constructor'),
    });
  });
  return out;
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
      arity: memberArity(child),
    });
  }
  return members;
}

export function collectClassSemanticFacts(root: IRNode | readonly IRNode[]): ClassSemanticFacts {
  const roots = Array.isArray(root) ? root : [root];
  const classes = roots.flatMap((candidate, rootIndex) => collectClassInfos(candidate, rootIndex));
  const classByName = new Map<string, ClassInfo>();
  for (const info of classes) {
    if (!classByName.has(info.name)) classByName.set(info.name, info);
  }
  const visibleNamesByRoot = roots.map((candidate) => collectVisibleClassBaseNames(candidate));

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

  return {
    classes: classes.map(classSemanticFact),
    inheritanceEdges,
    overrides: collectClassOverrideFacts(classes, classByName),
    unresolvedBases: [...unresolvedBases].sort(),
    cycles: collectClassCycleFacts(classes, classByName),
  };
}

function classSemanticFact(info: ClassInfo): ClassSemanticClassFact {
  return {
    name: info.name,
    ...(info.baseName ? { baseName: info.baseName } : {}),
    hasConstructor: info.constructors.length > 0,
    constructorCount: info.constructors.length,
    members: info.members.map(classMemberSemanticFact),
    ...(info.node.loc ? { loc: semanticLocation(info.node) } : {}),
  };
}

function classMemberSemanticFact(member: ClassMemberInfo): ClassSemanticMemberFact {
  return {
    className: member.owner,
    owner: member.owner,
    name: member.name,
    kind: member.kind,
    static: member.static,
    arity: member.arity,
    readable: member.kind === 'field' || member.kind === 'getter' || member.kind === 'method',
    writable: member.kind === 'field' || member.kind === 'setter',
    ...(member.node.loc ? { loc: semanticLocation(member.node) } : {}),
  };
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
        status: classOverrideStatus(member, baseMember),
        ...(member.node.loc ? { loc: semanticLocation(member.node) } : {}),
      });
    }
  }
  return overrides;
}

function classOverrideStatus(member: ClassMemberInfo, baseMember: ClassMemberInfo): ClassSemanticOverrideStatus {
  if (!sameOverrideKind(member, baseMember)) return 'kind-mismatch';
  if (member.kind === 'method' && baseMember.kind === 'method' && member.arity !== baseMember.arity) {
    return 'arity-mismatch';
  }
  return 'compatible';
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

function validateClassSuperUsage(info: ClassInfo, violations: SemanticViolation[]): void {
  const hasBase = Boolean(info.baseName);
  for (const ctor of info.constructors) {
    if (hasBase) {
      validateDerivedConstructorDiscipline(info, ctor, violations);
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
    return splitPortableExpressionList(params, `${node.type} params=`).length;
  } catch {
    return 0;
  }
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
      return [value.body];
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
