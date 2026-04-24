import { countTokens as coreCountTokens, serializeIR as coreSerializeIR } from '@kernlang/core/utils';
import type { ReviewFinding } from '@kernlang/review';
import { inferFromSource as inferTS, reviewSource as reviewTS } from '@kernlang/review';

export { coreCountTokens as countTokens, coreSerializeIR as serializeIR };

export interface InferResult {
  kern: string | null;
  findings: Array<{
    ruleId: string;
    severity: string;
    message: string;
    line: number;
  }>;
  stats: {
    inputTokens: number;
    kernTokens: number;
    constructs: number;
    reduction: number;
  } | null;
  error: { message: string; line: number; col: number; codeFrame: string } | null;
}

export function inferFromSource(source: string, language: string): InferResult {
  try {
    if (language === 'python') {
      return {
        kern: null,
        findings: [],
        stats: null,
        error: {
          message: 'Python inference requires @kernlang/review-python. Use TypeScript/React for now.',
          line: 0,
          col: 0,
          codeFrame: '',
        },
      };
    }

    const inferred = inferTS(source, 'input.tsx');

    if (inferred.length === 0) {
      return {
        kern: '// No KERN constructs detected in the input',
        findings: [],
        stats: { inputTokens: coreCountTokens(source), kernTokens: 0, constructs: 0, reduction: 0 },
        error: null,
      };
    }

    // Serialize each inferred node to KERN source
    const kernLines: string[] = [];
    for (const result of inferred) {
      kernLines.push(coreSerializeIR(result.node));
    }
    const kern = kernLines.join('\n');

    const inputTokens = coreCountTokens(source);
    const kernTokens = coreCountTokens(kern);

    // Run review for security findings
    const report = reviewTS(source, 'input.tsx');
    const findings = report.findings
      .filter((f: ReviewFinding) => f.severity === 'error' || f.severity === 'warning')
      .map((f: ReviewFinding) => ({
        ruleId: f.ruleId,
        severity: f.severity,
        message: f.message,
        line: f.primarySpan.startLine,
      }));

    return {
      kern,
      findings,
      stats: {
        inputTokens,
        kernTokens,
        constructs: inferred.length,
        reduction: inputTokens > 0 ? Math.round((1 - kernTokens / inputTokens) * 100) : 0,
      },
      error: null,
    };
  } catch (err: unknown) {
    const error = err as Error & { line?: number; col?: number };
    return {
      kern: null,
      findings: [],
      stats: null,
      error: {
        message: error.message ?? String(err),
        line: error.line ?? 0,
        col: error.col ?? 0,
        codeFrame: '',
      },
    };
  }
}
