/** Slice H — fail-closed on unmapped host namespaces (Python AST emitter).
 *
 *  The Python AST expression emitter used to emit unmapped host-namespace
 *  member CALLS verbatim into Python (e.g. `Math.sqrt(x)` → `Math.sqrt(x)`),
 *  which is a runtime `NameError` in Python and silently wrong. This slice
 *  adds a fail-closed guard at the verbatim member-call / member-read emission
 *  point in `lowerChain`.
 *
 *  The guard's TRIGGER PREDICATE is capitalization-agnostic and host-shaped —
 *  it is NOT a hardcoded {Math,JSON,Object,Date} allowlist. It fires on a
 *  host-namespace-shaped root identifier (PascalCase / all-caps, or a known
 *  lowercase host global like `console`/`process`) that is in MEMBER-CALL (or
 *  host-constant member-read) position, is NOT proven user-bound in the
 *  emitter's existing scope model, and has no explicit AST lowering. So it
 *  equally catches `console.log`, `Promise.all`, `RegExp.escape`, etc.
 *
 *  These fixtures are the discriminating kill-set from the slice spec, plus the
 *  tribunal-mandated lowercase repro (`console.log`) proving the predicate is
 *  capitalization-agnostic. */

import type { IRNode } from '@kernlang/core';
import { parseExpression } from '@kernlang/core';
import { emitNativeKernBodyPython, emitPyExpression } from '../src/codegen-body-python.js';
import { generateFirstTruthy } from '../src/codegen-python.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

function makeHandler(stmts: Array<{ type: string; props: Record<string, unknown>; children?: IRNode[] }>): IRNode {
  return {
    type: 'handler',
    props: { lang: 'kern' },
    children: stmts.map((s) => ({ type: s.type, props: s.props, children: s.children })),
  };
}

describe('Slice H — kills silent verbatim host-namespace passthrough', () => {
  test('ground firstTruthy: Math.sqrt operand fails closed (never emits Math.sqrt verbatim)', () => {
    expect(() =>
      generateFirstTruthy(mk('firstTruthy', { name: 'label', values: "Math.sqrt(distance), 'fallback'" })),
    ).toThrow(/Unknown KERN-stdlib method\/member 'Math\.sqrt'/);

    // Negative assertion: the buggy verbatim string must never be produced.
    let generated: string | null = null;
    try {
      generated = generateFirstTruthy(
        mk('firstTruthy', { name: 'label', values: "Math.sqrt(distance), 'fallback'" }),
      ).join('\n');
    } catch {
      generated = null;
    }
    expect(generated).toBeNull();
  });

  test('native body firstTruthy: Math.sqrt operand fails closed', () => {
    const handler = makeHandler([
      { type: 'firstTruthy', props: { name: 'label', values: "Math.sqrt(distance), 'fallback'" } },
      { type: 'return', props: { value: 'label' } },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/Unknown KERN-stdlib method\/member 'Math\.sqrt'/);
  });

  test('implemented compatibility host aliases lower before the reserved-root guard', () => {
    expect(emitPyExpression(parseExpression('JSON.parse(raw)'))).toBe('__k_json.loads(raw)');
    expect(emitPyExpression(parseExpression('Object.keys(obj)'))).toBe('_kern_js_object_keys(obj)');
  });

  test('still-refused reserved host roots in AST emit fail closed', () => {
    expect(() => emitPyExpression(parseExpression('Date.now()'))).toThrow(
      /Unsupported host namespace in Python expression: Date\.now .*not registered/,
    );
  });

  test('implemented host-constant member READ lowers (Math.PI)', () => {
    expect(emitPyExpression(parseExpression('Math.PI'))).toBe('__k_math.pi');
  });
});

describe('Slice H — capitalization-agnostic predicate (lowercase host globals)', () => {
  test('console.log fails closed with the same diagnostic (proves no [A-Z] gate / no four-root allowlist)', () => {
    expect(() => emitPyExpression(parseExpression('console.log(x)'))).toThrow(
      /Unsupported host namespace in Python expression: console\.log .*not registered/,
    );
  });

  test('process.env member read fails closed', () => {
    expect(() => emitPyExpression(parseExpression('process.env'))).toThrow(
      /Unsupported host namespace in Python expression: process\.env .*not registered/,
    );
  });

  test('Promise.all / RegExp.escape (capitalized non-four host roots) fail closed', () => {
    expect(() => emitPyExpression(parseExpression('Promise.all(ps)'))).toThrow(
      /Unsupported host namespace in Python expression: Promise\.all .*not registered/,
    );
    expect(() => emitPyExpression(parseExpression('RegExp.escape(s)'))).toThrow(
      /Unsupported host namespace in Python expression: RegExp\.escape .*not registered/,
    );
  });
});

describe('Slice H review fix — bracket (index) access cannot bypass the guard', () => {
  test('Math["sqrt"](x) fails closed exactly like Math.sqrt(x)', () => {
    expect(() => emitPyExpression(parseExpression('Math["sqrt"](x)'))).toThrow(
      /Unknown KERN-stdlib method\/member 'Math\.sqrt'/,
    );
  });

  test('host-constant bracket READ fails closed (Object["keys"], console["log"])', () => {
    expect(() => emitPyExpression(parseExpression('Object["keys"]'))).toThrow(
      /Unknown KERN-stdlib method\/member 'Object\.keys'/,
    );
    expect(() => emitPyExpression(parseExpression('console["log"](x)'))).toThrow(
      /Unsupported host namespace in Python expression: console\.log .*not registered/,
    );
  });

  test('computed key on a host root fails closed too (Math[k])', () => {
    expect(() => emitPyExpression(parseExpression('Math[k]'))).toThrow(
      /Unknown KERN-stdlib method\/member 'Math\.\[computed\]'/,
    );
  });

  test('bracket access on user bindings stays legal (dict/list indexing untouched)', () => {
    expect(emitPyExpression(parseExpression('data["key"]'))).toBe('data["key"]');
    expect(emitPyExpression(parseExpression('items[0]'))).toBe('items[0]');
  });
});

describe('Slice H review hardening — Intl / URL join the curated host-root set', () => {
  test('Intl.DateTimeFormat() and URL.canParse(x) fail closed (were failing open at review)', () => {
    expect(() => emitPyExpression(parseExpression('Intl.DateTimeFormat()'))).toThrow(
      /Unsupported host namespace in Python expression: Intl\.DateTimeFormat .*not registered/,
    );
    expect(() => emitPyExpression(parseExpression('URL.canParse(x)'))).toThrow(
      /Unsupported host namespace in Python expression: URL\.canParse .*not registered/,
    );
  });
});

describe('Slice H — keeps user bindings except reserved stdlib namespaces', () => {
  test('a proven local root named Math still resolves through the reserved stdlib namespace', () => {
    expect(() => emitPyExpression(parseExpression('Math.sqrt(x)'), { outerBindings: ['Math', 'x'] })).toThrow(
      /Unknown KERN-stdlib method\/member 'Math\.sqrt'/,
    );
  });

  test('native body with outerBindings Math still fails closed through the reserved stdlib namespace', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'Math.sqrt(x)' } }]);
    expect(() => emitNativeKernBodyPython(handler, { outerBindings: ['Math', 'x'] })).toThrow(
      /Unknown KERN-stdlib method\/member 'Math\.sqrt'/,
    );
  });

  test('custom receivers (lowercase / member roots) are out of scope and pass through', () => {
    // `client` is a user receiver (lowercase, not host-shaped) — verbatim.
    expect(emitPyExpression(parseExpression('client.send("ping")'))).toBe('client.send("ping")');
    // `user.profile.email` is a member READ on a user receiver — verbatim.
    expect(emitPyExpression(parseExpression('user.profile.email'))).toBe('user.profile.email');
  });
});

describe('Slice H — does NOT scan string literals', () => {
  test('a string literal containing Math.sqrt(...) etc. is not inspected', () => {
    expect(emitPyExpression(parseExpression('tag("Math.sqrt(x) Object.keys(y) Date.now()")'))).toBe(
      'tag("Math.sqrt(x) Object.keys(y) Date.now()")',
    );
  });
});

describe('Slice H — keeps canonical KERN stdlib lowering', () => {
  test('Number.* / Json.* canonical stdlib roots still lower (never blocked by the guard)', () => {
    expect(emitPyExpression(parseExpression('Number.floor(n)'))).toBe('__k_math.floor(n)');
    expect(emitPyExpression(parseExpression('Json.parse(raw)'))).toBe('__k_json.loads(raw)');
  });
});
