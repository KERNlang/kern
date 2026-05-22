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
  /** Raw opener text before `<<<`, when present. */
  opener?: string;
  /** Parsed `lang=` value from the opener, when present. */
  declaredLang?: string;
  /** Parsed `reason=` value from the opener, when present. */
  declaredReason?: string;
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

const FOREIGN_HANDLER_LANGS = new Set(['ts', 'typescript', 'js', 'javascript', 'python', 'py']);

interface FenceScanState {
  inQuote: boolean;
  quoteChar: '"' | "'" | '`' | null;
  exprDepth: number;
}

function createFenceScanState(): FenceScanState {
  return { inQuote: false, quoteChar: null, exprDepth: 0 };
}

function indexOfFenceOutsideQuotes(
  content: string,
  fence: '<<<' | '>>>',
  state: FenceScanState = createFenceScanState(),
): number {
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '\\' && state.inQuote) {
      i++;
      continue;
    }
    if ((ch === '"' || ch === "'" || ch === '`') && (!state.inQuote || ch === state.quoteChar)) {
      if (state.inQuote) {
        state.inQuote = false;
        state.quoteChar = null;
      } else {
        state.inQuote = true;
        state.quoteChar = ch as '"' | "'" | '`';
      }
      continue;
    }
    if (state.inQuote) continue;

    if (ch === '{' && next === '{') {
      state.exprDepth++;
      i++;
      continue;
    }
    if (ch === '}' && next === '}' && state.exprDepth > 0) {
      state.exprDepth--;
      i++;
      continue;
    }
    if (state.exprDepth > 0) continue;

    if (content.startsWith(fence, i)) return i;
  }

  return -1;
}

function parseBoundaryProp(opener: string, propName: string): string | undefined {
  const quoted = new RegExp(`(?:^|\\s)${propName}="([^"]*)"`).exec(opener);
  if (quoted) return quoted[1];
  const bare = new RegExp(`(?:^|\\s)${propName}=([^\\s]+)`).exec(opener);
  return bare?.[1];
}

function annotateRawBody(text: string, startLine: number, endLine: number, opener: string): RawBody {
  return {
    text,
    startLine,
    endLine,
    opener: opener.trim(),
    declaredLang: parseBoundaryProp(opener, 'lang'),
    declaredReason: parseBoundaryProp(opener, 'reason'),
  };
}

export function isExplicitForeignRawBody(body: Pick<RawBody, 'declaredLang' | 'declaredReason' | 'opener'>): boolean {
  const opener = body.opener?.trim();
  if (opener && !/^handler\b/.test(opener)) return false;
  const lang = body.declaredLang?.trim().toLowerCase();
  const reason = body.declaredReason?.trim();
  return Boolean(lang && reason && FOREIGN_HANDLER_LANGS.has(lang));
}

/** Classify a single raw body. Slice α-3: delegates to the AST walker so
 *  eligibility ≡ migrate-success by construction. */
export function classifyHandlerBody(rawBody: string, opts?: { allowNonBlock?: boolean }): EligibilityResult {
  return classifyHandlerBodyAst(rawBody, opts);
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
  let opener = '';
  let closeScanState = createFenceScanState();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBody) {
      const openIdx = indexOfFenceOutsideQuotes(line, '<<<');
      if (openIdx === -1) continue;
      const afterOpen = line.slice(openIdx + 3);
      const closeIdx = indexOfFenceOutsideQuotes(afterOpen, '>>>');
      if (closeIdx !== -1) {
        // Shape 1: inline single-line `handler <<< body >>>`.
        bodies.push(annotateRawBody(afterOpen.slice(0, closeIdx).trim(), i + 1, i + 1, line.slice(0, openIdx)));
        continue;
      }
      // Shape 2/3: multi-line block. parser-core.ts `parseLines` discards
      // content after `<<<` on the open line in this shape, only collecting
      // subsequent lines until `>>>`. Mirror that behaviour exactly so the
      // extractor and the parser agree on what counts as body content.
      inBody = true;
      buf = [];
      startLine = i + 1;
      opener = line.slice(0, openIdx);
      closeScanState = createFenceScanState();
    } else {
      const closeIdx = indexOfFenceOutsideQuotes(line, '>>>', closeScanState);
      if (closeIdx === -1) {
        buf.push(line);
        continue;
      }
      const before = line.slice(0, closeIdx).trim();
      if (before.length > 0) buf.push(before);
      bodies.push(annotateRawBody(buf.join('\n'), startLine, i + 1, opener));
      inBody = false;
      opener = '';
      closeScanState = createFenceScanState();
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
    const result = isExplicitForeignRawBody(body)
      ? { eligible: false, reason: 'explicit-foreign' }
      : classifyHandlerBody(body.text);
    if (result.eligible) eligibleBodies++;
    return { ...body, ...result };
  });
  return { totalBodies: raw.length, eligibleBodies, bodies };
}
