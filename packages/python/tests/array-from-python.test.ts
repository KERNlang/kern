/**
 * SPEC — JS `Array.from({ length: N }, (_, i) => BODY)` → Python comprehension.
 *
 * The length-object form of Array.from is a range generator and a frequent
 * reason a handler stays raw `<<<JS>>>`. The arrow's SECOND parameter is the
 * index (Array.from calls fn(element, index); for the length form the element is
 * undefined), so it becomes the loop variable. (Express keeps Array.from — it is
 * valid JS.)
 *
 * Lowering has two emission shapes by COUNT kind:
 *   - A statically-safe non-negative INTEGER literal `<= 2**32-1` (e.g. 3) takes
 *     the clean fast-path `[BODY for i in range(N)]` — no length helper, no
 *     normalize pass. These are valid JS array lengths (JS materializes them
 *     too), so emitting `range(N)` is exact parity at zero cold-start cost.
 *   - Anything else — an identifier/member-access/arithmetic count, a literal
 *     `> 2**32-1`, or a non-finite (`Infinity`/`NaN`) — is routed through the
 *     validated `_kern_array_like_length` guard: an invalid length (Infinity,
 *     > 2**32-1) must throw a RangeError and NaN/≤0 must yield an empty array,
 *     exactly as JS does — never a Python NameError for a bare `Infinity` token,
 *     and never a multi-billion-element materialization (DoS).
 * See stdlib-host-alias-registry.test.ts for the executable JS-parity battery.
 *
 * Verified end-to-end (Python result == Express result) by
 * scripts/conformance.mjs; these assert the generated Python shape.
 */

describe('Array.from(length, arrow) → Python comprehension', () => {
  async function transpile(lines: string[]) {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
    return transpileFastAPI(parse(lines.join('\n')));
  }
  function routeContent(result: { artifacts?: Array<{ path: string; content: string }> }, needle: string): string {
    const art = (result.artifacts ?? []).find((a) => a.path.includes(needle) && a.path.endsWith('.py'));
    if (!art) {
      const paths = (result.artifacts ?? []).map((a) => a.path).join(', ');
      throw new Error(`route artifact matching "${needle}" not found; have: ${paths}`);
    }
    return art.content;
  }

  test('simple expression body → [expr for i in range(n)]', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/range',
      '    derive nums expr={{ Array.from({ length: 3 }, (_, i) => i * 2) }}',
      '    respond 200 json=nums',
    ]);
    const code = routeContent(result, 'range');
    // Literal length → clean `range(3)` fast-path (no length helper / normalize).
    expect(code).toContain('[i * 2 for i in range(3)]');
    // The user's `Array.from(...)` CALL must be gone (lowered). The substring
    // `Array.from` still appears once inside the injected `_kern_array_from`
    // helper's TypeError message, so assert against the live call form `(`.
    expect(code).not.toContain('Array.from(');
    expect(code).not.toContain('=>');
  });

  test('object body with a wrapping paren is unwrapped and keys quoted', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/grid',
      '    params items="[{name:n,type:number}]"',
      '    derive cells expr={{ Array.from({ length: n }, (_, i) => ({ idx: i, base: n })) }}',
      '    respond 200 json=cells',
    ]);
    const code = routeContent(result, 'grid');
    expect(code).toContain('[{"idx": i, "base": n} for i in range(_kern_array_like_length({"length": n}))]');
  });

  test('template-literal body lowers inside the comprehension', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/labels',
      '    derive labels expr={{ Array.from({ length: 2 }, (_, i) => `item-${i + 1}`) }}',
      '    respond 200 json=labels',
    ]);
    const code = routeContent(result, 'labels');
    expect(code).toContain('["item-{}".format(i + 1) for i in range(2)]');
  });

  test('a 0-parameter arrow iterates an anonymous loop variable', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/zeros',
      '    derive zs expr={{ Array.from({ length: 4 }, () => 0) }}',
      '    respond 200 json=zs',
    ]);
    const code = routeContent(result, 'zeros');
    expect(code).toContain('[0 for _ in range(4)]');
  });

  test('nested Array.from lowers recursively', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/matrix',
      '    derive m expr={{ Array.from({ length: 2 }, (_, i) => Array.from({ length: 2 }, (_, j) => i * 2 + j)) }}',
      '    respond 200 json=m',
    ]);
    const code = routeContent(result, 'matrix');
    // Both literal lengths take the clean fast-path; nested lowering still works.
    expect(code).toContain('[[i * 2 + j for j in range(2)] for i in range(2)]');
  });

  test('a shorthand length object is recognised after shorthand expansion', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/shortlen',
      '    params length:number=3',
      '    derive xs expr={{ Array.from({ length }, (_, i) => i) }}',
      '    respond 200 json=xs',
    ]);
    const code = routeContent(result, 'shortlen');
    expect(code).toContain('[i for i in range(_kern_array_like_length({"length": length}))]');
    expect(code).not.toContain('Array.from(');
  });

  test('a single-param arrow does NOT promote the element to the index var', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/single',
      '    derive s expr={{ Array.from({ length: 3 }, (x) => x) }}',
      '    respond 200 json=s',
    ]);
    const code = routeContent(result, 'single');
    // index is the 2nd param; with only the element param present the loop var
    // is the throwaway `_`, never `x` (which is undefined in JS for length form).
    expect(code).toContain('for _ in range(3)');
    expect(code).not.toContain('for x in range(3)');
  });

  test('Array.from followed by a method chain is left raw (not malformed)', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/chain',
      '    derive c expr={{ Array.from({ length: 3 }, (_, i) => i).join(",") }}',
      '    respond 200 json=c',
    ]);
    const code = routeContent(result, 'chain');
    // not lowered to a comprehension that would then be mis-chained
    expect(code).not.toContain('range(3)].join');
  });

  test('Array.from over an iterable (map form) is left untouched', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/iter',
      '    derive xs expr={{ Array.from(items, (x) => x) }}',
      '    respond 200 json=xs',
    ]);
    const code = routeContent(result, 'iter');
    // Only the { length: N } form is lowered; the map form stays as-is.
    expect(code).toContain('Array.from(items');
  });
});
