/**
 * Reporter — formats review reports for CLI output, JSON, and enforcement.
 *
 * v2: Unified multi-source report with source tags [kern] [eslint] [tsc] [llm].
 *     Dedup across sources. Fingerprint-based cross-run stability.
 */

import type { ReviewReport, ReviewStats, ReviewFinding, InferResult, TemplateMatch, EnforceResult, ReviewConfig } from './types.js';
import { buildLLMPrompt, exportKernIR } from './llm-review.js';

// ── Stats Calculation ────────────────────────────────────────────────────

export function calculateStats(
  inferred: InferResult[],
  templateMatches: TemplateMatch[],
  findings: ReviewFinding[],
  totalLines: number,
): ReviewStats {
  const coveredLineSet = new Set<number>();
  for (const r of inferred) {
    for (let i = r.startLine; i <= r.endLine; i++) {
      coveredLineSet.add(i);
    }
  }

  // Also count template match coverage (the library code bodies)
  for (const t of templateMatches) {
    if (t.suggestedKern) {
      for (let i = t.startLine; i <= t.endLine; i++) {
        coveredLineSet.add(i);
      }
    }
  }

  const coveredLines = coveredLineSet.size;
  const coveragePct = totalLines > 0 ? Math.round((coveredLines / totalLines) * 100) : 0;

  let totalTsTokens = inferred.reduce((sum, r) => sum + r.tsTokens, 0);
  let totalKernTokens = inferred.reduce((sum, r) => sum + r.kernTokens, 0);

  // Add template match token savings
  for (const t of templateMatches) {
    if (t.suggestedKern && t.kernTokens && t.tsTokens) {
      totalTsTokens += t.tsTokens;
      totalKernTokens += t.kernTokens;
    }
  }

  const reductionPct = totalTsTokens > 0
    ? Math.round((1 - totalKernTokens / totalTsTokens) * 100)
    : 0;

  return {
    totalLines,
    coveredLines,
    coveragePct,
    totalTsTokens,
    totalKernTokens,
    reductionPct,
    constructCount: inferred.length + templateMatches.filter(t => t.suggestedKern).length,
  };
}

// ── Dedup ────────────────────────────────────────────────────────────────

/**
 * Deduplicate findings using fingerprint + message hash.
 * Fingerprint alone can collide when a rule emits multiple findings at the same location
 * (e.g., machine-gap fires once per unreachable state on the same type declaration line).
 */
export function dedup(findings: ReviewFinding[]): ReviewFinding[] {
  const seen = new Map<string, ReviewFinding>();

  for (const f of findings) {
    // Combine fingerprint with message prefix to avoid false merges
    const key = `${f.fingerprint}:${f.message.substring(0, 40)}`;
    const existing = seen.get(key);

    if (existing) {
      // Keep the higher-severity finding
      const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
      if (order[f.severity] < order[existing.severity]) {
        seen.set(key, f);
      }
    } else {
      seen.set(key, f);
    }
  }

  return [...seen.values()];
}

/** Sort findings by severity (error > warning > info) then by line. Shared utility. */
export function sortFindings(findings: ReviewFinding[]): void {
  const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => {
    const sd = severityOrder[a.severity] - severityOrder[b.severity];
    if (sd !== 0) return sd;
    return a.primarySpan.startLine - b.primarySpan.startLine;
  });
}

/** Dedup + sort in one call. Replaces the 5 duplicated sort/dedup blocks. */
export function sortAndDedup(findings: ReviewFinding[]): ReviewFinding[] {
  const result = dedup(findings);
  sortFindings(result);
  return result;
}

// ── Enforcement ──────────────────────────────────────────────────────────

export function checkEnforcement(
  report: ReviewReport,
  config: ReviewConfig,
): EnforceResult {
  const minCoverage = config.minCoverage ?? 0;
  const actualCoverage = report.stats.coveragePct;
  const templateViolations: string[] = [];

  if (config.enforceTemplates) {
    const registeredSet = new Set(config.registeredTemplates || []);
    for (const t of report.templateMatches) {
      if (registeredSet.has(t.templateName) && !t.suggestedKern) {
        templateViolations.push(
          `${t.libraryName} pattern detected but not using KERN template '${t.templateName}'`
        );
      }
    }
  }

  // Filter findings by minConfidence — findings without confidence default to 1.0 (fully trusted)
  const minConf = config.minConfidence ?? 0;
  const countable = report.findings.filter(f => (f.confidence ?? 1.0) >= minConf);
  const errors = countable.filter(f => f.severity === 'error').length;
  const warnings = countable.filter(f => f.severity === 'warning').length;
  const maxErrors = config.maxErrors ?? 0;
  const maxWarnings = config.maxWarnings ?? Number.MAX_SAFE_INTEGER;

  let maxComplexity = 0;
  for (const f of report.findings) {
    if (f.ruleId === 'cognitive-complexity') {
      const match = f.message.match(/complexity of (\d+)/);
      if (match) {
        maxComplexity = Math.max(maxComplexity, parseInt(match[1]));
      }
    }
  }
  const allowedComplexity = config.maxComplexity ?? 15;

  const passed = actualCoverage >= minCoverage &&
                 templateViolations.length === 0 &&
                 errors <= maxErrors &&
                 warnings <= maxWarnings &&
                 maxComplexity <= allowedComplexity;

  return {
    passed,
    minCoverage,
    actualCoverage,
    templateViolations,
    errors: { actual: errors, max: maxErrors },
    warnings: { actual: warnings, max: maxWarnings },
    complexity: { actual: maxComplexity, max: allowedComplexity }
  };
}

// ── CLI Format ───────────────────────────────────────────────────────────

const SOURCE_TAGS: Record<string, string> = {
  kern: '[kern]',
  eslint: '[eslint]',
  tsc: '[tsc]',
  llm: '[llm]',
};

export function formatReport(report: ReviewReport, config?: ReviewConfig): string {
  const lines: string[] = [];

  lines.push(`  @kernlang/review — analyzing ${report.filePath}`);
  lines.push('');

  if (report.inferred.length > 0) {
    lines.push(`  KERN-expressible (${report.inferred.length} constructs):`);
    for (const r of report.inferred) {
      const loc = r.startLine === r.endLine
        ? `L${r.startLine}`
        : `L${r.startLine}-${r.endLine}`;
      const padLoc = loc.padEnd(12);
      const padSummary = r.summary.substring(0, 50).padEnd(50);
      const conf = `(${r.confidencePct}%)`;
      lines.push(`    ${padLoc}${padSummary} ${conf}`);
    }
    lines.push('');
  }

  if (report.templateMatches.length > 0) {
    const withSuggestions = report.templateMatches.filter(t => t.suggestedKern);
    const withoutSuggestions = report.templateMatches.filter(t => !t.suggestedKern);

    if (withSuggestions.length > 0) {
      lines.push(`  Suggested .kern rewrites (${withSuggestions.length}):`);
      for (const t of withSuggestions) {
        const savings = t.tsTokens && t.kernTokens
          ? ` (${t.tsTokens} → ${t.kernTokens} tokens)`
          : '';
        lines.push(`    ${t.templateName.padEnd(25)} → ${t.suggestedKern}${savings}`);
      }
      lines.push('');
    }

    if (withoutSuggestions.length > 0) {
      lines.push(`  Template matches (${withoutSuggestions.length}):`);
      for (const t of withoutSuggestions) {
        lines.push(`    ${t.templateName.padEnd(25)} ${t.libraryName.padEnd(20)} (${t.confidencePct}%)`);
      }
      lines.push('');
    }
  }

  // Unified findings — sorted by severity, with source tags
  const showConf = config?.showConfidence === true;
  const allFindings = dedup(report.findings);
  if (allFindings.length > 0) {
    const errors = allFindings.filter(f => f.severity === 'error');
    const warnings = allFindings.filter(f => f.severity === 'warning');
    const infos = allFindings.filter(f => f.severity === 'info');
    const confPrefix = (f: ReviewFinding) => showConf && f.confidence !== undefined ? ` [${f.confidence.toFixed(2)}]` : '';

    if (errors.length > 0) {
      lines.push(`  BUGS (${errors.length}):`);
      for (const f of errors) {
        const tag = SOURCE_TAGS[f.source] || '';
        const upstream = f.origin === 'upstream' ? ' [upstream]' : '';
        lines.push(`    ! L${f.primarySpan.startLine}: ${tag}${confPrefix(f)} [${f.ruleId}]${upstream} ${f.message}`);
        if (f.suggestion) lines.push(`      Fix: ${f.suggestion}`);
      }
      lines.push('');
    }

    if (warnings.length > 0) {
      lines.push(`  WARNINGS (${warnings.length}):`);
      for (const f of warnings) {
        const tag = SOURCE_TAGS[f.source] || '';
        const upstream = f.origin === 'upstream' ? ' [upstream]' : '';
        lines.push(`    ~ L${f.primarySpan.startLine}: ${tag}${confPrefix(f)} [${f.ruleId}]${upstream} ${f.message}`);
        if (f.suggestion) lines.push(`      Suggestion: ${f.suggestion}`);
      }
      lines.push('');
    }

    if (infos.length > 0) {
      lines.push(`  INFO (${infos.length}):`);
      for (const f of infos) {
        const tag = SOURCE_TAGS[f.source] || '';
        const upstream = f.origin === 'upstream' ? ` [upstream d=${f.distance ?? '?'}]` : '';
        lines.push(`    - L${f.primarySpan.startLine}: ${tag}${confPrefix(f)} [${f.ruleId}]${upstream} ${f.message}`);
      }
      lines.push('');
    }
  }

  const s = report.stats;
  lines.push(`  Summary: ${s.coveragePct}% KERN coverage, ~${s.totalTsTokens} → ${s.totalKernTokens} KERN tokens (${s.reductionPct}% reduction)`);

  // Confidence summary (when present)
  if (showConf && report.confidenceSummary) {
    const cs = report.confidenceSummary;
    lines.push(`  Confidence: ${cs.high} high (>0.9), ${cs.medium} medium (0.7-0.9), ${cs.low} low (<0.7)`);
    if (cs.unresolvedNeeds > 0) {
      lines.push(`  Unresolved needs: ${cs.unresolvedNeeds}`);
    }
  }

  return lines.join('\n');
}

// ── Enforcement Format ───────────────────────────────────────────────────

export function formatEnforcement(result: EnforceResult): string {
  const lines: string[] = [];

  if (result.passed) {
    lines.push(`  Enforcement: PASS`);
  } else {
    lines.push(`  Enforcement: FAIL`);
  }

  lines.push(`    Coverage:   ${result.actualCoverage}% (min: ${result.minCoverage}%)`);
  lines.push(`    Complexity: ${result.complexity.actual} (max: ${result.complexity.max})`);
  lines.push(`    Errors:     ${result.errors.actual} (max: ${result.errors.max})`);
  lines.push(`    Warnings:   ${result.warnings.actual} (max: ${result.warnings.max === Number.MAX_SAFE_INTEGER ? 'unlimited' : result.warnings.max})`);

  for (const v of result.templateViolations) {
    lines.push(`    Template:   ${v}`);
  }

  return lines.join('\n');
}

// ── JSON Format ──────────────────────────────────────────────────────────

export function formatReportJSON(
  report: ReviewReport,
  options?: { includeLLMPrompt?: boolean },
): string {
  if (!options?.includeLLMPrompt) {
    return JSON.stringify(report, null, 2);
  }

  // Include KERN IR and LLM prompt so the calling AI can review
  const llmPrompt = buildLLMPrompt(report.inferred, report.templateMatches);
  const kernIR = exportKernIR(report.inferred, report.templateMatches);

  return JSON.stringify({
    ...report,
    kernIR,
    llmPrompt,
  }, null, 2);
}

// ── SARIF Format ─────────────────────────────────────────────────────────

export function formatSARIF(reports: ReviewReport[]): string {
  const sarif = {
    $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: '@kernlang/review',
            version: '2.0.0',
            rules: [] as any[]
          }
        },
        results: [] as any[]
      }
    ]
  };

  const rules = new Set<string>();

  for (const report of reports) {
    for (const f of report.findings) {
      if (!rules.has(f.ruleId)) {
        rules.add(f.ruleId);
        sarif.runs[0].tool.driver.rules.push({
          id: f.ruleId,
          shortDescription: { text: f.ruleId },
          helpUri: `https://github.com/kern-lang/kern-lang/blob/main/docs/rules.md#${f.ruleId}`
        });
      }

      const sarifLevel = f.severity === 'error' ? 'error' : (f.severity === 'warning' ? 'warning' : 'note');

      const result: Record<string, unknown> = {
        ruleId: f.ruleId,
        level: sarifLevel,
        message: { text: f.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: f.primarySpan.file },
              region: {
                startLine: f.primarySpan.startLine,
                startColumn: f.primarySpan.startCol,
                endLine: f.primarySpan.endLine,
                endColumn: f.primarySpan.endCol
              }
            }
          }
        ],
      };
      // SARIF result.rank is 0.0–100.0 per spec; kern/confidence stays 0–1
      if (f.confidence !== undefined) {
        result.rank = f.confidence * 100;
        result.properties = { 'kern/confidence': f.confidence };
      }
      sarif.runs[0].results.push(result);
    }
  }

  return JSON.stringify(sarif, null, 2);
}

// ── Multi-file Summary ───────────────────────────────────────────────────

export function formatSummary(reports: ReviewReport[]): string {
  const lines: string[] = [];

  let totalConstructs = 0;
  let totalTsTokens = 0;
  let totalKernTokens = 0;
  let totalLines = 0;
  let coveredLines = 0;
  let totalFindings = 0;

  for (const r of reports) {
    totalConstructs += r.stats.constructCount;
    totalTsTokens += r.stats.totalTsTokens;
    totalKernTokens += r.stats.totalKernTokens;
    totalLines += r.stats.totalLines;
    coveredLines += r.stats.coveredLines;
    totalFindings += r.findings.length;
  }

  const coveragePct = totalLines > 0 ? Math.round((coveredLines / totalLines) * 100) : 0;
  const reductionPct = totalTsTokens > 0 ? Math.round((1 - totalKernTokens / totalTsTokens) * 100) : 0;

  lines.push(`  @kernlang/review — ${reports.length} files analyzed`);
  lines.push('');
  lines.push(`  Total constructs: ${totalConstructs}`);
  lines.push(`  Coverage:         ${coveragePct}%`);
  lines.push(`  Token reduction:  ${reductionPct}% (~${totalTsTokens} → ${totalKernTokens} KERN tokens)`);
  lines.push(`  Findings:         ${totalFindings}`);

  return lines.join('\n');
}
