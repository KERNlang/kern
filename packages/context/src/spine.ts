/**
 * Spine renderer — projects a {@link ProjectContextGraph} into the compact,
 * token-budgeted `<kern-map>` block injected into every review batch.
 *
 * Why a custom line DSL and not JSON/XML: JSON doubles the token cost (quotes,
 * braces, repeated keys) and XML is worse. The spine is read by an LLM, not a
 * parser, so a terse line grammar wins. It is rendered by SYMBOL-KEYED RETRIEVAL
 * — only the symbols defined in the current batch's files, plus their use-sites
 * — never a global-map dump.
 *
 * Determinism: output is a pure function of (artifact structure, batch set,
 * tier). No timestamps, no Map iteration order leaks. Same input → same string,
 * so callers can cache by (rootHash, batchId, tier).
 *
 * Trust boundary: symbol names and paths are SOURCE-DERIVED and, in a PR, are
 * attacker-controllable. Every rendered token is passed through {@link sanitize}
 * so it cannot break out of the `<kern-map>` fence or smuggle instructions. The
 * spine is authoritative *metadata* about the code, not user prose.
 */
import type { EdgeConfidence, ProjectContextGraph, SymbolKind, UseSite } from './schema.js';

/** ~4 chars per token for code-like text — matches @kernlang/review's estimator. */
const CHARS_PER_TOKEN = 4;

/** Default spine target if the caller gives no budget. */
export const DEFAULT_SPINE_TOKENS = 1500;

/** Recommended cap: spend at most this fraction of a batch's budget on the spine. */
export const SPINE_BUDGET_FRACTION = 0.1;

/** Max concrete use-sites shown per symbol before collapsing to `+N`. */
const MAX_SITES_PER_SYMBOL = 3;

/** Cap any single identifier/path so a pathological name can't dominate the spine. */
const MAX_TOKEN_CHARS = 80;

/** Characters that would break out of the DSL or smuggle instructions: C0/DEL
 *  control chars (unicode-escaped) plus the DSL delimiters and backtick. */
const UNSAFE_TOKEN_CHARS = /[\u0000-\u001f\u007f-\u009f<>;{},`]/g;

/** A=full sites+deps+taint, B=counts only, C=exported-symbol counts only. */
export type SpineTier = 'A' | 'B' | 'C';

export interface OtherBatch {
  /** Display id used in `elsewhere`, e.g. "b3". */
  id: string;
  /** Representative directories of that batch, e.g. ["payments", "admin"]. */
  dirs: string[];
}

export interface SpineOptions {
  /** Paths of the files in THIS batch. Symbols defined here drive the spine. */
  batchFiles: string[];
  /** 1-based position for the header, e.g. batchIndex=2, batchTotal=6 → "batch 2/6". */
  batchIndex?: number;
  batchTotal?: number;
  /** Target token budget for the spine itself. Defaults to {@link DEFAULT_SPINE_TOKENS}. */
  tokenBudget?: number;
  /** Other batches, collapsed into one `elsewhere` line (tiers A/B). */
  otherBatches?: OtherBatch[];
}

/** Rough token estimate for budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Make a source-derived string safe to embed in the spine: strip DSL delimiters
 * and control chars, collapse whitespace, and length-cap. This is the
 * prompt-injection mitigation — a symbol literally named `</kern-map>` or
 * `; ignore previous` becomes inert. Paths keep / . : _ - and digits.
 */
export function sanitize(raw: string): string {
  const cleaned = raw.replace(UNSAFE_TOKEN_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > MAX_TOKEN_CHARS ? `${cleaned.slice(0, MAX_TOKEN_CHARS)}…` : cleaned;
}

const KIND_ABBR: Record<SymbolKind, string> = {
  function: 'fn',
  method: 'fn',
  class: 'cls',
  const: 'const',
  type: 'type',
  module: 'mod',
};

/** Functions/classes are "called"; values/types are "read". */
function usageVerb(kind: SymbolKind): string {
  return kind === 'const' || kind === 'type' || kind === 'module' ? 'readby' : 'callby';
}

/** Unresolved/heuristic sites are flagged so the model never treats them as fact. */
function confGlyph(c: EdgeConfidence): string {
  if (c === 'unresolved') return '~';
  if (c === 'heuristic') return '?';
  return '';
}

function renderSite(s: UseSite): string {
  return `${confGlyph(s.confidence)}${sanitize(s.path)}:${s.line}`;
}

interface PreparedSymbol {
  name: string;
  kind: SymbolKind;
  exported: boolean;
  publicApi: boolean;
  fileId: string;
  line: number;
  sites: UseSite[];
  totalCount: number;
}

/**
 * Collect the symbols defined in the batch, sorted by importance so that when
 * the budget forces truncation we drop the LEAST important first. Order:
 * public API → exported → most-used → name (stable tie-break).
 */
function prepareSymbols(artifact: ProjectContextGraph, batchSet: Set<string>): PreparedSymbol[] {
  const fileById = new Map(artifact.files.map((f) => [f.id, f]));
  const prepared: PreparedSymbol[] = [];
  for (const sym of artifact.symbols) {
    const file = fileById.get(sym.fileId);
    if (!file || !batchSet.has(file.path)) continue;
    const usage = artifact.usage[sym.id];
    prepared.push({
      name: sym.name,
      kind: sym.kind,
      exported: sym.exported,
      publicApi: sym.publicApi ?? false,
      fileId: sym.fileId,
      line: sym.line,
      sites: usage?.callers ?? [],
      totalCount: usage?.totalCount ?? 0,
    });
  }
  // Fully deterministic order: importance first, then file+line so equal names
  // never depend on artifact.symbols insertion order (which can churn).
  prepared.sort((a, b) => {
    if (a.publicApi !== b.publicApi) return a.publicApi ? -1 : 1;
    if (a.exported !== b.exported) return a.exported ? -1 : 1;
    if (a.totalCount !== b.totalCount) return b.totalCount - a.totalCount;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    if (a.fileId !== b.fileId) return a.fileId < b.fileId ? -1 : 1;
    return a.line - b.line;
  });
  return prepared;
}

function symbolLineA(s: PreparedSymbol): string {
  const flags = [s.exported ? 'exp' : '', s.publicApi ? 'public' : ''].filter(Boolean).join(' ');
  const shown = s.sites.slice(0, MAX_SITES_PER_SYMBOL).map(renderSite).join(' ');
  const rest = s.totalCount - Math.min(s.sites.length, MAX_SITES_PER_SYMBOL);
  const tail = rest > 0 ? ` +${rest}` : '';
  const usagePart = s.totalCount > 0 ? ` ${usageVerb(s.kind)} ${shown}${tail}` : ' unused';
  const head = `sym ${sanitize(s.name)} ${KIND_ABBR[s.kind]}${flags ? ` ${flags}` : ''} line${s.line}`;
  return `${head}${usagePart}`;
}

function symbolLineB(s: PreparedSymbol): string {
  const flags = [s.exported ? 'exp' : '', s.publicApi ? 'public' : ''].filter(Boolean).join(' ');
  return `sym ${sanitize(s.name)} ${KIND_ABBR[s.kind]}${flags ? ` ${flags}` : ''} used=${s.totalCount}`;
}

function symbolLineC(s: PreparedSymbol): string {
  return `sym ${sanitize(s.name)} used=${s.totalCount}`;
}

/** `deps <path>{a,b} ...` — imported files+symbols that are NOT in this batch. */
function depsLine(artifact: ProjectContextGraph, batchSet: Set<string>): string | null {
  const deps: string[] = [];
  const seen = new Set<string>();
  for (const f of artifact.files) {
    if (!batchSet.has(f.path)) continue;
    for (const imp of f.imports ?? []) {
      if (batchSet.has(imp.path) || seen.has(imp.path)) continue;
      seen.add(imp.path);
      const names = imp.symbols?.length ? `{${imp.symbols.map(sanitize).join(',')}}` : '';
      deps.push(`${sanitize(imp.path)}${names}`);
    }
  }
  return deps.length ? `deps ${deps.join(' ')}` : null;
}

function taintLines(artifact: ProjectContextGraph): string[] {
  return (artifact.taint ?? []).map(
    (t) => `taint ${sanitize(t.source)} -> ${sanitize(t.through)} -> ${sanitize(t.sink)} conf=${t.confidence}`,
  );
}

function elsewhereLine(otherBatches: OtherBatch[] | undefined): string | null {
  if (!otherBatches?.length) return null;
  const parts = otherBatches
    .map((b) => b.dirs.map((d) => `${sanitize(d)}/*#${sanitize(b.id)}`).join(' '))
    .filter(Boolean);
  return parts.length ? `elsewhere ${parts.join(' ')}` : null;
}

function header(opts: SpineOptions, fileTotal: number): string {
  const batch = opts.batchIndex && opts.batchTotal ? ` batch=${opts.batchIndex}/${opts.batchTotal}` : '';
  return `<kern-map v=1${batch} files=${fileTotal}>`;
}

/** Render the body for a given tier (no budget enforcement — caller picks tier). */
function renderTier(
  tier: SpineTier,
  symbols: PreparedSymbol[],
  artifact: ProjectContextGraph,
  batchSet: Set<string>,
  opts: SpineOptions,
): string[] {
  const lines: string[] = [];
  if (tier === 'A') {
    for (const s of symbols) lines.push(symbolLineA(s));
    const deps = depsLine(artifact, batchSet);
    if (deps) lines.push(deps);
    lines.push(...taintLines(artifact));
    const elsewhere = elsewhereLine(opts.otherBatches);
    if (elsewhere) lines.push(elsewhere);
  } else if (tier === 'B') {
    for (const s of symbols) lines.push(symbolLineB(s));
    const elsewhere = elsewhereLine(opts.otherBatches);
    if (elsewhere) lines.push(elsewhere);
  } else {
    for (const s of symbols.filter((sym) => sym.exported)) lines.push(symbolLineC(s));
  }
  return lines;
}

/**
 * Build the `<kern-map>` spine for one batch, fitting `tokenBudget`.
 *
 * Strategy: try tier A; if it overflows, fall to B, then C (graceful
 * degradation — drop call-sites before symbols, drop non-exported before
 * exported). If tier C still overflows, truncate the symbol list and append a
 * `+N more` marker so the model knows the map was clipped. Returns `''` when
 * there is nothing useful to say (no symbols defined in the batch).
 */
export function buildSpine(artifact: ProjectContextGraph, opts: SpineOptions): string {
  const batchSet = new Set(opts.batchFiles);
  const symbols = prepareSymbols(artifact, batchSet);
  if (symbols.length === 0) return '';

  // Respect the caller's budget exactly — never clamp upward, or a tiny-budget
  // caller (e.g. Sight) could get a spine that overflows its own prompt. Tiny
  // budgets degrade through tiers and, if needed, clipToBudget.
  const budget = opts.tokenBudget ?? DEFAULT_SPINE_TOKENS;
  const head = header(opts, artifact.files.length);
  const close = '</kern-map>';
  const envelope = estimateTokens(`${head}\n${close}`);

  const assemble = (bodyLines: string[]): string => [head, ...bodyLines, close].join('\n');

  for (const tier of ['A', 'B', 'C'] as SpineTier[]) {
    const body = renderTier(tier, symbols, artifact, batchSet, opts);
    const text = assemble(body);
    if (estimateTokens(text) <= budget) return text;
    if (tier === 'C') {
      // Last resort: clip the symbol list to fit, keeping the most important.
      return clipToBudget(symbols, head, close, envelope, budget);
    }
  }
  // Unreachable (tier C either fits or we clip), but keep the type-checker happy.
  return assemble(renderTier('C', symbols, artifact, batchSet, opts));
}

/** Tokens reserved for a trailing `+N more` marker (covers N up to ~9.9M). */
const MARKER_RESERVE_TOKENS = 4;

/**
 * Greedily keep the highest-priority exported symbols until the budget is spent.
 * STRICT budget: every accepted line leaves room for the `+N more` marker, and
 * if even the `<kern-map></kern-map>` frame plus a marker cannot fit, returns ''
 * (no spine) rather than emitting something over budget. `symbols` arrives
 * importance-sorted, so the kept lines are already the most important.
 */
function clipToBudget(
  symbols: PreparedSymbol[],
  head: string,
  close: string,
  envelope: number,
  budget: number,
): string {
  if (envelope + MARKER_RESERVE_TOKENS > budget) return '';
  const exported = symbols.filter((s) => s.exported);
  const kept: string[] = [];
  let used = envelope;
  let droppedExported = 0;
  for (const s of exported) {
    const line = symbolLineC(s);
    const cost = estimateTokens(`${line}\n`);
    if (used + cost + MARKER_RESERVE_TOKENS <= budget) {
      kept.push(line);
      used += cost;
    } else {
      droppedExported++;
    }
  }
  // `+N more` counts everything omitted from this render: budget-dropped exports
  // plus the non-exported symbols that tier C never lists.
  const dropped = droppedExported + (symbols.length - exported.length);
  if (dropped > 0) kept.push(`+${dropped} more`);
  return [head, ...kept, close].join('\n');
}
