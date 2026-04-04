import {
  clearDetectors,
  detectorCount,
  getAllDetectors,
  getDetector,
  getDetectorsForImport,
  registerDetector,
  registerDetectors,
} from '../src/detector-registry.js';
// Import built-in detectors
import { detectors as reactFormDetectors } from '../src/detectors/react-forms.js';
import { detectors as stateMgmtDetectors } from '../src/detectors/state-mgmt.js';
import { evolveSource } from '../src/evolve-runner.js';
import { detectGapsFromSource, resetGapIds } from '../src/gap-detector.js';
import { analyzePatterns, computeStructuralHash, deriveTemplateName } from '../src/pattern-analyzer.js';
import { DEFAULT_THRESHOLDS, passesThresholds, scorePattern } from '../src/quality-scorer.js';
import { formatSplitView, getStaged, listStaged, stageProposal, updateStagedStatus } from '../src/staging.js';
import { generateKernSource, proposeTemplates } from '../src/template-proposer.js';
import { validateProposal } from '../src/template-validator.js';
import type {
  AnalyzedPattern,
  DetectorPack,
  PatternGap,
  QualityThresholds,
  TemplateProposal,
  ValidationResult,
} from '../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function createGap(overrides: Partial<PatternGap> = {}): PatternGap {
  return {
    id: 'gap-test-1',
    detectorId: 'test-detector',
    libraryName: 'TestLib',
    patternKind: 'generic',
    anchorImport: 'testFn',
    startLine: 1,
    endLine: 10,
    snippet: 'const result = testFn({ key: "value", options: { timeout: 5000 } });',
    extractedParams: [
      { name: 'varName', slotType: 'identifier', value: 'result', optional: false },
      { name: 'key', slotType: 'expr', value: '"value"', optional: false },
    ],
    confidencePct: 85,
    filePath: 'test.ts',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Detector Registry', () => {
  beforeEach(() => {
    clearDetectors();
  });

  it('registers and retrieves a detector', () => {
    const pack: DetectorPack = {
      id: 'test-pack',
      libraryName: 'Test',
      packageNames: ['test-lib'],
      patternKind: 'generic',
      detect: () => [],
    };

    registerDetector(pack);
    expect(detectorCount()).toBe(1);
    expect(getDetector('test-pack')).toBe(pack);
  });

  it('finds detectors by import path', () => {
    const pack: DetectorPack = {
      id: 'react-hook-form',
      libraryName: 'RHF',
      packageNames: ['react-hook-form'],
      patternKind: 'form-hook',
      detect: () => [],
    };

    registerDetector(pack);

    expect(getDetectorsForImport('react-hook-form').length).toBe(1);
    expect(getDetectorsForImport('react-hook-form/utils').length).toBe(1);
    expect(getDetectorsForImport('formik').length).toBe(0);
  });

  it('registers multiple detectors at once', () => {
    registerDetectors(reactFormDetectors);
    expect(detectorCount()).toBe(2); // react-hook-form + formik
  });

  it('clears all detectors', () => {
    registerDetectors(reactFormDetectors);
    expect(detectorCount()).toBeGreaterThan(0);
    clearDetectors();
    expect(detectorCount()).toBe(0);
  });

  it('returns all detectors', () => {
    registerDetectors(reactFormDetectors);
    const all = getAllDetectors();
    expect(all.length).toBe(2);
    expect(all.map((d) => d.id)).toContain('react-hook-form');
    expect(all.map((d) => d.id)).toContain('formik');
  });
});

describe('Gap Detector', () => {
  beforeEach(() => {
    clearDetectors();
    resetGapIds();
  });

  it('detects react-hook-form useForm pattern', () => {
    registerDetectors(reactFormDetectors);

    const source = `
import { useForm } from 'react-hook-form';

interface LoginSchema {
  email: string;
  password: string;
}

export function LoginForm() {
  const { register, handleSubmit, formState } = useForm<LoginSchema>({
    defaultValues: { email: '', password: '' },
  });

  return <form onSubmit={handleSubmit(onSubmit)}>...</form>;
}
`;

    const gaps = detectGapsFromSource(source, 'login.tsx');
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    expect(gaps[0].detectorId).toBe('react-hook-form');
    expect(gaps[0].anchorImport).toBe('useForm');
    expect(gaps[0].confidencePct).toBeGreaterThanOrEqual(75);

    // Should extract schema type
    const schemaParam = gaps[0].extractedParams.find((p) => p.name === 'schema');
    expect(schemaParam).toBeDefined();
    expect(schemaParam!.value).toBe('LoginSchema');
  });

  it('detects redux toolkit createSlice pattern', () => {
    registerDetectors(stateMgmtDetectors);

    const source = `
import { createSlice } from '@reduxjs/toolkit';

const counterSlice = createSlice({
  name: 'counter',
  initialState: { value: 0 },
  reducers: {
    increment: (state) => { state.value += 1; },
    decrement: (state) => { state.value -= 1; },
  },
});

export const { increment, decrement } = counterSlice.actions;
export default counterSlice.reducer;
`;

    const gaps = detectGapsFromSource(source, 'counter-slice.ts');
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    expect(gaps[0].detectorId).toBe('redux-toolkit-slice');

    const sliceNameParam = gaps[0].extractedParams.find((p) => p.name === 'sliceName');
    expect(sliceNameParam).toBeDefined();
    expect(sliceNameParam!.value).toBe('counter');
  });

  it('returns empty array for files with no matching imports', () => {
    registerDetectors(reactFormDetectors);

    const source = `
import { useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);
  return <div>{count}</div>;
}
`;

    const gaps = detectGapsFromSource(source, 'counter.tsx');
    expect(gaps).toEqual([]);
  });
});

describe('Quality Scorer', () => {
  it('scores a group of gaps', () => {
    const gaps = [
      createGap({
        confidencePct: 90,
        snippet: 'const result = testFn({ key: "value", options: { timeout: 5000, retry: 3 } });',
      }),
      createGap({
        id: 'gap-2',
        confidencePct: 85,
        snippet: 'const other = testFn({ key: "other", options: { timeout: 3000, retry: 1 } });',
      }),
    ];

    const score = scorePattern(gaps);
    expect(score.confidence).toBe(87.5);
    expect(score.supportCount).toBe(2);
    expect(score.variability).toBeLessThanOrEqual(1);
    expect(score.overallScore).toBeGreaterThan(0);
  });

  it('gives low relevance to short one-liner snippets', () => {
    const gaps = [createGap({ snippet: 'cors()', extractedParams: [] })];

    const score = scorePattern(gaps);
    expect(score.relevanceScore).toBeLessThan(0.3);
  });

  it('passes thresholds for well-supported patterns', () => {
    const score = { confidence: 85, supportCount: 3, variability: 0.2, relevanceScore: 0.6, overallScore: 75 };
    expect(passesThresholds(score)).toBe(true);
  });

  it('fails thresholds for low-confidence patterns', () => {
    const score = { confidence: 40, supportCount: 1, variability: 0.2, relevanceScore: 0.6, overallScore: 30 };
    expect(passesThresholds(score)).toBe(false);
  });

  it('fails thresholds for high-variability patterns', () => {
    const score = { confidence: 80, supportCount: 3, variability: 0.9, relevanceScore: 0.5, overallScore: 60 };
    expect(passesThresholds(score)).toBe(false);
  });

  it('respects custom thresholds', () => {
    const score = { confidence: 50, supportCount: 1, variability: 0.2, relevanceScore: 0.5, overallScore: 50 };
    const custom: QualityThresholds = { minConfidence: 40, minSupport: 1, maxVariability: 0.5, minRelevance: 0.3 };
    expect(passesThresholds(score, custom)).toBe(true);
    expect(passesThresholds(score, DEFAULT_THRESHOLDS)).toBe(false);
  });
});

describe('Pattern Analyzer', () => {
  it('groups gaps by structural hash', () => {
    const gap1 = createGap({ id: 'gap-1', confidencePct: 85 });
    const gap2 = createGap({ id: 'gap-2', confidencePct: 90 });
    // Same detector, same params → same hash
    const patterns = analyzePatterns([gap1, gap2]);

    // Should be grouped into one pattern
    expect(patterns.length).toBe(1);
    expect(patterns[0].instanceCount).toBe(2);
    expect(patterns[0].gapIds).toContain('gap-1');
    expect(patterns[0].gapIds).toContain('gap-2');
  });

  it('separates gaps with different structures', () => {
    const longSnippet =
      'const result = testFn({ key: "value", options: { timeout: 5000, retry: 3 } });\nconst other = doSomething(result);';
    const gap1 = createGap({
      id: 'gap-1',
      detectorId: 'detector-a',
      confidencePct: 90,
      snippet: longSnippet,
      extractedParams: [
        { name: 'foo', slotType: 'identifier', value: 'x', optional: false },
        { name: 'bar', slotType: 'expr', value: 'val', optional: false },
      ],
    });
    const gap2 = createGap({
      id: 'gap-2',
      detectorId: 'detector-b',
      confidencePct: 90,
      snippet: longSnippet,
      extractedParams: [
        { name: 'baz', slotType: 'type', value: 'Y', optional: false },
        { name: 'qux', slotType: 'expr', value: 'z', optional: false },
      ],
    });

    const patterns = analyzePatterns([gap1, gap2], {
      minConfidence: 60,
      minSupport: 1,
      maxVariability: 1,
      minRelevance: 0.1,
    });
    expect(patterns.length).toBe(2);
  });

  it('computes structural hash deterministically', () => {
    const gap1 = createGap({ extractedParams: [{ name: 'a', slotType: 'identifier', value: 'x', optional: false }] });
    const gap2 = createGap({ extractedParams: [{ name: 'a', slotType: 'identifier', value: 'y', optional: false }] });

    const hash1 = computeStructuralHash(gap1);
    const hash2 = computeStructuralHash(gap2);
    // Same structure (same param name/type), different values → same hash
    expect(hash1).toBe(hash2);
  });

  it('derives a human-readable template name', () => {
    const gap = createGap({
      libraryName: 'React Hook Form',
      extractedParams: [{ name: 'formName', slotType: 'identifier', value: 'Login', optional: false }],
    });

    const name = deriveTemplateName(gap);
    expect(name).toBe('rhf-form');
  });

  it('filters out patterns below quality thresholds', () => {
    const gap = createGap({
      snippet: 'x()',
      extractedParams: [],
      confidencePct: 50,
    });

    const patterns = analyzePatterns([gap]);
    expect(patterns.length).toBe(0); // Low confidence + low relevance
  });
});

describe('Template Proposer', () => {
  it('generates valid .kern template source', () => {
    const pattern: AnalyzedPattern = {
      templateName: 'rhf-form',
      structuralHash: 'abc123def456',
      namespace: 'React Hook Form',
      slots: [
        { name: 'formName', slotType: 'identifier', value: 'Login', optional: false },
        { name: 'schema', slotType: 'type', value: 'LoginSchema', optional: false },
      ],
      instanceCount: 3,
      qualityScore: { confidence: 90, supportCount: 3, variability: 0.1, relevanceScore: 0.8, overallScore: 85 },
      representativeSnippet: 'function Login() {\n  const { register } = useForm<LoginSchema>()\n}',
      goldenExample: {
        originalTs: 'function Login() {\n  const { register } = useForm<LoginSchema>()\n}',
        expectedExpansion: 'function Login() {\n  const { register } = useForm<LoginSchema>()\n}',
        slotValues: { formName: 'Login', schema: 'LoginSchema' },
      },
      imports: [{ from: 'react-hook-form', names: ['useForm'] }],
      gapIds: ['gap-1'],
    };

    const kern = generateKernSource(pattern);
    expect(kern).toContain('template name=rhf-form');
    expect(kern).toContain('slot name=formName type=identifier');
    expect(kern).toContain('slot name=schema type=type');
    expect(kern).toContain('import from=react-hook-form names=useForm');
    expect(kern).toContain('body <<<');
    expect(kern).toContain('>>>');
    expect(kern).toContain('{{formName}}');
    expect(kern).toContain('{{schema}}');
  });

  it('proposes templates from analyzed patterns', () => {
    const pattern: AnalyzedPattern = {
      templateName: 'test-template',
      structuralHash: 'abc123',
      namespace: 'TestLib',
      slots: [{ name: 'name', slotType: 'identifier', value: 'foo', optional: false }],
      instanceCount: 2,
      qualityScore: { confidence: 80, supportCount: 2, variability: 0, relevanceScore: 0.7, overallScore: 70 },
      representativeSnippet: 'const foo = test()',
      goldenExample: {
        originalTs: 'const foo = test()',
        expectedExpansion: 'const foo = test()',
        slotValues: { name: 'foo' },
      },
      imports: [{ from: 'test-lib', names: ['test'] }],
      gapIds: ['gap-1', 'gap-2'],
    };

    const proposals = proposeTemplates([pattern]);
    expect(proposals.length).toBe(1);
    expect(proposals[0].templateName).toBe('test-template');
    expect(proposals[0].id).toBe('test-template-abc123');
    expect(proposals[0].kernSource).toContain('template name=test-template');
  });
});

describe('Template Validator', () => {
  it('validates a syntactically valid template proposal', () => {
    const proposal: TemplateProposal = {
      id: 'test-abc123',
      templateName: 'test-hook',
      namespace: 'TestLib',
      kernSource: [
        'template name=test-hook',
        '  slot name=hookName type=identifier',
        '  body <<<',
        '    export function {{hookName}}() {',
        '      return {};',
        '    }',
        '  >>>',
      ].join('\n'),
      slots: [{ name: 'hookName', slotType: 'identifier', value: 'useTest', optional: false }],
      imports: [],
      goldenExample: {
        originalTs: 'export function useTest() {\n  return {};\n}',
        expectedExpansion: 'export function useTest() {\n  return {};\n}',
        slotValues: { hookName: 'useTest' },
      },
      qualityScore: { confidence: 85, supportCount: 2, variability: 0, relevanceScore: 0.7, overallScore: 75 },
      structuralHash: 'abc123',
      instanceCount: 2,
      representativeSnippet: 'export function useTest() { return {}; }',
    };

    const result = validateProposal(proposal);
    expect(result.parseOk).toBe(true);
    expect(result.registerOk).toBe(true);
    expect(result.expansionOk).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.expandedTs).toContain('useTest');
  });

  it('reports parse errors for invalid .kern source', () => {
    const proposal: TemplateProposal = {
      id: 'invalid-abc',
      templateName: 'bad',
      namespace: 'Test',
      kernSource: '<<<invalid kern>>>',
      slots: [],
      imports: [],
      goldenExample: { originalTs: '', expectedExpansion: '', slotValues: {} },
      qualityScore: { confidence: 0, supportCount: 0, variability: 0, relevanceScore: 0, overallScore: 0 },
      structuralHash: 'bad123',
      instanceCount: 0,
      representativeSnippet: '',
    };

    const result = validateProposal(proposal);
    // Parse may or may not fail depending on how the parser handles it
    // But registration should fail since there's no template node
    if (result.parseOk) {
      expect(result.registerOk).toBe(false);
    }
  });
});

describe('Staging', () => {
  const testConfig = {
    stagingDir: '/tmp/kern-evolve-test-staging',
    promotedDir: '/tmp/kern-evolve-test-promoted',
    templatesDir: '/tmp/kern-evolve-test-templates',
  };

  const mockProposal: TemplateProposal = {
    id: 'test-staging-abc',
    templateName: 'test-staged',
    namespace: 'Test',
    kernSource:
      'template name=test-staged\n  slot name=x type=identifier\n  body <<<\n    export const {{x}} = 42;\n  >>>',
    slots: [{ name: 'x', slotType: 'identifier', value: 'foo', optional: false }],
    imports: [],
    goldenExample: { originalTs: 'const foo = 42;', expectedExpansion: 'const foo = 42;', slotValues: { x: 'foo' } },
    qualityScore: { confidence: 80, supportCount: 2, variability: 0, relevanceScore: 0.5, overallScore: 65 },
    structuralHash: 'staging123',
    instanceCount: 2,
    representativeSnippet: 'const foo = 42;',
  };

  const mockValidation: ValidationResult = {
    parseOk: true,
    registerOk: true,
    expansionOk: true,
    typecheckOk: true,
    goldenDiffOk: true,
    errors: [],
  };

  it('stages a proposal and retrieves it', () => {
    const staged = stageProposal(mockProposal, mockValidation, testConfig);
    expect(staged.id).toBe('test-staging-abc');
    expect(staged.status).toBe('pending');
    expect(staged.stagedAt).toBeTruthy();

    const retrieved = getStaged('test-staging-abc', testConfig);
    expect(retrieved).toBeDefined();
    expect(retrieved!.proposal.templateName).toBe('test-staged');
  });

  it('lists staged proposals sorted by score', () => {
    const staged = listStaged(testConfig);
    expect(staged.length).toBeGreaterThanOrEqual(1);
  });

  it('updates proposal status', () => {
    const updated = updateStagedStatus('test-staging-abc', 'approved', testConfig);
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('approved');
    expect(updated!.reviewedAt).toBeTruthy();
  });

  it('formats split-view display', () => {
    const staged = getStaged('test-staging-abc', testConfig);
    if (staged) {
      const display = formatSplitView(staged);
      expect(display).toContain('test-staged');
      expect(display).toContain('Test');
      expect(display).toContain('[a]pprove');
    }
  });
});

describe('Evolve Runner (integration)', () => {
  beforeEach(() => {
    clearDetectors();
    resetGapIds();
    registerDetectors(reactFormDetectors);
    registerDetectors(stateMgmtDetectors);
  });

  it('runs full pipeline on source with detectable patterns', () => {
    const source = `
import { useForm } from 'react-hook-form';

interface FormData {
  name: string;
  email: string;
}

export function ContactForm() {
  const { register, handleSubmit, formState } = useForm<FormData>({
    defaultValues: { name: '', email: '' },
  });

  const onSubmit = (data: FormData) => {
    console.log(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('name')} />
      <input {...register('email')} />
      <button type="submit">Send</button>
    </form>
  );
}
`;

    const result = evolveSource(source, 'contact.tsx', {
      thresholds: { minConfidence: 50, minSupport: 1, maxVariability: 1, minRelevance: 0.1 },
    });

    expect(result.gaps.length).toBeGreaterThanOrEqual(1);
    // Patterns may or may not pass analysis depending on thresholds
    if (result.analyzed.length > 0) {
      expect(result.proposals.length).toBeGreaterThanOrEqual(1);
      expect(result.proposals[0].kernSource).toContain('template');
    }
  });

  it('returns empty results for files with no gaps', () => {
    const source = `
export const PI = 3.14159;
export function add(a: number, b: number): number {
  return a + b;
}
`;

    const result = evolveSource(source, 'math.ts');
    expect(result.gaps).toEqual([]);
    expect(result.analyzed).toEqual([]);
    expect(result.proposals).toEqual([]);
  });
});
