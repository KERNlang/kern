/**
 * Cross-file ProvenanceChain extension — Phase 2 of cross-file provenance v1.
 *
 * Rules emit findings with single-file ProvenanceChains and (optionally)
 * `CrossFileExtensionRequest`s on `ReviewReport.pendingCrossFileLinks`. After
 * single-file analysis, `extendCrossFileChains` dispatches each request to a
 * registered walker, which appends additional ProvenanceSteps to the matching
 * finding's chain.
 *
 * Append-only invariant (Plan v3 Q4):
 *   Walkers MUST NOT mutate `chain.steps[0..K]` where K=2. The first three
 *   steps feed `deriveProvenanceRootCause` (see derive-provenance-root-cause.ts);
 *   if two findings on the same root cause had their head-of-chain rewritten
 *   from this extender, they could collapse into one and a real second
 *   defect would be lost. v1 enforces this by exposing a strict append API
 *   (`WalkerResult.appendSteps`) rather than letting walkers see the chain.
 *
 * Caps (Plan v3 Q5):
 *   `hardCap` bounds the total chain length post-extension (default 10).
 *   `softHopCap` is informational — walkers MAY use it to early-stop their
 *   own traversal (forward-import walker doesn't, it adds exactly one hop).
 *   When truncation drops evidence, a final `{kind: 'boundary', category:
 *   'truncated'}` step is appended so Sight can render the elision.
 */

import { type CallExpression, Node, type Project, type SourceFile } from 'ts-morph';
import { buildJsxUsageIndex, type InlinePropKind, type JsxUsageIndex } from './jsx-usage-index.js';
import { canonicalize } from './path-canonical.js';
import type { CrossFileExtensionRequest, GraphResult, ProvenanceStep, ReviewFinding, ReviewReport } from './types.js';

const DEFAULT_HARD_CAP = 10;
const DEFAULT_SOFT_HOP_CAP = 8;

export interface CrossFileContext {
  graph: GraphResult;
  project: Project;
  /** Built lazily on first use via `ensureJsxUsageIndex` so callers without
   *  cross-file rules don't pay the AST-walk cost. */
  jsxUsageIndex?: JsxUsageIndex;
}

export interface WalkerResult {
  appendSteps: ProvenanceStep[];
  /** Walker self-reports it had to drop evidence. Honored alongside the hardCap. */
  truncated?: boolean;
}

export type CrossFileWalker = (
  req: CrossFileExtensionRequest,
  finding: ReviewFinding,
  ctx: CrossFileContext,
) => WalkerResult;

const walkers = new Map<string, CrossFileWalker>();

export const cfWalkers = {
  register(id: string, walker: CrossFileWalker): void {
    walkers.set(id, walker);
  },
  get(id: string): CrossFileWalker | undefined {
    return walkers.get(id);
  },
  /** Test-only escape hatch — clear all registrations for hermetic suites. */
  _reset(): void {
    walkers.clear();
    registerBuiltins();
  },
};

export function extendCrossFileChains(
  report: ReviewReport,
  ctx: CrossFileContext,
  opts?: { hardCap?: number; softHopCap?: number },
): ReviewReport {
  const requests = report.pendingCrossFileLinks;
  if (!requests || requests.length === 0) return report;

  const hardCap = opts?.hardCap ?? DEFAULT_HARD_CAP;
  // softHopCap is forwarded to walkers via ctx (future-use); v1 walker ignores it.
  void (opts?.softHopCap ?? DEFAULT_SOFT_HOP_CAP);

  const byFp = new Map<string, ReviewFinding>();
  for (const f of report.findings) byFp.set(f.fingerprint, f);

  for (const req of requests) {
    const finding = byFp.get(req.findingFingerprint);
    if (!finding) continue;
    const walker = walkers.get(req.walkerId);
    if (!walker) continue;

    const result = walker(req, finding, ctx);
    if (!result.appendSteps || result.appendSteps.length === 0) continue;

    if (!finding.provenance) finding.provenance = { steps: [] };
    const existing = finding.provenance.steps.length;

    // Already at or past the cap — extension would push us over, so skip.
    // Codex + Gemini review caught this: the prior `if (truncated) push marker`
    // could emit a chain of length hardCap + 1 when existing was already at cap.
    const remaining = hardCap - existing;
    if (remaining <= 0) continue;

    let toAppend = result.appendSteps;
    const overflow = toAppend.length > remaining;
    const truncated = result.truncated === true || overflow;
    if (truncated) {
      // Reserve a slot for the truncation marker.
      toAppend = toAppend.slice(0, Math.max(0, remaining - 1));
    } else {
      toAppend = toAppend.slice(0, remaining);
    }

    finding.provenance.steps.push(...toAppend);

    if (truncated && finding.provenance.steps.length < hardCap) {
      finding.provenance.steps.push({
        kind: 'boundary',
        location: { file: '<truncated>', startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
        label: 'cross-file chain truncated',
        category: 'truncated',
      });
    }
  }

  // Consume the requests so downstream consumers don't re-process them.
  const next: ReviewReport = { ...report };
  delete (next as { pendingCrossFileLinks?: CrossFileExtensionRequest[] }).pendingCrossFileLinks;
  return next;
}

/**
 * Lazy-build the JSX usage index and cache on the context. Walkers that need
 * "where is this child rendered?" lookups should call this rather than
 * rebuilding the index themselves.
 */
export function ensureJsxUsageIndex(ctx: CrossFileContext): JsxUsageIndex {
  if (!ctx.jsxUsageIndex) {
    ctx.jsxUsageIndex = buildJsxUsageIndex(ctx.project, ctx.graph);
  }
  return ctx.jsxUsageIndex;
}

// ── Built-in walkers ────────────────────────────────────────────────────────

/**
 * `forward-import` walker — for a finding that fires on `<MemoChild prop={inline} />`
 * where `MemoChild` is imported, append a step pointing at the `React.memo(...)`
 * (or `forwardRef(memo(...))`) wrap site in the child's declaration file. This
 * makes the chain pedagogical: "you passed an inline prop → identity changes
 * every render → here's the memo boundary that's being defeated".
 *
 * Payload:
 *   { symbol: string, targetFile: string }
 */
export const forwardImportWalker: CrossFileWalker = (req, _finding, ctx) => {
  const symbol = typeof req.payload.symbol === 'string' ? req.payload.symbol : '';
  const targetFile = typeof req.payload.targetFile === 'string' ? req.payload.targetFile : '';
  if (!symbol || !targetFile) return { appendSteps: [] };

  const canonical = canonicalize(targetFile);
  const sf = ctx.project.getSourceFile(canonical) ?? ctx.project.getSourceFile(targetFile);
  if (!sf) return { appendSteps: [] };

  const boundary = findMemoBoundary(sf, symbol);
  if (!boundary) return { appendSteps: [] };

  const startPos = sf.getLineAndColumnAtPos(boundary.node.getStart());
  const endPos = sf.getLineAndColumnAtPos(boundary.node.getEnd());
  const step: ProvenanceStep = {
    kind: 'import',
    location: {
      file: targetFile,
      startLine: startPos.line,
      startCol: startPos.column,
      endLine: endPos.line,
      endCol: endPos.column,
    },
    label: boundary.label,
    detail: boundary.detail,
    category: 'memo-boundary',
  };
  return { appendSteps: [step] };
};

interface MemoBoundary {
  node: Node;
  label: string;
  detail?: string;
}

function findMemoBoundary(sf: SourceFile, symbol: string): MemoBoundary | undefined {
  // Gemini review: do NOT fall back to `'default'` when a named lookup misses —
  // that would point a finding at an unrelated default export of the same file.
  // The caller (the rule emitter) already passes the resolved exported name
  // (`binding.importedName`, which is 'default' for default imports), so a
  // miss here is a real miss.
  const candidates = sf.getExportedDeclarations().get(symbol) ?? [];
  // Gemini review: collect a fallback only after iterating ALL candidates;
  // the prior `return fallback` inside the loop fired on the first
  // TypeAliasDeclaration when an `export type Foo = ...` and `export const Foo = memo(...)`
  // both lived in the same file, hiding the real memo wrap site.
  let fallback: Node | undefined;
  for (const decl of candidates) {
    if (Node.isVariableDeclaration(decl)) {
      const memoCall = unwrapToMemoCall(decl.getInitializer());
      if (memoCall) {
        return {
          node: memoCall,
          label: `${symbol} memoised here (React.memo)`,
          detail: 'parent passes an inline prop; the new identity each render defeats memoisation here.',
        };
      }
    }
    if (!fallback) fallback = decl;
  }
  if (fallback) {
    return {
      node: fallback,
      label: `${symbol} declared here`,
    };
  }
  return undefined;
}

/**
 * Walk through forwardRef / observer / typed-wrappers to find an inner
 * React.memo(...) call expression. Returns the memo call site if present.
 */
function unwrapToMemoCall(node: Node | undefined): CallExpression | undefined {
  if (!node) return undefined;
  if (!Node.isCallExpression(node)) return undefined;
  const callee = node.getExpression().getText();
  if (callee === 'memo' || callee === 'React.memo') return node;
  for (const arg of node.getArguments()) {
    const inner = unwrapToMemoCall(arg);
    if (inner) return inner;
  }
  return undefined;
}

/**
 * `reverse-jsx-usage` walker — the inverse of `forward-import`. For a finding
 * that fires on a memoised CHILD's declaration (e.g. "this React.memo is
 * being defeated by N parents"), append one step per defeating parent
 * pointing at the JSX render site that's passing inline props.
 *
 * Payload:
 *   { symbol: string, declFile: string, inlinePropFilter?: 'any' | InlinePropKind }
 *
 * - `symbol` — the exported component name (declaration name, NOT a local
 *   alias). Same resolution rule as the forward walker: match the index by
 *   the exported name so aliased imports `import { Foo as Bar }` still hit.
 * - `declFile` — the file where the component is declared.
 * - `inlinePropFilter` — optional. `'function'` only surfaces parents that
 *   pass inline arrow/function props; `'object'` and `'array'` are
 *   analogous; `'any'` (default) matches any inline prop kind.
 *
 * Sites with zero inline props are NEVER surfaced — those callers aren't
 * defeating memoisation, so they're not part of the causal chain. Test
 * files are already excluded by the index builder.
 *
 * Cap behavior: this walker can append many steps. `extendCrossFileChains`
 * enforces the hard cap and emits the truncation marker; the walker self-
 * reports `truncated: true` when the index returns more sites than fit in
 * the soft hop budget so the marker is emitted even if the hard cap isn't
 * reached.
 */
const DEFAULT_REVERSE_SOFT_CAP = 5;

export const reverseJsxUsageWalker: CrossFileWalker = (req, _finding, ctx) => {
  const symbol = typeof req.payload.symbol === 'string' ? req.payload.symbol : '';
  const declFile = typeof req.payload.declFile === 'string' ? req.payload.declFile : '';
  if (!symbol || !declFile) return { appendSteps: [] };

  const rawFilter = req.payload.inlinePropFilter;
  const filter: 'any' | InlinePropKind =
    rawFilter === 'function' || rawFilter === 'object' || rawFilter === 'array' ? rawFilter : 'any';
  // Soft cap is a per-walker hint — the chain-level hard cap in
  // extendCrossFileChains has the final say.
  const softCap =
    typeof req.payload.softCap === 'number' && req.payload.softCap > 0 ? req.payload.softCap : DEFAULT_REVERSE_SOFT_CAP;

  const index = ensureJsxUsageIndex(ctx);
  const sites = index.findUsages(declFile, symbol);
  // Only surface parents that pass at least one inline prop matching the
  // filter — those are the ones defeating memoisation. Sites with zero
  // matching props are causally unrelated and would just inflate the chain.
  const defeating = sites.filter((s) => {
    if (s.inlineProps.length === 0) return false;
    if (filter === 'any') return true;
    return s.inlineProps.some((p) => p.kind === filter);
  });

  if (defeating.length === 0) return { appendSteps: [] };

  const overflow = defeating.length > softCap;
  const kept = overflow ? defeating.slice(0, softCap) : defeating;
  const steps: ProvenanceStep[] = kept.map((site) => {
    const matchingProps = filter === 'any' ? site.inlineProps : site.inlineProps.filter((p) => p.kind === filter);
    const propNames = matchingProps.map((p) => p.name).join(', ');
    const parent = site.parentComponentName ?? '<top-level>';
    return {
      kind: 'sink',
      location: {
        file: site.file,
        startLine: site.line,
        startCol: site.col,
        endLine: site.line,
        endCol: site.col,
      },
      label: `<${site.localName}> rendered in ${parent} with inline ${matchingProps.length === 1 ? 'prop' : 'props'} (${propNames})`,
      detail: `Each parent render allocates a new identity for ${propNames}, defeating React.memo on <${site.localName}>.`,
      category: 'memo-boundary',
    };
  });

  return { appendSteps: steps, truncated: overflow };
};

function registerBuiltins(): void {
  cfWalkers.register('forward-import', forwardImportWalker);
  cfWalkers.register('reverse-jsx-usage', reverseJsxUsageWalker);
}

registerBuiltins();
