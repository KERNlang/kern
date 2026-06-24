/**
 * 3-leg CLI differential for `kern run` — the north-star parity proof at the
 * COMMAND level. For every fixture program the REAL `kern run` CLI, the REAL
 * emitted TypeScript (under `node`), and the REAL emitted Python (under
 * `python3`) must produce byte-identical stdout:
 *
 *     kernRunStdout(file) === tsEmittedStdout(file) === pyEmittedStdout(file) === expected
 *
 * This is the existing `print-stdout-differential` proof lifted one layer up: the
 * reference leg is no longer `referenceRunSequence` called in-process, it is the
 * actual `kern run <file.kern>` binary a user invokes. It proves the CLI wiring
 * (entry resolution + stdout/stderr separation + trace replay) does not perturb
 * the certified runner output on either target. POSIX newline scope (LF).
 *
 * Skips when `python3` or the built CLI (`packages/cli/dist/cli.js`) is absent.
 * Every expected value was verified on the real runner before authoring.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyTSWithImports, parseDocumentWithDiagnostics } from '@kernlang/core';
import { nativeEligibilityClassifier, typescriptClosureClassifier } from '@kernlang/core/node';
import { emitNativeKernBodyPythonWithImports } from '../src/codegen-body-python.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = resolve(ROOT, 'packages/cli/dist/cli.js');

// Parse the TS/Python legs through the SAME path the `kern run` reference leg uses
// (document parse + Node capabilities) and resolve the SAME entry (the single
// `fn name=main` / `handler lang="kern"`), so all three legs execute identical code.
const NODE_PARSE_CAPS = { closureClassifier: typescriptClosureClassifier, nativeEligibilityClassifier } as const;

function handlerOf(src: string): IRNode {
  const { root } = parseDocumentWithDiagnostics(src, undefined, NODE_PARSE_CAPS);
  const mains = (root.children ?? []).filter((n: IRNode) => n.type === 'fn' && n.props?.name === 'main');
  if (mains.length !== 1) throw new Error(`handlerOf: expected exactly one fn name=main, got ${mains.length}`);
  const handlers = (mains[0].children ?? []).filter((n: IRNode) => n.type === 'handler' && n.props?.lang === 'kern');
  if (handlers.length !== 1)
    throw new Error(`handlerOf: expected exactly one handler lang="kern", got ${handlers.length}`);
  return handlers[0];
}

/** Build a void `fn main` whose kern handler body is the given statement lines. */
function fixture(bodyLines: string[]): string {
  return ['fn name=main returns=void', '  handler lang="kern"', ...bodyLines.map((l) => `    ${l}`)].join('\n');
}

// Skip the whole differential ONLY when python3 is unavailable (a genuine
// environment limitation). A MISSING CLI is NOT a skip reason — it is a build-order
// error that must fail loudly (see beforeAll), so a stale/absent CLI can never
// silently mask a regression.
const havePython3 = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const execDescribe = havePython3 ? describe : describe.skip;

let dir: string;

/** REFERENCE leg — the real `kern run` CLI over a written file. */
function runRefStdout(src: string): string {
  const file = join(dir, 'prog.kern');
  writeFileSync(file, src);
  const r = spawnSync(process.execPath, [CLI, 'run', file], { encoding: 'utf-8', timeout: 20000 });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`kern run exited ${r.status}: ${r.stderr}`);
  }
  return r.stdout ?? '';
}

/** TS leg — emit production code, run under `node`, capture raw stdout. */
function runTsStdout(src: string): string {
  const r = emitNativeKernBodyTSWithImports(handlerOf(src));
  const imports = [...(r.imports ?? [])].map((m) => `import * as __k_${m} from '${m}';`).join('\n');
  const file = join(dir, 'run.mjs');
  writeFileSync(file, `${imports}\nfunction __h() {\n${r.code}\n}\n__h();\n`);
  return execFileSync('node', [file], { encoding: 'utf8' });
}

/** Python leg — emit production code, run under `python3`, capture raw stdout. */
function runPyStdout(src: string): string {
  const r = emitNativeKernBodyPythonWithImports(handlerOf(src));
  const imports = [...(r.imports ?? [])].map((m) => `import ${m} as __k_${m}`).join('\n');
  const helpers = [...(r.helpers ?? [])].join('\n\n');
  // Guard: an empty/whitespace-only emitted body would leave `def __h():` without
  // a statement (Python IndentationError); `pass` keeps the wrapper well-formed.
  const body = r.code.trim()
    ? r.code
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n')
    : '    pass';
  const file = join(dir, 'run.py');
  writeFileSync(file, [imports, helpers, 'def __h():', body, '__h()'].join('\n'));
  return execFileSync('python3', [file], { encoding: 'utf8' });
}

// ── CERTIFIED: kern-run === ts === py === expected stdout ─────────────────────
const CERT: Array<[string, string[], string]> = [
  ['two prints', ['print value="42"', 'print value="7"'], '42\n7\n'],
  ['bool + null', ['print value="true"', 'print value="null"'], 'true\nnull\n'],
  ['string passthrough', ['print value="\\"hello\\""'], 'hello\n'],
  ['binding value', ['let name=x value="5"', 'print value="x"'], '5\n'],
  ['integer-valued division', ['print value="6 / 2"'], '3\n'],
  ['for-loop ordered lines', ['for name=i from="1" to="4"', '  print value="i"'], '1\n2\n3\n'],
  [
    // `kind=let` = MUTABLE; a plain `let` is immutable and the emitters reject the
    // reassign, so the portable accumulation program must declare the counter mutable.
    'let + for + assign accumulation',
    [
      'let kind=let name=total value="0"',
      'for name=i from="1" to="4"',
      '  assign target=total value="total + i"',
      'print value="total"',
    ],
    '6\n',
  ],
  [
    'if/else comparison branch',
    ['let name=x value="5"', 'if cond="x > 3"', '  print value="\\"big\\""', 'else', '  print value="\\"small\\""'],
    'big\n',
  ],
  [
    'while loop counts down its condition',
    ['let kind=let name=n value="0"', 'while cond="n < 3"', '  print value="n"', '  assign target=n value="n + 1"'],
    '0\n1\n2\n',
  ],
];

execDescribe('kern run — 3-leg CLI differential (kern-run === ts === py)', () => {
  beforeAll(() => {
    if (!existsSync(CLI)) {
      throw new Error(
        `kern run differential requires a built CLI at ${CLI} — run \`pnpm --filter @kernlang/cli build\` first.`,
      );
    }
    dir = mkdtempSync(join(tmpdir(), 'kern-run-diff-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  for (const [name, body, expected] of CERT) {
    test(`${name} -> ${JSON.stringify(expected)} on ALL THREE legs`, () => {
      const src = fixture(body);
      expect(runRefStdout(src)).toBe(expected);
      expect(runTsStdout(src)).toBe(expected);
      expect(runPyStdout(src)).toBe(expected);
    });
  }
});
