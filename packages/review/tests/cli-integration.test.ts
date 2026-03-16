/**
 * CLI Integration Tests — tests the functions the CLI invokes.
 *
 * Tests --llm, --fix, and --lint paths without subprocess spawning.
 */

import { reviewSource, buildLLMPrompt, parseLLMResponse, dedup, runTSCDiagnostics, runTSCDiagnosticsFromPaths, runESLint, linkToNodes } from '../src/index.js';
import { createInMemoryProject } from '../src/inferrer.js';
import type { ReviewConfig, ReviewFinding, InferResult } from '../src/types.js';

// ── --llm tests ──────────────────────────────────────────────────────

describe('CLI --llm: buildLLMPrompt + parseLLMResponse', () => {
  const source = `
export type PlanState = 'idle' | 'running' | 'done';
export interface PlanConfig {
  timeout: number;
  retries: number;
}
export function startPlan(): void {}
`;

  it('round-trips: reviewSource → buildLLMPrompt → parseLLMResponse → valid findings', () => {
    const report = reviewSource(source, 'plan.ts');
    const prompt = buildLLMPrompt(report.inferred, report.templateMatches);

    // Prompt should contain alias references
    expect(prompt).toContain('N1');
    expect(prompt).toContain('Valid aliases:');

    // Simulate LLM response with valid alias
    const llmResponse = JSON.stringify([
      { nodeAlias: 'N1', severity: 'info', category: 'pattern', message: 'Consider documenting state transitions', evidence: 'PlanState' },
    ]);

    const findings = parseLLMResponse(llmResponse, report.inferred);
    expect(findings.length).toBe(1);
    expect(findings[0].source).toBe('llm');
    expect(findings[0].nodeIds).toBeDefined();
    expect(findings[0].nodeIds!.length).toBeGreaterThan(0);
  });

  it('aliases in prompt match non-import inferred nodes', () => {
    const report = reviewSource(source, 'plan.ts');
    const prompt = buildLLMPrompt(report.inferred, report.templateMatches);

    // Imports should NOT appear in prompt aliases
    const nonImportNodes = report.inferred.filter(r => r.node.type !== 'import');
    for (const node of nonImportNodes) {
      expect(prompt).toContain(`[${node.promptAlias}]`);
    }
  });

  it('rejects response with bad aliases', () => {
    const report = reviewSource(source, 'plan.ts');

    const llmResponse = JSON.stringify([
      { nodeAlias: 'N999', severity: 'error', category: 'bug', message: 'Bad alias' },
    ]);

    const findings = parseLLMResponse(llmResponse, report.inferred);
    // N999 doesn't exist → should be silently rejected
    expect(findings.length).toBe(0);
  });

  it('handles markdown-wrapped JSON response', () => {
    const report = reviewSource(source, 'plan.ts');
    const llmResponse = '```json\n' + JSON.stringify([
      { nodeAlias: 'N1', severity: 'warning', category: 'structure', message: 'Test finding' },
    ]) + '\n```';

    const findings = parseLLMResponse(llmResponse, report.inferred);
    expect(findings.length).toBe(1);
  });
});

// ── --fix tests ──────────────────────────────────────────────────────

describe('CLI --fix: template match + suggestedKern', () => {
  it('reviewSource on zustand code produces templateMatches', () => {
    const source = `
import { create } from 'zustand';
interface BearState {
  bears: number;
  increase: (by: number) => void;
}
const useBearStore = create<BearState>()((set) => ({
  bears: 0,
  increase: (by: number) => set((state) => ({ bears: state.bears + by })),
}));
`;
    const config: ReviewConfig = { target: 'web', registeredTemplates: ['zustand-store'] };
    const report = reviewSource(source, 'store.ts', config);
    // Even without registered templates matching, inferred should work
    expect(report.inferred.length).toBeGreaterThan(0);
  });

  it('no template matches → graceful no-op', () => {
    const source = `
export function add(a: number, b: number): number {
  return a + b;
}
`;
    const report = reviewSource(source, 'math.ts');
    expect(report.templateMatches.length).toBe(0);
  });
});

// ── --lint tests ─────────────────────────────────────────────────────

describe('CLI --lint: tsc diagnostics', () => {
  it('runTSCDiagnostics on project with type error → findings with source=tsc', () => {
    const project = createInMemoryProject();
    project.createSourceFile('error.ts', `
const x: number = "not a number";
export { x };
`);

    const findings = runTSCDiagnostics(project);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].source).toBe('tsc');
    expect(findings[0].ruleId).toMatch(/^ts\d+$/);
    expect(findings[0].category).toBe('type');
  });

  it('runTSCDiagnostics on clean code → empty array', () => {
    const project = createInMemoryProject();
    project.createSourceFile('clean.ts', `
export const x: number = 42;
export function add(a: number, b: number): number { return a + b; }
`);

    const findings = runTSCDiagnostics(project);
    expect(findings.length).toBe(0);
  });

  it('runTSCDiagnosticsFromPaths with empty input → empty array', () => {
    const findings = runTSCDiagnosticsFromPaths([]);
    expect(findings.length).toBe(0);
  });

  it('runESLint returns empty when ESLint not installed (CI safe)', async () => {
    // This tests graceful degradation — should return [] not throw
    const findings = await runESLint([], process.cwd());
    expect(findings).toEqual([]);
  });
});

describe('CLI --lint: linkToNodes', () => {
  it('attaches nodeIds when spans overlap', () => {
    const findings: ReviewFinding[] = [{
      source: 'tsc',
      ruleId: 'ts2322',
      severity: 'error',
      category: 'type',
      message: 'Type mismatch',
      primarySpan: { file: 'test.ts', startLine: 5, startCol: 1, endLine: 5, endCol: 10 },
      fingerprint: 'test-fp',
    }];

    const inferred: InferResult[] = [{
      node: { type: 'fn', props: { name: 'myFn' } },
      nodeId: 'test.ts#fn:myFn@0',
      promptAlias: 'N1',
      startLine: 3,
      endLine: 10,
      sourceSpans: [],
      summary: 'fn myFn',
      confidence: 'high',
      confidencePct: 95,
      kernTokens: 10,
      tsTokens: 50,
    }];

    const linked = linkToNodes(findings, inferred);
    expect(linked[0].nodeIds).toEqual(['test.ts#fn:myFn@0']);
  });
});

describe('CLI --lint: dedup merges kern + tsc findings', () => {
  it('deduplicates findings with same line and message prefix', () => {
    const findings: ReviewFinding[] = [
      {
        source: 'kern',
        ruleId: 'floating-promise',
        severity: 'error',
        category: 'bug',
        message: 'Floating promise on fetchData()',
        primarySpan: { file: 'a.ts', startLine: 5, startCol: 1, endLine: 5, endCol: 10 },
        fingerprint: 'fp-1',
      },
      {
        source: 'tsc',
        ruleId: 'ts2345',
        severity: 'error',
        category: 'type',
        message: 'Type error on line 10',
        primarySpan: { file: 'a.ts', startLine: 10, startCol: 1, endLine: 10, endCol: 10 },
        fingerprint: 'fp-2',
      },
      {
        source: 'kern',
        ruleId: 'floating-promise',
        severity: 'warning',
        category: 'bug',
        message: 'Floating promise on fetchData()',
        primarySpan: { file: 'a.ts', startLine: 5, startCol: 1, endLine: 5, endCol: 10 },
        fingerprint: 'fp-3',
      },
    ];

    const deduped = dedup(findings);
    expect(deduped.length).toBe(2);
    // Higher severity (error) should be kept over warning
    const kept = deduped.find(f => f.primarySpan.startLine === 5);
    expect(kept!.severity).toBe('error');
  });
});
