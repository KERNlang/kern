import type { IRNode } from '@kernlang/core';
import { clearTemplates, registerTemplate, VALID_TARGETS } from '@kernlang/core';
import type { LLMReviewInput, ReviewConfig, ReviewEvalCaseResult, ReviewFinding, ReviewReport } from '@kernlang/review';
import {
  analyzeTaint,
  applyReviewPolicyDefaults,
  buildLLMPrompt,
  buildReviewInstructions,
  checkEnforcement,
  checkSpecFiles,
  clearReviewCache,
  dedup,
  evaluateReviewReports,
  exportKernIR,
  formatEnforcement,
  formatReport,
  formatReviewEvalSummary,
  formatReviewTelemetrySummary,
  formatSARIF,
  formatSARIFWithMetadata,
  formatSummary,
  getRuleQualityProfile,
  getRuleRegistry,
  isLLMAvailable,
  linkToNodes,
  normalizeReviewEvalManifest,
  ReviewHealthBuilder,
  readReviewTelemetrySnapshots,
  resolveImportGraph,
  reviewFile,
  reviewGraph,
  runESLint,
  runLLMReview,
  runTSCDiagnosticsFromPaths,
  specViolationsToFindings,
  summarizeReviewEvalResults,
  summarizeReviewTelemetry,
  writeReviewTelemetrySnapshot,
} from '@kernlang/review';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, relative, resolve } from 'path';
import { withOptionalRemoteRepo } from '../remote-repo.js';
import {
  compareReportsToBaseline,
  createReviewBaseline,
  filterReportsToNewFindings,
  getReviewBaselineKeyForFinding,
  parseReviewBaseline,
  type ReviewBaselineComparison,
  type ReviewBaselineFile,
} from '../review-baseline.js';
import { collectTsFilesFlat, hasFlag, loadConfig, parseAndSurface, parseFlag, parseFlagOrNext } from '../shared.js';

type ReviewReportWithSuppressed = ReviewReport & { suppressedFindings?: ReviewFinding[] };

/**
 * Pick a safe default diff base for bare `kern review` inside a git repo.
 * Tries `origin/main`, then `origin/master`, then `HEAD~1`, returning the
 * first ref that `git rev-parse --verify` accepts. Returns undefined when
 * not in a git repo or no suitable ref exists (e.g. single-commit repo).
 *
 * Exported for testability.
 */
export function detectAutoDiffBase(cwd: string = process.cwd()): string | undefined {
  const verify = (ref: string): boolean => {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], {
        cwd,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      return true;
    } catch {
      return false;
    }
  };

  // Require this to actually be a git repo before trying refs.
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    return undefined;
  }

  for (const candidate of ['origin/main', 'origin/master', 'HEAD~1']) {
    if (verify(candidate)) return candidate;
  }
  return undefined;
}

function parseOptionalFlagOrNext(args: string[], flag: string, fallback: string): string {
  const eqArg = args.find((a) => a.startsWith(`${flag}=`));
  if (eqArg) return eqArg.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return fallback;
}

// ── Review pipeline ──────────────────────────────────────────────────────

async function runReviewPipeline(
  reviewConfig: ReviewConfig,
  entryFilePaths: string[],
  modes: {
    graphMode: boolean;
    batchMode: boolean;
    llmMode: boolean;
    cloudMode: boolean;
    securityMode: boolean;
    mcpMode: boolean;
    specMode: boolean;
    fixMode: boolean;
    autofixMode: boolean;
    lintMode: boolean;
    skipGenerated: boolean;
    exportKern: boolean;
    enforce: boolean;
    jsonOutput: boolean;
    sarifOutput: boolean;
    strictParse: boolean;
    maxDepth: number;
    batchSize: number;
    tsconfigPath?: string;
    specFile?: string;
    minCoverageArg?: string | number;
    maxComplexityArg?: string | number;
    maxErrorsArg?: string | number;
    maxWarningsArg?: string | number;
    showConfidence: boolean;
    baseline?: ReviewBaselineFile;
    writeBaselinePath?: string;
    newOnly: boolean;
  },
): Promise<{ reports: ReviewReport[]; exitCode: number }> {
  const startedAt = Date.now();
  const {
    graphMode,
    batchMode,
    llmMode,
    cloudMode,
    securityMode,
    mcpMode,
    specMode,
    fixMode,
    autofixMode,
    lintMode,
    skipGenerated,
    exportKern,
    enforce,
    jsonOutput,
    sarifOutput,
    maxDepth,
    batchSize,
    tsconfigPath,
    specFile,
    minCoverageArg,
    maxComplexityArg,
    maxErrorsArg,
    maxWarningsArg,
    baseline,
    writeBaselinePath,
    newOnly,
  } = modes;

  let reports: ReviewReport[] = [];

  if (graphMode && entryFilePaths.length > 0) {
    const graphOpts = { maxDepth, tsConfigFilePath: tsconfigPath };
    const graph = resolveImportGraph(entryFilePaths, graphOpts);
    console.log(`  Graph: ${graph.totalFiles} files resolved (${graph.skipped} skipped, depth ${maxDepth})`);
    reports = reviewGraph(entryFilePaths, reviewConfig, { ...graphOpts, precomputedGraph: graph });
  } else if (batchMode && entryFilePaths.length > batchSize) {
    const totalBatches = Math.ceil(entryFilePaths.length / batchSize);
    for (let i = 0; i < entryFilePaths.length; i += batchSize) {
      const batch = entryFilePaths.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      for (const f of batch) {
        try {
          reports.push(reviewFile(f, reviewConfig));
        } catch (e) {
          console.error(`  Review error in ${f}: ${(e as Error).message}`);
        }
      }
      const batchFindings = reports.slice(-batch.length).reduce((sum, r) => sum + r.findings.length, 0);
      console.log(`  Batch ${batchNum}/${totalBatches}: ${batch.length} files reviewed (${batchFindings} findings)`);
    }
  } else {
    for (const f of entryFilePaths) {
      try {
        reports.push(reviewFile(f, reviewConfig));
      } catch (e) {
        console.error(`  Review error in ${f}: ${(e as Error).message}`);
      }
    }
  }

  if (skipGenerated) {
    const before = reports.length;
    reports = reports.filter((r) => !r.generated);
    const dropped = before - reports.length;
    if (dropped > 0 && !jsonOutput && !sarifOutput) {
      console.log(`  Skipped ${dropped} generated file(s). Use --include-generated to review them.`);
    }
  }

  if (reports.length === 0) {
    console.log('  No reviewable files found (.ts/.tsx/.py/.kern).');
    return { reports, exitCode: 0 };
  }

  // MCP security review
  try {
    const { reviewIfMCP, reviewMCPSource } = await import('@kernlang/review-mcp');
    let mcpFileCount = 0;
    for (const report of reports) {
      const source = readFileSync(report.filePath, 'utf-8');
      const mcpFindings = mcpMode ? reviewMCPSource(source, report.filePath) : reviewIfMCP(source, report.filePath);
      if (mcpFindings && mcpFindings.length > 0) {
        report.findings.push(...mcpFindings);
        mcpFileCount++;
      }
    }
    if (mcpFileCount > 0 && !jsonOutput && !sarifOutput) {
      console.log(`  MCP security: ${mcpFileCount} server file(s) scanned`);
    }
  } catch {
    if (mcpMode) {
      console.error('  @kernlang/review-mcp not installed. Run: pnpm add @kernlang/review-mcp');
    }
  }

  // Auto LLM review when API key is set
  if (!llmMode && isLLMAvailable()) {
    const llmInputs: LLMReviewInput[] = reports.map((report) => {
      let source: string | undefined;
      try {
        source = readFileSync(report.filePath, 'utf-8');
      } catch {
        // File may have been deleted between scan and review — proceed without source
      }
      return {
        filePath: report.filePath,
        inferred: report.inferred,
        templateMatches: report.templateMatches,
        taintResults: analyzeTaint(report.inferred, report.filePath),
        source,
        staticFindings: report.findings,
        target: reviewConfig.target,
      };
    });

    try {
      const { findings: llmFindings } = await runLLMReview(llmInputs);
      if (llmFindings.length > 0) {
        if (!jsonOutput && !sarifOutput) {
          console.log(`  LLM review (auto): ${llmFindings.length} finding(s) from AI`);
        }
        for (const f of llmFindings) {
          const report = reports.find((r) => r.filePath === f.primarySpan.file);
          if (report) report.findings.push(f);
          else if (reports.length > 0) reports[0].findings.push(f);
        }
        for (const report of reports) {
          report.findings = dedup(report.findings);
        }
      }
    } catch (err) {
      // Auto LLM review is best-effort — log but don't block
      console.error(`  LLM review failed: ${(err as Error).message}`);
    }
  }

  if (exportKern) {
    for (const report of reports) {
      console.log(`\n// ── ${report.filePath} ──`);
      console.log(exportKernIR(report.inferred, report.templateMatches));
    }
    return { reports, exitCode: 0 };
  }

  // Spec mode
  if (specMode && specFile) {
    const kernFilePath = resolve(specFile);
    if (!existsSync(kernFilePath)) {
      console.error(`  .kern spec file not found: ${specFile}`);
      return { reports, exitCode: 1 };
    }

    console.log(`\n  KERN spec check: ${specFile} → ${reports.length} implementation files\n`);

    let totalViolations = 0;
    for (const report of reports) {
      const result = checkSpecFiles(kernFilePath, report.filePath);
      if (result.violations.length > 0) {
        const findings = specViolationsToFindings(result);
        totalViolations += findings.length;
        report.findings.push(...findings);
        report.findings = dedup(report.findings);

        for (const v of result.violations) {
          const icon = v.kind.includes('missing') || v.kind === 'spec-unimplemented' ? '✗' : '~';
          const sev =
            v.kind === 'spec-auth-missing' || v.kind === 'spec-unimplemented'
              ? 'ERROR'
              : v.kind === 'spec-undeclared'
                ? 'INFO'
                : 'WARN';
          console.log(`    ${icon} [${sev}] ${v.kind}: ${v.detail}`);
          if (v.suggestion) console.log(`      → ${v.suggestion}`);
        }
      }

      if (result.matched.length > 0) {
        const satisfied =
          result.matched.length -
          result.violations.filter((v) => v.kind !== 'spec-undeclared' && v.kind !== 'spec-unimplemented').length;
        console.log(
          `\n  Matched: ${result.matched.length} routes | Satisfied: ${satisfied} | Violations: ${totalViolations}`,
        );
        if (result.unmatchedSpecs.length > 0)
          console.log(`  Unimplemented: ${result.unmatchedSpecs.map((s) => s.routeKey).join(', ')}`);
        if (result.unmatchedImpls.length > 0)
          console.log(`  Undeclared: ${result.unmatchedImpls.map((i) => i.routeKey).join(', ')}`);
      }
    }

    if (totalViolations === 0) {
      console.log('  All spec contracts satisfied.');
    }
    console.log('');
  }

  // Security mode
  if (securityMode) {
    const SECURITY_RULES = new Set([
      'xss-unsafe-html',
      'hardcoded-secret',
      'command-injection',
      'no-eval',
      'insecure-random',
      'cors-wildcard',
      'helmet-missing',
      'open-redirect',
      'jwt-weak-verification',
      'cookie-hardening',
      'csrf-detection',
      'csp-strength',
      'path-traversal',
      'weak-password-hashing',
      'regex-dos',
      'missing-input-validation',
      'prototype-pollution',
      'information-exposure',
      'prompt-injection',
      'taint-command',
      'taint-fs',
      'taint-sql',
      'taint-redirect',
      'taint-eval',
      'taint-insufficient-sanitizer',
      'taint-crossfile-command',
      'taint-crossfile-fs',
      'taint-crossfile-sql',
      'taint-crossfile-redirect',
      'taint-crossfile-eval',
      'spec-auth-missing',
      'spec-validate-missing',
      'spec-guard-missing',
      'spec-middleware-missing',
      'spec-unimplemented',
    ]);

    console.log('\n  KERN Security Report\n');

    let totalSec = 0;
    for (const report of reports) {
      const secFindings = report.findings.filter((f) => SECURITY_RULES.has(f.ruleId));
      if (secFindings.length === 0) continue;
      totalSec += secFindings.length;

      const rel = relative(process.cwd(), report.filePath);
      console.log(`  ${rel}:`);
      for (const f of secFindings) {
        const icon = f.severity === 'error' ? '✗' : f.severity === 'warning' ? '~' : '-';
        console.log(`    ${icon} L${f.primarySpan.startLine}: [${f.ruleId}] ${f.message}`);
        if (f.suggestion) console.log(`      → ${f.suggestion}`);
      }
      console.log('');
    }

    if (totalSec === 0) {
      console.log('  No security issues found.');
    } else {
      const errors = reports
        .flatMap((r) => r.findings)
        .filter((f) => SECURITY_RULES.has(f.ruleId) && f.severity === 'error').length;
      const warnings = reports
        .flatMap((r) => r.findings)
        .filter((f) => SECURITY_RULES.has(f.ruleId) && f.severity === 'warning').length;
      console.log(`  Total: ${totalSec} security findings (${errors} errors, ${warnings} warnings)`);
    }

    console.log('  Rules: OWASP Top 10, OWASP LLM Top 10, Taint Tracking, Spec Contracts');
    console.log('');
    return { reports, exitCode: 0 };
  }

  // Cloud mode
  if (cloudMode) {
    console.log('');
    console.log('  KERN Pro — Cloud-powered AI review');
    console.log('');
    console.log('  Coming soon. Cloud review will provide:');
    console.log('    • LLM-powered security analysis without an AI IDE');
    console.log('    • Team dashboard with trend tracking');
    console.log('    • Custom rule engine for enterprise');
    console.log('    • CI/CD integration with quality gates');
    console.log('');
    console.log('  For now, use --llm with your AI assistant (Claude Code, Cursor, etc.)');
    console.log('  The assistant reads the KERN IR output and performs the AI review.');
    console.log('');
    console.log('  → kern review src/ --llm');
    console.log('');
    console.log('  Join the waitlist: https://kernlang.dev/pro');
    console.log('');
    return { reports, exitCode: 0 };
  }

  // LLM mode
  if (llmMode) {
    const llmGraphContext = graphMode
      ? (() => {
          const fileDistances = new Map<string, number>();
          for (const report of reports) {
            const finding = report.findings[0];
            const distance = finding?.distance ?? 0;
            fileDistances.set(report.filePath, distance);
          }
          for (const ep of entryFilePaths) {
            fileDistances.set(ep, 0);
          }
          return { fileDistances };
        })()
      : undefined;

    if (isLLMAvailable()) {
      console.log('  LLM review: calling API (deep mode — source + static findings)...');
      const llmInputs: LLMReviewInput[] = reports.map((report) => {
        let source: string | undefined;
        try {
          source = readFileSync(report.filePath, 'utf-8');
        } catch {
          // File may have been deleted between scan and review — proceed without source
        }
        return {
          filePath: report.filePath,
          inferred: report.inferred,
          templateMatches: report.templateMatches,
          taintResults: analyzeTaint(report.inferred, report.filePath),
          graphContext: llmGraphContext,
          source,
          staticFindings: report.findings,
          target: reviewConfig.target,
        };
      });

      try {
        const { findings: llmFindings } = await runLLMReview(llmInputs);
        console.log(`  LLM review: ${llmFindings.length} findings from AI`);

        for (const f of llmFindings) {
          const report = reports.find((r) => r.filePath === f.primarySpan.file);
          if (report) report.findings.push(f);
          else if (reports.length > 0) reports[0].findings.push(f);
        }

        for (const report of reports) {
          report.findings = dedup(report.findings);
        }
      } catch (err) {
        console.error(`  LLM review failed: ${(err as Error).message}`);
      }
    } else {
      // No API key — emit machine-readable context for an upstream AI CLI
      // (claude/codex/gemini) to consume as the reviewer. Without a banner
      // this looks like "--llm did nothing" to someone running it standalone.
      console.log('  LLM review: KERN_LLM_API_KEY not set — emitting LLM-prompt context.');
      console.log('    Pipe to an AI CLI:   kern review --llm <file> | claude');
      console.log('    Or set an API key:   export KERN_LLM_API_KEY=<key>');
      console.log('');
      for (const report of reports) {
        const rel = relative(process.cwd(), report.filePath);

        if (report.findings.length > 0) {
          const errors = report.findings.filter((f) => f.severity === 'error');
          const warnings = report.findings.filter((f) => f.severity === 'warning');
          console.log(`<kern-findings path="${rel}">`);
          for (const f of [...errors, ...warnings]) {
            const conf = f.confidence !== undefined ? ` (${(f.confidence * 100).toFixed(0)}%)` : '';
            console.log(`  L${f.primarySpan.startLine} [${f.severity}] ${f.ruleId}: ${f.message}${conf}`);
            if (f.suggestion) console.log(`    → ${f.suggestion}`);
          }
          console.log('</kern-findings>\n');
        }

        const taintResults = analyzeTaint(report.inferred, report.filePath);
        if (taintResults.length > 0) {
          console.log(`<kern-taint path="${rel}">`);
          for (const t of taintResults) {
            console.log(`  fn ${t.fnName} (L${t.startLine}):`);
            for (const p of t.paths) {
              const status = p.sanitized ? `SANITIZED by ${p.sanitizer}` : 'UNSANITIZED';
              const insufficient = p.insufficientSanitizer
                ? ` (${p.insufficientSanitizer} is NOT sufficient for ${p.sink.category})`
                : '';
              console.log(`    ${p.source.origin} → ${p.sink.name}() [${p.sink.category}] ${status}${insufficient}`);
            }
          }
          console.log('</kern-taint>\n');
        }

        if (report.crossFileTaint && report.crossFileTaint.length > 0) {
          console.log(`<kern-taint-cross-file path="${rel}">`);
          for (const t of report.crossFileTaint) {
            const calleeRel = relative(process.cwd(), t.calleeFile);
            console.log(
              `  ${t.source.origin} in ${t.callerFn}() L${t.callerLine} → ${t.calleeFn}() in ${calleeRel} → ${t.sinkInCallee.name}() [${t.sinkInCallee.category}] UNSANITIZED`,
            );
            console.log(`    Tainted args: ${t.taintedArgs.join(', ')}`);
          }
          console.log('</kern-taint-cross-file>\n');
        }

        if (report.obligations && report.obligations.length > 0) {
          console.log(`<kern-obligations path="${rel}">`);
          for (const o of report.obligations) {
            console.log(`  (${o.type}) ${o.functionName} L${o.line}: ${o.claim}`);
          }
          console.log('</kern-obligations>\n');
        }

        if (report.semanticChanges && report.semanticChanges.length > 0) {
          console.log(`<kern-diff path="${rel}">`);
          for (const c of report.semanticChanges) {
            console.log(`  [${c.severity}] ${c.type}: ${c.functionName} — ${c.description}`);
          }
          console.log('</kern-diff>\n');
        }

        console.log(`<kern-ir path="${rel}">`);
        console.log(buildLLMPrompt(report.inferred, report.templateMatches, llmGraphContext));
        console.log('</kern-ir>\n');
      }

      console.log(
        `── KERN Review Instructions ──\n${buildReviewInstructions({ target: 'assistant', hasInlineSource: false })}\n`,
      );
    }
  }

  // Diff-aware precision
  const diffRanges = (globalThis as any).__diffRanges as Map<string, Array<[number, number]>> | undefined;
  if (diffRanges && diffRanges.size > 0) {
    const DIFF_CONTEXT = 3;
    let filtered = 0;
    for (const report of reports) {
      const relPath = relative(process.cwd(), report.filePath);
      const ranges = diffRanges.get(relPath);
      if (!ranges || ranges.length === 0) continue;

      const sorted = [...ranges].sort((a, b) => a[0] - b[0]);

      const before = report.findings.length;
      report.findings = report.findings.filter((f) => {
        const line = f.primarySpan.startLine;
        let lo = 0,
          hi = sorted.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (line < sorted[mid][0] - DIFF_CONTEXT) hi = mid - 1;
          else if (line > sorted[mid][1] + DIFF_CONTEXT) lo = mid + 1;
          else return true;
        }
        return false;
      });
      filtered += before - report.findings.length;
    }
    if (filtered > 0 && !jsonOutput && !sarifOutput) {
      console.log(`  Diff filter: ${filtered} finding(s) outside changed lines suppressed`);
    }
  }

  // Fix mode
  if (fixMode) {
    let fixed = 0;
    let verified = 0;
    for (const report of reports) {
      for (const t of report.templateMatches) {
        if (!t.suggestedKern) continue;
        const kernFileName = report.filePath.replace(/\.tsx?$/, '.kern');
        try {
          writeFileSync(kernFileName, `${t.suggestedKern}\n`);
          try {
            parseAndSurface(readFileSync(kernFileName, 'utf-8'), kernFileName);
            console.log(`  ${report.filePath} → ${kernFileName} (verified)`);
            verified++;
          } catch (parseErr) {
            console.error(`  ${kernFileName} written but parse failed: ${(parseErr as Error).message}`);
          }
          fixed++;
        } catch (err) {
          console.error(`  Failed to write ${kernFileName}: ${(err as Error).message}`);
        }
      }
    }
    if (fixed === 0) {
      console.log('  No template suggestions to fix — nothing to migrate.');
    } else {
      console.log(`\n  ${fixed} .kern file(s) written, ${verified} verified.`);
    }
    return { reports, exitCode: 0 };
  }

  // Autofix mode
  if (autofixMode) {
    const fixesByFile = new Map<string, { finding: ReviewFinding; fix: NonNullable<ReviewFinding['autofix']> }[]>();
    for (const report of reports) {
      for (const f of report.findings) {
        if (!f.autofix) continue;
        const file = f.autofix.span.file || report.filePath;
        if (!fixesByFile.has(file)) fixesByFile.set(file, []);
        fixesByFile.get(file)!.push({ finding: f, fix: f.autofix });
      }
    }

    if (fixesByFile.size === 0) {
      console.log('  No autofixes available in findings.');
      return { reports, exitCode: 0 };
    }

    let totalApplied = 0;
    let totalSkipped = 0;

    for (const [file, fixes] of fixesByFile) {
      if (!existsSync(file)) {
        console.error(`  Skipping ${file} — file not found`);
        totalSkipped += fixes.length;
        continue;
      }

      fixes.sort((a, b) => {
        const lineDiff = b.fix.span.startLine - a.fix.span.startLine;
        if (lineDiff !== 0) return lineDiff;
        return b.fix.span.startCol - a.fix.span.startCol;
      });

      const appliedSpans: { sl: number; el: number }[] = [];
      function overlaps(sl: number, el: number): boolean {
        return appliedSpans.some((s) => sl <= s.el && el >= s.sl);
      }

      const lines = readFileSync(file, 'utf-8').split('\n');
      let applied = 0;

      for (const { finding, fix } of fixes) {
        const { startLine, startCol, endLine, endCol } = fix.span;
        const sl = startLine - 1;
        const el = endLine - 1;

        if (sl < 0 || el >= lines.length) {
          console.error(`  Skipping ${finding.ruleId}@${startLine}:${startCol} — span out of range`);
          totalSkipped++;
          continue;
        }

        if (overlaps(sl, el)) {
          console.error(
            `  Skipping ${finding.ruleId}@${startLine}:${startCol} — overlaps with a previously applied fix`,
          );
          totalSkipped++;
          continue;
        }

        if (fix.type === 'replace') {
          const before = lines[sl].slice(0, startCol - 1);
          const after = lines[el].slice(endCol - 1);
          const replacementLines = fix.replacement.split('\n');
          replacementLines[0] = before + replacementLines[0];
          replacementLines[replacementLines.length - 1] += after;
          lines.splice(sl, el - sl + 1, ...replacementLines);
        } else if (fix.type === 'insert-before') {
          lines.splice(sl, 0, fix.replacement);
        } else if (fix.type === 'insert-after') {
          lines.splice(el + 1, 0, fix.replacement);
        } else if (fix.type === 'remove') {
          lines.splice(sl, el - sl + 1);
        } else if (fix.type === 'wrap') {
          const original = lines.slice(sl, el + 1).join('\n');
          const wrapped = fix.replacement.replace('$0', original);
          lines.splice(sl, el - sl + 1, ...wrapped.split('\n'));
        }
        appliedSpans.push({ sl, el });
        applied++;
      }

      writeFileSync(file, lines.join('\n'));
      console.log(`  ${file}: ${applied} fix${applied === 1 ? '' : 'es'} applied`);
      totalApplied += applied;
    }

    console.log(`\n  ${totalApplied} autofix${totalApplied === 1 ? '' : 'es'} applied, ${totalSkipped} skipped.`);
    return { reports, exitCode: 0 };
  }

  // Lint mode
  if (lintMode) {
    const filePaths = reports.map((r) => r.filePath).filter((f) => existsSync(f));
    // Collect lint-phase health across runESLint + runTSCDiagnosticsFromPaths; merge onto every
    // report at the end so "ESLint not installed" shows up in the review header, not just console.
    const lintHealth = new ReviewHealthBuilder();

    const eslintFindings: ReviewFinding[] = await runESLint(filePaths, process.cwd(), lintHealth);
    if (eslintFindings.length > 0) {
      console.log(`  ESLint: ${eslintFindings.length} findings`);
      for (const report of reports) {
        const fileFindings = eslintFindings.filter((f) => f.primarySpan.file === report.filePath);
        const linked = linkToNodes(fileFindings, report.inferred);
        report.findings = dedup([...report.findings, ...linked]);
      }
    } else {
      console.log('  ESLint: no findings (or not installed)');
    }

    const tscFindings: ReviewFinding[] = runTSCDiagnosticsFromPaths(filePaths, lintHealth);
    if (tscFindings.length > 0) {
      console.log(`  tsc: ${tscFindings.length} findings`);
      for (const report of reports) {
        const fileFindings = tscFindings.filter((f) => f.primarySpan.file === report.filePath);
        const linked = linkToNodes(fileFindings, report.inferred);
        report.findings = dedup([...report.findings, ...linked]);
      }
    } else {
      console.log('  tsc: no findings');
    }

    // Fold lint-phase health into each report's existing health (builder dedupes by key so merging
    // a skipped-ESLint note on a report that already has an fs-project fallback keeps both).
    const lintHealthBuilt = lintHealth.build();
    if (lintHealthBuilt) {
      for (const report of reports) {
        const merged = new ReviewHealthBuilder();
        for (const e of report.health?.entries ?? []) merged.note(e);
        for (const e of lintHealthBuilt.entries) merged.note(e);
        report.health = merged.build();
      }
    }
  }

  let baselineComparison: ReviewBaselineComparison | undefined;
  let reportsForOutput = reports;
  let reportsForEnforcement = reports;

  if (baseline) {
    baselineComparison = compareReportsToBaseline(reports, baseline);
    reportsForEnforcement = filterReportsToNewFindings(reports, baselineComparison);
    if (newOnly) {
      reportsForOutput = reportsForEnforcement;
    }
  }

  if (writeBaselinePath) {
    const baselineDir = dirname(writeBaselinePath);
    if (baselineDir && baselineDir !== '.') {
      mkdirSync(baselineDir, { recursive: true });
    }
    writeFileSync(writeBaselinePath, `${JSON.stringify(createReviewBaseline(reports), null, 2)}\n`);
    if (!jsonOutput && !sarifOutput) {
      console.log(`  Baseline written: ${writeBaselinePath}`);
    }
  }

  if (reviewConfig.telemetry?.enabled) {
    const written = writeReviewTelemetrySnapshot(reports, {
      policy: reviewConfig.policy,
      outputPath: reviewConfig.telemetry.outputPath,
      append: reviewConfig.telemetry.append,
      includeFindings: reviewConfig.telemetry.includeFindings,
      durationMs: Date.now() - startedAt,
    });
    if (!jsonOutput && !sarifOutput) {
      console.log(`  Telemetry written: ${relative(process.cwd(), written.outputPath)}`);
    }
  }

  // Output
  if (jsonOutput) {
    const enriched = reportsForOutput.map((report) => {
      const llmPrompt = buildLLMPrompt(report.inferred, report.templateMatches);
      const kernIR = exportKernIR(report.inferred, report.templateMatches);
      return { ...report, kernIR, llmPrompt };
    });
    console.log(JSON.stringify(enriched.length === 1 ? enriched[0] : enriched, null, 2));
  } else if (sarifOutput) {
    if (baselineComparison) {
      console.log(
        formatSARIFWithMetadata(reportsForOutput, {
          getBaselineStatus: (report: ReviewReport, finding: ReviewFinding) => {
            const key = getReviewBaselineKeyForFinding(report.filePath, finding);
            if (baselineComparison!.knownKeys.has(key)) return 'existing';
            if (baselineComparison!.newKeys.has(key)) return 'new';
            return undefined;
          },
        }),
      );
    } else if (
      reportsForOutput.some((report) => ((report as ReviewReportWithSuppressed).suppressedFindings?.length ?? 0) > 0)
    ) {
      console.log(formatSARIFWithMetadata(reportsForOutput));
    } else {
      console.log(formatSARIF(reportsForOutput));
    }
  } else {
    for (const report of reportsForOutput) {
      console.log('');
      console.log(formatReport(report, reviewConfig));
    }
    if (reportsForOutput.length > 1) {
      console.log('');
      console.log(formatSummary(reportsForOutput));
    }

    if (baselineComparison) {
      console.log('');
      console.log(
        `  Baseline: ${baselineComparison.knownCount} existing, ${baselineComparison.newCount} new, ${baselineComparison.resolvedCount} resolved`,
      );
      if (newOnly) {
        console.log('  Output: showing only new findings compared to baseline');
      }
    }

    const hasThresholds =
      minCoverageArg !== undefined ||
      maxComplexityArg !== undefined ||
      maxErrorsArg !== undefined ||
      maxWarningsArg !== undefined;
    if (enforce || hasThresholds) {
      console.log('');
      let allPassed = true;
      for (const report of reportsForEnforcement) {
        const result = checkEnforcement(report, reviewConfig);
        if (!result.passed) {
          allPassed = false;
          console.log(`  File: ${report.filePath}`);
          console.log(formatEnforcement(result));
          console.log('');
        }
      }

      if (allPassed) {
        const suffix = baselineComparison ? ' on new findings vs baseline' : '';
        console.log(`  Enforcement: PASS (all files checked against thresholds${suffix})`);
      } else {
        return { reports, exitCode: 1 };
      }
    }
  }

  return { reports, exitCode: 0 };
}

function runReviewEvalManifest(manifestPath: string, baseConfig: ReviewConfig) {
  const resolvedManifestPath = resolve(manifestPath);
  const raw = JSON.parse(readFileSync(resolvedManifestPath, 'utf-8'));
  const manifest = normalizeReviewEvalManifest(raw);
  const manifestDir = dirname(resolvedManifestPath);
  const results: ReviewEvalCaseResult[] = [];

  for (const testCase of manifest.cases) {
    const files = testCase.files.map((file) => resolve(manifestDir, file));
    const caseConfig: ReviewConfig = {
      ...baseConfig,
      ...(testCase.config ?? {}),
      target: testCase.config?.target ?? baseConfig.target,
    };
    const startedAt = Date.now();

    try {
      const reports = testCase.graph
        ? reviewGraph(files, caseConfig, {
            maxDepth: testCase.maxDepth,
            tsConfigFilePath: caseConfig.tsConfigFilePath,
          })
        : files.map((file) => reviewFile(file, caseConfig));
      results.push(evaluateReviewReports({ ...testCase, files }, reports, { durationMs: Date.now() - startedAt }));
    } catch (err) {
      results.push({
        name: testCase.name,
        passed: false,
        files,
        findings: 0,
        errors: 0,
        warnings: 0,
        notes: 0,
        durationMs: Date.now() - startedAt,
        failures: [`review failed: ${(err as Error).message}`],
      });
    }
  }

  return summarizeReviewEvalResults(results);
}

// ── Review command entry point ───────────────────────────────────────────

async function runReviewLocal(args: string[]): Promise<void> {
  const jsonOutput = hasFlag(args, '--json');
  const sarifOutput = hasFlag(args, '--sarif', '--format=sarif');
  const telemetryReportMode = args.some((arg) => arg === '--telemetry-report' || arg.startsWith('--telemetry-report='));
  const telemetryReportPath = parseOptionalFlagOrNext(args, '--telemetry-report', '.kern/cache/review-telemetry.jsonl');
  if (telemetryReportMode) {
    let summary: ReturnType<typeof summarizeReviewTelemetry>;
    try {
      const snapshots = readReviewTelemetrySnapshots(resolve(telemetryReportPath));
      summary = summarizeReviewTelemetry(snapshots);
    } catch (err) {
      console.error(`Failed to read telemetry report: ${(err as Error).message}`);
      process.exit(1);
    }
    console.log(jsonOutput ? JSON.stringify(summary, null, 2) : formatReviewTelemetrySummary(summary));
    process.exit(0);
  }

  const recursive = hasFlag(args, '--recursive', '-r');
  const enforce = hasFlag(args, '--enforce');
  const exportKern = hasFlag(args, '--export-kern');
  const llmMode = hasFlag(args, '--llm');
  const cloudMode = hasFlag(args, '--cloud');
  const securityMode = hasFlag(args, '--security');
  const mcpMode = hasFlag(args, '--mcp');
  const specMode = hasFlag(args, '--spec');
  const specFile = args.find((a) => a.endsWith('.kern') && a !== 'review');
  const fixMode = hasFlag(args, '--fix');
  const autofixMode = hasFlag(args, '--autofix');
  const lintMode = hasFlag(args, '--lint');
  // Phase 6: generated files skipped by default — bugs in compiler output
  // belong to the compiler, not the user, and inference re-fires every
  // handler-size/handler-heavy rule on transpiled function bodies. Opt back
  // in with --include-generated. --skip-generated stays accepted as a no-op
  // so CI configs that pass it explicitly don't break.
  const includeGenerated = hasFlag(args, '--include-generated');
  const skipGenerated = !includeGenerated;
  const graphMode = hasFlag(args, '--graph') || recursive;
  const batchMode = hasFlag(args, '--batch');
  const maxDepth = Number(parseFlag(args, '--max-depth') ?? 3);
  const batchSize = Number(parseFlag(args, '--batch-size') ?? 20);
  const explicitTsconfigPath = parseFlag(args, '--tsconfig');
  // Only resolve when explicitly passed — per-file auto-discovery (via findTsConfig in the review engine)
  // is usually right in monorepos, where the root tsconfig is a solution-only references file.
  const tsconfigPath = explicitTsconfigPath ? resolve(explicitTsconfigPath) : undefined;
  // Warn when the user explicitly points --tsconfig at a solution-only (references-only) file.
  // ts-morph will load it but the resulting Project has no compilerOptions, which silently
  // degrades review quality (no jsx, no paths, no strict). Tell the user before they waste a run.
  if (tsconfigPath && existsSync(tsconfigPath)) {
    try {
      const raw = readFileSync(tsconfigPath, 'utf-8');
      const stripped = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      const parsed = JSON.parse(stripped);
      const hasCompilerOptions = parsed.compilerOptions && Object.keys(parsed.compilerOptions).length > 0;
      const hasReferences = Array.isArray(parsed.references) && parsed.references.length > 0;
      if (!hasCompilerOptions && hasReferences) {
        console.warn(
          `  Warning: --tsconfig ${tsconfigPath} is a solution-only file (references-only, no compilerOptions).`,
        );
        console.warn(
          `  Review quality will be degraded (no jsx/paths/strict). Point --tsconfig at a per-package tsconfig instead, or omit --tsconfig to let kern-review discover the nearest one per file.`,
        );
      }
    } catch {
      // Bad JSON / unreadable — ts-morph will surface a clearer error during loading.
    }
  }
  const minCoverageArg = parseFlag(args, '--min-coverage');
  const minCoverage = minCoverageArg ? Number(minCoverageArg) : undefined;
  const maxComplexityArg = parseFlag(args, '--max-complexity');
  const maxComplexity = maxComplexityArg ? Number(maxComplexityArg) : 15;
  const maxHandlerLinesArg = parseFlag(args, '--max-handler-lines');
  const maxHandlerLines = maxHandlerLinesArg ? Number(maxHandlerLinesArg) : undefined;
  const maxErrorsArg = parseFlag(args, '--max-errors');
  const maxErrors = maxErrorsArg ? Number(maxErrorsArg) : 0;
  const maxWarningsArg = parseFlag(args, '--max-warnings');
  const maxWarnings = maxWarningsArg ? Number(maxWarningsArg) : undefined;
  const showConfidence = hasFlag(args, '--confidence');
  const auditMode = hasFlag(args, '--audit');
  const crossStackModeArg = parseFlag(args, '--cross-stack-mode');
  if (crossStackModeArg && crossStackModeArg !== 'guard' && crossStackModeArg !== 'audit') {
    console.error("--cross-stack-mode must be 'guard' or 'audit'");
    process.exit(1);
  }
  const minConfidenceArg = parseFlag(args, '--min-confidence');
  const minConfidence = minConfidenceArg ? Number(minConfidenceArg) : undefined;
  const policyArg = parseFlagOrNext(args, '--policy');
  if (policyArg && policyArg !== 'guard' && policyArg !== 'ci' && policyArg !== 'audit') {
    console.error("--policy must be 'guard', 'ci', or 'audit'");
    process.exit(1);
  }
  if (auditMode && policyArg && policyArg !== 'audit') {
    console.error('--audit cannot be combined with --policy other than audit');
    process.exit(1);
  }
  const telemetryOutputPath = parseFlagOrNext(args, '--telemetry-out');
  const telemetryEnabled = hasFlag(args, '--telemetry') || telemetryOutputPath !== undefined;
  const telemetryIncludeFindings = hasFlag(args, '--telemetry-findings');
  const telemetryReplace = hasFlag(args, '--telemetry-replace');
  const disableRuleArgs = args.filter((a) => a.startsWith('--disable-rule=')).map((a) => a.split('=')[1]);
  const baselinePath = parseFlagOrNext(args, '--baseline');
  const writeBaselinePath = parseFlagOrNext(args, '--write-baseline');
  const evalManifestPath = parseFlagOrNext(args, '--eval-manifest');
  const newOnly = hasFlag(args, '--new-only');
  if (newOnly && !baselinePath) {
    console.error('--new-only requires --baseline=<file.json>');
    process.exit(1);
  }

  const rulesDirs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rules-dir' && args[i + 1] && !args[i + 1].startsWith('--')) {
      rulesDirs.push(resolve(args[i + 1]));
      i++;
    } else if (args[i].startsWith('--rules-dir=')) {
      rulesDirs.push(resolve(args[i].split('=')[1]));
    }
  }

  const strictArg = args.find((a) => a === '--strict' || a.startsWith('--strict='));
  const strict: false | 'inline' | 'all' =
    strictArg === '--strict' ? 'inline' : strictArg === '--strict=all' ? 'all' : false;
  const strictParse = hasFlag(args, '--strict-parse');
  const requireConfidenceAnnotations = hasFlag(args, '--require-confidence');
  const listRules = hasFlag(args, '--list-rules');
  const targetArg = parseFlag(args, '--target');
  let diffBase = args.some((a) => a === '--diff' || a.startsWith('--diff'))
    ? parseFlagOrNext(args, '--diff') || 'origin/main'
    : undefined;
  const fullMode = hasFlag(args, '--full');

  if (fullMode && diffBase) {
    console.error('  --full and --diff are mutually exclusive.');
    process.exit(1);
  }

  let baseline: ReviewBaselineFile | undefined;
  if (baselinePath) {
    const resolvedBaselinePath = resolve(baselinePath);
    if (!existsSync(resolvedBaselinePath)) {
      console.error(`Baseline not found: ${baselinePath}`);
      process.exit(1);
    }
    let rawBaseline: string;
    try {
      rawBaseline = readFileSync(resolvedBaselinePath, 'utf-8');
    } catch (err) {
      console.error(`Failed to read baseline ${baselinePath}: ${(err as Error).message}`);
      process.exit(1);
    }
    try {
      baseline = parseReviewBaseline(rawBaseline);
    } catch (err) {
      console.error(`Failed to parse baseline ${baselinePath}: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  // --list-rules
  if (listRules) {
    const reviewCfg = loadConfig();
    const target = targetArg || reviewCfg.target;
    const rules = getRuleRegistry(target);
    const layers = new Map<string, typeof rules>();
    for (const r of rules) {
      if (!layers.has(r.layer)) layers.set(r.layer, []);
      layers.get(r.layer)!.push(r);
    }
    console.log(`\n  KERN Review Rules (target: ${target}) — ${rules.length} rules active\n`);
    console.log('  Columns: SEV PRECISION LIFECYCLE CI RULE');
    console.log('');
    for (const [layer, layerRules] of layers) {
      console.log(`  [${layer}] (${layerRules.length} rules)`);
      for (const r of layerRules) {
        const sev = r.severity === 'error' ? 'ERR' : r.severity === 'warning' ? 'WRN' : 'INF';
        const profile = getRuleQualityProfile(r.id);
        const precision = (profile?.precision ?? 'medium').toUpperCase().padEnd(12);
        const lifecycle = (profile?.lifecycle ?? 'stable').toUpperCase().padEnd(11);
        const ciDefault = (profile?.ciDefault ?? 'guarded').toUpperCase().padEnd(7);
        console.log(`    ${sev}  ${precision}${lifecycle}${ciDefault}${r.id.padEnd(30)} ${r.description}`);
      }
      console.log();
    }
    process.exit(0);
  }

  // Diff mode
  const flagsWithValues = new Set([
    '--spec',
    '--diff',
    '--git',
    '--ref',
    '--rules-dir',
    '--tsconfig',
    '--target',
    '--max-depth',
    '--batch-size',
    '--min-coverage',
    '--max-complexity',
    '--max-errors',
    '--max-warnings',
    '--min-confidence',
    '--cross-stack-mode',
    '--policy',
    '--telemetry-out',
    '--eval-manifest',
    '--baseline',
    '--write-baseline',
  ]);
  const reviewInputs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'review') continue;
    if (flagsWithValues.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith('--')) continue;
    reviewInputs.push(arg);
  }
  let reviewInput = reviewInputs[0];
  if (!reviewInput && evalManifestPath) {
    reviewInput = '__eval__';
  }
  const remoteUrl = parseFlagOrNext(args, '--git');
  if (remoteUrl && !reviewInput && !diffBase) {
    reviewInput = '.';
  }

  // Phase 5: diff-scoped by default.
  // Bare `kern review` (no path, no --diff, no --full, no --git) inside a git
  // repo defaults to reviewing changes vs the upstream branch. `--full` opts
  // back into a cwd-wide scan. Explicit paths are unchanged — `kern review
  // src/` still scans src/ in full. This keeps `kern review` quiet by default
  // on large codebases without breaking CI invocations that pass a path.
  if (!reviewInput && !diffBase && !remoteUrl && !fullMode) {
    const autoBase = detectAutoDiffBase();
    if (autoBase) {
      diffBase = autoBase;
      if (!hasFlag(args, '--json') && !hasFlag(args, '--sarif')) {
        console.log(
          `  No path given — reviewing changes vs ${autoBase}. Use --full to scan the whole tree, or pass a path.\n`,
        );
      }
    }
  }

  if (fullMode && !reviewInput) {
    reviewInput = '.';
  }

  if (diffBase && !reviewInput) {
    try {
      const { execFileSync } = await import('child_process');
      const sanitizedBase = diffBase.replace(/[^a-zA-Z0-9_./\-~]/g, '');
      const diffFiles = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', sanitizedBase], {
        encoding: 'utf-8',
      })
        .trim()
        .split('\n')
        .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.py') || f.endsWith('.kern'))
        .filter(
          (f) =>
            !f.endsWith('.d.ts') &&
            !f.endsWith('.test.ts') &&
            !f.endsWith('.test.tsx') &&
            !basename(f).startsWith('test_') &&
            !f.endsWith('_test.py'),
        );
      const machineOutput = hasFlag(args, '--json') || hasFlag(args, '--sarif');
      if (diffFiles.length === 0) {
        if (!machineOutput) console.log(`  No changed .ts/.tsx/.py/.kern files since ${diffBase}`);
        process.exit(0);
      }
      if (!machineOutput) {
        console.log(`  Reviewing ${diffFiles.length} changed files (diff from ${diffBase})\n`);
      }

      const diffRanges = new Map<string, Array<[number, number]>>();
      try {
        const unifiedDiff = execFileSync('git', ['diff', '--unified=0', '--diff-filter=ACMR', sanitizedBase], {
          encoding: 'utf-8',
          env: { ...process.env, LC_ALL: 'C' },
        });
        let currentFile = '';
        for (const line of unifiedDiff.split('\n')) {
          if (line.startsWith('+++ b/')) {
            currentFile = line.slice(6);
            if (!diffRanges.has(currentFile)) diffRanges.set(currentFile, []);
          }
          if (line.startsWith('@@') && currentFile) {
            const match = line.match(/\+(\d+)(?:,(\d+))?/);
            if (match) {
              const start = parseInt(match[1], 10);
              const count = match[2] ? parseInt(match[2], 10) : 1;
              if (count > 0) {
                diffRanges.get(currentFile)!.push([start, start + count - 1]);
              }
            }
          }
        }
      } catch (_err) {
        // If unified diff parsing fails, proceed without line filtering — review all lines
      }

      reviewInput = '__diff__';
      (globalThis as any).__diffFiles = diffFiles;
      (globalThis as any).__diffRanges = diffRanges;
    } catch (err) {
      console.error(`  git diff failed: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  if (!reviewInput) {
    console.error(
      'Usage: kern review [file|dir] [--full] [--diff base] [--git=<url>] [--security] [--mcp] [--llm] [--spec file.kern] [--cloud] [--baseline=file.json] [--new-only]',
    );
    console.error(
      '       [--write-baseline=file.json] [--json] [--sarif] [--recursive] [--enforce] [--strict-parse] [--audit] [--cross-stack-mode guard|audit]',
    );
    console.error(
      '       [--policy guard|ci|audit] [--telemetry] [--telemetry-out file] [--telemetry-report file] [--eval-manifest file]',
    );
    console.error('       [--fix] [--autofix] [--require-confidence] [--rules-dir <dir>] [--include-generated]');
    console.error('');
    console.error('  Default (inside git): reviews changes vs origin/main. Use --full to scan the whole tree.');
    console.error(
      '  Default skips generated files (src/generated/, files with @generated stamps). Use --include-generated to audit them.',
    );
    process.exit(1);
  }

  if (reviewInput !== '__diff__' && reviewInput !== '__eval__') {
    const reviewPath = resolve(reviewInput);
    const stat = existsSync(reviewPath) ? statSync(reviewPath) : null;
    if (!stat) {
      console.error(`Not found: ${reviewInput}`);
      process.exit(1);
    }
  }

  const reviewCfg = loadConfig();
  const effectiveTarget = targetArg || reviewCfg.target;
  if (!(VALID_TARGETS as readonly string[]).includes(effectiveTarget)) {
    console.error(`Invalid target '${effectiveTarget}' in config. Valid: ${VALID_TARGETS.join(', ')}`);
    process.exit(1);
  }
  if (!jsonOutput && !sarifOutput) {
    const configExists = existsSync(resolve(process.cwd(), 'kern.config.ts'));
    if (targetArg) {
      console.log(`  Target: ${effectiveTarget} (from --target)`);
    } else if (!configExists) {
      console.log(`  Target: ${effectiveTarget} (auto-detected from package.json)`);
    }
  }

  const cfgDisabledRules: string[] = reviewCfg.review.disabledRules ?? [];
  const mergedDisabledRules = [...new Set([...cfgDisabledRules, ...disableRuleArgs])];

  let reviewConfig: ReviewConfig = {
    registeredTemplates: [],
    minCoverage: minCoverage ?? 0,
    enforceTemplates: enforce,
    maxComplexity: maxComplexity ?? reviewCfg.review.maxComplexity,
    maxHandlerLines,
    maxErrors,
    maxWarnings,
    target: effectiveTarget,
    crossStackMode: auditMode
      ? 'audit'
      : ((crossStackModeArg as 'guard' | 'audit' | undefined) ?? reviewCfg.review.crossStackMode),
    policy: (policyArg as ReviewConfig['policy']) ?? reviewCfg.review.policy ?? (auditMode ? 'audit' : undefined),
    showConfidence: showConfidence || reviewCfg.review.showConfidence,
    minConfidence: minConfidence ?? reviewCfg.review.minConfidence,
    disabledRules: mergedDisabledRules.length > 0 ? mergedDisabledRules : undefined,
    rulesDirs: rulesDirs.length > 0 ? rulesDirs : undefined,
    strict,
    strictParse,
    telemetry:
      telemetryEnabled || reviewCfg.review.telemetry.enabled
        ? {
            enabled: true,
            outputPath: telemetryOutputPath ? resolve(telemetryOutputPath) : reviewCfg.review.telemetry.outputPath,
            append: telemetryReplace ? false : reviewCfg.review.telemetry.append,
            includeFindings: telemetryIncludeFindings || reviewCfg.review.telemetry.includeFindings,
          }
        : undefined,
    requireConfidenceAnnotations: requireConfidenceAnnotations || reviewCfg.review.requireConfidenceAnnotations,
    tsConfigFilePath: tsconfigPath,
    publicApi:
      reviewCfg.review.publicApi.files.length > 0 || reviewCfg.review.publicApi.symbols.length > 0
        ? {
            files: reviewCfg.review.publicApi.files,
            symbols: reviewCfg.review.publicApi.symbols,
            projectRoot: process.cwd(),
          }
        : undefined,
  };
  const explicitPolicy = Boolean(policyArg || reviewCfg.review.policy || auditMode);
  if (explicitPolicy) {
    reviewConfig = applyReviewPolicyDefaults(reviewConfig, {
      crossStackMode: Boolean(crossStackModeArg || auditMode),
      minConfidence: minConfidenceArg !== undefined || reviewCfg.review.minConfidence !== 0,
      maxErrors: maxErrorsArg !== undefined,
      maxWarnings: maxWarningsArg !== undefined,
      strict: strictArg !== undefined,
      strictParse,
    });
  }

  // Load templates for review
  if (reviewCfg.templates && reviewCfg.templates.length > 0) {
    clearTemplates();
    for (const templatePath of reviewCfg.templates) {
      const resolvedTpl = resolve(process.cwd(), templatePath);
      if (!existsSync(resolvedTpl)) continue;
      const tplStat = statSync(resolvedTpl);
      const tplFiles: string[] = [];
      if (tplStat.isDirectory()) {
        for (const entry of readdirSync(resolvedTpl)) {
          if (entry.endsWith('.kern')) tplFiles.push(resolve(resolvedTpl, entry));
        }
      } else if (resolvedTpl.endsWith('.kern')) {
        tplFiles.push(resolvedTpl);
      }
      for (const file of tplFiles) {
        try {
          const source = readFileSync(file, 'utf-8');
          const ast = parseAndSurface(source, file);
          const nodes =
            ast.type === 'template' ? [ast] : (ast.children || []).filter((n: IRNode) => n.type === 'template');
          for (const node of nodes) {
            const tplName = node.props?.name as string;
            if (tplName) reviewConfig.registeredTemplates!.push(tplName);
            registerTemplate(node, file);
          }
        } catch (e) {
          console.error(`  Warning: Failed to parse template ${basename(file)}: ${(e as Error).message}`);
        }
      }
    }
    if (reviewConfig.registeredTemplates!.length > 0) {
      console.log(`  Templates loaded: ${reviewConfig.registeredTemplates!.join(', ')}`);
    }
  }

  if (evalManifestPath) {
    const summary = runReviewEvalManifest(evalManifestPath, reviewConfig);
    console.log(jsonOutput ? JSON.stringify(summary, null, 2) : formatReviewEvalSummary(summary));
    process.exit(summary.passed ? 0 : 1);
  }

  // Collect entry file paths
  let entryFilePaths: string[] = [];

  if (reviewInput === '__diff__') {
    const diffFiles = (globalThis as any).__diffFiles as string[];
    entryFilePaths = diffFiles.map((f) => resolve(f)).filter((f) => existsSync(f));
  } else {
    const paths = reviewInputs.length > 0 ? reviewInputs : [reviewInput];
    for (const p of paths) {
      const rPath = resolve(p);
      if (!existsSync(rPath)) continue;
      const rStat = statSync(rPath);
      if (rStat.isDirectory()) {
        entryFilePaths.push(...collectTsFilesFlat(rPath, recursive));
      } else {
        entryFilePaths.push(rPath);
      }
    }
  }

  const modes = {
    graphMode,
    batchMode,
    llmMode,
    cloudMode,
    securityMode,
    mcpMode,
    specMode,
    fixMode,
    autofixMode,
    lintMode,
    skipGenerated,
    exportKern,
    enforce: enforce || reviewConfig.policy === 'ci',
    jsonOutput,
    sarifOutput,
    strictParse: Boolean(reviewConfig.strictParse),
    maxDepth,
    batchSize,
    tsconfigPath,
    specFile,
    minCoverageArg,
    maxComplexityArg,
    maxErrorsArg,
    maxWarningsArg,
    showConfidence,
    baseline,
    writeBaselinePath: writeBaselinePath ? resolve(writeBaselinePath) : undefined,
    newOnly,
  };

  const noCache = hasFlag(args, '--no-cache');
  if (noCache) {
    clearReviewCache();
    reviewConfig.noCache = true;
  }

  const watchMode = hasFlag(args, '--watch', '-w');

  if (watchMode) {
    const chokidar = await import('chokidar');
    console.log(`\n  KERN review — watching ${entryFilePaths.length} entry points`);

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const run = async (paths: string[]) => {
      console.clear();
      console.log(`\n  KERN review — watching (${paths.length} file${paths.length === 1 ? '' : 's'})\n`);
      const watchModes = { ...modes, llmMode: false, enforce: false };
      await runReviewPipeline(reviewConfig, paths, watchModes);
      console.log('\n  Watching for changes...');
    };

    const watcher = chokidar.watch(entryFilePaths, {
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 300 },
    });

    watcher.on('change', (path) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => run([path]), 300);
    });

    await run(entryFilePaths);
  } else {
    const result = await runReviewPipeline(reviewConfig, entryFilePaths, modes);
    process.exit(result.exitCode);
  }
}

export async function runReview(args: string[]): Promise<void> {
  const diffBase = args.some((a) => a === '--diff' || a.startsWith('--diff'))
    ? parseFlagOrNext(args, '--diff') || 'origin/main'
    : undefined;

  await withOptionalRemoteRepo(
    args,
    {
      commandName: 'review',
      fullClone: Boolean(diffBase),
    },
    async () => {
      await runReviewLocal(args);
    },
  );
}
