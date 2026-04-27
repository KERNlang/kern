/**
 * Dead code detection rules — powered by function-level call graph.
 *
 * Requires call graph context (only available in --graph mode or --recursive with graph).
 * Confidence is adjusted based on call graph resolution quality.
 */

import type { CallGraph } from '../call-graph.js';
import { isPublicApi, type PublicApiMap } from '../public-api.js';
import type { CalibrationStage, ReachabilityBlocker, ReviewFinding, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';

function span(file: string, line: number, col = 1): SourceSpan {
  return { file, startLine: line, startCol: col, endLine: line, endCol: col };
}

// ── Rule: dead-export ───────────────────────────────────────────────────
// Exported function/variable that is never imported by any file in the graph.

/**
 * The confidence ceiling step 9b applies when a ReachabilityBlocker matches
 * a finding's symbol scope. CAP, not floor: `Math.min(confidence, 0.4)`.
 * A real floor would *raise* low-confidence findings (e.g. a 0.6 codegen-
 * demoted dead-export bouncing back up to 0.4 — wait, 0.4 < 0.6, so a
 * floor wouldn't help here, but the principle holds: blockers indicate
 * uncertainty, they should never strengthen a finding). Codex flagged
 * the floor-vs-cap terminology in plan-review #66 as a HIGH-severity
 * gotcha; this constant is named CAP to make the intent obvious.
 */
const REACHABILITY_BLOCKER_CAP = 0.4;

/**
 * Match a (filePath, exportName) blocker against a finding, with the
 * default-alias step 9a wired in: when the seed says `'default'` is
 * blocked but the call graph stored the symbol under its declaration
 * name (`'Page'`), the file's `defaultExportNames` entry tells us the
 * two key the same on-disk symbol.
 *
 * Returns the matched blocker, or undefined when nothing applies.
 */
function findMatchingBlocker(
  blockers: readonly ReachabilityBlocker[],
  filePath: string,
  exportName: string,
  defaultExportName: string | undefined,
): ReachabilityBlocker | undefined {
  for (const b of blockers) {
    if (b.filePath !== filePath) continue;
    if (b.exportName === exportName) return b;
    // Default alias: blocker says (path, 'default'), and `exportName` IS
    // the file's default — same symbol.
    if (b.exportName === 'default' && defaultExportName === exportName) return b;
  }
  return undefined;
}

/**
 * Public-API check with the step 9a default-alias wired in: a seed of
 * `(filePath, 'default')` proves `(filePath, internalName)` is public
 * when internalName IS the file's default export.
 */
function isPublicApiWithDefaultAlias(
  publicApi: PublicApiMap,
  filePath: string,
  exportName: string,
  defaultExportName: string | undefined,
): boolean {
  if (isPublicApi(publicApi, filePath, exportName)) return true;
  if (defaultExportName === exportName && isPublicApi(publicApi, filePath, 'default')) return true;
  return false;
}

export function deadExportRule(
  callGraph: CallGraph,
  filePath: string,
  publicApi?: PublicApiMap,
  blockers: readonly ReachabilityBlocker[] = [],
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const defaultExportName = callGraph.defaultExportNames.get(filePath);

  for (const key of callGraph.deadExports) {
    const fn = callGraph.functions.get(key);
    if (!fn || fn.filePath !== filePath) continue;

    // Skip test files
    if (fn.filePath.includes('.test.') || fn.filePath.includes('.spec.')) continue;

    // Skip intentional public API — package.json entries, curated barrels, config overrides.
    // External consumers (other packages, dynamic loaders, platform entry points) won't
    // appear in the analyzed graph, so their imports can't be observed.
    if (publicApi && isPublicApiWithDefaultAlias(publicApi, fn.filePath, fn.name, defaultExportName)) continue;

    // Class methods inherit public-API status from their enclosing class. The
    // call graph tracks `Class.method` as a separate exported symbol whose
    // only cross-file callers are opaque `obj.method()` property accesses
    // (unresolvable by static analysis). If the class itself is public,
    // every method is reachable via the class — flagging them individually
    // produces a wave of FPs on any package that ships a class.
    if (publicApi && fn.name.includes('.')) {
      const className = fn.name.split('.')[0];
      if (isPublicApi(publicApi, fn.filePath, className)) continue;
    }

    // Confidence depends on how many calls in the graph were unresolved
    // If lots of calls are unresolved, the dead export might actually be used via a dynamic path
    const totalCalls = [...callGraph.functions.values()].reduce((sum, f) => sum + f.calls.length, 0);
    const unresolvedRatio = totalCalls > 0 ? callGraph.unresolvedCallCount / totalCalls : 0;
    const baseConfidence = unresolvedRatio > 0.3 ? 0.6 : unresolvedRatio > 0.1 ? 0.7 : 0.85;

    // Step 9b: symbol-scoped reachability blocker. When the graph couldn't
    // prove this specific (file, name) is unreachable — say a candidate
    // dead export is referenced by an unresolved re-export — the finding
    // STILL emits (so telemetry sees it and fpRateEstimate stays honest)
    // but at info severity with a CAP at 0.4 plus a calibration trail
    // entry. Hard suppression was the v3 design that red-team killed:
    // one weak signal silenced 50 unrelated symbols and fpRateEstimate
    // went out of sync with reality.
    const blocker = findMatchingBlocker(blockers, fn.filePath, fn.name, defaultExportName);
    let severity: ReviewFinding['severity'] = 'warning';
    let confidence = baseConfidence;
    let calibrationTrail: CalibrationStage[] | undefined;
    if (blocker) {
      severity = 'info';
      const before = baseConfidence;
      confidence = Math.min(before, REACHABILITY_BLOCKER_CAP);
      // baseConfidence is one of the dead-export ladder values (0.6/0.7/0.85);
      // it can never be 0, so the division is safe without a guard.
      calibrationTrail = [
        {
          stage: 'reachability:blocker',
          factor: confidence / before,
          reason: blocker.reason,
          beforeConfidence: before,
          afterConfidence: confidence,
        },
      ];
    }

    findings.push({
      source: 'kern',
      ruleId: 'dead-export',
      severity,
      category: 'structure',
      message: `Exported function '${fn.name}' is never imported in the analyzed codebase`,
      primarySpan: span(filePath, fn.line),
      fingerprint: createFingerprint('dead-export', fn.line, 1),
      confidence,
      suggestion: `Remove the export, or if used externally (by consumers of this package), add to the public API documentation.`,
      provenance: {
        summary:
          fn.calledBy.length === 0
            ? `No resolved callers found in the analyzed graph for '${fn.name}'.`
            : `Only unresolved callers were found for '${fn.name}'.`,
        steps: [
          {
            kind: 'source',
            location: span(filePath, fn.line),
            label: `export ${fn.name}`,
            detail: `Exported symbol '${fn.name}' has no resolved incoming call edges in the analyzed graph.`,
          },
        ],
      },
      ...(calibrationTrail ? { calibrationTrail } : {}),
    });
  }

  return findings;
}

// ── Rule: cross-file-floating-promise ───────────────────────────────────
// Call to an async function in another file without await.

export function crossFileAsyncRule(callGraph: CallGraph, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const [, fn] of callGraph.functions) {
    if (fn.filePath !== filePath) continue;

    for (const call of fn.calls) {
      if (!call.resolved || call.hasAwait) continue;

      const targetKey = `${call.targetFile}#${call.targetName}`;
      const target = callGraph.functions.get(targetKey);
      if (!target?.isAsync) continue;

      // Skip if target is in the same file (already caught by base floating-promise rule)
      if (call.targetFile === filePath) continue;

      findings.push({
        source: 'kern',
        ruleId: 'floating-promise',
        severity: 'error',
        category: 'bug',
        message: `Cross-file: '${call.targetName}()' from ${target.filePath.split('/').pop()} is async but called without await`,
        primarySpan: span(filePath, call.line),
        relatedSpans: [span(target.filePath, target.line)],
        fingerprint: createFingerprint('floating-promise', call.line, 2),
        confidence: 0.9,
        suggestion: `Add 'await' before the call, or use 'void' if intentionally fire-and-forget.`,
        provenance: {
          summary: `${fn.name}() calls async ${target.name}() across a file boundary without await.`,
          steps: [
            {
              kind: 'call',
              location: span(filePath, call.line),
              label: `${fn.name}() → ${call.targetName}()`,
              detail: `Cross-file call in ${filePath.split('/').pop()} is not awaited.`,
            },
            {
              kind: 'call',
              location: span(target.filePath, target.line),
              label: `async ${target.name}()`,
              detail: `Target function is declared async in ${target.filePath.split('/').pop()}.`,
            },
          ],
        },
      });
    }
  }

  return findings;
}
