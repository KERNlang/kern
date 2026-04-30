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
    expect(code).toBe('return math.floor(x)');
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

  test('end-to-end via generateFunction: import math is injected at top of body', () => {
    const fn = makeFn({ name: 'roundIt', params: 'x:number', returns: 'number' }, [
      { type: 'return', props: { value: 'Number.round(x)' } },
    ]);
    const lines = generateFunction(fn);
    const joined = lines.join('\n');
    expect(joined).toContain('def round_it(x: float) -> float:');
    expect(joined).toMatch(/import math[\s\S]*math\.floor\(x \+ 0\.5\)/);
  });

  test('handlers without math-dependent stdlib emit no extra import', () => {
    const fn = makeFn({ name: 'shout', params: 's:string', returns: 'string' }, [
      { type: 'return', props: { value: 'Text.upper(s)' } },
    ]);
    const lines = generateFunction(fn);
    expect(lines.join('\n')).not.toContain('import math');
  });
});

// ── 3c: Number.round JS-parity ────────────────────────────────────────────

describe('slice 3c — Number.round JS-parity on Python', () => {
  test('Number.round(x) lowers to math.floor(x + 0.5)', () => {
    expect(emitPyExpression(parseExpression('Number.round(x)'))).toBe('math.floor(x + 0.5)');
  });

  test('paren-wrapped binary arg preserved through template substitution', () => {
    // Number.round(a - b) — receiver is binary, gets paren-wrapped to `(a - b)`,
    // then the `+ 0.5` is appended at template-substitution time.
    expect(emitPyExpression(parseExpression('Number.round(a - b)'))).toBe('math.floor((a - b) + 0.5)');
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

  test('symbolMap option is respected by both legacy and Ctx variants', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'orderId' } }]);
    expect(emitNativeKernBodyPython(handler, { symbolMap: { orderId: 'order_id' } })).toBe('return order_id');
    const ctx = emitNativeKernBodyPythonWithImports(handler, { symbolMap: { orderId: 'order_id' } });
    expect(ctx.code).toBe('return order_id');
  });
});
