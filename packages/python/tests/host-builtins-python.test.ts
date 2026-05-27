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

  test('Math aggregate builtins lower to Python min/max forms', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/math-aggregate',
      '    derive minV expr={{Math.min(9, Number.floor(2.9), 4)}}',
      '    derive maxV expr={{Math.max(3, Number.ceil(1.2), -5)}}',
      '    derive numberMin expr={{Number.min(10, 2)}}',
      '    derive minEmpty expr={{Math.min()}}',
      '    derive maxEmpty expr={{Math.max()}}',
      '    respond 200 json={{ {minV, maxV, numberMin, minEmpty, maxEmpty} }}',
    ]);
    const code = routeContent(result, 'math_aggregate');
    expect(code).toContain('min(9, __k_math.floor(2.9), 4)');
    expect(code).toContain('max(3, __k_math.ceil(1.2), -5)');
    expect(code).toContain('Number.min(10, 2)');
    expect(code).toContain('float("inf")');
    expect(code).toContain('float("-inf")');
    expect(code).not.toContain('Math.min');
    expect(code).not.toContain('Math.max');
  });

  test('Math.sign lowers to Python ternary expression', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/math-sign',
      '    derive signNeg expr={{Math.sign(-5)}}',
      '    derive signZero expr={{Math.sign(0)}}',
      '    derive signPos expr={{Math.sign(3)}}',
      '    respond 200 json={{ {signNeg, signZero, signPos} }}',
    ]);
    const code = routeContent(result, 'math_sign');
    expect(code).toContain('(1 if -5 > 0 else (-1 if -5 < 0 else 0))');
    expect(code).toContain('(1 if 0 > 0 else (-1 if 0 < 0 else 0))');
    expect(code).toContain('(1 if 3 > 0 else (-1 if 3 < 0 else 0))');
    expect(code).not.toContain('Math.sign');
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

  test('string trim builtin lowers to Python strip()', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/trim',
      '    schema body="{name: string}"',
      '    derive clean expr={{body.name.trim()}}',
      '    respond 200 json=clean',
    ]);
    const code = routeContent(result, 'trim');
    expect(code).toContain('body.name.strip()');
    expect(code).not.toContain('.trim()');
  });

  test('Object/Array/Date builtins lower to Python equivalents', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/objarrdate',
      '    schema body="{raw: string}"',
      '    derive ks expr={{Object.keys(JSON.parse(body.raw))}}',
      '    derive vs expr={{Object.values(JSON.parse(body.raw))}}',
      '    derive es expr={{Object.entries(JSON.parse(body.raw))}}',
      '    derive ok expr={{Array.isArray(vs)}}',
      '    derive t expr={{Date.now()}}',
      '    respond 200 json={{ {ks, vs, es, ok, t} }}',
    ]);
    const code = routeContent(result, 'objarrdate');
    expect(code).toContain('list(json.loads(body.raw).keys())');
    expect(code).toContain('list(json.loads(body.raw).values())');
    expect(code).toContain('list(json.loads(body.raw).items())');
    expect(code).toContain('isinstance(vs, list)');
    expect(code).toContain('int(datetime.now(timezone.utc).timestamp() * 1000)');
    expect(code).toContain('import json');
    expect(code).toContain('from datetime import datetime, timezone');
    expect(code).not.toContain('Object.keys');
    expect(code).not.toContain('Object.values');
    expect(code).not.toContain('Object.entries');
    expect(code).not.toContain('Array.isArray');
    expect(code).not.toContain('Date.now()');
  });

  test('Object.assign lowers to dict merge', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/merge',
      '    schema body="{a: number, b: number}"',
      '    derive merged expr={{Object.assign({}, body, {c: 3})}}',
      '    respond 200 json=merged',
    ]);
    const code = routeContent(result, 'merge');
    expect(code).toContain('{**{}, **body.model_dump(), **{"c": 3}}');
    expect(code).not.toContain('Object.assign');
  });

  test('Object.fromEntries lowers to dict()', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/from-entries',
      '    schema body="{pairs: any}"',
      '    derive obj expr={{Object.fromEntries(body.pairs)}}',
      '    respond 200 json=obj',
    ]);
    const code = routeContent(result, 'from_entries');
    expect(code).toContain('dict(body.pairs)');
    expect(code).not.toContain('Object.fromEntries');
  });

  test('Object.assign and Object.fromEntries inside string literals are not rewritten', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/obj-lit2',
      '    derive s expr={{tag("Object.assign(x,y) Object.fromEntries(z)")}}',
      '    respond 200 json=s',
    ]);
    const code = routeContent(result, 'obj_lit2');
    expect(code).toContain('"Object.assign(x,y) Object.fromEntries(z)"');
    expect(code).not.toContain('dict(z)');
    expect(code).not.toContain('{**x, **y}');
  });

  test('custom receivers ending in Object names are not rewritten for assign/fromEntries', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/obj-recv2',
      '    derive a expr={{myObject.assign(x, y)}}',
      '    derive b expr={{obj.Object.fromEntries(z)}}',
      '    respond 200 json=a',
    ]);
    const code = routeContent(result, 'obj_recv2');
    expect(code).toContain('myObject.assign(x, y)');
    expect(code).toContain('obj.Object.fromEntries(z)');
    expect(code).not.toContain('{**x, **y}');
    expect(code).not.toContain('dict(z)');
  });

  test('Object/Array/Date builtins inside string literals are not rewritten', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/objarrdate-lit',
      '    derive s expr={{tag("Object.keys(x) Array.isArray(y) Date.now()")}}',
      '    respond 200 json=s',
    ]);
    const code = routeContent(result, 'objarrdate_lit');
    expect(code).toContain('"Object.keys(x) Array.isArray(y) Date.now()"');
    expect(code).not.toContain('list(x.keys())');
    expect(code).not.toContain('isinstance(y, list)');
    expect(code).not.toContain('datetime.now(timezone.utc)');
  });

  test('custom receivers ending in Object/Array/Date names are not rewritten', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/objarrdate-recv',
      '    derive a expr={{myObject.keys(v)}}',
      '    derive b expr={{obj.Array.isArray(v)}}',
      '    derive c expr={{clock.Date.now()}}',
      '    respond 200 json=a',
    ]);
    const code = routeContent(result, 'objarrdate_recv');
    expect(code).toContain('myObject.keys(v)');
    expect(code).toContain('obj.Array.isArray(v)');
    expect(code).toContain('clock.Date.now()');
    expect(code).not.toContain('list(v.keys())');
    expect(code).not.toContain('isinstance(v, list)');
    expect(code).not.toContain('datetime.now(timezone.utc)');
  });

  test('nested Object/Array/Date builtins lower with balanced nested bounds', async () => {
    const result = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/objarrdate-nested',
      '    schema body="{raw: string}"',
      '    derive ok expr={{Array.isArray(Object.keys(JSON.parse(body.raw)))}}',
      '    derive t expr={{Object.entries({now: Date.now()})}}',
      '    respond 200 json={{ {ok, t} }}',
    ]);
    const code = routeContent(result, 'objarrdate_nested');
    expect(code).toContain('isinstance(list(json.loads(body.raw).keys()), list)');
    expect(code).toContain('list({"now": int(datetime.now(timezone.utc).timestamp() * 1000)}.items())');
    expect(code).toContain('import json');
    expect(code).toContain('from datetime import datetime, timezone');
    expect(code).not.toContain('Array.isArray');
    expect(code).not.toContain('Object.keys');
    expect(code).not.toContain('Object.entries');
    expect(code).not.toContain('Date.now()');
  });
});
