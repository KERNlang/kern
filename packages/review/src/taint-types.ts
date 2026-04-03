/**
 * Taint Tracking — shared types, classification tables, and sanitizer sufficiency.
 */

import type { SourceFile, FunctionDeclaration, ArrowFunction, FunctionExpression, MethodDeclaration } from 'ts-morph';

// ── Types ────────────────────────────────────────────────────────────────

export interface TaintSource {
  name: string;         // Variable name (e.g., "req", "userId")
  origin: string;       // Where it came from (e.g., "req.body", "req.query.id")
  line?: number;        // Approximate line in handler body
}

export interface TaintSink {
  name: string;         // Sink function (e.g., "exec", "writeFileSync")
  category: 'command' | 'fs' | 'sql' | 'redirect' | 'eval' | 'template' | 'codegen';
  taintedArg: string;   // The tainted variable used in the call
  line?: number;
}

export interface TaintPath {
  source: TaintSource;
  sink: TaintSink;
  sanitized: boolean;
  sanitizer?: string;              // What sanitized it (e.g., "parseInt", "schema.parse")
  insufficientSanitizer?: string;  // Sanitizer present but wrong for this sink type
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
  taintedArgs: string[];   // Which args are tainted
  sinkInCallee: TaintSink; // The sink reached in the callee
  source: TaintSource;     // Original taint source
}

/** Map of exported function names → file path + param info */
export interface ExportedFunction {
  filePath: string;
  fnName: string;
  params: string;   // Raw params string
  hasSink: boolean;  // Does this function contain a dangerous sink?
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
  { pattern: /\.replace\s*\(\s*\/.*\.\.\//,  name: 'replace(../)' },
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

const SANITIZER_SUFFICIENCY: Record<string, Set<SinkCategory>> = {
  'parseInt':                 new Set(['sql']),
  'parseFloat':               new Set(['sql']),
  'Number()':                 new Set(['sql']),
  'Boolean()':                new Set([]),  // too weak for anything
  'schema.parse':             new Set(['command', 'fs', 'sql', 'redirect', 'eval', 'template']),
  'schema.safeParse':         new Set(['command', 'fs', 'sql', 'redirect', 'eval', 'template']),
  'schema.validate':          new Set(['command', 'fs', 'sql', 'redirect', 'eval', 'template']),
  'schema.validateSync':      new Set(['command', 'fs', 'sql', 'redirect', 'eval', 'template']),
  'sanitize()':               new Set(['template']),
  'escape()':                 new Set(['sql', 'template']),
  'DOMPurify':                new Set(['template']),
  'encodeURIComponent':       new Set(['redirect']),
  'path.normalize':           new Set(['fs']),
  'replace(../)':             new Set(['fs']),
  'parameterized query ($N)': new Set(['sql']),
  'parameterized query (?)':  new Set(['sql']),
  'sanitizeForPrompt':        new Set(['template']),
  'escapePrompt':             new Set(['template']),
  'stripDelimiters':          new Set(['template']),
  'cleanForPrompt':           new Set(['template']),
};

/**
 * Check if a sanitizer is actually sufficient for a given sink category.
 * Returns true if the sanitizer protects against the sink, false if it's
 * a mismatch (e.g., parseInt used to "sanitize" command injection).
 */
export function isSanitizerSufficient(sanitizerName: string, sinkCategory: SinkCategory): boolean {
  const allowed = SANITIZER_SUFFICIENCY[sanitizerName];
  if (!allowed) return false; // Unknown sanitizer — default deny, verify manually
  return allowed.has(sinkCategory);
}

// ── Derived Lookup Tables ───────────────────────────────────────────────

// Sink name → category lookup (flat map from SINK_PATTERNS)
export const SINK_NAMES = new Map<string, TaintSink['category']>([
  ['exec', 'command'], ['execSync', 'command'], ['spawn', 'command'],
  ['spawnSync', 'command'], ['execFile', 'command'], ['execFileSync', 'command'],
  ['readFile', 'fs'], ['readFileSync', 'fs'],
  ['writeFile', 'fs'], ['writeFileSync', 'fs'], ['createWriteStream', 'fs'], ['createReadStream', 'fs'],
  ['unlink', 'fs'], ['unlinkSync', 'fs'],
  ['query', 'sql'], ['$execute', 'sql'], ['raw', 'sql'],
  ['$queryRaw', 'sql'], ['$queryRawUnsafe', 'sql'],
  ['redirect', 'redirect'],
  ['eval', 'eval'], ['Function', 'eval'],
]);

// Sanitizer names to detect (from SANITIZER_PATTERNS)
export const SANITIZER_PATTERN_NAMES = [
  'parseInt', 'parseFloat', 'Number', 'Boolean', 'String',
  'encodeURI', 'encodeURIComponent', 'escape',
  'sanitize', 'DOMPurify', 'purify', 'xss',
  'escapeHtml', 'sqlstring', 'parameterized',
  'parse', 'safeParse', 'validate',
];
