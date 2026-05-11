/**
 * Taint Tracking — unified finding generation.
 *
 * Converts TaintResult and CrossFileTaintResult into ReviewFinding[].
 * Shared category labels and suggestion logic eliminates duplication.
 */

import type { CrossFileTaintResult, TaintResult, TaintSink } from './taint-types.js';
import type { ReviewFinding, SourceSpan } from './types.js';
import { createFingerprint } from './types.js';

// ── Shared Constants ────────────────────────────────────────────────────

const categoryLabels: Record<TaintSink['category'], string> = {
  command: 'command injection',
  fs: 'path traversal / file write',
  sql: 'SQL injection',
  redirect: 'open redirect',
  eval: 'code injection',
  template: 'template injection',
  codegen: 'code generation injection',
  ssrf: 'server-side request forgery',
  nosql: 'NoSQL operator injection',
};

export function getSuggestion(category: TaintSink['category']): string {
  switch (category) {
    case 'command':
      return 'Use spawn() with array arguments, or validate/escape input before passing to exec()';
    case 'fs':
      return 'Use path.resolve() + path.normalize() and verify the result stays within allowed directory';
    case 'sql':
      return 'Use parameterized queries ($1, ?) instead of string interpolation';
    case 'redirect':
      return 'Validate redirect URL against an allowlist of safe destinations';
    case 'eval':
      return 'Never pass user input to eval() or new Function() — use safe alternatives';
    case 'template':
      return 'Sanitize user input before embedding in templates';
    case 'codegen':
      return 'Validate type and format of external values before interpolating into generated source code (e.g., parseInt for numeric values)';
    case 'ssrf':
      return 'Validate the target URL against a host allowlist before making outbound requests — encodeURIComponent is NOT sufficient';
    case 'nosql':
      return 'Validate query input against a Zod/Yup schema or coerce to a primitive — never pass req.body/req.query directly into Mongo/Mongoose query positions';
  }
}

// ── Intra-File Findings ─────────────────────────────────────────────────

/**
 * Convert taint results into ReviewFinding[] for the unified pipeline.
 */
export function taintToFindings(results: TaintResult[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const r of results) {
    // Report unsanitized paths AND insufficient sanitizer paths
    const reportable = r.paths.filter((p) => !p.sanitized);
    if (reportable.length === 0) continue;

    for (const path of reportable) {
      const severity =
        path.sink.category === 'command' || path.sink.category === 'eval' || path.sink.category === 'nosql'
          ? ('error' as const)
          : path.sink.category === 'codegen'
            ? ('warning' as const) // codegen injection: external values in generated source — validate type/format
            : ('warning' as const);

      const primarySpan: SourceSpan = {
        file: r.filePath,
        startLine: r.startLine,
        startCol: 1,
        endLine: r.startLine,
        endCol: 1,
      };

      // Provenance: source → (optional insufficient sanitizer) → sink.
      // Use per-step locations when the regex extractor populated them — falls
      // back to the handler-start line otherwise. Earlier iteration reused a
      // single sinkSpan for every step which collapsed the "data enters here"
      // pointer for multi-line handlers (OpenCode/Opus review).
      const spanAt = (line: number | undefined): SourceSpan => ({
        file: r.filePath,
        startLine: line ?? r.startLine,
        startCol: 1,
        endLine: line ?? r.startLine,
        endCol: 1,
      });
      const sourceSpan = spanAt(path.source.line);
      const sinkSpan = spanAt(path.sink.line);
      const provSteps: import('./types.js').ProvenanceStep[] = [
        {
          kind: 'source',
          location: sourceSpan,
          label: path.source.origin,
          detail: `Tainted value '${path.sink.taintedArg}' originates from ${path.source.origin}.`,
        },
      ];
      if (path.insufficientSanitizer) {
        provSteps.push({
          kind: 'sanitizer',
          location: sinkSpan,
          label: path.insufficientSanitizer,
          detail: `Applied sanitizer does not cover ${path.sink.category} sinks — flow remains exploitable.`,
        });
      }
      provSteps.push({
        kind: 'sink',
        location: sinkSpan,
        label: `${path.sink.name}()`,
        detail: `Dangerous ${categoryLabels[path.sink.category]} sink reached.`,
      });

      if (path.insufficientSanitizer) {
        // Sanitizer present but wrong for this sink type
        findings.push({
          source: 'kern',
          ruleId: `taint-insufficient-sanitizer`,
          severity,
          category: 'bug',
          message:
            `Insufficient sanitizer: '${path.insufficientSanitizer}' does not protect against ${categoryLabels[path.sink.category]}. ` +
            `${path.source.origin} → ${path.sink.name}() is still exploitable.`,
          primarySpan,
          suggestion: `${path.insufficientSanitizer} is not sufficient for ${path.sink.category} sinks. ${getSuggestion(path.sink.category)}`,
          fingerprint: createFingerprint(`taint-insufficient`, r.startLine, 1),
          confidence: 88,
          provenance: {
            summary: `${path.source.origin} → ${path.insufficientSanitizer} (insufficient) → ${path.sink.name}()`,
            steps: provSteps,
          },
        });
      } else {
        // No sanitizer at all
        findings.push({
          source: 'kern',
          ruleId: `taint-${path.sink.category}`,
          severity,
          category: 'bug',
          message:
            `Taint flow: ${path.source.origin} → ${path.sink.name}() — potential ${categoryLabels[path.sink.category]}. ` +
            `Variable '${path.sink.taintedArg}' reaches dangerous sink without sanitization.`,
          primarySpan,
          suggestion: getSuggestion(path.sink.category),
          fingerprint: createFingerprint(`taint-${path.sink.category}`, r.startLine, 1),
          confidence: 95,
          provenance: {
            summary: `${path.source.origin} → ${path.sink.name}()`,
            steps: provSteps,
          },
        });
      }
    }
  }

  return findings;
}

// ── Cross-File Findings ─────────────────────────────────────────────────

/**
 * Convert cross-file taint results into ReviewFinding[].
 */
export function crossFileTaintToFindings(results: CrossFileTaintResult[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const r of results) {
    const severity =
      r.sinkInCallee.category === 'command' || r.sinkInCallee.category === 'eval' || r.sinkInCallee.category === 'nosql'
        ? ('error' as const)
        : ('warning' as const);

    const callerSpan: SourceSpan = {
      file: r.callerFile,
      startLine: r.callerLine,
      startCol: 1,
      endLine: r.callerLine,
      endCol: 1,
    };
    const calleeSpan: SourceSpan = {
      file: r.calleeFile,
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 1,
    };
    findings.push({
      source: 'kern',
      ruleId: `taint-crossfile-${r.sinkInCallee.category}`,
      severity,
      category: 'bug',
      message:
        `Cross-file taint: ${r.source.origin} in ${r.callerFn}() → ${r.calleeFn}() → ${r.sinkInCallee.name}(). ` +
        `Tainted data crosses file boundary to reach ${categoryLabels[r.sinkInCallee.category]} sink.`,
      primarySpan: callerSpan,
      relatedSpans: [calleeSpan],
      suggestion: `Validate '${r.taintedArgs.join(', ')}' before passing to ${r.calleeFn}(). ${getSuggestion(r.sinkInCallee.category)}`,
      fingerprint: createFingerprint(`taint-xfile-${r.sinkInCallee.category}`, r.callerLine, 1),
      confidence: 92,
      // Caller → import boundary → callee sink. Sight renders the boundary
      // step distinctly so reviewers see the file hop, not just a list of
      // lines.
      provenance: {
        summary: `${r.source.origin} in ${r.callerFn}() → ${r.calleeFn}() → ${r.sinkInCallee.name}()`,
        steps: [
          {
            kind: 'source',
            location: callerSpan,
            label: r.source.origin,
            detail: `Tainted args '${r.taintedArgs.join(', ')}' enter ${r.callerFn}().`,
          },
          {
            kind: 'call',
            location: callerSpan,
            label: `${r.callerFn}() → ${r.calleeFn}()`,
            detail: `Tainted data passed across file boundary to ${r.calleeFile}.`,
          },
          {
            kind: 'sink',
            location: calleeSpan,
            label: `${r.sinkInCallee.name}()`,
            detail: `Dangerous ${categoryLabels[r.sinkInCallee.category]} sink in callee.`,
          },
        ],
      },
    });
  }

  return findings;
}
