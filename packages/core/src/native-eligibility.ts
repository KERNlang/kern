/** Native KERN handler body eligibility classifier — slice 5a foundation
 *  (slice α-3 update: delegates to the AST walker in
 *  `native-eligibility-ast.ts`; slice α-4: diagnostic surfaces at `warning`).
 *
 *  Given a raw `<<<...>>>` handler body, determines whether it could compile
 *  under `lang="kern"` opt-in WITHOUT manual rewrite. Used by:
 *
 *    1. The compiler diagnostic layer (`parser-validate-native-eligible.ts`)
 *       to surface `warning`-level `NATIVE_KERN_ELIGIBLE` hints suggesting opt-in.
 *    2. The `kern migrate native-handlers` CLI (slice 5b) to bulk-convert.
 *    3. Empirical scans of real-world repos (e.g. Agon-AI) to measure the
 *       practical adoption ceiling for native bodies.
 *
 *  Slice α-3: replaced the regex pre-screen with a TS-AST walk that mirrors
 *  the migrator's `mapStatement` rules. Eligibility now equals migrate-success
 *  by construction — the prerequisite for slice α-4's promotion of
 *  `NATIVE_KERN_ELIGIBLE` from `info` to `warning` without producing
 *  fix-or-suppress noise on bodies the migrator silently bails on.
 *
 *  The legacy regex disqualifier set lives at `LEGACY_NEG_PATTERNS` for
 *  consumers that need a fast pre-filter (no TS parse). The canonical
 *  classifier (`classifyHandlerBody`) uses the AST walker.
 */

import { classifyHandlerBodyAst } from './native-eligibility-ast.js';

/** Result of classifying a single handler body. */
export interface EligibilityResult {
  /** True iff the body uses ONLY syntactic patterns that lang=kern supports. */
  eligible: boolean;
  /** When eligible: `'empty'` (whitespace-only body) or `'ok'` (passed AST walk).
   *  When ineligible: a kebab-case slug naming the first blocking shape —
   *  e.g. `'var-destructure'`, `'try-finally'`, `'expr-stmt-mutation'`,
   *  `'comments-present'`, `'ts-parse-error'`. See
   *  `native-eligibility-ast.ts` for the full set. The legacy regex source
   *  (e.g. `'\\bfor\\s*\\('`) is no longer surfaced — older callers that
   *  switched on the regex string need to migrate to the new slugs. */
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

/** Slice α-3: legacy regex disqualifier set. Kept exported for fast
 *  pre-filtering (no TS parse) in tools that don't need precise reasons —
 *  e.g. histogram scanners that only want a coarse "ineligible" signal.
 *  The canonical classifier (`classifyHandlerBody`) no longer uses this set;
 *  it delegates to the AST walker in `native-eligibility-ast.ts`. */
export const LEGACY_NEG_PATTERNS: ReadonlyArray<RegExp> = [
  /=>/,
  /\bfunction\b/,
  /\bclass\s+\w/,
  /\byield\b/,
  /\bfor\s*\(/,
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
  // Mutation forms that native KERN does not lower yet. Plain `=` assignment
  // is supported by the `assign` body-statement; compound assignment and
  // increment/decrement remain separate future features.
  /\+\+|--/,
  /[+\-*/%]=/,
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

/** Classify a single raw body. Slice α-3: delegates to the AST walker so
 *  eligibility ≡ migrate-success by construction. */
export function classifyHandlerBody(rawBody: string): EligibilityResult {
  return classifyHandlerBodyAst(rawBody);
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
