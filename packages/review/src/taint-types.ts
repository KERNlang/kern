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
  category: 'command' | 'fs' | 'sql' | 'redirect' | 'eval' | 'template' | 'codegen' | 'ssrf';
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
export const HTTP_PARAM_TYPES = /Request|IncomingMessage|FastifyRequest|KoaContext|Context/;

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
  // Command execution
  { pattern: /\bexec\s*\(/, name: 'exec', category: 'command' },
  { pattern: /\bexecSync\s*\(/, name: 'execSync', category: 'command' },
  { pattern: /\bspawn\s*\(/, name: 'spawn', category: 'command' },
  { pattern: /\bspawnSync\s*\(/, name: 'spawnSync', category: 'command' },
  { pattern: /\bexecFile\s*\(/, name: 'execFile', category: 'command' },
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

// SANITIZER_PATTERN_NAMES emits bare names ('safeParse', 'parse'); SANITIZER_PATTERNS (regex) emits
// prefixed names ('schema.safeParse', 'path.normalize'). Both call isSanitizerSufficient(), so the
// table below carries BOTH forms explicitly for each sanitizer.
//
// Design rule: only include a BARE key when the name is unlikely to collide with unrelated methods.
// `safeParse` is distinctive enough (almost always a Zod/Yup schema call), but bare `parse`,
// `validate`, `normalize`, `resolve`, `basename` are ambiguous — a user's custom `.parse()` or
// `.normalize()` would otherwise be silently treated as a full sanitizer, producing false negatives
// on real taint bugs. Those stay prefixed-only so the regex engine catches them and the AST engine
// defaults to deny (unknown sanitizer → taint still fires, conservative).
const SANITIZER_SUFFICIENCY: Record<string, Set<SinkCategory>> = {
  // Coercion sanitizers (bare names are unambiguous)
  parseInt: new Set(['sql']),
  parseFloat: new Set(['sql']),
  Number: new Set(['sql']),
  'Number()': new Set(['sql']),
  Boolean: new Set([]), // too weak for any sink — documented for intent
  'Boolean()': new Set([]),
  // Schema validation — `safeParse` stays bare (Zod/Yup-specific); `parse`/`validate`/`validateSync` only as prefixed to avoid colliding with JSON.parse, Date.parse, user methods, etc.
  'schema.parse': new Set(['command', 'fs', 'sql', 'redirect', 'eval', 'template', 'ssrf']),
  'schema.safeParse': new Set(['command', 'fs', 'sql', 'redirect', 'eval', 'template', 'ssrf']),
  safeParse: new Set(['command', 'fs', 'sql', 'redirect', 'eval', 'template', 'ssrf']),
  'schema.validate': new Set(['command', 'fs', 'sql', 'redirect', 'eval', 'template', 'ssrf']),
  'schema.validateSync': new Set(['command', 'fs', 'sql', 'redirect', 'eval', 'template', 'ssrf']),
  // String sanitization
  'sanitize()': new Set(['template']),
  sanitize: new Set(['template']),
  'escape()': new Set(['sql', 'template']),
  escape: new Set(['sql', 'template']),
  escapeHtml: new Set(['template']),
  DOMPurify: new Set(['template']),
  purify: new Set(['template']),
  xss: new Set(['template']),
  // encodeURIComponent prevents open-redirect but NOT SSRF — the attacker still controls the host
  encodeURIComponent: new Set(['redirect']),
  encodeURI: new Set(['redirect']),
  // Path sanitization — only prefixed; a user's `.normalize()` is not safe to treat as FS-sufficient
  'path.normalize': new Set(['fs']),
  'path.resolve': new Set(['fs']),
  'path.basename': new Set(['fs']),
  'replace(../)': new Set(['fs']),
  // SQL parameterization
  'parameterized query ($N)': new Set(['sql']),
  'parameterized query (?)': new Set(['sql']),
  parameterized: new Set(['sql']),
  sqlstring: new Set(['sql']),
  // Prompt sanitization
  sanitizeForPrompt: new Set(['template']),
  escapePrompt: new Set(['template']),
  stripDelimiters: new Set(['template']),
  cleanForPrompt: new Set(['template']),
};

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
