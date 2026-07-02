/**
 * `kern run <file.kern>` — slice-1 oracle (CLI behavior + fail-close contract).
 *
 * `kern run` is KERN's native entry point: it parses a `.kern` file, locates the
 * single `fn name=main returns=void` whose `handler lang="kern"` body holds the
 * program, executes that body through the ReferenceRunner (`referenceRunSequence`,
 * the SAME executor the 3-leg parity suite certifies), and replays the resulting
 * `{op:'stdout'}` trace events to REAL stdout. This is "KERN runs on its own".
 *
 * Contract under test (slice-1):
 *   - Entry resolution is STRICT: exactly one top-level `fn name=main`, it must
 *     declare `returns=void`, carry no params and not be async, and contain
 *     exactly one `handler lang="kern"`. Anything else is a deterministic
 *     stderr diagnostic + exit 2 — never a stack trace, never partial stdout.
 *   - Program stdout (the replayed trace events, each `text + "\n"`) goes to
 *     stdout ONLY; diagnostics go to stderr ONLY.
 *   - FAIL-CLOSE atomicity: when the runner ABSTAINS on a non-portable op
 *     (precondition fails -> referenceRunSequence throws), `kern run` emits NO
 *     stdout at all (not even output produced before the abstaining statement)
 *     and exits 2. Silent partial output is the one unforgivable bug.
 *   - Exit codes: 0 = normal/return completion; 2 = setup failure (parse / entry
 *     resolution / unreadable file), runner abstention, OR uncaught KERN `throw`
 *     completion; 1 = unexpected host failure.
 *
 * Executable surface is exactly what the runner certifies today: print / let /
 * assign / for / if / while / each / return / portable arithmetic / portable
 * array-literal binding / literal in-bounds array index reads / array `.length`
 * (value AND as a for-range bound) / dynamic index reads by a for-counter OR
 * `+`/`-` arithmetic between provenanced operands (`xs[i]`, `xs[i + 1]`) /
 * array append (`do value="xs.push(...)"`, functional rebind, no synthetic
 * trace event) / `List.length`, `new Map()`, `Map.get`/`Map.has`/`Map.set`
 * from the KERN-stdlib lowering table (milestone 5.1b) / flat record-literal
 * binding and scalar dot-field reads / same-file pure KERN function calls
 * returning portable scalars, INCLUDING same-file recursion (direct or
 * mutual) up to an explicit 512-deep call limit / branch path/default
 * dispatch / fmt interpolation bindings / explicit `throw new Error("...")`
 * inside try/catch/finally with caught `.message` reads / explicit runner
 * capability calls / `Text.length`, `Text.charAt(i)`, `Text.slice(a, b)`,
 * `Text.indexOf(needle)`, and `Text.startsWith(prefix)` for BMP-SAFE strings
 * under the tribunal-locked code-point contract (a well-formed non-BMP
 * character fails closed too — a deliberate risk-valve narrowing, see
 * portable-string.ts). The CLI path provides local RAG retrieval, volatile
 * in-run storage, and browser-safe crypto today; other host capabilities
 * still fail closed.
 * Constructs the runner does not yet execute over PRODUCTION IR (whole-array /
 * whole-record rendering, nested or dynamic records, `*`/`/`/`%`/unary
 * arithmetic index expressions, non-empty `new Map(...)` construction,
 * non-string Map keys, non-BMP characters in any `Text.*` op, other string
 * ops (`upper`/`lower`/`trim`/`includes`/`endsWith`/`split`/`replace`),
 * non-canonical throws, and recursion past the 512-deep call limit) ABSTAIN
 * -> exit 2.
 *
 * Every expected stdout byte below was verified empirically against the built
 * runner before this oracle was authored (the `(1/3)*3 != 1` lesson).
 *
 * NOTE: assertions on diagnostic text are intentionally LOOSE (non-empty stderr,
 * plus a required keyword where the contract demands one). The exact wording of a
 * diagnostic is the implementation's choice; coupling the oracle to verbatim
 * message strings would let the implementation define its own contract.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRunCapabilities, executeKernSource, executeKernSourceAsync } from '../src/commands/run.js';
import {
  createCliAsyncLlmCapability,
  createCliAsyncNetCapability,
  createCliAsyncOpenAICompatibleLlmCapability,
  createCliAsyncRagAnswerCapability,
} from '../src/commands/run-async-host.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = resolve(ROOT, 'packages/cli/dist/cli.js');

let dir: string;

beforeAll(() => {
  // The CLI is spawned, so the built entry must exist (the package `test` script
  // runs `build` first). Fail with a clear message instead of confusing ENOENT.
  if (!existsSync(CLI)) {
    throw new Error(`kern run tests require a built CLI at ${CLI} — run \`pnpm --filter @kernlang/cli build\` first.`);
  }
  dir = mkdtempSync(join(tmpdir(), 'kern-run-'));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
function writeFile(source: string): string {
  const file = join(dir, `prog-${counter++}.kern`);
  writeFileSync(file, source);
  return file;
}

function writeNamedFile(name: string, source: string): string {
  const file = join(dir, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  return file;
}

/** Wrap body statement lines in a void `fn main` + kern handler (the entry convention). */
function mainProgram(bodyLines: string[]): string {
  return ['fn name=main returns=void', '  handler lang="kern"', ...bodyLines.map((l) => `    ${l}`)].join('\n');
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runFile(file: string): RunResult {
  return runArgs(['run', file]);
}

function runArgs(args: string[], options: { readonly env?: NodeJS.ProcessEnv } = {}): RunResult {
  // `timeout` guards against a hung runner; surface a spawn error or a
  // signal-kill (e.g. the timeout) rather than a confusing null status.
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf-8',
    timeout: 20000,
    ...(options.env ? { env: options.env } : {}),
  });
  if (r.error) throw r.error;
  if (r.signal) throw new Error(`kern run was killed by signal ${r.signal}`);
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function runProgram(bodyLines: string[]): RunResult {
  return runFile(writeFile(mainProgram(bodyLines)));
}

describe('kern run module linking', () => {
  test('executes multi-file native programs through the CLI filesystem loader', () => {
    writeNamedFile(
      'multi-run/helper.kern',
      [
        'fn name=double params="x:number" returns=number export=true',
        '  handler lang="kern"',
        '    return value="x * 2"',
        'class name=Box export=true',
        '  field name=value value="7"',
        '  method name=read returns=number',
        '    handler lang="kern"',
        '      return value="this.value"',
      ].join('\n'),
    );
    const file = writeNamedFile(
      'multi-run/main.kern',
      [
        'use path="./helper"',
        '  from name=double kind=fn as=twice',
        '  from name=Box kind=class',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    print value="twice(21)"',
        '    let name=box value="new Box()"',
        '    print value="box.read()"',
      ].join('\n'),
    );

    const result = runFile(file);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('42\n7\n');
  });

  test('rejects module imports that escape the entry directory before stdout', () => {
    writeNamedFile(
      'outside.kern',
      ['fn name=helper returns=number export=true', '  handler lang="kern"', '    return value="1"'].join('\n'),
    );
    const file = writeNamedFile(
      'escape/main.kern',
      [
        'use path="../outside"',
        '  from name=helper kind=fn',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    print value="\\"unreached\\""',
      ].join('\n'),
    );

    const result = runFile(file);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('escapes');
  });

  test('rejects symlinked module imports whose real target escapes the entry directory', () => {
    writeNamedFile(
      'symlink-outside.kern',
      ['fn name=helper returns=number export=true', '  handler lang="kern"', '    return value="1"'].join('\n'),
    );
    const file = writeNamedFile(
      'symlink-escape/main.kern',
      [
        'use path="./linked"',
        '  from name=helper kind=fn',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    print value="\\"unreached\\""',
      ].join('\n'),
    );
    symlinkSync(join(dir, 'symlink-outside.kern'), join(dir, 'symlink-escape', 'linked.kern'));

    const result = runFile(file);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('escapes');
  });

  test('capability report includes async providers required only by an imported module', () => {
    writeNamedFile(
      'caps-import/helper.kern',
      [
        'fn name=answerIt returns=string export=true',
        '  handler lang="kern"',
        '    capability namespace=rag operation=answer name=answer input="{ question: \\"q\\" }"',
        '    return value="answer.text"',
      ].join('\n'),
    );
    const file = writeNamedFile(
      'caps-import/main.kern',
      [
        'use path="./helper"',
        '  from name=answerIt kind=fn',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    print value="\\"root\\""',
      ].join('\n'),
    );

    const result = runArgs(['run', '--capabilities', '--llm-response', 'grounded [1]', file]);
    const report = parseCapabilityReport(result);

    // The imported capability must be aggregated (requirement + provider
    // inclusion) AND honestly classified: a capability call in a helper
    // outside main is an unsupported async execution shape, so the report
    // carries blockers and the CLI exits non-zero.
    expect(result.status).toBe(2);
    expect(report.requirements.map((requirement: { id: string }) => requirement.id)).toEqual(
      expect.arrayContaining(['rag.answer']),
    );
    expect(report.providedAsyncCapabilities).toContain('rag.answer');
    expect(
      report.unsupportedAsyncExecutions.map((entry: { id: string; reason: string }) => `${entry.id}:${entry.reason}`),
    ).toContain('rag.answer:outside-main');
    expect(report.hasCapabilityBlockers).toBe(true);
  });

  test('importing a syntactically broken module fails closed (exit 2, no TypeError, no stdout)', () => {
    writeNamedFile(
      'broken-run/broken.kern',
      ['fn name=helper returns=number export=true', '  handler lang="kern"', '    return value="'].join('\n'),
    );
    const file = writeNamedFile(
      'broken-run/main.kern',
      [
        'use path="./broken"',
        '  from name=helper kind=fn',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    print value="\\"unreached\\""',
      ].join('\n'),
    );

    const result = runFile(file);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toMatch(/TypeError|unexpected failure/);
  });

  test('--capabilities on a broken imported module exits 2 with parse-error diagnostics, no crash', () => {
    writeNamedFile(
      'broken-caps/broken.kern',
      ['fn name=helper returns=number export=true', '  handler lang="kern"', '    return value="'].join('\n'),
    );
    const file = writeNamedFile(
      'broken-caps/main.kern',
      [
        'use path="./broken"',
        '  from name=helper kind=fn',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    print value="\\"unreached\\""',
      ].join('\n'),
    );

    const result = runArgs(['run', '--capabilities', file]);

    expect(result.status).toBe(2);
    expect(result.stderr).not.toMatch(/TypeError|unexpected failure/);
    const report = parseCapabilityReport(result);
    expect(report.hasParseErrors).toBe(true);
    expect(report.hasCapabilityBlockers).toBe(true);
  });

  test('--capabilities counts a capability inside an imported helper as executable (readiness parity)', () => {
    writeNamedFile(
      'caps-import/helper.kern',
      [
        'fn name=fetchIt returns=string export=true',
        '  handler lang="kern"',
        '    capability namespace=fs operation=readText name=t input="{ path: \\"a.txt\\" }"',
        '    return value="t"',
      ].join('\n'),
    );
    const file = writeNamedFile(
      'caps-import/main.kern',
      [
        'use path="./helper"',
        '  from name=fetchIt kind=fn',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    print value="fetchIt()"',
      ].join('\n'),
    );

    const result = runArgs(['run', '--capabilities', file]);

    expect(result.status).toBe(2);
    const report = parseCapabilityReport(result);
    expect(report.asyncBoundaryRequired).toBe(true);
    expect(report.asyncPlannedCapabilities.map((c) => c.id)).toContain('fs.readText');
    const hint = report.asyncProviderHints.find((h) => h.id === 'fs.readText');
    expect(hint?.required).toBe(true);
    expect(hint?.missing).toBe(true);
    expect(hint?.providerFlags).toContain('--fs-root <dir>');
  });
});

interface CapabilityReport {
  readonly hasCapabilityBlockers: boolean;
  readonly capabilityReadinessMode: 'sync' | 'async-preview';
  readonly hasSyncCapabilityBlockers: boolean;
  readonly hasAsyncCapabilityBlockers: boolean;
  readonly providedCapabilities: readonly string[];
  readonly providedAsyncCapabilities: readonly string[];
  readonly asyncBoundaryRequired: boolean;
  readonly hasParseErrors: boolean;
  readonly requirements: readonly Array<{ id: string; sourceLine: number; bindingName?: string }>;
  readonly plannedCapabilities: readonly Array<{ id: string }>;
  readonly asyncPlannedCapabilities: readonly Array<{ id: string }>;
  readonly missingProviders: readonly Array<{ id: string }>;
  readonly missingAsyncProviders: readonly Array<{ id: string }>;
  readonly unsupportedAsyncExecutions: readonly Array<{ id: string; reason: string; containerType?: string }>;
  readonly unknownCapabilities: readonly Array<{ id: string }>;
  readonly malformedCapabilities: readonly Array<{ id: string; reason: string }>;
  readonly unknownProvidedAsyncCapabilities: readonly string[];
  readonly asyncProviderHints: readonly Array<{
    id: string;
    providerFlags: readonly string[];
    required: boolean;
    provided: boolean;
    missing: boolean;
  }>;
  readonly llmProviderPolicy?: {
    provider: 'openai';
    configured: boolean;
    apiKeyPresent: boolean;
    apiKeyValid: boolean;
    modelPresent: boolean;
    modelValid: boolean;
    baseUrlPresent: boolean;
    baseUrlValid: boolean;
  };
  readonly providerPolicyBlockers: readonly Array<{ provider: 'openai'; reason: string }>;
  readonly parseDiagnostics: readonly Array<{ severity: string; code: string }>;
}

function parseCapabilityReport(result: RunResult): CapabilityReport {
  return JSON.parse(result.stdout) as CapabilityReport;
}

// ── HAPPY PATH: exact stdout, exit 0, clean stderr ───────────────────────────
describe('kern run — executes a void main and replays stdout (exit 0)', () => {
  // Portable scalars (values + expected bytes proven by print-stdout-differential).
  const PORTABLE_PRINTS: Array<[string, string[], string]> = [
    ['bool true -> lowercase', ['print value="true"'], 'true\n'],
    ['bool false -> lowercase', ['print value="false"'], 'false\n'],
    ['null -> lowercase', ['print value="null"'], 'null\n'],
    ['positive integer base-10', ['print value="42"'], '42\n'],
    ['zero', ['print value="0"'], '0\n'],
    ['negative integer keeps sign', ['print value="0 - 7"'], '-7\n'],
    ['integer-valued arithmetic collapses to integer', ['print value="6 / 2"'], '3\n'],
    ['string passthrough', ['print value="\\"hello\\""'], 'hello\n'],
    ['empty string still emits its newline', ['print value="\\"\\""'], '\n'],
    ['unicode preserved', ['print value="\\"café→😀\\""'], 'café→😀\n'],
    ['embedded newline replayed exactly', ['print value="\\"a\\\\nb\\""'], 'a\nb\n'],
    ['embedded quote round-trips', ['print value="\\"a\\\\\\"b\\""'], 'a"b\n'],
  ];

  for (const [name, body, expected] of PORTABLE_PRINTS) {
    test(`prints ${name}`, () => {
      const r = runProgram(body);
      expect(r.stdout).toBe(expected);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
    });
  }

  test('two prints preserve order + per-line newline', () => {
    const r = runProgram(['print value="42"', 'print value="7"']);
    expect(r.stdout).toBe('42\n7\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('prints a value read from a binding (not literal-only)', () => {
    const r = runProgram(['let name=x value="5"', 'print value="x"']);
    expect(r.stdout).toBe('5\n');
    expect(r.status).toBe(0);
  });

  test('for-loop body accumulates ordered lines (fresh iteration binding)', () => {
    const r = runProgram(['for name=i from="1" to="4"', '  print value="i"']);
    expect(r.stdout).toBe('1\n2\n3\n');
    expect(r.status).toBe(0);
  });

  test('FLAGSHIP: let + for + assign accumulation through real lexical scope', () => {
    // sum 1..3 via a write-through `assign` to an OUTER binding from inside the
    // loop body — kills a per-iteration env reset and a per-statement re-eval bug.
    // `kind=let` = MUTABLE (a plain `let` is immutable and the emitters reject the
    // reassign), so this program is genuinely 3-leg portable (ref === ts === py).
    const r = runProgram([
      'let kind=let name=total value="0"',
      'for name=i from="1" to="4"',
      '  assign target=total value="total + i"',
      'print value="total"',
    ]);
    expect(r.stdout).toBe('6\n');
    expect(r.status).toBe(0);
  });

  test('empty main succeeds with no output (NOT a nonzero exit)', () => {
    const r = runProgram([]);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(0);
  });

  test('a `return` in a void main ends the program after prior stdout', () => {
    const r = runProgram(['print value="1"', 'return']);
    expect(r.stdout).toBe('1\n');
    expect(r.status).toBe(0);
  });

  test('same-file pure helper functions can be called from main', () => {
    const source = [
      'fn name=helper params="x:number" returns=number',
      '  handler lang="kern"',
      '    return value="x + 2"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="helper(5)"',
    ].join('\n');
    const r = runFile(writeFile(source));
    expect(r.stdout).toBe('7\n');
    expect(r.status).toBe(0);
  });

  test('unsupported sibling helper functions are ignored unless called', () => {
    const source = [
      'fn name=remote returns=number',
      '  handler lang="ts"',
      'fn name=noop returns=void',
      '  handler lang="kern"',
      '    return',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="7"',
    ].join('\n');
    const r = runFile(writeFile(source));
    expect(r.stdout).toBe('7\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('if/else takes the branch its (comparison) condition selects', () => {
    const r = runProgram([
      'let name=x value="5"',
      'if cond="x > 3"',
      '  print value="\\"big\\""',
      'else',
      '  print value="\\"small\\""',
    ]);
    expect(r.stdout).toBe('big\n');
    expect(r.status).toBe(0);
  });

  test('while loops until its condition goes false', () => {
    const r = runProgram([
      'let kind=let name=n value="0"',
      'while cond="n < 3"',
      '  print value="n"',
      '  assign target=n value="n + 1"',
    ]);
    expect(r.stdout).toBe('0\n1\n2\n');
    expect(r.status).toBe(0);
  });

  test('ARRAYS: each over an array literal prints each element in order', () => {
    const r = runProgram(['let name=xs value="[1,2,3]"', 'each name=x in=xs', '  print value="x"']);
    expect(r.stdout).toBe('1\n2\n3\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('ARRAYS: nested array literals iterate as real values (double-nested each)', () => {
    const r = runProgram([
      'let name=rows value="[[1,2],[3]]"',
      'each name=row in=rows',
      '  each name=v in=row',
      '    print value="v"',
    ]);
    expect(r.stdout).toBe('1\n2\n3\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });
  test('ARRAY INDEX: an in-bounds read prints the element', () => {
    const r = runProgram(['let name=xs value="[10,20,30]"', 'print value="xs[0]"']);
    expect(r.stdout).toBe('10\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('ARRAY INDEX: the last in-bounds literal index reads the last element', () => {
    const r = runProgram(['let name=xs value="[10,20,30]"', 'print value="xs[2]"']);
    expect(r.stdout).toBe('30\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('ARRAY LENGTH: reads the element count', () => {
    const r = runProgram(['let name=xs value="[1,2,3]"', 'print value="xs.length"']);
    expect(r.stdout).toBe('3\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('ARRAY LENGTH: an empty array reads 0', () => {
    const r = runProgram(['let name=xs value="[]"', 'print value="xs.length"']);
    expect(r.stdout).toBe('0\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('ARRAY LENGTH: a nested array counts TOP-LEVEL elements (not leaves)', () => {
    const r = runProgram(['let name=xs value="[[1,2],[3,4,5]]"', 'print value="xs.length"']);
    expect(r.stdout).toBe('2\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('ARRAY LENGTH: the length value flows into arithmetic', () => {
    const r = runProgram(['let name=xs value="[1,2,3]"', 'print value="xs.length - 1"']);
    expect(r.stdout).toBe('2\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('DYNAMIC INDEX: iterate an array by for-counter over its length (headline)', () => {
    const r = runProgram([
      'let name=xs value="[10,20,30]"',
      'for name=i from="0" to="xs.length"',
      '  print value="xs[i]"',
    ]);
    expect(r.stdout).toBe('10\n20\n30\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('DYNAMIC INDEX: a reverse for-counter reads back-to-front', () => {
    const r = runProgram([
      'let name=xs value="[10,20,30]"',
      'for name=i from="2" to="-1" step="-1"',
      '  print value="xs[i]"',
    ]);
    expect(r.stdout).toBe('30\n20\n10\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('RECORDS: flat record literal scalar fields print through dot reads', () => {
    const r = runProgram([
      'let name=user value="{ name: \\"Ada\\", age: 37, active: true }"',
      'print value="user.name"',
      'print value="user.age"',
      'print value="user.active"',
    ]);
    expect(r.stdout).toBe('Ada\n37\ntrue\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('FMT: interpolation binds a portable string that can be printed', () => {
    const r = runProgram([
      'let name=who value="\\"Ada\\""',
      'let name=count value="3"',
      'fmt name=msg template="hi ${who}: ${count}"',
      'print value="msg"',
    ]);
    expect(r.stdout).toBe('hi Ada: 3\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('BRANCH: path dispatch and default path execute through production IR', () => {
    const r = runProgram([
      'let kind=let name=out value="\\"\\""',
      'let name=kind value="\\"paid\\""',
      'branch on="kind"',
      '  path value="paid"',
      '    assign target=out value="\\"ok\\""',
      '  path default=true',
      '    assign target=out value="\\"fallback\\""',
      'print value="out"',
      'branch on="\\"missing\\""',
      '  path value="paid"',
      '    print value="\\"unreached\\""',
      '  path default=true',
      '    print value="\\"default\\""',
    ]);
    expect(r.stdout).toBe('ok\ndefault\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('BRANCH: no match and no default falls through', () => {
    const r = runProgram([
      'print value="\\"before\\""',
      'branch on="\\"missing\\""',
      '  path value="paid"',
      '    print value="\\"unreached\\""',
      'print value="\\"after\\""',
    ]);
    expect(r.stdout).toBe('before\nafter\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('ERRORS: explicit throw is caught and finally still runs', () => {
    const r = runProgram([
      'try',
      '  print value="\\"try\\""',
      '  throw value="new Error(\\"boom\\")"',
      '  catch name=e',
      '    print value="e.message"',
      '  finally',
      '    print value="\\"cleanup\\""',
      'print value="\\"after\\""',
    ]);
    expect(r.stdout).toBe('try\nboom\ncleanup\nafter\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('RAG CAPABILITY: local rag.retrieve returns chunks through the explicit runner boundary', () => {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs/refunds.md'), 'refund policy money back within thirty days\n');
    writeFileSync(join(dir, 'docs/shipping.md'), 'shipping delivery courier tracking parcel\n');
    const source = [
      'corpus name=Docs',
      '  source name=manuals kind=local uri="./docs/**/*.md" media=markdown',
      '  chunking source=manuals strategy=semantic maxTokens=80 overlap=0 unit=tokens',
      '',
      'embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine',
      'vectorStore name=DocsMemory kind=memory dims=64 metric=cosine',
      'ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding',
      'retriever name=DocsSearch corpus=Docs embed=DocsEmbedding',
      'rag name=AnswerDocs retriever=DocsSearch citations=true',
      '  grounding requireCitations=true',
      '  ragRetrieve name=FindDocs index=DocsIndex queryParam=question topK=1 output="RetrievedChunk[]"',
      '',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    capability namespace=rag operation=retrieve name=chunks input="{ question: \\"refund policy money back\\", retrieval: \\"FindDocs\\" }"',
      '    print value="chunks.length"',
      '    capability namespace=rag operation=promptContext name=context input="{ chunks: chunks, maxChars: 6000 }"',
      '    print value="context.includedCount"',
      '    print value="context.text"',
      '    each name=chunk in=chunks',
      '      print value="chunk.source"',
      '      print value="chunk.text"',
    ].join('\n');

    const r = runFile(writeFile(source));

    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('1\n');
    expect(r.stdout).toContain('[1] id=');
    expect(r.stdout).toContain('source="docs/refunds.md"');
    expect(r.stdout).toContain('docs/refunds.md\n');
    expect(r.stdout).toContain('refund policy money back within thirty days');
  });

  test('RAG CAPABILITY: async rag.ingest indexes local-persistent stores through async preview', () => {
    const fixtureDir = join(dir, `rag-ingest-${counter++}`);
    mkdirSync(join(fixtureDir, 'docs'), { recursive: true });
    writeFileSync(join(fixtureDir, 'docs/refunds.md'), 'refund policy money back within thirty days\n');
    writeFileSync(join(fixtureDir, 'docs/shipping.md'), 'shipping delivery courier tracking parcel\n');
    const file = join(fixtureDir, 'ingest.kern');
    writeFileSync(
      file,
      [
        'corpus name=Docs',
        '  source name=manuals kind=local uri="./docs/**/*.md" media=markdown',
        '  chunking source=manuals strategy=semantic maxTokens=80 overlap=0 unit=tokens',
        '',
        'embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine',
        'vectorStore name=DocsStore kind=local-persistent dims=64 metric=cosine path="./runtime-index"',
        'ragIndex name=DocsIndex corpus=Docs store=DocsStore embed=DocsEmbedding',
        '',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    capability namespace=rag operation=ingest name=report',
        '    print value="report.count"',
        '    print value="report.action"',
      ].join('\n'),
    );

    const r = runArgs(['run', '--async-preview', file]);

    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('1\nindexed\n');
    expect(readFileSync(join(fixtureDir, 'runtime-index', 'DocsIndex.manifest.json'), 'utf-8')).toContain('DocsIndex');
  });

  test('RAG CAPABILITY: documented rag-starter runtime-run example stays runnable', () => {
    const r = runFile(resolve(ROOT, 'examples/rag-starter/runtime-run.kern'));

    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    const lines = r.stdout.trimEnd().split('\n');
    expect(lines[0]).toBe('1');
    expect(lines[1]).toBe('corpus/refunds.md');
    expect(lines.slice(2).join('\n').trim()).not.toBe('');
  });

  test('RAG CAPABILITY: documented rag-starter answer preview composes rag.retrieve and llm.complete', () => {
    const r = runArgs([
      'run',
      '--async-preview',
      '--llm-response',
      'Refunds are available within thirty days [1]',
      resolve(ROOT, 'examples/rag-starter/runtime-answer-preview.kern'),
    ]);

    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('1\n1\n[1] id=');
    expect(r.stdout).toContain('source="corpus/refunds.md"');
    expect(r.stdout).toContain('refund policy');
    expect(r.stdout).toMatch(/Refunds are available[\s\S]*Refunds are available within thirty days \[1\]/u);
    expect(r.stdout).toContain('\nRefunds are available within thirty days [1]\n');
  });

  test('RAG CAPABILITY: documented rag-starter async retrieve preview composes retrieval, llm, and grounding', () => {
    const r = runArgs([
      'run',
      '--async-preview',
      '--llm-response',
      'Refunds are available within thirty days [1]',
      resolve(ROOT, 'examples/rag-starter/runtime-answer-async-retrieve-preview.kern'),
    ]);

    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('1\n1\n[1] id=');
    expect(r.stdout).toContain('source="corpus/refunds.md"');
    expect(r.stdout).toContain('refund policy');
    expect(r.stdout).toContain('\nRefunds are available within thirty days [1]\n');
  });

  test('RAG CAPABILITY: answer preview fails closed when deterministic llm output is ungrounded', () => {
    const r = runArgs([
      'run',
      '--async-preview',
      '--llm-response',
      'Unsupported claim about refund timing details',
      resolve(ROOT, 'examples/rag-starter/runtime-answer-preview.kern'),
    ]);

    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('RAG answer check failed');
  });

  test('RAG CAPABILITY: documented rag.answer preview synthesizes and checks an answer in one capability', () => {
    const r = runArgs([
      'run',
      '--async-preview',
      '--llm-response',
      'Refunds are available within thirty days [1]',
      resolve(ROOT, 'examples/rag-starter/runtime-answer-capability-preview.kern'),
    ]);

    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe(['1', 'true', 'grounded', 'Refunds are available within thirty days [1]', ''].join('\n'));
  });

  test('RAG CAPABILITY: rag.answer preview fails closed when generated output is ungrounded', () => {
    const r = runArgs([
      'run',
      '--async-preview',
      '--llm-response',
      'Unsupported refund details [1]',
      resolve(ROOT, 'examples/rag-starter/runtime-answer-capability-preview.kern'),
    ]);

    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('RAG answer synthesis failed');
  });

  test('RAG CAPABILITY: rag.answer preview rejects chunks not returned by rag.retrieve', () => {
    const source = [
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    capability namespace=rag operation=answer name=result input="{ query: \\"refund policy receipt\\", chunks: [{ id: \\"fake\\", text: \\"Refunds are available within thirty days\\", score: 1, source: \\"fake.md\\", citationUri: \\"fake.md\\", citationLocator: null }], requireCitations: true, minCitedChunks: 1, minGroundingCoverage: 0.85 }"',
      '    print value="result.answer"',
    ].join('\n');
    const r = runArgs([
      'run',
      '--async-preview',
      '--llm-response',
      'Refunds are available within thirty days [1]',
      writeFile(source),
    ]);

    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('must match a chunk previously returned by rag.retrieve');
  });

  test('STORAGE CAPABILITY: kern run provides volatile storage for one program execution', () => {
    const r = runProgram([
      'capability namespace=storage operation=set name=setOk input="{ key: \\"theme\\", value: \\"dark\\" }"',
      'print value="setOk"',
      'capability namespace=storage operation=get name=theme input="{ key: \\"theme\\" }"',
      'print value="theme"',
      'capability namespace=storage operation=keys name=keys',
      'print value="keys.length"',
      'print value="keys[0]"',
      'capability namespace=storage operation=delete name=deleted input="{ key: \\"theme\\" }"',
      'print value="deleted"',
      'capability namespace=storage operation=get name=afterDelete input="{ key: \\"theme\\" }"',
      'print value="afterDelete"',
      'capability namespace=storage operation=clear name=cleared',
      'print value="cleared"',
    ]);

    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('true\ndark\n1\ntheme\ntrue\nnull\ntrue\n');
  });

  test('CRYPTO CAPABILITY: kern run provides browser-safe random UUID, bytes, and hex', () => {
    const r = runProgram([
      'capability namespace=crypto operation=randomUUID name=id',
      'print value="id"',
      'capability namespace=crypto operation=randomBytes name=bytes input="{ length: 4 }"',
      'print value="bytes.length"',
      'capability namespace=crypto operation=randomHex name=hex input="{ length: 4 }"',
      'print value="hex"',
    ]);

    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    const lines = r.stdout.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(lines[1]).toBe('4');
    expect(lines[2]).toMatch(/^[0-9a-f]{8}$/u);
  });

  test('CLI executeKernSource provides storage and crypto even without sourcePath', () => {
    const stdout = executeKernSource(
      mainProgram([
        'capability namespace=storage operation=set name=setOk input="{ key: \\"mode\\", value: \\"unit\\" }"',
        'print value="setOk"',
        'capability namespace=storage operation=get name=mode input="{ key: \\"mode\\" }"',
        'print value="mode"',
        'capability namespace=crypto operation=randomBytes name=bytes input="{ length: 2 }"',
        'print value="bytes.length"',
      ]),
    );

    expect(stdout).toBe('true\nunit\n2\n');
  });
});

// ── Milestone 5.1b — self-hosting blockers lifted from the reference runner:
// recursive helper calls (explicit depth limit), dynamic array index
// arithmetic, array append (`do` + `.push`), and List.length/Map.get/has/set
// from the KERN-stdlib lowering table. ─────────────────────────────────────
describe('kern run — milestone 5.1b: recursion, dynamic index, append, stdlib', () => {
  test('a self-recursive helper with a base case computes factorial(5)', () => {
    const source = [
      'fn name=factorial params="n:number" returns=number',
      '  handler lang="kern"',
      '    if cond="n <= 1"',
      '      return value="1"',
      '    return value="n * factorial(n - 1)"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="factorial(5)"',
    ].join('\n');
    const r = runFile(writeFile(source));
    expect(r.stdout).toBe('120\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('unbounded mutual recursion with no base case fails closed at the depth limit (exit 2, no stdout)', () => {
    const source = [
      'fn name=a returns=number',
      '  handler lang="kern"',
      '    return value="b()"',
      'fn name=b returns=number',
      '  handler lang="kern"',
      '    return value="a()"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="a()"',
    ].join('\n');
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  test('dynamic array index reads accept +/- arithmetic on a loop counter', () => {
    const r = runProgram([
      'let name=xs value="[10,20,30]"',
      'for name=i from="0" to="2"',
      '  print value="xs[i + 1]"',
    ]);
    expect(r.stdout).toBe('20\n30\n');
    expect(r.status).toBe(0);
  });

  test('`*` arithmetic on a counter still abstains (exit 2, no stdout)', () => {
    const r = runProgram(['let name=xs value="[10,20,30]"', 'for name=i from="0" to="2"', '  print value="xs[i * 1]"']);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
  });

  test('array append via `do value="xs.push(...)"` builds a result list across a loop', () => {
    const r = runProgram([
      'let name=results value="[]"',
      'for name=i from="0" to="3"',
      '  do value="results.push(i * 2)"',
      'print value="results.length"',
      'print value="results[0]"',
      'print value="results[2]"',
    ]);
    expect(r.stdout).toBe('3\n0\n4\n');
    expect(r.status).toBe(0);
  });

  test('List.length + new Map()/Map.set/Map.get/Map.has execute natively', () => {
    const r = runProgram([
      'let name=xs value="[1,2,3]"',
      'print value="List.length(xs)"',
      'let name=m value="new Map()"',
      'do value="Map.set(m, \\"a\\", 1)"',
      'print value="Map.get(m, \\"a\\")"',
      'print value="Map.has(m, \\"a\\")"',
      'print value="Map.has(m, \\"missing\\")"',
    ]);
    expect(r.stdout).toBe('3\n1\ntrue\nfalse\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  // String ops (tribunal-locked contract, Option D — code points), added
  // AFTER the initial four slices above. Scope note: this reference-runner
  // implementation is BMP-safe-or-fail-closed (see portable-string.ts) — a
  // well-formed non-BMP character (emoji, rare CJK extension chars) fails
  // closed here too, a deliberate risk-valve narrowing, NOT the tribunal's
  // final target for non-BMP input.
  test('Text.length/charAt/slice/indexOf/startsWith execute natively (BMP-safe, code points)', () => {
    const r = runProgram([
      'let name=s value="\\"hello world\\""',
      'print value="Text.length(s)"',
      'print value="Text.charAt(s, 0)"',
      'print value="Text.slice(s, 6, 11)"',
      'print value="Text.indexOf(s, \\"world\\")"',
      'print value="Text.startsWith(s, \\"hello\\")"',
    ]);
    expect(r.stdout).toBe('11\nh\nworld\n6\ntrue\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('Text.length on a BMP non-ASCII string counts code points, not UTF-16 units (日本語 -> 3)', () => {
    const r = runProgram(['print value="Text.length(\\"日本語\\")"']);
    expect(r.stdout).toBe('3\n');
    expect(r.status).toBe(0);
  });

  test('a lone surrogate fails closed on Text.length (the tribunal fail-closed set)', () => {
    const r = runProgram(['print value="Text.length(\\"\\ud800\\")"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('a well-formed non-BMP character (emoji) also fails closed under this slice\'s risk-valve narrowing', () => {
    const r = runProgram(['print value="Text.length(\\"\\ud83d\\ude00\\")"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('Text.charAt and Text.slice fail closed on out-of-bounds (strict bounds policy, no silent clamping)', () => {
    expect(runProgram(['print value="Text.charAt(\\"hi\\", 2)"']).status).toBe(2);
    expect(runProgram(['print value="Text.slice(\\"hi\\", 0, 5)"']).status).toBe(2);
  });

  test('Text.indexOf returns -1 for a missing needle (not an error)', () => {
    const r = runProgram(['print value="Text.indexOf(\\"hello\\", \\"z\\")"']);
    expect(r.stdout).toBe('-1\n');
    expect(r.status).toBe(0);
  });
});

describe('kern run --capabilities — preflights capability requirements without execution', () => {
  test('aggregates capability requirements from imported modules', () => {
    writeNamedFile(
      'multi-cap/helper.kern',
      [
        'fn name=readConfig returns=string export=true',
        '  handler lang="kern"',
        '    capability namespace=fs operation=readText name=text input="{ path: \\"config.txt\\" }"',
        '    return value="text"',
      ].join('\n'),
    );
    const file = writeNamedFile(
      'multi-cap/main.kern',
      [
        'use path="./helper"',
        '  from name=readConfig kind=fn',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    print value="\\"EXECUTED\\""',
      ].join('\n'),
    );

    const result = runArgs(['run', '--capabilities', file]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('EXECUTED');
    expect(report.requirements.map((requirement) => requirement.id)).toEqual(['fs.readText']);
    expect(report.plannedCapabilities.map((requirement) => requirement.id)).toEqual(['fs.readText']);
    expect(report.asyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual(['fs.readText']);
    expect(report.missingAsyncProviders).toEqual([]);
  });

  test('reports CLI-provided shipped capabilities as runnable JSON', () => {
    const file = writeFile(
      mainProgram([
        'capability namespace=storage operation=set name=setOk input="{ key: \\"theme\\", value: \\"dark\\" }"',
        'capability namespace=crypto operation=randomHex name=hex input="{ length: 4 }"',
        'capability namespace=rag operation=retrieve name=chunks input="{ question: \\"refund\\" }"',
        'capability namespace=rag operation=promptContext name=context input="{ chunks: chunks }"',
        'capability namespace=rag operation=checkAnswer name=check input="{ query: \\"refund\\", answer: \\"Refunds follow policy.\\", chunks: chunks, groundingSpans: [{ start: 0, end: 22, chunkIndexes: [0] }] }"',
        'print value="\\"EXECUTED\\""',
      ]),
    );

    const result = runArgs(['run', '--capabilities', file]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('EXECUTED');
    expect(report.hasCapabilityBlockers).toBe(false);
    expect(report.capabilityReadinessMode).toBe('sync');
    expect(report.hasSyncCapabilityBlockers).toBe(false);
    expect(report.hasAsyncCapabilityBlockers).toBe(false);
    expect(report.asyncBoundaryRequired).toBe(false);
    expect(report.hasParseErrors).toBe(false);
    expect(report.requirements.map((requirement) => requirement.id)).toEqual([
      'storage.set',
      'crypto.randomHex',
      'rag.retrieve',
      'rag.promptContext',
      'rag.checkAnswer',
    ]);
    expect(report.requirements[0]).toEqual(expect.objectContaining({ bindingName: 'setOk', sourceLine: 3 }));
    expect(report.plannedCapabilities).toEqual([]);
    expect(report.asyncPlannedCapabilities).toEqual([]);
    expect(report.missingAsyncProviders).toEqual([]);
    expect(report.providedAsyncCapabilities).toEqual([]);
    expect(report.missingProviders).toEqual([]);
    expect(report.providedCapabilities).toContain('storage.set');
    expect(report.providedCapabilities).toContain('crypto.randomHex');
    expect(report.providedCapabilities).toContain('rag.retrieve');
    expect(report.providedCapabilities).toContain('rag.promptContext');
    expect(report.providedCapabilities).toContain('rag.checkAnswer');

    const trailingFlag = runArgs(['run', file, '--capabilities']);
    expect(trailingFlag.status).toBe(0);
    expect(parseCapabilityReport(trailingFlag).hasCapabilityBlockers).toBe(false);
  });

  test('marks planned and unknown capabilities as non-runnable without invoking providers', () => {
    const file = writeFile(
      mainProgram([
        'capability namespace=llm operation=complete name=text input="{ prompt: \\"hello\\" }"',
        'capability namespace=foo operation=bar name=value input="{ x: 1 }"',
      ]),
    );

    const result = runArgs(['run', '--capabilities', file]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(report.hasCapabilityBlockers).toBe(true);
    expect(report.capabilityReadinessMode).toBe('sync');
    expect(report.hasSyncCapabilityBlockers).toBe(true);
    expect(report.hasAsyncCapabilityBlockers).toBe(true);
    expect(report.plannedCapabilities.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(report.asyncBoundaryRequired).toBe(true);
    expect(report.asyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(report.missingAsyncProviders.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(report.asyncProviderHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'llm.complete',
          providerFlags: ['--llm-response <text> or --llm-provider openai'],
          required: true,
          provided: false,
          missing: true,
        }),
      ]),
    );
    expect(report.unknownCapabilities.map((requirement) => requirement.id)).toEqual(['foo.bar']);
  });

  test('uses async preview provider flags when reporting capability readiness', () => {
    const fsRoot = join(dir, `capability-fs-root-${counter++}`);
    mkdirSync(fsRoot);
    const file = writeFile(
      mainProgram([
        'capability namespace=fs operation=readText name=body input="{ path: \\"input.txt\\" }"',
        'capability namespace=fs operation=writeText name=ok input="{ path: \\"out.txt\\", text: body }"',
        'capability namespace=net operation=fetch name=response input="{ url: \\"data:text/plain,hello\\" }"',
        'capability namespace=llm operation=complete name=answer input="{ prompt: response.body }"',
      ]),
    );

    const result = runArgs([
      'run',
      '--capabilities',
      '--fs-root',
      fsRoot,
      '--fs-write-root',
      fsRoot,
      '--allow-net',
      'data:',
      '--llm-response',
      'answer',
      file,
    ]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(report.hasCapabilityBlockers).toBe(false);
    expect(report.capabilityReadinessMode).toBe('async-preview');
    expect(report.hasSyncCapabilityBlockers).toBe(true);
    expect(report.hasAsyncCapabilityBlockers).toBe(false);
    expect(report.asyncBoundaryRequired).toBe(true);
    expect(report.requirements.map((requirement) => requirement.id)).toEqual([
      'fs.readText',
      'fs.writeText',
      'net.fetch',
      'llm.complete',
    ]);
    expect(report.providedAsyncCapabilities).toEqual([
      'fs.list',
      'fs.readText',
      'fs.writeText',
      'net.fetch',
      'llm.complete',
    ]);
    expect(report.asyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual([
      'fs.readText',
      'fs.writeText',
      'net.fetch',
      'llm.complete',
    ]);
    expect(report.missingAsyncProviders).toEqual([]);
    expect(report.asyncProviderHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'fs.writeText',
          providerFlags: ['--fs-root <dir> + --fs-write-root <dir>'],
          required: true,
          provided: true,
          missing: false,
        }),
      ]),
    );
    expect(report.asyncProviderHints.some((hint) => hint.id === 'rag.ingest')).toBe(false);
  });

  test('reports rag.retrieve plus deterministic llm preview readiness for the answer example', () => {
    const result = runArgs([
      'run',
      '--capabilities',
      '--llm-response',
      'Refunds are available within thirty days [1]',
      resolve(ROOT, 'examples/rag-starter/runtime-answer-preview.kern'),
    ]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(report.capabilityReadinessMode).toBe('async-preview');
    const requirementIds = report.requirements.map((requirement) => requirement.id);
    expect(requirementIds).toHaveLength(4);
    expect(requirementIds).toEqual(
      expect.arrayContaining(['rag.retrieve', 'rag.promptContext', 'llm.complete', 'rag.checkAnswer']),
    );
    expect(report.providedCapabilities).toContain('rag.retrieve');
    expect(report.providedCapabilities).toContain('rag.promptContext');
    expect(report.providedCapabilities).toContain('rag.checkAnswer');
    expect(report.providedAsyncCapabilities).toHaveLength(1);
    expect(report.providedAsyncCapabilities).toContain('llm.complete');
    expect(report.missingProviders).toEqual([]);
    expect(report.missingAsyncProviders).toEqual([]);
    expect(report.unsupportedAsyncExecutions).toEqual([]);
    expect(report.hasAsyncCapabilityBlockers).toBe(false);
  });

  test('reports deterministic rag.answer preview readiness only when rag.answer is required', () => {
    const result = runArgs([
      'run',
      '--capabilities',
      '--llm-response',
      'Refunds are available within thirty days [1]',
      resolve(ROOT, 'examples/rag-starter/runtime-answer-capability-preview.kern'),
    ]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(report.capabilityReadinessMode).toBe('async-preview');
    expect(report.requirements.map((requirement) => requirement.id)).toEqual(
      expect.arrayContaining(['rag.retrieve', 'rag.answer']),
    );
    expect(report.providedAsyncCapabilities).toEqual(['llm.complete', 'rag.answer']);
    expect(report.missingAsyncProviders).toEqual([]);
    expect(report.hasAsyncCapabilityBlockers).toBe(false);
  });

  test('reports async rag.retrieveAsync preview readiness for the answer example', () => {
    const result = runArgs([
      'run',
      '--capabilities',
      '--llm-response',
      'Refunds are available within thirty days [1]',
      resolve(ROOT, 'examples/rag-starter/runtime-answer-async-retrieve-preview.kern'),
    ]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(report.capabilityReadinessMode).toBe('async-preview');
    expect(report.requirements.map((requirement) => requirement.id)).toEqual(
      expect.arrayContaining(['rag.retrieveAsync', 'rag.promptContext', 'llm.complete', 'rag.checkAnswer']),
    );
    expect(report.providedAsyncCapabilities).toEqual(['llm.complete', 'rag.retrieveAsync']);
    expect(report.missingAsyncProviders).toEqual([]);
    expect(report.unsupportedAsyncExecutions).toEqual([]);
    expect(report.hasAsyncCapabilityBlockers).toBe(false);
  });

  test('reports async rag.retrieveAsync readiness for explicitly selected local retrievals only', () => {
    const file = writeFile(
      [
        'corpus name=Docs',
        '  source name=manuals kind=local uri="./docs/**/*.md" media=markdown',
        '  chunking source=manuals strategy=semantic maxTokens=80 overlap=0 unit=tokens',
        '',
        'embed name=LocalEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine',
        'embed name=ProviderEmbedding corpus=Docs model="openai:text-embedding-3-small" dims=1536 metric=cosine',
        'vectorStore name=DocsMemory kind=memory dims=64 metric=cosine',
        'vectorStore name=ProviderMemory kind=memory dims=1536 metric=cosine',
        'ragIndex name=LocalIndex corpus=Docs store=DocsMemory embed=LocalEmbedding',
        'ragIndex name=ProviderIndex corpus=Docs store=ProviderMemory embed=ProviderEmbedding',
        'retriever name=DocsSearch corpus=Docs embed=LocalEmbedding',
        'rag name=AnswerDocs retriever=DocsSearch citations=true',
        '  grounding requireCitations=true',
        '  ragRetrieve name=FindLocal index=LocalIndex queryParam=question topK=1 output="RetrievedChunk[]"',
        '  ragRetrieve name=FindProvider index=ProviderIndex queryParam=question topK=1 output="RetrievedChunk[]"',
        '',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    capability namespace=rag operation=retrieveAsync name=chunks input="{ question: \\"refund\\", retrieval: \\"FindLocal\\" }"',
        '    print value="chunks.length"',
      ].join('\n'),
    );
    const result = runArgs(['run', '--capabilities', file]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(report.requirements.map((requirement) => requirement.id)).toEqual(['rag.retrieveAsync']);
    expect(report.providedAsyncCapabilities).toEqual(['rag.retrieveAsync']);
    expect(report.missingAsyncProviders).toEqual([]);
    expect(report.hasAsyncCapabilityBlockers).toBe(false);
  });

  test('does not report async rag.retrieveAsync readiness without embed provider configuration', () => {
    const file = writeFile(
      [
        'corpus name=Docs',
        '  source name=manuals kind=local uri="./docs/**/*.md" media=markdown',
        '  chunking source=manuals strategy=semantic maxTokens=80 overlap=0 unit=tokens',
        '',
        'embed name=DocsEmbedding corpus=Docs model="openai:text-embedding-3-small" dims=1536 metric=cosine',
        'vectorStore name=DocsMemory kind=memory dims=1536 metric=cosine',
        'ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding',
        'retriever name=DocsSearch corpus=Docs embed=DocsEmbedding',
        'rag name=AnswerDocs retriever=DocsSearch citations=true',
        '  ragRetrieve name=FindDocs index=DocsIndex queryParam=question topK=1 output="RetrievedChunk[]"',
        '',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    capability namespace=rag operation=retrieveAsync name=chunks input="{ question: \\"refund\\", retrieval: \\"FindDocs\\" }"',
        '    print value="chunks.length"',
      ].join('\n'),
    );
    const result = runArgs(['run', '--capabilities', file]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(report.requirements.map((requirement) => requirement.id)).toEqual(['rag.retrieveAsync']);
    expect(report.providedAsyncCapabilities).toEqual([]);
    expect(report.missingAsyncProviders.map((requirement) => requirement.id)).toEqual(['rag.retrieveAsync']);
    expect(report.hasAsyncCapabilityBlockers).toBe(true);
  });

  test('reports async rag.ingest readiness without unrelated provider flags', () => {
    const file = writeFile(
      [
        'corpus name=Docs',
        '  source name=manuals kind=local uri="./docs/**/*.md" media=markdown',
        '  chunking source=manuals strategy=semantic maxTokens=80 overlap=0 unit=tokens',
        '',
        'embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine',
        'vectorStore name=DocsStore kind=local-persistent dims=64 metric=cosine path="./runtime-index"',
        'ragIndex name=DocsIndex corpus=Docs store=DocsStore embed=DocsEmbedding',
        'corpus name=Other',
        '  source name=other kind=local uri="./other/**/*.md" media=markdown',
        '  chunking source=other strategy=semantic maxTokens=80 overlap=0 unit=tokens',
        'embed name=OtherEmbedding corpus=Other model="openai:text-embedding-3-small" dims=1536 metric=cosine',
        'vectorStore name=OtherMemory kind=memory dims=1536 metric=cosine',
        'ragIndex name=OtherIndex corpus=Other store=OtherMemory embed=OtherEmbedding',
        '',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    capability namespace=rag operation=ingest name=report input="{ statusOnly: true }"',
        '    print value="report.count"',
      ].join('\n'),
    );
    const result = runArgs(['run', '--capabilities', file]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(report.capabilityReadinessMode).toBe('async-preview');
    expect(report.requirements.map((requirement) => requirement.id)).toEqual(['rag.ingest']);
    expect(report.providedAsyncCapabilities).toEqual(['rag.ingest']);
    expect(report.missingAsyncProviders).toEqual([]);
    expect(report.hasAsyncCapabilityBlockers).toBe(false);
  });

  test('does not report provider-backed rag.ingest readiness without embed provider configuration', () => {
    const file = writeFile(
      [
        'corpus name=Docs',
        '  source name=manuals kind=local uri="./docs/**/*.md" media=markdown',
        '  chunking source=manuals strategy=semantic maxTokens=80 overlap=0 unit=tokens',
        '',
        'embed name=DocsEmbedding corpus=Docs model="openai:text-embedding-3-small" dims=1536 metric=cosine',
        'vectorStore name=DocsStore kind=local-persistent dims=1536 metric=cosine path="./runtime-index"',
        'ragIndex name=DocsIndex corpus=Docs store=DocsStore embed=DocsEmbedding',
        '',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    capability namespace=rag operation=ingest name=report input="{ statusOnly: true }"',
        '    print value="report.count"',
      ].join('\n'),
    );
    const result = runArgs(['run', '--capabilities', file]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(report.requirements.map((requirement) => requirement.id)).toEqual(['rag.ingest']);
    expect(report.providedAsyncCapabilities).toEqual([]);
    expect(report.missingAsyncProviders.map((requirement) => requirement.id)).toEqual(['rag.ingest']);
    expect(report.hasAsyncCapabilityBlockers).toBe(true);
  });

  test('reports provider-backed llm preview readiness for the answer example without constructing provider clients', () => {
    const result = runArgs(
      [
        'run',
        '--capabilities',
        '--llm-provider',
        'openai',
        '--llm-model',
        'test-model',
        '--llm-base-url',
        'http://127.0.0.1:8123/v1',
        resolve(ROOT, 'examples/rag-starter/runtime-answer-preview.kern'),
      ],
      { env: { ...process.env, KERN_LLM_API_KEY: '', KERN_LLM_MODEL: '', KERN_LLM_BASE_URL: '' } },
    );
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(report.capabilityReadinessMode).toBe('async-preview');
    expect(report.providedAsyncCapabilities).toEqual(['llm.complete']);
    expect(report.missingAsyncProviders).toEqual([]);
    expect(report.hasAsyncCapabilityBlockers).toBe(true);
    expect(report.hasCapabilityBlockers).toBe(true);
    expect(report.llmProviderPolicy).toEqual({
      provider: 'openai',
      configured: false,
      apiKeyPresent: false,
      apiKeyValid: true,
      modelPresent: true,
      modelValid: true,
      baseUrlPresent: true,
      baseUrlValid: true,
    });
    expect(report.providerPolicyBlockers).toEqual([{ provider: 'openai', reason: 'missing-api-key' }]);
  });

  test('reports invalid OpenAI-compatible base URL as a provider policy blocker', () => {
    const result = runArgs(
      [
        'run',
        '--capabilities',
        '--llm-provider',
        'openai',
        '--llm-model',
        'test-model',
        '--llm-base-url',
        'http://example.test/v1',
        resolve(ROOT, 'examples/rag-starter/runtime-answer-preview.kern'),
      ],
      { env: { ...process.env, KERN_LLM_API_KEY: 'test-secret', KERN_LLM_MODEL: '', KERN_LLM_BASE_URL: '' } },
    );
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(report.llmProviderPolicy).toEqual({
      provider: 'openai',
      configured: false,
      apiKeyPresent: true,
      apiKeyValid: true,
      modelPresent: true,
      modelValid: true,
      baseUrlPresent: true,
      baseUrlValid: false,
    });
    expect(report.providerPolicyBlockers).toEqual([{ provider: 'openai', reason: 'invalid-base-url' }]);
  });

  test('reports invalid OpenAI provider raw strings as provider policy blockers', () => {
    const invalidApiKey = runArgs(
      [
        'run',
        '--capabilities',
        '--llm-provider',
        'openai',
        '--llm-model',
        'test-model',
        resolve(ROOT, 'examples/rag-starter/runtime-answer-preview.kern'),
      ],
      { env: { ...process.env, KERN_LLM_API_KEY: 'test\nsecret', KERN_LLM_MODEL: '', KERN_LLM_BASE_URL: '' } },
    );
    const invalidApiKeyReport = parseCapabilityReport(invalidApiKey);

    expect(invalidApiKey.status).toBe(2);
    expect(invalidApiKey.stderr).toBe('');
    expect(invalidApiKeyReport.llmProviderPolicy).toEqual({
      provider: 'openai',
      configured: false,
      apiKeyPresent: true,
      apiKeyValid: false,
      modelPresent: true,
      modelValid: true,
      baseUrlPresent: false,
      baseUrlValid: true,
    });
    expect(invalidApiKeyReport.providerPolicyBlockers).toEqual([{ provider: 'openai', reason: 'invalid-api-key' }]);

    const invalidModel = runArgs(
      [
        'run',
        '--capabilities',
        '--llm-provider',
        'openai',
        resolve(ROOT, 'examples/rag-starter/runtime-answer-preview.kern'),
      ],
      {
        env: { ...process.env, KERN_LLM_API_KEY: 'test-secret', KERN_LLM_MODEL: 'test\nmodel', KERN_LLM_BASE_URL: '' },
      },
    );
    const invalidModelReport = parseCapabilityReport(invalidModel);

    expect(invalidModel.status).toBe(2);
    expect(invalidModel.stderr).toBe('');
    expect(invalidModelReport.llmProviderPolicy?.modelValid).toBe(false);
    expect(invalidModelReport.providerPolicyBlockers).toEqual([{ provider: 'openai', reason: 'invalid-model' }]);
  });

  test('reports invalid requested OpenAI provider policy even when source does not require llm capabilities', () => {
    const file = writeFile(mainProgram(['print value="\\"hello\\""']));

    const result = runArgs(['run', '--capabilities', '--llm-provider', 'openai', '--llm-model', 'test-model', file], {
      env: { ...process.env, KERN_LLM_API_KEY: '', KERN_LLM_MODEL: '', KERN_LLM_BASE_URL: '' },
    });
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(report.capabilityReadinessMode).toBe('async-preview');
    expect(report.providedAsyncCapabilities).toEqual(['llm.complete']);
    expect(report.requirements.map((requirement) => requirement.id)).toEqual([]);
    expect(report.providerPolicyBlockers).toEqual([{ provider: 'openai', reason: 'missing-api-key' }]);
    expect(report.hasAsyncCapabilityBlockers).toBe(true);
    expect(report.hasCapabilityBlockers).toBe(true);
  });

  test('treats whitespace OpenAI-compatible base URL environment values as absent in capability reports', () => {
    const result = runArgs(
      [
        'run',
        '--capabilities',
        '--llm-provider',
        'openai',
        '--llm-model',
        'test-model',
        resolve(ROOT, 'examples/rag-starter/runtime-answer-preview.kern'),
      ],
      { env: { ...process.env, KERN_LLM_API_KEY: 'test-secret', KERN_LLM_MODEL: '', KERN_LLM_BASE_URL: '   ' } },
    );
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(report.llmProviderPolicy).toEqual({
      provider: 'openai',
      configured: true,
      apiKeyPresent: true,
      apiKeyValid: true,
      modelPresent: true,
      modelValid: true,
      baseUrlPresent: false,
      baseUrlValid: true,
    });
    expect(report.providerPolicyBlockers).toEqual([]);
  });

  test('reports partially satisfied async preview provider flags', () => {
    const fsRoot = join(dir, `capability-partial-fs-root-${counter++}`);
    mkdirSync(fsRoot);
    const file = writeFile(
      mainProgram([
        'capability namespace=fs operation=writeText name=ok input="{ path: \\"out.txt\\", text: \\"x\\" }"',
        'capability namespace=net operation=fetch name=response input="{ url: \\"data:text/plain,hello\\" }"',
      ]),
    );

    const result = runArgs(['run', '--capabilities', '--fs-root', fsRoot, file]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(report.capabilityReadinessMode).toBe('async-preview');
    expect(report.hasSyncCapabilityBlockers).toBe(true);
    expect(report.hasAsyncCapabilityBlockers).toBe(true);
    expect(report.providedAsyncCapabilities).toEqual(['fs.list', 'fs.readText']);
    expect(report.missingAsyncProviders.map((requirement) => requirement.id)).toEqual(['fs.writeText', 'net.fetch']);
    expect(report.asyncProviderHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'fs.writeText', required: true, provided: false, missing: true }),
        expect.objectContaining({ id: 'net.fetch', required: true, provided: false, missing: true }),
      ]),
    );
  });

  test('reports async preview provider coverage for while loop capability calls', () => {
    const file = writeFile(
      mainProgram([
        'let kind=let name=n value="0"',
        'while cond="n < 1"',
        '  capability namespace=net operation=fetch name=response input="{ url: \\"data:text/plain,hello\\" }"',
        '  assign target=n value="n + 1"',
      ]),
    );

    const result = runArgs(['run', '--capabilities', '--allow-net', 'data:', file]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(report.capabilityReadinessMode).toBe('async-preview');
    expect(report.providedAsyncCapabilities).toEqual(['net.fetch']);
    expect(report.missingAsyncProviders).toEqual([]);
    expect(report.unsupportedAsyncExecutions).toEqual([]);
    expect(report.hasAsyncCapabilityBlockers).toBe(false);
  });

  test('reports async preview provider coverage for for and each loop capability calls', () => {
    const file = writeFile(
      mainProgram([
        'for name=i from="0" to="2"',
        '  capability namespace=llm operation=complete name=value input="{ prompt: i }"',
        'let name=items value="[1, 2]"',
        'each name=item in=items',
        '  capability namespace=llm operation=complete name=other input="{ prompt: item }"',
      ]),
    );

    const result = runArgs(['run', '--capabilities', '--llm-response', 'ok', file]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(report.capabilityReadinessMode).toBe('async-preview');
    expect(report.providedAsyncCapabilities).toEqual(['llm.complete']);
    expect(report.missingAsyncProviders).toEqual([]);
    expect(report.unsupportedAsyncExecutions).toEqual([]);
    expect(report.hasAsyncCapabilityBlockers).toBe(false);
  });

  test('reports async preview provider coverage for branch path capability calls', () => {
    const file = writeFile(
      mainProgram([
        'branch on="\\"paid\\""',
        '  path value="paid"',
        '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"selected\\" }"',
        '  path default=true',
        '    capability namespace=llm operation=complete name=fallback input="{ prompt: \\"fallback\\" }"',
      ]),
    );

    const result = runArgs(['run', '--capabilities', '--llm-response', 'ok', file]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(report.capabilityReadinessMode).toBe('async-preview');
    expect(report.providedAsyncCapabilities).toEqual(['llm.complete']);
    expect(report.missingAsyncProviders).toEqual([]);
    expect(report.unsupportedAsyncExecutions).toEqual([]);
    expect(report.hasAsyncCapabilityBlockers).toBe(false);
  });

  test('reports async preview provider coverage for try/catch/finally capability calls', () => {
    const file = writeFile(
      mainProgram([
        'try',
        '  capability namespace=llm operation=complete name=answer input="{ prompt: \\"body\\" }"',
        '  throw value="new Error(\\"boom\\")"',
        '  catch name=e',
        '    capability namespace=llm operation=complete name=recovered input="{ prompt: e.message }"',
        '  finally',
        '    capability namespace=llm operation=complete name=cleanup input="{ prompt: \\"cleanup\\" }"',
      ]),
    );

    const result = runArgs(['run', '--capabilities', '--llm-response', 'ok', file]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(report.capabilityReadinessMode).toBe('async-preview');
    expect(report.providedAsyncCapabilities).toEqual(['llm.complete']);
    expect(report.missingAsyncProviders).toEqual([]);
    expect(report.unsupportedAsyncExecutions).toEqual([]);
    expect(report.hasAsyncCapabilityBlockers).toBe(false);
  });

  test('reports async preview provider coverage for called helper capability calls', () => {
    const file = writeFile(
      [
        'fn name=helper returns=string',
        '  handler lang="kern"',
        '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"helper\\" }"',
        '    return value="answer"',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    print value="helper()"',
      ].join('\n'),
    );

    const result = runArgs(['run', '--capabilities', '--llm-response', 'ok', file]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(report.capabilityReadinessMode).toBe('async-preview');
    expect(report.providedAsyncCapabilities).toEqual(['llm.complete']);
    expect(report.missingAsyncProviders).toEqual([]);
    expect(report.unsupportedAsyncExecutions).toEqual([]);
    expect(report.hasAsyncCapabilityBlockers).toBe(false);
  });

  test('reports unsupported async helper expression slots as async-preview blockers', () => {
    const file = writeFile(
      [
        'fn name=helper returns=string',
        '  handler lang="kern"',
        '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"helper\\" }"',
        '    return value="answer"',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    branch on="helper()"',
        '      path value="ok"',
        '        print value="\\"ok\\""',
      ].join('\n'),
    );

    const result = runArgs(['run', '--capabilities', '--llm-response', 'ok', file]);
    const report = parseCapabilityReport(result);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(report.capabilityReadinessMode).toBe('async-preview');
    expect(report.providedAsyncCapabilities).toEqual(['llm.complete']);
    expect(report.missingAsyncProviders).toEqual([]);
    expect(report.unsupportedAsyncExecutions).toEqual([
      expect.objectContaining({
        id: 'llm.complete',
        reason: 'outside-main',
      }),
    ]);
    expect(report.hasAsyncCapabilityBlockers).toBe(true);
    expect(report.hasCapabilityBlockers).toBe(true);
  });

  test('async preview execution fails closed for unsupported async helper expression slots', () => {
    const file = writeFile(
      [
        'fn name=helper returns=string',
        '  handler lang="kern"',
        '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"helper\\" }"',
        '    return value="answer"',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    branch on="helper()"',
        '      path value="ok"',
        '        print value="\\"ok\\""',
      ].join('\n'),
    );

    const result = runArgs(['run', '--async-preview', '--llm-response', 'ok', file]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('kern run async preflight: unsupported async executions: llm.complete');
  });

  test('does not switch programmatic capability reports to async-preview mode for fsWriteRoot alone', () => {
    const report = analyzeRunCapabilities(
      mainProgram([
        'capability namespace=fs operation=writeText name=ok input="{ path: \\"out.txt\\", text: \\"x\\" }"',
      ]),
      'inline.kern',
      { fsWriteRoot: dir },
    );

    expect(report.capabilityReadinessMode).toBe('sync');
    expect(report.providedAsyncCapabilities).toEqual([]);
    expect(report.hasCapabilityBlockers).toBe(true);
    expect(report.hasAsyncCapabilityBlockers).toBe(true);
    expect(report.missingAsyncProviders.map((requirement) => requirement.id)).toEqual(['fs.writeText']);
  });

  test('does not report provider policy blockers when programmatic llmResponse satisfies llm.complete', () => {
    const report = analyzeRunCapabilities(
      mainProgram(['capability namespace=llm operation=complete name=answer input="{ prompt: \\"hello\\" }"']),
      'inline.kern',
      { llmResponse: 'ok', llmProvider: { provider: 'openai', model: 'test-model' } },
    );

    expect(report.capabilityReadinessMode).toBe('async-preview');
    expect(report.providedAsyncCapabilities).toEqual(['llm.complete']);
    expect(report.llmProviderPolicy?.apiKeyPresent).toBe(false);
    expect(report.providerPolicyBlockers).toEqual([]);
    expect(report.hasAsyncCapabilityBlockers).toBe(false);
    expect(report.hasCapabilityBlockers).toBe(false);
  });

  test('validates fs/net async preview provider flags before reporting readiness', () => {
    const file = writeFile(
      mainProgram(['capability namespace=fs operation=readText name=body input="{ path: \\"input.txt\\" }"']),
    );

    const missingRoot = runArgs(['run', '--capabilities', '--fs-root', join(dir, 'missing-root'), file]);
    expect(missingRoot.status).toBe(2);
    expect(missingRoot.stdout).toBe('');
    expect(missingRoot.stderr).toContain('kern run --capabilities: capability setup failed');

    const invalidOrigin = runArgs(['run', '--capabilities', '--allow-net', 'https://example.test/path', file]);
    expect(invalidOrigin.status).toBe(2);
    expect(invalidOrigin.stdout).toBe('');
    expect(invalidOrigin.stderr).toContain('--allow-net must be an origin');

    const incompatibleLlmProviders = runArgs([
      'run',
      '--capabilities',
      '--llm-response',
      'answer',
      '--llm-provider',
      'openai',
      file,
    ]);
    expect(incompatibleLlmProviders.status).toBe(2);
    expect(incompatibleLlmProviders.stdout).toBe('');
    expect(incompatibleLlmProviders.stderr).toContain('Usage: kern run');
  });

  test('reports malformed capability tokens and parse errors as non-runnable', () => {
    const malformed = runArgs([
      'run',
      '--capabilities',
      writeFile(mainProgram(['capability namespace="storage.v2" operation=get name=value'])),
    ]);
    const malformedReport = parseCapabilityReport(malformed);

    expect(malformed.status).toBe(2);
    expect(malformed.stderr).toBe('');
    expect(malformedReport.hasCapabilityBlockers).toBe(true);
    expect(malformedReport.malformedCapabilities).toEqual([
      expect.objectContaining({
        id: 'get',
        reason: expect.stringContaining("namespace 'storage.v2'"),
      }),
    ]);

    const parseError = runArgs(['run', '--capabilities', writeFile('fn name=main returns=void\n  handler lang="kern')]);
    const parseErrorReport = parseCapabilityReport(parseError);

    expect(parseError.status).toBe(2);
    expect(parseError.stderr).toBe('');
    expect(parseErrorReport.hasCapabilityBlockers).toBe(true);
    expect(parseErrorReport.hasParseErrors).toBe(true);
    expect(parseErrorReport.parseDiagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
  });

  test('reports usage and read errors for invalid capability preflight invocations', () => {
    const noFile = runArgs(['run', '--capabilities']);
    expect(noFile.status).toBe(2);
    expect(noFile.stdout).toBe('');
    expect(noFile.stderr).toContain('Usage: kern run');

    const missingFile = runArgs(['run', '--capabilities', join(dir, 'missing.kern')]);
    expect(missingFile.status).toBe(2);
    expect(missingFile.stdout).toBe('');
    expect(missingFile.stderr).toContain('kern run: cannot read file');

    const extraArg = runArgs(['run', '--foo', '--capabilities', writeFile(mainProgram([]))]);
    expect(extraArg.status).toBe(2);
    expect(extraArg.stdout).toBe('');
    expect(extraArg.stderr).toContain('Usage: kern run');
  });
});

describe('kern run --async-preview — executes CLI-owned async adapters', () => {
  test('runs straight-line fs read/list/write behind explicit roots', () => {
    const fsRoot = join(dir, `fs-root-${counter++}`);
    mkdirSync(fsRoot);
    writeFileSync(join(fsRoot, 'input.txt'), 'hello async');
    const file = writeFile(
      mainProgram([
        'capability namespace=fs operation=list name=files input="{ path: \\".\\" }"',
        'print value="files.length"',
        'capability namespace=fs operation=readText name=body input="{ path: \\"input.txt\\" }"',
        'print value="body"',
        'capability namespace=fs operation=writeText name=ok input="{ path: \\"out.txt\\", text: body }"',
        'print value="ok"',
      ]),
    );

    const result = runArgs(['run', '--async-preview', '--fs-root', fsRoot, '--fs-write-root', fsRoot, file]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('1\nhello async\ntrue\n');
    expect(readFileSync(join(fsRoot, 'out.txt'), 'utf-8')).toBe('hello async');
  });

  test('denies fs.writeText during preflight unless a write root is explicit', () => {
    const fsRoot = join(dir, `fs-root-${counter++}`);
    mkdirSync(fsRoot);
    const file = writeFile(
      mainProgram([
        'capability namespace=fs operation=writeText name=ok input="{ path: \\"out.txt\\", text: \\"x\\" }"',
      ]),
    );

    const result = runArgs(['run', '--async-preview', '--fs-root', fsRoot, file]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('missing async providers: fs.writeText');
    expect(existsSync(join(fsRoot, 'out.txt'))).toBe(false);
  });

  test('allows fs.writeText to write empty text', () => {
    const fsRoot = join(dir, `fs-root-${counter++}`);
    mkdirSync(fsRoot);
    const file = writeFile(
      mainProgram([
        'capability namespace=fs operation=writeText name=ok input="{ path: \\"empty.txt\\", text: \\"\\" }"',
      ]),
    );

    const result = runArgs(['run', '--async-preview', '--fs-root', fsRoot, '--fs-write-root', fsRoot, file]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('');
    expect(readFileSync(join(fsRoot, 'empty.txt'), 'utf-8')).toBe('');
  });

  test('denies fs.writeText when the final target is a symlink escape', () => {
    const fsRoot = join(dir, `fs-root-${counter++}`);
    mkdirSync(fsRoot);
    const outside = join(dir, `outside-write-${counter++}.txt`);
    writeFileSync(outside, 'outside');
    symlinkSync(outside, join(fsRoot, 'out.txt'));
    const file = writeFile(
      mainProgram([
        'print value="\\"before\\""',
        'capability namespace=fs operation=writeText name=ok input="{ path: \\"out.txt\\", text: \\"owned\\" }"',
      ]),
    );

    const result = runArgs(['run', '--async-preview', '--fs-root', fsRoot, '--fs-write-root', fsRoot, file]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('symlink');
    expect(readFileSync(outside, 'utf-8')).toBe('outside');
  });

  test('denies read paths that escape the fs root without replaying partial stdout', () => {
    const fsRoot = join(dir, `fs-root-${counter++}`);
    mkdirSync(fsRoot);
    writeFileSync(join(dir, 'outside.txt'), 'outside');
    const file = writeFile(
      mainProgram([
        'print value="\\"before\\""',
        'capability namespace=fs operation=readText name=body input="{ path: \\"../outside.txt\\" }"',
        'print value="body"',
      ]),
    );

    const result = runArgs(['run', '--async-preview', '--fs-root', fsRoot, file]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('escapes fs root');
  });

  test('runs straight-line net.fetch and llm.complete without fs roots when explicitly enabled', () => {
    const file = writeFile(
      mainProgram([
        'capability namespace=net operation=fetch name=response input="{ url: \\"data:text/plain,hello-net\\" }"',
        'print value="response.body"',
        'capability namespace=llm operation=complete name=answer input="{ prompt: response.body }"',
        'print value="answer"',
      ]),
    );

    const result = runArgs([
      'run',
      '--async-preview',
      '--allow-net',
      'data:',
      '--llm-response',
      'grounded answer',
      file,
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('hello-net\ngrounded answer\n');
  });

  test('accepts empty and dash-prefixed deterministic llm preview responses', () => {
    const emptyFile = writeFile(
      mainProgram([
        'capability namespace=llm operation=complete name=answer input="{ prompt: \\"hello\\" }"',
        'print value="answer"',
      ]),
    );

    const empty = runArgs(['run', '--async-preview', '--llm-response', '', emptyFile]);
    expect(empty.status).toBe(0);
    expect(empty.stderr).toBe('');
    expect(empty.stdout).toBe('\n');

    const dashFile = writeFile(
      mainProgram([
        'capability namespace=llm operation=complete name=answer input="{ prompt: \\"hello\\" }"',
        'print value="answer"',
      ]),
    );

    const dash = runArgs(['run', '--async-preview', '--llm-response', '-- nope', dashFile]);
    expect(dash.status).toBe(0);
    expect(dash.stderr).toBe('');
    expect(dash.stdout).toBe('-- nope\n');
  });

  test('llm.complete rejects unsupported input fields', async () => {
    const provider = createCliAsyncLlmCapability({ response: 'answer' }) as {
      complete: (call: { input: unknown }) => Promise<unknown>;
    };

    await expect(
      provider.complete({
        input: { prompt: 'hello', model: 'ignored-model' },
      }),
    ).rejects.toThrow(/input field 'model' is not supported/);
  });

  test('rag.answer calls the configured llm.complete provider and returns a grounded report', async () => {
    const prompts: string[] = [];
    const llm = {
      async complete(call: { input?: unknown }) {
        prompts.push(String((call.input as { prompt?: unknown }).prompt));
        return 'Refunds are available within thirty days [1]';
      },
    };
    const provider = createCliAsyncRagAnswerCapability({ llm }) as {
      answer: (call: { input: unknown }) => Promise<unknown>;
    };
    const input = {
      query: 'refund policy',
      chunks: [
        {
          id: 'refunds',
          text: 'Refunds are available within thirty days',
          score: 0.98,
          source: 'corpus/refunds.md',
          citation: { uri: 'corpus/refunds.md', locator: null },
        },
      ],
      requireCitations: true,
      minCitedChunks: 1,
      minGroundingCoverage: 0.85,
    };

    const result = await provider.answer({
      input,
    });

    expect(prompts[0]).toContain('Question: refund policy');
    expect(result).toEqual(
      expect.objectContaining({
        answer: 'Refunds are available within thirty days [1]',
        passed: true,
        status: 'grounded',
        citedChunkIds: ['refunds'],
        sources: ['corpus/refunds.md'],
      }),
    );
    expect(Object.hasOwn(result as Record<string, unknown>, 'prompt')).toBe(false);
    expect(Object.hasOwn(result as Record<string, unknown>, 'context')).toBe(false);

    const functionProvider = createCliAsyncRagAnswerCapability({
      async llm() {
        return 'Refunds are available within thirty days [1]';
      },
    }) as { answer: (call: { input: unknown }) => Promise<unknown> };

    await expect(functionProvider.answer({ input })).resolves.toEqual(expect.objectContaining({ passed: true }));
  });

  test('rag.answer rejects unsupported fields and ungrounded provider output', async () => {
    expect(() =>
      createCliAsyncRagAnswerCapability({ llm: {} as Parameters<typeof createCliAsyncRagAnswerCapability>[0]['llm'] }),
    ).toThrow(/llm\.complete async provider/u);

    const provider = createCliAsyncRagAnswerCapability({
      llm: createCliAsyncLlmCapability({ response: 'Unsupported refund details [1]' }),
    }) as { answer: (call: { input: unknown }) => Promise<unknown> };
    const input = {
      query: 'refund policy',
      chunks: [
        {
          id: 'refunds',
          text: 'Refunds are available within thirty days',
          score: 0.98,
          source: 'corpus/refunds.md',
          citation: { uri: 'corpus/refunds.md' },
        },
      ],
      requireCitations: true,
      minCitedChunks: 1,
      minGroundingCoverage: 0.85,
    };

    await expect(provider.answer({ input: { ...input, model: 'ignored' } })).rejects.toThrow(
      /input field 'model' is not supported/u,
    );
    await expect(provider.answer({ input: { ...input, chunks: [] } })).rejects.toThrow(/at least one retrieved chunk/u);
    await expect(
      provider.answer({ input: { ...input, chunks: new Array(1001).fill(input.chunks[0]) } }),
    ).rejects.toThrow(/at most 1000 chunks/u);
    await expect(
      provider.answer({ input: { ...input, chunks: [{ ...input.chunks[0], metadata: 'bad' }] } }),
    ).rejects.toThrow(/metadata' must be a record/u);
    await expect(provider.answer({ input })).rejects.toThrow(/RAG answer synthesis failed/u);

    const badCitationProvider = createCliAsyncRagAnswerCapability({
      llm: createCliAsyncLlmCapability({ response: 'Refunds are available within thirty days [99]' }),
    }) as { answer: (call: { input: unknown }) => Promise<unknown> };

    await expect(badCitationProvider.answer({ input })).rejects.toThrow(
      /RAG answer synthesis failed: .*between 1 and 1/u,
    );
  });

  test('OpenAI-compatible llm.complete sends a narrow chat completion request', async () => {
    let requestUrl = '';
    let requestBody: unknown;
    let authorization = '';
    let redirectPolicy: RequestRedirect | undefined;
    let signalWasProvided = false;
    const provider = createCliAsyncOpenAICompatibleLlmCapability({
      apiKey: 'test-secret',
      model: 'test-model',
      baseUrl: 'http://127.0.0.1:8123/v1',
      fetch: async (url, init) => {
        requestUrl = String(url);
        requestBody = JSON.parse(String(init?.body));
        authorization = new Headers(init?.headers).get('authorization') ?? '';
        redirectPolicy = init?.redirect;
        signalWasProvided = init?.signal instanceof AbortSignal;
        return Response.json({ choices: [{ message: { content: 'provider answer [1]' } }] });
      },
    }) as { complete: (call: { input: unknown }) => Promise<unknown> };

    const result = await provider.complete({ input: { prompt: 'hello provider' } });

    expect(result).toBe('provider answer [1]');
    expect(requestUrl).toBe('http://127.0.0.1:8123/v1/chat/completions');
    expect(requestBody).toEqual({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello provider' }],
      stream: false,
    });
    expect(authorization).toBe('Bearer test-secret');
    expect(redirectPolicy).toBe('error');
    expect(signalWasProvided).toBe(true);
  });

  test('OpenAI-compatible llm.complete allows local IPv6 development endpoints', async () => {
    let requestUrl = '';
    const provider = createCliAsyncOpenAICompatibleLlmCapability({
      apiKey: 'test-secret',
      model: 'test-model',
      baseUrl: 'http://[::1]:8123/v1',
      fetch: async (url) => {
        requestUrl = String(url);
        return Response.json({ choices: [{ message: { content: 'ok' } }] });
      },
    }) as { complete: (call: { input: unknown }) => Promise<unknown> };

    await expect(provider.complete({ input: { prompt: 'hello' } })).resolves.toBe('ok');
    expect(requestUrl).toBe('http://[::1]:8123/v1/chat/completions');
  });

  test('OpenAI-compatible llm.complete validates provider config and redacts provider errors', async () => {
    expect(() =>
      createCliAsyncOpenAICompatibleLlmCapability({
        apiKey: 'test-secret\nbad',
        model: 'test-model',
      }),
    ).toThrow(/must not contain line breaks/u);

    expect(() =>
      createCliAsyncOpenAICompatibleLlmCapability({
        apiKey: 'test-secret',
        model: 'test-model',
        baseUrl: 'https://user:pass@example.test/v1',
      }),
    ).toThrow(/must not include credentials/u);

    expect(() =>
      createCliAsyncOpenAICompatibleLlmCapability({
        apiKey: 'test-secret',
        model: 'test-model',
        baseUrl: 'http://example.test/v1',
      }),
    ).toThrow(/must be https/u);

    const provider = createCliAsyncOpenAICompatibleLlmCapability({
      apiKey: 'test/secret',
      model: 'test-model',
      fetch: async () => new Response('bad test%2Fsecret', { status: 500 }),
    }) as { complete: (call: { input: unknown }) => Promise<unknown> };

    await expect(provider.complete({ input: { prompt: 'hello' } })).rejects.toThrow(/bad \[redacted\]/u);
  });

  test('programmatic async execution rejects multiple llm.complete providers', async () => {
    await expect(
      executeKernSourceAsync(mainProgram([]), {
        llmResponse: 'deterministic',
        llmProvider: { apiKey: 'test-secret', model: 'test-model' },
      }),
    ).rejects.toThrow(/mutually exclusive/u);
  });

  test('OpenAI-compatible llm.complete fails closed on malformed provider responses', async () => {
    const provider = createCliAsyncOpenAICompatibleLlmCapability({
      apiKey: 'test-secret',
      model: 'test-model',
      fetch: async () => Response.json({ choices: [{ message: { content: 123 } }] }),
    }) as { complete: (call: { input: unknown }) => Promise<unknown> };

    await expect(provider.complete({ input: { prompt: 'hello' } })).rejects.toThrow(/choices\[0\]\.message\.content/u);
  });

  test('net.fetch normalizes allowed origins and disables redirects', async () => {
    let redirectPolicy: RequestRedirect | undefined;
    let signalWasProvided = false;
    const provider = createCliAsyncNetCapability({
      allowedOrigins: ['https://example.test/'],
      fetch: async (_url, init) => {
        redirectPolicy = init?.redirect;
        signalWasProvided = init?.signal instanceof AbortSignal;
        return new Response('ok', { status: 200 });
      },
    }) as { fetch: (call: { input: unknown }) => Promise<unknown> };

    const result = await provider.fetch({
      input: { url: 'https://example.test/resource' },
    });

    expect(result).toEqual(expect.objectContaining({ body: 'ok', ok: true, status: 200 }));
    expect(redirectPolicy).toBe('error');
    expect(signalWasProvided).toBe(true);
  });

  test('net.fetch rejects credentials and unsupported input fields', async () => {
    expect(() => createCliAsyncNetCapability({ allowedOrigins: ['https://user:pass@example.test'] })).toThrow(
      /must not include credentials/,
    );

    const provider = createCliAsyncNetCapability({
      allowedOrigins: ['https://example.test'],
      fetch: async () => new Response('ok', { status: 200 }),
    }) as { fetch: (call: { input: unknown }) => Promise<unknown> };

    await expect(
      provider.fetch({
        input: { url: 'https://user:pass@example.test/resource' },
      }),
    ).rejects.toThrow(/must not include credentials/);

    await expect(
      provider.fetch({
        input: { url: 'https://example.test/resource', headers: { authorization: 'secret' } },
      }),
    ).rejects.toThrow(/input field 'headers' is not supported/);
  });

  test('net.fetch streams async-iterable response body mocks with the same byte cap path', async () => {
    const provider = createCliAsyncNetCapability({
      allowedOrigins: ['https://example.test'],
      fetch: async () =>
        ({
          body: {
            async *[Symbol.asyncIterator]() {
              yield new TextEncoder().encode('mock-');
              yield 'body';
            },
          },
          ok: true,
          status: 200,
          url: 'https://example.test/resource',
        }) as Response,
    }) as { fetch: (call: { input: unknown }) => Promise<unknown> };

    const result = await provider.fetch({
      input: { url: 'https://example.test/resource' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        body: 'mock-body',
        ok: true,
        status: 200,
        url: 'https://example.test/resource',
      }),
    );
  });

  test('reports missing net and llm async providers before execution', () => {
    const file = writeFile(
      mainProgram([
        'capability namespace=net operation=fetch name=response input="{ url: \\"data:text/plain,hello\\" }"',
        'capability namespace=llm operation=complete name=answer input="{ prompt: \\"hello\\" }"',
      ]),
    );

    const result = runArgs(['run', '--async-preview', file]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('missing async providers: net.fetch');
    expect(result.stderr).toContain('llm.complete');
  });

  test('fails closed on missing OpenAI provider credentials during async execution', () => {
    const file = writeFile(
      mainProgram(['capability namespace=llm operation=complete name=answer input="{ prompt: \\"hello\\" }"']),
    );

    const result = runArgs(['run', '--async-preview', '--llm-provider', 'openai', '--llm-model', 'test-model', file], {
      env: { ...process.env, KERN_LLM_API_KEY: '', KERN_LLM_MODEL: '', KERN_LLM_BASE_URL: '' },
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('requires KERN_LLM_API_KEY');
  });

  test('fails closed on invalid OpenAI-compatible base URL during async execution', () => {
    const file = writeFile(
      mainProgram(['capability namespace=llm operation=complete name=answer input="{ prompt: \\"hello\\" }"']),
    );

    const result = runArgs(
      [
        'run',
        '--async-preview',
        '--llm-provider',
        'openai',
        '--llm-model',
        'test-model',
        '--llm-base-url',
        'http://example.test/v1',
        file,
      ],
      { env: { ...process.env, KERN_LLM_API_KEY: 'test-secret', KERN_LLM_MODEL: '', KERN_LLM_BASE_URL: '' } },
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('base URL must be https: unless it targets localhost');
  });

  test('denies net.fetch origins that were not explicitly allowed without replaying partial stdout', () => {
    const file = writeFile(
      mainProgram([
        'print value="\\"before\\""',
        'capability namespace=net operation=fetch name=response input="{ url: \\"data:text/plain,blocked\\" }"',
        'print value="response.body"',
      ]),
    );

    const result = runArgs(['run', '--async-preview', '--allow-net', 'https://example.test', file]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("origin 'data:' is not allowed");
  });

  test('denies net.fetch GET bodies and unsupported protocols without replaying partial stdout', () => {
    const getBody = runArgs([
      'run',
      '--async-preview',
      '--allow-net',
      'data:',
      writeFile(
        mainProgram([
          'print value="\\"before\\""',
          'capability namespace=net operation=fetch name=response input="{ url: \\"data:text/plain,blocked\\", body: \\"x\\" }"',
        ]),
      ),
    ]);
    expect(getBody.status).toBe(2);
    expect(getBody.stdout).toBe('');
    expect(getBody.stderr).toContain('GET requests cannot carry a body');

    const unsupportedProtocol = runArgs([
      'run',
      '--async-preview',
      '--allow-net',
      'data:',
      writeFile(
        mainProgram([
          'print value="\\"before\\""',
          'capability namespace=net operation=fetch name=response input="{ url: \\"file:///etc/passwd\\" }"',
        ]),
      ),
    ]);
    expect(unsupportedProtocol.status).toBe(2);
    expect(unsupportedProtocol.stdout).toBe('');
    expect(unsupportedProtocol.stderr).toContain('protocol must be http:, https:, or data:');
  });

  test('requires explicit async preview provider flags', () => {
    const file = writeFile(mainProgram([]));

    const flagWithoutPreview = runArgs(['run', '--fs-root', dir, file]);
    expect(flagWithoutPreview.status).toBe(2);
    expect(flagWithoutPreview.stdout).toBe('');
    expect(flagWithoutPreview.stderr).toContain('Usage: kern run');

    const writeRootWithoutReadRoot = runArgs(['run', '--async-preview', '--fs-write-root', dir, file]);
    expect(writeRootWithoutReadRoot.status).toBe(2);
    expect(writeRootWithoutReadRoot.stdout).toBe('');
    expect(writeRootWithoutReadRoot.stderr).toContain('Usage: kern run');

    const netFlagWithoutPreview = runArgs(['run', '--allow-net', 'data:', file]);
    expect(netFlagWithoutPreview.status).toBe(2);
    expect(netFlagWithoutPreview.stdout).toBe('');
    expect(netFlagWithoutPreview.stderr).toContain('Usage: kern run');
  });
});

// ── FAIL-CLOSE ATOMICITY: abstain produces NO stdout, exit 2 ──────────────────
describe('kern run — abstains atomically on non-portable ops (exit 2, no stdout)', () => {
  test('a non-integer float print abstains with no output', () => {
    const r = runProgram(['print value="3 / 2"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
    expect(r.stderr).not.toBe('');
  });

  test('ATOMICITY: a later abstaining print suppresses ALL prior stdout', () => {
    // The "1" must NOT leak: render only happens after the whole body succeeds.
    const r = runProgram(['print value="1"', 'print value="3 / 2"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('an unsafe integer (>2^53) abstains (JS/Python disagree)', () => {
    const r = runProgram(['print value="9007199254740993"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('whole-array print abstains (the array now BINDS; printing it is deferred)', () => {
    // Slice-2a binds the array literal, but printing a WHOLE array is deferred
    // (the `print` contract fail-closes arrays — and a lossy comma-join is a
    // later rendering decision). So `print xs` abstains -> exit 2, no stdout.
    const r = runProgram(['let name=xs value="[1, 2, 3]"', 'print value="xs"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('OUT-OF-BOUNDS index abstains (TS undefined vs Py IndexError)', () => {
    // In-bounds index now runs (see the happy-path ARRAY INDEX tests above); an
    // OOB read stays fenced because the emitter legs diverge.
    const r = runProgram(['let name=xs value="[1,2,3]"', 'print value="xs[5]"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('NEGATIVE index abstains (TS undefined vs Py wraps to last element)', () => {
    const r = runProgram(['let name=xs value="[1,2,3]"', 'print value="xs[-1]"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('FLOAT-literal index abstains (Python list indices must be int)', () => {
    // ref + TS would read xs[1] (1.0 === 1) but Python `xs[1.0]` raises TypeError,
    // so the runner fences float-source indices. Verified on real node + python3.
    const r = runProgram(['let name=xs value="[10,20,30]"', 'print value="xs[1.0]"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('a dynamic (variable) index abstains (deferred — needs integer provenance)', () => {
    const r = runProgram(['let name=xs value="[10,20,30]"', 'let name=j value="1"', 'print value="xs[j]"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  // Milestone 5.1b — `+`/`-` between two safe-integer literals now certifies
  // (see isIntProvenancedExpr's exact-IEEE-754 no-divergence argument in
  // portable-scalar.ts). This test used to assert `xs[1 + 1]` abstained; `*`
  // stays out of the provenanced-arithmetic domain and still abstains.
  test('ARITHMETIC (+) between two literals now certifies: `xs[1 + 1]`', () => {
    const r = runProgram(['let name=xs value="[10,20,30]"', 'print value="xs[1 + 1]"']);
    expect(r.stdout).toBe('30\n');
    expect(r.status).toBe(0);
  });

  test('MULTIPLICATION index still abstains (`*` is excluded from the arithmetic domain)', () => {
    // integer `%` diverges by sign and `*`/`/` are excluded from
    // isIntProvenancedExpr; only `+`/`-` are proven divergence-free.
    const r = runProgram(['let name=xs value="[10,20,30]"', 'print value="xs[1 * 2]"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('a float ELEMENT abstains when iterated/printed (print float fails closed)', () => {
    const r = runProgram(['let name=xs value="[1.5]"', 'each name=x in=xs', '  print value="x"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('STRING `.length` abstains (JS UTF-16 units vs Python code points)', () => {
    // ASCII happens to agree, but the runner rule is arrays-only: a string
    // receiver fails closed so an astral case can never silently diverge.
    const r = runProgram(['let name=s value="\\"hello\\""', 'print value="s.length"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('a missing record field abstains', () => {
    const r = runProgram(['let name=user value="{ name: \\"Ada\\" }"', 'print value="user.missing"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('nested records abstain', () => {
    const r = runProgram(['let name=user value="{ profile: { name: \\"Ada\\" } }"', 'print value="user.profile"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('record fields with array values abstain', () => {
    const r = runProgram(['let name=user value="{ scores: [1,2,3] }"', 'print value="user.scores"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('ASTRAL string `.length` abstains (the real divergence: JS 2 vs Python 1)', () => {
    const r = runProgram(['let name=s value="\\"😀\\""', 'print value="s.length"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('OPTIONAL `xs?.length` abstains (outside the portable domain)', () => {
    const r = runProgram(['let name=xs value="[1,2,3]"', 'print value="xs?.length"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test("COMPUTED `xs['length']` abstains (a string-literal index is not certified)", () => {
    const r = runProgram(['let name=xs value="[1,2,3]"', 'print value="xs[\'length\']"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('a NON-`length` member on an array (`xs.foo`) abstains', () => {
    const r = runProgram(['let name=xs value="[1,2,3]"', 'print value="xs.foo"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('ATOMICITY: an OUT-OF-BOUNDS for-counter iteration suppresses ALL prior stdout', () => {
    // for i in 0..5 over a length-3 array: at i=3 TS reads undefined, Python raises.
    // The 10/20/30 from i=0..2 must NOT leak — the whole program abstains.
    const r = runProgram(['let name=xs value="[10,20,30]"', 'for name=i from="0" to="5"', '  print value="xs[i]"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('a NEGATIVE for-counter (reverse past 0) abstains', () => {
    const r = runProgram([
      'let name=xs value="[10,20,30]"',
      'for name=i from="2" to="-2" step="-1"',
      '  print value="xs[i]"',
    ]);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  // Milestone 5.1b — `xs[i + 1]` (a for-counter plus a literal offset) now
  // certifies; this was the exact restriction the task lifts. `*` on the
  // counter is covered separately above and still abstains.
  test('ARITHMETIC (+) on a for-counter index (`xs[i + 1]`) now certifies', () => {
    const r = runProgram(['let name=xs value="[10,20,30]"', 'for name=i from="0" to="2"', '  print value="xs[i + 1]"']);
    expect(r.stdout).toBe('20\n30\n');
    expect(r.status).toBe(0);
  });

  test('a NON-counter (plain let) index abstains even when in-bounds', () => {
    const r = runProgram(['let name=xs value="[10,20,30]"', 'let name=j value="4 / 2"', 'print value="xs[j]"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('ATOMICITY: a side-effecting helper call suppresses helper stdout and prior main stdout', () => {
    const source = [
      'fn name=noisy returns=number',
      '  handler lang="kern"',
      '    print value="\\"hidden\\""',
      '    return value="1"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="\\"before\\""',
      '    print value="noisy()"',
    ].join('\n');
    const r = runFile(writeFile(source));
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
    expect(r.stderr).not.toBe('');
  });

  test('ATOMICITY: an uncaught explicit throw suppresses prior stdout', () => {
    const r = runProgram(['print value="\\"before\\""', 'throw value="new Error(\\"boom\\")"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
    expect(r.stderr).not.toBe('');
    expect(r.stderr.toLowerCase()).toContain('uncaught');
  });

  test('a non-canonical bare throw abstains', () => {
    const r = runProgram(['throw value="\\"raw\\""']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
    expect(r.stderr).not.toBe('');
  });

  test('a value return from void main abstains and suppresses prior stdout', () => {
    const r = runProgram(['print value="\\"before\\""', 'return value="1"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
    expect(r.stderr).not.toBe('');
    expect(r.stderr.toLowerCase()).toContain('return');
  });

  test('a non-canonical throw inside try/catch abstains instead of being caught', () => {
    const r = runProgram([
      'try',
      '  print value="\\"before\\""',
      '  throw value="\\"raw\\""',
      '  catch name=e',
      '    print value="e.message"',
    ]);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
    expect(r.stderr).not.toBe('');
  });

  test('try body return with a catch abstains and suppresses prior stdout', () => {
    const r = runProgram([
      'try',
      '  print value="\\"before\\""',
      '  return',
      '  catch name=e',
      '    print value="\\"caught\\""',
    ]);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
    expect(r.stderr).not.toBe('');
  });

  test('a catch name hides same-named outer bindings from finally and fails closed', () => {
    const r = runProgram([
      'let name=e value="{ message: \\"outer\\" }"',
      'try',
      '  throw value="new Error(\\"boom\\")"',
      '  catch name=e',
      '    print value="e.message"',
      '  finally',
      '    print value="e.message"',
    ]);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
    expect(r.stderr).not.toBe('');
  });

  test('an unprovided runner capability call fails closed because the CLI provides no matching host capability', () => {
    const r = runProgram([
      'capability namespace=llm operation=complete name=text input="{ prompt: \\"hello\\" }"',
      'print value="text"',
    ]);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('llm.complete');
  });
});

// ── ENTRY RESOLUTION: deterministic diagnostics, exit 2, no stdout ────────────
describe('kern run — strict entry resolution (exit 2, diagnostic on stderr)', () => {
  test('no fn main -> diagnostic, not a crash', () => {
    const source = ['fn name=other returns=void', '  handler lang="kern"', '    print value="1"'].join('\n');
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
    expect(r.stderr.toLowerCase()).toContain('main');
  });

  test('duplicate fn main -> rejected (no first-wins)', () => {
    const source = [
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="1"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="2"',
    ].join('\n');
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
  });

  test('main with params -> rejected in slice-1', () => {
    const source = ['fn name=main params="x:number" returns=void', '  handler lang="kern"', '    print value="1"'].join(
      '\n',
    );
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
  });

  test('main with param children -> rejected in slice-1', () => {
    const source = [
      'fn name=main returns=void',
      '  param name=x type=number',
      '  handler lang="kern"',
      '    print value="x"',
    ].join('\n');
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
  });

  test('main returns a non-void type -> rejected in slice-1', () => {
    const source = ['fn name=main returns=number', '  handler lang="kern"', '    return value="1"'].join('\n');
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
  });

  test('main whose handler is foreign (lang=ts) -> rejected', () => {
    const source = ['fn name=main returns=void', '  handler lang="ts"', '    print value="1"'].join('\n');
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
  });

  test('async main -> rejected in slice-1', () => {
    const source = ['fn name=main async=true returns=void', '  handler lang="kern"', '    print value="1"'].join('\n');
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
  });

  // (zero kern handlers is exercised by the foreign-handler case above — main with
  // only a `lang=ts` handler resolves to zero kern handlers and is rejected.)
  test('main with two kern handlers -> rejected (no first-handler-wins)', () => {
    const source = [
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="1"',
      '  handler lang="kern"',
      '    print value="2"',
    ].join('\n');
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
  });
});

// ── FILE / PARSE FAILURES ────────────────────────────────────────────────────
describe('kern run — file + parse failures (exit 2, no stdout)', () => {
  test('a parse error fails closed', () => {
    const r = runFile(writeFile('fn name=main returns=void\n  handler lang="kern"\n    print value='));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
  });

  test('a nonexistent file is a clean diagnostic, not a stack trace', () => {
    const r = runFile(join(dir, 'does-not-exist.kern'));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
  });
});
