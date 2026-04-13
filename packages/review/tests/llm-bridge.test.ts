/**
 * LLM Bridge tests — availability check, graceful degradation, finding merge.
 *
 * Does NOT call real LLM APIs — tests the plumbing.
 */

import { buildReviewInstructions, isHighValueFinding, isLLMAvailable, runLLMReview } from '../src/llm-bridge.js';
import type { ReviewFinding } from '../src/types.js';

describe('isLLMAvailable', () => {
  it('returns false when no API key', () => {
    const orig = process.env.KERN_LLM_API_KEY;
    delete process.env.KERN_LLM_API_KEY;
    expect(isLLMAvailable()).toBe(false);
    if (orig) process.env.KERN_LLM_API_KEY = orig;
  });

  it('returns true when API key is configured via override', () => {
    expect(isLLMAvailable({ apiKey: 'test-key-123' })).toBe(true);
  });

  it('returns true when env var is set', () => {
    const orig = process.env.KERN_LLM_API_KEY;
    process.env.KERN_LLM_API_KEY = 'test-key-456';
    expect(isLLMAvailable()).toBe(true);
    if (orig) {
      process.env.KERN_LLM_API_KEY = orig;
    } else {
      delete process.env.KERN_LLM_API_KEY;
    }
  });
});

describe('runLLMReview — no API key', () => {
  it('returns empty array when no API key (CI/CD safe)', async () => {
    const orig = process.env.KERN_LLM_API_KEY;
    delete process.env.KERN_LLM_API_KEY;

    const findings = await runLLMReview([
      {
        filePath: 'test.ts',
        inferred: [],
        templateMatches: [],
      },
    ]);

    expect(findings).toEqual([]);

    if (orig) process.env.KERN_LLM_API_KEY = orig;
  });
});

describe('runLLMReview — missing model', () => {
  it('returns error finding when API key set but model missing', async () => {
    const findings = await runLLMReview(
      [
        {
          filePath: 'test.ts',
          inferred: [],
          templateMatches: [],
        },
      ],
      {
        apiKey: 'fake-key',
        model: '', // No model
        timeout: 2000,
      },
    );

    expect(findings.length).toBe(1);
    expect(findings[0].ruleId).toBe('llm-error');
    expect(findings[0].message).toContain('KERN_LLM_MODEL');
  });
});

describe('runLLMReview — API failure', () => {
  it('returns info finding on API error, does not crash', async () => {
    const findings = await runLLMReview(
      [
        {
          filePath: 'test.ts',
          inferred: [],
          templateMatches: [],
        },
      ],
      {
        apiKey: 'fake-key',
        model: 'test-model',
        baseUrl: 'http://localhost:1', // Will fail to connect
        timeout: 2000,
      },
    );

    // Should get an llm-error finding, not a crash
    expect(findings.length).toBe(1);
    expect(findings[0].ruleId).toBe('llm-error');
    expect(findings[0].severity).toBe('info');
  });
});

// ── buildReviewInstructions ──

describe('buildReviewInstructions', () => {
  it('builds assistant instructions with 3-step workflow and all review categories', () => {
    const instructions = buildReviewInstructions({ target: 'assistant', hasInlineSource: false });
    expect(instructions).toContain('STEP 1: VALIDATE STATIC FINDINGS');
    expect(instructions).toContain('STEP 2: ANALYZE TAINT PATHS');
    expect(instructions).toContain('STEP 3: REVIEW THE KERN IR');
    expect(instructions).toContain('1. CORRECTNESS');
    expect(instructions).toContain('7. RESOURCE MANAGEMENT');
    expect(instructions).toContain('node alias (N1, N2, etc.)');
  });

  it('builds API instructions with JSON response contract', () => {
    const instructions = buildReviewInstructions({ target: 'api', hasInlineSource: true });
    expect(instructions).toContain('Return ONLY a JSON array of findings');
    expect(instructions).toContain('Do NOT repeat findings already listed in <kern-findings>');
    expect(instructions).toContain('Use aliases from the Valid aliases list ONLY');
  });

  it('builds IR-only API instructions when no source available', () => {
    const instructions = buildReviewInstructions({ target: 'api', hasInlineSource: false });
    expect(instructions).toContain('security code reviewer');
    expect(instructions).toContain('Explain HOW an attacker could exploit');
  });
});

// ── isHighValueFinding ──

describe('isHighValueFinding', () => {
  const makeFinding = (severity: string, confidence?: number): ReviewFinding => ({
    source: 'kern',
    ruleId: 'test',
    severity: severity as ReviewFinding['severity'],
    category: 'bug',
    message: 'test',
    primarySpan: { file: 'test.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    fingerprint: 'test',
    ...(confidence !== undefined ? { confidence } : {}),
  });

  it('keeps errors with no confidence', () => {
    expect(isHighValueFinding(makeFinding('error'))).toBe(true);
  });

  it('keeps warnings with high confidence', () => {
    expect(isHighValueFinding(makeFinding('warning', 0.8))).toBe(true);
  });

  it('keeps warnings with no confidence (undefined)', () => {
    expect(isHighValueFinding(makeFinding('warning'))).toBe(true);
  });

  it('filters info severity', () => {
    expect(isHighValueFinding(makeFinding('info'))).toBe(false);
  });

  it('filters low confidence warnings', () => {
    expect(isHighValueFinding(makeFinding('warning', 0.3))).toBe(false);
  });

  it('filters low confidence errors', () => {
    expect(isHighValueFinding(makeFinding('error', 0.4))).toBe(false);
  });

  it('keeps findings at exactly 0.5 confidence', () => {
    expect(isHighValueFinding(makeFinding('warning', 0.5))).toBe(true);
  });
});

// ── Graph-aware source budgeting ──

describe('graph-aware source budgeting', () => {
  it('does not skip large CONTEXT files (source excluded from estimation)', async () => {
    // A file with source > MAX_SINGLE_FILE_TOKENS chars (~125K tokens)
    const hugeSource = 'x'.repeat(500_000);
    const graphContext = { fileDistances: new Map([['context.ts', 2]]) };

    const findings = await runLLMReview(
      [
        {
          filePath: 'context.ts',
          inferred: [],
          templateMatches: [],
          source: hugeSource,
          graphContext,
        },
      ],
      {
        apiKey: 'fake-key',
        model: 'test-model',
        baseUrl: 'http://localhost:1',
        timeout: 1000,
      },
    );

    // Without graph-aware budgeting, this would be skipped as "too large"
    // With budgeting, source is excluded for distance>0, so it fits
    expect(findings.every((f) => f.ruleId !== 'llm-skipped')).toBe(true);
  });

  it('still includes source for CHANGED files in estimation', async () => {
    // A CHANGED file with huge source SHOULD be skipped if over limit
    const hugeSource = 'x'.repeat(500_000);
    const graphContext = { fileDistances: new Map([['changed.ts', 0]]) };

    const findings = await runLLMReview(
      [
        {
          filePath: 'changed.ts',
          inferred: [],
          templateMatches: [],
          source: hugeSource,
          graphContext,
        },
      ],
      {
        apiKey: 'fake-key',
        model: 'test-model',
        baseUrl: 'http://localhost:1',
        timeout: 1000,
      },
    );

    // CHANGED file with huge source should still be skipped
    expect(findings.some((f) => f.ruleId === 'llm-skipped')).toBe(true);
  });
});
