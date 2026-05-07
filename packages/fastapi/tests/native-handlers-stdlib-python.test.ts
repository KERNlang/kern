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

  test('Text.length(s) lowers to Python len(s) (free fn, not method)', () => {
    expect(emitPyExpression(parseExpression('Text.length(s)'))).toBe('len(s)');
  });

  test('Text.trim(s) lowers to Python s.strip() (NOT s.trim — that is JS)', () => {
    expect(emitPyExpression(parseExpression('Text.trim(input)'))).toBe('input.strip()');
  });

  test('nested stdlib calls compose in Python form', () => {
    // Text.upper(Text.trim(raw)) → raw.strip().upper()
    expect(emitPyExpression(parseExpression('Text.upper(Text.trim(raw))'))).toBe('raw.strip().upper()');
  });

  test('Text.length nested inside another call lowers to len(...)', () => {
    expect(emitPyExpression(parseExpression('check(Text.length(s))'))).toBe('check(len(s))');
  });

  test('unknown method on Text throws with did-you-mean (Python target)', () => {
    expect(() => emitPyExpression(parseExpression('Text.uppr(s)'))).toThrow(/Text.upper/);
  });

  test('non-stdlib module passes through unchanged in Python', () => {
    expect(emitPyExpression(parseExpression('user.email(x)'))).toBe('user.email(x)');
  });
});

describe('Cross-target parity — same KERN source, idiomatic per target', () => {
  test('Text.upper(s) parity', async () => {
    const { emitExpression } = await import('@kernlang/core');
    const src = 'Text.upper(s)';
    expect(emitExpression(parseExpression(src))).toBe('s.toUpperCase()');
    expect(emitPyExpression(parseExpression(src))).toBe('s.upper()');
  });

  test('Text.length(s) parity — TS property vs Python free fn', async () => {
    const { emitExpression } = await import('@kernlang/core');
    const src = 'Text.length(s)';
    expect(emitExpression(parseExpression(src))).toBe('s.length');
    expect(emitPyExpression(parseExpression(src))).toBe('len(s)');
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

  test('Json.stringify(obj) lowers to Python __k_json.dumps with compact separators + literal Unicode', () => {
    // Slice review fix (Codex): default `json.dumps` inserts `", "` / `": "`
    // separators and ASCII-escapes non-ASCII; force the JS-compatible form.
    expect(emitPyExpression(parseExpression('Json.stringify(obj)'))).toBe(
      '__k_json.dumps(obj, separators=(",", ":"), ensure_ascii=False)',
    );
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

  test('Json.stringify adds `json` to imports set and emits compact-separator form', () => {
    const handler = makeJsonHandler([{ type: 'return', props: { value: 'Json.stringify(obj)' } }]);
    const { code, imports } = emitNativeKernBodyPythonWithImports(handler);
    expect(code).toBe('return __k_json.dumps(obj, separators=(",", ":"), ensure_ascii=False)');
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

  test('Json.stringify byte-parity with JSON.stringify on plain objects', () => {
    // Codex review fix: ensure the emitted Python literally produces
    // `dumps(x, separators=(",", ":"), ensure_ascii=False)`. Verifying the
    // *string* shape only; the runtime parity with JS is implicit in the
    // separators+ensure_ascii flags chosen.
    const handler = makeJsonHandler([{ type: 'return', props: { value: 'Json.stringify(value)' } }]);
    const { code } = emitNativeKernBodyPythonWithImports(handler);
    expect(code).toBe('return __k_json.dumps(value, separators=(",", ":"), ensure_ascii=False)');
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
    // Codex review fix: Python form now carries separators+ensure_ascii.
    expect(joined).toContain('return __k_json.dumps(json, separators=(",", ":"), ensure_ascii=False)');
  });
});

describe('Cross-target parity — Json/Path slice', () => {
  test('Json.parse(s) parity — JSON.parse vs __k_json.loads', async () => {
    const { emitExpression } = await import('@kernlang/core');
    const src = 'Json.parse(s)';
    expect(emitExpression(parseExpression(src))).toBe('JSON.parse(s)');
    expect(emitPyExpression(parseExpression(src))).toBe('__k_json.loads(s)');
  });

  test('Json.stringify(x) parity — JSON.stringify vs __k_json.dumps with compact form', async () => {
    const { emitExpression } = await import('@kernlang/core');
    const src = 'Json.stringify(obj)';
    expect(emitExpression(parseExpression(src))).toBe('JSON.stringify(obj)');
    // Codex review fix: Python form must include separators+ensure_ascii so
    // the *runtime* string output matches JS for plain objects/arrays.
    expect(emitPyExpression(parseExpression(src))).toBe(
      '__k_json.dumps(obj, separators=(",", ":"), ensure_ascii=False)',
    );
  });

  test('Path.basename(p) parity — TS split-pop vs Python posixpath.basename', async () => {
    const { emitExpression } = await import('@kernlang/core');
    const src = 'Path.basename(p)';
    expect(emitExpression(parseExpression(src))).toBe('(p.split("/").at(-1) ?? "")');
    expect(emitPyExpression(parseExpression(src))).toBe('__k_posixpath.basename(p)');
  });
});
