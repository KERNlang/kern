/**
 * SPEC — JS spread elements → Python unpacking (Python target).
 *
 * Object/array spread (`{...x}`, `[...x]`) is a common reason a handler stays
 * raw `<<<JS>>>`. In a portable expression it must lower to Python unpacking,
 * with one trap (caught by scripts/conformance.mjs differential execution):
 * the request `body` is a Pydantic model, not a mapping, so `{**body}` raises
 * TypeError at runtime even though it parses. It must become
 * `{**body.model_dump()}` — and unconditionally, because whenever the `body`
 * symbol exists it is a model (inline RequestBody OR an external `validate`
 * schema typed `body: X`); there is no `body: dict` codegen path.
 *
 * The operator is chosen from the enclosing bracket: `{` → `**`, `[`/`(` → `*`.
 */

describe('Object/array spread → Python unpacking', () => {
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

  test('body spread with an external validate schema → **body.model_dump()', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/items',
      '    validate schema=CreateItemInput',
      '    derive item expr={{ { id: crypto.randomUUID(), ...body, createdAt: 1 } }}',
      '    respond 201 json=item',
    ]);
    const code = routeContent(result, 'items');
    expect(code).toContain('**body.model_dump()');
    expect(code).not.toMatch(/\{[^}]*\.\.\.body/); // no raw `...body` survives
  });

  test('body spread with an inline schema → **body.model_dump()', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/users',
      '    schema body="[{name:email,type:string}]"',
      '    derive out expr={{ { ...body, ok: true } }}',
      '    respond 201 json=out',
    ]);
    const code = routeContent(result, 'users');
    expect(code).toContain('**body.model_dump()');
  });

  test('object spread of the auth user dict → plain **user (no model_dump)', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/me',
      '    auth mode=required',
      '    derive merged expr={{ { ...user, role: "admin" } }}',
      '    respond 200 json=merged',
    ]);
    const code = routeContent(result, 'me');
    expect(code).toContain('**user');
    expect(code).not.toContain('user.model_dump');
  });

  test('array spread chooses * and rewrites the member operand', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/roles',
      '    auth mode=required',
      '    derive all expr={{ [...user.roles, "guest"] }}',
      '    respond 200 json=all',
    ]);
    const code = routeContent(result, 'roles');
    expect(code).toContain('[*user["roles"], "guest"]');
  });

  test('a literal "..." inside a string is NOT treated as spread', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/msg',
      '    derive m expr={{ { note: "more..." } }}',
      '    respond 200 json=m',
    ]);
    const code = routeContent(result, 'msg');
    expect(code).toContain('"more..."');
    expect(code).not.toContain('**');
  });
});
