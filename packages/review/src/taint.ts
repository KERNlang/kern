/**
 * Taint Tracking — intra-procedural source→sink analysis on KERN IR.
 *
 * Phase 2 of the security pipeline. Works on InferResult[] handler bodies.
 *
 * Strategy:
 *   1. For each fn node with a handler body, extract params
 *   2. Classify params as tainted sources (HTTP input, CLI args, etc.)
 *   3. Propagate taint through simple assignments in handler body
 *   4. Check if tainted variables reach dangerous sinks
 *   5. Check if any sanitizer sits between source and sink
 *   6. Report source→sink paths with no sanitizer
 *
 * Intentionally intra-procedural (single function) — KERN IR gives us
 * explicit params + handler body, so we don't need to trace across files.
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
  sanitizer?: string;   // What sanitized it (e.g., "parseInt", "schema.parse")
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
];

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

    paths.push({
      source,
      sink,
      sanitized: !!sanitizer,
      sanitizer: sanitizer?.name,
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

  for (const r of results) {
    // Only report unsanitized paths
    const unsanitized = r.paths.filter(p => !p.sanitized);
    if (unsanitized.length === 0) continue;

    for (const path of unsanitized) {
      const severity = path.sink.category === 'command' || path.sink.category === 'eval'
        ? 'error' as const
        : 'warning' as const;

      const categoryLabels: Record<TaintSink['category'], string> = {
        command: 'command injection',
        fs: 'path traversal / file write',
        sql: 'SQL injection',
        redirect: 'open redirect',
        eval: 'code injection',
        template: 'template injection',
      };

      const primarySpan: SourceSpan = {
        file: r.filePath,
        startLine: r.startLine,
        startCol: 1,
        endLine: r.startLine,
        endCol: 1,
      };

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
