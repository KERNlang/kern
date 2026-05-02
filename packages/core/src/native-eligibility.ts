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
  // Destructuring declarations — slice 4d only supports `let name=X value=EXPR`
  // single-binding form. `const { a, b } = obj` and `let [x, y] = arr` would
  // need the slice 5b rewriter to expand into multiple let-bindings.
  /\b(?:const|let|var)\s*[{[]/,
  // Mutation / re-assignment — slice 4d's `let` lowers to `const`, and the
  // expression parser explicitly rejects `=` in expressions. Caught: `x++`,
  // `++x`, `x += 1`, `x -= 1`, `x *= 2`, `x /= 2`, `x %= 2`, `obj.x = 1`,
  // `arr[i] = v`, `delete obj.x`. Bare ident reassignment (`x = 1`) needs
  // line-leading detection to avoid colliding with `const x = 1` declarations.
  /\+\+|--/,
  /[+\-*/%]=/,
  /^\s*\w+(?:\.\w+|\[[^\]]+\])+\s*=[^=]/m,
  /^\s*\w+\s*=[^=>]/m,
  /\bdelete\s/,
  // Indexing (`xs[0]`, `arr[i]`, `arr[0][1]`) — slice 4d's expression parser
  // rejects lbracket in `parseCall`. Pattern matches an ident-char or `]`
  // immediately followed by `[`, no whitespace. Standalone array literals
  // (`[1, 2, 3]`) and `return [...]` (keyword + space + `[`) are not
  // matched because they don't have an ident-char directly adjacent to `[`.
  /[\w\]]\[/,
  // Other operators / keywords that slice 4d does not lower
  /\bvoid\s/,
  /\bdebugger\b/,
  /\bwith\s*\(/,
  /\beval\s*\(/,
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
 *  preserving line positions. Mirrors the behaviour of `parser-core.ts`
 *  `parseLines`: handles three shapes the parser accepts —
 *
 *    1. Inline single-line:   `handler <<< return 1; >>>`
 *    2. Open + close on diff: line ends with `<<<`, body lines, `>>>` line
 *    3. Tail-content close:   open line, body lines, `body; >>>` (close on
 *       same line as last body content)
 *
 *  Older versions of this extractor only matched shape 2, which made
 *  inline handlers invisible to scanners — `parseLines` was happy to
 *  parse them, but the future codemod (slice 5b) would never see them. */
export function extractRawBodies(content: string): RawBody[] {
  const bodies: RawBody[] = [];
  const lines = content.split('\n');
  let inBody = false;
  let buf: string[] = [];
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBody) {
      const openIdx = line.indexOf('<<<');
      if (openIdx === -1) continue;
      const afterOpen = line.slice(openIdx + 3);
      const closeIdx = afterOpen.indexOf('>>>');
      if (closeIdx !== -1) {
        // Shape 1: inline single-line `handler <<< body >>>`.
        bodies.push({ text: afterOpen.slice(0, closeIdx).trim(), startLine: i + 1, endLine: i + 1 });
        continue;
      }
      // Shape 2/3: multi-line block. parser-core.ts `parseLines` discards
      // content after `<<<` on the open line in this shape, only collecting
      // subsequent lines until `>>>`. Mirror that behaviour exactly so the
      // extractor and the parser agree on what counts as body content.
      inBody = true;
      buf = [];
      startLine = i + 1;
    } else {
      const closeIdx = line.indexOf('>>>');
      if (closeIdx === -1) {
        buf.push(line);
        continue;
      }
      const before = line.slice(0, closeIdx).trim();
      if (before.length > 0) buf.push(before);
      bodies.push({ text: buf.join('\n'), startLine, endLine: i + 1 });
      inBody = false;
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
