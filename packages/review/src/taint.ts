/**
 * Taint Tracking — source→sink analysis on KERN IR.
 *
 * Phase 2 of the security pipeline. Works on InferResult[] handler bodies.
 *
 * Two modes:
 *   analyzeTaint()          — intra-procedural (single file)
 *   analyzeTaintCrossFile() — inter-procedural (follows imports across files)
 *
 * Also validates sanitizer sufficiency: parseInt stops SQL injection on
 * numeric values but NOT command injection. DOMPurify stops XSS but
 * NOT SQL injection. The sufficiency matrix catches these mismatches.
 */

import type { InferResult, ReviewFinding, SourceSpan } from './types.js';
import { createFingerprint } from './types.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface TaintSource {
  name: string;         // Variable name (e.g., "req", "userId")
  origin: string;       // Where it came from (e.g., "req.body", "req.query.id")
  line?: number;        // Approximate line in handler body
}

export interface TaintSink {
  name: string;         // Sink function (e.g., "exec", "writeFileSync")
  category: 'command' | 'fs' | 'sql' | 'redirect' | 'eval' | 'template';
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

// ── Source Classification ────────────────────────────────────────────────

/** Param names/types that indicate HTTP handler context */
const HTTP_PARAM_NAMES = /^(req|request)$/i;
const HTTP_PARAM_TYPES = /Request|IncomingMessage|FastifyRequest|KoaContext|Context/;

/** User input access patterns — what flows from HTTP params */
const USER_INPUT_ACCESS = [
  { pattern: /\breq\.body\b/, origin: 'req.body' },
  { pattern: /\breq\.query\b/, origin: 'req.query' },
  { pattern: /\breq\.params\b/, origin: 'req.params' },
  { pattern: /\breq\.headers\b/, origin: 'req.headers' },
  { pattern: /\brequest\.body\b/, origin: 'request.body' },
  { pattern: /\brequest\.query\b/, origin: 'request.query' },
  { pattern: /\brequest\.params\b/, origin: 'request.params' },
  { pattern: /\bprocess\.argv\b/, origin: 'process.argv' },
  { pattern: /\bprocess\.env\b/, origin: 'process.env' },
] as const;

// ── Sink Classification ─────────────────────────────────────────────────

interface SinkPattern {
  pattern: RegExp;
  name: string;
  category: TaintSink['category'];
}

const SINK_PATTERNS: SinkPattern[] = [
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
];

// ── Sanitizer Detection ─────────────────────────────────────────────────

const SANITIZER_PATTERNS = [
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
  { pattern: /\bsanitize\w*\s*\(/, name: 'sanitize()' },
  { pattern: /\bescape\w*\s*\(/, name: 'escape()' },
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
];

// ── Sanitizer Sufficiency Matrix ──────────────────────────────────────────
// Not all sanitizers work for all sink types. parseInt prevents SQL injection
// on numeric values but does nothing for command injection.

type SinkCategory = TaintSink['category'];

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
};

/**
 * Check if a sanitizer is actually sufficient for a given sink category.
 * Returns true if the sanitizer protects against the sink, false if it's
 * a mismatch (e.g., parseInt used to "sanitize" command injection).
 */
export function isSanitizerSufficient(sanitizerName: string, sinkCategory: SinkCategory): boolean {
  const allowed = SANITIZER_SUFFICIENCY[sanitizerName];
  if (!allowed) return true; // Unknown sanitizer — give benefit of doubt
  return allowed.has(sinkCategory);
}

// ── Cross-File Types ─────────────────────────────────────────────────────

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

// ── Main Analysis ────────────────────────────────────────────────────────

/**
 * Run taint analysis on all fn nodes in inferred results.
 * Returns TaintResult[] — one per function with taint paths found.
 */
export function analyzeTaint(inferred: InferResult[], filePath: string): TaintResult[] {
  const results: TaintResult[] = [];

  for (const r of inferred) {
    if (r.node.type !== 'fn') continue;

    const fnName = (r.node.props?.name as string) || 'anonymous';
    const paramsStr = (r.node.props?.params as string) || '';

    // Get handler body
    const handler = r.node.children?.find(c => c.type === 'handler');
    const code = (handler?.props?.code as string) || '';
    if (!code) continue;

    // Step 1: Classify params as tainted
    const taintedParams = classifyParams(paramsStr);
    if (taintedParams.length === 0) continue;

    // Step 2: Propagate taint through assignments
    const taintedVars = propagateTaint(code, taintedParams);

    // Step 3: Find sinks that use tainted variables
    const sinks = findTaintedSinks(code, taintedVars);
    if (sinks.length === 0) continue;

    // Step 4: Check for sanitizers
    const paths = buildPaths(code, taintedVars, sinks);

    if (paths.length > 0) {
      results.push({
        fnName,
        filePath,
        startLine: r.startLine,
        paths,
      });
    }
  }

  return results;
}

/**
 * Classify function parameters as tainted or safe.
 */
function classifyParams(paramsStr: string): TaintSource[] {
  const sources: TaintSource[] = [];
  if (!paramsStr) return sources;

  const params = paramsStr.split(',').map(p => {
    const parts = p.trim().split(':');
    return { name: parts[0]?.trim(), type: parts[1]?.trim() || '' };
  });

  for (const p of params) {
    if (!p.name) continue;
    if (HTTP_PARAM_NAMES.test(p.name) || HTTP_PARAM_TYPES.test(p.type)) {
      sources.push({ name: p.name, origin: `${p.name} (HTTP input)` });
    }
  }

  return sources;
}

/**
 * Propagate taint through variable assignments in handler body.
 * Tracks: const x = req.body.foo → x is tainted.
 * Returns all tainted variable names with their origins.
 */
function propagateTaint(code: string, params: TaintSource[]): TaintSource[] {
  const tainted = new Map<string, TaintSource>();

  // Seed: the params themselves
  for (const p of params) {
    tainted.set(p.name, p);
  }

  // Find all user input access patterns in code
  for (const { pattern, origin } of USER_INPUT_ACCESS) {
    if (pattern.test(code)) {
      // Find assignments from this source: const x = req.body.foo
      const assignRegex = new RegExp(
        `(?:const|let|var)\\s+(\\w+)\\s*=\\s*${origin.replace('.', '\\.')}(?:\\.(\\w+))?`,
        'g'
      );
      let match;
      while ((match = assignRegex.exec(code)) !== null) {
        const varName = match[1];
        const prop = match[2] ? `${origin}.${match[2]}` : origin;
        tainted.set(varName, { name: varName, origin: prop });
      }
    }
  }

  // Destructuring: const { name, email } = req.body
  for (const p of params) {
    const destructRegex = new RegExp(
      `(?:const|let|var)\\s*\\{\\s*([^}]+)\\}\\s*=\\s*${p.name}\\.(?:body|query|params)`,
      'g'
    );
    let match;
    while ((match = destructRegex.exec(code)) !== null) {
      const vars = match[1].split(',').map(v => v.trim().split(':')[0].trim().split('=')[0].trim());
      for (const v of vars) {
        if (v) {
          tainted.set(v, { name: v, origin: `${p.name}.body.${v}` });
        }
      }
    }
  }

  // Simple propagation: const y = someTransform(x) where x is tainted
  // Only one level deep to avoid false positives
  const taintedNames = new Set(tainted.keys());
  const propagateRegex = /(?:const|let|var)\s+(\w+)\s*=\s*[^;]*?(\w+)/g;
  let pm;
  while ((pm = propagateRegex.exec(code)) !== null) {
    const newVar = pm[1];
    // Check if any tainted variable appears in the assignment RHS
    if (taintedNames.has(newVar)) continue; // already tainted
    // Get the full RHS
    const eqIdx = code.indexOf('=', pm.index + pm[1].length);
    const semiIdx = code.indexOf(';', eqIdx);
    if (eqIdx < 0) continue;
    const rhs = code.slice(eqIdx + 1, semiIdx > eqIdx ? semiIdx : eqIdx + 200).trim();
    for (const tName of taintedNames) {
      if (new RegExp(`\\b${tName}\\b`).test(rhs)) {
        tainted.set(newVar, { name: newVar, origin: `derived from ${tName}` });
        break;
      }
    }
  }

  return Array.from(tainted.values());
}

/**
 * Find sink calls that use tainted variables.
 */
function findTaintedSinks(code: string, taintedVars: TaintSource[]): TaintSink[] {
  const sinks: TaintSink[] = [];
  const taintedNames = new Set(taintedVars.map(v => v.name));

  for (const { pattern, name, category } of SINK_PATTERNS) {
    const match = pattern.exec(code);
    if (!match) continue;

    // Extract the argument region after the match
    const callStart = match.index + match[0].length;
    const parenDepth = findClosingParen(code, callStart);
    const argText = code.slice(callStart, parenDepth);

    // Check if any tainted variable is used in the arguments
    for (const tName of taintedNames) {
      if (new RegExp(`\\b${tName}\\b`).test(argText)) {
        sinks.push({ name, category, taintedArg: tName });
        break;
      }
    }

    // Also check for template literals with tainted vars: `SELECT * FROM ${table}`
    if (category === 'sql') {
      // Check template literal in args
      const templateMatch = argText.match(/`[^`]*\$\{(\w+)\}[^`]*`/);
      if (templateMatch && taintedNames.has(templateMatch[1])) {
        sinks.push({ name: `${name} (template)`, category: 'sql', taintedArg: templateMatch[1] });
      }
    }
  }

  // Check template literals used in exec/spawn-like contexts
  const templateExecRegex = /`[^`]*\$\{(\w+)\}[^`]*`/g;
  let tm;
  while ((tm = templateExecRegex.exec(code)) !== null) {
    if (taintedNames.has(tm[1])) {
      // Check if this template is used as argument to a command-like function
      const before = code.slice(Math.max(0, tm.index - 50), tm.index);
      if (/exec\s*\(|spawn\s*\(|execSync\s*\(/.test(before)) {
        // Already caught by SINK_PATTERNS, skip duplicate
        continue;
      }
    }
  }

  return sinks;
}

/**
 * Build taint paths and check for sanitizers between source and sink.
 */
function buildPaths(code: string, taintedVars: TaintSource[], sinks: TaintSink[]): TaintPath[] {
  const paths: TaintPath[] = [];
  const foundSanitizers = detectSanitizers(code);

  for (const sink of sinks) {
    // Find the source that produced this tainted arg
    const source = taintedVars.find(v => v.name === sink.taintedArg);
    if (!source) continue;

    // Check if any sanitizer was applied to this specific variable
    const sanitizer = foundSanitizers.find(s =>
      new RegExp(`\\b${sink.taintedArg}\\b`).test(s.context) ||
      new RegExp(`${s.name}\\s*\\([^)]*\\b${sink.taintedArg}\\b`).test(code)
    );

    // Check sanitizer sufficiency — is this the RIGHT sanitizer for this sink?
    const hasSanitizer = !!sanitizer;
    const sufficient = hasSanitizer ? isSanitizerSufficient(sanitizer.name, sink.category) : false;

    paths.push({
      source,
      sink,
      sanitized: hasSanitizer && sufficient,
      sanitizer: sanitizer?.name,
      insufficientSanitizer: hasSanitizer && !sufficient ? sanitizer.name : undefined,
    });
  }

  return paths;
}

function detectSanitizers(code: string): Array<{ name: string; context: string }> {
  const found: Array<{ name: string; context: string }> = [];

  for (const { pattern, name } of SANITIZER_PATTERNS) {
    const match = pattern.exec(code);
    if (match) {
      // Get surrounding context (50 chars before and after)
      const start = Math.max(0, match.index - 50);
      const end = Math.min(code.length, match.index + match[0].length + 50);
      found.push({ name, context: code.slice(start, end) });
    }
  }

  return found;
}

function findClosingParen(code: string, start: number): number {
  let depth = 1;
  for (let i = start; i < code.length; i++) {
    if (code[i] === '(') depth++;
    if (code[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return Math.min(start + 500, code.length); // fallback
}

// ── Finding Generator ────────────────────────────────────────────────────

/**
 * Convert taint results into ReviewFinding[] for the unified pipeline.
 */
export function taintToFindings(results: TaintResult[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  const categoryLabels: Record<TaintSink['category'], string> = {
    command: 'command injection',
    fs: 'path traversal / file write',
    sql: 'SQL injection',
    redirect: 'open redirect',
    eval: 'code injection',
    template: 'template injection',
  };

  for (const r of results) {
    // Report unsanitized paths AND insufficient sanitizer paths
    const reportable = r.paths.filter(p => !p.sanitized);
    if (reportable.length === 0) continue;

    for (const path of reportable) {
      const severity = path.sink.category === 'command' || path.sink.category === 'eval'
        ? 'error' as const
        : 'warning' as const;

      const primarySpan: SourceSpan = {
        file: r.filePath,
        startLine: r.startLine,
        startCol: 1,
        endLine: r.startLine,
        endCol: 1,
      };

      if (path.insufficientSanitizer) {
        // Sanitizer present but wrong for this sink type
        findings.push({
          source: 'kern',
          ruleId: `taint-insufficient-sanitizer`,
          severity,
          category: 'bug',
          message: `Insufficient sanitizer: '${path.insufficientSanitizer}' does not protect against ${categoryLabels[path.sink.category]}. ` +
            `${path.source.origin} → ${path.sink.name}() is still exploitable.`,
          primarySpan,
          suggestion: `${path.insufficientSanitizer} is not sufficient for ${path.sink.category} sinks. ${getSuggestion(path.sink.category)}`,
          fingerprint: createFingerprint(`taint-insufficient`, r.startLine, 1),
        });
      } else {
        // No sanitizer at all
        findings.push({
          source: 'kern',
          ruleId: `taint-${path.sink.category}`,
          severity,
          category: 'bug',
          message: `Taint flow: ${path.source.origin} → ${path.sink.name}() — potential ${categoryLabels[path.sink.category]}. ` +
            `Variable '${path.sink.taintedArg}' reaches dangerous sink without sanitization.`,
          primarySpan,
          suggestion: getSuggestion(path.sink.category),
          fingerprint: createFingerprint(`taint-${path.sink.category}`, r.startLine, 1),
        });
      }
    }
  }

  return findings;
}

function getSuggestion(category: TaintSink['category']): string {
  switch (category) {
    case 'command': return 'Use spawn() with array arguments, or validate/escape input before passing to exec()';
    case 'fs': return 'Use path.resolve() + path.normalize() and verify the result stays within allowed directory';
    case 'sql': return 'Use parameterized queries ($1, ?) instead of string interpolation';
    case 'redirect': return 'Validate redirect URL against an allowlist of safe destinations';
    case 'eval': return 'Never pass user input to eval() or new Function() — use safe alternatives';
    case 'template': return 'Sanitize user input before embedding in templates';
  }
}

// ── Cross-File Taint Analysis ────────────────────────────────────────────

/**
 * Build a map of exported functions across all files.
 * Maps "filePath::fnName" → ExportedFunction with sink info.
 */
export function buildExportMap(
  inferredPerFile: Map<string, InferResult[]>,
): Map<string, ExportedFunction> {
  const exportMap = new Map<string, ExportedFunction>();

  for (const [filePath, inferred] of inferredPerFile) {
    for (const r of inferred) {
      if (r.node.type !== 'fn') continue;
      const fnName = (r.node.props?.name as string) || '';
      if (!fnName) continue;

      // Check if function is exported (absence of export='false' means exported)
      const isExported = r.node.props?.export !== 'false';
      if (!isExported) continue;

      const params = (r.node.props?.params as string) || '';
      const handler = r.node.children?.find(c => c.type === 'handler');
      const code = (handler?.props?.code as string) || '';

      // Check if the function body contains dangerous sinks
      const sinks: TaintSink[] = [];
      if (code) {
        const dummyTaint: TaintSource[] = [];
        // Parse params to get variable names for sink detection
        const paramNames = params.split(',').map(p => p.trim().split(':')[0]?.trim()).filter(Boolean);
        for (const name of paramNames) {
          dummyTaint.push({ name, origin: `param:${name}` });
        }
        if (dummyTaint.length > 0) {
          sinks.push(...findTaintedSinks(code, dummyTaint));
        }
      }

      exportMap.set(`${filePath}::${fnName}`, {
        filePath,
        fnName,
        params,
        hasSink: sinks.length > 0,
        sinks,
      });
    }
  }

  return exportMap;
}

/**
 * Build import→function resolution map.
 * Maps "importingFile::importedName" → absolute file path of the definition.
 */
export function buildImportMap(
  inferredPerFile: Map<string, InferResult[]>,
  graphImports: Map<string, string[]>,  // filePath → [resolved import paths]
): Map<string, string> {
  const importMap = new Map<string, string>();

  for (const [filePath, inferred] of inferredPerFile) {
    const resolvedImports = graphImports.get(filePath) || [];

    for (const r of inferred) {
      if (r.node.type !== 'import') continue;
      const from = (r.node.props?.from as string) || '';
      const names = (r.node.props?.names as string) || '';
      const defaultImport = (r.node.props?.default as string) || '';

      if (!from) continue;

      // Find the resolved path for this import specifier
      const resolvedPath = resolvedImports.find(p =>
        p.includes(from.replace(/^\.\//, '').replace(/\.(js|ts|tsx)$/, ''))
      );
      if (!resolvedPath) continue;

      // Map each imported name to its resolved file
      if (names) {
        for (const name of names.split(',').map(n => n.trim())) {
          if (name) importMap.set(`${filePath}::${name}`, resolvedPath);
        }
      }
      if (defaultImport) {
        importMap.set(`${filePath}::${defaultImport}`, resolvedPath);
      }
    }
  }

  return importMap;
}

/**
 * Cross-file taint analysis.
 *
 * For each handler function with tainted params:
 *   1. Find calls to imported functions in the handler body
 *   2. Check if tainted data is passed as an argument
 *   3. Look up the target function — does it have a dangerous sink?
 *   4. If yes and no sanitizer in between → cross-file taint path
 */
export function analyzeTaintCrossFile(
  inferredPerFile: Map<string, InferResult[]>,
  graphImports: Map<string, string[]>,
): CrossFileTaintResult[] {
  const exportMap = buildExportMap(inferredPerFile);
  const importMap = buildImportMap(inferredPerFile, graphImports);
  const results: CrossFileTaintResult[] = [];

  for (const [filePath, inferred] of inferredPerFile) {
    for (const r of inferred) {
      if (r.node.type !== 'fn') continue;

      const fnName = (r.node.props?.name as string) || 'anonymous';
      const paramsStr = (r.node.props?.params as string) || '';
      const handler = r.node.children?.find(c => c.type === 'handler');
      const code = (handler?.props?.code as string) || '';
      if (!code) continue;

      // Only analyze functions with tainted params
      const taintedParams = classifyParams(paramsStr);
      if (taintedParams.length === 0) continue;

      const taintedVars = propagateTaint(code, taintedParams);
      const taintedNames = new Set(taintedVars.map(v => v.name));

      // Find calls to imported functions: importedFn(taintedVar)
      const callRegex = /\b(\w+)\s*\(/g;
      let callMatch;
      while ((callMatch = callRegex.exec(code)) !== null) {
        const calledFn = callMatch[0].replace(/\s*\($/, '');

        // Is this an imported function?
        const resolvedFile = importMap.get(`${filePath}::${calledFn}`);
        if (!resolvedFile) continue;

        // Does the target have dangerous sinks?
        const targetFn = exportMap.get(`${resolvedFile}::${calledFn}`);
        if (!targetFn || !targetFn.hasSink) continue;

        // Extract arguments passed to this call
        const callStart = callMatch.index + callMatch[0].length;
        const parenEnd = findClosingParen(code, callStart);
        const argText = code.slice(callStart, parenEnd);

        // Check if any tainted variable is passed as argument
        const taintedArgs: string[] = [];
        for (const tName of taintedNames) {
          if (new RegExp(`\\b${tName}\\b`).test(argText)) {
            taintedArgs.push(tName);
          }
        }

        if (taintedArgs.length === 0) continue;

        // Check for sanitizers between the taint and the call
        const beforeCall = code.slice(0, callMatch.index);
        const foundSanitizers = detectSanitizers(beforeCall);
        const hasSanitizer = taintedArgs.some(arg =>
          foundSanitizers.some(s =>
            new RegExp(`\\b${arg}\\b`).test(s.context)
          )
        );

        if (hasSanitizer) continue; // Sanitized before passing to callee

        // Found cross-file taint path
        for (const sink of targetFn.sinks) {
          const source = taintedVars.find(v => taintedArgs.includes(v.name));
          if (!source) continue;

          results.push({
            callerFile: filePath,
            callerFn: fnName,
            callerLine: r.startLine,
            calleeFile: resolvedFile,
            calleeFn: calledFn,
            taintedArgs,
            sinkInCallee: sink,
            source,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Convert cross-file taint results into ReviewFinding[].
 */
export function crossFileTaintToFindings(results: CrossFileTaintResult[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  const categoryLabels: Record<TaintSink['category'], string> = {
    command: 'command injection',
    fs: 'path traversal / file write',
    sql: 'SQL injection',
    redirect: 'open redirect',
    eval: 'code injection',
    template: 'template injection',
  };

  for (const r of results) {
    const severity = r.sinkInCallee.category === 'command' || r.sinkInCallee.category === 'eval'
      ? 'error' as const
      : 'warning' as const;

    findings.push({
      source: 'kern',
      ruleId: `taint-crossfile-${r.sinkInCallee.category}`,
      severity,
      category: 'bug',
      message: `Cross-file taint: ${r.source.origin} in ${r.callerFn}() → ${r.calleeFn}() → ${r.sinkInCallee.name}(). ` +
        `Tainted data crosses file boundary to reach ${categoryLabels[r.sinkInCallee.category]} sink.`,
      primarySpan: {
        file: r.callerFile,
        startLine: r.callerLine,
        startCol: 1,
        endLine: r.callerLine,
        endCol: 1,
      },
      relatedSpans: [{
        file: r.calleeFile,
        startLine: 1,
        startCol: 1,
        endLine: 1,
        endCol: 1,
      }],
      suggestion: `Validate '${r.taintedArgs.join(', ')}' before passing to ${r.calleeFn}(). ${getSuggestion(r.sinkInCallee.category)}`,
      fingerprint: createFingerprint(`taint-xfile-${r.sinkInCallee.category}`, r.callerLine, 1),
    });
  }

  return findings;
}
