import { spawnSync } from 'node:child_process';
import { emitExpression, emitNativeKernBodyTSWithImports, parseExpression } from '@kernlang/core';
import { emitNativeKernBodyPythonWithImports, emitPyExpressionWithImports } from '../src/codegen-body-python.js';
import { rewriteExpr } from '../src/core/expr/index.js';

const pythonAvailable = (() => {
  try {
    return spawnSync('python3', ['--version'], { encoding: 'utf-8' }).status === 0;
  } catch {
    return false;
  }
})();
const describeIfPython = pythonAvailable ? describe : describe.skip;

type IRNode = Parameters<typeof emitNativeKernBodyPythonWithImports>[0];

function letHandler(value: string): IRNode {
  return {
    type: 'handler',
    props: { lang: 'kern' },
    children: [{ type: 'let', props: { name: 'r', value } }],
  } as IRNode;
}

const JS_ENCODER = `
function encode(value) {
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { kind: "nan" };
    if (Object.is(value, -0)) return { kind: "negativeZero" };
    if (value === Infinity) return { kind: "positiveInfinity" };
    if (value === -Infinity) return { kind: "negativeInfinity" };
    return { kind: "value", value };
  }
  if (value === undefined) return { kind: "undefined" };
  if (globalThis.Array.isArray(value)) return { kind: "array", items: value.map(encode) };
  if (value && typeof value === "object") {
    return { kind: "object", entries: Object.keys(value).map((key) => [key, encode(value[key])]) };
  }
  return { kind: "value", value };
}
`;

const PY_ENCODER = `
import math
def encode(value):
    if "_KERN_UNDEFINED" in globals() and value is _KERN_UNDEFINED:
        return {"kind": "undefined"}
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return {"kind": "value", "value": value}
    if isinstance(value, (int, float)):
        number = float(value)
        if math.isnan(number):
            return {"kind": "nan"}
        if number == 0 and math.copysign(1.0, number) < 0:
            return {"kind": "negativeZero"}
        if number == float("inf"):
            return {"kind": "positiveInfinity"}
        if number == float("-inf"):
            return {"kind": "negativeInfinity"}
        return {"kind": "value", "value": value}
    if isinstance(value, list):
        return {"kind": "array", "items": [encode(item) for item in value]}
    if isinstance(value, dict):
        return {"kind": "object", "entries": [[str(key), encode(val)] for key, val in value.items()]}
    return {"kind": "value", "value": repr(value)}
`;

function runNode(program: string): unknown {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`node failed (exit ${result.status}):\nstderr=\n${result.stderr}\nprogram=\n${program}`);
  }
  return JSON.parse(result.stdout.trim());
}

function runPython(program: string): unknown {
  const result = spawnSync('python3', ['-c', program], { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`python3 failed (exit ${result.status}):\nstderr=\n${result.stderr}\nprogram=\n${program}`);
  }
  return JSON.parse(result.stdout.trim());
}

function nodeOracle(expr: string, setup = ''): unknown {
  return runNode([JS_ENCODER, setup, `const r = (${expr});`, 'console.log(JSON.stringify(encode(r)));'].join('\n'));
}

function emittedTs(expr: string, setup = ''): unknown {
  const code = emitNativeKernBodyTSWithImports(letHandler(expr)).code;
  return runNode([JS_ENCODER, setup, code, 'console.log(JSON.stringify(encode(r)));'].join('\n'));
}

function emittedPy(expr: string, setup = ''): unknown {
  const result = emitNativeKernBodyPythonWithImports(letHandler(expr));
  const importLines = [...result.imports].sort().map((mod) => `import ${mod} as __k_${mod}`);
  const program = [
    ...importLines,
    [...result.helpers].join('\n\n'),
    setup,
    result.code,
    PY_ENCODER,
    'import json',
    'print(json.dumps(encode(r), separators=(",", ":")))',
  ]
    .filter(Boolean)
    .join('\n');
  return runPython(program);
}

function indentPython(code: string): string {
  return code
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

function nodeRuntimeError(expr: string): unknown {
  return runNode(
    [
      JS_ENCODER,
      'try {',
      `  const r = (${expr});`,
      '  console.log(JSON.stringify({ threw: false, value: encode(r) }));',
      '} catch (error) {',
      '  console.log(JSON.stringify({ threw: true, name: error?.name, message: String(error?.message) }));',
      '}',
    ].join('\n'),
  );
}

function emittedTsRuntimeError(expr: string): unknown {
  const code = emitNativeKernBodyTSWithImports(letHandler(expr)).code;
  return runNode(
    [
      JS_ENCODER,
      'try {',
      code,
      '  console.log(JSON.stringify({ threw: false, value: encode(r) }));',
      '} catch (error) {',
      '  console.log(JSON.stringify({ threw: true, name: error?.name, message: String(error?.message) }));',
      '}',
    ].join('\n'),
  );
}

function emittedPyRuntimeError(expr: string): unknown {
  const result = emitNativeKernBodyPythonWithImports(letHandler(expr));
  const importLines = [...result.imports].sort().map((mod) => `import ${mod} as __k_${mod}`);
  const program = [
    ...importLines,
    [...result.helpers].join('\n\n'),
    PY_ENCODER,
    'import json',
    'try:',
    indentPython(result.code),
    '    print(json.dumps({"threw": False, "value": encode(r)}, separators=(",", ":")))',
    'except Exception as error:',
    '    print(json.dumps({"threw": True, "name": type(error).__name__, "message": str(error)}, separators=(",", ":")))',
  ]
    .filter(Boolean)
    .join('\n');
  return runPython(program);
}

function expectParity(expr: string, setup: { js?: string; py?: string } = {}): void {
  const expected = nodeOracle(expr, setup.js ?? '');
  expect(emittedTs(expr, setup.js ?? '')).toEqual(expected);
  expect(emittedPy(expr, setup.py ?? '')).toEqual(expected);
}

function expectThrowParity(expr: string): void {
  const expected = nodeRuntimeError(expr);
  expect(expected).toEqual({ threw: true, name: 'RangeError', message: 'Invalid array length' });
  expect(emittedTsRuntimeError(expr)).toEqual(expected);
  expect(emittedPyRuntimeError(expr)).toEqual(expected);
}

describeIfPython('Milestone A stdlib host aliases — executable TS/Python parity', () => {
  test.each([
    'Math.max(4, -2, 9, 3)',
    'Math.max()',
    'Math.max(NaN, 1)',
    'Math.max(1, 2, NaN)',
    'Math.max(-0)',
    'Math.max(-0, -1)',
    'Math.max(...[1, 7, 3])',
    'Math.min(4, -2, 9, 3)',
    'Math.min()',
    'Math.min(NaN, 1)',
    'Math.min(1, -2, NaN)',
    'Math.min(-0)',
    'Math.min(-0, 1)',
    'Math.round(1.5)',
    'Math.round(0.49999999999999994)',
    'Math.round(-1.5)',
    'Math.round(-0.5)',
    'Math.round(-0.1)',
    'Math.floor(-2.5)',
    'Math.floor(2.9)',
    'Math.floor(-0)',
    'Math.sign(-0)',
    'Math.trunc(-0.1)',
    'Array.isArray([1, 2])',
    'Array.isArray({0: "a", length: 1})',
    'Array.isArray("ab")',
    'Array.isArray(null)',
    'Array.isArray([[1], [2]][0])',
    'Array.from(1)',
    'Array.from(true)',
    'Array.from({a: 1})',
    'Array.from({len: 2})',
    'Array.from([1, 2], (value) => value * 2)',
    'Array.from({0: "a", 2: "c", length: 3}, (value, index) => [value, index])',
    'Array.from("ab", (value, index) => index + ":" + value)',
    'Array.from("😃")',
    'Array.from({0: "a", 1: "b", length: 2}, (value, index) => value + ":" + index)',
    'Array.from({ length: 2 }, (_, i) => Array.from({ length: 2 }, (_, j) => i * 2 + j))',
    'Object.keys({"2": "two", "1": "one", x: "ex"})',
    'Object.keys(42)',
    'Object.assign({a: 1}, {b: 2}, {a: 3})',
    'Object.assign([], {0: "a", 1: "b"})',
    'Object.assign(1, {a: 2})',
    'Object.assign("ab", {x: "y"})',
    'JSON.parse("{\\"a\\":1}")',
    'JSON.stringify({a: undefined, b: null, c: 1})',
    'JSON.stringify([undefined, null, 1])',
  ])('%s', (expr) => {
    expectParity(expr);
  });

  test('Math.max preserves argument evaluation order', () => {
    const jsSetup = 'const calls = []; function mark(label, value) { calls.push(label); return value; }';
    const pySetup = 'calls = []\ndef mark(label, value):\n    calls.append(label)\n    return value';
    const expr = 'Math.max(mark("A", 1), mark("B", 3), mark("C", 2))';
    expectParity(expr, { js: jsSetup, py: pySetup });
    const ts = runNode(
      [
        JS_ENCODER,
        jsSetup,
        emitNativeKernBodyTSWithImports(letHandler(expr)).code,
        'console.log(JSON.stringify({ value: encode(r), calls }));',
      ].join('\n'),
    );
    const pyResult = emitNativeKernBodyPythonWithImports(letHandler(expr));
    const py = runPython(
      [
        [...pyResult.helpers].join('\n\n'),
        pySetup,
        pyResult.code,
        PY_ENCODER,
        'import json',
        'print(json.dumps({"value": encode(r), "calls": calls}, separators=(",", ":")))',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    expect(ts).toEqual({ value: nodeOracle(expr, jsSetup), calls: ['A', 'B', 'C'] });
    expect(py).toEqual(ts);
  });

  test('Number.round uses the same negative-zero-preserving semantics as Math.round', () => {
    for (const value of ['-0.5', '0.49999999999999994']) {
      const expected = nodeOracle(`Math.round(${value})`);
      expect(emittedTs(`Number.round(${value})`)).toEqual(expected);
      expect(emittedPy(`Number.round(${value})`)).toEqual(expected);
    }
  });

  test('Number.isInteger / isSafeInteger match JS and reject booleans (no coercion)', () => {
    // The bool rows are the kill fixtures: Python's bool subclasses int, so a
    // naive isinstance(x, int) would wrongly return True for `true`.
    const cases = [
      'Number.isInteger(5)',
      'Number.isInteger(5.5)',
      'Number.isInteger(true)',
      'Number.isInteger(NaN)',
      'Number.isInteger(Infinity)',
      'Number.isSafeInteger(9007199254740991)',
      'Number.isSafeInteger(9007199254740992)',
      'Number.isSafeInteger(true)',
    ];
    for (const expr of cases) {
      const expected = nodeOracle(expr);
      expect(emittedTs(expr)).toEqual(expected);
      expect(emittedPy(expr)).toEqual(expected);
    }
  });

  test('Array.from evaluates source before mapper calls and only once', () => {
    const jsSetup = 'const calls = []; function mark(label, value) { calls.push(label); return value; }';
    const pySetup = 'calls = []\ndef mark(label, value):\n    calls.append(label)\n    return value';
    const expr = 'Array.from(mark("S", [3, 4]), (value, index) => mark("M" + index, value * 2))';
    const codeTs = emitNativeKernBodyTSWithImports(letHandler(expr)).code;
    const ts = runNode(
      [JS_ENCODER, jsSetup, codeTs, 'console.log(JSON.stringify({ value: encode(r), calls }));'].join('\n'),
    );
    const pyResult = emitNativeKernBodyPythonWithImports(letHandler(expr));
    const py = runPython(
      [
        [...pyResult.helpers].join('\n\n'),
        pySetup,
        pyResult.code,
        PY_ENCODER,
        'import json',
        'print(json.dumps({"value": encode(r), "calls": calls}, separators=(",", ":")))',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    expect(ts).toEqual({ value: nodeOracle(expr, jsSetup), calls: ['S', 'M0', 'M1'] });
    expect(py).toEqual(ts);
  });

  test('Array.from length validation matches Node before materialization', () => {
    expectParity('Array.from({ length: 3 }, (_, i) => i)');
    expectParity('Array.from({ length: NaN })');
    expectThrowParity('Array.from({ length: Infinity })');
    expectThrowParity('Array.from({ length: 9007199254740992 })');
  });
});

describeIfPython('Milestone A stdlib host aliases — reserved namespace and fail-closed controls', () => {
  test('compat aliases are reserved stdlib namespaces for this milestone', () => {
    const arrayExpr = parseExpression('Array.isArray([1])');
    const tsArray = emitExpression(arrayExpr);
    const pyArray = emitPyExpressionWithImports(arrayExpr, { outerBindings: ['Array'] });
    expect(tsArray).toBe('Array.isArray([1])');
    expect(pyArray.code).toBe('isinstance([1], list)');
    expect(() => emitExpression(parseExpression('Math.sqrt(x)'))).toThrow(
      /Unknown KERN-stdlib method\/member 'Math\.sqrt'/,
    );
    expect(() =>
      emitPyExpressionWithImports(parseExpression('Math.sqrt(x)'), { outerBindings: ['Math', 'x'] }),
    ).toThrow(/Unknown KERN-stdlib method\/member 'Math\.sqrt'/);
  });

  test.each([
    'Date.now()',
    'console.log("x")',
    'process.env.HOME',
    'Math.random()',
    'Math["random"]()',
  ])('%s stays fail-closed', (expr) => {
    expect(() => emitNativeKernBodyPythonWithImports(letHandler(expr))).toThrow();
  });

  test.each([
    'Array.from({ length: 1 }, (v, i) => i, { tag: "x" })',
    'Math.max',
  ])('%s is explicitly refused rather than silently wrong', (expr) => {
    expect(() => emitNativeKernBodyPythonWithImports(letHandler(expr))).toThrow();
  });

  test('Array.from spread is refused on both targets', () => {
    const expr = parseExpression('Array.from(...args)');
    expect(() => emitExpression(expr)).toThrow(/Array\.from portable lowering does not accept spread arguments/);
    expect(() => emitNativeKernBodyPythonWithImports(letHandler('Array.from(...args)'))).toThrow(
      /Array\.from portable lowering does not accept spread arguments/,
    );
  });

  test.each(['Array.from(null)', 'Array.from(undefined)'])('%s throws on both emitted targets', (expr) => {
    expect(() => emittedTs(expr)).toThrow();
    expect(() => emittedPy(expr)).toThrow();
  });

  test('function-template stdlib calls conservatively wrap type assertions', () => {
    expect(emitExpression(parseExpression('Math.max(value as number, 1)'))).toBe('Math.max((value as number), 1)');
  });
});

// The FastAPI/route/portable pipeline (rewriteExpr) lowers
// `Array.from({length: N}, mapper)` to a Python list comprehension. Before this
// fix it emitted a RAW `range(N)` with ZERO length validation, so the route path
// diverged from BOTH JS and the already-correct native-body path:
//   - `range(Infinity)` / `range(NaN)` are Python NameErrors (bare words),
//   - an Infinity / over-2**32-1 length must throw RangeError (it did not), and
//   - a huge finite length would materialize billions of elements (DoS) rather
//     than throwing as JS does.
// The fix routes the count through the SAME `_kern_array_like_length` guard the
// native path uses, so the route path matches JS exactly. These fixtures hit the
// route path (rewriteExpr), assert the emitted CONTENT no longer contains the
// raw `range(Infinity)`/`range(NaN)` forms, and EXECUTE the emitted Python to
// confirm the JS-observed semantics (each row paired with a Node oracle).
describeIfPython('Array.from route-path length guard (rewriteExpr) — JS parity', () => {
  function rewriteRoute(expr: string): { code: string; helpers: string } {
    const imports = new Set<string>();
    const code = rewriteExpr(expr, [], new Set(), false, imports);
    const helpers = [...imports].filter((i) => i.includes('def _kern')).join('\n\n');
    return { code, helpers };
  }

  // Execute the route-emitted comprehension and report throw/value, mirroring the
  // Node oracle shape (`nodeRuntimeError` above).
  function runRoutePy(expr: string, materialize: boolean): unknown {
    const { code, helpers } = rewriteRoute(expr);
    const target = materialize ? code : `len(${code})`;
    const program = [
      helpers,
      'import json',
      'try:',
      `    __r = (${target})`,
      '    print(json.dumps({"threw": False, "value": __r if isinstance(__r, (int, list)) else str(__r)}, separators=(",", ":")))',
      'except Exception as error:',
      '    print(json.dumps({"threw": True, "name": type(error).__name__, "message": str(error)}, separators=(",", ":")))',
    ]
      .filter(Boolean)
      .join('\n');
    return runPython(program);
  }

  // Call the length helper directly so the boundary is checked WITHOUT
  // materializing a multi-billion-element list (JS would OOM at 2**32-1, not
  // throw a validation error — so the boundary lives in the helper, not the
  // comprehension).
  function lengthGuard(value: string): unknown {
    // Source the guard helper from a NON-literal count: a literal count (e.g.
    // `{length: 1}`) now takes the clean fast-path and emits NO helper, so use an
    // identifier to force the `_kern_array_like_length` definition into scope.
    const { helpers } = rewriteRoute('Array.from({length: n}, (_, i) => i)');
    const program = [
      helpers,
      'import json',
      'try:',
      `    print(json.dumps({"threw": False, "value": _kern_array_like_length({"length": ${value}})}, separators=(",", ":")))`,
      'except Exception as error:',
      '    print(json.dumps({"threw": True, "name": type(error).__name__, "message": str(error)}, separators=(",", ":")))',
    ].join('\n');
    return runPython(program);
  }

  test('the route path no longer emits an unguarded range()', () => {
    // Killer rows: the buggy impl emitted these verbatim. These are NON-literal /
    // non-finite counts, so they take the validated guard path (not the fast-path).
    expect(rewriteRoute('Array.from({length: Infinity}, (_, i) => i)').code).not.toContain('range(Infinity)');
    expect(rewriteRoute('Array.from({length: NaN}, (_, i) => i)').code).not.toContain('range(NaN)');
    // A non-literal (identifier) count still routes through the validated helper.
    expect(rewriteRoute('Array.from({length: n}, (_, i) => i)').code).toContain('_kern_array_like_length');
  });

  test('a safe integer-literal length takes the clean range() fast-path (no helper)', () => {
    // `3` is a valid JS array length (<= 2**32-1); the fast-path emits the clean
    // `range(3)` form with NO `_kern_array_like_length` helper and NO normalize
    // pass — exact parity with JS and the original golden output, zero cold-start.
    const { code, helpers } = rewriteRoute('Array.from({length: 3}, (_, i) => i)');
    expect(code).toContain('range(3)');
    expect(code).not.toContain('_kern_array_like_length');
    expect(helpers).toBe('');
  });

  test('Infinity length throws RangeError (not a Python NameError)', () => {
    // Node oracle.
    expect(nodeRuntimeError('Array.from({length: Infinity}, (_, i) => i)')).toEqual({
      threw: true,
      name: 'RangeError',
      message: 'Invalid array length',
    });
    expect(runRoutePy('Array.from({length: Infinity}, (_, i) => i)', true)).toEqual({
      threw: true,
      name: 'RangeError',
      message: 'Invalid array length',
    });
  });

  test('NaN length yields an empty array (no throw, no range(NaN))', () => {
    expect(nodeOracle('Array.from({length: NaN}, (_, i) => i)')).toEqual({ kind: 'array', items: [] });
    expect(runRoutePy('Array.from({length: NaN}, (_, i) => i)', true)).toEqual({ threw: false, value: [] });
  });

  test('a length above 2**32-1 throws (kills any "guard at 2**53" mistake)', () => {
    expect(nodeRuntimeError('Array.from({length: 4294967296}, (_, i) => i)')).toEqual({
      threw: true,
      name: 'RangeError',
      message: 'Invalid array length',
    });
    expect(lengthGuard('4294967296')).toEqual({ threw: true, name: 'RangeError', message: 'Invalid array length' });
    // 2**53 must ALSO throw — a "guard only at 2**53" boundary would wrongly let
    // 4294967296 through.
    expect(lengthGuard('2**53')).toEqual({ threw: true, name: 'RangeError', message: 'Invalid array length' });
    // A LITERAL `> 2**32-1` must NOT take the clean fast-path — it has to route
    // through the validated guard so it throws (never `range(4294967296)`).
    const code = rewriteRoute('Array.from({length: 4294967296}, (_, i) => i)').code;
    expect(code).toContain('_kern_array_like_length');
    expect(code).not.toContain('range(4294967296)');
  });

  test('2**32-1 is the boundary-exact OK case (no validation throw)', () => {
    // JS does NOT throw a validation error at 4294967295 — it accepts the length
    // (and would OOM materializing). The guard returns the int unchanged.
    expect(lengthGuard('4294967295')).toEqual({ threw: false, value: 4294967295 });
    // At the route level, `4294967295` (<= 2**32-1) is on the clean fast-path:
    // assert the EMITTED CONTENT is `range(4294967295)` (do NOT execute it — JS
    // would also OOM materializing 4 billion elements; this is content-only).
    const code = rewriteRoute('Array.from({length: 4294967295}, (_, i) => i)').code;
    expect(code).toContain('range(4294967295)');
    expect(code).not.toContain('_kern_array_like_length');
  });

  test('a finite in-range length still produces the mapped array', () => {
    expect(nodeOracle('Array.from({length: 3}, (_, i) => i)')).toEqual({
      kind: 'array',
      items: [
        { kind: 'value', value: 0 },
        { kind: 'value', value: 1 },
        { kind: 'value', value: 2 },
      ],
    });
    expect(runRoutePy('Array.from({length: 3}, (_, i) => i)', true)).toEqual({ threw: false, value: [0, 1, 2] });
  });

  test('nested Array.from lowers the inner length too (literal fast-path)', () => {
    const expr = 'Array.from({length: 2}, (_, i) => Array.from({length: 2}, (_, j) => i * 2 + j))';
    // Both literal lengths take the clean fast-path; the inner comprehension is
    // still recursively lowered (not a single outer-only fix).
    const code = rewriteRoute(expr).code;
    expect((code.match(/range\(2\)/g) || []).length).toBe(2);
    expect(code).not.toContain('_kern_array_like_length');
    expect(runRoutePy(expr, true)).toEqual({
      threw: false,
      value: [
        [0, 1],
        [2, 3],
      ],
    });
  });

  test('a nested NON-literal inner length still routes through the guard', () => {
    // Outer literal `2` → fast-path; inner identifier `n` → validated guard. The
    // recursive lowering must NOT swallow the inner guard when the outer is clean.
    const expr = 'Array.from({length: 2}, (_, i) => Array.from({length: n}, (_, j) => i + j))';
    const code = rewriteRoute(expr).code;
    expect((code.match(/_kern_array_like_length/g) || []).length).toBe(1);
    expect(code).toContain('range(2)');
  });

  test('-Infinity length yields an empty array (no throw, no bare range(-Infinity))', () => {
    // JS oracle: Array.from({length: -Infinity}, …) === []. The negative-infinity
    // count lowers to `-float('inf')`; `_kern_array_like_length` returns 0 for
    // `__k_num <= 0` → range(0) → []. NEVER a bare `range(-Infinity)` (NameError).
    expect(nodeOracle('Array.from({length: -Infinity}, (_,i)=>i)')).toEqual({ kind: 'array', items: [] });
    const code = rewriteRoute('Array.from({length: -Infinity}, (_,i)=>i)').code;
    expect(code).not.toContain('range(-Infinity)');
    expect(code).toContain("-float('inf')");
    expect(runRoutePy('Array.from({length: -Infinity}, (_,i)=>i)', true)).toEqual({ threw: false, value: [] });
  });

  test('a negative finite length yields an empty array', () => {
    // JS oracle: Array.from({length: -1}, …) === [].
    expect(nodeOracle('Array.from({length: -1}, (_,i)=>i)')).toEqual({ kind: 'array', items: [] });
    expect(runRoutePy('Array.from({length: -1}, (_,i)=>i)', true)).toEqual({ threw: false, value: [] });
  });

  test('an object-literal KEY named Infinity in the body is NOT corrupted (regression)', () => {
    // REGRESSION GUARD: running `normalizeNumericWordLiterals` over the mapper
    // BODY corrupted a JS object-literal KEY `Infinity` into the Python float
    // `float('inf')` (`{float('inf'): 1}`), a SILENT cross-target divergence —
    // JS keeps the string key `"Infinity"`. The body is therefore NO LONGER
    // normalized (deliberate, fail-loud: a bare body `Infinity` instead emits a
    // Python NameError, which is loud, not silent corruption). String-level
    // normalization cannot tell an object-key `:` from a ternary `:`.
    const body = rewriteRoute('Array.from({length: 1}, () => ({Infinity: 1}))').code;
    expect(body).not.toContain("float('inf')");
    // The literal key survives — the JS string key, not a Python float.
    expect(body).toContain('Infinity');
  });

  test('spaced member access (obj . Infinity) is preserved in the COUNT, not rewritten', () => {
    // The spaced member-access form must NOT be mistaken for a bare `Infinity`
    // literal in the (normalized) COUNT position. Before the backward-whitespace
    // scan this emitted `obj . float('inf')` (invalid Python, wrong semantics).
    // The property access must survive; emitted-content assertion (a runnable
    // `obj` is out of scope for this pure-lowering check). The BODY is never
    // normalized now, so `obj . Infinity` there is trivially preserved.
    const countCode = rewriteRoute('Array.from({length: obj . Infinity}, (_,i)=>i)').code;
    expect(countCode).toContain('obj . Infinity');
    expect(countCode).not.toContain("float('inf')");
    const bodyCode = rewriteRoute('Array.from({length: 2}, () => obj . Infinity)').code;
    expect(bodyCode).toContain('obj . Infinity');
    expect(bodyCode).not.toContain("float('inf')");
    // The compact form was already preserved — guard the count regression both ways.
    const compactCode = rewriteRoute('Array.from({length: obj.Infinity}, (_,i)=>i)').code;
    expect(compactCode).toContain('obj.Infinity');
    expect(compactCode).not.toContain("float('inf')");
  });
});
