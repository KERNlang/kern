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
import type { CompiledMCPRule, CompiledSink, CompiledGuard, CompiledInvariant } from './rule-compiler.js';
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
        .filter(l => l > region.start && l <= region.end);
      if (matchLines.length > 0) {
        matchedSinks.push({ sink, matchLines });
      }
    }

    if (matchedSinks.length === 0) continue;

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
      // Find sinks referenced by this invariant
      const targetSinks = matchedSinks.filter(ms => ms.sink.name === inv.to || ms.sink.kind === inv.to);
      if (targetSinks.length === 0) continue;

      // Check if required guards are present
      const guardsSatisfied = inv.guardedBy.length === 0 ||
        inv.guardedBy.some(g => matchedGuards.has(g));

      if (guardsSatisfied) continue;

      // Check source presence based on invariant scope
      if (inv.from === 'tool-params') {
        const hasParams = /\b(request\.params|params\.|arguments\??\.)\b/.test(block) ||
          /\b(params|arguments|args|input)\b/.test(block);
        if (!hasParams) continue;
      } else if (inv.from === 'tool-description') {
        // Extract tool description from the .tool() call line region
        const descText = extractToolDescription(lines, region.start);
        if (!descText) continue;
        // Check if any target sink patterns appear in the description
        const sinkPatterns = targetSinks.flatMap(ms => langPatterns(ms.sink.patterns, lang));
        if (sinkPatterns.length > 0 && !sinkPatterns.some(p => p.test(descText))) continue;
      }
      // from=source-code: no additional from-check — sinks already matched in block

      // Invariant violated — emit finding at first sink match line
      const firstSinkLine = targetSinks[0].matchLines[0];
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
