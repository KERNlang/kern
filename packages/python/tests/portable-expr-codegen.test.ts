/**
 * Route-artifact codegen for portable expressions (derive/guard/respond/...).
 *
 * The golden snapshot only captures `result.code` (the main app file), so the
 * per-route artifact files — where object-key quoting, body-field casing, and
 * auth lowering all live — were previously uncovered. These tests assert the
 * generated route artifact CONTENT directly.
 */

describe('FastAPI portable expression codegen (route artifacts)', () => {
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

  test('Bug A: object-literal keys in a derive expression are quoted for Python', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/things',
      '    derive things expr={{db.find({userId: 1, active: true})}}',
      '    respond 200 json=things',
    ]);
    const code = routeContent(result, 'things');
    expect(code).toContain('{"userId": 1, "active": True}');
    expect(code).not.toContain('{userId:');
  });

  test('Bug B: body.<camelField> rewrites to the snake_case model attribute', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/things',
      '    schema body="{trackId: string, isActive: boolean}"',
      '    derive r expr={{process(body.trackId, body.isActive)}}',
      '    respond 200 json=r',
    ]);
    const code = routeContent(result, 'things');
    expect(code).toContain('body.track_id');
    expect(code).toContain('body.is_active');
    expect(code).not.toContain('body.trackId');
    expect(code).not.toContain('body.isActive');
  });

  test('body fields from an external validate schema are NOT snake-cased (we do not own them)', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/things',
      '    validate CreateThing',
      '    derive r expr={{process(body.trackId)}}',
      '    respond 200 json=r',
    ]);
    const code = routeContent(result, 'things');
    expect(code).toContain('body.trackId');
  });

  test('P1: an auth route artifact imports the auth helper it Depends on', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/me',
      '    auth required',
      '    derive me expr={{lookup(user.id)}}',
      '    respond 200 json=me',
    ]);
    const code = routeContent(result, 'me');
    expect(code).toContain('from auth import auth_required');
    expect(code).toContain('Depends(auth_required)');
  });

  test('P2: user.<field> lowers to dict subscript when the route declares auth', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/me',
      '    auth required',
      '    derive me expr={{lookup(user.id)}}',
      '    respond 200 json=me',
    ]);
    const code = routeContent(result, 'me');
    expect(code).toContain('user["id"]');
    expect(code).not.toContain('user.id');
  });

  test('without auth, user.<field> is left untouched (no spurious subscripting)', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/things',
      '    derive r expr={{user.id}}',
      '    respond 200 json=r',
    ]);
    const code = routeContent(result, 'things');
    expect(code).toContain('user.id');
    expect(code).not.toContain('user["id"]');
  });

  test('P2-followup: the user.<field> rewrite skips string literals', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/me',
      '    auth required',
      '    derive label expr={{tag("user.id")}}',
      '    respond 200 json=label',
    ]);
    const code = routeContent(result, 'me');
    // The literal string "user.id" must be preserved verbatim, not corrupted
    // into "user["id"]" — which would be invalid Python.
    expect(code).toContain('"user.id"');
    expect(code).not.toContain('"user["id"]"');
  });

  test('auth optional routes import auth_optional and subscript the payload', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/maybe',
      '    auth optional',
      '    derive who expr={{lookup(user.id)}}',
      '    respond 200 json=who',
    ]);
    const code = routeContent(result, 'maybe');
    expect(code).toContain('from auth import auth_optional');
    expect(code).toContain('user["id"]');
  });

  test('P1-followup: packaged output imports auth with a package-relative spec', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
    const root = parse(
      [
        'server name=API port=8000',
        '  route method=get path=/api/me',
        '    auth required',
        '    derive me expr={{lookup(user.id)}}',
        '    respond 200 json=me',
      ].join('\n'),
    );
    // Emit as a package: the app module is `myapp.main`, so auth is `myapp.auth`
    // and a route at `myapp.routes.*` must import it as `..auth`, not `auth`.
    const result = transpileFastAPI(root, {
      fastapi: { sourceFile: 'app.kern', modulePathByFile: { 'app.kern': 'myapp.main' } },
    } as Parameters<typeof transpileFastAPI>[1]);
    const code = routeContent(result, 'me');
    expect(code).toContain('from ..auth import auth_required');
    expect(code).not.toContain('from auth import');
  });
});
