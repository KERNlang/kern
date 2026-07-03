/** KERN-stdlib lowering — slice 2a Python target (Text module).
 *
 *  Mirror of core/tests/native-handlers-stdlib.test.ts for Python. Same
 *  `Text.*(...)` source emits idiomatic Python via the `py` column of the
 *  stdlib lowering table. */

import type { IRNode } from '@kernlang/core';
import { parseExpression } from '@kernlang/core';
import { emitNativeKernBodyPythonWithImports, emitPyExpression } from '../src/codegen-body-python.js';
import { generateFunction } from '../src/generators/core.js';

describe('emitPyExpression — KERN-stdlib dispatch (Text module)', () => {
  test('Text.upper(s) lowers to Python s.upper()', () => {
    expect(emitPyExpression(parseExpression('Text.upper(s)'))).toBe('s.upper()');
  });

  test('Text.lower(s) lowers to Python s.lower()', () => {
    expect(emitPyExpression(parseExpression('Text.lower(name)'))).toBe('name.lower()');
  });

  // KERN 4.5.0 item 3 — string parity completion. `Text.length` now lowers
  // to the shared well-formedness-guarded helper, not native `len(...)` —
  // Python's `str` is already code-point-native, but the helper still
  // fail-closes on a malformed (lone/reversed) surrogate code point,
  // matching the runner and TS legs.
  test('Text.length(s) lowers to Python _kern_text_length(s) (well-formedness-guarded, not bare len)', () => {
    expect(emitPyExpression(parseExpression('Text.length(s)'))).toBe('_kern_text_length(s)');
  });

  test('Text.charAt(s, i) lowers to Python _kern_text_char_at(s, i)', () => {
    expect(emitPyExpression(parseExpression('Text.charAt(s, i)'))).toBe('_kern_text_char_at(s, i)');
  });

  test('Text.slice(s, a, b) lowers to Python _kern_text_slice(s, a, b)', () => {
    expect(emitPyExpression(parseExpression('Text.slice(s, a, b)'))).toBe('_kern_text_slice(s, a, b)');
  });

  test('Text.indexOf(s, needle) lowers to Python _kern_text_index_of(s, needle)', () => {
    expect(emitPyExpression(parseExpression('Text.indexOf(s, needle)'))).toBe('_kern_text_index_of(s, needle)');
  });

  test('Text.startsWith(s, prefix) lowers to Python _kern_text_starts_with(s, prefix) (not bare .startswith)', () => {
    expect(emitPyExpression(parseExpression('Text.startsWith(s, prefix)'))).toBe('_kern_text_starts_with(s, prefix)');
  });

  test('Text.trim(s) lowers to Python s.strip() (NOT s.trim — that is JS)', () => {
    expect(emitPyExpression(parseExpression('Text.trim(input)'))).toBe('input.strip()');
  });

  test('nested stdlib calls compose in Python form', () => {
    // Text.upper(Text.trim(raw)) → raw.strip().upper()
    expect(emitPyExpression(parseExpression('Text.upper(Text.trim(raw))'))).toBe('raw.strip().upper()');
  });

  test('Text.length nested inside another call lowers to _kern_text_length(...)', () => {
    expect(emitPyExpression(parseExpression('check(Text.length(s))'))).toBe('check(_kern_text_length(s))');
  });

  test('unknown method on Text throws with did-you-mean (Python target)', () => {
    expect(() => emitPyExpression(parseExpression('Text.uppr(s)'))).toThrow(/Text.upper/);
  });

  test('non-stdlib module passes through unchanged in Python', () => {
    expect(emitPyExpression(parseExpression('user.email(x)'))).toBe('user.email(x)');
  });

  test('lambda callbacks lower to Python lambda expressions', () => {
    expect(emitPyExpression(parseExpression('visit(() => value)'))).toBe('visit(lambda: value)');
    expect(emitPyExpression(parseExpression('visit((a, b) => a + b)'))).toBe('visit(lambda a, b: __kern_add(a, b))');
    expect(emitPyExpression(parseExpression('visit(user => user.name)'))).toBe('visit(lambda user: user.name)');
    expect(emitPyExpression(parseExpression('visit((user: User) => user.name)'))).toBe('visit(lambda user: user.name)');
  });

  test('List.map and List.filter lower one-param lambdas to Python comprehensions', () => {
    expect(emitPyExpression(parseExpression('List.map(users, user => user.name)'))).toBe(
      '[user.name for user in users]',
    );
    expect(emitPyExpression(parseExpression('List.filter(users, user => user.active)'))).toBe(
      '[user for user in users if user.active]',
    );
  });

  test('lambda params shadow outer symbol-map renames', () => {
    expect(
      emitPyExpression(parseExpression('List.map(users, userId => userId.name)'), {
        symbolMap: { userId: 'user_id' },
      }),
    ).toBe('[userId.name for userId in users]');
  });

  test('List.map and List.filter reject multi-param lambdas on Python target', () => {
    expect(() => emitPyExpression(parseExpression('List.map(pairs, (a, b) => a + b)'))).toThrow(/one-parameter/);
    expect(() => emitPyExpression(parseExpression('List.filter(pairs, (a, b) => a === b)'))).toThrow(/one-parameter/);
  });
});

describe('Cross-target parity — same KERN source, idiomatic per target', () => {
  test('Text.upper(s) parity', async () => {
    const { emitExpression } = await import('@kernlang/core');
    const src = 'Text.upper(s)';
    expect(emitExpression(parseExpression(src))).toBe('s.toUpperCase()');
    expect(emitPyExpression(parseExpression(src))).toBe('s.upper()');
  });

  test('Text.length(s) parity — both legs route through the code-point-ops helper', async () => {
    const { emitExpression } = await import('@kernlang/core');
    const src = 'Text.length(s)';
    expect(emitExpression(parseExpression(src))).toBe('__kern_text_length(s)');
    expect(emitPyExpression(parseExpression(src))).toBe('_kern_text_length(s)');
  });

  test('Text.trim(s) parity — same name in KERN, different targets', async () => {
    const { emitExpression } = await import('@kernlang/core');
    const src = 'Text.trim(s)';
    expect(emitExpression(parseExpression(src))).toBe('s.trim()');
    expect(emitPyExpression(parseExpression(src))).toBe('s.strip()');
  });
});

// ── Json + Path Python lowering (pure/sync slice) ─────────────────────────

function makeJsonHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('emitPyExpression — KERN-stdlib dispatch (Json module)', () => {
  test('Json.parse(s) lowers to Python __k_json.loads(s)', () => {
    expect(emitPyExpression(parseExpression('Json.parse(s)'))).toBe('__k_json.loads(s)');
  });

  test('Json.stringify(obj) lowers to the sentinel-aware _kern_json_stringify shim', () => {
    // Slice S7: raw `__k_json.dumps` cannot model JS `JSON.stringify`'s undefined
    // handling (omit object keys, sentinel→null in arrays, top-level undefined).
    // The shim wraps `__k_json.dumps(..., separators=(",", ":"), ensure_ascii=False)`
    // and preserves byte-parity for sentinel-free inputs.
    expect(emitPyExpression(parseExpression('Json.stringify(obj)'))).toBe('_kern_json_stringify(obj)');
  });

  test('nested Json+Text composes in Python form', () => {
    expect(emitPyExpression(parseExpression('Json.parse(Text.trim(raw))'))).toBe('__k_json.loads(raw.strip())');
  });

  test('Json.parse arity enforced (zero args throws)', () => {
    expect(() => emitPyExpression(parseExpression('Json.parse()'))).toThrow(/takes 1 arg/);
  });

  test('unknown method on Json throws with did-you-mean (Python target)', () => {
    expect(() => emitPyExpression(parseExpression('Json.parze(s)'))).toThrow(/Json.parse/);
  });
});

describe('emitPyExpression — KERN-stdlib dispatch (Path module)', () => {
  test('Path.basename(p) lowers to Python __k_posixpath.basename(p)', () => {
    expect(emitPyExpression(parseExpression('Path.basename(p)'))).toBe('__k_posixpath.basename(p)');
  });

  test('Path.basename composes inside another call', () => {
    expect(emitPyExpression(parseExpression('check(Path.basename(p))'))).toBe('check(__k_posixpath.basename(p))');
  });

  test('unknown method on Path throws with did-you-mean (Python target)', () => {
    expect(() => emitPyExpression(parseExpression('Path.basname(p)'))).toThrow(/Path.basename/);
  });
});

describe('Json/Path — Python imports collection', () => {
  test('Json.parse adds `json` to imports set (aliased as __k_json)', () => {
    const handler = makeJsonHandler([{ type: 'return', props: { value: 'Json.parse(s)' } }]);
    const { code, imports } = emitNativeKernBodyPythonWithImports(handler);
    expect(code).toBe('return __k_json.loads(s)');
    expect([...imports]).toEqual(['json']);
  });

  test('Json.stringify adds `json` to imports set and emits the sentinel shim call', () => {
    const handler = makeJsonHandler([{ type: 'return', props: { value: 'Json.stringify(obj)' } }]);
    const { code, imports } = emitNativeKernBodyPythonWithImports(handler);
    // Slice S7 — shim call; the shim references `__k_json` supplied by the `json`
    // import (shared with `Json.parse` when both appear).
    expect(code).toBe('return _kern_json_stringify(obj)');
    expect([...imports]).toEqual(['json']);
  });

  test('Path.basename adds `posixpath` to imports set', () => {
    const handler = makeJsonHandler([{ type: 'return', props: { value: 'Path.basename(p)' } }]);
    const { code, imports } = emitNativeKernBodyPythonWithImports(handler);
    expect(code).toBe('return __k_posixpath.basename(p)');
    expect([...imports]).toEqual(['posixpath']);
  });

  test('mixed Json + Path collects both imports', () => {
    const handler = makeJsonHandler([
      { type: 'let', props: { name: 'name', value: 'Path.basename(p)' } },
      { type: 'return', props: { value: 'Json.stringify(name)' } },
    ]);
    const { imports } = emitNativeKernBodyPythonWithImports(handler);
    // Set order is insertion order; let runs first, return second.
    expect([...imports].sort()).toEqual(['json', 'posixpath']);
  });

  test('repeated Json.parse + Json.stringify dedupes to a single `json` entry', () => {
    const handler = makeJsonHandler([
      { type: 'let', props: { name: 'a', value: 'Json.parse(s)' } },
      { type: 'return', props: { value: 'Json.stringify(a)' } },
    ]);
    const { imports } = emitNativeKernBodyPythonWithImports(handler);
    expect([...imports]).toEqual(['json']);
  });

  test('end-to-end via generateFunction: aliased imports are injected at top of body', () => {
    const fn: IRNode = {
      type: 'fn',
      props: { name: 'parsePath', params: 'raw:string', returns: 'string' },
      children: [
        makeJsonHandler([
          { type: 'let', props: { name: 'parsed', value: 'Json.parse(raw)' } },
          { type: 'return', props: { value: 'Path.basename(parsed)' } },
        ]),
      ],
    };
    const lines = generateFunction(fn);
    const joined = lines.join('\n');
    expect(joined).toContain('def parse_path(raw: str) -> str:');
    // Slice 3 review-fix style: aliased to `__k_<mod>` to avoid shadowing
    // user-defined `json` / `posixpath` bindings in the body.
    expect(joined).toContain('import json as __k_json');
    expect(joined).toContain('import posixpath as __k_posixpath');
    expect(joined).toContain('parsed = __k_json.loads(raw)');
    expect(joined).toContain('return __k_posixpath.basename(parsed)');
  });

  test('Json.stringify routes through the sentinel-aware shim', () => {
    // Slice S7 — emitted body calls the shim; byte-parity for sentinel-free
    // inputs is preserved inside the shim (separators+ensure_ascii on dumps).
    const handler = makeJsonHandler([{ type: 'return', props: { value: 'Json.stringify(value)' } }]);
    const { code } = emitNativeKernBodyPythonWithImports(handler);
    expect(code).toBe('return _kern_json_stringify(value)');
  });

  test('user-defined `json` ident in body does not collide with stdlib import', () => {
    // Mirrors the slice-3 `math` aliasing test: the body references the
    // user's `json` param while `Json.stringify` resolves through `__k_json`.
    const fn: IRNode = {
      type: 'fn',
      props: { name: 'echoJson', params: 'json:string', returns: 'string' },
      children: [makeJsonHandler([{ type: 'return', props: { value: 'Json.stringify(json)' } }])],
    };
    const lines = generateFunction(fn);
    const joined = lines.join('\n');
    expect(joined).toContain('import json as __k_json');
    // The body references the user's `json` param (not the module).
    // Slice S7 — Python form routes through the sentinel-aware shim.
    expect(joined).toContain('return _kern_json_stringify(json)');
  });
});

describe('Cross-target parity — Json/Path slice', () => {
  test('Json.parse(s) parity — JSON.parse vs __k_json.loads', async () => {
    const { emitExpression } = await import('@kernlang/core');
    const src = 'Json.parse(s)';
    expect(emitExpression(parseExpression(src))).toBe('JSON.parse(s)');
    expect(emitPyExpression(parseExpression(src))).toBe('__k_json.loads(s)');
  });

  test('Json.stringify(x) parity — TS JSON.stringify vs Python sentinel shim', async () => {
    const { emitExpression } = await import('@kernlang/core');
    const src = 'Json.stringify(obj)';
    // TS keeps host `JSON.stringify` (already JS-faithful for undefined); Python
    // routes through the S7 sentinel-aware shim so the two match at runtime,
    // including undefined-omission and top-level undefined.
    expect(emitExpression(parseExpression(src))).toBe('JSON.stringify(obj)');
    expect(emitPyExpression(parseExpression(src))).toBe('_kern_json_stringify(obj)');
  });

  test('Path.basename(p) parity — TS split-pop vs Python posixpath.basename', async () => {
    const { emitExpression } = await import('@kernlang/core');
    const src = 'Path.basename(p)';
    expect(emitExpression(parseExpression(src))).toBe('(p.split("/").at(-1) ?? "")');
    expect(emitPyExpression(parseExpression(src))).toBe('__k_posixpath.basename(p)');
  });
});
