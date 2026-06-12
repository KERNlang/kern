/**
 * Slice S7 — dual sentinel / nullish semantics (Python leg).
 *
 * `_KERN_UNDEFINED` is a FIRST-CLASS Python value distinct from `None`. These
 * tests EXECUTE the emitted Python under `python3` (they do not just inspect
 * strings) and compare against the JS oracle (computed with `node`), covering:
 *   - the observation table (Boolean, ==/===, typeof, fmt, ??, ?., misses)
 *   - the live None-drift kill rows (typeof-based discriminators that a naive
 *     `_KERN_UNDEFINED = None` collapse would fail)
 *   - the JSON serialization contract table (undefined omission / array null /
 *     top-level undefined)
 *   - the equality matrix (== vs === across undefined/null/values)
 *   - the optional-chain single-eval CALLS log (walrus single-eval)
 *   - destructure absent vs present-undefined, ObjectPick discriminator, Array.at
 *
 * ATAN2 STANDARD: every fixture is designed so a `_KERN_UNDEFINED = None`
 * collapse, an optional-chain returning `None`, a raw `json.dumps`, or a
 * blanket missing-safe `None` path would FAIL it (see the oracle's checklist).
 */

import { spawnSync } from 'node:child_process';
import { emitNativeKernBodyPythonWithImports } from '../src/codegen-body-python.js';
import { KERN_JS_OBJECT_HELPERS_PY } from '../src/core/expr/helpers.js';

const pythonAvailable = (() => {
  try {
    return spawnSync('python3', ['--version'], { encoding: 'utf-8' }).status === 0;
  } catch {
    return false;
  }
})();
const describeIfPython = pythonAvailable ? describe : describe.skip;

type IRNode = Parameters<typeof emitNativeKernBodyPythonWithImports>[0];

/** Build a native handler that binds `r = <expr>`. */
function letHandler(value: string): IRNode {
  return {
    type: 'handler',
    props: { lang: 'kern' },
    children: [{ type: 'let', props: { name: 'r', value } }],
  } as IRNode;
}

function emit(expr: string): { code: string; helpers: string; imports: string[] } {
  const r = emitNativeKernBodyPythonWithImports(letHandler(expr));
  return { code: r.code, helpers: [...r.helpers].join('\n\n'), imports: [...r.imports] };
}

function runPy(program: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('python3', ['-c', program], { encoding: 'utf-8' });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Emit `r = <expr>`, execute under python3, return `repr(r)`. Imports are
 * threaded (aliased `__k_<mod>`) so a helper declaring `requires.py` cannot pass
 * vacuously. Extra `setup` Python (bindings, mark fns) is injected before the body.
 */
function evalPy(expr: string, setup = ''): string {
  const { code, helpers, imports } = emit(expr);
  const importLines = imports.map((mod) => `import ${mod} as __k_${mod}`).join('\n');
  const program = [importLines, helpers, setup, code, 'print(repr(r))'].filter(Boolean).join('\n');
  const { status, stdout, stderr } = runPy(program);
  if (status !== 0) {
    throw new Error(`python3 failed (exit ${status}):\nstderr=\n${stderr}\nprogram=\n${program}`);
  }
  return stdout.trim();
}

describeIfPython('S7 — observation table', () => {
  // [expr, expected python repr]. Each row would be wrong under a sentinel→None
  // collapse, an optional-chain None, a raw json.dumps, or a missing-safe None.
  const rows: [string, string][] = [
    // Boolean(undefined) — sentinel is falsy
    ['!undefined', 'True'],
    ['!!undefined', 'False'],
    // loose vs strict nullish crossing
    ['undefined == null', 'True'],
    ['undefined === null', 'False'],
    ['undefined != null', 'False'],
    ['undefined !== null', 'True'],
    ['null == undefined', 'True'],
    ['undefined === undefined', 'True'],
    ['null === null', 'True'],
    // bool⊂int conflation killers (JS: 0===false false, 1===true false)
    ['0 === false', 'False'],
    ['1 === true', 'False'],
    // typeof
    ['typeof undefined', "'undefined'"],
    ['typeof null', "'object'"],
    // fmt / template interpolation
    ['`${undefined}`', "'undefined'"],
    ['`${null}`', "'null'"],
    // nullish coalesce — both undefined and null fall through
    ['undefined ?? "fallback"', "'fallback'"],
    ['null ?? "fallback"', "'fallback'"],
    ['0 ?? "fallback"', '0'],
    // optional chain — sentinel short-circuit
    ['typeof (undefined?.x)', "'undefined'"],
    ['typeof (null?.x)', "'undefined'"],
    ['(null?.x) === undefined', 'True'],
    ['(null?.x) === null', 'False'],
    ['(undefined?.x) ?? "f"', "'f'"],
  ];
  for (const [expr, expected] of rows) {
    test(`${expr} => ${expected}`, () => {
      expect(evalPy(expr)).toBe(expected);
    });
  }
});

describeIfPython('S7 — equality matrix (== vs === across undefined/null/values)', () => {
  const rows: [string, string][] = [
    ['undefined == 0', 'False'],
    ['null == 0', 'False'],
    ['undefined == ""', 'False'],
    ['1 === 1', 'True'],
    ['1 === 2', 'False'],
    ['"a" === "a"', 'True'],
    ['"a" === "b"', 'False'],
    ['1.0 === 1', 'True'],
    ['true === true', 'True'],
    ['false === false', 'True'],
    ['null !== undefined', 'True'],
    ['null != undefined', 'False'],
  ];
  for (const [expr, expected] of rows) {
    test(`${expr} => ${expected}`, () => {
      expect(evalPy(expr)).toBe(expected);
    });
  }
});

describeIfPython('S7 — strict equality recurses kind-aware into containers (no bool⊂int leak)', () => {
  // Python list/dict `==` would conflate `[0]` and `[false]` (bool subclasses
  // int). `_kern_strict_equal` must recurse element-wise so nested number-vs-
  // boolean stays unequal, matching the core runtime's structural-kind equality.
  // Bound globals so the operands are real Python lists/dicts.
  const rows: [string, string, string][] = [
    ['a === b', 'a=[0]\nb=[False]', 'False'],
    ['a === b', 'a=[1]\nb=[True]', 'False'],
    ['a === b', 'a=[0]\nb=[0]', 'True'],
    ['a === b', 'a={"x":0}\nb={"x":False}', 'False'],
    ['a === b', 'a={"x":0}\nb={"x":0}', 'True'],
    ['a === b', 'a=[[0]]\nb=[[False]]', 'False'],
    ['a === b', 'a=[1,2,3]\nb=[1,2,3]', 'True'],
    ['a === b', 'a=[1,2]\nb=[1,2,3]', 'False'],
  ];
  for (const [expr, setup, expected] of rows) {
    test(`${setup.replace(/\n/g, ' ')} | ${expr} => ${expected}`, () => {
      expect(evalPy(expr, setup)).toBe(expected);
    });
  }
});

describeIfPython('S7 — live None-drift kill rows (typeof discriminators)', () => {
  // typeof distinguishes the sentinel ("undefined") from None ("object"), so a
  // sentinel→None collapse flips each of these.
  test('optional chain returns the sentinel, not None', () => {
    expect(evalPy('typeof (undefined?.x)')).toBe("'undefined'");
    expect(evalPy('typeof (null?.x)')).toBe("'undefined'");
  });

  test('present object literal preserves a:sentinel distinct from b:None', () => {
    // `{ a: undefined, b: null }` — a is the sentinel, b is None; verified by
    // typeof on each after binding.
    const setup = ['o = {"a": _KERN_UNDEFINED, "b": None}'].join('\n');
    expect(evalPy('typeof (o["a"])', setup)).toBe("'undefined'");
    expect(evalPy('typeof (o["b"])', setup)).toBe("'object'");
  });
});

describeIfPython('S7 — destructure absent vs present-undefined', () => {
  function destructureHandler(bindingsSetup: { name: string; key?: string }[], source: string): IRNode {
    return {
      type: 'handler',
      props: { lang: 'kern' },
      children: [
        {
          type: 'destructure',
          props: { kind: 'const', source },
          children: bindingsSetup.map((b) => ({
            type: 'binding',
            props: { name: b.name, ...(b.key !== undefined ? { key: b.key } : {}) },
          })),
        },
        { type: 'let', props: { name: 'r', value: `typeof ${bindingsSetup[0].name}` } },
      ],
    } as IRNode;
  }

  function evalDestructure(handler: IRNode, setup: string): string {
    const r = emitNativeKernBodyPythonWithImports(handler);
    const importLines = [...r.imports].map((mod) => `import ${mod} as __k_${mod}`).join('\n');
    const program = [importLines, [...r.helpers].join('\n\n'), setup, r.code, 'print(repr(r))']
      .filter(Boolean)
      .join('\n');
    const { status, stdout, stderr } = runPy(program);
    if (status !== 0) throw new Error(`python3 failed:\n${stderr}\n${program}`);
    return stdout.trim();
  }

  test('absent destructured key is undefined (typeof "undefined", not "object")', () => {
    // `const { missing } = {}` — typeof missing must be "undefined".
    const h = destructureHandler([{ name: 'missing' }], 'src');
    expect(evalDestructure(h, 'src = {}')).toBe("'undefined'");
  });

  test('present key whose value is undefined preserves the sentinel', () => {
    // `const { a } = { a: undefined }` — typeof a must be "undefined".
    const h = destructureHandler([{ name: 'a' }], 'src');
    expect(evalDestructure(h, 'src = {"a": _KERN_UNDEFINED}')).toBe("'undefined'");
  });

  test('present key whose value is None stays "object" (distinct from absent)', () => {
    const h = destructureHandler([{ name: 'a' }], 'src');
    expect(evalDestructure(h, 'src = {"a": None}')).toBe("'object'");
  });
});

describeIfPython('S7 — ObjectPick discriminator (absent null vs present-undefined sentinel)', () => {
  // The discriminating fixture needs BOTH keys in ONE object: one absent
  // (stays null per the TS objectPick generator), one present-with-undefined
  // (preserves the sentinel). A blanket missing-safe `None` path cannot model both.
  function pickHandler(): IRNode {
    return {
      type: 'handler',
      props: { lang: 'kern' },
      children: [
        {
          type: 'objectPick',
          props: { name: 'picked', in: 'src', keys: '["missing", "present"]' },
        },
        // Build a two-element marker: [typeof picked.missing, typeof picked.present]
        { type: 'let', props: { name: 'r', value: '[typeof (picked["missing"]), typeof (picked["present"])]' } },
      ],
    } as IRNode;
  }

  test('absent picked key is null ("object"); present-undefined key keeps the sentinel ("undefined")', () => {
    const r = emitNativeKernBodyPythonWithImports(pickHandler());
    const importLines = [...r.imports].map((mod) => `import ${mod} as __k_${mod}`).join('\n');
    // src has `present: undefined` (sentinel) and NO `missing` key.
    const setup = 'src = {"present": _KERN_UNDEFINED}';
    const program = [importLines, [...r.helpers].join('\n\n'), setup, r.code, 'print(repr(r))']
      .filter(Boolean)
      .join('\n');
    const { status, stdout, stderr } = runPy(program);
    if (status !== 0) throw new Error(`python3 failed:\n${stderr}\n${program}`);
    // absent → null → "object"; present-undefined → sentinel → "undefined".
    expect(stdout.trim()).toBe("['object', 'undefined']");
  });
});

describeIfPython('S7 — Array.at value-mode misses ratchet to the sentinel', () => {
  // Bound receiver so the call flows through the portable list-ops lowering.
  const setup = 'arr = [10]';
  test('out-of-range typeof is "undefined" (not "object")', () => {
    expect(evalPy('typeof (arr.at(1))', setup)).toBe("'undefined'");
  });
  test('out-of-range participates in nullish control', () => {
    expect(evalPy('arr.at(1) ?? "fallback"', setup)).toBe("'fallback'");
  });
  test('in-range at returns the element', () => {
    expect(evalPy('arr.at(0)', setup)).toBe('10');
  });
});

describeIfPython('S7 — JSON serialization contract', () => {
  // Compared against the Node oracle (computed at authoring time, see comments).
  const rows: [string, string][] = [
    // JSON.stringify(undefined) => undefined  → shim returns the sentinel itself
    ['Json.stringify(undefined)', 'undefined'],
    // JSON.stringify(null) => "null"
    ['Json.stringify(null)', "'null'"],
    // JSON.stringify([undefined,null,1]) => "[null,null,1]"
    ['Json.stringify([undefined, null, 1])', "'[null,null,1]'"],
    // JSON.stringify({a:undefined,b:null,c:1}) => '{"b":null,"c":1}'
    ['Json.stringify({ a: undefined, b: null, c: 1 })', '\'{"b":null,"c":1}\''],
    // nested recursion
    ['Json.stringify({ nested: { a: undefined }, arr: [undefined] })', '\'{"nested":{},"arr":[null]}\''],
    // 2-key object omission
    ['Json.stringify({ a: undefined, b: null })', '\'{"b":null}\''],
    // array sentinel → null
    ['Json.stringify([undefined, null])', "'[null,null]'"],
    // sentinel-free byte-parity
    ['Json.stringify({ a: 1, b: "x" })', '\'{"a":1,"b":"x"}\''],
  ];
  for (const [expr, expected] of rows) {
    test(`${expr} => ${expected}`, () => {
      expect(evalPy(expr)).toBe(expected);
    });
  }
});

describeIfPython('S7 — optional-chain single-eval CALLS log (walrus)', () => {
  // markReceiver pushes its name and returns its arg; the probe asserts BOTH the
  // sentinel result AND that the side-effecting receiver ran EXACTLY once.
  const MARK = ['_log = []', 'def markReceiver(v):', '    _log.append("receiver")', '    return v'].join('\n');

  test('markReceiver(null)?.x => sentinel, calls ["receiver"] once', () => {
    const { code, helpers, imports } = emit('markReceiver(null)?.x');
    const importLines = imports.map((mod) => `import ${mod} as __k_${mod}`).join('\n');
    const program = [importLines, helpers, MARK, code, 'print(repr(r))', 'print(_log)'].filter(Boolean).join('\n');
    const { status, stdout, stderr } = runPy(program);
    if (status !== 0) throw new Error(`python3 failed:\n${stderr}\n${program}`);
    const [result, log] = stdout.trim().split('\n');
    expect(result).toBe('undefined'); // repr of the sentinel
    expect(log).toBe("['receiver']"); // evaluated exactly once
  });

  test('markReceiver(obj)?.x => 5, calls ["receiver"] once (present receiver)', () => {
    const { code, helpers, imports } = emit('markReceiver(obj)?.x');
    const importLines = imports.map((mod) => `import ${mod} as __k_${mod}`).join('\n');
    // A class instance supports attribute access (the native record runtime is a
    // dot-accessible object); the point of this row is the single-eval + present
    // path, not dict-attribute support.
    const setup = `${MARK}\nclass _O:\n    x = 5\nobj = _O()`;
    const program = [importLines, helpers, setup, code, 'print(repr(r))', 'print(_log)'].filter(Boolean).join('\n');
    const { status, stdout, stderr } = runPy(program);
    if (status !== 0) throw new Error(`python3 failed:\n${stderr}\n${program}`);
    const [result, log] = stdout.trim().split('\n');
    expect(result).toBe('5');
    expect(log).toBe("['receiver']");
  });
});

describeIfPython('S7 — boundary fail-closed (Object.keys/values/entries on undefined)', () => {
  // `Object.keys/values/entries` lower through `_kern_js_object_*` (route/portable
  // path) which call `_kern_js_property_items`. JS `Object.keys(undefined)` throws
  // TypeError; the helper must reject the sentinel too (it already rejects None).
  // Execute the helper block directly with the sentinel argument.
  function runHelper(call: string): { status: number; stderr: string; stdout: string } {
    const sentinelDef = [
      'class _KernUndefined:',
      '    def __bool__(self): return False',
      "    def __repr__(self): return 'undefined'",
      '_KERN_UNDEFINED = _KernUndefined()',
    ].join('\n');
    const program = [sentinelDef, KERN_JS_OBJECT_HELPERS_PY, `print(${call})`].join('\n');
    return runPy(program);
  }

  test('_kern_js_object_keys(undefined) raises TypeError', () => {
    const res = runHelper('_kern_js_object_keys(_KERN_UNDEFINED)');
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/TypeError/);
  });

  test('_kern_js_object_values(undefined) raises TypeError', () => {
    const res = runHelper('_kern_js_object_values(_KERN_UNDEFINED)');
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/TypeError/);
  });

  test('_kern_js_object_entries(undefined) raises TypeError', () => {
    const res = runHelper('_kern_js_object_entries(_KERN_UNDEFINED)');
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/TypeError/);
  });

  test('_kern_js_object_keys(None) still raises TypeError (regression guard)', () => {
    const res = runHelper('_kern_js_object_keys(None)');
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/TypeError/);
  });

  test('_kern_js_object_keys on a real dict still works', () => {
    const res = runHelper('_kern_js_object_keys({"a": 1, "b": 2})');
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("['a', 'b']");
  });
});

describeIfPython('S7 — DEFERRED parity gaps (documented, NOT silently wrong)', () => {
  // `({}).missing` — a dynamic member read on an empty record literal lowers to
  // Python attribute access on a dict, which raises AttributeError at runtime.
  // JS returns `undefined`. Ratcheting this to the sentinel requires a
  // member-read helper that wraps EVERY record field read (touching __DotDict
  // parity), which the S7 oracle explicitly scopes OUT ("do NOT globally change
  // __DotDict AttributeError"). This test PINS the current behavior so the gap
  // is visible and a future slice closing it will flip this assertion.
  test('({}).missing raises AttributeError (known deferred parity gap)', () => {
    const { code, helpers, imports } = emit('({}).missing');
    const importLines = imports.map((mod) => `import ${mod} as __k_${mod}`).join('\n');
    const program = [importLines, helpers, code, 'print(repr(r))'].filter(Boolean).join('\n');
    const { status, stderr } = runPy(program);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/AttributeError/);
  });
});
