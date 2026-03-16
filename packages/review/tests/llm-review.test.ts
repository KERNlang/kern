import { exportKernIR, buildLLMPrompt, parseLLMResponse } from '../src/llm-review.js';
import { inferFromSource } from '../src/inferrer.js';
import type { InferResult, TemplateMatch } from '../src/types.js';

describe('LLM Review', () => {
  const source = `
export type Status = 'active' | 'inactive' | 'banned';
export interface User { id: string; name: string; status: Status; }
export function getUser(id: string): User { return {} as User; }
`;

  let inferred: InferResult[];

  beforeAll(() => {
    inferred = inferFromSource(source, 'user.ts');
  });

  // ── exportKernIR ──

  describe('exportKernIR', () => {
    it('exports KERN IR with prompt aliases', () => {
      const ir = exportKernIR(inferred, []);
      expect(ir).toContain('KERN IR');
      // Should include prompt aliases like [N1], [N2]
      expect(ir).toMatch(/\[N\d+\]/);
    });

    it('skips import nodes', () => {
      const ir = exportKernIR(inferred, []);
      expect(ir).not.toContain('import');
    });
  });

  // ── buildLLMPrompt ──

  describe('buildLLMPrompt', () => {
    it('builds structured prompt with valid aliases', () => {
      const prompt = buildLLMPrompt(inferred, []);
      expect(prompt).toContain('Review this KERN IR');
      expect(prompt).toContain('JSON array');
      expect(prompt).toContain('Valid aliases:');
      expect(prompt).toContain('nodeAlias');
    });

    it('lists all non-import aliases', () => {
      const prompt = buildLLMPrompt(inferred, []);
      const nonImports = inferred.filter(r => r.node.type !== 'import');
      for (const r of nonImports) {
        expect(prompt).toContain(r.promptAlias);
      }
    });

    it('includes KERN IR content', () => {
      const prompt = buildLLMPrompt(inferred, []);
      expect(prompt).toContain('type');
      expect(prompt).toContain('interface');
      expect(prompt).toContain('fn');
    });
  });

  // ── parseLLMResponse ──

  describe('parseLLMResponse', () => {
    it('parses valid JSON response', () => {
      const alias = inferred.find(r => r.node.type !== 'import')!.promptAlias;
      const response = JSON.stringify([
        { nodeAlias: alias, severity: 'warning', category: 'pattern', message: 'Consider using an enum', evidence: 'status field' },
      ]);

      const findings = parseLLMResponse(response, inferred);
      expect(findings.length).toBe(1);
      expect(findings[0].source).toBe('llm');
      expect(findings[0].severity).toBe('warning');
      expect(findings[0].category).toBe('pattern');
      expect(findings[0].message).toBe('Consider using an enum');
      expect(findings[0].nodeIds).toBeDefined();
    });

    it('rejects unknown aliases', () => {
      const response = JSON.stringify([
        { nodeAlias: 'N999', severity: 'error', category: 'bug', message: 'Something bad' },
      ]);

      const findings = parseLLMResponse(response, inferred);
      expect(findings.length).toBe(0); // rejected
    });

    it('handles markdown code fences', () => {
      const alias = inferred.find(r => r.node.type !== 'import')!.promptAlias;
      const response = '```json\n' + JSON.stringify([
        { nodeAlias: alias, severity: 'info', category: 'style', message: 'Style suggestion' },
      ]) + '\n```';

      const findings = parseLLMResponse(response, inferred);
      expect(findings.length).toBe(1);
    });

    it('returns parse error for invalid JSON', () => {
      const findings = parseLLMResponse('not json at all', inferred);
      expect(findings.length).toBe(1);
      expect(findings[0].ruleId).toBe('parse-error');
    });

    it('returns parse error for non-array JSON', () => {
      const findings = parseLLMResponse('{"not": "array"}', inferred);
      expect(findings.length).toBe(1);
      expect(findings[0].ruleId).toBe('parse-error');
    });

    it('skips findings with invalid severity', () => {
      const alias = inferred.find(r => r.node.type !== 'import')!.promptAlias;
      const response = JSON.stringify([
        { nodeAlias: alias, severity: 'critical', category: 'bug', message: 'Bad' },
      ]);

      const findings = parseLLMResponse(response, inferred);
      expect(findings.length).toBe(0);
    });

    it('maps findings back to TS source spans', () => {
      const node = inferred.find(r => r.node.type !== 'import')!;
      const response = JSON.stringify([
        { nodeAlias: node.promptAlias, severity: 'warning', category: 'structure', message: 'Test' },
      ]);

      const findings = parseLLMResponse(response, inferred);
      expect(findings.length).toBe(1);
      expect(findings[0].primarySpan.startLine).toBeGreaterThan(0);
      expect(findings[0].primarySpan.file).toBeDefined();
    });

    it('handles multiple findings', () => {
      const nonImports = inferred.filter(r => r.node.type !== 'import');
      const response = JSON.stringify(
        nonImports.map(r => ({
          nodeAlias: r.promptAlias,
          severity: 'info',
          category: 'style',
          message: `Review ${r.node.props?.name}`,
        }))
      );

      const findings = parseLLMResponse(response, inferred);
      expect(findings.length).toBe(nonImports.length);
    });

    it('sets confidence to 0.7 for LLM findings', () => {
      const alias = inferred.find(r => r.node.type !== 'import')!.promptAlias;
      const response = JSON.stringify([
        { nodeAlias: alias, severity: 'warning', category: 'bug', message: 'Possible bug' },
      ]);

      const findings = parseLLMResponse(response, inferred);
      expect(findings[0].confidence).toBe(0.7);
    });
  });
});
