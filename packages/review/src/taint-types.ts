/**
 * Taint Tracking — shared types, classification tables, and sanitizer sufficiency.
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface TaintSource {
  name: string; // Variable name (e.g., "req", "userId")
  origin: string; // Where it came from (e.g., "req.body", "req.query.id")
  line?: number; // Approximate line in handler body
}

export interface TaintSink {
  name: string; // Sink function (e.g., "exec", "writeFileSync")
  category: 'command' | 'fs' | 'sql' | 'redirect' | 'eval' | 'template' | 'codegen' | 'ssrf' | 'nosql';
  taintedArg: string; // The tainted variable used in the call
  line?: number;
}

export interface TaintPath {
  source: TaintSource;
  sink: TaintSink;
  sanitized: boolean;
  sanitizer?: string; // What sanitized it (e.g., "parseInt", "schema.parse")
  insufficientSanitizer?: string; // Sanitizer present but wrong for this sink type
}

export interface TaintResult {
  fnName: string;
  filePath: string;
  startLine: number;
  paths: TaintPath[];
}

export interface CrossFileTaintResult {
  callerFile: string;
  callerFn: string;
  callerLine: number;
  calleeFile: string;
  calleeFn: string;
  taintedArgs: string[]; // Which args are tainted
  sinkInCallee: TaintSink; // The sink reached in the callee
  source: TaintSource; // Original taint source
}

/** Map of exported function names → file path + param info */
export interface ExportedFunction {
  filePath: string;
  fnName: string;
  params: string; // Raw params string
  hasSink: boolean; // Does this function contain a dangerous sink?
  sinks: TaintSink[];
}

// ── Intra-File Call Graph (for interprocedural taint) ────────────────────

/** A function in the file that contains sinks — tracks which params flow to those sinks */
export interface InternalSinkFunction {
  name: string;
  /** Parameter indices whose values reach a sink in the function body */
  taintedParamIndices: Set<number>;
  /** Sink categories reachable from each param index (multiple categories per param) */
  sinkCategories: Map<number, Set<TaintSink['category']>>;
}

// ── Source Classification ────────────────────────────────────────────────

/** Param names/types that indicate HTTP handler context */
export const HTTP_PARAM_NAMES = /^(req|request)$/i;
// Word-boundary anchored to avoid matching identifier substrings like
// `UserRequest` or `InternalRequest` (Codex plan-review). NextRequest and
// NextApiRequest cover Next.js App Router and Pages Router respectively.
export const HTTP_PARAM_TYPES =
  /\b(Request|NextRequest|NextApiRequest|IncomingMessage|FastifyRequest|KoaContext|Context)\b/;

/**
 * Verb-named exports that Next.js App Router treats as HTTP route handlers
 * (`app/**\/route.{ts,tsx,js,jsx}` exports `GET` / `POST` / …). When the
 * file path matches a route file, the engine treats the first param of any
 * such export as tainted regardless of its type annotation — covers untyped
 * App Router handlers like `export async function GET(r) { … }`.
 */
export const NEXTJS_ROUTE_VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/**
 * File-path predicate for Next.js HTTP entry points.
 * - App Router:  `**\/app/route.{ts,tsx,js,jsx}` (root) and
 *                `**\/app/**\/route.{ts,tsx,js,jsx}` (nested)
 * - Pages Router: `**\/pages/api/**\/*.{ts,tsx,js,jsx}`
 *
 * Accepts both absolute (`/repo/app/api/x/route.ts`) and relative
 * (`app/api/x/route.ts`) forms by anchoring the `app` / `pages` segment
 * either at string start or after a path separator. The intermediate
 * segment between `app/` and `route` is optional so the root handler
 * `app/route.ts` matches (Codex impl-review).
 */
export const NEXTJS_ROUTE_FILE_RE = /(?:^|[\\/])(?:app[\\/](?:.*[\\/])?route\.(?:ts|tsx|js|jsx)$|pages[\\/]api[\\/])/;

/** User input access patterns — what flows from HTTP params */
export const USER_INPUT_ACCESS = [
  { pattern: /\breq\.body\b/, origin: 'req.body' },
  { pattern: /\breq\.query\b/, origin: 'req.query' },
  { pattern: /\breq\.params\b/, origin: 'req.params' },
  { pattern: /\breq\.headers\b/, origin: 'req.headers' },
  { pattern: /\brequest\.body\b/, origin: 'request.body' },
  { pattern: /\brequest\.query\b/, origin: 'request.query' },
  { pattern: /\brequest\.params\b/, origin: 'request.params' },
  { pattern: /\bprocess\.argv\b/, origin: 'process.argv' },
  { pattern: /\bprocess\.env\b/, origin: 'process.env' },
  // DB read results (indirect injection sources)
  { pattern: /\bdb\.query\b/, origin: 'db.query' },
  { pattern: /\bfindOne\b/, origin: 'findOne' },
  { pattern: /\bfindById\b/, origin: 'findById' },
  { pattern: /\bgetItem\b/, origin: 'getItem' },
  { pattern: /\bcollection\.find\b/, origin: 'collection.find' },
  // RAG/retrieval results
  { pattern: /\bvectorStore\.search\b/, origin: 'vectorStore.search' },
  { pattern: /\bsimilaritySearch\b/, origin: 'similaritySearch' },
  { pattern: /\bindex\.query\b/, origin: 'index.query' },
] as const;

// ── Sink Classification ─────────────────────────────────────────────────

export interface SinkPattern {
  pattern: RegExp;
  name: string;
  category: TaintSink['category'];
}

export const SINK_PATTERNS: SinkPattern[] = [
  // Command-class sink scanners. The regex path can't see types, so it
  // can't distinguish a command call from `RegExp.prototype.exec(...)`.
  // Lookbehinds reject ANY dotted call to kill the regex.exec false
  // positive seen in production (kern-guard PR #316 via taint-crossfile,
  // where AST-level symbol resolution isn't available). Cost: recall on
  // aliased module bindings in cross-file mode. Accepted per the brief —
  // FN here is much rarer than the FP cost in production review.
  { pattern: /(?<![.\w])exec\s*\(/, name: 'exec', category: 'command' },
  { pattern: /(?<![.\w])execSync\s*\(/, name: 'execSync', category: 'command' },
  { pattern: /(?<![.\w])spawn\s*\(/, name: 'spawn', category: 'command' },
  { pattern: /(?<![.\w])spawnSync\s*\(/, name: 'spawnSync', category: 'command' },
  { pattern: /(?<![.\w])execFile\s*\(/, name: 'execFile', category: 'command' },
  // Filesystem
  { pattern: /\bwriteFile\s*\(/, name: 'writeFile', category: 'fs' },
  { pattern: /\bwriteFileSync\s*\(/, name: 'writeFileSync', category: 'fs' },
  { pattern: /\bcreateWriteStream\s*\(/, name: 'createWriteStream', category: 'fs' },
  { pattern: /\bunlink\s*\(/, name: 'unlink', category: 'fs' },
  { pattern: /\bunlinkSync\s*\(/, name: 'unlinkSync', category: 'fs' },
  // SQL (template literal with query-like calls)
  { pattern: /\bquery\s*\(/, name: 'query', category: 'sql' },
  { pattern: /\b\$execute\s*\(/, name: '$execute', category: 'sql' },
  { pattern: /\braw\s*\(/, name: 'raw', category: 'sql' },
  // Redirect
  { pattern: /\bredirect\s*\(/, name: 'redirect', category: 'redirect' },
  // Eval
  { pattern: /\beval\s*\(/, name: 'eval', category: 'eval' },
  { pattern: /\bnew\s+Function\s*\(/, name: 'new Function', category: 'eval' },
  // LLM API calls (prompt injection sinks)
  { pattern: /\bgenerateContent\s*\(/, name: 'generateContent', category: 'template' },
  { pattern: /\bsendMessage\s*\(/, name: 'sendMessage', category: 'template' },
  { pattern: /\bchat\.completions\.create\s*\(/, name: 'chat.completions.create', category: 'template' },
  // VM execution sinks (LLM output execution)
  { pattern: /\bvm\.runInContext\s*\(/, name: 'vm.runInContext', category: 'eval' },
  { pattern: /\bvm\.runInNewContext\s*\(/, name: 'vm.runInNewContext', category: 'eval' },
  // Code generation sinks — external values interpolated into generated source code
  { pattern: /\blines\.push\s*\(`/, name: 'lines.push(template)', category: 'codegen' },
  { pattern: /\bhelperBlock\.push\s*\(`/, name: 'helperBlock.push(template)', category: 'codegen' },
  { pattern: /\bcode\s*\+=\s*`/, name: 'code += template', category: 'codegen' },
  // SSRF — outbound HTTP request sinks
  { pattern: /\bfetch\s*\(/, name: 'fetch', category: 'ssrf' },
  { pattern: /\baxios\s*\(/, name: 'axios', category: 'ssrf' },
  { pattern: /\baxios\.(get|post|put|delete|patch|head|request)\s*\(/, name: 'axios.request', category: 'ssrf' },
  { pattern: /\bgot\s*\(/, name: 'got', category: 'ssrf' },
  { pattern: /\bgot\.(get|post|put|delete|patch|head)\s*\(/, name: 'got.request', category: 'ssrf' },
  { pattern: /\bhttp\.request\s*\(/, name: 'http.request', category: 'ssrf' },
  { pattern: /\bhttps\.request\s*\(/, name: 'https.request', category: 'ssrf' },
  { pattern: /\bundici\.(fetch|request)\s*\(/, name: 'undici.request', category: 'ssrf' },
  // SQL — raw query sinks beyond generic `query`
  { pattern: /\$queryRawUnsafe\s*\(/, name: '$queryRawUnsafe', category: 'sql' },
  { pattern: /\$queryRaw\s*\(/, name: '$queryRaw', category: 'sql' },
  { pattern: /\bsequelize\.query\s*\(/, name: 'sequelize.query', category: 'sql' },
  // NOTE: crypto sinks are handled by bespoke rules in rules/security-v5.ts
  // (crypto-iv-reuse, crypto-weak-kdf). Adding them as generic taint sinks
  // would flag normal password input to pbkdf2() as "misuse" — passwords ARE
  // user input by design. The dedicated rules check the specific arg positions
  // that actually indicate misuse (literal IV, iterations < 100k).
];

// ── Sanitizer Detection ─────────────────────────────────────────────────

export const SANITIZER_PATTERNS = [
  // Type coercion (sanitizes to safe type)
  { pattern: /\bparseInt\s*\(/, name: 'parseInt' },
  { pattern: /\bparseFloat\s*\(/, name: 'parseFloat' },
  { pattern: /\bNumber\s*\(/, name: 'Number()' },
  { pattern: /\bBoolean\s*\(/, name: 'Boolean()' },
  // Schema validation
  { pattern: /\.parse\s*\(/, name: 'schema.parse' },
  { pattern: /\.safeParse\s*\(/, name: 'schema.safeParse' },
  { pattern: /\.validate\s*\(/, name: 'schema.validate' },
  { pattern: /\.validateSync\s*\(/, name: 'schema.validateSync' },
  // String sanitization
  { pattern: /\bsanitize\w*\s?\(/, name: 'sanitize()' },
  { pattern: /\bescape\w*\s?\(/, name: 'escape()' },
  { pattern: /\bDOMPurify\b/, name: 'DOMPurify' },
  { pattern: /\bencodeURI(Component)?\s*\(/, name: 'encodeURIComponent' },
  // Path sanitization
  { pattern: /path\.(resolve|normalize|basename)\s*\(/, name: 'path.normalize' },
  { pattern: /\.replace\s*\(\s*\/.*\.\.\//, name: 'replace(../)' },
  // SQL parameterization
  { pattern: /\$\d+/, name: 'parameterized query ($N)' },
  { pattern: /\?\s*,/, name: 'parameterized query (?)' },
  // Prompt sanitization
  { pattern: /\bsanitizeForPrompt\s*\(/, name: 'sanitizeForPrompt' },
  { pattern: /\bescapePrompt\s*\(/, name: 'escapePrompt' },
  // LLM-specific sanitizers
  { pattern: /\bstripDelimiters\s*\(/, name: 'stripDelimiters' },
  { pattern: /\bcleanForPrompt\s*\(/, name: 'cleanForPrompt' },
];

// ── Sanitizer Sufficiency Matrix ──────────────────────────────────────────
// Not all sanitizers work for all sink types. parseInt prevents SQL injection
// on numeric values but does nothing for command injection.

export type SinkCategory = TaintSink['category'];

/**
 * The closed list of categories that a "covers everything" sanitizer
 * (e.g., `schema.safeParse`) is asserted to protect against. Pinned by
 * design: when a new category is added (last release: `nosql`), every
 * sanitizer family that should cover it is updated EXPLICITLY here. We
 * deliberately don't auto-propagate — a new category like `xpath` should
 * default to "no sanitizer covers it yet" until each family is verified
 * to actually neutralize that injection vector. Security-conservative.
 *
 * NOTE — `codegen` is intentionally OMITTED from this list (and was also
 * omitted in the prior flat shape). Structural validation (Zod/Yup
 * `.parse()`) does NOT inherently neutralize code-generation injection:
 * a validated string field can still contain characters that break out of
 * a source-code template. Adding `codegen` here would silently downgrade
 * codegen findings on `schema.parse(input)` shapes.
 */
export const ALL_CATEGORIES = [
  'command',
  'fs',
  'sql',
  'redirect',
  'eval',
  'template',
  'ssrf',
  'nosql',
] as const satisfies ReadonlyArray<SinkCategory>;

/**
 * Family-keyed sanitizer table. Each entry groups names that share the
 * same coverage set, so adding a new category (`nosql`, `xpath`, …) is
 * a single edit per family rather than N edits across N duplicated
 * entries.
 *
 * BARE-key design rule (preserved from the prior flat shape):
 * SANITIZER_PATTERN_NAMES emits bare names (`safeParse`, `parse`);
 * SANITIZER_PATTERNS (regex) emits prefixed names (`schema.safeParse`,
 * `path.normalize`). Both call `isSanitizerSufficient()`, so each
 * family's `names` array carries BOTH forms when relevant. We
 * intentionally OMIT bare keys for ambiguous methods (bare `parse`,
 * `validate`, `normalize`, `resolve`, `basename`) — a user's custom
 * `.parse()` or `.normalize()` would otherwise be silently treated as
 * a full sanitizer, producing false negatives on real taint bugs.
 * `safeParse` is distinctive enough (Zod/Yup-specific) to keep bare.
 *
 * TODO(tier-followup): dedupe `SANITIZER_PATTERN_NAMES` (line ~398
 * below) against this table — today they drift independently, so a
 * sanitizer added to one but not the other gets silent
 * detection/coverage skew. Out of scope for the family refactor.
 */
const SANITIZER_FAMILIES: ReadonlyArray<{
  names: ReadonlyArray<string>;
  coverage: ReadonlyArray<SinkCategory>;
  /** Why this coverage was chosen — audit log for the security decision. */
  rationale?: string;
}> = [
  {
    names: ['parseInt', 'parseFloat', 'Number', 'Number()'],
    coverage: ['sql'],
    rationale: 'Numeric coercion neutralizes SQL string injection; useless for command/path/template payloads.',
  },
  {
    names: ['Boolean', 'Boolean()'],
    coverage: [],
    rationale: 'Truthy-coercion provides no injection protection — listed empty so the rule still fires.',
  },
  {
    names: ['schema.parse', 'schema.safeParse', 'safeParse', 'schema.validate', 'schema.validateSync'],
    coverage: ALL_CATEGORIES,
    rationale:
      'Zod/Yup-style structural validation rejects malformed payloads at the boundary, killing all known injection categories — including operator-injection objects (`{$gt:""}`) that bypass NoSQL string-only sanitizers.',
  },
  {
    names: ['sanitize()', 'sanitize'],
    coverage: ['template'],
    rationale: 'Generic HTML sanitizer — covers DOM/template injection only, not SQL or shell.',
  },
  {
    names: ['escape()', 'escape'],
    coverage: ['sql', 'template'],
    rationale: 'String-escape covers HTML and basic SQL string contexts; insufficient for command/eval.',
  },
  {
    names: ['escapeHtml', 'DOMPurify', 'purify', 'xss'],
    coverage: ['template'],
    rationale: 'HTML/XSS-specific sanitizers — DOM injection only.',
  },
  {
    names: ['encodeURIComponent', 'encodeURI'],
    coverage: ['redirect'],
    rationale:
      'URI-encoding prevents open-redirect via path manipulation; does NOT prevent SSRF (attacker still controls the host).',
  },
  {
    names: ['path.normalize', 'path.resolve', 'path.basename', 'replace(../)'],
    coverage: ['fs'],
    rationale:
      'Path normalization neutralizes traversal (`../`) sequences before file IO. Bare names omitted — a user `.normalize()` is not provably path-safe.',
  },
  {
    names: ['parameterized query ($N)', 'parameterized query (?)', 'parameterized', 'sqlstring'],
    coverage: ['sql'],
    rationale: 'SQL placeholder substitution is the canonical fix for SQL injection.',
  },
  {
    names: ['sanitizeForPrompt', 'escapePrompt', 'stripDelimiters', 'cleanForPrompt'],
    coverage: ['template'],
    rationale: 'LLM-prompt sanitizers — strip delimiters to prevent prompt injection in templates.',
  },
];

/**
 * Build a sanitizer-name → coverage-set lookup map from a family table.
 * Exported so tests can exercise the duplicate-name-throws contract
 * without round-tripping through the module-init IIFE. Module load
 * silently failing on a duplicate would let a security-policy error
 * land via merge — explicit throw forces it to a CI failure.
 */
export function buildSanitizerSufficiency(
  families: ReadonlyArray<{ names: ReadonlyArray<string>; coverage: ReadonlyArray<SinkCategory> }>,
): Record<string, Set<SinkCategory>> {
  const map: Record<string, Set<SinkCategory>> = {};
  for (const family of families) {
    const set = new Set<SinkCategory>(family.coverage);
    for (const name of family.names) {
      if (map[name] !== undefined) {
        throw new Error(
          `SANITIZER_FAMILIES: name "${name}" appears in more than one family — would silently overwrite coverage.`,
        );
      }
      map[name] = set;
    }
  }
  return map;
}

const SANITIZER_SUFFICIENCY: Record<string, Set<SinkCategory>> = buildSanitizerSufficiency(SANITIZER_FAMILIES);

/**
 * Check if a sanitizer is actually sufficient for a given sink category.
 * Returns true if the sanitizer protects against the sink, false if it's
 * a mismatch (e.g., parseInt used to "sanitize" command injection) or if the
 * sanitizer name is unrecognized (default-deny so real taint still fires).
 */
export function isSanitizerSufficient(sanitizerName: string, sinkCategory: SinkCategory): boolean {
  const allowed = SANITIZER_SUFFICIENCY[sanitizerName];
  if (!allowed) return false; // Unknown sanitizer — default deny, verify manually
  return allowed.has(sinkCategory);
}

// ── Derived Lookup Tables ───────────────────────────────────────────────

// Sink name → category lookup (flat map from SINK_PATTERNS)
export const SINK_NAMES = new Map<string, TaintSink['category']>([
  ['exec', 'command'],
  ['execSync', 'command'],
  ['spawn', 'command'],
  ['spawnSync', 'command'],
  ['execFile', 'command'],
  ['execFileSync', 'command'],
  ['readFile', 'fs'],
  ['readFileSync', 'fs'],
  ['writeFile', 'fs'],
  ['writeFileSync', 'fs'],
  ['createWriteStream', 'fs'],
  ['createReadStream', 'fs'],
  ['unlink', 'fs'],
  ['unlinkSync', 'fs'],
  ['query', 'sql'],
  ['$execute', 'sql'],
  ['raw', 'sql'],
  ['$queryRaw', 'sql'],
  ['$queryRawUnsafe', 'sql'],
  ['sequelize.query', 'sql'],
  ['redirect', 'redirect'],
  ['eval', 'eval'],
  ['Function', 'eval'],
  // SSRF — outbound HTTP request sinks
  ['fetch', 'ssrf'],
  ['axios', 'ssrf'],
  ['axios.get', 'ssrf'],
  ['axios.post', 'ssrf'],
  ['axios.put', 'ssrf'],
  ['axios.delete', 'ssrf'],
  ['axios.patch', 'ssrf'],
  ['axios.request', 'ssrf'],
  ['got', 'ssrf'],
  ['http.request', 'ssrf'],
  ['https.request', 'ssrf'],
  ['undici.fetch', 'ssrf'],
  ['undici.request', 'ssrf'],
]);

// ── NoSQL (MongoDB / Mongoose) sinks — receiver-aware ──────────────────
//
// MongoDB query methods share names with `Array.prototype` (`find`,
// `findOne`-isn't-in-array but `.filter`/`.map` etc. clash conceptually) —
// adding them flat to SINK_NAMES would FP on every JS array call. This
// table is consumed by a receiver gate in taint-ast.ts that requires:
//   1. Capitalized identifier receiver (Mongoose model: `User.find(...)`)
//   2. `.collection(name)` chain (Mongo driver: `db.collection('x').find(...)`)
//   3. Receiver name in {db, conn, collection} for assigned-collection
//      shapes (`const users = db.collection('users'); users.find(...)`)
//
// Each method maps to the arg indexes that carry user-controllable query
// shapes. `find(query, projection?, options?)` only treats arg 0 as the
// query filter; flagging projection/options would FP on safe configs.
// `updateOne(filter, update, options?)` treats both arg 0 (filter) and
// arg 1 (update document) — both are exploitable injection surfaces.
//
// `findById` is intentionally restricted to OBJECT-shaped tainted args:
// `findById(req.params.id)` with a string is not classic operator
// injection (Mongo treats the string as a literal `_id` value), only
// `req.body.id` / `req.query.id` parsed as objects (e.g. via qs
// `extended: true`) are exploitable.
export const NOSQL_QUERY_ARG_INDEXES: Record<string, ReadonlySet<number>> = {
  find: new Set([0]),
  findOne: new Set([0]),
  findById: new Set([0]),
  findOneAndUpdate: new Set([0, 1]),
  findOneAndReplace: new Set([0, 1]),
  findOneAndDelete: new Set([0]),
  findByIdAndUpdate: new Set([0, 1]),
  findByIdAndDelete: new Set([0]),
  updateOne: new Set([0, 1]),
  updateMany: new Set([0, 1]),
  replaceOne: new Set([0, 1]),
  deleteOne: new Set([0]),
  deleteMany: new Set([0]),
  count: new Set([0]),
  countDocuments: new Set([0]),
  aggregate: new Set([0]),
  where: new Set([0]),
  exists: new Set([0]),
  equals: new Set([0]),
  gt: new Set([0, 1]),
  gte: new Set([0, 1]),
  lt: new Set([0, 1]),
  lte: new Set([0, 1]),
  ne: new Set([0, 1]),
  in: new Set([0, 1]),
  nin: new Set([0, 1]),
  all: new Set([0, 1]),
  size: new Set([0, 1]),
  regex: new Set([0, 1]),
  elemMatch: new Set([0, 1]),
};

/** Receiver names that signal a Mongo collection without capitalization. */
export const NOSQL_RECEIVER_ALLOWLIST = new Set(['db', 'conn', 'collection']);

/** Methods whose findById-style scalar `req.params` should NOT fire (string isn't classic operator injection). */
export const NOSQL_METHODS_REQUIRING_OBJECT_TAINT = new Set(['findById', 'findByIdAndUpdate', 'findByIdAndDelete']);

// Sanitizer names to detect (from SANITIZER_PATTERNS)
export const SANITIZER_PATTERN_NAMES = [
  'parseInt',
  'parseFloat',
  'Number',
  'Boolean',
  'String',
  'encodeURI',
  'encodeURIComponent',
  'escape',
  'sanitize',
  'DOMPurify',
  'purify',
  'xss',
  'escapeHtml',
  'sqlstring',
  'parameterized',
  'parse',
  'safeParse',
  'validate',
];
