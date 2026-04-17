/**
 * Reporter — formats review reports for CLI output, JSON, and enforcement.
 *
 * v2: Unified multi-source report with source tags [kern] [eslint] [tsc] [llm].
 *     Dedup across sources. Fingerprint-based cross-run stability.
 */

import { buildLLMPrompt, exportKernIR } from './llm-review.js';
import type {
  EnforceResult,
  InferResult,
  ReviewConfig,
  ReviewFinding,
  ReviewReport,
  ReviewStats,
  TemplateMatch,
} from './types.js';

// ── Default Confidence Assignment ────────────────────────────────────────

/**
 * Default confidence by finding source.
 * TSC is compiler-verified (1.0), kern AST rules are high (0.85),
 * native .kern rules slightly lower (0.80), ESLint is mature (0.90),
 * LLM findings already have 0.70 set.
 */
const SOURCE_CONFIDENCE: Record<string, number> = {
  tsc: 1.0,
  eslint: 0.9,
  kern: 0.85,
  'kern-native': 0.8,
  llm: 0.7,
};

/** Taint rules get higher confidence — they trace actual data flow */
const TAINT_RULE_PREFIX = 'taint-';

/** Structural diff findings are heuristic — lower confidence */
const LOW_CONFIDENCE_RULES = new Set(['extra-code', 'inconsistent-pattern', 'style-difference', 'missing-type']);

/**
 * Assign calibrated confidence scores to findings that don't already have one.
 * Call after all phases, before filtering/display.
 */
export function assignDefaultConfidence(findings: ReviewFinding[]): void {
  for (const f of findings) {
    if (f.confidence !== undefined) continue;

    if (f.ruleId.startsWith(TAINT_RULE_PREFIX)) {
      f.confidence = 0.95;
    } else if (LOW_CONFIDENCE_RULES.has(f.ruleId)) {
      f.confidence = 0.6;
    } else {
      f.confidence = SOURCE_CONFIDENCE[f.source] ?? 0.85;
    }
  }
}

// ── Stats Calculation ────────────────────────────────────────────────────

export function calculateStats(
  inferred: InferResult[],
  templateMatches: TemplateMatch[],
  _findings: ReviewFinding[],
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

  const reductionPct = totalTsTokens > 0 ? Math.round((1 - totalKernTokens / totalTsTokens) * 100) : 0;

  return {
    totalLines,
    coveredLines,
    coveragePct,
    totalTsTokens,
    totalKernTokens,
    reductionPct,
    constructCount: inferred.length + templateMatches.filter((t) => t.suggestedKern).length,
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
    // Fingerprint is collision-free (ruleId:line:col). Add full message to
    // handle rules that emit multiple findings at the same location with
    // different messages (e.g. machine-gap per unreachable state).
    const key = `${f.fingerprint}:${f.message}`;
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

  // Suppress empty-catch when ignored-error fires on the same line (concept rule is more semantic)
  const ignoredErrorLines = new Set<number>();
  for (const f of seen.values()) {
    if (f.ruleId === 'ignored-error') ignoredErrorLines.add(f.primarySpan.startLine);
  }
  const result: ReviewFinding[] = [];
  for (const f of seen.values()) {
    if (f.ruleId === 'empty-catch' && ignoredErrorLines.has(f.primarySpan.startLine)) continue;
    result.push(f);
  }

  return result;
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

export function checkEnforcement(report: ReviewReport, config: ReviewConfig): EnforceResult {
  const minCoverage = config.minCoverage ?? 0;
  const actualCoverage = report.stats.coveragePct;
  const templateViolations: string[] = [];

  if (config.enforceTemplates) {
    const registeredSet = new Set(config.registeredTemplates || []);
    for (const t of report.templateMatches) {
      if (registeredSet.has(t.templateName) && !t.suggestedKern) {
        templateViolations.push(`${t.libraryName} pattern detected but not using KERN template '${t.templateName}'`);
      }
    }
  }

  // Filter findings by minConfidence — findings without confidence default to 1.0 (fully trusted)
  const minConf = config.minConfidence ?? 0;
  const countable = report.findings.filter((f) => (f.confidence ?? 1.0) >= minConf);
  const errors = countable.filter((f) => f.severity === 'error').length;
  const warnings = countable.filter((f) => f.severity === 'warning').length;
  const maxErrors = config.maxErrors ?? 0;
  const maxWarnings = config.maxWarnings ?? Number.MAX_SAFE_INTEGER;

  let maxComplexity = 0;
  for (const f of report.findings) {
    if (f.ruleId === 'cognitive-complexity') {
      const match = f.message.match(/complexity of (\d+)/);
      if (match) {
        maxComplexity = Math.max(maxComplexity, parseInt(match[1], 10));
      }
    }
  }
  const allowedComplexity = config.maxComplexity ?? 15;

  const passed =
    actualCoverage >= minCoverage &&
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
    complexity: { actual: maxComplexity, max: allowedComplexity },
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

  // Render health banner BEFORE findings. Users need to know which subsystems skipped/fell
  // back before they interpret "0 findings" as "the file is clean" — a clean report and a
  // report where half the checks didn't run used to look identical in the CLI.
  if (report.health && report.health.entries.length > 0) {
    const label = report.health.status === 'partial' ? 'PARTIAL' : 'DEGRADED';
    lines.push(`  [${label}] Review ran in ${report.health.status} mode:`);
    for (const entry of report.health.entries) {
      lines.push(`    - ${entry.subsystem} (${entry.kind}): ${entry.message}`);
    }
    lines.push('');
  }

  if (report.inferred.length > 0) {
    lines.push(`  KERN-expressible (${report.inferred.length} constructs):`);
    for (const r of report.inferred) {
      const loc = r.startLine === r.endLine ? `L${r.startLine}` : `L${r.startLine}-${r.endLine}`;
      const padLoc = loc.padEnd(12);
      const padSummary = r.summary.substring(0, 50).padEnd(50);
      const conf = `(${r.confidencePct}%)`;
      lines.push(`    ${padLoc}${padSummary} ${conf}`);
    }
    lines.push('');
  }

  if (report.templateMatches.length > 0) {
    const withSuggestions = report.templateMatches.filter((t) => t.suggestedKern);
    const withoutSuggestions = report.templateMatches.filter((t) => !t.suggestedKern);

    if (withSuggestions.length > 0) {
      lines.push(`  Suggested .kern rewrites (${withSuggestions.length}):`);
      for (const t of withSuggestions) {
        const savings = t.tsTokens && t.kernTokens ? ` (${t.tsTokens} → ${t.kernTokens} tokens)` : '';
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
  const minConf = config?.minConfidence ?? 0;
  const allFindings = dedup(report.findings).filter((f) => (f.confidence ?? 1.0) >= minConf);
  if (allFindings.length > 0) {
    const errors = allFindings.filter((f) => f.severity === 'error');
    const warnings = allFindings.filter((f) => f.severity === 'warning');
    const infos = allFindings.filter((f) => f.severity === 'info');
    const confPrefix = (f: ReviewFinding) =>
      showConf && f.confidence !== undefined ? ` [${f.confidence.toFixed(2)}]` : '';

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
  lines.push(
    `  Summary: ${s.coveragePct}% KERN coverage, ~${s.totalTsTokens} → ${s.totalKernTokens} KERN tokens (${s.reductionPct}% reduction)`,
  );

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
  lines.push(
    `    Warnings:   ${result.warnings.actual} (max: ${result.warnings.max === Number.MAX_SAFE_INTEGER ? 'unlimited' : result.warnings.max})`,
  );

  for (const v of result.templateViolations) {
    lines.push(`    Template:   ${v}`);
  }

  return lines.join('\n');
}

// ── JSON Format ──────────────────────────────────────────────────────────

export function formatReportJSON(report: ReviewReport, options?: { includeLLMPrompt?: boolean }): string {
  if (!options?.includeLLMPrompt) {
    return JSON.stringify(report, null, 2);
  }

  // Include KERN IR and LLM prompt so the calling AI can review
  const llmPrompt = buildLLMPrompt(report.inferred, report.templateMatches);
  const kernIR = exportKernIR(report.inferred, report.templateMatches);

  return JSON.stringify(
    {
      ...report,
      kernIR,
      llmPrompt,
    },
    null,
    2,
  );
}

// ── SARIF Format ─────────────────────────────────────────────────────────

export function formatSARIF(reports: ReviewReport[]): string {
  return formatSARIFWithMetadata(reports);
}

export interface SARIFMetadataOptions {
  suppressedFindings?: ReviewFinding[];
  getBaselineStatus?: (report: ReviewReport, finding: ReviewFinding) => 'new' | 'existing' | undefined;
}

export function formatSARIFWithMetadata(reports: ReviewReport[], options: SARIFMetadataOptions = {}): string {
  const { suppressedFindings, getBaselineStatus } = options;
  const sarif = {
    $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: '@kernlang/review',
            version: '2.0.0',
            rules: [] as any[],
          },
        },
        results: [] as any[],
      },
    ],
  };

  const rules = new Set<string>();
  const suppressedSet = new Set(suppressedFindings?.map((f) => `${f.primarySpan.file}:${f.fingerprint}`) ?? []);

  function pushResult(
    finding: ReviewFinding,
    report: ReviewReport | undefined,
    overrides: { isSuppressedInSource?: boolean } = {},
  ): void {
    if (!rules.has(finding.ruleId)) {
      rules.add(finding.ruleId);
      sarif.runs[0].tool.driver.rules.push({
        id: finding.ruleId,
        shortDescription: { text: finding.ruleId },
        helpUri: `https://github.com/kern-lang/kern-lang/blob/main/docs/rules.md#${finding.ruleId}`,
      });
    }

    const sarifLevel = finding.severity === 'error' ? 'error' : finding.severity === 'warning' ? 'warning' : 'note';
    const baselineStatus = report ? getBaselineStatus?.(report, finding) : undefined;
    const properties: Record<string, unknown> = {};

    const result: Record<string, unknown> = {
      ruleId: finding.ruleId,
      level: sarifLevel,
      message: { text: finding.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: finding.primarySpan.file },
            region: {
              startLine: finding.primarySpan.startLine,
              startColumn: finding.primarySpan.startCol,
              endLine: finding.primarySpan.endLine,
              endColumn: finding.primarySpan.endCol,
            },
          },
        },
      ],
    };

    // SARIF result.rank is 0.0–100.0 per spec; kern/confidence stays 0–1
    if (finding.confidence !== undefined) {
      result.rank = finding.confidence * 100;
      properties['kern/confidence'] = finding.confidence;
    }
    if (baselineStatus) {
      properties['kern/baselineStatus'] = baselineStatus;
    }
    if (Object.keys(properties).length > 0) {
      result.properties = properties;
    }

    const suppressions: Array<{ kind: string; justification: string }> = [];
    if (overrides.isSuppressedInSource || suppressedSet.has(`${finding.primarySpan.file}:${finding.fingerprint}`)) {
      suppressions.push({
        kind: 'inSource',
        justification: 'kern-ignore directive',
      });
    }
    if (baselineStatus === 'existing') {
      suppressions.push({
        kind: 'external',
        justification: 'Present in review baseline',
      });
    }
    if (suppressions.length > 0) {
      result.suppressions = suppressions;
    }

    sarif.runs[0].results.push(result);
  }

  for (const report of reports) {
    for (const finding of report.findings) {
      pushResult(finding, report);
    }
    for (const finding of report.suppressedFindings ?? []) {
      pushResult(finding, report, { isSuppressedInSource: true });
    }
  }

  for (const finding of suppressedFindings ?? []) {
    pushResult(finding, undefined, { isSuppressedInSource: true });
  }

  return JSON.stringify(sarif, null, 2);
}

/**
 * Format SARIF with suppression metadata.
 * Suppressed findings appear with a `suppressions` array per SARIF v2.1.0 section 3.35.
 */
export function formatSARIFWithSuppressions(reports: ReviewReport[], suppressedFindings?: ReviewFinding[]): string {
  return formatSARIFWithMetadata(reports, { suppressedFindings });
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
