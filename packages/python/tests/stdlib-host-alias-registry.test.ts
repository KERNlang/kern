import { spawnSync } from 'node:child_process';
import { emitExpression, emitNativeKernBodyTSWithImports, parseExpression } from '@kernlang/core';
import { emitNativeKernBodyPythonWithImports, emitPyExpressionWithImports } from '../src/codegen-body-python.js';

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

function expectParity(expr: string, setup: { js?: string; py?: string } = {}): void {
  const expected = nodeOracle(expr, setup.js ?? '');
  expect(emittedTs(expr, setup.js ?? '')).toEqual(expected);
  expect(emittedPy(expr, setup.py ?? '')).toEqual(expected);
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
