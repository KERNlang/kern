import { exportKernIR, buildLLMPrompt, parseLLMResponse, serializeNodeWithBody, compressHandlerBody } from '../src/llm-review.js';
import type { SerializationMode } from '../src/llm-review.js';
import { inferFromSource } from '../src/inferrer.js';
import type { InferResult, TemplateMatch } from '../src/types.js';
import type { IRNode } from '@kernlang/core';

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
      // Instructions moved to system prompt (llm-bridge.ts) — only data in buildLLMPrompt
      expect(prompt).toContain('Valid aliases:');
      expect(prompt).toContain('KERN IR:');
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

  // ── serializeNodeWithBody ──

  describe('serializeNodeWithBody', () => {
    const fnNode: IRNode = {
      type: 'fn',
      props: { name: 'handleRequest', params: 'req:Request' },
      children: [{
        type: 'handler',
        props: { code: 'const x = 1;\nreturn x;' },
      }],
    };

    it('emits line references in deep mode instead of code', () => {
      const result = serializeNodeWithBody(fnNode, '', 'deep', 10, 25);
      expect(result).not.toContain('<kern-code>');
      expect(result).not.toContain('const x = 1');
      expect(result).toContain('lines=10-25');
    });

    it('keeps small handlers verbatim in ir-only mode', () => {
      const result = serializeNodeWithBody(fnNode, '', 'ir-only');
      expect(result).toContain('<kern-code>');
      expect(result).toContain('const x = 1');
    });

    it('compresses large handlers in ir-only mode', () => {
      // NOTE: test data contains security-sensitive strings (exec, query, token)
      // as sample code for compression analysis — not actual process calls.
      const largeCode = Array.from({ length: 50 }, (_, i) => {
        if (i === 5) return '  const result = db.query(sql);';
        if (i === 10) return '  if (user.token) {';
        if (i === 20) return '  runExec(command);'; // eslint-disable-line -- test data, not real exec
        return `  const v${i} = process(${i});`;
      }).join('\n');
      const largeNode: IRNode = {
        type: 'fn',
        props: { name: 'large' },
        children: [{ type: 'handler', props: { code: largeCode } }],
      };
      const result = serializeNodeWithBody(largeNode, '', 'ir-only');
      expect(result).toContain('<kern-code>');
      expect(result).toContain('// 50 lines, logic skeleton:');
      expect(result).toContain('db.query');
      expect(result).toContain('[EFFECT:db]');
      // Should NOT contain all 50 verbatim lines
      expect(result).not.toContain('v49');
    });

    it('defaults to ir-only mode', () => {
      const result = serializeNodeWithBody(fnNode, '');
      expect(result).toContain('<kern-code>');
    });
  });

  // ── compressHandlerBody ──

  describe('compressHandlerBody', () => {
    it('includes line count and skeleton header', () => {
      const code = Array(40).fill('  x();').join('\n');
      const result = compressHandlerBody(code);
      expect(result).toContain('// 40 lines, logic skeleton:');
    });

    it('preserves control flow lines with annotations', () => {
      const code = Array(35).fill('  x;').map((_, i) => {
        if (i === 0) return '  if (a) {';
        if (i === 1) return '  } else {';
        if (i === 5) return '  for (const x of arr) {';
        if (i === 10) return '  try {';
        if (i === 15) return '  return result;';
        return '  x;';
      }).join('\n');
      const result = compressHandlerBody(code);
      expect(result).toContain('if (a)');
      expect(result).toContain('for (const x of arr)');
      expect(result).toContain('try {');
      expect(result).toContain('return result');
    });

    it('annotates effect lines with EFFECT markers', () => {
      const code = Array(35).fill('  x;').map((_, i) => {
        if (i === 0) return '  const data = await db.query("SELECT *");';
        if (i === 5) return '  await fetch("/api/data");';
        return '  x;';
      }).join('\n');
      const result = compressHandlerBody(code);
      expect(result).toContain('[EFFECT:db]');
      expect(result).toContain('[EFFECT:net]');
    });

    it('preserves security-relevant lines with annotations', () => {
      // NOTE: strings below are test data for security pattern detection, not real calls
      const code = Array(35).fill('  x;').map((_, i) => {
        if (i === 5) return '  runExec(userInput);'; // eslint-disable-line -- test data
        if (i === 10) return '  const hash = crypto.createHash("sha256");';
        return '  x;';
      }).join('\n');
      const result = compressHandlerBody(code);
      expect(result).toContain('crypto.createHash');
      expect(result).toContain('[EFFECT:crypto]');
    });

    it('annotates error handling with ERROR markers', () => {
      const code = Array(35).fill('  x;').map((_, i) => {
        if (i === 0) return '  try {';
        if (i === 5) return '  catch (err) {';
        if (i === 6) return '  throw err;';
        if (i === 10) return '  throw new Error("fail");';
        return '  x;';
      }).join('\n');
      const result = compressHandlerBody(code);
      expect(result).toContain('[ERROR:handle]');
      expect(result).toContain('[ERROR:propagate]');
      expect(result).toContain('[ERROR:raise]');
    });
  });

  // ── buildLLMPrompt with mode ──

  describe('buildLLMPrompt with SerializationMode', () => {
    it('accepts mode parameter without error', () => {
      const deepPrompt = buildLLMPrompt(inferred, [], undefined, 'deep');
      const irPrompt = buildLLMPrompt(inferred, [], undefined, 'ir-only');
      // Both should produce valid output
      expect(deepPrompt).toContain('Valid aliases:');
      expect(irPrompt).toContain('Valid aliases:');
    });

    it('defaults to ir-only mode', () => {
      const defaultPrompt = buildLLMPrompt(inferred, []);
      const irPrompt = buildLLMPrompt(inferred, [], undefined, 'ir-only');
      expect(defaultPrompt).toBe(irPrompt);
    });
  });
});
