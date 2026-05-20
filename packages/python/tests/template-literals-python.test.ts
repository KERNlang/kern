/**
 * FORGE SPEC (hardened) — JS template literals → Python (Python target).
 *
 * Template literals are the highest-frequency reason route handlers stay raw
 * `<<<JS>>>`. In portable route expressions a backtick template must lower to
 * valid Python. A naive "rewrite the whole flat string then convert backticks"
 * approach is wrong (Codex review of the first forge winner, 4617a6ea):
 *   - literal template TEXT that resembles a portable ref gets corrupted;
 *   - interpolations are only partially rewritten (e.g. `===` survived);
 *   - f-string assembly collides with quotes from rewritten interps
 *     (`f"{request.headers.get("X")}"` is invalid on Python < 3.12).
 *
 * Correct shape (what this spec enforces):
 *   - split the template into TEXT and `${...}` INTERPOLATION parts FIRST;
 *   - recursively rewrite each interpolation through the full pipeline
 *     (so params/body/headers/`===` are all handled);
 *   - preserve TEXT verbatim (never rewrite it);
 *   - assemble with str.format() so interpolated expressions live OUTSIDE the
 *     string literal and cannot collide with its quotes; literal braces in
 *     text are escaped to `{{`/`}}`; a template with no interpolation becomes
 *     a plain double-quoted string.
 */

describe('Template literal → Python (.format) lowering', () => {
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
    expect(code).toContain('label = "Item {}".format(id)');
    expect(code).not.toContain('`');
  });

  test('multiple interpolations preserve order', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/pair',
      '    params items="[{name:a,type:string},{name:b,type:string}]"',
      '    derive s expr={{ `${a}-${b}` }}',
      '    respond 200 json=s',
    ]);
    const code = routeContent(result, 'pair');
    expect(code).toContain('s = "{}-{}".format(a, b)');
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
    expect(code).not.toContain('.format(');
  });

  test('literal braces in text are escaped for str.format', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/brace/:id',
      '    derive s expr={{ `set {x} = ${params.id}` }}',
      '    respond 200 json=s',
    ]);
    const code = routeContent(result, 'brace');
    expect(code).toContain('s = "set {{x}} = {}".format(id)');
  });

  // ── Hardening cases (from the Codex review of 4617a6ea) ──────────────────

  test('literal text that resembles a portable ref is NOT rewritten', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/lit/:id',
      '    derive s expr={{ `the params.id field` }}',
      '    respond 200 json=s',
    ]);
    const code = routeContent(result, 'lit');
    expect(code).toContain('s = "the params.id field"');
    expect(code).not.toContain('the id field');
  });

  test('an operator inside an interpolation is lowered (=== → ==)', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/eq',
      '    params items="[{name:count,type:number}]"',
      '    derive s expr={{ `${count === 0}` }}',
      '    respond 200 json=s',
    ]);
    const code = routeContent(result, 'eq');
    expect(code).toContain('"{}".format(count == 0)');
    expect(code).not.toContain('===');
  });

  test('an interpolation whose rewrite contains quotes stays valid (no f-string quote clash)', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/hdr',
      '    derive s expr={{ `token: ${headers.token}` }}',
      '    respond 200 json=s',
    ]);
    const code = routeContent(result, 'hdr');
    // interp lives OUTSIDE the string literal via .format → no nested-quote clash
    expect(code).toContain('"token: {}".format(request.headers.get("token"))');
    expect(code).not.toContain('f"');
  });
});
