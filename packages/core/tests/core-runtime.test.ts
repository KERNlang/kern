import {
  CoreRuntimeEnv,
  callCoreFunction,
  createCoreRuntimeEnv,
  evalCoreExpression,
  fromHostValue,
  kBoolean,
  kernTruthy,
  kNull,
  kNumber,
  kString,
  kUndefined,
  runCoreRuntime,
  toHostValue,
} from '../src/index.js';
import type { IRNode } from '../src/types.js';

function handler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('KERN core runtime values and expressions', () => {
  test('truthiness is owned by KERN values', () => {
    expect(kernTruthy(kNull())).toBe(false);
    expect(kernTruthy(kUndefined())).toBe(false);
    expect(kernTruthy(kBoolean(false))).toBe(false);
    expect(kernTruthy(kNumber(0))).toBe(false);
    expect(kernTruthy(kString(''))).toBe(false);
    expect(kernTruthy(kString('x'))).toBe(true);
  });

  test('String(value) uses KERN coercion, not host spelling', () => {
    const env = createCoreRuntimeEnv({
      globals: {
        n: 12,
        none: null,
        yes: true,
        no: false,
      },
    });
    expect(toHostValue(evalCoreExpression('String(n)', env))).toBe('12');
    expect(toHostValue(evalCoreExpression('String(none)', env))).toBe('null');
    expect(toHostValue(evalCoreExpression('String(yes)', env))).toBe('true');
    expect(toHostValue(evalCoreExpression('String(no)', env))).toBe('false');
  });

  test('null and undefined are distinct but both nullish', () => {
    expect(toHostValue(kNull())).toBeNull();
    expect(toHostValue(kUndefined())).toBeUndefined();
    const env = createCoreRuntimeEnv({ globals: { a: undefined, b: null, c: 5 } });
    expect(toHostValue(evalCoreExpression('a ?? c', env))).toBe(5);
    expect(toHostValue(evalCoreExpression('b ?? c', env))).toBe(5);
  });

  test('plain host records with kind fields are not mistaken for KERN values', () => {
    const value = fromHostValue({ kind: 'trap', label: 'Trap' });
    expect(toHostValue(value)).toEqual({ kind: 'trap', label: 'Trap' });
    expect(toHostValue(fromHostValue({ kind: 'null', label: 'Trap' }))).toEqual({ kind: 'null', label: 'Trap' });
    expect(toHostValue(fromHostValue({ kind: 'string', value: 'x', label: 'Trap' }))).toEqual({
      kind: 'string',
      label: 'Trap',
      value: 'x',
    });
    expect(toHostValue(fromHostValue({ kind: 'string', value: 'door' }))).toEqual({ kind: 'string', value: 'door' });
  });

  test('record maps use own properties only', () => {
    const value = fromHostValue({ a: 1 });
    if (value.kind !== 'record') throw new Error('expected record value');
    expect(Object.getPrototypeOf(value.entries)).toBeNull();
    const env = createCoreRuntimeEnv({ globals: { record: value } });
    expect(toHostValue(evalCoreExpression('record.a', env))).toBe(1);
    expect(toHostValue(evalCoreExpression('record.toString', env))).toBeUndefined();
  });

  test('sparse host arrays become dense KERN arrays with undefined entries', () => {
    const host = [] as unknown[];
    host[1] = 'set';
    expect(toHostValue(fromHostValue(host))).toEqual([undefined, 'set']);
  });

  test('caller-created envs still get portable builtins for expression evaluation', () => {
    const env = new CoreRuntimeEnv();
    env.define('flag', kBoolean(false));
    expect(toHostValue(evalCoreExpression('String(flag)', env))).toBe('false');
  });

  test('structural equality preserves undefined/null distinctions in arrays and records', () => {
    const env = createCoreRuntimeEnv({
      globals: {
        xs: [undefined],
        ys: [null],
        a: { value: undefined },
        b: {},
      },
    });
    expect(toHostValue(evalCoreExpression('xs === ys', env))).toBe(false);
    expect(toHostValue(evalCoreExpression('a === b', env))).toBe(false);
  });

  test('string index misses return KERN undefined', () => {
    const env = createCoreRuntimeEnv({ globals: { label: 'ab' } });
    expect(toHostValue(evalCoreExpression('label[1]', env))).toBe('b');
    expect(toHostValue(evalCoreExpression('label["1"]', env))).toBe('b');
    expect(toHostValue(evalCoreExpression('label[4]', env))).toBeUndefined();
    expect(toHostValue(evalCoreExpression('label[""]', env))).toBeUndefined();
    expect(toHostValue(evalCoreExpression('label["1.0"]', env))).toBeUndefined();
  });

  test('optional index skips unresolved index expressions for nullish objects', () => {
    const env = createCoreRuntimeEnv({ globals: { maybe: null } });
    expect(toHostValue(evalCoreExpression('maybe?.[missingName]', env))).toBeUndefined();
  });

  test('optional calls skip unresolved argument expressions for nullish callees', () => {
    const env = createCoreRuntimeEnv({ globals: { maybeFn: null } });
    expect(toHostValue(evalCoreExpression('maybeFn?.(missingName)', env))).toBeUndefined();
  });

  test('division by zero fails with a KERN runtime diagnostic', () => {
    const env = createCoreRuntimeEnv();
    expect(() => evalCoreExpression('4 / 0', env)).toThrow(/division by zero/);
    expect(() => evalCoreExpression('4 % 0', env)).toThrow(/division by zero/);
  });
});

describe('KERN core runtime statements', () => {
  test('runs let, expression-v1, and return', () => {
    const result = runCoreRuntime(
      handler([
        { type: 'let', props: { name: 'count', value: '41' } },
        { type: 'expression-v1', props: { name: 'label', expr: '`n=${count + 1}`' } },
        { type: 'return', props: { value: 'label' } },
      ]),
    );
    expect(result.completion.kind).toBe('return');
    expect(toHostValue(result.completion.value)).toBe('n=42');
  });

  test('if/else executes only the selected branch and block-local lets do not leak', () => {
    const result = runCoreRuntime(
      handler([
        { type: 'let', props: { name: 'x', value: '1' } },
        { type: 'if', props: { cond: 'false' }, children: [{ type: 'let', props: { name: 'x', value: '2' } }] },
        { type: 'else', children: [{ type: 'let', props: { name: 'y', value: '3' } }] },
        { type: 'return', props: { value: 'x' } },
      ]),
    );
    expect(toHostValue(result.completion.value)).toBe(1);
    expect(() => result.env.lookup('y')).toThrow(/not found/);
  });

  test('coalesce and firstDefined preserve falsy defined values', () => {
    const result = runCoreRuntime(
      handler([
        { type: 'let', props: { name: 'missing', value: 'undefined' } },
        { type: 'let', props: { name: 'zero', value: '0' } },
        { type: 'let', props: { name: 'flag', value: 'false' } },
        { type: 'let', props: { name: 'empty', value: '""' } },
        { type: 'coalesce', props: { name: 'a', values: "missing, zero, 'fallback'" } },
        { type: 'firstDefined', props: { name: 'b', values: "missing, flag, 'fallback'" } },
        { type: 'coalesce', props: { name: 'c', values: "missing, empty, 'fallback'" } },
        { type: 'return', props: { value: '{ a: a, b: b, c: c }' } },
      ]),
    );
    expect(toHostValue(result.completion.value)).toEqual({ a: 0, b: false, c: '' });
  });

  test('coalesce and firstTruthy short-circuit later expressions', () => {
    const result = runCoreRuntime(
      handler([
        { type: 'let', props: { name: 'present', value: '"ok"' } },
        { type: 'coalesce', props: { name: 'a', values: 'present, missingName' } },
        { type: 'firstTruthy', props: { name: 'b', values: 'present, alsoMissing' } },
        { type: 'return', props: { value: '{ a: a, b: b }' } },
      ]),
    );
    expect(toHostValue(result.completion.value)).toEqual({ a: 'ok', b: 'ok' });
  });
});

describe('KERN core runtime functions', () => {
  test('nested fn captures the lexical environment and returns through its own frame', () => {
    const result = runCoreRuntime(
      handler([
        { type: 'let', props: { name: 'base', value: '10' } },
        {
          type: 'fn',
          props: { name: 'addBase', params: 'amount:number', returns: 'number' },
          children: [
            {
              type: 'handler',
              props: { lang: 'kern' },
              children: [{ type: 'return', props: { value: 'amount + base' } }],
            },
          ],
        },
        { type: 'let', props: { name: 'total', value: 'addBase(5)' } },
        { type: 'return', props: { value: 'total' } },
      ]),
    );
    expect(toHostValue(result.completion.value)).toBe(15);
  });

  test('function params shadow outer bindings without mutating them', () => {
    const result = runCoreRuntime(
      handler([
        { type: 'let', props: { name: 'x', value: '1' } },
        {
          type: 'fn',
          props: { name: 'echo', params: 'x:number', returns: 'number' },
          children: [
            {
              type: 'handler',
              props: { lang: 'kern' },
              children: [{ type: 'return', props: { value: 'x' } }],
            },
          ],
        },
        { type: 'let', props: { name: 'inner', value: 'echo(7)' } },
        { type: 'return', props: { value: '{ outer: x, inner: inner }' } },
      ]),
    );
    expect(toHostValue(result.completion.value)).toEqual({ outer: 1, inner: 7 });
  });

  test('function parameter defaults evaluate in the call frame', () => {
    const result = runCoreRuntime(
      handler([
        { type: 'let', props: { name: 'base', value: '5' } },
        {
          type: 'fn',
          props: { name: 'fill', params: 'x:number=base + 2,y:number=x + 3', returns: 'number' },
          children: [
            {
              type: 'handler',
              props: { lang: 'kern' },
              children: [{ type: 'return', props: { value: 'y' } }],
            },
          ],
        },
        { type: 'return', props: { value: 'fill()' } },
      ]),
    );
    expect(toHostValue(result.completion.value)).toBe(10);
  });

  test('explicit KERN undefined triggers function parameter defaults', () => {
    const fnNode: IRNode = {
      type: 'fn',
      props: { name: 'fallback', params: 'value:number=3', returns: 'number' },
      children: [
        {
          type: 'handler',
          props: { lang: 'kern' },
          children: [{ type: 'return', props: { value: 'value' } }],
        },
      ],
    };
    const result = callCoreFunction(fnNode, [kUndefined()]);
    expect(toHostValue(result.value)).toBe(3);
  });

  test('legacy parameter parsing preserves colons inside type text', () => {
    const fnNode: IRNode = {
      type: 'fn',
      props: { name: 'readA', params: 'obj:{a:number,b:string}={ a: 1, b: "x" }', returns: 'number' },
      children: [
        {
          type: 'handler',
          props: { lang: 'kern' },
          children: [{ type: 'return', props: { value: 'obj.a' } }],
        },
      ],
    };
    const result = callCoreFunction(fnNode, []);
    expect(toHostValue(result.value)).toBe(1);
  });

  test('structured param child defaults are supported', () => {
    const fnNode: IRNode = {
      type: 'fn',
      props: { name: 'greet', returns: 'string' },
      children: [
        { type: 'param', props: { name: 'name', type: 'string', value: 'world' }, __quotedProps: ['value'] },
        {
          type: 'handler',
          props: { lang: 'kern' },
          children: [{ type: 'return', props: { value: '`hi ${name}`' } }],
        },
      ],
    };
    const result = callCoreFunction(fnNode, []);
    expect(toHostValue(result.value)).toBe('hi world');
  });

  test('structured default prop quoting is supported', () => {
    const fnNode: IRNode = {
      type: 'fn',
      props: { name: 'greet', returns: 'string' },
      children: [
        { type: 'param', props: { name: 'name', type: 'string', default: 'world' }, __quotedProps: ['default'] },
        {
          type: 'handler',
          props: { lang: 'kern' },
          children: [{ type: 'return', props: { value: '`hi ${name}`' } }],
        },
      ],
    };
    const result = callCoreFunction(fnNode, []);
    expect(toHostValue(result.value)).toBe('hi world');
  });

  test('callCoreFunction executes a top-level fn with host args', () => {
    const fnNode: IRNode = {
      type: 'fn',
      props: { name: 'label', params: 'value:number', returns: 'string' },
      children: [
        {
          type: 'handler',
          props: { lang: 'kern' },
          children: [{ type: 'return', props: { value: '`v=${value}`' } }],
        },
      ],
    };
    const result = callCoreFunction(fnNode, [fromHostValue(9)]);
    expect(toHostValue(result.value)).toBe('v=9');
  });
});
