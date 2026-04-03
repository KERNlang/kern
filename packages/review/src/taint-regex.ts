/**
 * Taint Tracking — Regex-based fallback engine.
 *
 * Used when no ts-morph SourceFile is available.
 * Works on handler body strings from KERN IR nodes.
 */

import type { InferResult } from './types.js';
import type { TaintSource, TaintSink, TaintPath, TaintResult } from './taint-types.js';
import { HTTP_PARAM_NAMES, HTTP_PARAM_TYPES, SINK_PATTERNS, SANITIZER_PATTERNS, isSanitizerSufficient } from './taint-types.js';

// ── Main Regex Analysis ─────────────────────────────────────────────────

/**
 * Regex-based taint analysis — legacy fallback for when no SourceFile is available.
 */
export function analyzeTaintRegex(inferred: InferResult[], filePath: string): TaintResult[] {
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

// ── Param Classification ────────────────────────────────────────────────

/**
 * Classify function parameters as tainted or safe.
 */
export function classifyParams(paramsStr: string): TaintSource[] {
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

// ── Multi-Hop Taint Propagation ─────────────────────────────────────────

/**
 * Multi-hop taint propagation using worklist algorithm.
 * Propagates until fixed point or configurable depth limit.
 *
 * Handles all assignment patterns:
 * - const b = a
 * - const b = a.trim()
 * - const {x} = obj
 * - let b; b = a
 *
 * @param code - Handler code string
 * @param initialTainted - Set of initially tainted variable names
 * @param maxDepth - Maximum propagation depth (default: 3)
 * @returns Set of all tainted variable names after fixed point or depth limit
 */
export function propagateTaintMultiHop(
  code: string,
  initialTainted: Set<string>,
  maxDepth: number = 3,
): Set<string> {
  const tainted = new Set<string>(initialTainted);
  const worklist: Array<{ varName: string; depth: number }> = [];
  const visitedAssignments = new Set<string>();
  const assignmentDepths = new Map<string, number>();

  for (const v of initialTainted) {
    worklist.push({ varName: v, depth: 0 });
  }

  const allAssignments = extractAllAssignments(code);

  while (worklist.length > 0) {
    const { varName: currentVar, depth } = worklist.shift()!;

    if (depth >= maxDepth) continue;

    for (const assignment of allAssignments) {
      const { lhs, rhs, assignId } = assignment;

      if (visitedAssignments.has(`${assignId}:${depth}`)) continue;

      const rhsDeps = extractDependencies(rhs);

      if (rhsDeps.has(currentVar)) {
        visitedAssignments.add(`${assignId}:${depth}`);

        const existingDepth = assignmentDepths.get(lhs);
        if (existingDepth !== undefined && existingDepth <= depth + 1) {
          continue;
        }
        assignmentDepths.set(lhs, depth + 1);

        if (!tainted.has(lhs)) {
          tainted.add(lhs);
          worklist.push({ varName: lhs, depth: depth + 1 });
        }

        if (isCircularAssignment(lhs, rhs, allAssignments)) {
          continue;
        }

        for (const dep of rhsDeps) {
          if (dep !== currentVar && tainted.has(dep)) {
            const depDepth = assignmentDepths.get(dep) ?? 0;
            if (depth + 1 > depDepth) {
              if (!tainted.has(lhs)) {
                tainted.add(lhs);
                worklist.push({ varName: lhs, depth: depth + 1 });
              }
            }
          }
        }
      }
    }
  }

  return tainted;
}

// ── Assignment Parsing ──────────────────────────────────────────────────

interface Assignment {
  lhs: string;
  rhs: string;
  assignId: string;
}

export function extractAllAssignments(code: string): Assignment[] {
  const assignments: Assignment[] = [];

  const lines = code.split('\n');
  let assignCounter = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    for (const assign of parseLineAssignments(trimmed, assignCounter)) {
      assignments.push(assign);
      assignCounter++;
    }
  }

  return assignments;
}

export function parseLineAssignments(line: string, lineNum: number): Assignment[] {
  const assignments: Assignment[] = [];

  const constLetVarRegex = /^(?:const|let|var)\s+/;
  const declMatch = line.match(constLetVarRegex);
  if (!declMatch) {
    const reassignRegex = /^(\w+)\s*=\s*(.+)$/;
    const reassign = line.match(reassignRegex);
    if (reassign) {
      assignments.push({
        lhs: reassign[1],
        rhs: reassign[2],
        assignId: `${lineNum}:reassign`,
      });
    }
    return assignments;
  }

  const rest = line.slice(declMatch[0].length);

  const destructRegex = /^\{\s*([^}]+)\}\s*=\s*(.+)$/;
  const destructMatch = rest.match(destructRegex);
  if (destructMatch) {
    const vars = destructMatch[1].split(',').map(v => {
      const name = v.trim().split(':')[0].split('=')[0].trim();
      return name;
    }).filter(v => v && !v.startsWith('...'));
    const rhs = destructMatch[2];
    for (let i = 0; i < vars.length; i++) {
      assignments.push({
        lhs: vars[i],
        rhs: `${rhs}[${i}]`,
        assignId: `${lineNum}:destructure:${i}`,
      });
    }
    return assignments;
  }

  const simpleAssignRegex = /^(\w+)\s*=\s*(.+)$/;
  const simpleMatch = rest.match(simpleAssignRegex);
  if (simpleMatch) {
    assignments.push({
      lhs: simpleMatch[1],
      rhs: simpleMatch[2],
      assignId: `${lineNum}:simple`,
    });
  }

  return assignments;
}

export function extractDependencies(rhs: string): Set<string> {
  const deps = new Set<string>();
  const RESERVED = new Set(['undefined', 'null', 'true', 'false', 'const', 'let', 'var', 'new', 'typeof', 'instanceof', 'return', 'await', 'async', 'function', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'throw', 'try', 'catch', 'finally']);

  // Match all identifier chains: foo, foo.bar, foo.bar.baz, foo[0].bar
  const chainRegex = /\b([a-zA-Z_$]\w*)(?:\.\w+|\[[^\]]*\])*/g;
  let match;
  while ((match = chainRegex.exec(rhs)) !== null) {
    const base = match[1];
    if (!RESERVED.has(base) && !/^\d/.test(base)) {
      deps.add(base);
    }
  }

  return deps;
}

export function isCircularAssignment(lhs: string, rhs: string, allAssignments: Assignment[]): boolean {
  const rhsDeps = extractDependencies(rhs);
  const visited = new Set<string>();
  const stack = [...rhsDeps];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === lhs) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const assign of allAssignments) {
      if (assign.lhs === current) {
        const deps = extractDependencies(assign.rhs);
        for (const dep of deps) {
          if (!visited.has(dep)) {
            stack.push(dep);
          }
        }
      }
    }
  }

  return false;
}

// ── Taint Propagation ───────────────────────────────────────────────────

/**
 * Propagate taint through variable assignments in handler body.
 * Tracks: const x = req.body.foo → x is tainted.
 * Returns all tainted variable names with their origins.
 */
export function propagateTaint(code: string, params: TaintSource[]): TaintSource[] {
  const tainted = new Map<string, TaintSource>();

  for (const p of params) {
    tainted.set(p.name, p);
  }

  const initialTainted = new Set(tainted.keys());
  const propagated = propagateTaintMultiHop(code, initialTainted);

  for (const v of propagated) {
    if (!tainted.has(v)) {
      tainted.set(v, { name: v, origin: `derived` });
    }
  }

  return Array.from(tainted.values());
}

// ── Sink Detection ──────────────────────────────────────────────────────

/**
 * Find sink calls that use tainted variables.
 */
export function findTaintedSinks(code: string, taintedVars: TaintSource[]): TaintSink[] {
  const sinks: TaintSink[] = [];
  const taintedNames = new Set(taintedVars.map(v => v.name));

  for (const { pattern, name, category } of SINK_PATTERNS) {
    // Scan ALL matches using a global copy (original patterns are non-global)
    const globalPattern = new RegExp(pattern.source, 'g');
    let match;
    while ((match = globalPattern.exec(code)) !== null) {
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

      // Also check for template literals with tainted vars in any sink category
      const templateMatch = argText.match(/`[^`]*\$\{(\w+)\}[^`]*`/);
      if (templateMatch && taintedNames.has(templateMatch[1])) {
        sinks.push({ name: `${name} (template)`, category, taintedArg: templateMatch[1] });
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

// ── Path Building ───────────────────────────────────────────────────────

/**
 * Build taint paths and check for sanitizers between source and sink.
 */
export function buildPaths(code: string, taintedVars: TaintSource[], sinks: TaintSink[]): TaintPath[] {
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
    const hasSanitizer = sanitizer != null;
    const sufficient = sanitizer != null ? isSanitizerSufficient(sanitizer.name, sink.category) : false;

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

// ── Sanitizer Detection ─────────────────────────────────────────────────

export function detectSanitizers(code: string): Array<{ name: string; context: string }> {
  const found: Array<{ name: string; context: string }> = [];

  for (const { pattern, name } of SANITIZER_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, 'g');
    let match;
    while ((match = globalPattern.exec(code)) !== null) {
      const start = Math.max(0, match.index - 50);
      const end = Math.min(code.length, match.index + match[0].length + 50);
      found.push({ name, context: code.slice(start, end) });
    }
  }

  return found;
}

// ── Utilities ───────────────────────────────────────────────────────────

export function findClosingParen(code: string, start: number): number {
  let depth = 1;
  for (let i = start; i < code.length; i++) {
    if (code[i] === '(') depth++;
    if (code[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return Math.min(start + 500, code.length); // fallback
}
