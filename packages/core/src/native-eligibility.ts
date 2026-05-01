/** Native KERN handler body eligibility classifier — slice 5a foundation.
 *
 *  Given a raw `<<<...>>>` handler body, determines whether it could compile
 *  under `lang="kern"` opt-in WITHOUT manual rewrite. Used by:
 *
 *    1. The compiler diagnostic layer (parser-validate-propagation siblings)
 *       to surface `info`-level hints suggesting opt-in.
 *    2. The future `kern migrate native-handlers` CLI (slice 5b) to bulk-convert.
 *    3. Empirical scans of real-world repos (e.g. Agon-AI) to measure the
 *       practical adoption ceiling for native bodies.
 *
 *  The classifier is INTENTIONALLY HEURISTIC — full eligibility requires the
 *  type-aware AST walk that slice 5b's rewriter performs. False positives here
 *  surface as compile errors when the user opts in; false negatives just
 *  deflate the suggestion rate. We err toward false negatives so the
 *  diagnostic stays trustworthy ("if I see this hint, opting in WILL work").
 *
 *  Slice 4d update: removed `try` / `catch` / `throw` / `finally`, `new`
 *  keyword, and `??` walrus from the disqualifier list — those landed in
 *  slice 4c+4d ship. Object spread is allowed; argument spread (`f(...x)`)
 *  is still gated since slice 4d only lowered the object-literal form.
 */

/** Result of classifying a single handler body. */
export interface EligibilityResult {
  /** True iff the body uses ONLY syntactic patterns that lang=kern supports. */
  eligible: boolean;
  /** When eligible: 'empty' (whitespace-only body) or 'no-disqualifier'.
   *  When ineligible: the source of the matching disqualifier regex (e.g.
   *  '\\bfor\\s*\\('). Surfaces in diagnostics + migrate reports so users
   *  can see what's blocking. */
  reason: string;
}

/** A raw `<<<…>>>` handler body extracted from a `.kern` source file,
 *  with line positions for diagnostic anchoring. */
export interface RawBody {
  /** Body content between `<<<` and `>>>` (no surrounding fence lines). */
  text: string;
  /** 1-indexed line number of the `<<<` opener. */
  startLine: number;
  /** 1-indexed line number of the `>>>` closer. */
  endLine: number;
}

/** Aggregate eligibility report for a single file. */
export interface FileEligibilityReport {
  totalBodies: number;
  eligibleBodies: number;
  /** Per-body classification with line positions. Same length + ordering
   *  as the bodies returned by `extractRawBodies(content)`. */
  bodies: Array<RawBody & EligibilityResult>;
}

/** Patterns that disqualify a raw JS-like body from compiling under
 *  `lang="kern"` without manual rewrite. Order doesn't affect correctness
 *  but the first match wins and is reported as the `reason`. */
const NEG_PATTERNS: ReadonlyArray<RegExp> = [
  /=>/,
  /\bfunction\b/,
  /\bclass\s+\w/,
  /\byield\b/,
  /\bfor\s*\(/,
  /\bwhile\s*\(/,
  /\bdo\s*\{/,
  /\bswitch\s*\(/,
  /\btypeof\b/,
  /\binstanceof\b/,
  /^\s*import\b/m,
  /\brequire\(/,
  /\bthis\.\w+\s*=/,
  /\bconsole\.\w/,
  /\bprocess\.\w/,
  /\bBuffer\b/,
  /\bglobalThis\b/,
  /\bres\.\w/,
  /\breq\.\w/,
  /\bnext\(/,
  /\bJSON\.\w/,
  /\(\s*\.{3}/,
  /\/\w+\/[gimsy]*/,
];

/** Classify a single raw body. */
export function classifyHandlerBody(rawBody: string): EligibilityResult {
  const trimmed = rawBody.trim();
  if (trimmed === '') return { eligible: true, reason: 'empty' };
  for (const pat of NEG_PATTERNS) {
    if (pat.test(rawBody)) return { eligible: false, reason: pat.source };
  }
  return { eligible: true, reason: 'no-disqualifier' };
}

/** Walk a `.kern` source file's text and pull out every `<<< … >>>` body,
 *  preserving line positions. The terminator must be `>>>` on its own line
 *  (matches the convention enforced by parser-tokenizer). */
export function extractRawBodies(content: string): RawBody[] {
  const bodies: RawBody[] = [];
  const lines = content.split('\n');
  let inBody = false;
  let buf: string[] = [];
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBody) {
      if (line.trimEnd().endsWith('<<<')) {
        inBody = true;
        buf = [];
        startLine = i + 1;
      }
    } else {
      if (line.trim() === '>>>') {
        bodies.push({ text: buf.join('\n'), startLine, endLine: i + 1 });
        inBody = false;
      } else {
        buf.push(line);
      }
    }
  }
  return bodies;
}

/** Convenience: classify every raw body in a file's content and aggregate
 *  the totals. Pure function — no FS access; callers (scanners, the CLI)
 *  pass the file text. */
export function scanFileForEligibility(content: string): FileEligibilityReport {
  const raw = extractRawBodies(content);
  let eligibleBodies = 0;
  const bodies = raw.map((body) => {
    const result = classifyHandlerBody(body.text);
    if (result.eligible) eligibleBodies++;
    return { ...body, ...result };
  });
  return { totalBodies: raw.length, eligibleBodies, bodies };
}
