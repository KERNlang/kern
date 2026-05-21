/**
 * SPEC — JS object-literal shorthand props → explicit Python dict entries.
 *
 * `res.json({ items, page, total: 100 })` uses shorthand property syntax, a
 * frequent raw-handler reason. On the Python target each bare-identifier entry
 * must expand to `key: key` so it becomes a valid dict entry `{"key": key}`
 * (Express keeps the shorthand — valid JS). `key: value` entries, `**spread`
 * entries, and array/comprehension contents are left untouched.
 *
 * Verified end-to-end by scripts/conformance.mjs (locals fixture); these assert
 * the generated Python shape.
 */

describe('Object shorthand props → Python dict entries', () => {
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

  test('bare-identifier entries expand and then quote; key: value untouched', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/short',
      '    params page:number=1, limit:number=20',
      '    respond 200 json={{ {page, limit, total: 100} }}',
    ]);
    const code = routeContent(result, 'short');
    expect(code).toContain('{"page": page, "limit": limit, "total": 100}');
  });

  test('shorthand coexists with a body spread', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/merge',
      '    validate schema=Input',
      '    params ok:boolean=true',
      '    derive out expr={{ { ...body, ok } }}',
      '    respond 200 json=out',
    ]);
    const code = routeContent(result, 'merge');
    expect(code).toContain('**body.model_dump()');
    expect(code).toContain('"ok": ok');
  });

  test('nested object shorthand expands recursively', async () => {
    // NB: a trailing `ok: 1` keeps the inner `}` off the `}}` delimiter — the
    // `{{ }}` IR parser closes on the first `}}`, unrelated to shorthand.
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/nest',
      '    params inner:string=x',
      '    respond 200 json={{ {wrap: {inner}, ok: 1} }}',
    ]);
    const code = routeContent(result, 'nest');
    expect(code).toContain('{"wrap": {"inner": inner}, "ok": 1}');
  });

  test('a brace-like sequence inside a string is not treated as an object', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/strbrace',
      '    respond 200 json={{ {note: "see {x}"} }}',
    ]);
    const code = routeContent(result, 'strbrace');
    expect(code).toContain('"note": "see {x}"');
  });
});
