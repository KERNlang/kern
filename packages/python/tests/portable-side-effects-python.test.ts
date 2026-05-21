/**
 * SPEC — portable `assign` / `do` as route children → FastAPI side-effect stmts.
 *
 * A route that mutates and persists (`provider.enabled = body.enabled;
 * registry.register(provider); saveConfig()`) previously had to stay a raw
 * `<<<JS>>>` handler because the portable route layer had no side-effect
 * statement. `assign` and `do` (the body-statement nodes) are now also valid
 * as direct `route` children alongside derive/guard/respond, lowering through
 * the same rewriter — so `body.x` resolves to the Pydantic field access.
 *
 * Express keeps the JS form (verified in the express package); these assert the
 * generated Python shape.
 */

describe('Portable assign/do as route children → FastAPI', () => {
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

  test('assign member target + do void calls lower as bare statements', async () => {
    const code = routeContent(
      await transpile([
        'server name=API port=8000',
        '  route method=post path=/api/toggle',
        '    schema body="{id: string, enabled: boolean}"',
        '    derive provider expr={{ registry.get(body.id) }}',
        '    assign target="provider.enabled" value="body.enabled"',
        '    do value="registry.register(provider)"',
        '    do value="saveConfig()"',
        '    respond 200 json={{ {ok: true} }}',
      ]),
      'toggle',
    );
    expect(code).toContain('provider = registry.get(body.id)');
    expect(code).toContain('provider.enabled = body.enabled');
    expect(code).toContain('registry.register(provider)');
    expect(code).toContain('saveConfig()');
    expect(code).toContain('return {"ok": True}');
    expect(code).not.toContain('NotImplementedError');
  });

  test('assign coexists with a guard (no BOTH-portable-AND-kern error)', async () => {
    const code = routeContent(
      await transpile([
        'server name=API port=8000',
        '  route method=post path=/api/guarded',
        '    schema body="{id: string, enabled: boolean}"',
        '    derive provider expr={{ registry.get(body.id) }}',
        '    guard expr={{ provider }}',
        '      error status=404 message="Not found"',
        '    assign target="provider.enabled" value="body.enabled"',
        '    respond 200 json={{ {ok: true} }}',
      ]),
      'guarded',
    );
    expect(code).toContain('if not (provider):');
    expect(code).toContain('raise HTTPException(status_code=404');
    expect(code).toContain('provider.enabled = body.enabled');
  });

  test('postfix assign op lowers to the compound form (Python has no ++)', async () => {
    const code = routeContent(
      await transpile([
        'server name=API port=8000',
        '  route method=post path=/api/counter',
        '    derive state expr={{ store.get() }}',
        '    assign target="state.hits" op="++"',
        '    respond 200 json=state',
      ]),
      'counter',
    );
    expect(code).toContain('state.hits += 1');
    expect(code).not.toContain('++');
  });

  test('compound assign op is preserved verbatim', async () => {
    const code = routeContent(
      await transpile([
        'server name=API port=8000',
        '  route method=post path=/api/acc',
        '    derive state expr={{ store.get() }}',
        '    assign target="state.total" op="+=" value="body.amount"',
        '    respond 200 json=state',
      ]),
      'acc',
    );
    expect(code).toContain('state.total += body.amount');
  });

  test('a JS-only operator that Python cannot express throws (no silent leak)', async () => {
    await expect(
      transpile([
        'server name=API port=8000',
        '  route method=post path=/api/bad',
        '    derive state expr={{ store.get() }}',
        '    assign target="state.x" op=">>>=" value="1"',
        '    respond 200 json=state',
      ]),
    ).rejects.toThrow(/not supported on the FastAPI target/);
  });

  test('a non-postfix assign with no value fails loud (never `lhs = undefined`)', async () => {
    // `value` is schema-required for a non-postfix assign; codegen also throws
    // for parity with the body-statement emitter, never emitting `state.x = `.
    await expect(
      transpile([
        'server name=API port=8000',
        '  route method=post path=/api/novalue',
        '    derive state expr={{ store.get() }}',
        '    assign target="state.x"',
        '    respond 200 json=state',
      ]),
    ).rejects.toThrow(/requires `value=`/);
  });

  test('do rewrites portable refs (body.x → Pydantic field access)', async () => {
    const code = routeContent(
      await transpile([
        'server name=API port=8000',
        '  route method=post path=/api/log',
        '    schema body="{id: string}"',
        '    do value="audit.record(body.id)"',
        '    respond 200 json={{ {ok: true} }}',
      ]),
      'log',
    );
    expect(code).toContain('audit.record(body.id)');
  });
});
