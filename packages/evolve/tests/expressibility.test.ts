import {
  scoreExpressibility,
  isNodeCandidate,
  EXPRESSIBILITY_NODE_THRESHOLD,
} from '../src/expressibility-scorer.js';
import type { PatternGap } from '../src/types.js';

function createGap(snippet: string): PatternGap {
  return {
    id: 'gap-1',
    detectorId: 'test',
    libraryName: 'structural',
    patternKind: 'structural',
    anchorImport: '',
    startLine: 1,
    endLine: 5,
    snippet,
    extractedParams: [],
    confidencePct: 80,
    filePath: 'test.ts',
  };
}

describe('Expressibility Scorer', () => {
  it('scores low when no escapes or leaks', () => {
    const score = scoreExpressibility(
      [createGap('button label="Click"')],
      ['button label="Click"'],
    );
    expect(score.overall).toBeLessThan(3);
    expect(score.handlerEscapes).toBe(0);
  });

  it('scores high with many handler escapes', () => {
    const snippets = [
      'handler <<<return db.query("SELECT * FROM users");>>>',
      'handler <<<const data = await fetch(url);>>>',
      'handler <<<return cache.get(key);>>>',
      'handler <<<return repo.findAll();>>>',
      'handler <<<return service.process(input);>>>',
    ];
    const score = scoreExpressibility(
      snippets.map(s => createGap(s)),
      snippets,
    );
    expect(score.handlerEscapes).toBeGreaterThan(3);
    expect(score.overall).toBeGreaterThan(4);
  });

  it('counts non-standard attributes', () => {
    const snippets = [
      'model name=User backend=postgres sharding=true replication=async partitionKey=id',
    ];
    const score = scoreExpressibility([], snippets);
    expect(score.nonStandardAttrs).toBeGreaterThan(0);
  });

  it('counts semantic leaks ({{ expressions }})', () => {
    const snippets = [
      'derive x expr={{items.filter(i => i.active)}}',
      'derive y expr={{users.map(u => u.name)}}',
      'derive z expr={{total * rate}}',
    ];
    const score = scoreExpressibility(
      snippets.map(s => createGap(s)),
      snippets,
    );
    expect(score.semanticLeaks).toBeGreaterThan(0);
  });

  it('threshold is 7.0', () => {
    expect(EXPRESSIBILITY_NODE_THRESHOLD).toBe(7.0);
  });

  it('isNodeCandidate returns true above threshold', () => {
    expect(isNodeCandidate({ handlerEscapes: 10, nonStandardAttrs: 8, semanticLeaks: 6, overall: 8.5 })).toBe(true);
  });

  it('isNodeCandidate returns false below threshold', () => {
    expect(isNodeCandidate({ handlerEscapes: 1, nonStandardAttrs: 0, semanticLeaks: 0, overall: 3.0 })).toBe(false);
  });

  it('isNodeCandidate returns false at exactly threshold', () => {
    expect(isNodeCandidate({ handlerEscapes: 3, nonStandardAttrs: 4, semanticLeaks: 2, overall: 7.0 })).toBe(false);
  });
});
