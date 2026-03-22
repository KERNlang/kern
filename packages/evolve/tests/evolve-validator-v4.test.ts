import { clearParserHints } from '@kernlang/core';
import { validateEvolveProposal } from '../src/evolve-validator-v4.js';
import { checkDedup } from '../src/evolve-dedup.js';
import { compareGoldenOutput } from '../src/golden-test-runner.js';
import type { EvolveNodeProposal } from '../src/evolved-types.js';

function createProposal(overrides: Partial<EvolveNodeProposal> = {}): EvolveNodeProposal {
  return {
    id: 'test-1',
    keyword: 'greeting',
    displayName: 'Greeting',
    description: 'A simple greeting node',
    props: [{ name: 'name', type: 'string', required: true, description: 'Name to greet' }],
    childTypes: [],
    kernExample: 'greeting name=World',
    expectedOutput: 'export const greetingWorld = "Hello, World!";',
    codegenSource: `
      module.exports = function(node, helpers) {
        var name = helpers.p(node).name;
        return ['export const greeting' + helpers.capitalize(name) + ' = "Hello, ' + name + '!";'];
      };
    `,
    reason: {
      observation: 'Found 5 greeting patterns',
      inefficiency: 'Each requires manual string construction',
      kernBenefit: 'One line of KERN replaces 3 lines of TS',
      frequency: 5,
      avgLines: 3,
      instances: ['src/greet.ts'],
    },
    codegenTier: 1,
    proposedAt: new Date().toISOString(),
    evolveRunId: 'test-run',
    ...overrides,
  };
}

afterEach(() => clearParserHints());

describe('Evolve v4 Validator', () => {
  describe('schema check', () => {
    it('passes for valid proposal', () => {
      const result = validateEvolveProposal(createProposal());
      expect(result.schemaOk).toBe(true);
    });

    it('fails for missing keyword', () => {
      const result = validateEvolveProposal(createProposal({ keyword: '' }));
      expect(result.schemaOk).toBe(false);
      expect(result.errors[0]).toContain('keyword');
    });

    it('fails for uppercase keyword', () => {
      const result = validateEvolveProposal(createProposal({ keyword: 'MyNode' }));
      expect(result.schemaOk).toBe(false);
      expect(result.errors[0]).toContain('lowercase');
    });

    it('fails for missing kernExample', () => {
      const result = validateEvolveProposal(createProposal({ kernExample: '' }));
      expect(result.schemaOk).toBe(false);
    });

    it('fails for missing codegenSource', () => {
      const result = validateEvolveProposal(createProposal({ codegenSource: '' }));
      expect(result.schemaOk).toBe(false);
    });
  });

  describe('keyword check', () => {
    it('rejects reserved core keywords', () => {
      const result = validateEvolveProposal(createProposal({ keyword: 'button', kernExample: 'button label="X"' }));
      expect(result.keywordOk).toBe(false);
      expect(result.errors.some(e => e.includes('reserved'))).toBe(true);
    });

    it('rejects already-graduated keywords', () => {
      const result = validateEvolveProposal(createProposal(), ['greeting']);
      expect(result.keywordOk).toBe(false);
      expect(result.errors.some(e => e.includes('already graduated'))).toBe(true);
    });
  });

  describe('parse check', () => {
    it('passes when kernExample parses correctly', () => {
      const result = validateEvolveProposal(createProposal());
      expect(result.parseOk).toBe(true);
    });

    it('fails when kernExample root type mismatches keyword', () => {
      const result = validateEvolveProposal(createProposal({
        keyword: 'my-node',
        kernExample: 'different-node name=X',
      }));
      expect(result.parseOk).toBe(false);
    });
  });

  describe('codegen compile', () => {
    it('passes for valid generator source', () => {
      const result = validateEvolveProposal(createProposal());
      expect(result.codegenCompileOk).toBe(true);
    });

    it('fails for invalid JS', () => {
      const result = validateEvolveProposal(createProposal({
        codegenSource: 'module.exports = function({{{{ broken',
      }));
      expect(result.codegenCompileOk).toBe(false);
    });
  });

  describe('codegen run', () => {
    it('passes when generator produces output', () => {
      const result = validateEvolveProposal(createProposal());
      expect(result.codegenRunOk).toBe(true);
    });

    it('fails when generator returns empty', () => {
      const result = validateEvolveProposal(createProposal({
        codegenSource: 'module.exports = function() { return []; };',
      }));
      expect(result.codegenRunOk).toBe(false);
    });
  });

  describe('golden diff', () => {
    it('passes when output matches expectedOutput', () => {
      const result = validateEvolveProposal(createProposal());
      expect(result.goldenDiffOk).toBe(true);
    });

    it('fails when output differs from expectedOutput', () => {
      const result = validateEvolveProposal(createProposal({
        expectedOutput: 'completely different output',
      }));
      expect(result.goldenDiffOk).toBe(false);
    });
  });

  describe('full pipeline', () => {
    it('all checks pass for a well-formed proposal', () => {
      const result = validateEvolveProposal(createProposal());
      expect(result.schemaOk).toBe(true);
      expect(result.keywordOk).toBe(true);
      expect(result.parseOk).toBe(true);
      expect(result.codegenCompileOk).toBe(true);
      expect(result.codegenRunOk).toBe(true);
      expect(result.typescriptOk).toBe(true);
      expect(result.goldenDiffOk).toBe(true);
      expect(result.dedupOk).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

describe('Dedup Checker', () => {
  it('passes for unique keywords', () => {
    expect(checkDedup(createProposal({ keyword: 'unique-node' }), ['cache', 'model'])).toBe(true);
  });

  it('fails for exact match', () => {
    expect(checkDedup(createProposal({ keyword: 'cache' }), ['cache', 'model'])).toBe(false);
  });

  it('fails for very similar keywords', () => {
    // "cache-x" vs "cache-y" = distance 1, maxLen 7, similarity 0.857 > 0.85
    expect(checkDedup(createProposal({ keyword: 'cache-x' }), ['cache-y'])).toBe(false);
  });

  it('passes for sufficiently different keywords', () => {
    expect(checkDedup(createProposal({ keyword: 'auth-guard' }), ['cache', 'model'])).toBe(true);
  });
});

describe('Golden Output Comparison', () => {
  it('matches identical strings', () => {
    expect(compareGoldenOutput('const x = 1;', 'const x = 1;')).toBe(true);
  });

  it('matches with whitespace differences', () => {
    expect(compareGoldenOutput(
      'const x = 1;\n  const y = 2;',
      'const x = 1;\nconst y = 2;',
    )).toBe(true);
  });

  it('matches with blank line differences', () => {
    expect(compareGoldenOutput(
      'line1\n\n\nline2',
      'line1\nline2',
    )).toBe(true);
  });

  it('fails for semantic differences', () => {
    expect(compareGoldenOutput('const x = 1;', 'const x = 2;')).toBe(false);
  });
});
