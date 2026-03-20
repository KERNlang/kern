import {
  proposeNodes,
  deriveNodeName,
  generateKernSyntaxExample,
  generateCodegenStub,
  resetNodeProposalIds,
} from '../src/node-proposer.js';
import { governanceGate, getGovernanceThresholds } from '../src/node-governance.js';
import { validateNodeProposal } from '../src/node-validator.js';
import type { AnalyzedPattern, ExpressibilityScore, NodeProposal } from '../src/types.js';

function createPattern(overrides: Partial<AnalyzedPattern> = {}): AnalyzedPattern {
  return {
    templateName: 'structural-model',
    structuralHash: 'abc123',
    namespace: 'structural',
    slots: [],
    instanceCount: 5,
    qualityScore: {
      confidence: 80,
      supportCount: 5,
      variability: 0.2,
      relevanceScore: 90,
      overallScore: 75,
    },
    representativeSnippet: '@Entity() class User {}',
    goldenExample: { originalTs: '', expectedExpansion: '', slotValues: {} },
    imports: [],
    gapIds: ['gap-structural-model-1', 'gap-structural-model-2'],
    ...overrides,
  };
}

function createScore(overall: number): ExpressibilityScore {
  return { handlerEscapes: 4, nonStandardAttrs: 3, semanticLeaks: 2, overall };
}

describe('Node Proposer', () => {
  beforeEach(() => resetNodeProposalIds());

  describe('deriveNodeName', () => {
    it('derives model from structural-model pattern', () => {
      const name = deriveNodeName(createPattern({ templateName: 'structural-model' }));
      expect(name).toBe('model');
    });

    it('derives repository from structural-repository pattern', () => {
      const name = deriveNodeName(createPattern({
        templateName: 'structural-repository',
        gapIds: ['gap-structural-repository-1', 'gap-structural-repository-2'],
      }));
      expect(name).toBe('repository');
    });
  });

  describe('generateKernSyntaxExample', () => {
    it('generates model syntax', () => {
      const syntax = generateKernSyntaxExample('model', createPattern());
      expect(syntax).toContain('model name=Example');
      expect(syntax).toContain('column name=id');
    });

    it('generates cache syntax', () => {
      const syntax = generateKernSyntaxExample('cache', createPattern());
      expect(syntax).toContain('cache name=exampleCache');
      expect(syntax).toContain('entry name=item');
    });
  });

  describe('generateCodegenStub', () => {
    it('generates function with correct name', () => {
      const stub = generateCodegenStub('model', createPattern());
      expect(stub).toContain('function generateModel');
      expect(stub).toContain('IRNode');
    });
  });

  describe('proposeNodes', () => {
    it('creates proposals from patterns with scores', () => {
      const patterns = [createPattern()];
      const scores = new Map([['abc123', createScore(8.5)]]);
      const proposals = proposeNodes(patterns, scores);
      expect(proposals).toHaveLength(1);
      expect(proposals[0].nodeName).toBeDefined();
      expect(proposals[0].kernSyntax).toBeDefined();
      expect(proposals[0].codegenStub).toBeDefined();
    });

    it('skips patterns without scores', () => {
      const proposals = proposeNodes([createPattern()], new Map());
      expect(proposals).toHaveLength(0);
    });

    it('sorts by quality score descending', () => {
      const p1 = createPattern({ structuralHash: 'aaa', qualityScore: { confidence: 80, supportCount: 5, variability: 0.2, relevanceScore: 90, overallScore: 90 } });
      const p2 = createPattern({ structuralHash: 'bbb', qualityScore: { confidence: 80, supportCount: 5, variability: 0.2, relevanceScore: 90, overallScore: 60 } });
      const scores = new Map([
        ['aaa', createScore(8.0)],
        ['bbb', createScore(8.0)],
      ]);
      const proposals = proposeNodes([p1, p2], scores);
      expect(proposals[0].qualityScore).toBeGreaterThanOrEqual(proposals[1].qualityScore);
    });
  });
});

describe('Node Governance', () => {
  function createProposal(overrides: Partial<NodeProposal> = {}): NodeProposal {
    return {
      id: 'np-1',
      nodeName: 'model',
      kernSyntax: 'model name=X',
      codegenStub: 'function generateModel(node) {}',
      targetStubs: {},
      expressibilityScore: createScore(8.0),
      frequency: 5,
      qualityScore: 75,
      supportingGapIds: ['g1', 'g2', 'g3'],
      ...overrides,
    };
  }

  it('passes for well-evidenced proposals', () => {
    const result = governanceGate(createProposal());
    expect(result.pass).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('fails for low frequency', () => {
    const result = governanceGate(createProposal({ frequency: 1 }));
    expect(result.pass).toBe(false);
    expect(result.reasons.some(r => r.includes('frequency'))).toBe(true);
  });

  it('fails for low expressibility', () => {
    const result = governanceGate(createProposal({
      expressibilityScore: createScore(3.0),
    }));
    expect(result.pass).toBe(false);
    expect(result.reasons.some(r => r.includes('expressibility'))).toBe(true);
  });

  it('fails for low quality', () => {
    const result = governanceGate(createProposal({ qualityScore: 40 }));
    expect(result.pass).toBe(false);
    expect(result.reasons.some(r => r.includes('quality'))).toBe(true);
  });

  it('exposes thresholds', () => {
    const t = getGovernanceThresholds();
    expect(t.minFrequency).toBe(3);
    expect(t.minExpressibility).toBe(7.0);
  });
});

describe('Node Validator', () => {
  function createProposal(overrides: Partial<NodeProposal> = {}): NodeProposal {
    return {
      id: 'np-1',
      nodeName: 'model',
      kernSyntax: 'model name=Example\n  column name=id type=uuid',
      codegenStub: 'export function generateModel(node: IRNode): string[] { return []; }',
      targetStubs: {},
      expressibilityScore: createScore(8.0),
      frequency: 5,
      qualityScore: 75,
      supportingGapIds: [],
      ...overrides,
    };
  }

  it('validates well-formed proposal', () => {
    const result = validateNodeProposal(createProposal());
    expect(result.parseOk).toBe(true);
    expect(result.codegenOk).toBe(true);
    expect(result.targetCoverage).toBe(11);
    expect(result.errors).toHaveLength(0);
  });

  it('fails on empty KERN syntax', () => {
    const result = validateNodeProposal(createProposal({ kernSyntax: '' }));
    expect(result.parseOk).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('fails on empty codegen stub', () => {
    const result = validateNodeProposal(createProposal({ codegenStub: '' }));
    expect(result.codegenOk).toBe(false);
  });

  it('fails when codegen stub lacks function definition', () => {
    const result = validateNodeProposal(createProposal({
      codegenStub: 'const x = 1;',
    }));
    expect(result.codegenOk).toBe(false);
  });
});
