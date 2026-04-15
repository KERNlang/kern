/**
 * Dead code detection rules — powered by function-level call graph.
 *
 * Requires call graph context (only available in --graph mode or --recursive with graph).
 * Confidence is adjusted based on call graph resolution quality.
 */

import type { CallGraph } from '../call-graph.js';
import type { ReviewFinding, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';

function span(file: string, line: number, col = 1): SourceSpan {
  return { file, startLine: line, startCol: col, endLine: line, endCol: col };
}

// ── Rule: dead-export ───────────────────────────────────────────────────
// Exported function/variable that is never imported by any file in the graph.

export function deadExportRule(callGraph: CallGraph, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const key of callGraph.deadExports) {
    const fn = callGraph.functions.get(key);
    if (!fn || fn.filePath !== filePath) continue;

    // Skip entry point files — their exports are consumed externally
    // (we can't know if something is used outside the analyzed graph)
    // Skip test files
    if (fn.filePath.includes('.test.') || fn.filePath.includes('.spec.')) continue;

    // Confidence depends on how many calls in the graph were unresolved
    // If lots of calls are unresolved, the dead export might actually be used via a dynamic path
    const totalCalls = [...callGraph.functions.values()].reduce((sum, f) => sum + f.calls.length, 0);
    const unresolvedRatio = totalCalls > 0 ? callGraph.unresolvedCallCount / totalCalls : 0;
    const confidence = unresolvedRatio > 0.3 ? 0.6 : unresolvedRatio > 0.1 ? 0.7 : 0.85;

    findings.push({
      source: 'kern',
      ruleId: 'dead-export',
      severity: 'warning',
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
