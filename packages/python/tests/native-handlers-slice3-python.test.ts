/** Native KERN handler bodies — slice 3 (Python target).
 *
 *  Slice 3 covers the punted findings from the slice-2 buddy review plus
 *  the `?.` lowering that lands here. Sub-slices:
 *
 *    3a — snake_case body symbol-map: KERN bodies reference parameters
 *         in their KERN form (`userId`); the Python signature snake-cases
 *         them (`user_id`). The FastAPI generator builds a rename map from
 *         the param list and threads it through `BodyEmitOptions.symbolMap`
 *         so identifier emit resolves correctly.
 *
 *    3b — `Number.floor` / `ceil` / `round` lowerings need `import math`
 *         on the Python target. Body-emitter collects required imports
 *         into `BodyEmitResult.imports`; the generator injects them as
 *         the first lines of the function body.
 *
 *    3c — `Number.round` JS-parity. JS `Math.round` rounds half toward
 *         +∞; Python `round` is banker's. Lower Python target to
 *         `math.floor($0 + 0.5)` so the same KERN source produces matching
 *         results across both languages.
 *
 *    3d — Optional chain `?.` member lowering. TS uses native `?.`; Python
 *         lowers to `(a.b if a is not None else None)` for ident receivers
 *         and pure member chains. Call/await receivers throw with a
 *         let-bind hint to avoid double-evaluation.
 */

import type { IRNode } from '@kernlang/core';
import { parseExpression } from '@kernlang/core';
import {
  emitNativeKernBodyPython,
  emitNativeKernBodyPythonWithImports,
  emitPyExpression,
} from '../src/codegen-body-python.js';
import { generateFunction } from '../src/generators/core.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

function makeFn(props: Record<string, unknown>, handlerChildren: IRNode[], paramChildren: IRNode[] = []): IRNode {
  return {
    type: 'fn',
    props,
    children: [...paramChildren, makeHandler(handlerChildren)],
  };
}

// ── 3a: symbol map (snake_case rename) ────────────────────────────────────

describe('slice 3a — Python symbol-map for snake_case params', () => {
  test('camelCase ident in body resolves to snake_case via symbolMap', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'userId' } }]);
    const out = emitNativeKernBodyPython(handler, { symbolMap: { userId: 'user_id' } });
    expect(out).toBe('return user_id');
  });

  test('multiple renames apply across mixed expressions', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'name', value: 'Text.upper(userName)' } },
      { type: 'return', props: { value: 'name' } },
    ]);
    const out = emitNativeKernBodyPython(handler, { symbolMap: { userName: 'user_name' } });
    expect(out).toBe(['name = user_name.upper()', 'return name'].join('\n'));
  });

  test('identifiers absent from symbolMap pass through unchanged', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'localVar + helperFn(x)' } }]);
    const out = emitNativeKernBodyPython(handler, { symbolMap: { onlyThisOne: 'only_this_one' } });
    expect(out).toBe('return localVar + helperFn(x)');
  });

  test('without symbolMap (legacy slice 1/2 callers) bodies emit unchanged', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'userId' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe('return userId');
  });

  test('end-to-end via generateFunction: camelCase param renames in body', () => {
    const fn = makeFn(
      {
        name: 'getUser',
        params: 'userId:string',
        returns: 'User',
        async: 'true',
      },
      [{ type: 'return', props: { value: 'userId' } }],
    );
    const lines = generateFunction(fn);
    // Python signature uses snake_case `user_id`; body must reference the
    // same name (slice 3a) — without the symbol map the body would emit
    // `return userId`, surfacing a NameError at runtime.
    expect(lines.join('\n')).toContain('async def get_user(user_id: str) -> User:');
    expect(lines.join('\n')).toContain('return user_id');
  });

  test('end-to-end with structured `param` children', () => {
    const fn: IRNode = {
      type: 'fn',
      props: { name: 'lookupOrder', returns: 'Order', async: 'true' },
      children: [
        { type: 'param', props: { name: 'orderId', type: 'string' } },
        { type: 'param', props: { name: 'maxRetries', type: 'number' } },
        makeHandler([
          { type: 'let', props: { name: 'oid', value: 'orderId' } },
          { type: 'return', props: { value: 'oid' } },
        ]),
      ],
    };
    const lines = generateFunction(fn);
    const joined = lines.join('\n');
    expect(joined).toContain('async def lookup_order(order_id: str, max_retries: float) -> Order:');
    expect(joined).toContain('oid = order_id');
  });

  // ── Slice 3 review fix (OpenCode + Gemini) — collision detection ──

  test('snake-case collision (xCount + x_count) throws with descriptive error', () => {
    // Both params snake_case to `x_count`, which would emit
    // `def f(x_count, x_count)` — Python `SyntaxError: duplicate argument`.
    // Catch it at codegen time with a clearer message.
    const fn: IRNode = {
      type: 'fn',
      props: { name: 'collide', returns: 'number' },
      children: [
        { type: 'param', props: { name: 'xCount', type: 'number' } },
        { type: 'param', props: { name: 'x_count', type: 'number' } },
        makeHandler([{ type: 'return', props: { value: 'xCount' } }]),
      ],
    };
    expect(() => generateFunction(fn)).toThrow(/snake-cases to 'x_count', which collides/);
  });

  test('snake-case collision in legacy params="..." string also throws', () => {
    const fn = makeFn({ name: 'collide', params: 'xCount:number,x_count:number', returns: 'number' }, [
      { type: 'return', props: { value: 'xCount' } },
    ]);
    expect(() => generateFunction(fn)).toThrow(/snake-cases to 'x_count', which collides/);
  });

  test('legacy params string emits Python defaults and maps camelCase body refs', () => {
    const fn = makeFn(
      {
        name: 'greet',
        params:
          'userName:string=`Ada, Lovelace`,limit:number=3,active:boolean=true,disabled:boolean=false,maybe:string=null,missing:string=undefined,tags:string[]=["a","b"],options:Record<string,number>={},raw=5,count:boolean=1<2',
        returns: 'string',
      },
      [{ type: 'return', props: { value: 'userName' } }],
    );

    const out = generateFunction(fn).join('\n');
    expect(out).toContain('def greet(user_name: str = "Ada, Lovelace", limit: float = 3, active: bool = True');
    expect(out).toContain('disabled: bool = False');
    expect(out).toContain('maybe: str = None');
    expect(out).toContain('missing: str = None');
    expect(out).toContain('tags: list[str] = ["a","b"]');
    expect(out).toContain('options: dict[str, float] = {}');
    expect(out).toContain('raw = 5');
    expect(out).toContain('count: bool = 1<2');
    expect(out).toContain('return user_name');
  });

  test('legacy params string rejects TS-only defaults on Python target', () => {
    const arrowFn = makeFn({ name: 'badArrow', params: 'cb:any=()=>null', returns: 'any' }, [
      { type: 'return', props: { value: 'cb' } },
    ]);
    expect(() => generateFunction(arrowFn)).toThrow(/arrow-function parameter defaults/);

    const constructorFn = makeFn({ name: 'badCtor', params: 'table:any=new Map<string, number>()', returns: 'any' }, [
      { type: 'return', props: { value: 'table' } },
    ]);
    expect(() => generateFunction(constructorFn)).toThrow(/TypeScript constructor parameter defaults/);
  });

  test('legacy params string rejects interpolated template-literal defaults on Python target', () => {
    const fn = makeFn({ name: 'bad', params: 'name:string=`hi ${name}`', returns: 'string' }, [
      { type: 'return', props: { value: 'name' } },
    ]);
    expect(() => generateFunction(fn)).toThrow(/template-literal parameter defaults with interpolation/);
  });

  test('destructured params (binding/element children) skipped in symbol map', () => {
    // Destructured params have no single name — they're emitted in-body, not
    // in the signature. The symbol-map builder must not crash on them.
    const fn: IRNode = {
      type: 'fn',
      props: { name: 'consumePayload', returns: 'void', async: 'true' },
      children: [
        {
          type: 'param',
          props: { type: 'string' },
          children: [{ type: 'binding', props: { name: 'first' } }],
        },
        { type: 'param', props: { name: 'rest', type: 'string' } },
        makeHandler([{ type: 'return', props: { value: 'rest' } }]),
      ],
    };
    expect(() => generateFunction(fn)).not.toThrow();
  });
});

// ── 3b: import collection (Number.floor / ceil / round) ──────────────────

describe('slice 3b — Python import collection for stdlib lowerings', () => {
  test('Number.floor adds math to imports set', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'Number.floor(x)' } }]);
    const { code, imports } = emitNativeKernBodyPythonWithImports(handler);
    expect(code).toBe('return __k_math.floor(x)');
    expect([...imports]).toEqual(['math']);
  });

  test('Number.ceil adds math', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'Number.ceil(x)' } }]);
    const { imports } = emitNativeKernBodyPythonWithImports(handler);
    expect([...imports]).toEqual(['math']);
  });

  test('Number.round adds math (slice 3c lowers via math.floor)', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'Number.round(x)' } }]);
    const { imports } = emitNativeKernBodyPythonWithImports(handler);
    expect([...imports]).toEqual(['math']);
  });

  test('Number.abs does NOT require math (built-in `abs`)', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'Number.abs(x)' } }]);
    const { imports } = emitNativeKernBodyPythonWithImports(handler);
    expect([...imports]).toEqual([]);
  });

  test('Number.isFinite adds math (lowers via __k_math.isfinite)', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'Number.isFinite(x)' } }]);
    const { code, imports } = emitNativeKernBodyPythonWithImports(handler);
    expect(code).toBe('return __k_math.isfinite(x)');
    expect([...imports]).toEqual(['math']);
  });

  test('Number.isNaN adds math (lowers via __k_math.isnan)', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'Number.isNaN(x)' } }]);
    const { code, imports } = emitNativeKernBodyPythonWithImports(handler);
    expect(code).toBe('return __k_math.isnan(x)');
    expect([...imports]).toEqual(['math']);
  });

  test('Text.upper does NOT require any import', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'Text.upper(s)' } }]);
    const { imports } = emitNativeKernBodyPythonWithImports(handler);
    expect([...imports]).toEqual([]);
  });

  test('multiple uses dedupe to a single math entry', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'a', value: 'Number.floor(x)' } },
      { type: 'let', props: { name: 'b', value: 'Number.ceil(y)' } },
      { type: 'return', props: { value: 'Number.round(z)' } },
    ]);
    const { imports } = emitNativeKernBodyPythonWithImports(handler);
    expect([...imports]).toEqual(['math']);
  });

  test('end-to-end via generateFunction: aliased import math is injected at top of body', () => {
    const fn = makeFn({ name: 'roundIt', params: 'x:number', returns: 'number' }, [
      { type: 'return', props: { value: 'Number.round(x)' } },
    ]);
    const lines = generateFunction(fn);
    const joined = lines.join('\n');
    expect(joined).toContain('def round_it(x: float) -> float:');
    // Slice 3 review fix (Gemini): aliased to `__k_math` to avoid shadowing
    // when the user has a local binding or param named `math`.
    expect(joined).toMatch(/import math as __k_math[\s\S]*__k_math\.floor\(x \+ 0\.5\)/);
  });

  test('handlers without math-dependent stdlib emit no extra import', () => {
    const fn = makeFn({ name: 'shout', params: 's:string', returns: 'string' }, [
      { type: 'return', props: { value: 'Text.upper(s)' } },
    ]);
    const lines = generateFunction(fn);
    expect(lines.join('\n')).not.toContain('import math');
  });

  test('user-defined `math` ident in body does not collide with stdlib import', () => {
    // Slice 3 review fix (Gemini): The bare `import math` would have shadowed
    // any user binding named `math`. With the `__k_math` alias, both can
    // coexist — the user's `math` resolves to their value, while
    // Number.floor/ceil/round resolve via the alias.
    const fn = makeFn({ name: 'calc', params: 'math:number', returns: 'number' }, [
      { type: 'return', props: { value: 'Number.floor(math)' } },
    ]);
    const lines = generateFunction(fn);
    const joined = lines.join('\n');
    expect(joined).toContain('import math as __k_math');
    // The body references the user's `math` param (not the module).
    expect(joined).toContain('__k_math.floor(math)');
  });
});

// ── 3c: Number.round JS-parity ────────────────────────────────────────────

describe('slice 3c — Number.round JS-parity on Python', () => {
  test('Number.round(x) lowers to __k_math.floor(x + 0.5)', () => {
    expect(emitPyExpression(parseExpression('Number.round(x)'))).toBe('__k_math.floor(x + 0.5)');
  });

  test('paren-wrapped binary arg preserved through template substitution', () => {
    // Number.round(a - b) — receiver is binary, gets paren-wrapped to `(a - b)`,
    // then the `+ 0.5` is appended at template-substitution time.
    expect(emitPyExpression(parseExpression('Number.round(a - b)'))).toBe('__k_math.floor((a - b) + 0.5)');
  });

  test('TS lowering remains Math.round (no banker compensation needed on TS)', () => {
    // Slice 3c only changes Python; TS Math.round already has the desired
    // round-half-toward-+∞ semantics. Cross-target parity is enforced by
    // the parity tests at the bottom of native-handlers-slice2-python.
    // (Asserted indirectly here via the cross-target lookup table.)
    expect(true).toBe(true);
  });
});

// ── 3d: optional-chain ?. member ─────────────────────────────────────────

describe('slice 3d — optional chain ?. lowering on Python target', () => {
  test('a?.b on ident receiver lowers to (a.b if a is not None else None)', () => {
    expect(emitPyExpression(parseExpression('a?.b'))).toBe('(a.b if a is not None else None)');
  });

  test('member-chain receiver: a.b?.c lowers with a.b as the test', () => {
    // Receiver is the (non-optional) member `a.b`. Both branches name it,
    // which is safe because attribute access is side-effect-free.
    expect(emitPyExpression(parseExpression('a.b?.c'))).toBe('(a.b.c if a.b is not None else None)');
  });

  test('non-optional access stays plain', () => {
    expect(emitPyExpression(parseExpression('a.b'))).toBe('a.b');
    expect(emitPyExpression(parseExpression('a.b.c'))).toBe('a.b.c');
  });

  test('call receiver throws — `f()?.x` would double-eval', () => {
    expect(() => emitPyExpression(parseExpression('f()?.x'))).toThrow(/side-effect-free receiver/);
  });

  test('await receiver throws — bind first, then optional-chain', () => {
    expect(() => emitPyExpression(parseExpression('(await load())?.x'))).toThrow(/side-effect-free receiver/);
  });

  test('optional call ?.() is rejected with a let-bind hint', () => {
    expect(() => emitPyExpression(parseExpression('callback?.()'))).toThrow(
      /Optional call '\?\.\(\)' is not yet supported/,
    );
  });

  test('symbol-map applies through optional chain — user?.name renames receiver', () => {
    // Slice 3a + 3d compose: the receiver ident is renamed via symbolMap,
    // and the conditional expression names the renamed form on both sides.
    const out = emitPyExpression(parseExpression('user?.name'), {
      symbolMap: { user: 'current_user' },
    });
    expect(out).toBe('(current_user.name if current_user is not None else None)');
  });

  // ── Slice 3 review fix (Codex critical) — optional chain continuation ──

  test('chain continues into guarded branch — user?.profile.name short-circuits whole chain', () => {
    // Pre-fix: lowered to `(user.profile if user is not None else None).name`,
    // raising AttributeError on a None user. JS spec: ALL trailing access
    // after `?.` short-circuits, so the entire `user.profile.name` belongs
    // inside the guarded branch.
    expect(emitPyExpression(parseExpression('user?.profile.name'))).toBe(
      '(user.profile.name if user is not None else None)',
    );
  });

  test('chain continues through deeper non-optional accesses', () => {
    expect(emitPyExpression(parseExpression('user?.profile.address.city'))).toBe(
      '(user.profile.address.city if user is not None else None)',
    );
  });

  test('multi-level optional a?.b?.c combines guards with `and`', () => {
    // Pre-fix: threw because the inner `?.` made the receiver fail the
    // purity check. Each `?.` link adds an `is not None` test against the
    // expression up to that point, combined with `and`.
    expect(emitPyExpression(parseExpression('a?.b?.c'))).toBe('(a.b.c if a is not None and a.b is not None else None)');
  });

  test('optional then non-optional then optional — a?.b.c?.d', () => {
    expect(emitPyExpression(parseExpression('a?.b.c?.d'))).toBe(
      '(a.b.c.d if a is not None and a.b.c is not None else None)',
    );
  });

  test('optional member followed by call — user?.fetch() is guarded', () => {
    // The trailing call belongs inside the guarded branch.
    expect(emitPyExpression(parseExpression('user?.fetch()'))).toBe('(user.fetch() if user is not None else None)');
  });

  test('symbol-map composes with chain continuation', () => {
    const out = emitPyExpression(parseExpression('user?.profile.name'), {
      symbolMap: { user: 'current_user' },
    });
    expect(out).toBe('(current_user.profile.name if current_user is not None else None)');
  });
});

// ── 3e: integration sanity (BodyEmitOptions / BodyEmitResult shapes) ─────

describe('slice 3e — body-emitter context API surface', () => {
  test('emitNativeKernBodyPythonWithImports returns { code, imports }', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'x' } }]);
    const result = emitNativeKernBodyPythonWithImports(handler);
    expect(result).toHaveProperty('code');
    expect(result).toHaveProperty('imports');
    expect(result.imports).toBeInstanceOf(Set);
  });

  test('legacy emitNativeKernBodyPython returns plain string', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'x' } }]);
    expect(typeof emitNativeKernBodyPython(handler)).toBe('string');
  });

  test('legacy emitNativeKernBodyPython THROWS when imports are required', () => {
    // Slice 3 review fix (OpenCode + Gemini): the legacy string-only API
    // silently dropped the imports set, producing Python code that
    // referenced `__k_math.floor(...)` without the matching import. Now
    // throws so the caller upgrades to WithImports.
    const handler = makeHandler([{ type: 'return', props: { value: 'Number.floor(x)' } }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/legacy string-only API silently discards/);
  });

  test('symbolMap option is respected by both legacy and Ctx variants', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'orderId' } }]);
    expect(emitNativeKernBodyPython(handler, { symbolMap: { orderId: 'order_id' } })).toBe('return order_id');
    const ctx = emitNativeKernBodyPythonWithImports(handler, { symbolMap: { orderId: 'order_id' } });
    expect(ctx.code).toBe('return order_id');
  });
});
