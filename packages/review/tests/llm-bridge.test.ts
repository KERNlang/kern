/**
 * LLM Bridge tests — availability check, graceful degradation, finding merge.
 *
 * Does NOT call real LLM APIs — tests the plumbing.
 */

import { isLLMAvailable, runLLMReview } from '../src/llm-bridge.js';

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

    const findings = await runLLMReview([{
      filePath: 'test.ts',
      inferred: [],
      templateMatches: [],
    }]);

    expect(findings).toEqual([]);

    if (orig) process.env.KERN_LLM_API_KEY = orig;
  });
});

describe('runLLMReview — missing model', () => {
  it('returns error finding when API key set but model missing', async () => {
    const findings = await runLLMReview(
      [{
        filePath: 'test.ts',
        inferred: [],
        templateMatches: [],
      }],
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
      [{
        filePath: 'test.ts',
        inferred: [],
        templateMatches: [],
      }],
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
