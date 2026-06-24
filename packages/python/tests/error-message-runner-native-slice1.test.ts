/**
 * ERROR-SUBSTRATE — runner-native SLICE-1 differential oracle (canonical `e.message` read).
 *
 * Certifies the ReferenceRunner as the neutral 3rd leg (ref === ts === py === expected)
 * for reading the MESSAGE of an explicitly-thrown canonical error inside a `catch`:
 *
 *     try
 *       throw value="new Error(\"boom\")"
 *       catch name=e
 *         let name=m value="e.message"
 *         return value="m"          // => "boom" on ALL THREE legs
 *
 * This is the substrate the `try` contract today DEFERS ("Catch bodies do NOT read the
 * error binding — raw-error field access diverges (JS error object vs Python exception)").
 *
 * RED-AT-BASE (verified 2026-06-23, real toolchain): the TS leg already returns "boom";
 * the PYTHON leg throws `AttributeError: 'Exception' object has no attribute 'message'`
 * (Python exceptions have no `.message`); the REFERENCE leg ABSTAINS ("Preconditions
 * failed for node type 'throw'" — the throw primitive does not yet execute a
 * body-statement `throw value="new Error(...)"`). The slice closes all three:
 *   - Python emitter lowers `<caughtBind>.message` -> `str(<caughtBind>)`
 *     (verified: `str(Exception("boom"))` == "boom" == TS `Error.message`),
 *   - the runner executes the throw (evaluating the LITERAL message) + the `.message` read.
 *
 * FAIL-CLOSE FENCE (stays abstained AFTER the slice — these would emit one-leg values):
 *   - `e.name`/`e.kind`        — JS Error.name "Error" vs Python type-name "Exception".
 *   - `throw "raw"` + .message — non-canonical-Error throw: JS `"raw".message` is undefined,
 *                                Python wraps to Exception so `str(e)` == "raw". DIVERGE.
 *   - bare `e` / `e.stack` / any other field — host-specific, out of domain.
 *
 * EVERY expected was verified EMPIRICALLY on the REAL emitters + node/python3 — the
 * runner-native discipline: never trust a hand-model of a JS-vs-Python error divergence,
 * replay it through the real pipeline.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyTSWithImports, makeEnv, parse, referenceRun, registerAllContracts } from '@kernlang/core';
import { emitNativeKernBodyPythonWithImports } from '../src/codegen-body-python.js';

registerAllContracts(); // idempotent — safe at module load.

/** Parse a full `fn ... handler lang="kern" ...` source and return the handler node. */
function handlerOf(src: string): IRNode {
  const root = parse(src);
  const fn = root.type === 'fn' ? root : (root.children ?? []).find((n: IRNode) => n.type === 'fn');
  if (!fn) throw new Error('handlerOf: no fn');
  const handler = (fn.children ?? []).find((n: IRNode) => n.type === 'handler');
  if (!handler) throw new Error('handlerOf: no handler');
  return handler;
}

/** Build a `fn probe` whose kern handler body is the given indented statement lines. */
function fixture(bodyLines: string[]): string {
  return ['fn name=probe returns=string', '  handler lang="kern"', ...bodyLines.map((l) => `    ${l}`)].join('\n');
}

const haveExec = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const execDescribe = haveExec ? describe : describe.skip;

let dir: string;

/** REFERENCE leg — run the handler body through the runner; return the `return`
 *  completion's value. Throws if the runner ABSTAINED (precondition fail) — the
 *  fail-close suite asserts on that throw directly. */
function runRef(src: string): unknown {
  const handler = handlerOf(src);
  const children = handler.children ?? [];
  if (children.length === 0) throw new Error('runRef: empty handler body');
  // Run the FULL handler body sequence, threading env — so a POST-catch read of
  // the catch binding is exercised (the env-scope fence). A child that abstains
  // throws → runRef throws (the fail-close suite asserts on that directly).
  const env = makeEnv();
  let completion: { kind: string; value?: unknown } = { kind: 'normal' };
  for (const child of children) {
    const trace = referenceRun(child, env);
    if (trace.completion.kind !== 'normal') {
      completion = trace.completion;
      break;
    }
  }
  if (completion.kind !== 'return') {
    throw new Error(`runRef: no return completion, got ${JSON.stringify(completion)}`);
  }
  return completion.value;
}

/** TS leg — emit the handler body, wrap in a fn, run via node, capture the return. */
function runTs(src: string): unknown {
  const r = emitNativeKernBodyTSWithImports(handlerOf(src));
  const imports = [...(r.imports ?? [])].map((m) => `import * as __k_${m} from '${m}';`).join('\n');
  const file = join(dir, 'run.mjs');
  writeFileSync(file, `${imports}\nfunction __h() {\n${r.code}\n}\nconsole.log(JSON.stringify(__h() ?? null));\n`);
  return JSON.parse(execFileSync('node', [file], { encoding: 'utf8', timeout: 10_000 }).trim());
}

/** Python leg — emit the handler body, wrap in a def, run via python3, capture. */
function runPy(src: string): unknown {
  const r = emitNativeKernBodyPythonWithImports(handlerOf(src));
  const imports = [...(r.imports ?? [])].map((m) => `import ${m} as __k_${m}`).join('\n');
  const helpers = [...(r.helpers ?? [])].join('\n\n');
  const body = r.code
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
  const file = join(dir, 'run.py');
  writeFileSync(
    file,
    ['import json', imports, helpers, 'def __h():', body, 'print(json.dumps(__h(), ensure_ascii=False))'].join('\n'),
  );
  return JSON.parse(execFileSync('python3', [file], { encoding: 'utf8', timeout: 10_000 }).trim());
}

// ════════════════════════════════════════════════════════════════════════════
// 1. CERTIFIED — ref === ts === py === expected. RED at base (py AttributeError +
//    ref abstain); GREEN after the slice.
// ════════════════════════════════════════════════════════════════════════════
const CERT: Array<[string, string[], string]> = [
  // KILLER: a real author message round-trips on all three legs.
  [
    'boom',
    [
      'try',
      '  throw value="new Error(\\"boom\\")"',
      '  catch name=e',
      '    let name=m value="e.message"',
      '    return value="m"',
    ],
    'boom',
  ],
  // multi-char with punctuation — rejects a constant/empty shortcut.
  [
    'not found: 42',
    [
      'try',
      '  throw value="new Error(\\"not found: 42\\")"',
      '  catch name=e',
      '    let name=m value="e.message"',
      '    return value="m"',
    ],
    'not found: 42',
  ],
  // empty message edge — str(Exception("")) == "" == Error("").message.
  [
    'empty',
    [
      'try',
      '  throw value="new Error(\\"\\")"',
      '  catch name=e',
      '    let name=m value="e.message"',
      '    return value="m"',
    ],
    '',
  ],
  // direct `return value="e.message"` (no intermediate let) — same observable.
  [
    'direct return',
    ['try', '  throw value="new Error(\\"direct\\")"', '  catch name=e', '    return value="e.message"'],
    'direct',
  ],
];

execDescribe('Error-substrate Slice 1 — runner-native e.message differential (ref === ts === py)', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'err-msg-slice1-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  for (const [name, body, expected] of CERT) {
    test(`${name} -> ${JSON.stringify(expected)} on ALL THREE legs`, () => {
      const src = fixture(body);
      const ref = runRef(src);
      const ts = runTs(src);
      const py = runPy(src);
      expect(typeof ref).toBe('string');
      expect(ref).toBe(expected);
      expect(ts).toBe(expected);
      expect(py).toBe(expected);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 2. RUNNER-ONLY value killer — assert the bound message directly (GREEN after slice).
// ════════════════════════════════════════════════════════════════════════════
describe('Error-substrate Slice 1 — runner-native value killer', () => {
  test('e.message returns the LITERAL thrown message (not the kind, not empty)', () => {
    const src = fixture([
      'try',
      '  throw value="new Error(\\"exact-msg\\")"',
      '  catch name=e',
      '    return value="e.message"',
    ]);
    expect(runRef(src)).toBe('exact-msg');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. FAIL-CLOSE FENCE — the runner ABSTAINS (toThrow). GREEN at base AND after the
//    slice: these reads would emit a one-leg value, so the runner never binds them.
// ════════════════════════════════════════════════════════════════════════════
describe('Error-substrate Slice 1 — fail-close fence (runner abstains)', () => {
  // e.name: JS Error.name "Error" vs Python type(e).__name__ "Exception" — DIVERGE.
  test('reading e.name fails closed (JS "Error" vs Py "Exception")', () => {
    const src = fixture(['try', '  throw value="new Error(\\"x\\")"', '  catch name=e', '    return value="e.name"']);
    expect(() => runRef(src)).toThrow();
  });
  // STRONGEST TRAP: bare-value throw + .message. JS `"raw".message` undefined; Py wraps
  // to Exception so str(e) == "raw". A naive str(e) fix passes the happy path but DIVERGES
  // here — the canonical-Error gate must kill it.
  test('reading .message off a bare-STRING throw fails closed (non-canonical-Error)', () => {
    const src = fixture(['try', '  throw value="\\"raw\\""', '  catch name=e', '    return value="e.message"']);
    expect(() => runRef(src)).toThrow();
  });
  // bare-value throw of a number, same class.
  test('reading .message off a bare-NUMBER throw fails closed', () => {
    const src = fixture(['try', '  throw value="42"', '  catch name=e', '    return value="e.message"']);
    expect(() => runRef(src)).toThrow();
  });
  // returning the caught binding itself — Error object vs Exception object diverge.
  test('returning the bare caught binding fails closed', () => {
    const src = fixture(['try', '  throw value="new Error(\\"x\\")"', '  catch name=e', '    return value="e"']);
    expect(() => runRef(src)).toThrow();
  });
  // any non-.message field — host-specific, out of domain.
  test('reading e.stack fails closed', () => {
    const src = fixture(['try', '  throw value="new Error(\\"x\\")"', '  catch name=e', '    return value="e.stack"']);
    expect(() => runRef(src)).toThrow();
  });
  // BLOCKER 1 (codex: env-binding leak) — the catch binding must NOT survive the
  // catch. Both emitters scope `e` out (TS block scope; Python `del`s it at the end
  // of `except`), so a POST-catch `e.message` errors on both. The runner must
  // ABSTAIN, not certify the leaked value.
  test('reading e.message AFTER the catch fails closed (binding does not leak)', () => {
    const src = fixture([
      'try',
      '  throw value="new Error(\\"x\\")"',
      '  catch name=e',
      '    let name=d value="1"',
      'return value="e.message"',
    ]);
    expect(() => runRef(src)).toThrow();
  });
  // BLOCKER 2 (codex: Python shadowing) — an inner `let name=e` SHADOWS the catch
  // binding, so `e` is now an ordinary value; its `.message` is a normal property
  // access (NOT str(e)). The runner abstains (e is no longer a caught error), and
  // the Python emitter must drop `e` from its caught-binding set so it does not
  // rewrite the shadowed read.
  test('a let shadowing the catch binding fails closed (no str(e) rewrite)', () => {
    const src = fixture([
      'try',
      '  throw value="new Error(\\"x\\")"',
      '  catch name=e',
      '    let name=e value="\\"shadowed\\""',
      '    return value="e.message"',
    ]);
    expect(() => runRef(src)).toThrow();
  });
});
