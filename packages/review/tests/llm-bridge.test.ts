/**
 * LLM Bridge tests — availability check, graceful degradation, finding merge.
 *
 * Does NOT call real LLM APIs — tests the plumbing.
 */

import {
  buildReviewInstructions,
  chunkLargeInput,
  isHighValueFinding,
  isLLMAvailable,
  runLLMReview,
} from '../src/llm-bridge.js';
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

    const { findings } = await runLLMReview([
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
    const { findings } = await runLLMReview(
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
    const { findings } = await runLLMReview(
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

    const { findings } = await runLLMReview(
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

  it('chunks CHANGED files whose estimated tokens exceed the single-call budget', async () => {
    // ~125K tokens (500K chars / 4). Split over many lines so the chunker
    // has line boundaries to cut on — otherwise it falls back to skip.
    const line = `${'x'.repeat(99)}\n`;
    const hugeSource = line.repeat(5_000); // 5000 lines × ~100 chars = ~125K tokens
    const graphContext = { fileDistances: new Map([['changed.ts', 0]]) };

    const { findings } = await runLLMReview(
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
        baseUrl: 'http://127.0.0.1:1', // closed port — each chunk will emit llm-error
        timeout: 1000,
      },
    );

    // No "file too large" skip — the file is chunkable.
    expect(findings.some((f) => f.ruleId === 'llm-skipped')).toBe(false);
    // Multiple llm-error findings would indicate multiple batches were
    // attempted; one per chunked batch. We only assert ≥1 here because the
    // dedupe pass collapses identical error fingerprints from the same file.
    expect(findings.some((f) => f.ruleId === 'llm-error')).toBe(true);
  });
});

// ── chunkLargeInput unit tests ──

describe('chunkLargeInput', () => {
  it('returns the input unchanged when under the single-call budget', () => {
    const irCache = 'small IR';
    const input = {
      filePath: 'small.ts',
      inferred: [],
      templateMatches: [],
      source: 'line 1\nline 2\n',
    };
    const chunks = chunkLargeInput(input, irCache);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(input); // identity preserved when no chunking needed
  });

  it('splits an oversized CHANGED file into multiple chunks with overlap', () => {
    // 5000 lines × ~100 chars = ~125K tokens → over MAX_SINGLE_FILE_TOKENS (100K).
    const line = `${'x'.repeat(99)}`;
    const lines = Array.from({ length: 5_000 }, (_, i) => `// L${i + 1} ${line}`);
    const source = lines.join('\n');
    const input = {
      filePath: 'changed.ts',
      inferred: [],
      templateMatches: [],
      source,
      graphContext: { fileDistances: new Map([['changed.ts', 0]]) },
    };

    const chunks = chunkLargeInput(input, '');
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // Every chunk must carry a kern-chunk header so the LLM knows it's partial.
    for (const c of chunks) {
      expect(c.source).toMatch(/^\/\/ kern-chunk \d+\/\d+ of changed\.ts — lines /);
    }

    // Consecutive chunks overlap: the first non-header line of chunk N+1 must
    // appear somewhere in chunk N's body.
    const stripHeader = (s: string) =>
      s
        .split('\n')
        .filter(
          (l) =>
            !l.startsWith('// kern-chunk') && !l.startsWith('// The source file') && !l.startsWith('// Do not report'),
        )
        .join('\n');
    for (let i = 0; i < chunks.length - 1; i++) {
      const current = stripHeader(chunks[i].source!);
      const next = stripHeader(chunks[i + 1].source!);
      const nextFirstLine = next.split('\n').find((l) => l.length > 0)!;
      expect(current).toContain(nextFirstLine);
    }
  });

  it('returns [] for unchunkable CONTEXT files (distance > 0, no source in estimate)', () => {
    // CONTEXT files strip source from the token estimate, so even a huge
    // source can't trip the chunker — but IR-bound oversize is also not
    // chunkable. This test just confirms we don't chunk CONTEXT files.
    const line = `${'x'.repeat(99)}\n`;
    const source = line.repeat(5_000);
    const input = {
      filePath: 'ctx.ts',
      inferred: [],
      templateMatches: [],
      source,
      graphContext: { fileDistances: new Map([['ctx.ts', 3]]) },
    };
    // A CONTEXT file with large source still fits because source is excluded
    // from the estimate — so we expect the single-element identity return.
    const chunks = chunkLargeInput(input, '');
    expect(chunks).toHaveLength(1);
  });

  it('returns [] when the IR alone exceeds the per-chunk source budget', () => {
    // Simulate an IR-bound oversized input: the cachedIR string is huge and
    // source is negligible. estimateInputTokens ultimately sees
    // SYSTEM_PROMPT + OVERHEAD + irTokens + sourceTokens, and if IR alone
    // blows past the threshold, sourceBudget goes non-positive. The chunker
    // cannot help — chunking source doesn't reduce IR — so we return [].
    const hugeIR = 'x'.repeat(280_000); // ~70K tokens of IR alone
    const input = {
      filePath: 'ir-heavy.ts',
      inferred: [],
      templateMatches: [],
      source: 'small\n',
      graphContext: { fileDistances: new Map([['ir-heavy.ts', 0]]) },
    };
    expect(chunkLargeInput(input, hugeIR)).toEqual([]);
  });

  it('handles files with >64K lines without RangeError from Math.max spread', () => {
    // V8's spread syntax (`Math.max(...arr)`) hits the argument-list stack
    // limit around 64K elements. Early implementations used that pattern
    // and would throw RangeError before emitting any finding. The iterative
    // longestLineLength fix means a generated 70K-line file is handled
    // gracefully — here we just confirm the call returns without throwing.
    const lines = Array.from({ length: 70_000 }, () => '// short line');
    const input = {
      filePath: 'huge.ts',
      inferred: [],
      templateMatches: [],
      source: lines.join('\n'),
      graphContext: { fileDistances: new Map([['huge.ts', 0]]) },
    };
    expect(() => chunkLargeInput(input, '')).not.toThrow();
  });

  it('returns [] when a single line exceeds the per-chunk source budget (minified)', () => {
    // One line of 300K chars ≈ 75K tokens — bigger than any plausible
    // per-chunk budget. Byte-splitting this would corrupt syntax, so we skip.
    const input = {
      filePath: 'bundle.min.js',
      inferred: [],
      templateMatches: [],
      source: 'x'.repeat(600_000), // single 600K-char line → 150K tokens
      graphContext: { fileDistances: new Map([['bundle.min.js', 0]]) },
    };
    expect(chunkLargeInput(input, '')).toEqual([]);
  });
});

describe('runLLMReview — usage/timing reporting (GAP-010)', () => {
  it('aggregates provider token counts and per-request durations on success', async () => {
    const { createServer } = await import('node:http');
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '[]' } }],
          usage: { prompt_tokens: 123, completion_tokens: 45 },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const { usage, findings } = await runLLMReview([{ filePath: 'a.ts', inferred: [], templateMatches: [] }], {
        apiKey: 'fake-key',
        model: 'mock-model',
        baseUrl: `http://127.0.0.1:${port}`,
        timeout: 2000,
      });

      expect(findings).toEqual([]);
      expect(usage.requestCount).toBe(1);
      expect(usage.requestDurationsMs).toHaveLength(1);
      expect(usage.requestDurationsMs[0]).toBeGreaterThanOrEqual(0);
      expect(usage.promptTokens).toBe(123);
      expect(usage.completionTokens).toBe(45);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('counts a failed HTTP attempt in usage even when callLLM throws (codex follow-up)', async () => {
    // baseUrl points at a closed port so fetch rejects immediately.
    const { usage, findings } = await runLLMReview([{ filePath: 'a.ts', inferred: [], templateMatches: [] }], {
      apiKey: 'fake-key',
      model: 'mock-model',
      baseUrl: 'http://127.0.0.1:1',
      timeout: 1000,
    });

    // Pipeline still degrades gracefully with an llm-error finding.
    expect(findings.length).toBe(1);
    expect(findings[0].ruleId).toBe('llm-error');
    // AND the failed attempt is reflected in usage — otherwise cost/latency
    // dashboards under-report outages (the exact scenario callers most need).
    expect(usage.requestCount).toBe(1);
    expect(usage.requestDurationsMs).toHaveLength(1);
    expect(usage.requestDurationsMs[0]).toBeGreaterThanOrEqual(0);
    // No tokens were returned by the provider so counts stay undefined.
    expect(usage.promptTokens).toBeUndefined();
    expect(usage.completionTokens).toBeUndefined();
  });
});
