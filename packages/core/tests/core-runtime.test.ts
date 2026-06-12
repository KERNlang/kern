import {
  CORE_FIXTURE_FUNCTION,
  CORE_FIXTURE_UNDEFINED,
  CoreRuntimeContractAdapterError,
  CoreRuntimeEnv,
  callCoreFunction,
  coreFixtureValueToKernValue,
  createCoreRuntimeEnv,
  evalCoreExpression,
  fromHostValue,
  kBoolean,
  kernTruthy,
  kernValueToCoreFixtureValue,
  kNull,
  kNumber,
  kString,
  kUndefined,
  roundTripKernContractDataValue,
  runCoreRuntime,
  toHostValue,
} from '../src/index.js';
import { parse } from '../src/parser.js';
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

  test('string length and index use KERN code-point semantics in the VM', () => {
    const env = createCoreRuntimeEnv({ globals: { label: 'a𐐷b', combo: 'e\u0301x' } });
    expect(toHostValue(evalCoreExpression('label.length', env))).toBe(3);
    expect(toHostValue(evalCoreExpression('label[1]', env))).toBe('𐐷');
    expect(toHostValue(evalCoreExpression('combo.length', env))).toBe(3);
    expect(toHostValue(evalCoreExpression('combo[1]', env))).toBe('\u0301');
  });

  test('string methods dispatch through KERN core contracts in the VM', () => {
    const env = createCoreRuntimeEnv({ globals: { label: 'a𐐷b', word: '  KERN  ' } });
    expect(toHostValue(evalCoreExpression('label.slice(1, 2)', env))).toBe('𐐷');
    expect(toHostValue(evalCoreExpression('label.index(1)', env))).toBe('𐐷');
    expect(toHostValue(evalCoreExpression('label.index(3)', env))).toBeUndefined();
    expect(() => evalCoreExpression('label.slice(1)', env)).toThrow('String.slice expects String, Number, Number.');
    expect(toHostValue(evalCoreExpression('label.includes("𐐷")', env))).toBe(true);
    expect(toHostValue(evalCoreExpression('label.startsWith("a")', env))).toBe(true);
    expect(toHostValue(evalCoreExpression('label.endsWith("b")', env))).toBe(true);
    expect(toHostValue(evalCoreExpression('word.trim().lower()', env))).toBe('kern');
    expect(toHostValue(evalCoreExpression('word.trim().upper()', env))).toBe('KERN');
    expect(toHostValue(evalCoreExpression('label.concat("!")', env))).toBe('a𐐷b!');
    expect(toHostValue(evalCoreExpression('label.equals("a𐐷b")', env))).toBe(true);
  });

  test('string and boolean contract methods reject cross-type operands in the VM', () => {
    const env = createCoreRuntimeEnv({ globals: { label: 'count:', flag: true } });
    expect(() => evalCoreExpression('label.concat(2)', env)).toThrow('String.concat expects String, String.');
    expect(() => evalCoreExpression('label.concat(String)', env)).toThrow('String.concat expects String, String.');
    expect(() => evalCoreExpression('label.equals(true)', env)).toThrow('String.equals expects String, String.');
    expect(() => evalCoreExpression('flag.and("true")', env)).toThrow('Boolean.and expects Boolean, Boolean.');
    expect(() => evalCoreExpression('flag.equals(1)', env)).toThrow('Boolean.equals expects Boolean, Boolean.');
    expect(toHostValue(evalCoreExpression('flag.not()', env))).toBe(false);
    expect(toHostValue(evalCoreExpression('flag.and(false)', env))).toBe(false);
    expect(toHostValue(evalCoreExpression('flag.or(false)', env))).toBe(true);
    expect(toHostValue(evalCoreExpression('flag.toString()', env))).toBe('true');
  });

  test('number operators dispatch through KERN core contracts in the VM', () => {
    const env = createCoreRuntimeEnv();
    expect(toHostValue(evalCoreExpression('2 + 3', env))).toBe(5);
    expect(toHostValue(evalCoreExpression('5 - 3', env))).toBe(2);
    expect(toHostValue(evalCoreExpression('3 * 4', env))).toBe(12);
    expect(toHostValue(evalCoreExpression('5 / 2', env))).toBe(2.5);
    expect(toHostValue(evalCoreExpression('-3', env))).toBe(-3);
    expect(toHostValue(evalCoreExpression('-5 % 2', env))).toBe(-1);
    expect(toHostValue(evalCoreExpression('5 % -2', env))).toBe(1);
    expect(toHostValue(evalCoreExpression('2 < 3', env))).toBe(true);
    expect(toHostValue(evalCoreExpression('3 <= 2', env))).toBe(false);
    expect(toHostValue(evalCoreExpression('3 > 2', env))).toBe(true);
    expect(toHostValue(evalCoreExpression('2 >= 3', env))).toBe(false);
    expect(() => evalCoreExpression('1 / 0', env)).toThrow('Number.divide division by zero.');
    expect(() => evalCoreExpression('1 % 0', env)).toThrow('Number.remainder division by zero.');
  });

  test('string ordered comparisons dispatch through KERN core contracts in the VM', () => {
    const env = createCoreRuntimeEnv();
    expect(toHostValue(evalCoreExpression('"abc" < "abd"', env))).toBe(true);
    expect(toHostValue(evalCoreExpression('"abc" <= "abc"', env))).toBe(true);
    expect(toHostValue(evalCoreExpression('"abd" > "abc"', env))).toBe(true);
    expect(toHostValue(evalCoreExpression('"abc" >= "abd"', env))).toBe(false);
    expect(toHostValue(evalCoreExpression('"𐐷" > "z"', env))).toBe(true);
  });

  test('unary boolean not dispatches through KERN core contracts in the VM', () => {
    const env = createCoreRuntimeEnv();
    expect(toHostValue(evalCoreExpression('!true', env))).toBe(false);
    expect(toHostValue(evalCoreExpression('!false', env))).toBe(true);
    expect(() => evalCoreExpression('!5', env)).toThrow('KERN core runtime unary ! requires a boolean.');
  });

  test('list and record reads dispatch through KERN core contracts in the VM', () => {
    const env = createCoreRuntimeEnv({
      globals: { xs: [10, undefined, 30], user: { name: 'Ada' }, sentinel: { __kernFixture: 'Undefined' } },
    });
    expect(toHostValue(evalCoreExpression('xs.length', env))).toBe(3);
    expect(toHostValue(evalCoreExpression('xs[0]', env))).toBe(10);
    expect(toHostValue(evalCoreExpression('xs[1]', env))).toBeUndefined();
    expect(toHostValue(evalCoreExpression('xs[-1]', env))).toBeUndefined();
    expect(toHostValue(evalCoreExpression('xs[1.5]', env))).toBeUndefined();
    expect(toHostValue(evalCoreExpression('user.name', env))).toBe('Ada');
    expect(toHostValue(evalCoreExpression('user["missing"]', env))).toBeUndefined();
    expect(toHostValue(evalCoreExpression('user.toString', env))).toBeUndefined();
    expect(toHostValue(evalCoreExpression('sentinel.__kernFixture', env))).toBe('Undefined');
    expect(toHostValue(evalCoreExpression('[String].length', env))).toBe(1);
    expect(toHostValue(evalCoreExpression('[String][0]', env))).toBe('[KERN builtin String]');
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

describe('KERN core runtime contract adapter', () => {
  test('round-trips supported KERN values through core contract fixture values', () => {
    const value = fromHostValue({
      text: 'a𐐷b',
      flag: true,
      count: 3,
      none: null,
      missing: undefined,
      list: [false, 'x'],
      sentinelLikeRecord: { kind: 'Undefined' },
    });

    const roundTripped = toHostValue(roundTripKernContractDataValue(value)) as Record<string, unknown>;
    const { missing: roundTrippedMissing, ...roundTrippedWithoutMissing } = roundTripped;
    expect(roundTrippedWithoutMissing).toEqual({
      text: 'a𐐷b',
      flag: true,
      count: 3,
      none: null,
      list: [false, 'x'],
      sentinelLikeRecord: { kind: 'Undefined' },
    });
    expect(Object.hasOwn(roundTripped, 'missing')).toBe(true);
    expect(roundTrippedMissing).toBeUndefined();
  });

  test('keeps Undefined fixture encoding stable across JSON round trips', () => {
    const encoded = kernValueToCoreFixtureValue(kUndefined());
    expect(encoded).toEqual(CORE_FIXTURE_UNDEFINED);
    expect(toHostValue(coreFixtureValueToKernValue(JSON.parse(JSON.stringify(encoded))))).toBeUndefined();
  });

  test('rejects runtime records that use the reserved Undefined fixture sentinel shape', () => {
    expect(() => kernValueToCoreFixtureValue(fromHostValue({ __kernFixture: 'Undefined' }))).toThrow(
      'reserved core fixture sentinel shape',
    );
  });

  test('rejects runtime instances that use reserved fixture sentinel field shape', () => {
    const root = parse(['class name=Trap', '  field name=__kernFixture type=string value="Function"'].join('\n'));
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => kernValueToCoreFixtureValue(evalCoreExpression('new Trap()', env))).toThrow(
      'reserved core fixture sentinel shape',
    );
  });

  test('represents runtime-only callable values as opaque Function fixture references', () => {
    const env = createCoreRuntimeEnv();
    expect(kernValueToCoreFixtureValue(env.lookup('String'))).toEqual(CORE_FIXTURE_FUNCTION);
    expect(() => coreFixtureValueToKernValue(CORE_FIXTURE_FUNCTION)).toThrow(CoreRuntimeContractAdapterError);
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

  // Slice S5 — logical `&&` / `||` are RESULT-VALUE operators on the KERN core
  // runtime (the executable TS-side oracle): they return the SELECTED original
  // operand, decided by KERN ToBoolean (`kernTruthy`), and short-circuit the
  // unselected branch. NaN is unreachable here (`kNumber` rejects non-finite),
  // so the NaN-falsy rows are proven on the Python leg (float('nan')) and TS.
  describe('logical && / || result-value semantics', () => {
    function ev(expr: string): unknown {
      return toHostValue(evalCoreExpression(expr, createCoreRuntimeEnv()));
    }

    test('&& returns the original left operand when it is KERN-falsy', () => {
      expect(ev('0 && "right"')).toBe(0);
      expect(ev('"" && "right"')).toBe('');
      expect(ev('false && "right"')).toBe(false);
      expect(ev('null && "right"')).toBeNull();
    });

    test('&& returns the right operand when the left is KERN-truthy', () => {
      // `"0"`, `" "`, `[]`, `{}` are all KERN-truthy (ToBoolean, not ToNumber /
      // Python len), so `&&` proceeds to the right operand.
      expect(ev('"0" && "right"')).toBe('right');
      expect(ev('" " && "right"')).toBe('right');
      expect(ev('[] && "right"')).toBe('right');
      expect(ev('({}) && "right"')).toBe('right');
      expect(ev('1 && 2')).toBe(2);
    });

    test('|| returns the original left operand when it is KERN-truthy', () => {
      // The `[]`/`{}` rows are the Python-divergence killers: Python `[] or x`
      // returns x, but KERN returns the container itself.
      expect(ev('"0" || "fallback"')).toBe('0');
      expect(ev('" " || "fallback"')).toBe(' ');
      expect(ev('[] || "fallback"')).toEqual([]);
      expect(ev('[] || "x"')).toEqual([]);
      expect(ev('({}) || "fallback"')).toEqual({});
      expect(ev('1 || 2')).toBe(1);
    });

    test('|| returns the right operand when the left is KERN-falsy', () => {
      expect(ev('0 || "fallback"')).toBe('fallback');
      expect(ev('"" || "fallback"')).toBe('fallback');
      expect(ev('false || "fallback"')).toBe('fallback');
      expect(ev('null || "fallback"')).toBe('fallback');
    });

    test('chained && / || obey precedence and left-to-right associativity', () => {
      // `&&` binds tighter than `||`; `"0"` is truthy → whole thing is "right".
      expect(ev('"" || "0" && "right"')).toBe('right');
      // `("left" && 0)` returns 0, then `0 || "fallback"`.
      expect(ev('"left" && 0 || "fallback"')).toBe('fallback');
      // `[]` is truthy, so the outer `||` returns it.
      expect(ev('"left" && [] || "fallback"')).toEqual([]);
      // `{}` is truthy → `&&` returns `""`, then `""` falsy → `||` falls through.
      expect(ev('{} && "" || "fallback"')).toBe('fallback');
      // The NaN-bearing chained row (`NaN || [] || "fallback"` → `[]`) is
      // exercised only on the Python leg (float('nan')) — NaN is unreachable in
      // this TS core runtime because `kNumber` rejects non-finite numbers.
    });

    test('&& / || short-circuit: the unselected operand is never evaluated', () => {
      // `boom` is an UNBOUND identifier — evaluating it throws "binding not
      // found". If the operator short-circuits, the throw never happens. This is
      // the same dead-branch idiom the coalesce/firstTruthy test uses.
      const env = createCoreRuntimeEnv();
      // Falsy left: `&&` returns left, never touches `boom`.
      expect(toHostValue(evalCoreExpression('0 && boom', env))).toBe(0);
      // Truthy left: `||` returns left, never touches `boom`.
      expect(toHostValue(evalCoreExpression('1 || boom', env))).toBe(1);
      // `[]` is truthy → `||` returns it, `boom` not evaluated.
      expect(toHostValue(evalCoreExpression('[] || boom', env))).toEqual([]);
      // And the contrapositive: when the dead branch WOULD run, it does throw,
      // proving the test above is a real short-circuit and not a no-op.
      expect(() => evalCoreExpression('1 && boom', env)).toThrow(/not found/);
      expect(() => evalCoreExpression('0 || boom', env)).toThrow(/not found/);
    });

    test('|| selects on truthiness; ?? selects on nullishness (boundary contrast)', () => {
      // `0`/`""`/`false` are falsy-but-defined: `||` falls through, `??` keeps them.
      expect(ev('0 || "fallback"')).toBe('fallback');
      expect(ev('0 ?? "fallback"')).toBe(0);
      expect(ev('"" || "fallback"')).toBe('fallback');
      expect(ev('"" ?? "fallback"')).toBe('');
      expect(ev('false || "fallback"')).toBe('fallback');
      expect(ev('false ?? "fallback"')).toBe(false);
      // `[]`/`{}` are truthy AND defined: both operators keep them.
      expect(ev('[] ?? "fallback"')).toEqual([]);
      expect(ev('({}) ?? "fallback"')).toEqual({});
      // Nullish: `??` coalesces, `||` also falls through (null is falsy too).
      expect(ev('null ?? "fallback"')).toBe('fallback');
      expect(ev('null || "fallback"')).toBe('fallback');
    });
  });

  test('executes user-defined classes with fields constructors methods and getters', () => {
    const root = parse(
      [
        'class name=Counter',
        '  field name=count type=number value={{ 0 }}',
        '  constructor',
        '    param name=initial type=number value={{ 0 }}',
        '    handler',
        '      assign target="this.count" value="initial"',
        '  method name=inc returns=number',
        '    param name=step type=number value={{ 1 }}',
        '    handler',
        '      assign target="this.count" value="this.count + step"',
        '      return value="this.count"',
        '  getter name=label returns=string',
        '    handler',
        '      return value="`count=${this.count}`"',
        'fn name=make returns=number',
        '  handler',
        '    let name=c value="new Counter(4)"',
        '    do value="c.inc(2)"',
        '    return value="c.count"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new Counter(3).count', env))).toBe(3);
    expect(toHostValue(evalCoreExpression('new Counter(3).inc()', env))).toBe(4);
    expect(toHostValue(evalCoreExpression('new Counter(3).label', env))).toBe('count=3');
    expect(toHostValue(evalCoreExpression('make()', env))).toBe(6);
  });

  test('enforces implemented interface fields after class construction', () => {
    const root = parse(
      [
        'interface name=Named',
        '  field name=id type=string',
        'class name=User implements=Named',
        '  field name=id type=string value="unset"',
        '  field name=name type=string value="Ada"',
        '  constructor',
        '    param name=id type=string',
        '    handler',
        '      assign target="this.id" value="id"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new User("u1").id', env))).toBe('u1');
    expect(toHostValue(evalCoreExpression('new User("u1").name', env))).toBe('Ada');
  });

  test('rejects constructed classes that miss implemented interface fields', () => {
    const root = parse(
      [
        'interface name=Named',
        '  field name=name type=string',
        'class name=User implements=Named',
        '  constructor',
        '    handler',
        '      do value="1"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new User()', env)).toThrow("class 'User' violates implemented interface 'Named'");
    expect(() => evalCoreExpression('new User()', env)).toThrow('missing required field Named.name');
  });

  test('rejects constructed classes with wrong implemented interface field types', () => {
    const root = parse(
      [
        'interface name=Named',
        '  field name=id type=string',
        'class name=User implements=Named',
        '  field name=id type=number value={{ 1 }}',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new User()', env)).toThrow('expected Named.id to be string, got number');
  });

  test('enforces inherited interface fields for implemented protocols', () => {
    const root = parse(
      [
        'interface name=Entity',
        '  field name=id type=string',
        'interface name=Named extends=Entity',
        '  field name=name type=string',
        'class name=User implements=Named',
        '  field name=id type=string value="u1"',
        '  field name=name type=string value="Ada"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new User().id', env))).toBe('u1');
    expect(toHostValue(evalCoreExpression('new User().name', env))).toBe('Ada');
  });

  test('rejects classes missing inherited implemented interface fields', () => {
    const root = parse(
      [
        'interface name=Entity',
        '  field name=id type=string',
        'interface name=Named extends=Entity',
        '  field name=name type=string',
        'class name=User implements=Named',
        '  field name=name type=string value="Ada"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new User()', env)).toThrow('missing required field Named.id');
  });

  test('validates getter-backed implemented interface fields', () => {
    const root = parse(
      [
        'interface name=Named',
        '  field name=name type=string',
        'class name=User implements=Named',
        '  field name=first type=string value="Ada"',
        '  getter name=name returns=string',
        '    handler',
        '      return value="this.first"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new User().name', env))).toBe('Ada');
  });

  test('validates static implemented interface fields at class definition', () => {
    const root = parse(
      [
        'interface name=Factory',
        '  field name=kind type=string static=true',
        'class name=UserFactory implements=Factory',
        '  field name=kind type=string static=true value="user"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();

    expect(() => runCoreRuntime(root, env)).not.toThrow();
    expect(toHostValue(evalCoreExpression('UserFactory.kind', env))).toBe('user');
  });

  test('accepts missing optional static implemented interface fields', () => {
    const root = parse(
      [
        'interface name=Factory',
        '  field name=kind type=string static=true optional=true',
        'class name=UserFactory implements=Factory',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();

    expect(() => runCoreRuntime(root, env)).not.toThrow();
  });

  test('rejects private static implemented interface fields', () => {
    const root = parse(
      [
        'interface name=Factory',
        '  field name=kind type=string static=true',
        'class name=UserFactory implements=Factory',
        '  field name=kind type=string static=true private=true value="user"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();

    expect(() => runCoreRuntime(root, env)).toThrow('missing or incompatible static member(s): kind');
  });

  test('rejects static implemented interface field type mismatches', () => {
    const root = parse(
      [
        'interface name=Factory',
        '  field name=kind type=string static=true',
        'class name=BadFactory implements=Factory',
        '  field name=kind type=number static=true value=1',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();

    expect(() => runCoreRuntime(root, env)).toThrow('missing or incompatible static member(s): kind');
  });

  test('rejects static implemented interface members satisfied only by instance members', () => {
    const root = parse(
      [
        'interface name=Factory',
        '  field name=kind type=string static=true',
        '  method name=create params="id:string" returns=string static=true',
        'class name=Confused implements=Factory',
        '  field name=kind type=string value="user"',
        '  method name=create params="id:string" returns=string',
        '    handler',
        '      return value="id"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();

    expect(() => runCoreRuntime(root, env)).toThrow('missing or incompatible static member(s): kind');
  });

  test('does not invoke static getters while validating implemented interface fields', () => {
    const root = parse(
      [
        'interface name=Factory',
        '  field name=kind type=string static=true',
        'class name=UserFactory implements=Factory',
        '  getter name=kind returns=string static=true',
        '    handler',
        '      return value="Later.kind"',
        'class name=Later',
        '  field name=kind type=string static=true value="user"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('UserFactory.kind', env))).toBe('user');
  });

  test('validates inherited static methods for implemented interfaces', () => {
    const root = parse(
      [
        'interface name=Factory',
        '  method name=create params="id:string" returns=string static=true',
        'class name=BaseFactory',
        '  method name=create params="id:string" returns=string static=true',
        '    handler',
        '      return value="id"',
        'class name=UserFactory extends=BaseFactory implements=Factory',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('UserFactory.create("u1")', env))).toBe('u1');
  });

  test('validates implemented interface methods without invoking them', () => {
    const root = parse(
      [
        'interface name=Runnable',
        '  method name=run params="input:string" returns=number',
        'class name=Job implements=Runnable',
        '  field name=count type=number value={{ 0 }}',
        '  method name=run params="input:string" returns=number',
        '    handler',
        '      assign target="this.count" value="this.count + 1"',
        '      return value="input.length"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new Job().count', env))).toBe(0);
    expect(toHostValue(evalCoreExpression('new Job().run("abc")', env))).toBe(3);
  });

  test('rejects missing implemented interface methods', () => {
    const root = parse(
      [
        'interface name=Runnable',
        '  method name=run params="input:string" returns=number',
        'class name=Job implements=Runnable',
        '  field name=id type=string value="j1"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new Job()', env)).toThrow('missing or incompatible method(s): run');
  });

  test('rejects incompatible implemented interface method signatures', () => {
    const root = parse(
      [
        'interface name=Runnable',
        '  method name=run params="input:string" returns=number',
        'class name=Job implements=Runnable',
        '  method name=run returns=number',
        '    handler',
        '      return value="1"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new Job()', env)).toThrow('missing or incompatible method(s): run');
  });

  test('rejects implemented interface methods with incompatible parameter types', () => {
    const root = parse(
      [
        'interface name=Runnable',
        '  method name=run params="input:string" returns=number',
        'class name=Job implements=Runnable',
        '  method name=run params="input:number" returns=number',
        '    handler',
        '      return value="input"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new Job()', env)).toThrow('missing or incompatible method(s): run');
  });

  test('accepts implicit void methods for explicit void interface methods', () => {
    const root = parse(
      [
        'interface name=Lifecycle',
        '  method name=close returns=void',
        'class name=Socket implements=Lifecycle',
        '  method name=close',
        '    handler',
        '      do value="undefined"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new Socket().close()', env))).toBeUndefined();
  });

  test('rejects non-stream methods for stream interface methods', () => {
    const root = parse(
      [
        'interface name=Events',
        '  method name=read returns=Event stream=true',
        'class name=Reader implements=Events',
        '  method name=read returns=Event',
        '    handler',
        '      return value="undefined"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new Reader()', env)).toThrow('missing or incompatible method(s): read');
  });

  test('normalizes streamed method returns for implemented interface methods', () => {
    const root = parse(
      [
        'interface name=Events',
        '  method name=read returns="AsyncGenerator<Event>" stream=true',
        'class name=Reader implements=Events',
        '  method name=read returns=Event stream=true',
        '    handler',
        '      return value="undefined"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new Reader()', env)).not.toThrow();
  });

  test('rejects generic parameter type mismatches in implemented interface methods', () => {
    const root = parse(
      [
        'interface name=Sink',
        '  method name=write params="item:Record<string,number>" returns=void',
        'class name=BadSink implements=Sink',
        '  method name=write params="item:Record<string,boolean>" returns=void',
        '    handler',
        '      do value="undefined"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new BadSink()', env)).toThrow('missing or incompatible method(s): write');
  });

  test('preserves quoted whitespace in implemented interface method parameter types', () => {
    const root = parse(
      [
        'interface name=Sink',
        '  method name=write params="item:\'a b\'" returns=void',
        'class name=BadSink implements=Sink',
        '  method name=write params="item:\'ab\'" returns=void',
        '    handler',
        '      do value="undefined"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new BadSink()', env)).toThrow('missing or incompatible method(s): write');
  });

  test('rejects private methods for implemented interface methods', () => {
    const root = parse(
      [
        'interface name=Runnable',
        '  method name=run returns=number',
        'class name=Job implements=Runnable',
        '  method name=run private=true returns=number',
        '    handler',
        '      return value="1"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new Job()', env)).toThrow('missing or incompatible method(s): run');
  });

  test('normalizes whitespace in implemented interface method parameter types', () => {
    const root = parse(
      [
        'interface name=Sink',
        '  method name=write params="item:Record<string, number>" returns=void',
        'class name=GoodSink implements=Sink',
        '  method name=write params="item:Record<string,number>" returns=void',
        '    handler',
        '      do value="undefined"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new GoodSink()', env)).not.toThrow();
  });

  test('parses default comparison expressions in implemented interface method params', () => {
    const root = parse(
      [
        'interface name=Calculator',
        '  method name=calc params="value:number=1 < 2,unit:string=\'m\'" returns=number',
        'class name=DefaultCalc implements=Calculator',
        '  method name=calc params="value:number=1 < 2,unit:string=\'m\'" returns=number',
        '    handler',
        '      return value="value"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new DefaultCalc().calc()', env))).toBe(true);
  });

  test('parses default equality expressions in implemented interface method params', () => {
    const root = parse(
      [
        'interface name=Comparator',
        '  method name=cmp params="value:number=1==1,unit:string=\'m\'" returns=number',
        'class name=DefaultCmp implements=Comparator',
        '  method name=cmp params="value:number=1==1,unit:string=\'m\'" returns=number',
        '    handler',
        '      return value="value"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new DefaultCmp().cmp()', env))).toBe(true);
  });

  test('parses generic default expressions in implemented interface method params', () => {
    const root = parse(
      [
        'interface name=Formatter',
        '  method name=format params="value:Map<string, number>=make<Pair<string, number>>(),unit:string" returns=number',
        'class name=DefaultFormatter implements=Formatter',
        '  method name=format params="value:Map<string, number>=make<Pair<string, number>>(),unit:string" returns=number',
        '    handler',
        '      return value="1"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new DefaultFormatter()', env)).not.toThrow();
  });

  test('enforces inherited interface methods for implemented protocols', () => {
    const root = parse(
      [
        'interface name=Runnable',
        '  method name=run params="input:string" returns=number',
        'interface name=NamedRunnable extends=Runnable',
        '  field name=name type=string',
        'class name=Job implements=NamedRunnable',
        '  field name=name type=string value="job"',
        '  method name=run params="input:string" returns=number',
        '    handler',
        '      return value="input.length"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new Job().run("abcd")', env))).toBe(4);
  });

  test('parses generic implements references with default types containing commas', () => {
    const root = parse(
      ['interface name=Protocol', 'class name=User implements="Protocol<T = Map<string, number>>"'].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new User()', env)).not.toThrow();
  });

  test('enforces base class implemented protocols on derived instances', () => {
    const root = parse(
      [
        'interface name=EntityLike',
        '  field name=id type=string',
        'class name=Entity implements=EntityLike',
        '  field name=id type=string value="base"',
        'class name=User extends=Entity',
        '  field name=name type=string value="Ada"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new User().id', env))).toBe('base');
    expect(toHostValue(evalCoreExpression('new User().name', env))).toBe('Ada');
  });

  test('rejects derived instances when a base implemented protocol is unsatisfied', () => {
    const root = parse(
      [
        'interface name=EntityLike',
        '  field name=id type=string',
        'class name=Entity implements=EntityLike',
        'class name=User extends=Entity',
        '  field name=name type=string value="Ada"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new User()', env)).toThrow(
      "class 'User' violates implemented interface 'EntityLike'",
    );
  });

  test('class implements validation uses the declaration root context', () => {
    const firstRoot = parse(
      [
        'interface name=Named',
        '  field name=id type=string',
        'class name=User implements=Named',
        '  field name=id type=string value="u1"',
      ].join('\n'),
    );
    const secondRoot = parse(['interface name=Named', '  field name=id type=number'].join('\n'));
    const env = createCoreRuntimeEnv();
    runCoreRuntime(firstRoot, env);
    runCoreRuntime(secondRoot, env);

    expect(toHostValue(evalCoreExpression('new User().id', env))).toBe('u1');
  });

  test('base implemented protocols use the base declaration root context', () => {
    const firstRoot = parse(
      [
        'interface name=EntityLike',
        '  field name=id type=string',
        'class name=Entity implements=EntityLike',
        '  field name=id type=string value="base"',
      ].join('\n'),
    );
    const secondRoot = parse(
      [
        'interface name=EntityLike',
        '  field name=id type=number',
        'class name=User extends=Entity',
        '  field name=name type=string value="Ada"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(firstRoot, env);
    runCoreRuntime(secondRoot, env);

    expect(toHostValue(evalCoreExpression('new User().id', env))).toBe('base');
  });

  test('runtime class protocols reject unsupported indexer interfaces', () => {
    const root = parse(
      [
        'interface name=Dictionary',
        '  indexer keyType=string type=string',
        'class name=User implements=Dictionary',
        '  field name=id type=string value="u1"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();

    expect(() => runCoreRuntime(root, env)).toThrow(
      "implements interface 'Dictionary' that is not executable as a class protocol in v1",
    );
  });

  test('malformed runtime implements lists fail instead of skipping validation', () => {
    const root = parse(
      [
        'interface name=Named',
        '  field name=id type=string',
        'class name=User implements="Named,"',
        '  field name=id type=string value="u1"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();

    expect(() => runCoreRuntime(root, env)).toThrow('implements= contains an empty reference');
  });

  test('invalid runtime implements entries fail instead of being ignored', () => {
    const root = parse(
      [
        'interface name=Named',
        '  field name=id type=string',
        'class name=User implements="123"',
        '  field name=id type=string value="u1"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();

    expect(() => runCoreRuntime(root, env)).toThrow('implements= contains an invalid reference: 123');
  });

  test('runtime implements entries reject trailing junk', () => {
    const root = parse(
      [
        'interface name=Named',
        '  field name=id type=string',
        'class name=User implements="Named junk"',
        '  field name=id type=string value="u1"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();

    expect(() => runCoreRuntime(root, env)).toThrow('implements= contains an invalid reference: Named junk');
  });

  test('unknown local runtime implements targets fail instead of being ignored', () => {
    const root = parse(['class name=User implements=MissingProtocol'].join('\n'));
    const env = createCoreRuntimeEnv();

    expect(() => runCoreRuntime(root, env)).toThrow("class 'User' implements unknown interface 'MissingProtocol'");
  });

  test('imported runtime implements targets are treated as external protocols', () => {
    const root = parse(
      [
        'import from="./protocols" names=ExternalProtocol',
        'class name=User implements=ExternalProtocol',
        '  field name=id type=string value="u1"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new User().id', env))).toBe('u1');
  });

  test('executes inherited fields getters methods and overrides', () => {
    const root = parse(
      [
        'class name=Entity',
        '  field name=id type=string value="base"',
        '  method name=kind returns=string',
        '    handler',
        '      return value="\'entity\'"',
        '  getter name=summary returns=string',
        '    handler',
        '      return value="`${this.kind()}:${this.id}`"',
        'class name=User extends=Entity',
        '  field name=name type=string value="Ada"',
        '  method name=kind returns=string',
        '    handler',
        '      return value="`user/${super.kind()}`"',
        '  method name=label returns=string',
        '    handler',
        '      return value="`${this.summary}:${this.name}`"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new User().id', env))).toBe('base');
    expect(toHostValue(evalCoreExpression('new User().kind()', env))).toBe('user/entity');
    expect(toHostValue(evalCoreExpression('new User().summary', env))).toBe('user/entity:base');
    expect(toHostValue(evalCoreExpression('new User().label()', env))).toBe('user/entity:base:Ada');
  });

  test('executes static fields getters methods and inherited static receiver dispatch', () => {
    const root = parse(
      [
        'class name=Base',
        '  field name=count type=number static=true value={{ 1 }}',
        '  field name=seed type=number static=true value={{ 2 }}',
        '  getter name=label static=true returns=string',
        '    handler',
        '      return value="`count=${this.count}`"',
        '  method name=bump static=true returns=number',
        '    param name=step type=number value={{ 1 }}',
        '    handler',
        '      assign target="this.count" value="this.count + step"',
        '      return value="this.count"',
        '  method name=tag static=true returns=string',
        '    handler',
        '      return value="\'base\'"',
        'class name=Derived extends=Base',
        '  field name=own type=number static=true value={{ this.count + 9 }}',
        '  field name=fromBase type=number static=true value={{ super.seed + this.count }}',
        '  method name=tag static=true returns=string',
        '    handler',
        '      return value="`derived/${super.tag()}/${this.own}`"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('Base.count', env))).toBe(1);
    expect(toHostValue(evalCoreExpression('Derived.count', env))).toBe(1);
    expect(toHostValue(evalCoreExpression('Derived.own', env))).toBe(10);
    expect(toHostValue(evalCoreExpression('Derived.fromBase', env))).toBe(3);
    expect(toHostValue(evalCoreExpression('Derived.label', env))).toBe('count=1');
    expect(toHostValue(evalCoreExpression('Derived.tag()', env))).toBe('derived/base/10');
    expect(toHostValue(evalCoreExpression('Derived.bump(4)', env))).toBe(5);
    expect(toHostValue(evalCoreExpression('Derived.count', env))).toBe(5);
    expect(toHostValue(evalCoreExpression('Base.count', env))).toBe(1);
  });

  test('dispatches static assignment through setters and rejects getter-only static assignment', () => {
    const root = parse(
      [
        'class name=Gauge',
        '  field name=_value type=number static=true value={{ 0 }}',
        '  setter name=value static=true',
        '    param name=next type=number',
        '    handler',
        '      assign target="this._value" value="next * 3"',
        '  getter name=value static=true returns=number',
        '    handler',
        '      return value="this._value"',
        'class name=ReadOnly',
        '  getter name=value static=true returns=number',
        '    handler',
        '      return value="1"',
        'class name=Dual',
        '  field name=value type=number value={{ 2 }}',
        '  field name=value type=number static=true value={{ 1 }}',
        'class name=ParentReadOnly',
        '  getter name=value static=true returns=number',
        '    handler',
        '      return value="1"',
        'class name=ChildShadow extends=ParentReadOnly',
        '  field name=value type=number static=true value={{ 2 }}',
        'fn name=setGaugeStatic returns=number',
        '  handler',
        '    assign target="Gauge.value" value="7"',
        '    return value="Gauge.value"',
        'fn name=setReadOnlyStatic returns=number',
        '  handler',
        '    assign target="ReadOnly.value" value="7"',
        '    return value="ReadOnly.value"',
        'fn name=setDualStatic returns=number',
        '  handler',
        '    assign target="Dual.value" value="8"',
        '    return value="new Dual().value"',
        'fn name=setChildShadowStatic returns=number',
        '  handler',
        '    assign target="ChildShadow.value" value="3"',
        '    return value="ChildShadow.value"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('setGaugeStatic()', env))).toBe(21);
    expect(toHostValue(evalCoreExpression('setDualStatic()', env))).toBe(2);
    expect(toHostValue(evalCoreExpression('Dual.value', env))).toBe(8);
    expect(toHostValue(evalCoreExpression('setChildShadowStatic()', env))).toBe(3);
    expect(toHostValue(evalCoreExpression('ParentReadOnly.value', env))).toBe(1);
    expect(() => evalCoreExpression('setReadOnlyStatic()', env)).toThrow(
      'cannot assign getter-only static property: value',
    );
  });

  test('rejects recursive static setter assignment', () => {
    const root = parse(
      [
        'class name=Loop',
        '  setter name=value static=true',
        '    param name=next type=number',
        '    handler',
        '      assign target="this.value" value="next"',
        'fn name=setLoopStatic returns=number',
        '  handler',
        '    assign target="Loop.value" value="5"',
        '    return value="0"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('setLoopStatic()', env)).toThrow('recursive static setter assignment: Loop.value');
  });

  test('accepts self-referential static fields as branded KERN values', () => {
    const root = parse(['class name=SelfRef', '  field name=self static=true value={{ this }}'].join('\n'));
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(fromHostValue(env.lookup('SelfRef'))).toBe(env.lookup('SelfRef'));
  });

  test('executes derived constructors with super constructor arguments', () => {
    const root = parse(
      [
        'class name=Entity',
        '  field name=id type=string value="unset"',
        '  constructor',
        '    param name=id type=string',
        '    handler',
        '      assign target="this.id" value="id"',
        'class name=User extends=Entity',
        '  field name=name type=string value="unset"',
        '  constructor',
        '    param name=id type=string',
        '    param name=name type=string',
        '    handler',
        '      do value="super(id)"',
        '      assign target="this.name" value="name"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new User("u1", "Ada").id', env))).toBe('u1');
    expect(toHostValue(evalCoreExpression('new User("u1", "Ada").name', env))).toBe('Ada');
  });

  test('initializes fields before running a base-less constructor body', () => {
    const root = parse(
      [
        'class name=Plain',
        '  field name=count type=number value={{ 2 }}',
        '  constructor',
        '    handler',
        '      assign target="this.count" value="this.count + 3"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new Plain().count', env))).toBe(5);
  });

  test('initializes derived fields after super constructor state', () => {
    const root = parse(
      [
        'class name=Entity',
        '  field name=id type=string value="unset"',
        '  constructor',
        '    param name=id type=string',
        '    handler',
        '      assign target="this.id" value="id"',
        'class name=User extends=Entity',
        '  field name=copy type=string value={{ this.id }}',
        '  constructor',
        '    param name=id type=string',
        '    handler',
        '      do value="super(id)"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new User("u1").copy', env))).toBe('u1');
  });

  test('rejects missing and extra runtime arguments strictly', () => {
    const root = parse(
      [
        'class name=Box',
        '  constructor',
        '    param name=value type=number',
        '    handler',
        '      assign target="this.value" value="value"',
        'fn name=need returns=number',
        '  param name=value type=number',
        '  handler',
        '    return value="value"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('need()', env)).toThrow('missing required argument: value');
    expect(() => evalCoreExpression('need(1, 2)', env)).toThrow('received too many arguments');
    expect(() => evalCoreExpression('new Box()', env)).toThrow('missing required argument: value');
    expect(() => evalCoreExpression('new Box(1, 2)', env)).toThrow('received too many arguments');
  });

  test('requires explicit super before this access in derived constructors', () => {
    const root = parse(
      [
        'class name=Entity',
        '  constructor',
        '    param name=id type=string',
        '    handler',
        '      assign target="this.id" value="id"',
        'class name=User extends=Entity',
        '  constructor',
        '    param name=id type=string',
        '    handler',
        '      assign target="this.id" value="id"',
        '      do value="super(id)"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new User("u1")', env)).toThrow('cannot access this before super(...)');
  });

  test('allows reading a separate initialized instance before constructor super', () => {
    const root = parse(
      [
        'class name=Entity',
        '  field name=id type=string value="base"',
        'class name=User extends=Entity',
        '  constructor',
        '    param name=other type=Entity',
        '    handler',
        '      let name=otherId value="other.id"',
        '      do value="super()"',
        '      assign target="this.id" value="otherId"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new User(new Entity()).id', env))).toBe('base');
  });

  test('rejects double super calls in derived constructors', () => {
    const root = parse(
      [
        'class name=Entity',
        'class name=User extends=Entity',
        '  constructor',
        '    handler',
        '      do value="super()"',
        '      do value="super()"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new User()', env)).toThrow('called super(...) more than once');
  });

  test('missing runtime super path fails instead of auto-initializing the base', () => {
    const root = parse(
      [
        'class name=Entity',
        '  field name=id type=string value="unset"',
        '  constructor',
        '    param name=id type=string',
        '    handler',
        '      assign target="this.id" value="id"',
        'class name=User extends=Entity',
        '  constructor',
        '    param name=id type=string',
        '    param name=ready type=boolean',
        '    handler',
        '      if cond=ready',
        '        do value="super(id)"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new User("u1", true).id', env))).toBe('u1');
    expect(() => evalCoreExpression('new User("u2", false)', env)).toThrow('must call super(...)');
  });

  test('dispatches instance assignment through setters', () => {
    const root = parse(
      [
        'class name=Gauge',
        '  field name=_value type=number value={{ 0 }}',
        '  setter name=value',
        '    param name=next type=number',
        '    handler',
        '      assign target="this._value" value="next * 2"',
        '  getter name=value returns=number',
        '    handler',
        '      return value="this._value"',
        'fn name=setGauge returns=number',
        '  handler',
        '    let name=g value="new Gauge()"',
        '    assign target="g.value" value="7"',
        '    return value="g.value"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('setGauge()', env))).toBe(14);
  });

  test('dispatches inherited and super assignment through setters', () => {
    const root = parse(
      [
        'class name=Base',
        '  field name=_value type=number value={{ 0 }}',
        '  setter name=value',
        '    param name=next type=number',
        '    handler',
        '      assign target="this._value" value="next + 1"',
        '  getter name=value returns=number',
        '    handler',
        '      return value="this._value"',
        'class name=Derived extends=Base',
        '  method name=setViaSuper returns=number',
        '    param name=next type=number',
        '    handler',
        '      assign target="super.value" value="next"',
        '      return value="this.value"',
        'fn name=setDerived returns=number',
        '  handler',
        '    let name=d value="new Derived()"',
        '    assign target="d.value" value="4"',
        '    return value="d.setViaSuper(9) + d.value"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('setDerived()', env))).toBe(20);
  });

  test('supports setter-only properties and rejects getter-only assignment', () => {
    const root = parse(
      [
        'class name=WriteOnly',
        '  field name=stored type=number value={{ 0 }}',
        '  setter name=value',
        '    param name=next type=number',
        '    handler',
        '      assign target="this.stored" value="next"',
        'class name=ReadOnly',
        '  getter name=value returns=number',
        '    handler',
        '      return value="1"',
        'fn name=setWriteOnly returns=number',
        '  handler',
        '    let name=w value="new WriteOnly()"',
        '    assign target="w.value" value="5"',
        '    return value="w.stored"',
        'fn name=setReadOnly returns=number',
        '  handler',
        '    let name=r value="new ReadOnly()"',
        '    assign target="r.value" value="5"',
        '    return value="r.value"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('setWriteOnly()', env))).toBe(5);
    expect(() => evalCoreExpression('setReadOnly()', env)).toThrow('cannot assign getter-only property: value');
  });

  test('rejects undeclared instance and super property reads and writes', () => {
    const root = parse(
      [
        'class name=Base',
        '  field name=known type=number value={{ 1 }}',
        'class name=Derived extends=Base',
        '  method name=readMissingSuper returns=number',
        '    handler',
        '      return value="super.missing"',
        '  method name=writeMissingSuper returns=number',
        '    handler',
        '      assign target="super.missing" value="2"',
        '      return value="this.known"',
        'fn name=readMissing returns=number',
        '  handler',
        '    let name=d value="new Derived()"',
        '    return value="d.missing"',
        'fn name=writeMissing returns=number',
        '  handler',
        '    let name=d value="new Derived()"',
        '    assign target="d.missing" value="2"',
        '    return value="d.known"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('readMissing()', env)).toThrow('unknown instance property');
    expect(() => evalCoreExpression('writeMissing()', env)).toThrow('undeclared instance property');
    expect(() => evalCoreExpression('new Derived().readMissingSuper()', env)).toThrow('unknown super property');
    expect(() => evalCoreExpression('new Derived().writeMissingSuper()', env)).toThrow('undeclared super property');
  });

  test('rejects undeclared static property reads and writes', () => {
    const root = parse(
      [
        'class name=Closed',
        '  field name=known type=number static=true value={{ 1 }}',
        'fn name=writeMissingStatic returns=number',
        '  handler',
        '    assign target="Closed.missing" value="2"',
        '    return value="Closed.known"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('Closed.missing', env)).toThrow('unknown static property');
    expect(() => evalCoreExpression('writeMissingStatic()', env)).toThrow('undeclared static property');
  });

  test('keeps records open while class instances are shape-checked', () => {
    const result = runCoreRuntime(
      handler([
        { type: 'let', props: { name: 'r', value: '{ a: 1 }' } },
        { type: 'assign', props: { target: 'r.b', value: '2' } },
        { type: 'return', props: { value: 'r.b' } },
      ]),
    );

    expect(toHostValue(result.completion.value)).toBe(2);
  });

  test('rejects recursive setter assignment', () => {
    const root = parse(
      [
        'class name=Loop',
        '  setter name=value',
        '    param name=next type=number',
        '    handler',
        '      assign target="this.value" value="next"',
        'fn name=setLoop returns=number',
        '  handler',
        '    let name=loop value="new Loop()"',
        '    assign target="loop.value" value="5"',
        '    return value="0"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('setLoop()', env)).toThrow('recursive setter assignment: Loop.value');
  });

  test('allows chained setters for different properties', () => {
    const root = parse(
      [
        'class name=Chain',
        '  field name=_b type=number value={{ 0 }}',
        '  setter name=a',
        '    param name=next type=number',
        '    handler',
        '      assign target="this.b" value="next + 1"',
        '  setter name=b',
        '    param name=next type=number',
        '    handler',
        '      assign target="this._b" value="next * 2"',
        '  getter name=b returns=number',
        '    handler',
        '      return value="this._b"',
        'fn name=setChain returns=number',
        '  handler',
        '    let name=chain value="new Chain()"',
        '    assign target="chain.a" value="4"',
        '    return value="chain.b"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('setChain()', env))).toBe(10);
  });

  test('a lambda-only super is not effective: implicit base init runs and fails an arg-requiring base', () => {
    // The only super(id) sits inside a lambda, so it never runs at construction.
    // Under Option C the derived constructor is in implicit mode: KERN attempts a
    // no-arg base init FIRST, which fails because Entity's constructor requires
    // `id`. The 'missing required argument: id' error (not a lambda error) proves
    // the lambda super was NOT counted AND implicit base init was attempted.
    const root = parse(
      [
        'class name=Entity',
        '  constructor',
        '    param name=id type=string',
        '    handler',
        '      assign target="this.id" value="id"',
        'class name=User extends=Entity',
        '  constructor',
        '    param name=id type=string',
        '    handler',
        '      do value="(() => super(id))"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(() => evalCoreExpression('new User("u1")', env)).toThrow('missing required argument: id');
  });

  test('derived constructor that omits super gets implicit base init (Option C, parity with codegen)', () => {
    // Mirrors the class-conformance Box/Base fixture inside the interpreter: Box's
    // constructor touches this.x but never calls super(). KERN injects base init
    // FIRST (so Base.tag=1 default is present), then derived field defaults, then
    // the body — get() = x(7) + tag(1) = 8. Proves the runtime now agrees with
    // generated TS/Python instead of throwing "must call super(...)".
    const root = parse(
      [
        'class name=Base',
        '  field name=tag type=number value={{ 1 }}',
        'class name=Box extends=Base',
        '  field name=x type=number value={{ 0 }}',
        '  constructor',
        '    param name=v type=number',
        '    handler',
        '      assign target="this.x" value="v"',
        '  method name=get returns=number',
        '    handler',
        '      return value="this.x + this.tag"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(root, env);

    expect(toHostValue(evalCoreExpression('new Box(7).get()', env))).toBe(8);
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
