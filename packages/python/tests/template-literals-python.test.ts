/**
 * FORGE SPEC — JS template literals → Python f-strings (Python target).
 *
 * Template literals are the highest-frequency reason route handlers stay raw
 * `<<<JS>>>` (any string interpolation uses them). In portable route
 * expressions, a backtick template must lower to a Python f-string, with
 * `${expr}` → `{expr}`. Interpolated expressions are already rewritten by the
 * earlier passes in rewriteFastAPIExpr (params/body/etc.), so the lowering is
 * primarily a syntax transform; literal braces must be escaped (`{` → `{{`).
 */

describe('Template literal → f-string (Python target)', () => {
  async function transpile(lines: string[]) {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
    return transpileFastAPI(parse(lines.join('\n')));
  }
  function routeContent(result: { artifacts?: Array<{ path: string; content: string }> }, needle: string): string {
    const art = (result.artifacts ?? []).find((a) => a.path.includes(needle) && a.path.endsWith('.py'));
    if (!art) throw new Error(`route artifact "${needle}" not found`);
    return art.content;
  }

  test('single interpolation with a path param', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/item/:id',
      '    derive label expr={{ `Item ${params.id}` }}',
      '    respond 200 json=label',
    ]);
    const code = routeContent(result, 'item');
    expect(code).toContain('label = f"Item {id}"');
    expect(code).not.toContain('`');
  });

  test('multiple interpolations', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/pair',
      '    params items="[{name:a,type:string},{name:b,type:string}]"',
      '    derive s expr={{ `${a}-${b}` }}',
      '    respond 200 json=s',
    ]);
    const code = routeContent(result, 'pair');
    expect(code).toContain('s = f"{a}-{b}"');
    expect(code).not.toContain('${');
  });

  test('a template literal with no interpolation becomes a plain string', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/plain',
      '    derive s expr={{ `hello world` }}',
      '    respond 200 json=s',
    ]);
    const code = routeContent(result, 'plain');
    expect(code).toContain('s = "hello world"');
    expect(code).not.toContain('`');
  });

  test('literal braces are escaped in the f-string', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/brace/:id',
      '    derive s expr={{ `set {x} = ${params.id}` }}',
      '    respond 200 json=s',
    ]);
    const code = routeContent(result, 'brace');
    expect(code).toContain('s = f"set {{x}} = {id}"');
  });
});
