import { resetConceptGapIds } from '../src/concept-gap-adapter.js';
import { clearDetectors } from '../src/detector-registry.js';
import { evolveSource } from '../src/evolve-runner.js';
import { detectGapsFromSource, resetGapIds } from '../src/gap-detector.js';
import { analyzePatterns } from '../src/pattern-analyzer.js';

// ── Helpers ──────────────────────────────────────────────────────────────

beforeEach(() => {
  clearDetectors();
  resetGapIds();
  resetConceptGapIds();
});

// ── Concept Gap Detection ────────────────────────────────────────────────

describe('Concept-Based Gap Detection', () => {
  it('detects unguarded fetch() as a concept gap', () => {
    const source = `
export async function loadData() {
  const res = await fetch('/api/data');
  return res.json();
}
`;
    const gaps = detectGapsFromSource(source, 'handler.ts');
    const conceptGaps = gaps.filter((g) => g.libraryName === 'structural');

    // Should find at least one structural gap (unguarded-effect or unrecovered-effect)
    expect(conceptGaps.length).toBeGreaterThan(0);
    expect(conceptGaps.every((g) => g.patternKind === 'structural')).toBe(true);
    expect(conceptGaps.every((g) => g.detectorId.startsWith('concept-'))).toBe(true);
  });

  it('does not flag fetch() inside try/catch with proper error handling', () => {
    const source = `
export async function loadData() {
  try {
    const res = await fetch('/api/data');
    return res.json();
  } catch (err) {
    console.error('Failed to load data:', err);
    throw err;
  }
}
`;
    const gaps = detectGapsFromSource(source, 'handler.ts');
    const ignoredErrors = gaps.filter((g) => g.detectorId === 'concept-ignored-error');

    // Properly handled catch block should not produce ignored-error
    expect(ignoredErrors.length).toBe(0);
  });

  it('detects ignored catch block as concept gap', () => {
    // Fixture has NO intent comment inside the empty catch. The concept mapper
    // exempts empty catches that carry an author comment as `wrapped`
    // (documented intent) rather than `ignored`, so the fixture must avoid
    // any comment to trigger the ignored-error rule.
    const source = `
export async function loadData() {
  try {
    const res = await fetch('/api/data');
    return res.json();
  } catch (e) {
  }
}
`;
    const gaps = detectGapsFromSource(source, 'handler.ts');
    const ignoredErrors = gaps.filter((g) => g.detectorId === 'concept-ignored-error');

    expect(ignoredErrors.length).toBeGreaterThan(0);
    expect(ignoredErrors[0].confidencePct).toBeGreaterThan(0);
    expect(ignoredErrors[0].filePath).toBe('handler.ts');
  });

  it('concept gaps have correct PatternGap shape', () => {
    const source = `
export async function handler() {
  const res = await fetch('/api/data');
  return res.json();
}
`;
    const gaps = detectGapsFromSource(source, 'test.ts');
    const conceptGaps = gaps.filter((g) => g.libraryName === 'structural');

    for (const gap of conceptGaps) {
      expect(gap.id).toMatch(/^concept-gap-/);
      expect(gap.detectorId).toMatch(/^concept-/);
      expect(gap.libraryName).toBe('structural');
      expect(gap.patternKind).toBe('structural');
      expect(gap.anchorImport).toBe('');
      expect(typeof gap.startLine).toBe('number');
      expect(typeof gap.endLine).toBe('number');
      expect(typeof gap.confidencePct).toBe('number');
      expect(gap.extractedParams).toEqual([]);
    }
  });

  it('structural gaps are filtered from template proposal candidates', () => {
    const source = `
export async function handler() {
  const res = await fetch('/api/data');
  return res.json();
}
`;
    const gaps = detectGapsFromSource(source, 'test.ts');
    const conceptGaps = gaps.filter((g) => g.libraryName === 'structural');

    // Concept gaps should exist
    expect(conceptGaps.length).toBeGreaterThan(0);

    // But they should NOT produce analyzed patterns (template proposals)
    const analyzed = analyzePatterns(gaps);
    const structuralPatterns = analyzed.filter((p) => p.namespace === 'structural');
    expect(structuralPatterns.length).toBe(0);
  });

  it('evolveSource includes conceptSummary', () => {
    const source = `
export async function handler() {
  const res = await fetch('/api/data');
  return res.json();
}
`;
    const result = evolveSource(source, 'test.ts');
    const conceptGaps = result.gaps.filter((g) => g.libraryName === 'structural');

    if (conceptGaps.length > 0) {
      expect(result.conceptSummary).toBeDefined();
      expect(result.conceptSummary!.total).toBe(conceptGaps.length);
      expect(result.conceptSummary!.formatted).toMatch(/^Structural gaps: \d+/);
    }
  });
});
