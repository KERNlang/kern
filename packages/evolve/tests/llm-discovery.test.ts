import { NODE_TYPES } from '@kernlang/core';
import {
  buildDiscoveryPrompt,
  parseDiscoveryResponse,
  selectRepresentativeFiles,
  estimateTokens,
} from '../src/llm-discovery.js';
import { TokenBudget } from '../src/llm-provider.js';

describe('LLM Discovery', () => {
  describe('buildDiscoveryPrompt', () => {
    it('includes file contents and node types', () => {
      const prompt = buildDiscoveryPrompt(
        [{ path: 'src/cache.ts', content: 'const cache = new Map();' }],
        NODE_TYPES,
      );
      expect(prompt).toContain('src/cache.ts');
      expect(prompt).toContain('const cache = new Map()');
      expect(prompt).toContain('screen');
      expect(prompt).toContain('button');
      expect(prompt).toContain('route');
    });

    it('includes evolved keywords when provided', () => {
      const prompt = buildDiscoveryPrompt(
        [{ path: 'test.ts', content: 'x' }],
        NODE_TYPES,
        ['my-evolved-node'],
      );
      expect(prompt).toContain('my-evolved-node');
    });

    it('truncates large files', () => {
      const bigContent = 'x'.repeat(5000);
      const prompt = buildDiscoveryPrompt(
        [{ path: 'big.ts', content: bigContent }],
        NODE_TYPES,
      );
      expect(prompt).toContain('truncated');
      expect(prompt.length).toBeLessThan(bigContent.length + 5000);
    });

    it('includes codegenSource format instructions', () => {
      const prompt = buildDiscoveryPrompt(
        [{ path: 'test.ts', content: 'x' }],
        NODE_TYPES,
      );
      expect(prompt).toContain('module.exports = function(node, helpers)');
      expect(prompt).toContain('helpers.p(node)');
      expect(prompt).toContain('helpers.kids');
      expect(prompt).toContain('return string[]');
    });
  });

  describe('parseDiscoveryResponse', () => {
    it('parses a well-formed JSON array response', () => {
      const response = JSON.stringify([
        {
          keyword: 'cache-wrapper',
          displayName: 'Cache Wrapper',
          description: 'Redis cache pattern',
          props: [{ name: 'name', type: 'string', required: true, description: 'Cache name' }],
          childTypes: ['entry'],
          kernExample: 'cache-wrapper name=myCache',
          expectedOutput: 'export const myCache = {};',
          codegenSource: "module.exports = function(node, helpers) { return ['export const ' + helpers.p(node).name + ' = {};']; };",
          reason: {
            observation: 'Found 5 cache patterns',
            inefficiency: '40 lines each',
            kernBenefit: '3 lines of KERN',
          },
        },
      ]);

      const proposals = parseDiscoveryResponse(response, 'test-run');
      expect(proposals).toHaveLength(1);
      expect(proposals[0].keyword).toBe('cache-wrapper');
      expect(proposals[0].displayName).toBe('Cache Wrapper');
      expect(proposals[0].props).toHaveLength(1);
      expect(proposals[0].codegenSource).toContain('module.exports');
      expect(proposals[0].evolveRunId).toBe('test-run');
    });

    it('handles markdown-fenced response', () => {
      const response = `Here are the patterns I found:

\`\`\`json
[
  {
    "keyword": "api-client",
    "displayName": "API Client",
    "description": "HTTP client wrapper",
    "props": [],
    "childTypes": [],
    "kernExample": "api-client name=github",
    "expectedOutput": "const github = {};",
    "codegenSource": "module.exports = function(node, helpers) { return ['const ' + helpers.p(node).name + ' = {};']; };",
    "reason": { "observation": "Found 3 instances", "inefficiency": "20 lines", "kernBenefit": "1 line" }
  }
]
\`\`\`

These are the main patterns.`;

      const proposals = parseDiscoveryResponse(response);
      expect(proposals).toHaveLength(1);
      expect(proposals[0].keyword).toBe('api-client');
    });

    it('returns empty for invalid JSON', () => {
      expect(parseDiscoveryResponse('not json at all')).toEqual([]);
    });

    it('returns empty for empty array', () => {
      expect(parseDiscoveryResponse('[]')).toEqual([]);
    });

    it('skips malformed entries', () => {
      const response = JSON.stringify([
        { keyword: 'valid-node', displayName: 'Valid', description: 'ok', props: [], childTypes: [], kernExample: 'valid-node', expectedOutput: 'x', codegenSource: 'module.exports = function() { return []; };', reason: { observation: 'x', inefficiency: 'x', kernBenefit: 'x' } },
        { noKeyword: true },
        null,
      ]);
      const proposals = parseDiscoveryResponse(response);
      expect(proposals).toHaveLength(1);
      expect(proposals[0].keyword).toBe('valid-node');
    });

    it('normalizes uppercase/special-char keywords', () => {
      const response = JSON.stringify([{
        keyword: 'My_Special.Node',
        displayName: 'X', description: 'X', props: [], childTypes: [],
        kernExample: 'x', expectedOutput: 'x', codegenSource: 'module.exports = function() { return []; };',
        reason: { observation: 'x', inefficiency: 'x', kernBenefit: 'x' },
      }]);
      const proposals = parseDiscoveryResponse(response);
      expect(proposals[0].keyword).toBe('my-special-node');
    });

    it('fills missing optional fields with defaults', () => {
      const response = JSON.stringify([{
        keyword: 'minimal',
        kernExample: 'minimal',
        codegenSource: 'module.exports = function() { return []; };',
        expectedOutput: '',
        reason: { observation: 'x' },
      }]);
      const proposals = parseDiscoveryResponse(response);
      expect(proposals).toHaveLength(1);
      expect(proposals[0].props).toEqual([]);
      expect(proposals[0].childTypes).toEqual([]);
      expect(proposals[0].displayName).toBe('minimal');
    });
  });

  describe('selectRepresentativeFiles', () => {
    it('groups files by directory', () => {
      const files = [
        '/src/cache/a.ts', '/src/cache/b.ts', '/src/cache/c.ts', '/src/cache/d.ts',
        '/src/auth/x.ts', '/src/auth/y.ts',
      ];
      const batches = selectRepresentativeFiles(files, 2, 5);
      // Should sample 2 from cache, 2 from auth = 4 files, 1 batch
      expect(batches.length).toBeGreaterThanOrEqual(1);
      const allFiles = batches.flat();
      expect(allFiles.length).toBeLessThanOrEqual(5);
    });

    it('respects maxBatchSize', () => {
      const files = Array.from({ length: 20 }, (_, i) => `/src/dir${i}/file.ts`);
      const batches = selectRepresentativeFiles(files, 1, 3);
      for (const batch of batches) {
        expect(batch.length).toBeLessThanOrEqual(3);
      }
    });

    it('handles empty input', () => {
      expect(selectRepresentativeFiles([])).toEqual([]);
    });

    it('handles single file', () => {
      const batches = selectRepresentativeFiles(['/src/main.ts']);
      expect(batches).toEqual([['/src/main.ts']]);
    });
  });

  describe('estimateTokens', () => {
    it('estimates ~1 token per 4 chars', () => {
      expect(estimateTokens('hello world')).toBe(3); // 11 chars / 4 = 2.75 → 3
    });

    it('handles empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });
  });

  describe('TokenBudget', () => {
    it('tracks usage', () => {
      const budget = new TokenBudget(1000);
      expect(budget.remaining).toBe(1000);
      expect(budget.exhausted).toBe(false);

      budget.add(600);
      expect(budget.remaining).toBe(400);
      expect(budget.totalUsed).toBe(600);

      budget.add(500);
      expect(budget.exhausted).toBe(true);
      expect(budget.remaining).toBe(0);
    });

    it('formats as string', () => {
      const budget = new TokenBudget(1000);
      budget.add(250);
      expect(budget.toString()).toContain('250/1000');
      expect(budget.toString()).toContain('25%');
    });
  });
});
