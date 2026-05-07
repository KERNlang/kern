import {
  emitLowConfidenceTodo,
  emitReasonAnnotations,
  generateAction,
  generateApply,
  generateAssume,
  generateBranch,
  generateCollect,
  generateCoreNode,
  generateDerive,
  generateEach,
  generateExpect,
  generateGuard,
  generateInvariant,
  generatePattern,
  generateRecover,
  generateResolve,
  generateTransform,
  isCoreNode,
} from '../src/codegen-core.js';
import { KernCodegenError } from '../src/errors.js';
import { parse } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Parse a .kern snippet and generate code for the root node. */
function _gen(source: string): string {
  const root = parse(source);
  return generateCoreNode(root).join('\n');
}

/** Parse and generate code for the first child node. */
function _genChild(source: string): string {
  const root = parse(source);
  const child = root.children?.[0];
  if (!child) return '';
  return generateCoreNode(child).join('\n');
}

/** Create a minimal IRNode for direct generator testing. */
function makeNode(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

// ==========================================================================
// Phase 1 — derive, transform, action, guard + reason stub
// ==========================================================================

describe('Ground Layer: derive', () => {
  it('generates basic const from expr', () => {
    const node = makeNode('derive', { name: 'loudness', expr: 'average(stems)' });
    const code = generateDerive(node).join('\n');
    expect(code).toContain('export const loudness = average(stems);');
  });

  it('includes type annotation', () => {
    const node = makeNode('derive', { name: 'loudness', expr: 'average(stems)', type: 'number' });
    const code = generateDerive(node).join('\n');
    expect(code).toContain('export const loudness: number = average(stems);');
  });

  it('respects deps prop (present but no effect in core TS)', () => {
    const node = makeNode('derive', { name: 'loudness', expr: 'average(stems)', deps: 'stems' });
    const code = generateDerive(node).join('\n');
    expect(code).toContain('export const loudness = average(stems);');
  });

  it('respects export=false', () => {
    const node = makeNode('derive', { name: 'internal', expr: '42', export: 'false' });
    const code = generateDerive(node).join('\n');
    expect(code).not.toContain('export');
    expect(code).toContain('const internal = 42;');
  });
});

describe('Ground Layer: transform', () => {
  it('generates simple transform with via', () => {
    const node = makeNode('transform', { name: 'limitStems', target: 'track.stems', via: 'limit(4)', type: 'Stem[]' });
    const code = generateTransform(node).join('\n');
    expect(code).toContain('export const limitStems: Stem[]');
    expect(code).toContain('limit(track.stems, 4)');
  });

  it('generates function form with handler', () => {
    const node = makeNode('transform', { name: 'normalize' }, [makeNode('handler', { code: 'return state * 2;' })]);
    const code = generateTransform(node).join('\n');
    expect(code).toContain('export function normalize(state: unknown)');
    expect(code).toContain('return state * 2;');
  });

  it('includes type annotation', () => {
    const node = makeNode('transform', { name: 'x', via: 'fn()', type: 'number' });
    const code = generateTransform(node).join('\n');
    expect(code).toContain('const x: number = fn();');
  });

  it('handles via without target', () => {
    const node = makeNode('transform', { name: 'result', via: 'compute()' });
    const code = generateTransform(node).join('\n');
    expect(code).toContain('const result = compute();');
  });
});

describe('Ground Layer: action', () => {
  it('generates async function', () => {
    const node = makeNode('action', { name: 'notifyOwner' });
    const code = generateAction(node).join('\n');
    expect(code).toContain('export async function notifyOwner(): Promise<void>');
  });

  it('includes idempotent JSDoc', () => {
    const node = makeNode('action', { name: 'send', idempotent: 'true' });
    const code = generateAction(node).join('\n');
    expect(code).toContain('@action idempotent=true');
  });

  it('includes reversible JSDoc', () => {
    const node = makeNode('action', { name: 'delete', reversible: 'true' });
    const code = generateAction(node).join('\n');
    expect(code).toContain('@action reversible=true');
  });

  it('generates with handler code', () => {
    const node = makeNode('action', { name: 'notify' }, [
      makeNode('handler', { code: "await email.send(track.owner, 'processed');" }),
    ]);
    const code = generateAction(node).join('\n');
    expect(code).toContain("await email.send(track.owner, 'processed');");
  });
});

describe('Ground Layer: guard', () => {
  it('generates with numeric else code', () => {
    const node = makeNode('guard', { name: 'published', expr: 'track.status == "published"', else: '403' });
    const code = generateGuard(node).join('\n');
    expect(code).toContain('if (!(track.status == "published"))');
    expect(code).toContain('HttpError(403');
  });

  it('generates with string else code', () => {
    const node = makeNode('guard', { name: 'auth', expr: 'user.authenticated', else: 'redirect("/login")' });
    const code = generateGuard(node).join('\n');
    expect(code).toContain('redirect("/login")');
  });

  it('generates with named guard', () => {
    const node = makeNode('guard', { name: 'owner', expr: 'isOwner' });
    const code = generateGuard(node).join('\n');
    expect(code).toContain("throw new Error('Guard failed: owner')");
  });

  it('handles missing else with default Error throw', () => {
    const node = makeNode('guard', { name: 'check', expr: 'valid' });
    const code = generateGuard(node).join('\n');
    expect(code).toContain("throw new Error('Guard failed: check')");
  });
});

// ==========================================================================
// Phase 2 — assume, invariant, each, collect
// ==========================================================================

describe('Ground Layer: assume', () => {
  it('generates dev-only assertion', () => {
    const node = makeNode('assume', {
      expr: 'track.owner == auth.user',
      scope: 'request',
      evidence: 'route-signing',
      fallback: 'throw AuthError()',
    });
    const code = generateAssume(node).join('\n');
    expect(code).toContain("process.env.NODE_ENV !== 'production'");
    expect(code).toContain('if (!(track.owner == auth.user))');
    expect(code).toContain('throw AuthError()');
  });

  it('throws on missing evidence', () => {
    const node = makeNode('assume', { expr: 'true', fallback: 'throw Error()' });
    expect(() => generateAssume(node)).toThrow(KernCodegenError);
    expect(() => generateAssume(node)).toThrow('evidence');
  });

  it('throws on missing fallback', () => {
    const node = makeNode('assume', { expr: 'true', evidence: 'test' });
    expect(() => generateAssume(node)).toThrow(KernCodegenError);
    expect(() => generateAssume(node)).toThrow('fallback');
  });

  it('includes scope and evidence in JSDoc', () => {
    const node = makeNode('assume', {
      expr: 'x',
      scope: 'session',
      evidence: 'jwt',
      fallback: 'throw Error()',
    });
    const code = generateAssume(node).join('\n');
    expect(code).toContain('@scope session');
    expect(code).toContain('@evidence jwt');
  });
});

describe('Ground Layer: invariant', () => {
  it('generates console.assert', () => {
    const node = makeNode('invariant', { name: 'stemLimit', expr: 'visible_stems <= max_stems' });
    const code = generateInvariant(node).join('\n');
    expect(code).toContain("console.assert(visible_stems <= max_stems, 'Invariant: stemLimit')");
  });

  it('uses default name when unnamed', () => {
    const node = makeNode('invariant', { expr: 'x > 0' });
    const code = generateInvariant(node).join('\n');
    expect(code).toContain("'Invariant: invariant'");
  });

  it('generates named invariant', () => {
    const node = makeNode('invariant', { name: 'positive', expr: 'count >= 0' });
    const code = generateInvariant(node).join('\n');
    expect(code).toContain("'Invariant: positive'");
  });
});

describe('Ground Layer: each', () => {
  it('generates for..of loop', () => {
    const node = makeNode('each', { name: 'stem', in: 'track.stems' });
    const code = generateEach(node).join('\n');
    expect(code).toContain('for (const stem of track.stems)');
  });

  it('supports index parameter', () => {
    const node = makeNode('each', { name: 'stem', in: 'track.stems', index: 'i' });
    const code = generateEach(node).join('\n');
    expect(code).toContain('for (const [i, stem] of (track.stems).entries())');
  });

  it('generates children inside loop', () => {
    const node = makeNode('each', { name: 'stem', in: 'track.stems' }, [
      makeNode('derive', { name: 'normalized', expr: 'normalize(stem.amplitude)' }),
    ]);
    const code = generateEach(node).join('\n');
    expect(code).toContain('for (const stem of track.stems)');
    expect(code).toContain('const normalized = normalize(stem.amplitude)');
  });

  it('dispatches correctly via generateCoreNode', () => {
    const node = makeNode('each', { name: 'item', in: 'list' });
    const code = generateCoreNode(node).join('\n');
    expect(code).toContain('for (const item of list)');
  });
});

describe('Ground Layer: collect', () => {
  it('generates filter from where clause', () => {
    const node = makeNode('collect', { name: 'loud', from: 'stems', where: 'item.loudness > 0.5' });
    const code = generateCollect(node).join('\n');
    expect(code).toContain('stems.filter(item => item.loudness > 0.5)');
  });

  it('generates with limit', () => {
    const node = makeNode('collect', { name: 'top', from: 'items', limit: '10' });
    const code = generateCollect(node).join('\n');
    expect(code).toContain('items.slice(0, 10)');
  });

  it('generates with where + limit', () => {
    const node = makeNode('collect', { name: 'result', from: 'items', where: 'item.active', limit: '5' });
    const code = generateCollect(node).join('\n');
    expect(code).toContain('.filter(item => item.active).slice(0, 5)');
  });

  it('generates with order', () => {
    const node = makeNode('collect', { name: 'sorted', from: 'items', order: 'a.score - b.score' });
    const code = generateCollect(node).join('\n');
    expect(code).toContain('.sort((a, b) => a.score - b.score)');
  });
});

// ==========================================================================
// Phase 3 — branch, resolve, pattern/apply
// ==========================================================================

describe('Ground Layer: branch', () => {
  // 2026-05-06 — top-level `branch` codegen distinguishes string vs identifier
  // case values via the `__quotedProps` IR marker (matches body-ts.ts and the
  // parser convention). Hand-built IR for these tests therefore sets
  // `__quotedProps: ['value']` to opt into string-literal emission. Without
  // that marker the emitter treats `value=` as an unquoted identifier.
  it('generates switch statement', () => {
    const node = makeNode('branch', { name: 'tierRoute', on: 'user.tier' }, [
      {
        ...makeNode('path', { value: 'free' }, [makeNode('derive', { name: 'maxStems', expr: '4', type: 'number' })]),
        __quotedProps: ['value'],
      },
      {
        ...makeNode('path', { value: 'pro' }, [
          makeNode('derive', { name: 'maxStems', expr: 'Infinity', type: 'number' }),
        ]),
        __quotedProps: ['value'],
      },
    ]);
    const code = generateBranch(node).join('\n');
    expect(code).toContain('switch (user.tier)');
    // Codex final-review fix landed JSON.stringify quoting → double-quotes
    // for safety (apostrophes/backslashes survive). Use a regex tolerant of
    // either quote style so the test focuses on the case-emit semantic
    // rather than the JSON-stringify policy detail.
    expect(code).toMatch(/case ['"]free['"]:/);
    expect(code).toMatch(/case ['"]pro['"]:/);
    expect(code).toContain('const maxStems: number = 4');
  });

  it('includes branch name as comment', () => {
    const node = makeNode('branch', { name: 'test', on: 'x' }, []);
    const code = generateBranch(node).join('\n');
    expect(code).toContain('/** branch: test */');
  });

  it('handles multi-path', () => {
    const node = makeNode('branch', { name: 'b', on: 'v' }, [
      { ...makeNode('path', { value: 'a' }), __quotedProps: ['value'] },
      { ...makeNode('path', { value: 'b' }), __quotedProps: ['value'] },
      { ...makeNode('path', { value: 'c' }), __quotedProps: ['value'] },
    ]);
    const code = generateBranch(node).join('\n');
    expect(code).toMatch(/case ['"]a['"]:/);
    expect(code).toMatch(/case ['"]b['"]:/);
    expect(code).toMatch(/case ['"]c['"]:/);
  });

  it('handles empty path (no children)', () => {
    const node = makeNode('branch', { name: 'empty', on: 'x' }, [
      { ...makeNode('path', { value: 'empty' }), __quotedProps: ['value'] },
    ]);
    const code = generateBranch(node).join('\n');
    expect(code).toMatch(/case ['"]empty['"]:/);
    expect(code).toContain('break;');
  });

  it('emits unquoted identifier for path without __quotedProps (e.g. `path value=Status.Active`)', () => {
    const node = makeNode('branch', { name: 'r', on: 'status' }, [
      makeNode('path', { value: 'Status.Active' }), // no __quotedProps → identifier
    ]);
    const code = generateBranch(node).join('\n');
    expect(code).toContain('case Status.Active:');
    expect(code).not.toContain('"Status.Active"');
  });

  it('emits `default:` clause for path default=true', () => {
    const node = makeNode('branch', { name: 'r', on: 'x' }, [
      { ...makeNode('path', { value: 'a' }), __quotedProps: ['value'] },
      makeNode('path', { default: true }), // trailing default fallback
    ]);
    const code = generateBranch(node).join('\n');
    expect(code).toMatch(/case ['"]a['"]:/);
    expect(code).toContain('default: {');
  });
});

describe('Ground Layer: resolve', () => {
  it('generates candidates array + resolver function', () => {
    const node = makeNode('resolve', { name: 'normStrategy' }, [
      makeNode('candidate', { name: 'aggressive' }, [
        makeNode('handler', { code: 'return aggressiveNormalize(signal);' }),
      ]),
      makeNode('candidate', { name: 'conservative' }, [
        makeNode('handler', { code: 'return conservativeNormalize(signal);' }),
      ]),
      makeNode('discriminator', { method: 'benchmark', metric: 'snr' }, [
        makeNode('handler', { code: 'const winnerIdx = 0;' }),
      ]),
    ]);
    const code = generateResolve(node).join('\n');
    expect(code).toContain('_normStrategy_candidates');
    expect(code).toContain("name: 'aggressive'");
    expect(code).toContain("name: 'conservative'");
    expect(code).toContain('async function resolveNormStrategy');
    expect(code).toContain('discriminator: benchmark(snr)');
  });

  it('throws without discriminator', () => {
    const node = makeNode('resolve', { name: 'bad' }, [makeNode('candidate', { name: 'only' })]);
    expect(() => generateResolve(node)).toThrow(KernCodegenError);
    expect(() => generateResolve(node)).toThrow('discriminator');
  });

  it('handles 2 candidates', () => {
    const node = makeNode('resolve', { name: 'pick' }, [
      makeNode('candidate', { name: 'a' }, [makeNode('handler', { code: 'return a();' })]),
      makeNode('candidate', { name: 'b' }, [makeNode('handler', { code: 'return b();' })]),
      makeNode('discriminator', { method: 'select' }, [makeNode('handler', { code: 'const winnerIdx = 0;' })]),
    ]);
    const code = generateResolve(node).join('\n');
    expect(code).toContain("name: 'a'");
    expect(code).toContain("name: 'b'");
  });

  it('handles 3 candidates', () => {
    const node = makeNode('resolve', { name: 'tri' }, [
      makeNode('candidate', { name: 'a' }, [makeNode('handler', { code: 'return 1;' })]),
      makeNode('candidate', { name: 'b' }, [makeNode('handler', { code: 'return 2;' })]),
      makeNode('candidate', { name: 'c' }, [makeNode('handler', { code: 'return 3;' })]),
      makeNode('discriminator', { method: 'vote' }, [makeNode('handler', { code: 'const winnerIdx = 0;' })]),
    ]);
    const code = generateResolve(node).join('\n');
    expect(code).toContain("name: 'a'");
    expect(code).toContain("name: 'b'");
    expect(code).toContain("name: 'c'");
  });

  it('generates async resolver', () => {
    const node = makeNode('resolve', { name: 'strat' }, [
      makeNode('candidate', { name: 'x' }, [makeNode('handler', { code: 'return x();' })]),
      makeNode('discriminator', {}, [makeNode('handler', { code: 'const winnerIdx = 0;' })]),
    ]);
    const code = generateResolve(node).join('\n');
    expect(code).toContain('async function resolveStrat');
  });

  it('includes discriminator method in comment', () => {
    const node = makeNode('resolve', { name: 's' }, [
      makeNode('candidate', { name: 'x' }, [makeNode('handler', { code: 'return 1;' })]),
      makeNode('discriminator', { method: 'benchmark', metric: 'latency' }, [
        makeNode('handler', { code: 'const winnerIdx = 0;' }),
      ]),
    ]);
    const code = generateResolve(node).join('\n');
    expect(code).toContain('benchmark(latency)');
  });
});

describe('Ground Layer: pattern/apply', () => {
  it('pattern generates no output', () => {
    const node = makeNode('pattern', { name: 'guardedRoute' });
    const code = generatePattern(node).join('\n');
    expect(code).toBe('');
  });

  it('apply without registered pattern emits comment', () => {
    const node = makeNode('apply', { pattern: 'unknownPattern' });
    const code = generateApply(node).join('\n');
    expect(code).toContain("pattern 'unknownPattern' not found");
  });
});

// ==========================================================================
// Phase 4 — expect, recover
// ==========================================================================

describe('Ground Layer: expect', () => {
  it('generates within-range assertion', () => {
    const node = makeNode('expect', { name: 'clipRate', expr: 'clip_flags_rate', within: '0.02..0.08' });
    const code = generateExpect(node).join('\n');
    expect(code).toContain("process.env.NODE_ENV !== 'production'");
    expect(code).toContain('>= 0.02');
    expect(code).toContain('<= 0.08');
  });

  it('generates max-only assertion', () => {
    const node = makeNode('expect', { name: 'load', expr: 'cpu_load', max: '100' });
    const code = generateExpect(node).join('\n');
    expect(code).toContain('<= 100');
  });

  it('generates min-only assertion', () => {
    const node = makeNode('expect', { name: 'count', expr: 'items.length', min: '1' });
    const code = generateExpect(node).join('\n');
    expect(code).toContain('>= 1');
  });
});

describe('Ground Layer: recover', () => {
  it('generates retry strategy', () => {
    const node = makeNode('recover', { name: 'payment' }, [
      makeNode('strategy', { name: 'retry', max: '3', delay: '1000' }),
      makeNode('strategy', { name: 'fallback' }, [makeNode('handler', { code: "throw new Error('failed');" })]),
    ]);
    const code = generateRecover(node).join('\n');
    expect(code).toContain('for (let _attempt = 0; _attempt < 3; _attempt++)');
    expect(code).toContain('setTimeout(r, 1000)');
  });

  it('generates compensate strategy', () => {
    const node = makeNode('recover', { name: 'tx' }, [
      makeNode('strategy', { name: 'compensate' }, [makeNode('handler', { code: 'await refund(transaction);' })]),
      makeNode('strategy', { name: 'fallback' }),
    ]);
    const code = generateRecover(node).join('\n');
    expect(code).toContain('strategy: compensate');
    expect(code).toContain('await refund(transaction);');
  });

  it('generates degrade strategy', () => {
    const node = makeNode('recover', { name: 'api' }, [
      makeNode('strategy', { name: 'degrade' }, [
        makeNode('handler', { code: "return { status: 'degraded', cached: true };" }),
      ]),
      makeNode('strategy', { name: 'fallback' }),
    ]);
    const code = generateRecover(node).join('\n');
    expect(code).toContain('strategy: degrade');
    expect(code).toContain("status: 'degraded'");
  });

  it('generates fallback strategy', () => {
    const node = makeNode('recover', { name: 'svc' }, [
      makeNode('strategy', { name: 'fallback' }, [makeNode('handler', { code: "throw new Error('all exhausted');" })]),
    ]);
    const code = generateRecover(node).join('\n');
    expect(code).toContain('strategy: fallback (terminal)');
    expect(code).toContain('all exhausted');
  });

  it('throws without fallback strategy', () => {
    const node = makeNode('recover', { name: 'bad' }, [makeNode('strategy', { name: 'retry' })]);
    expect(() => generateRecover(node)).toThrow(KernCodegenError);
    expect(() => generateRecover(node)).toThrow('fallback');
  });
});

// ==========================================================================
// Phase 5 — reason/evidence stub
// ==========================================================================

describe('Ground Layer: reason annotations (stub)', () => {
  it('returns empty array when no reason/evidence children', () => {
    const node = makeNode('guard', { name: 'test', expr: 'true' });
    const result = emitReasonAnnotations(node);
    expect(result).toEqual([]);
  });

  it('emits JSDoc with reason child', () => {
    const node = makeNode('guard', { name: 'test', expr: 'true' }, [
      makeNode('reason', {
        because: 'Only owners modify',
        basis: 'schema-contract',
        survives: 'while=auth.owner_check.enabled',
      }),
    ]);
    const result = emitReasonAnnotations(node);
    expect(result.join('\n')).toContain('@reason Only owners modify');
    expect(result.join('\n')).toContain('@basis schema-contract');
    expect(result.join('\n')).toContain('@survives while=auth.owner_check.enabled');
  });

  it('emits JSDoc with evidence child', () => {
    const node = makeNode('guard', { name: 'test', expr: 'true' }, [
      makeNode('evidence', { source: 'JWT middleware', method: 'token-verification', authority: 'auth-service' }),
    ]);
    const result = emitReasonAnnotations(node);
    expect(result.join('\n')).toContain(
      '@evidence source=JWT middleware, method=token-verification, authority=auth-service',
    );
  });

  it('emits JSDoc with both reason and evidence', () => {
    const node = makeNode('guard', { name: 'test', expr: 'true' }, [
      makeNode('reason', { because: 'safety' }),
      makeNode('evidence', { source: 'JWT' }),
    ]);
    const result = emitReasonAnnotations(node);
    expect(result.join('\n')).toContain('@reason safety');
    expect(result.join('\n')).toContain('@evidence source=JWT');
  });
});

// ==========================================================================
// Disambiguation tests
// ==========================================================================

describe('Disambiguation', () => {
  it('guard dispatches through generateCoreNode', () => {
    const node = makeNode('guard', { name: 'test', expr: 'x > 0', else: '400' });
    const code = generateCoreNode(node).join('\n');
    expect(code).toContain('HttpError(400');
  });

  it('action dispatches through generateCoreNode', () => {
    const node = makeNode('action', { name: 'doSomething' });
    const code = generateCoreNode(node).join('\n');
    expect(code).toContain('async function doSomething');
  });

  it('all ground-layer types are recognized as core nodes', () => {
    const groundTypes = [
      'derive',
      'transform',
      'action',
      'guard',
      'assume',
      'invariant',
      'each',
      'collect',
      'branch',
      'resolve',
      'expect',
      'recover',
      'pattern',
      'apply',
    ];
    for (const type of groundTypes) {
      expect(isCoreNode(type)).toBe(true);
    }
  });

  it('child-only types are recognized as core nodes', () => {
    expect(isCoreNode('path')).toBe(true);
    expect(isCoreNode('candidate')).toBe(true);
    expect(isCoreNode('discriminator')).toBe(true);
    expect(isCoreNode('strategy')).toBe(true);
    expect(isCoreNode('reason')).toBe(true);
    expect(isCoreNode('evidence')).toBe(true);
  });

  it('child-only nodes produce empty output', () => {
    expect(generateCoreNode(makeNode('path', { value: 'x' }))).toEqual([]);
    expect(generateCoreNode(makeNode('candidate', { name: 'x' }))).toEqual([]);
    expect(generateCoreNode(makeNode('discriminator', {}))).toEqual([]);
    expect(generateCoreNode(makeNode('strategy', { name: 'x' }))).toEqual([]);
    expect(generateCoreNode(makeNode('reason', {}))).toEqual([]);
    expect(generateCoreNode(makeNode('evidence', {}))).toEqual([]);
  });
});

// ==========================================================================
// Python codegen tests (via import)
// ==========================================================================

describe('Python Ground Layer', () => {
  // These test the Python generators directly
  // We import from the fastapi package
  let pyGen: typeof import('../../fastapi/src/codegen-python.js');

  beforeAll(async () => {
    pyGen = await import('../../fastapi/src/codegen-python.js');
  });

  it('derive generates Python assignment', () => {
    const node = makeNode('derive', { name: 'loudness', expr: 'average(stems)', type: 'number' });
    const code = pyGen.generateDerive(node).join('\n');
    expect(code).toContain('loudness: float = average(stems)');
  });

  it('guard generates Python if/raise', () => {
    const node = makeNode('guard', { name: 'published', expr: 'track.status == "published"', else: '403' });
    const code = pyGen.generateGuard(node).join('\n');
    expect(code).toContain('if not (track.status == "published")');
    expect(code).toContain('HTTPException(status_code=403');
  });

  it('action generates async def', () => {
    const node = makeNode('action', { name: 'notifyOwner', idempotent: 'true' });
    const code = pyGen.generateAction(node).join('\n');
    expect(code).toContain('async def notify_owner()');
    expect(code).toContain('@action idempotent=True');
  });

  it('each generates for loop', () => {
    const node = makeNode('each', { name: 'stem', in: 'track.stems' });
    const code = pyGen.generateEach(node).join('\n');
    expect(code).toContain('for stem in track.stems:');
  });

  it('each await=true generates async for loop', () => {
    const node = makeNode('each', { name: 'chunk', in: 'stream', await: true });
    const code = pyGen.generateEach(node).join('\n');
    expect(code).toContain('async for chunk in stream:');
  });

  it('each await=true rejects index mode', () => {
    const node = makeNode('each', { name: 'chunk', in: 'stream', await: true, index: 'i' });
    expect(() => pyGen.generateEach(node)).toThrow(/cannot be combined with index=/);
  });

  it('collect generates list comprehension', () => {
    const node = makeNode('collect', {
      name: 'overThreshold',
      from: 'stems',
      where: 'item.loudness > 0.5',
      limit: '10',
    });
    const code = pyGen.generateCollect(node).join('\n');
    expect(code).toContain('[item for item in stems if item.loudness > 0.5][:10]');
  });

  it('branch generates match statement', () => {
    const node = makeNode('branch', { name: 'tier', on: 'user.tier' }, [
      makeNode('path', { value: 'free' }),
      makeNode('path', { value: 'pro' }),
    ]);
    const code = pyGen.generateBranch(node).join('\n');
    expect(code).toContain('match user.tier:');
    expect(code).toContain('case "free":');
    expect(code).toContain('case "pro":');
  });

  it('invariant generates assert', () => {
    const node = makeNode('invariant', { name: 'stemLimit', expr: 'visible_stems <= max_stems' });
    const code = pyGen.generateInvariant(node).join('\n');
    expect(code).toContain('assert visible_stems <= max_stems');
  });

  it('expect generates assert with range', () => {
    const node = makeNode('expect', { name: 'rate', expr: 'clip_rate', within: '0.02..0.08' });
    const code = pyGen.generateExpect(node).join('\n');
    expect(code).toContain('assert 0.02 <= (clip_rate) <= 0.08');
  });

  it('recover generates async recovery function', () => {
    const node = makeNode('recover', { name: 'payment' }, [
      makeNode('strategy', { name: 'retry', max: '3', delay: '1000' }),
      makeNode('strategy', { name: 'fallback' }),
    ]);
    const code = pyGen.generateRecover(node).join('\n');
    expect(code).toContain('async def payment_with_recovery');
    expect(code).toContain('for _attempt in range(3)');
  });

  it('resolve generates Python candidates + resolver', () => {
    const node = makeNode('resolve', { name: 'normStrategy' }, [
      makeNode('candidate', { name: 'aggressive' }, [
        makeNode('handler', { code: 'return aggressive_normalize(signal)' }),
      ]),
      makeNode('discriminator', { method: 'benchmark', metric: 'snr' }, [
        makeNode('handler', { code: 'winner_idx = 0' }),
      ]),
    ]);
    const code = pyGen.generateResolve(node).join('\n');
    expect(code).toContain('_norm_strategy_candidates');
    expect(code).toContain('async def resolve_norm_strategy');
  });

  it('transform generates Python assignment', () => {
    const node = makeNode('transform', { name: 'limitStems', via: 'limit(4)', type: 'Stem[]' });
    const code = pyGen.generateTransform(node).join('\n');
    expect(code).toContain('limit_stems: list[Stem] = limit(4)');
  });

  it('assume generates Python assert', () => {
    const node = makeNode('assume', { name: 'ownerCheck', expr: 'track.owner == auth.user' });
    const code = pyGen.generateAssume(node).join('\n');
    expect(code).toContain('assert track.owner == auth.user');
  });
});

describe('Python Confidence Layer', () => {
  let pyGen: typeof import('../../fastapi/src/codegen-python.js');

  beforeAll(async () => {
    pyGen = await import('../../fastapi/src/codegen-python.js');
  });

  it('emitPyReasonAnnotations emits # @confidence from prop', () => {
    const node = makeNode('derive', { name: 'x', expr: '1', confidence: '0.7' });
    const result = pyGen.emitPyReasonAnnotations(node);
    expect(result.join('\n')).toContain('# @confidence 0.7');
  });

  it('emitPyReasonAnnotations emits # @needs from child node', () => {
    const node = makeNode('derive', { name: 'x', expr: '1' }, [
      makeNode('needs', { what: 'auth config', 'would-raise-to': '0.95' }),
    ]);
    const result = pyGen.emitPyReasonAnnotations(node);
    expect(result.join('\n')).toContain('# @needs auth config (would raise to 0.95)');
  });

  it('emitPyLowConfidenceTodo emits TODO for confidence < 0.5', () => {
    const node = makeNode('derive', { name: 'risky', expr: '1', confidence: '0.3' });
    const result = pyGen.emitPyLowConfidenceTodo(node, '0.3');
    expect(result).toEqual(['# TODO(low-confidence): risky confidence=0.3']);
  });

  it('emitPyLowConfidenceTodo returns [] for from: and min:', () => {
    const node = makeNode('derive', { name: 'x', expr: '1' });
    expect(pyGen.emitPyLowConfidenceTodo(node, 'from:auth')).toEqual([]);
    expect(pyGen.emitPyLowConfidenceTodo(node, 'min:a,b')).toEqual([]);
    expect(pyGen.emitPyLowConfidenceTodo(node, '0.7')).toEqual([]);
  });

  it('derive with confidence emits annotation before assignment', () => {
    const node = makeNode('derive', { name: 'authMethod', expr: 'check_auth()', confidence: '0.7', type: 'number' });
    const code = pyGen.generateDerive(node).join('\n');
    expect(code).toContain('# @confidence 0.7');
    expect(code).toContain('auth_method: float = check_auth()');
    const confIdx = code.indexOf('# @confidence');
    const assignIdx = code.indexOf('auth_method');
    expect(confIdx).toBeLessThan(assignIdx);
  });

  it('emitPyReasonAnnotations returns [] when no annotations (backward compat)', () => {
    const node = makeNode('derive', { name: 'x', expr: '1' });
    expect(pyGen.emitPyReasonAnnotations(node)).toEqual([]);
  });
});

// ==========================================================================
// Integration tests — generateCoreNode dispatches all types correctly
// ==========================================================================

describe('Integration: generateCoreNode dispatches ground layer', () => {
  it('derive dispatches correctly', () => {
    const code = generateCoreNode(makeNode('derive', { name: 'x', expr: '1' })).join('\n');
    expect(code).toContain('const x = 1;');
  });

  it('transform dispatches correctly', () => {
    const code = generateCoreNode(makeNode('transform', { name: 'y', via: 'fn()' })).join('\n');
    expect(code).toContain('const y = fn();');
  });

  it('action dispatches correctly', () => {
    const code = generateCoreNode(makeNode('action', { name: 'z' })).join('\n');
    expect(code).toContain('async function z()');
  });

  it('guard dispatches correctly', () => {
    const code = generateCoreNode(makeNode('guard', { name: 'g', expr: 'x' })).join('\n');
    expect(code).toContain('if (!(x))');
  });

  it('assume dispatches correctly', () => {
    const code = generateCoreNode(
      makeNode('assume', {
        expr: 'x',
        evidence: 'e',
        fallback: 'throw Error()',
      }),
    ).join('\n');
    expect(code).toContain('if (!(x))');
  });

  it('invariant dispatches correctly', () => {
    const code = generateCoreNode(makeNode('invariant', { name: 'inv', expr: 'true' })).join('\n');
    expect(code).toContain('console.assert');
  });

  it('each dispatches correctly', () => {
    const code = generateCoreNode(makeNode('each', { name: 'i', in: 'list' })).join('\n');
    expect(code).toContain('for (const i of list)');
  });

  it('collect dispatches correctly', () => {
    const code = generateCoreNode(makeNode('collect', { name: 'c', from: 'items' })).join('\n');
    expect(code).toContain('const c = items;');
  });

  it('branch dispatches correctly', () => {
    const code = generateCoreNode(makeNode('branch', { name: 'b', on: 'x' }, [makeNode('path', { value: 'a' })])).join(
      '\n',
    );
    expect(code).toContain('switch (x)');
  });

  it('expect dispatches correctly', () => {
    const code = generateCoreNode(makeNode('expect', { name: 'e', expr: 'v', within: '0..1' })).join('\n');
    expect(code).toContain('console.assert');
  });

  it('recover dispatches correctly', () => {
    const code = generateCoreNode(
      makeNode('recover', { name: 'r' }, [makeNode('strategy', { name: 'fallback' })]),
    ).join('\n');
    expect(code).toContain('async function rWithRecovery');
  });

  it('existing core nodes still work (regression)', () => {
    // type still works
    const typeCode = generateCoreNode(makeNode('type', { name: 'T', values: 'a|b' })).join('\n');
    expect(typeCode).toContain("export type T = 'a' | 'b';");

    // fn still works
    const fnCode = generateCoreNode(
      makeNode('fn', { name: 'foo', returns: 'void' }, [makeNode('handler', { code: 'return;' })]),
    ).join('\n');
    expect(fnCode).toContain('export function foo()');
  });
});

// ==========================================================================
// Phase 5 — Confidence Layer: annotations, TODO, needs node
// ==========================================================================

describe('Confidence Layer: emitReasonAnnotations', () => {
  it('emits @confidence from prop', () => {
    const node = makeNode('derive', { name: 'x', expr: '1', confidence: '0.7' });
    const result = emitReasonAnnotations(node);
    expect(result.join('\n')).toContain('@confidence 0.7');
  });

  it('emits @needs from single child node', () => {
    const node = makeNode('derive', { name: 'x', expr: '1' }, [
      makeNode('needs', { what: 'auth middleware config', 'would-raise-to': '0.95' }),
    ]);
    const result = emitReasonAnnotations(node);
    expect(result.join('\n')).toContain('@needs auth middleware config (would raise to 0.95)');
  });

  it('emits @needs from multiple child nodes', () => {
    const node = makeNode('derive', { name: 'x', expr: '1' }, [
      makeNode('needs', { what: 'first need' }),
      makeNode('needs', { what: 'second need', 'would-raise-to': '0.9' }),
    ]);
    const result = emitReasonAnnotations(node);
    const output = result.join('\n');
    expect(output).toContain('@needs first need');
    expect(output).toContain('@needs second need (would raise to 0.9)');
  });

  it('emits confidence + reason + needs together', () => {
    const node = makeNode('guard', { name: 'ownerCheck', expr: 'isOwner', confidence: '0.7' }, [
      makeNode('reason', { because: 'Only owners modify tracks' }),
      makeNode('needs', { what: 'integration test' }),
    ]);
    const result = emitReasonAnnotations(node);
    const output = result.join('\n');
    expect(output).toContain('@confidence 0.7');
    expect(output).toContain('@reason Only owners modify tracks');
    expect(output).toContain('@needs integration test');
  });

  it('returns empty when no confidence/reason/evidence/needs (backward compat)', () => {
    const node = makeNode('derive', { name: 'x', expr: '1' });
    const result = emitReasonAnnotations(node);
    expect(result).toEqual([]);
  });
});

describe('Confidence Layer: emitLowConfidenceTodo', () => {
  it('emits TODO for confidence < 0.5', () => {
    const node = makeNode('derive', { name: 'dubious', expr: '1', confidence: '0.3' });
    const result = emitLowConfidenceTodo(node, '0.3');
    expect(result).toEqual(['// TODO(low-confidence): dubious confidence=0.3']);
  });

  it('returns [] for confidence >= 0.5', () => {
    const node = makeNode('derive', { name: 'ok', expr: '1', confidence: '0.7' });
    const result = emitLowConfidenceTodo(node, '0.7');
    expect(result).toEqual([]);
  });

  it('confidence=from:X does not generate TODO', () => {
    const node = makeNode('derive', { name: 'x', expr: '1', confidence: 'from:authMethod' });
    const result = emitLowConfidenceTodo(node, 'from:authMethod');
    expect(result).toEqual([]);
  });

  it('confidence=min:a,b does not generate TODO', () => {
    const node = makeNode('derive', { name: 'x', expr: '1', confidence: 'min:a,b' });
    const result = emitLowConfidenceTodo(node, 'min:a,b');
    expect(result).toEqual([]);
  });

  it('returns [] for undefined confidence', () => {
    const node = makeNode('derive', { name: 'x', expr: '1' });
    const result = emitLowConfidenceTodo(node, undefined);
    expect(result).toEqual([]);
  });
});

describe('Confidence Layer: needs node', () => {
  it('needs node produces empty standalone output via generateCoreNode', () => {
    const node = makeNode('needs', { what: 'something' });
    expect(generateCoreNode(node)).toEqual([]);
  });

  it('isCoreNode("needs") returns true', () => {
    expect(isCoreNode('needs')).toBe(true);
  });

  it('derive with confidence emits annotation before const', () => {
    const node = makeNode('derive', { name: 'authMethod', expr: 'checkAuth()', confidence: '0.7' });
    const code = generateDerive(node).join('\n');
    expect(code).toContain('@confidence 0.7');
    expect(code).toContain('export const authMethod = checkAuth();');
    // annotation should come before the const
    const confIdx = code.indexOf('@confidence');
    const constIdx = code.indexOf('export const');
    expect(confIdx).toBeLessThan(constIdx);
  });

  it('guard with confidence + needs emits full JSDoc block', () => {
    const node = makeNode('guard', { name: 'ownerCheck', expr: 'isOwner', confidence: 'from:authMethod' }, [
      makeNode('reason', { because: 'Only owners modify tracks' }),
      makeNode('needs', { what: 'auth middleware config', 'would-raise-to': '0.95' }),
    ]);
    const code = generateGuard(node).join('\n');
    expect(code).toContain('@confidence from:authMethod');
    expect(code).toContain('@reason Only owners modify tracks');
    expect(code).toContain('@needs auth middleware config (would raise to 0.95)');
  });

  it('derive with low confidence emits TODO before annotation', () => {
    const node = makeNode('derive', { name: 'risky', expr: 'guess()', confidence: '0.2' });
    const code = generateDerive(node).join('\n');
    expect(code).toContain('// TODO(low-confidence): risky confidence=0.2');
    expect(code).toContain('@confidence 0.2');
    // TODO should come before annotation
    const todoIdx = code.indexOf('TODO(low-confidence)');
    const confIdx = code.indexOf('@confidence');
    expect(todoIdx).toBeLessThan(confIdx);
  });
});
