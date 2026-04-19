/**
 * Real-kern pattern regressions for gap categorization.
 *
 * Each fixture models a shape observed in the biggest kern-using repos
 * (AudioFacets, Agon). The fixture pins the categorization the compiler
 * emits so future changes to the classifier, or the IR, can't silently
 * regress category accuracy and re-introduce noise in `kern gaps`.
 *
 * If any of these expectations change intentionally, update the fixture
 * *and* the Agon/AudioFacets docs at the same time; those two repos are
 * the ground truth for what kern gaps ought to say.
 */

import { collectCoverageGaps } from '../src/coverage-gap.js';
import { parse } from '../src/parser.js';

function classifyOne(source: string): {
  category: string | undefined;
  migration: string | undefined;
  parentType: string | undefined;
} {
  const ast = parse(source);
  const gaps = collectCoverageGaps(ast, 'fixture.kern');
  const gap = gaps[0];
  return {
    category: gap?.category,
    migration: gap?.migration,
    parentType: gap?.parentType,
  };
}

describe('AudioFacets-style patterns', () => {
  it('tags a single-line numeric timeout constant as migratable via literal-const', () => {
    // Pattern sourced from audiofacets constants files:
    //   const name=MAX_RETRIES type=number
    //     handler <<<
    //       3
    //     >>>
    const source = ['const name=MAX_RETRIES type=number', '  handler <<<', '    3', '  >>>'].join('\n');
    expect(classifyOne(source)).toEqual({
      category: 'migratable',
      migration: 'literal-const',
      parentType: 'const',
    });
  });

  it('tags a single-line string constant as migratable via literal-const (value={{ expr }} form)', () => {
    const source = ['const name=API_BASE type=string', '  handler <<<', '    "https://api.example.com"', '  >>>'].join(
      '\n',
    );
    expect(classifyOne(source)).toEqual({
      category: 'migratable',
      migration: 'literal-const',
      parentType: 'const',
    });
  });

  it('tags a multi-line IPC handler body as detected; no single-line rewrite applies', () => {
    // Pattern sourced from audiofacets ipc/handlers: a real piece of logic
    // wrapped in handler <<< ... >>>. These are the gaps that genuinely need
    // migration design work, and they should not be reported as "run kern
    // migrate" (the rewriters can't touch them).
    const source = [
      'route IPC audio:load',
      '  handler <<<',
      '    const track = await db.loadTrack(id);',
      '    return { track };',
      '  >>>',
    ].join('\n');
    const { category, migration, parentType } = classifyOne(source);
    expect(category).toBe('detected');
    expect(migration).toBeUndefined();
    expect(parentType).toBe('route');
  });
});

describe('Agon-style patterns', () => {
  it('tags a single-line fn handler as migratable via fn-expr', () => {
    // Pattern from agon packages/core: tiny pure helpers often live under
    // an `fn` node with a one-line body.
    const source = ['fn name=identity', '  handler <<<', '    return x;', '  >>>'].join('\n');
    expect(classifyOne(source)).toEqual({
      category: 'migratable',
      migration: 'fn-expr',
      parentType: 'fn',
    });
  });

  it('tags a multi-line fn handler as detected', () => {
    const source = [
      'fn name=process',
      '  handler <<<',
      '    const next = apply(x);',
      '    return next.value;',
      '  >>>',
    ].join('\n');
    const { category, migration } = classifyOne(source);
    expect(category).toBe('detected');
    expect(migration).toBeUndefined();
  });

  it('never tags a route handler as migratable; no rewriter targets routes', () => {
    const source = ['route GET /health', '  handler <<<', '    return { ok: true };', '  >>>'].join('\n');
    const { category, migration } = classifyOne(source);
    expect(category).toBe('detected');
    expect(migration).toBeUndefined();
  });
});

describe('Edge cases that must not be mis-tagged migratable', () => {
  it('refuses a body containing `}}`; would break expr-block wrapper', () => {
    const source = ['const name=BROKEN', '  handler <<<', '    foo}}bar', '  >>>'].join('\n');
    const { category } = classifyOne(source);
    expect(category).toBe('detected');
  });

  it('refuses an empty handler (should not emit a gap at all)', () => {
    const ast = parse('const name=NONE\n  handler <<<>>>');
    const gaps = collectCoverageGaps(ast, 'fixture.kern');
    expect(gaps).toHaveLength(0);
  });

  it('covers ALL declared GapCategory values via reachable code paths', () => {
    // Pin the invariant that the emitter currently only produces `detected`
    // and `migratable`. The other three categories (`blocked-by-parser`,
    // `blocked-by-codegen`, `needs-new-node`) are declared in the union for
    // future emitters. If a future change starts producing them from this
    // path, this assertion will flag it so the test suite can be updated
    // deliberately.
    const samples = [
      ['const name=A type=number', '  handler <<<', '    1', '  >>>'].join('\n'),
      ['fn name=f', '  handler <<<', '    return 1;', '  >>>'].join('\n'),
      ['route GET /', '  handler <<<', '    return null;', '  >>>'].join('\n'),
      ['const name=M', '  handler <<<', '    {', '      a: 1,', '    }', '  >>>'].join('\n'),
    ];
    const seen = new Set<string>();
    for (const src of samples) {
      const gaps = collectCoverageGaps(parse(src), 'f.kern');
      for (const g of gaps) seen.add(g.category ?? 'detected');
    }
    expect([...seen].sort()).toEqual(['detected', 'migratable']);
  });
});
