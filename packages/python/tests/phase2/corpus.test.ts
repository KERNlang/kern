/**
 * Phase-2 corpus self-test.
 *
 * Proves the corpus invariants the gates depend on:
 *   - ids are unique (a dup silently overwrites a snapshot);
 *   - every case's `expected` (when present) DECODES via `decodeExpected`
 *     (a malformed expected would make the gate throw mid-run);
 *   - `selectCases` filters by route and denominator correctly.
 */

import { decodeExpected, serializeEnvelope } from '../../../../scripts/phase2/lib/canonicalize.mjs';
import { assertUniqueIds, PHASE2_CORPUS, selectCases } from '../../../../scripts/phase2/lib/corpus.mjs';

describe('phase2 corpus invariants', () => {
  test('ids are unique', () => {
    expect(assertUniqueIds()).toBe(PHASE2_CORPUS.length);
  });

  test('every present expected decodes into an envelope (or is a non-executable parse-shape)', () => {
    for (const c of PHASE2_CORPUS) {
      if (c.expected === undefined) continue;
      // Parse-boundary rows carry a non-executable `expected` (e.g. {parseShape}).
      // Those are allowed to NOT decode; everything else must decode cleanly.
      const isParseShape =
        c.expected !== null &&
        typeof c.expected === 'object' &&
        !Array.isArray(c.expected) &&
        'parseShape' in (c.expected as object);
      if (isParseShape) continue;
      const { cv, calls } = decodeExpected(c.expected);
      const env = serializeEnvelope(cv, calls);
      expect(typeof env).toBe('string');
      expect(env.startsWith('{"version":1,"status":"ok"')).toBe(true);
    }
  });

  test('the NaN typed-local expected decodes to a tagged NaN, not null', () => {
    const c = PHASE2_CORPUS.find((x) => x.id === 'logical-nan-and-legacy-bug')!;
    const { cv } = decodeExpected(c.expected);
    expect(JSON.stringify(cv)).toBe('{"kind":"number","value":"NaN"}');
  });

  test('selectCases filters by route', () => {
    const logical = selectCases({ route: 'logical' });
    expect(logical.length > 0).toBe(true);
    expect(logical.every((c) => c.routes.includes('logical'))).toBe(true);
    const bitwise = selectCases({ route: 'bitwise' });
    expect(bitwise.every((c) => c.routes.includes('bitwise'))).toBe(true);
  });

  test('selectCases filters by denominator', () => {
    const expr = selectCases({ denominator: 'EXPRESSION' });
    expect(expr.every((c) => c.denominator === 'EXPRESSION')).toBe(true);
    expect(expr.length).toBe(PHASE2_CORPUS.length); // slice-0 corpus is all EXPRESSION
  });

  test('an unknown route selects zero cases (drives INT_EMPTY_SELECTION)', () => {
    expect(selectCases({ route: 'no-such-route' }).length).toBe(0);
  });

  test('the intentional divergence seed is present and tagged', () => {
    const seed = PHASE2_CORPUS.find((x) => x.id === 'logical-container-or-legacy-bug')!;
    expect(seed.source).toBe('a || b');
    expect(seed.expectedFirstCapture).toBe('LEGACY_BLOCKED');
    expect(seed.tags.includes('legacy-bug')).toBe(true);
  });
});
