/**
 * dry-duplicate-handlers — cross-file detector for handler bodies that are
 * substantially similar after identifier normalization. The signal is
 * "consider extracting a helper" — not "this is a bug."
 *
 * Approach:
 *   1. Extract every IR `handler` node above MIN_HANDLER_LINES.
 *   2. Tokenize the body, replacing identifiers / literals with `$IDENT` /
 *      `$NUM` / `$STR` so two handlers that differ only in variable names
 *      hash identically. Comments are skipped *inside* the tokenizer loop
 *      (after string detection), so `"http://"` is no longer mangled.
 *   3. Bucket by structural signature (token count band + control-flow
 *      shape). Each candidate lands in three adjacent token bands so a
 *      19-token vs 20-token pair still gets compared (Gemini impl-review).
 *   4. Pairwise Jaccard on trigrams of normalized tokens, threshold
 *      `SIMILARITY_THRESHOLD`. Pair dedup via a seen-set so candidates
 *      that share two of three buckets are never scored twice.
 *   5. Union-find groups of duplicates; emit one finding per group whose
 *      primarySpan is the alphabetically-first member. Confidence factors
 *      in both group size AND the maximum pairwise Jaccard observed
 *      inside the group (OpenCode impl-review).
 *
 * Trade-offs:
 *   - Regex tokenizer (not full AST) — fast, good enough for v1; v2 should
 *     swap for a ts-morph walk to handle regex literals, JSX, nested
 *     template literals, and `?.` correctly. Documented as a known limit.
 *   - One finding per group (not per occurrence) — keeps the noise floor
 *     low. The relatedSpans list every other duplicate so reviewers can
 *     jump to all sites from one row.
 *   - severity:'info' — this rule suggests refactor, doesn't fail CI.
 *     Guard's noise scorer can demote further if a particular install
 *     finds it pedantic.
 */

import type { ReviewFinding, ReviewReport, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';

const MIN_HANDLER_LINES = 10;
const SIMILARITY_THRESHOLD = 0.8;
/** Stop scoring a bucket once it's this big — at that point the structural
 *  signature is so generic that pairwise scoring is more likely to surface
 *  noise than insight. KERN_DEBUG logs the skip so users investigating
 *  missing findings can spot homogeneous-codebase saturation. */
const MAX_BUCKET_SIZE = 200;
const NGRAM_SIZE = 3;

interface HandlerCandidate {
  filePath: string;
  fnName: string;
  /** 1-based line where the handler block starts in the source file. */
  startLine: number;
  /** Normalized token stream — identifiers/literals collapsed to type tags. */
  tokens: string[];
  /** Trigram set used for Jaccard scoring. Cached so each candidate is
   *  hashed once even when it lands in multiple comparisons. */
  ngrams: Set<string>;
  /** Bucket keys — primary plus ±1 token-band neighbours so adjacent
   *  bands still cross-compare. Each candidate is registered under every
   *  key; the comparison loop dedupes via a seen-pair set. */
  bucketKeys: string[];
}

interface SimilarityEdge {
  a: HandlerCandidate;
  b: HandlerCandidate;
  score: number;
}

export function lintDryDuplicateHandlers(reports: ReviewReport[]): ReviewFinding[] {
  const candidates: HandlerCandidate[] = [];
  for (const report of reports) {
    for (const r of report.inferred) {
      const baseName = (r.node.props?.name as string | undefined) ?? r.node.type;
      const handlers = (r.node.children ?? []).filter((c) => c.type === 'handler');
      for (const handler of handlers) {
        const code = (handler.props?.code as string | undefined) ?? '';
        const lineCount = countMeaningfulLines(code);
        if (lineCount < MIN_HANDLER_LINES) continue;
        const tokens = tokenizeNormalized(code);
        if (tokens.length < NGRAM_SIZE) continue;
        const startLine = handler.loc?.line ?? r.startLine;
        // Disambiguate unnamed handlers (e.g. anonymous class methods,
        // arrow functions assigned to const) so the finding message
        // doesn't collapse N findings to "Handler 'fn' is similar to
        // Handler 'fn'" — OpenCode impl-review.
        const fnName =
          r.node.props?.name && typeof r.node.props.name === 'string'
            ? (r.node.props.name as string)
            : `${baseName}@${startLine}`;
        candidates.push({
          filePath: report.filePath,
          fnName,
          startLine,
          tokens,
          ngrams: buildNgrams(tokens, NGRAM_SIZE),
          bucketKeys: bucketSignatures(tokens),
        });
      }
    }
  }

  // Bucket so cross-handler comparison is bounded — two handlers must
  // agree on control-flow shape and be within one token-count band before
  // we pay for a Jaccard scoring pass. Each candidate lands in three
  // adjacent buckets to keep band-boundary near-duplicates comparable.
  const buckets = new Map<string, HandlerCandidate[]>();
  for (const c of candidates) {
    for (const key of c.bucketKeys) {
      const arr = buckets.get(key);
      if (arr) arr.push(c);
      else buckets.set(key, [c]);
    }
  }

  // Union-find so a chain of A≈B≈C collapses into one group when each
  // adjacent pair crosses the threshold even if A and C don't directly.
  const parent = new Map<HandlerCandidate, HandlerCandidate>();
  for (const c of candidates) parent.set(c, c);
  function find(c: HandlerCandidate): HandlerCandidate {
    let cur = c;
    while (parent.get(cur) !== cur) cur = parent.get(cur)!;
    // Path compression — collapse the chain so subsequent finds are O(1).
    let walk = c;
    while (parent.get(walk) !== cur) {
      const next = parent.get(walk)!;
      parent.set(walk, cur);
      walk = next;
    }
    return cur;
  }
  function union(a: HandlerCandidate, b: HandlerCandidate): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // Track edges that crossed the threshold so confidence can factor in
  // the actual similarity (not just group size). OpenCode impl-review.
  const edges: SimilarityEdge[] = [];
  const seenPair = new Set<string>();
  function pairKey(a: HandlerCandidate, b: HandlerCandidate): string {
    // Stable two-key form regardless of iteration order. Identity is
    // (filePath, startLine) — never the candidate object itself, since
    // overlapping buckets put the same candidate in multiple bucket
    // arrays.
    const aId = `${a.filePath}:${a.startLine}`;
    const bId = `${b.filePath}:${b.startLine}`;
    return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
  }

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    if (bucket.length > MAX_BUCKET_SIZE) {
      if (process.env.KERN_DEBUG) {
        // Visible-by-debug skip so a user investigating "why no DRY
        // findings on my homogeneous routes" can spot saturation.
        console.warn(
          `[dry-duplicate-handlers] skipping bucket of size ${bucket.length} (max: ${MAX_BUCKET_SIZE}) — codebase too homogeneous in this shape band`,
        );
      }
      continue;
    }
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        // Same handler appearing twice in reports — not a duplicate.
        if (a.filePath === b.filePath && a.startLine === b.startLine) continue;
        const key = pairKey(a, b);
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        const score = jaccard(a.ngrams, b.ngrams);
        if (score >= SIMILARITY_THRESHOLD) {
          edges.push({ a, b, score });
          union(a, b);
        }
      }
    }
  }

  // Collect groups (root → members).
  const groups = new Map<HandlerCandidate, HandlerCandidate[]>();
  for (const c of candidates) {
    const root = find(c);
    const arr = groups.get(root);
    if (arr) arr.push(c);
    else groups.set(root, [c]);
  }
  // Pre-aggregate the max Jaccard per group root so the confidence
  // formula can read it in one lookup.
  const maxScoreByRoot = new Map<HandlerCandidate, number>();
  for (const e of edges) {
    const root = find(e.a);
    const prev = maxScoreByRoot.get(root) ?? 0;
    if (e.score > prev) maxScoreByRoot.set(root, e.score);
  }

  const findings: ReviewFinding[] = [];
  for (const [root, group] of groups) {
    if (group.length < 2) continue;
    // Stable primary: alphabetically-first by (file, line) so re-runs emit
    // the same fingerprint and don't churn in PR comment dedup.
    const sorted = [...group].sort((a, b) =>
      a.filePath !== b.filePath ? a.filePath.localeCompare(b.filePath) : a.startLine - b.startLine,
    );
    const primary = sorted[0]!;
    const others = sorted.slice(1);
    const relatedSpans: SourceSpan[] = others.map((o) => ({
      file: o.filePath,
      startLine: o.startLine,
      startCol: 1,
      endLine: o.startLine,
      endCol: 1,
    }));
    const locations = others.map((o) => `${o.filePath}:${o.startLine} (${o.fnName})`).join(', ');
    const maxScore = maxScoreByRoot.get(root) ?? SIMILARITY_THRESHOLD;
    // Confidence factors in BOTH the actual similarity (so 0.99 near-clones
    // rank higher than 0.80 marginal pairs) AND the group size (so 3+
    // matches signal more strongly than a pair). Capped at 80 — this rule
    // never reads as "definitely refactor this."
    const confidence = Math.min(80, Math.round(40 + maxScore * 30 + others.length * 4));
    findings.push({
      source: 'kern',
      ruleId: 'dry-duplicate-handlers',
      severity: 'info',
      category: 'structure',
      message: `Handler '${primary.fnName}' is ≥${Math.round(SIMILARITY_THRESHOLD * 100)}% structurally similar to ${others.length} other handler(s): ${locations}. Consider extracting a shared helper.`,
      primarySpan: {
        file: primary.filePath,
        startLine: primary.startLine,
        startCol: 1,
        endLine: primary.startLine,
        endCol: 1,
      },
      relatedSpans,
      fingerprint: createFingerprint(`dry-duplicate-handlers:${primary.filePath}`, primary.startLine, 1),
      confidence,
      suggestion: `Extract the shared logic into a shared helper fn that these handlers can call. KERN's value is structure — collapsing near-duplicates improves reviewability and reduces drift.`,
    });
  }

  return findings;
}

// ── Tokenizer ───────────────────────────────────────────────────────────

const TS_KEYWORDS = new Set([
  'abstract',
  'any',
  'as',
  'async',
  'await',
  'boolean',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'get',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'is',
  'keyof',
  'let',
  'module',
  'namespace',
  'never',
  'new',
  'null',
  'number',
  'object',
  'of',
  'package',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'set',
  'static',
  'string',
  'super',
  'switch',
  'symbol',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'unknown',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/;
const NUMBER_RE = /(?:0[xXbBoO][0-9a-fA-F_]+|[0-9][0-9_]*(?:\.[0-9_]+)?(?:[eE][-+]?[0-9]+)?)n?/;
const STRING_RE = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/;
// Punctuation kept as structural tokens. `#` (private class fields) and
// `@` (decorators) added per Gemini impl-review so class-based handlers
// don't lose discriminative tokens to the unknown-char fallback.
const PUNCT_RE = /[{}()[\];,.<>+\-*/%=!&|^~?:#@]/;

export function tokenizeNormalized(code: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < code.length) {
    const rest = code.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^[ \t\r\n]+/)) !== null) {
      i += m[0].length;
      continue;
    }
    // Strings BEFORE comments so `"http://example.com"` isn't truncated by
    // the comment-stripper. Gemini impl-review caught this regression.
    // STRING_RE has top-level alternation — wrap in (?:...) so `^` anchors
    // every alternative, not just the first.
    if ((m = rest.match(new RegExp(`^(?:${STRING_RE.source})`))) !== null) {
      tokens.push('$STR');
      i += m[0].length;
      continue;
    }
    // Line comment — skip to end of line.
    if (rest.startsWith('//')) {
      const nl = rest.indexOf('\n');
      i += nl < 0 ? rest.length : nl;
      continue;
    }
    // Block comment — skip to closing */. Falls back to end-of-input on
    // unterminated comments so the tokenizer always makes forward progress.
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/', 2);
      i += end < 0 ? rest.length : end + 2;
      continue;
    }
    if ((m = rest.match(new RegExp(`^(?:${NUMBER_RE.source})`))) !== null) {
      tokens.push('$NUM');
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(new RegExp(`^(?:${IDENT_RE.source})`))) !== null) {
      const word = m[0];
      // Keywords are structural — preserve. Identifiers collapse so two
      // handlers that differ only in variable names tokenize identically.
      tokens.push(TS_KEYWORDS.has(word) ? word : '$IDENT');
      i += word.length;
      continue;
    }
    if ((m = rest.match(new RegExp(`^(?:${PUNCT_RE.source})`))) !== null) {
      tokens.push(m[0]);
      i += m[0].length;
      continue;
    }
    // Skip unknown char rather than throw — keeps the tokenizer robust on
    // weird-but-real source. Known v1 limitations: regex literals
    // (`/foo/g`) and template literals with embedded expressions
    // (`` `x${y}` ``) tokenize imperfectly. v2 should switch to ts-morph.
    i += 1;
  }
  return tokens;
}

function countMeaningfulLines(code: string): number {
  let count = 0;
  for (const line of code.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
    count += 1;
  }
  return count;
}

function buildNgrams(tokens: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) {
    out.add(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  // Iterate the smaller set so the intersection check is cheap.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const tok of small) {
    if (large.has(tok)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const CONTROL_FLOW_KEYWORDS = new Set([
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'try',
  'catch',
  'finally',
  'return',
  'throw',
  'await',
  'yield',
]);

/**
 * Bucket keys — handlers must agree on the control-flow keyword set AND
 * be within one token-count band before we pay for a Jaccard pass.
 * Returns three adjacent bands (band-1, band, band+1) so 19-token and
 * 20-token near-duplicates still get compared instead of falling on
 * opposite sides of a hard cliff. Gemini impl-review identified the
 * original single-bucket version's silent-miss failure mode.
 */
function bucketSignatures(tokens: string[]): string[] {
  const band = Math.floor(tokens.length / 10);
  const cfKeywords = new Set<string>();
  for (const t of tokens) {
    if (CONTROL_FLOW_KEYWORDS.has(t)) cfKeywords.add(t);
  }
  const cfKey = [...cfKeywords].sort().join(',');
  const out = [`${band}|${cfKey}`, `${band + 1}|${cfKey}`];
  if (band > 0) out.push(`${band - 1}|${cfKey}`);
  return out;
}
