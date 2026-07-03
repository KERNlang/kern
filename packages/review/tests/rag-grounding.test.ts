import { buildLLMPrompt, parseLLMResponse } from '../src/llm-review.js';
import {
  type EntailmentJudgeInput,
  type EntailmentJudgeResult,
  type GroundingPolicy,
  groundFindings,
  type RuleCorpus,
  type RuleText,
} from '../src/rag-grounding.js';
import type { InferResult, ReviewFinding } from '../src/types.js';

// ── Fixtures ─────────────────────────────────────────────────────────────

function llmFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    source: 'llm',
    ruleId: 'llm-bug',
    severity: 'warning',
    category: 'bug',
    message: 'Possible bug',
    primarySpan: { file: 'a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    fingerprint: 'llm-bug:1:1',
    confidence: 75,
    ...overrides,
  };
}

/** Minimal corpus with only Tier A (membership) wired — no getRuleText /
 *  evaluateEntailment, so Tier B is a structural no-op. */
function tierACorpus(ruleIds: string[], available = true): RuleCorpus {
  return {
    listRuleIds: () => ruleIds,
    available,
  };
}

interface TierBCorpusOptions {
  ruleIds: string[];
  ruleText: Map<string, RuleText>;
  judge: (input: EntailmentJudgeInput) => Promise<EntailmentJudgeResult>;
}

function tierBCorpus(opts: TierBCorpusOptions): RuleCorpus {
  return {
    listRuleIds: () => opts.ruleIds,
    available: true,
    getRuleText: (ruleId) => opts.ruleText.get(ruleId),
    evaluateEntailment: opts.judge,
  };
}

const HUNK = '@@ -1,3 +1,3 @@\n-old\n+new';

// ── Tier A ───────────────────────────────────────────────────────────────

describe('groundFindings — Tier A membership', () => {
  it('drops a finding whose cited ruleId is not in the corpus (hallucinated)', async () => {
    const finding = llmFinding({ citation: { ruleId: 'conv:no-such-rule', groundedBy: 'membership' } });
    const result = await groundFindings([finding], tierACorpus(['conv:real-rule']));
    expect(result.grounded).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.reason).toBe('unknown-rule-id');
  });

  it('drops a finding with no citation at all', async () => {
    const finding = llmFinding();
    const result = await groundFindings([finding], tierACorpus(['conv:real-rule']));
    expect(result.grounded).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.reason).toBe('no-citation');
  });

  it('keeps a finding whose citation matches a real mined rule (Tier A only, no judge wired)', async () => {
    const finding = llmFinding({ citation: { ruleId: 'conv:real-rule', groundedBy: 'membership' } });
    const result = await groundFindings([finding], tierACorpus(['conv:real-rule']));
    expect(result.grounded).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
    expect(result.grounded[0]?.citation?.groundedBy).toBe('membership');
  });

  it('leaves a non-LLM finding untouched regardless of citation (scope guard)', async () => {
    const finding = llmFinding({ source: 'kern', ruleId: 'dead-export' });
    const result = await groundFindings([finding], tierACorpus([]));
    expect(result.grounded).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
    expect(result.grounded[0]).toBe(finding);
  });

  it('leaves a custom-rule finding (ruleId starting "custom/") untouched — different corpus, already gated by construction', async () => {
    const finding = llmFinding({ source: 'llm', ruleId: 'custom/my-team-rule' });
    // Corpus has zero MINED rules — if the scope guard were missing this
    // would incorrectly drop as no-rules-in-repo/unknown-rule-id.
    const result = await groundFindings([finding], tierACorpus([]));
    expect(result.grounded).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it('distinguishes corpus-unavailable (never mined / DB down) from no-rules-in-repo (mined, zero rules)', async () => {
    const finding = llmFinding({ citation: { ruleId: 'conv:x', groundedBy: 'membership' } });

    const unavailable = await groundFindings([finding], tierACorpus([], false));
    expect(unavailable.dropped[0]?.reason).toBe('corpus-unavailable');

    const zeroRules = await groundFindings([finding], tierACorpus([], true));
    expect(zeroRules.dropped[0]?.reason).toBe('no-rules-in-repo');
  });

  it('policy flip (pass-through-labeled) changes empty-corpus behavior from drop to pass-through', async () => {
    const finding = llmFinding({ citation: { ruleId: 'conv:x', groundedBy: 'membership' } });
    const policy: GroundingPolicy = { onCorpusUnavailable: 'pass-through-labeled' };

    const dropped = await groundFindings([finding], tierACorpus([], false), { onCorpusUnavailable: 'drop-all' });
    expect(dropped.grounded).toHaveLength(0);

    const passed = await groundFindings([finding], tierACorpus([], false), policy);
    expect(passed.grounded).toHaveLength(1);
    expect(passed.dropped).toHaveLength(0);
  });

  it('ordering spy: a downstream calibration stage sees only the grounded count, never the pre-drop count', async () => {
    const findings = [
      llmFinding({ fingerprint: 'f1', citation: { ruleId: 'conv:real-rule', groundedBy: 'membership' } }),
      llmFinding({ fingerprint: 'f2' }), // no citation -> drops
      llmFinding({ fingerprint: 'f3', citation: { ruleId: 'conv:hallucinated', groundedBy: 'membership' } }), // drops
    ];
    const result = await groundFindings(findings, tierACorpus(['conv:real-rule']));

    const calibrationSpy: ReviewFinding[][] = [];
    const fakeCalibrate = (fs: ReviewFinding[]) => {
      calibrationSpy.push(fs);
      return fs;
    };
    fakeCalibrate(result.grounded);

    expect(calibrationSpy).toHaveLength(1);
    expect(calibrationSpy[0]).toHaveLength(1);
    expect(calibrationSpy[0]?.[0]?.fingerprint).toBe('f1');
  });
});

// ── Tier B — violation-entailment judge ─────────────────────────────────

describe('groundFindings — Tier B entailment (proves Tier B is load-bearing, not decorative)', () => {
  const ruleText = new Map<string, RuleText>([
    ['conv:real-rule', { name: 'No raw SQL', description: 'Use the query builder, never string-concatenated SQL.' }],
  ]);

  it('drops a real-ruleId citation when the judge says the code does not actually violate the rule (shadow mode: would-drop, not dropped)', async () => {
    const finding = llmFinding({ citation: { ruleId: 'conv:real-rule', groundedBy: 'membership' } });
    const corpus = tierBCorpus({
      ruleIds: ['conv:real-rule'],
      ruleText,
      judge: async () => ({ violates: false, reason: 'The cited line uses the query builder, not raw SQL.' }),
    });
    const result = await groundFindings([finding], corpus, {
      onCorpusUnavailable: 'drop-all',
      tierB: 'shadow',
      getDiffHunk: () => HUNK,
    });
    // Shadow mode: NOT actually dropped, but recorded as a would-drop.
    expect(result.grounded).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
    expect(result.shadowDrops).toHaveLength(1);
    expect(result.shadowDrops[0]?.reason).toBe('entailment-failed');
  });

  it('ENFORCING mode actually drops on entailment-failed — proves Tier B is load-bearing once flipped', async () => {
    const finding = llmFinding({ citation: { ruleId: 'conv:real-rule', groundedBy: 'membership' } });
    const corpus = tierBCorpus({
      ruleIds: ['conv:real-rule'],
      ruleText,
      judge: async () => ({ violates: false, reason: 'Not actually a violation — false positive.' }),
    });
    const result = await groundFindings([finding], corpus, {
      onCorpusUnavailable: 'drop-all',
      tierB: 'enforcing',
      getDiffHunk: () => HUNK,
    });
    expect(result.grounded).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.reason).toBe('entailment-failed');
    expect(result.shadowDrops).toHaveLength(0);
  });

  it('keeps and upgrades citation to entailment when the judge confirms the violation', async () => {
    const finding = llmFinding({ citation: { ruleId: 'conv:real-rule', groundedBy: 'membership' } });
    const corpus = tierBCorpus({
      ruleIds: ['conv:real-rule'],
      ruleText,
      judge: async () => ({ violates: true, reason: 'Raw string-concatenated SQL on the cited line.' }),
    });
    const result = await groundFindings([finding], corpus, {
      onCorpusUnavailable: 'drop-all',
      tierB: 'enforcing',
      getDiffHunk: () => HUNK,
    });
    expect(result.grounded).toHaveLength(1);
    expect(result.grounded[0]?.citation?.groundedBy).toBe('entailment');
    expect(result.grounded[0]?.citation?.entailment?.violates).toBe(true);
  });

  it('fails closed with rule-meta-invalid when the corpus text row is missing/duplicated — never a shadow-only concern', async () => {
    const finding = llmFinding({ citation: { ruleId: 'conv:real-rule', groundedBy: 'membership' } });
    const corpus = tierBCorpus({
      ruleIds: ['conv:real-rule'],
      ruleText: new Map(), // missing row for a ruleId that DOES pass Tier A membership
      judge: async () => ({ violates: true, reason: 'unreachable' }),
    });
    const result = await groundFindings([finding], corpus, {
      onCorpusUnavailable: 'drop-all',
      tierB: 'shadow', // even in shadow mode, meta-invalid is a hard drop
      getDiffHunk: () => HUNK,
    });
    expect(result.grounded).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.reason).toBe('rule-meta-invalid');
  });

  it('fails closed with entailment-error when the judge throws/times out', async () => {
    const finding = llmFinding({ citation: { ruleId: 'conv:real-rule', groundedBy: 'membership' } });
    const corpus = tierBCorpus({
      ruleIds: ['conv:real-rule'],
      ruleText,
      judge: async () => {
        throw new Error('judge timeout');
      },
    });
    const enforcing = await groundFindings([finding], corpus, {
      onCorpusUnavailable: 'drop-all',
      tierB: 'enforcing',
      getDiffHunk: () => HUNK,
    });
    expect(enforcing.dropped[0]?.reason).toBe('entailment-error');

    const shadow = await groundFindings([finding], corpus, {
      onCorpusUnavailable: 'drop-all',
      tierB: 'shadow',
      getDiffHunk: () => HUNK,
    });
    expect(shadow.grounded).toHaveLength(1);
    expect(shadow.shadowDrops[0]?.reason).toBe('entailment-error');
  });

  it('skips Tier B (Tier-A-only grounding) when no diff hunk is resolvable for this finding', async () => {
    const finding = llmFinding({ citation: { ruleId: 'conv:real-rule', groundedBy: 'membership' } });
    let judgeCalled = false;
    const corpus = tierBCorpus({
      ruleIds: ['conv:real-rule'],
      ruleText,
      judge: async () => {
        judgeCalled = true;
        return { violates: true, reason: 'x' };
      },
    });
    const result = await groundFindings([finding], corpus, {
      onCorpusUnavailable: 'drop-all',
      tierB: 'enforcing',
      getDiffHunk: () => undefined,
    });
    expect(result.grounded).toHaveLength(1);
    expect(result.grounded[0]?.citation?.groundedBy).toBe('membership');
    expect(judgeCalled).toBe(false);
  });
});

// ── Emission half — end to end ──────────────────────────────────────────

describe('emission + gate pair (end-to-end)', () => {
  function fakeInferred(): InferResult[] {
    return [
      {
        node: { type: 'function', props: { name: 'handler' } } as unknown as InferResult['node'],
        nodeId: 'a.ts#function:handler@0',
        promptAlias: 'N1',
        startLine: 1,
        endLine: 5,
        sourceSpans: [{ file: 'a.ts', startLine: 1, startCol: 1, endLine: 5, endCol: 1 }],
        summary: 'handler',
        confidence: 'high',
        confidencePct: 95,
        kernTokens: 5,
        tsTokens: 20,
      },
    ];
  }

  it('buildLLMPrompt renders a bounded <kern-rules> block only when mineRules is supplied', () => {
    const withRules = buildLLMPrompt(fakeInferred(), [], undefined, 'ir-only', undefined, [
      { ruleId: 'conv:real-rule', name: 'No raw SQL', description: 'Use the query builder.' },
    ]);
    expect(withRules).toContain('<kern-rules>');
    expect(withRules).toContain('conv:real-rule');

    const withoutRules = buildLLMPrompt(fakeInferred(), [], undefined, 'ir-only');
    expect(withoutRules).not.toContain('<kern-rules>');
  });

  it('parseLLMResponse round-trips a valid citation into ReviewFinding.citation', () => {
    const raw = JSON.stringify([
      {
        nodeAlias: 'N1',
        severity: 'warning',
        category: 'bug',
        message: 'Raw SQL string concatenation.',
        confidence: 75,
        citation: { ruleId: 'conv:real-rule' },
      },
    ]);
    const findings = parseLLMResponse(raw, fakeInferred());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.citation).toEqual({ ruleId: 'conv:real-rule', groundedBy: 'membership' });
  });

  it('parseLLMResponse leaves citation undefined when the model omits it (cite-or-omit, not forced)', () => {
    const raw = JSON.stringify([
      { nodeAlias: 'N1', severity: 'warning', category: 'bug', message: 'Something odd.', confidence: 70 },
    ]);
    const findings = parseLLMResponse(raw, fakeInferred());
    expect(findings[0]?.citation).toBeUndefined();
  });

  it('END-TO-END: reviewer output WITHOUT citations makes the gate drop EVERY finding as no-citation — proves emission+gate must ship together', async () => {
    const raw = JSON.stringify([
      { nodeAlias: 'N1', severity: 'warning', category: 'bug', message: 'Finding one.', confidence: 70 },
      { nodeAlias: 'N1', severity: 'error', category: 'bug', message: 'Finding two.', confidence: 85 },
    ]);
    const findings = parseLLMResponse(raw, fakeInferred());
    expect(findings).toHaveLength(2); // reviewer ran fine, produced real findings

    // A gate-only implementation (grounding shipped without emission
    // changes) would silence a perfectly healthy review run to zero
    // findings and nobody would know why. This fixture is the guard
    // against shipping the two halves separately.
    const result = await groundFindings(findings, tierACorpus(['conv:real-rule']));
    expect(result.grounded).toHaveLength(0);
    expect(result.dropped).toHaveLength(2);
    expect(result.dropped.every((d) => d.reason === 'no-citation')).toBe(true);
  });
});
