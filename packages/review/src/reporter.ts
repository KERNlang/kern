/**
 * Reporter — formats review reports for CLI output, JSON, and enforcement.
 *
 * v2: Unified multi-source report with source tags [kern] [eslint] [tsc] [llm].
 *     Dedup across sources. Fingerprint-based cross-run stability.
 */

import type { ReviewReport, ReviewStats, ReviewFinding, InferResult, TemplateMatch, EnforceResult, ReviewConfig } from './types.js';

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

/** Deduplicate findings: same line + similar message from different sources → collapse */
export function dedup(findings: ReviewFinding[]): ReviewFinding[] {
  const seen = new Map<string, ReviewFinding>();

  for (const f of findings) {
    // Dedup key: line + message prefix (collapses same message from different sources,
    // but keeps different findings at the same line separate)
    const key = `${f.primarySpan.startLine}:${f.message.substring(0, 60)}`;
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

  const passed = actualCoverage >= minCoverage && templateViolations.length === 0;

  return { passed, minCoverage, actualCoverage, templateViolations };
}

// ── CLI Format ───────────────────────────────────────────────────────────

const SOURCE_TAGS: Record<string, string> = {
  kern: '[kern]',
  eslint: '[eslint]',
  tsc: '[tsc]',
  llm: '[llm]',
};

export function formatReport(report: ReviewReport): string {
  const lines: string[] = [];

  lines.push(`  @kern/review — analyzing ${report.filePath}`);
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
  const allFindings = dedup(report.findings);
  if (allFindings.length > 0) {
    const errors = allFindings.filter(f => f.severity === 'error');
    const warnings = allFindings.filter(f => f.severity === 'warning');
    const infos = allFindings.filter(f => f.severity === 'info');

    if (errors.length > 0) {
      lines.push(`  BUGS (${errors.length}):`);
      for (const f of errors) {
        const tag = SOURCE_TAGS[f.source] || '';
        lines.push(`    ! L${f.primarySpan.startLine}: ${tag} [${f.ruleId}] ${f.message}`);
        if (f.suggestion) lines.push(`      Fix: ${f.suggestion}`);
      }
      lines.push('');
    }

    if (warnings.length > 0) {
      lines.push(`  WARNINGS (${warnings.length}):`);
      for (const f of warnings) {
        const tag = SOURCE_TAGS[f.source] || '';
        lines.push(`    ~ L${f.primarySpan.startLine}: ${tag} [${f.ruleId}] ${f.message}`);
        if (f.suggestion) lines.push(`      Suggestion: ${f.suggestion}`);
      }
      lines.push('');
    }

    if (infos.length > 0) {
      lines.push(`  INFO (${infos.length}):`);
      for (const f of infos) {
        const tag = SOURCE_TAGS[f.source] || '';
        lines.push(`    - L${f.primarySpan.startLine}: ${tag} [${f.ruleId}] ${f.message}`);
      }
      lines.push('');
    }
  }

  const s = report.stats;
  lines.push(`  Summary: ${s.coveragePct}% KERN coverage, ~${s.totalTsTokens} → ${s.totalKernTokens} KERN tokens (${s.reductionPct}% reduction)`);

  return lines.join('\n');
}

// ── Enforcement Format ───────────────────────────────────────────────────

export function formatEnforcement(result: EnforceResult): string {
  const lines: string[] = [];

  if (result.passed) {
    lines.push(`  Enforcement: PASS (${result.actualCoverage}% >= ${result.minCoverage}% min)`);
  } else {
    lines.push(`  Enforcement: FAIL`);
    if (result.actualCoverage < result.minCoverage) {
      lines.push(`    Coverage ${result.actualCoverage}% < ${result.minCoverage}% minimum`);
    }
    for (const v of result.templateViolations) {
      lines.push(`    Template: ${v}`);
    }
  }

  return lines.join('\n');
}

// ── JSON Format ──────────────────────────────────────────────────────────

export function formatReportJSON(report: ReviewReport): string {
  return JSON.stringify(report, null, 2);
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

  lines.push(`  @kern/review — ${reports.length} files analyzed`);
  lines.push('');
  lines.push(`  Total constructs: ${totalConstructs}`);
  lines.push(`  Coverage:         ${coveragePct}%`);
  lines.push(`  Token reduction:  ${reductionPct}% (~${totalTsTokens} → ${totalKernTokens} KERN tokens)`);
  lines.push(`  Findings:         ${totalFindings}`);

  return lines.join('\n');
}
