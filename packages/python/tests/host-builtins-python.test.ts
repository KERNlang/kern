/**
 * FORGE SPEC — portable host-builtin mapping layer (Python target).
 *
 * KERN expressions that use JS host builtins must lower to Python stdlib
 * equivalents in generated route artifacts, AND the artifact must import the
 * required module. These globals are the highest-frequency reason route
 * handlers stay raw `<<<JS>>>` instead of becoming portable nodes.
 *
 * The lowering belongs in the Python codegen expression path (rewriteFastAPIExpr
 * / the portable generators); the imports must reach the route artifact's
 * import set. How those two concerns connect is the design space the forge
 * explores — this spec only fixes the observable behaviour.
 */

describe('Host-builtin mapping (Python target)', () => {
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

  test('crypto.randomUUID() → str(uuid.uuid4()) and imports uuid', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/things',
      '    derive id expr={{crypto.randomUUID()}}',
      '    respond 200 json=id',
    ]);
    const code = routeContent(result, 'things');
    expect(code).toContain('str(uuid.uuid4())');
    expect(code).toContain('import uuid');
    expect(code).not.toContain('crypto.randomUUID');
  });

  test('new Date().toISOString() → datetime ISO string and imports datetime', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/now',
      '    derive ts expr={{new Date().toISOString()}}',
      '    respond 200 json=ts',
    ]);
    const code = routeContent(result, 'now');
    expect(code).toContain('datetime.now(timezone.utc).isoformat()');
    expect(code).toContain('from datetime import datetime, timezone');
    expect(code).not.toContain('new Date()');
  });

  test('JSON.stringify(x) → json.dumps(x) and imports json', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/dump',
      '    schema body="{payload: string}"',
      '    derive s expr={{JSON.stringify(body.payload)}}',
      '    respond 200 json=s',
    ]);
    const code = routeContent(result, 'dump');
    expect(code).toContain('json.dumps(body.payload)');
    expect(code).toContain('import json');
    expect(code).not.toContain('JSON.stringify');
  });

  test('JSON.parse(x) → json.loads(x) and imports json', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/load',
      '    schema body="{raw: string}"',
      '    derive v expr={{JSON.parse(body.raw)}}',
      '    respond 200 json=v',
    ]);
    const code = routeContent(result, 'load');
    expect(code).toContain('json.loads(body.raw)');
    expect(code).toContain('import json');
    expect(code).not.toContain('JSON.parse');
  });

  test('a builtin inside a string literal is NOT rewritten', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/lit',
      '    derive note expr={{tag("crypto.randomUUID()")}}',
      '    respond 200 json=note',
    ]);
    const code = routeContent(result, 'lit');
    expect(code).toContain('"crypto.randomUUID()"');
    expect(code).not.toContain('uuid.uuid4');
  });

  test('a custom receiver ending in a global name is NOT rewritten', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/recv',
      '    derive a expr={{myJSON.stringify(x)}}',
      '    derive b expr={{some.crypto.randomUUID()}}',
      '    respond 200 json=a',
    ]);
    const code = routeContent(result, 'recv');
    expect(code).toContain('myJSON.stringify(x)');
    expect(code).toContain('some.crypto.randomUUID()');
    expect(code).not.toContain('myjson.dumps');
    expect(code).not.toContain('some.str(uuid');
  });

  test('JSON.stringify pretty-print form maps the spacer to indent=', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/pretty',
      '    schema body="{payload: string}"',
      '    derive s expr={{JSON.stringify(body.payload, null, 2)}}',
      '    respond 200 json=s',
    ]);
    const code = routeContent(result, 'pretty');
    expect(code).toContain('json.dumps(body.payload, indent=2)');
    expect(code).not.toContain('None, 2)');
  });

  test('JSON.parse handles a nested call argument', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/nested',
      '    derive v expr={{JSON.parse(read())}}',
      '    respond 200 json=v',
    ]);
    const code = routeContent(result, 'nested');
    expect(code).toContain('json.loads(read())');
  });

  test('JSON.stringify of an object literal (commas in the single arg) still lowers', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/obj',
      '    derive s expr={{JSON.stringify({a: 1, b: 2})}}',
      '    respond 200 json=s',
    ]);
    const code = routeContent(result, 'obj');
    // object keys also get quoted by the later pass; the call itself must lower
    expect(code).toContain('json.dumps({');
    expect(code).toContain('import json');
    expect(code).not.toContain('JSON.stringify');
  });

  test('JSON.parse of a string literal containing commas/braces lowers intact', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/str',
      '    derive v expr={{JSON.parse("{\\"a\\":1,\\"b\\":2}")}}',
      '    respond 200 json=v',
    ]);
    const code = routeContent(result, 'str');
    expect(code).toContain('json.loads(');
    expect(code).not.toContain('JSON.parse');
  });

  test('nested JSON builtins lower both calls', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/round',
      '    schema body="{raw: string}"',
      '    derive r expr={{JSON.stringify(JSON.parse(body.raw))}}',
      '    respond 200 json=r',
    ]);
    const code = routeContent(result, 'round');
    expect(code).toContain('json.dumps(json.loads(body.raw))');
    expect(code).not.toContain('JSON.');
  });

  test('Number/Math arithmetic builtins lower to Python forms and add math import', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/math',
      '    derive floorV expr={{Number.floor(1.8)}}',
      '    derive ceilV expr={{Number.ceil(1.2)}}',
      '    derive roundV expr={{Number.round(2.5)}}',
      '    derive absV expr={{Number.abs(-2)}}',
      '    derive finiteV expr={{Number.isFinite(2)}}',
      '    derive nanV expr={{Number.isNaN(0 / 0)}}',
      '    derive mathFloor expr={{Math.floor(3.9)}}',
      '    respond 200 json=roundV',
    ]);
    const code = routeContent(result, 'math');
    expect(code).toContain('__k_math.floor(1.8)');
    expect(code).toContain('__k_math.ceil(1.2)');
    expect(code).toContain('__k_math.floor(2.5 + 0.5)');
    expect(code).toContain('abs(-2)');
    expect(code).toContain('__k_math.isfinite(2)');
    expect(code).toContain('__k_math.isnan(0 / 0)');
    expect(code).toContain('__k_math.floor(3.9)');
    expect(code).toContain('import math as __k_math');
    expect(code).not.toContain('Number.floor');
    expect(code).not.toContain('Math.floor');
  });

  test('string case builtins lower to Python string methods', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/case',
      '    schema body="{name: string}"',
      '    derive upper expr={{body.name.toUpperCase()}}',
      '    derive lower expr={{body.name.toLowerCase()}}',
      '    respond 200 json=upper',
    ]);
    const code = routeContent(result, 'case');
    expect(code).toContain('body.name.upper()');
    expect(code).toContain('body.name.lower()');
    expect(code).not.toContain('.toUpperCase()');
    expect(code).not.toContain('.toLowerCase()');
  });
});
