/**
 * KERN Rule Runner — executes compiled .kern rules against MCP server source code.
 *
 * Three execution layers:
 *   Layer 0: Regex pre-filter — skip rule if no sink pattern matches source
 *   Layer 1: Structural match — find handler regions, check sinks vs guards
 *   Layer 2: Flow assertion — check param-to-sink flow without guards (invariants)
 *
 * Reuses existing helpers from mcp-security.ts for handler region detection.
 */

import type { ReviewFinding, SourceSpan } from '@kernlang/review';
import { createFingerprint } from '@kernlang/review';
import type { CompiledMCPRule, CompiledSink } from './rule-compiler.js';
import { findToolHandlerRegions, isCommentLine, isMCPServer } from './rules/mcp-security.js';

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Extract the tool description string from a .tool() call.
 * Scans from the region start line for quoted strings (the 2nd arg to server.tool()).
 */
function extractToolDescription(lines: string[], regionStart: number): string | null {
  // Look at the .tool() call line and a few lines after for the description argument
  const searchBlock = lines.slice(regionStart, Math.min(regionStart + 5, lines.length)).join('\n');
  // Match: .tool('name', 'description', ...) or .tool("name", "description", ...)
  // or: .tool('name', `template description`, ...)
  const match = searchBlock.match(/\.tool\s*\(\s*(?:['"`][^'"`]*['"`])\s*,\s*(['"`])([\s\S]*?)\1/);
  if (match) return match[2];
  // Also try multi-line or variable-based descriptions (just grab all quoted strings in region)
  const allQuoted = [...searchBlock.matchAll(/['"`]([^'"`]{10,})['"`]/g)];
  // Return the longest quoted string (likely the description)
  if (allQuoted.length > 1) {
    return allQuoted.reduce((a, b) => (a[1].length > b[1].length ? a : b))[1];
  }
  return null;
}

function span(file: string, line: number): SourceSpan {
  return { file, startLine: line, startCol: 1, endLine: line, endCol: 1 };
}

function detectLanguage(filePath: string): 'ts' | 'py' {
  return filePath.endsWith('.py') ? 'py' : 'ts';
}

/** Get all regex patterns for a specific language from a sink or guard */
function langPatterns(patterns: { lang: string; regex: RegExp }[], lang: string): RegExp[] {
  return patterns.filter(p => p.lang === lang).map(p => p.regex);
}

/** Test if ANY pattern in a list matches source text */
function anyMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some(p => p.test(text));
}

/** Test if ANY pattern matches non-comment lines in a block */
function anyMatchSkipComments(patterns: RegExp[], block: string): boolean {
  const lines = block.split('\n');
  for (const line of lines) {
    if (isCommentLine(line)) continue;
    if (patterns.some(p => p.test(line))) return true;
  }
  return false;
}

/** Find 1-based line numbers where patterns match (skipping comments) */
function findMatchLines(lines: string[], patterns: RegExp[], startIdx: number): number[] {
  const result: number[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    if (isCommentLine(lines[i])) continue;
    if (patterns.some(p => p.test(lines[i]))) result.push(i + 1);
  }
  return result;
}

// ── Mini Taint Tracker ────────────────────────────────────────────────
//
// Tracks variable assignments within a handler block to follow data flow.
// Not full dataflow analysis, but handles the common patterns:
//   const url = params.url;  →  taint: {url}
//   const target = url;      →  taint: {url, target}
//   fetch(target);           →  tainted var reaches sink

/** Patterns that indicate param/input sources */
const PARAM_SOURCE_TS = /\b(request\.params|params\.|args\.|input\.|request\.\w+)\b|\b(params|arguments|args|input)\s*[\[.]/;
const PARAM_SOURCE_PY = /\b(request\.params|params\[|args\[|kwargs\[|arguments\s*\[)/;

/**
 * Extract tainted variable names from a handler block.
 * Follows assignments transitively up to MAX_HOPS.
 *
 * Handles:
 *   const url = params.url           →  taint {url}
 *   const { path, query } = params   →  taint {path, query}
 *   const target = url               →  taint {target} (if url is tainted)
 *   const full = `prefix${target}`   →  taint {full} (if target is tainted)
 */
function collectTaintedVars(
  lines: string[],
  regionStart: number,
  regionEnd: number,
  sourcePattern: RegExp,
): Set<string> {
  const tainted = new Set<string>();
  const MAX_HOPS = 3;

  // Pass 1: Find direct assignments from source
  for (let i = regionStart; i < regionEnd; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;

    // const/let/var name = <source>
    const assignMatch = line.match(/\b(?:const|let|var)\s+(\w+)\s*=\s*(.*)/);
    if (assignMatch && sourcePattern.test(assignMatch[2])) {
      tainted.add(assignMatch[1]);
    }

    // Destructuring: const { a, b, prop: alias } = <source>
    // For renaming destructuring (prop: alias), taint the LOCAL alias, not the property name
    const destructMatch = line.match(/\b(?:const|let|var)\s+\{\s*([^}]+)\}\s*=\s*(.*)/);
    if (destructMatch && sourcePattern.test(destructMatch[2])) {
      for (const name of destructMatch[1].split(',')) {
        const parts = name.trim().split(/\s*:\s*/);
        // { prop: alias } → taint "alias"; { prop } → taint "prop"
        const localName = (parts.length > 1 ? parts[parts.length - 1] : parts[0]).trim().split(/\s*=\s*/)[0].trim();
        if (localName && /^\w+$/.test(localName)) tainted.add(localName);
      }
    }

    // Python: name = <source>
    const pyAssign = line.match(/^\s*(\w+)\s*=\s*(.*)/);
    if (pyAssign && sourcePattern.test(pyAssign[2])) {
      tainted.add(pyAssign[1]);
    }
  }

  // Pass 2+: Follow transitive assignments (up to MAX_HOPS)
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const prevSize = tainted.size;
    for (let i = regionStart; i < regionEnd; i++) {
      const line = lines[i];
      if (isCommentLine(line)) continue;

      // const/let/var name = <tainted_var>
      // BUT: skip function call results — `res = await fetch(tainted)` does NOT taint `res`
      // EXCEPT: taint-preserving transforms that pass data through unchanged
      const assignMatch = line.match(/\b(?:const|let|var)\s+(\w+)\s*=\s*(.*)/);
      if (assignMatch && !tainted.has(assignMatch[1])) {
        const rhs = assignMatch[2].trim();
        const isCallResult = /^(?:await\s+)?\w[\w.]*\s*\(/.test(rhs);
        // Taint-preserving: encodeURIComponent(x), encodeURI(x), String(x), x.trim(), x.toString(), etc.
        const isTaintPreserving = isCallResult && /^(?:encodeURIComponent|encodeURI|String|decodeURIComponent|decodeURI|JSON\.stringify)\s*\(/.test(rhs);
        if (!isCallResult || isTaintPreserving) {
          for (const tv of tainted) {
            if (new RegExp(`\\b${tv}\\b`).test(rhs)) {
              tainted.add(assignMatch[1]);
              break;
            }
          }
        }
      }

      // Python assignment (same call-result exclusion + taint-preserving)
      const pyAssign = line.match(/^\s*(\w+)\s*=\s*(.*)/);
      if (pyAssign && !tainted.has(pyAssign[1])) {
        const rhs = pyAssign[2].trim();
        const isCallResult = /^(?:await\s+)?\w[\w.]*\s*\(/.test(rhs);
        const isTaintPreservingPy = isCallResult && /^(?:str|urllib\.parse\.quote|urllib\.parse\.urlencode|json\.dumps)\s*\(/.test(rhs);
        if (!isCallResult || isTaintPreservingPy) {
          for (const tv of tainted) {
            if (new RegExp(`\\b${tv}\\b`).test(rhs)) {
              tainted.add(pyAssign[1]);
              break;
            }
          }
        }
      }
    }
    if (tainted.size === prevSize) break; // No new tainted vars found
  }

  return tainted;
}

/**
 * Check if param-tainted data flows to any of the sink match lines.
 * Uses variable tracking instead of proximity — follows assignments transitively.
 */
function hasParamFlowToSink(
  lines: string[],
  sinkMatchLines: number[],
  regionStart: number,
  regionEnd: number,
  lang: 'ts' | 'py',
): boolean {
  const sourcePattern = lang === 'py' ? PARAM_SOURCE_PY : PARAM_SOURCE_TS;

  // Check if params appear directly on any sink line (inline flow)
  for (const sinkLine of sinkMatchLines) {
    if (sourcePattern.test(lines[sinkLine - 1])) return true;
  }

  // Collect tainted variables from param sources
  const tainted = collectTaintedVars(lines, regionStart, regionEnd, sourcePattern);
  if (tainted.size === 0) return false;

  // Check if any tainted variable appears on a sink line
  for (const sinkLine of sinkMatchLines) {
    const line = lines[sinkLine - 1];
    for (const tv of tainted) {
      if (new RegExp(`\\b${tv}\\b`).test(line)) return true;
    }
  }

  return false;
}

/**
 * Check if secret-tainted data flows into response content lines.
 * Collects variables assigned from secret patterns, follows assignments,
 * then checks if they appear in return/content blocks.
 */
function hasSecretFlowToResponse(
  lines: string[],
  regionStart: number,
  regionEnd: number,
  secretPatterns: RegExp[],
  lang: 'ts' | 'py',
): boolean {
  // Build a combined source pattern from all secret sink patterns
  const combinedSource = new RegExp(secretPatterns.map(p => p.source).join('|'), 'i');

  // Check if secrets appear directly in response lines
  const response = extractResponseContentLines(lines, regionStart, regionEnd);
  if (response.lineNumbers.length === 0) return false;

  // Direct match: secret pattern in response block
  for (const lineNum of response.lineNumbers) {
    if (secretPatterns.some(p => p.test(lines[lineNum - 1]))) return true;
  }

  // Taint tracking: follow secret assignments to response
  const tainted = collectTaintedVars(lines, regionStart, regionEnd, combinedSource);
  if (tainted.size === 0) return false;

  for (const lineNum of response.lineNumbers) {
    const line = lines[lineNum - 1];
    for (const tv of tainted) {
      if (new RegExp(`\\b${tv}\\b`).test(line)) return true;
    }
  }

  return false;
}

// ── Response content extraction ───────────────────────────────────────

/**
 * Extract lines that are part of the response/return content in a handler.
 * Matches: return { content: [...] }, return { text: ... }, return statements,
 * and content array construction.
 */
function extractResponseContentLines(
  lines: string[],
  regionStart: number,
  regionEnd: number,
): { text: string; lineNumbers: number[] } {
  const responseLines: string[] = [];
  const lineNumbers: number[] = [];

  let inReturn = false;
  let braceDepth = 0;

  for (let i = regionStart; i < regionEnd; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;

    // Detect return statements and content blocks
    if (/\breturn\s*[{\[(]/.test(line) || /\breturn\s*$/.test(line)) {
      inReturn = true;
      braceDepth = 0;
    }

    // Track content: [...] and text: constructions
    if (/\bcontent\s*:\s*\[/.test(line) || /\btext\s*:/.test(line)) {
      inReturn = true;
      braceDepth = 0;
    }

    if (inReturn) {
      responseLines.push(line);
      lineNumbers.push(i + 1); // 1-based

      // Track brace depth to know when the return block ends
      for (const ch of line) {
        if (ch === '{' || ch === '[' || ch === '(') braceDepth++;
        if (ch === '}' || ch === ']' || ch === ')') braceDepth--;
      }

      // If we hit a semicolon or braces close, return block is done
      if (/;\s*$/.test(line) && braceDepth <= 0) {
        inReturn = false;
      }
      if (braceDepth < 0) {
        inReturn = false;
        braceDepth = 0;
      }
    }
  }

  return { text: responseLines.join('\n'), lineNumbers };
}

// ── Main runner ──────────────────────────────────────────────────────

/** Run all compiled rules against an MCP server source file */
export function runCompiledRules(
  rules: CompiledMCPRule[],
  source: string,
  filePath: string,
): ReviewFinding[] {
  if (!isMCPServer(source, filePath)) return [];

  const lang = detectLanguage(filePath);
  const lines = source.split('\n');
  const findings: ReviewFinding[] = [];

  for (const rule of rules) {
    if (rule.delegate) continue;  // Delegated to TypeScript — skip compiled runner

    const ruleFindings = runSingleRule(rule, source, lines, filePath, lang);
    findings.push(...ruleFindings);
  }

  return findings;
}

/** Run a single compiled rule */
function runSingleRule(
  rule: CompiledMCPRule,
  source: string,
  lines: string[],
  filePath: string,
  lang: 'ts' | 'py',
): ReviewFinding[] {
  // ── Layer 0: Regex pre-filter ─────────────────────────────────────
  // Quick bail: check if ANY sink pattern matches anywhere in source
  const allSinkPatterns = rule.sinks.flatMap(s => langPatterns(s.patterns, lang));
  if (allSinkPatterns.length > 0 && !anyMatch(allSinkPatterns, source)) {
    return [];
  }

  // ── Layer 1: Structural match ─────────────────────────────────────
  const language = lang === 'py' ? 'python' : 'typescript';
  const regions = findToolHandlerRegions(lines, language as 'typescript' | 'python');
  const findings: ReviewFinding[] = [];

  for (const region of regions) {
    const block = lines.slice(region.start, region.end).join('\n');

    // Check which sinks are present in this handler
    const matchedSinks: { sink: CompiledSink; matchLines: number[] }[] = [];
    for (const sink of rule.sinks) {
      const patterns = langPatterns(sink.patterns, lang);
      if (patterns.length === 0) continue;
      if (!anyMatchSkipComments(patterns, block)) continue;

      const matchLines = findMatchLines(lines, patterns, region.start)
        .filter(l => l >= region.start && l <= region.end);
      if (matchLines.length > 0) {
        matchedSinks.push({ sink, matchLines });
      }
    }

    // Allow through if invariants use source-code scope (sinks may be in helper functions)
    if (matchedSinks.length === 0 && !rule.invariants.some(i => i.from === 'source-code' || i.from === 'tool-handler')) continue;

    // Check which guards are present in this handler (skip comment lines)
    const matchedGuards = new Set<string>();
    for (const guard of rule.guards) {
      const patterns = langPatterns(guard.patterns, lang);
      if (patterns.length === 0) continue;
      if (anyMatchSkipComments(patterns, block)) {
        // If guard has companion requirements, check those too
        if (guard.needs) {
          const companionsPresent = guard.needs.every(needed => {
            const companion = rule.guards.find(g => g.name === needed);
            if (!companion) return false;
            return anyMatchSkipComments(langPatterns(companion.patterns, lang), block);
          });
          if (!companionsPresent) continue;
        }
        matchedGuards.add(guard.name);
      }
    }

    // ── Layer 2: Flow assertion (invariants) ────────────────────────
    for (const inv of rule.invariants) {
      // from=tool-handler skips sink check — fires for every handler region
      const isHandlerScope = inv.from === 'tool-handler';

      // Find sinks referenced by this invariant
      const targetSinks = matchedSinks.filter(ms => ms.sink.name === inv.to || ms.sink.kind === inv.to);
      const isSourceScope = inv.from === 'source-code';
      if (!isHandlerScope && !isSourceScope && targetSinks.length === 0) continue;

      // Check if required guards are present
      const guardsSatisfied = inv.guardedBy.length === 0 ||
        inv.guardedBy.some(g => matchedGuards.has(g));

      if (guardsSatisfied) continue;

      // Check source presence based on invariant scope
      if (inv.from === 'tool-handler') {
        // Always matches — fires for every handler region (used for absence checks like "no logging")
        // The guard check above handles the logic: if guard is present, guardsSatisfied = true → continue (skip)
        // If no guard → falls through to finding emission below
      } else if (inv.from === 'tool-params') {
        // Proximity-based flow: params must appear near the sink match lines
        const allSinkLines = targetSinks.flatMap(ms => ms.matchLines);
        if (!hasParamFlowToSink(lines, allSinkLines, region.start, region.end, lang)) continue;
      } else if (inv.from === 'tool-description') {
        // Extract tool description from the .tool() call line region
        const descText = extractToolDescription(lines, region.start);
        if (!descText) continue;
        // Check if any target sink patterns appear in the description
        const sinkPatterns = targetSinks.flatMap(ms => langPatterns(ms.sink.patterns, lang));
        if (sinkPatterns.length > 0 && !sinkPatterns.some(p => p.test(descText))) continue;
      } else if (inv.from === 'response-content') {
        // Taint-tracked: check if secret patterns flow to response content
        const sinkPatterns = targetSinks.flatMap(ms => langPatterns(ms.sink.patterns, lang));
        if (sinkPatterns.length === 0) continue;
        if (!hasSecretFlowToResponse(lines, region.start, region.end, sinkPatterns, lang)) continue;
      } else if (inv.from === 'source-code') {
        // Source-code scope: check the ENTIRE file, not just handler region.
        // Real code calls helper functions from handlers — sinks may be outside the region.
        const allSinkPatterns = rule.sinks
          .filter(s => s.name === inv.to || s.kind === inv.to)
          .flatMap(s => langPatterns(s.patterns, lang));
        if (allSinkPatterns.length === 0) continue;
        const fileMatchLines = findMatchLines(lines, allSinkPatterns, 0);
        if (fileMatchLines.length === 0) continue;
        // Check if any guard is present anywhere in the file
        const fileBlock = source;
        const hasFileGuard = inv.guardedBy.some(g => {
          const guard = rule.guards.find(gd => gd.name === g);
          if (!guard) return false;
          return anyMatch(langPatterns(guard.patterns, lang), fileBlock);
        });
        if (hasFileGuard) continue;
      }
      // fallthrough: other from values — sinks already matched in block

      // Invariant violated — emit finding at first sink match line (or region start for absence rules)
      // For source-code scope, use the file-wide match line
      let firstSinkLine: number;
      if (targetSinks.length > 0) {
        firstSinkLine = targetSinks[0].matchLines[0];
      } else if (isSourceScope) {
        // Find first sink match in the full file for source-code scope
        const allSP = rule.sinks.filter(s => s.name === inv.to || s.kind === inv.to).flatMap(s => langPatterns(s.patterns, lang));
        const fml = findMatchLines(lines, allSP, 0);
        firstSinkLine = fml.length > 0 ? fml[0] : region.start + 1;
      } else {
        firstSinkLine = region.start + 1;
      }
      findings.push({
        source: 'kern',
        ruleId: rule.ruleId,
        severity: rule.severity,
        category: 'bug',
        message: inv.evidence || `MCP security rule "${rule.ruleId}" violated — ${inv.name}`,
        primarySpan: span(filePath, firstSinkLine),
        fingerprint: createFingerprint(rule.ruleId, firstSinkLine, 1),
        suggestion: inv.suggestion,
        confidence: rule.confidence,
      });
      break;  // One finding per invariant per region
    }

    // If no invariants, fall back to structural check: sinks without guards
    if (rule.invariants.length === 0 && matchedGuards.size === 0) {
      for (const ms of matchedSinks) {
        findings.push({
          source: 'kern',
          ruleId: rule.ruleId,
          severity: rule.severity,
          category: 'bug',
          message: `MCP tool handler has ${ms.sink.kind} sink without required guard — ${rule.ruleId}`,
          primarySpan: span(filePath, ms.matchLines[0]),
          fingerprint: createFingerprint(rule.ruleId, ms.matchLines[0], 1),
          confidence: rule.confidence,
        });
      }
    }
  }

  // Fallback: if no handler regions found but file is MCP server
  if (regions.length === 0 && allSinkPatterns.length > 0) {
    for (const sink of rule.sinks) {
      const patterns = langPatterns(sink.patterns, lang);
      const matchLines = findMatchLines(lines, patterns, 0);
      for (const lineNum of matchLines) {
        findings.push({
          source: 'kern',
          ruleId: rule.ruleId,
          severity: 'warning' as const,
          category: 'bug',
          message: `${sink.kind} pattern in MCP server — potential ${rule.ruleId}`,
          primarySpan: span(filePath, lineNum),
          fingerprint: createFingerprint(rule.ruleId, lineNum, 1),
          confidence: rule.confidence * 0.8,
        });
      }
    }
  }

  return findings;
}
