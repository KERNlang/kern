import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  projectKernModules,
  verifyKernProjection,
} from '../../packages/core/dist/frontend-projection.js';
import {
  KERN_KIR_JS_ESM_COMPILER_FORMAT,
  compileKernKirToJavaScriptEsm,
} from '../../packages/core/dist/compiler-kir-js-esm.js';
import {
  KERN_KIR_PYTHON_COMPILER_FORMAT,
  compileKernKirToPython,
} from '../../packages/core/dist/compiler-kir-python.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = resolve(ROOT, 'packages/cli/dist/cli.js');
const OWNER = resolve(ROOT, 'packages/cli/src/kir-shadow/owner.ts');
const SHADOW_ROOT = resolve(ROOT, 'packages/cli/src/kir-shadow');
const COMPILE = resolve(ROOT, 'packages/cli/src/commands/compile.ts');
const RUN = resolve(ROOT, 'packages/cli/src/commands/run.ts');
const ARGUMENTS = resolve(ROOT, 'packages/cli/src/kir-shadow/arguments.ts');
const CHILD_EXECUTION = resolve(ROOT, 'packages/cli/src/kir-shadow/child-execution.ts');
const NORMALIZE = resolve(ROOT, 'packages/cli/src/kir-shadow/normalize.ts');
const PROJECTION_INPUT = resolve(ROOT, 'packages/cli/src/kir-shadow/projection-input.ts');
const RUN_REPORT = resolve(ROOT, 'packages/cli/src/kir-shadow/run-report.ts');

const LIMITS = Object.freeze({
  maxBytes: 100_000,
  maxCollectionLength: 100,
  maxDepth: 20,
  maxDiagnostics: 10,
  maxEvents: 10,
  maxIterations: 100,
  maxSteps: 10_000,
  maxStringBytes: 10_000,
});

const PROGRAM = [
  'fn name=main export=true returns=string',
  '  handler lang=kern',
  '    print value="\\"hello\\""',
  '    return value="\\"hello\\""',
  '',
].join('\n');

function source(path) {
  return readFileSync(path, 'utf8');
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}

async function directCompilation(program, moduleId = 'main.kern', handlerName = 'main') {
  const projectionRequest = { modules: [{ moduleId, source: program }] };
  const projected = await projectKernModules(projectionRequest);
  assert.equal(projected.status, 'projected');
  const verified = await verifyKernProjection(projectionRequest, projected);
  const entry = { handlerName, moduleId };
  const javascriptEsm = compileKernKirToJavaScriptEsm(verified, {
    entry,
    format: KERN_KIR_JS_ESM_COMPILER_FORMAT,
    limits: LIMITS,
  });
  const python = compileKernKirToPython(verified, {
    entry,
    format: KERN_KIR_PYTHON_COMPILER_FORMAT,
    limits: LIMITS,
  });
  assert.equal(javascriptEsm.outcome, 'success');
  assert.equal(python.outcome, 'success');
  return { javascriptEsm, projected, python };
}

function command(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    timeout: 20_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, stderr: result.stderr ?? '', stdout: result.stdout ?? '' };
}

function parseReport(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    assert.fail(`CLI_KIR_SHADOW_REPORT_MISSING: expected JSON report, received ${result.stdout}`);
  }
  assert.deepEqual(Object.keys(output).sort(), ['command', 'format', 'outcome', 'report']);
  assert.equal(output.format, 'kern.cli.kir-shadow.v1');
  assert.equal(output.outcome, 'match');
  return output.report;
}

function requireBuiltCli() {
  assert.ok(existsSync(OWNER), `CLI_KIR_SHADOW_OWNER_MISSING: expected ${OWNER}`);
  assert.ok(existsSync(CLI), `CLI_KIR_SHADOW_BUILD_MISSING: expected ${CLI}`);
}

test('KERN 5 CLI shadow has one focused owner and compile/run delegate to it', () => {
  assert.ok(existsSync(OWNER), `CLI_KIR_SHADOW_OWNER_MISSING: expected ${OWNER}`);
  const owner = source(OWNER);
  const closureFiles = sourceFiles(SHADOW_ROOT);
  const closure = closureFiles.map((path) => source(path)).join('\n');
  assert.match(owner, /KERN_CLI_KIR_SHADOW_OWNER\s*=\s*['"]kern\.cli\.kir-shadow\.owner\.v1['"]/u);
  assert.equal(
    closureFiles.filter((path) => /KERN_CLI_KIR_SHADOW_OWNER\s*=/.test(source(path))).length,
    1,
    'the kir-shadow closure must contain exactly one owner marker',
  );
  assert.match(source(COMPILE), /from ['"]\.\.\/kir-shadow\/owner\.js['"]/u);
  assert.match(source(RUN), /from ['"]\.\.\/kir-shadow\/owner\.js['"]/u);
  assert.doesNotMatch(
    closure,
    /(?:executeKernSource|ReferenceRunner|transpileAndWrite|parseDocument|parseExpression|parseWithDiagnostics|@kernlang\/core\/runner|from ['"]@kernlang\/core['"])/u,
    'the full KIR-shadow closure may consume only packaged projection, RT-1, and target compiler contracts',
  );
  for (const ownerImport of [
    '@kernlang/core/frontend-projection',
    '@kernlang/core/runtime/kir',
    '@kernlang/core/compiler/kir-js-esm',
    '@kernlang/core/compiler/kir-python',
  ]) assert.match(closure, new RegExp(ownerImport.replaceAll('/', '\\/')));
});

test('shadow admission diagnostics cannot inject control characters into stderr', () => {
  requireBuiltCli();
  const directory = mkdtempSync(resolve(tmpdir(), 'kern-cli-kir-shadow-escape-'));
  try {
    const input = resolve(directory, 'main.kern');
    writeFileSync(input, PROGRAM);
    const injected = '--not-admitted\nFORGED\u001b[31m';
    const result = command(['run', input, '--kir-shadow', '--kir-shadow-entry', 'main.kern#main', injected]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes('\u001b'), false);
    assert.equal(result.stderr.includes('\nFORGED'), false);
    assert.match(result.stderr, /\\u000a/u);

    const boundaryOption = `--${'x'.repeat(436)}é`;
    const boundary = command([
      'run',
      input,
      '--kir-shadow',
      '--kir-shadow-entry',
      'main.kern#main',
      boundaryOption,
    ]);
    assert.equal(boundary.status, 2);
    assert.ok(Buffer.byteLength(boundary.stderr) <= 480);
    assert.equal(boundary.stderr.includes('\uFFFD'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('shadow source loading uses one descriptor with fstat and bounded reads', () => {
  const implementation = source(PROJECTION_INPUT);
  assert.match(implementation, /openSync/u);
  assert.match(implementation, /fstatSync/u);
  assert.match(implementation, /readSync/u);
  assert.doesNotMatch(implementation, /\bstatSync\b|\breadFileSync\b/u);
});

test('shadow normalization derives every response bound from KIR_SHADOW_LIMITS', () => {
  const implementation = source(NORMALIZE);
  assert.match(implementation, /KIR_SHADOW_LIMITS/u);
  for (const field of ['maxDepth', 'maxCollectionLength', 'maxDiagnostics', 'maxEvents']) {
    assert.match(implementation, new RegExp(`KIR_SHADOW_LIMITS\\.${field}`, 'u'));
  }
  assert.match(implementation, /depth > KIR_SHADOW_LIMITS\.maxDepth/u);
  assert.doesNotMatch(implementation, /depth > 20|length > 100|length > 10/u);
});

test('shadow option detection is exact and preserves the normal route for option values', () => {
  const implementation = source(ARGUMENTS);
  assert.doesNotMatch(implementation, /startsWith\('--kir-shadow'\)/u);
  assert.match(implementation, /arg === '--kir-shadow'/u);
  assert.match(implementation, /arg === '--kir-shadow-entry'/u);
});

test('shadow runtime compares all three normalized execution envelopes and enforces Python 3.12', () => {
  assert.match(source(RUN_REPORT), /isDeepStrictEqual\(rt1, javascriptEsm\) && isDeepStrictEqual\(rt1, python\)/u);
  assert.match(source(CHILD_EXECUTION), /version\[1\].*< 12/u);
  assert.match(source(CHILD_EXECUTION), /--experimental-permission/u);
  assert.match(source(CHILD_EXECUTION), /sys\.addaudithook/u);
  assert.match(source(CHILD_EXECUTION), /os\.posix_spawn/u);
  assert.doesNotMatch(source(CHILD_EXECUTION), /os\.spawn["']/u);
});

test('shadow child warnings do not turn successful executions into unavailable reports', () => {
  requireBuiltCli();
  const directory = mkdtempSync(resolve(tmpdir(), 'kern-cli-kir-shadow-warning-'));
  try {
    const input = resolve(directory, 'main.kern');
    writeFileSync(input, PROGRAM);
    const pythonProbe = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
    assert.equal(pythonProbe.status, 0, pythonProbe.stderr);
    const pythonPath = pythonProbe.stdout.trim();
    const wrapper = resolve(directory, 'python-warning');
    writeFileSync(wrapper, `#!/bin/sh\nprintf "child warning\\n" >&2\nexec ${pythonPath} "$@"\n`);
    chmodSync(wrapper, 0o755);
    const result = command(['run', input, '--kir-shadow', '--kir-shadow-entry', 'main.kern#main'], {
      env: { KERN_PYTHON: wrapper },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = parseReport(result);
    assert.equal(report.executions.python.normalized.outcome, 'success');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a shadow-looking option value does not activate the shadow route', () => {
  requireBuiltCli();
  const directory = mkdtempSync(resolve(tmpdir(), 'kern-cli-kir-shadow-option-value-'));
  try {
    const input = resolve(directory, 'main.kern');
    writeFileSync(input, PROGRAM);
    const result = command(['run', input, '--llm-response', '--kir-shadow']);
    assert.doesNotMatch(result.stdout, /kern\.cli\.kir-shadow\.v1/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('normal run remains on its default route without shadow activation', () => {
  requireBuiltCli();
  const directory = mkdtempSync(resolve(tmpdir(), 'kern-cli-kir-shadow-default-'));
  try {
    const input = resolve(directory, 'main.kern');
    writeFileSync(input, ['fn name=main returns=void', '  handler lang=kern', ''].join('\n'));
    const result = command(['run', input]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /kern\.cli\.kir-shadow\.v1/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('compile KIR shadow projects real source and reports the exact package-owned deterministic artifacts without writes', async () => {
  requireBuiltCli();
  const directory = mkdtempSync(resolve(tmpdir(), 'kern-cli-kir-shadow-'));
  try {
    const input = resolve(directory, 'main.kern');
    const outDir = resolve(directory, 'generated');
    writeFileSync(input, PROGRAM);
    const result = command([
      'compile',
      input,
      `--outdir=${outDir}`,
      '--kir-shadow',
      '--kir-shadow-entry',
      'main.kern#main',
    ]);
    const report = parseReport(result);
    const direct = await directCompilation(PROGRAM);
    assert.deepEqual(Object.keys(report).sort(), ['entry', 'projection', 'targets']);
    assert.deepEqual(report.entry, { handlerName: 'main', moduleId: 'main.kern' });
    assert.equal(report.projection.status, 'projected');
    assert.equal(report.projection.artifactSha256, direct.projected.receipt.artifactDigest);
    assert.deepEqual(Object.keys(report.targets).sort(), ['javascriptEsm', 'python']);
    for (const target of Object.values(report.targets)) {
      assert.equal(target.outcome, 'success');
      assert.equal(target.deterministic, true);
      assert.match(target.artifact.sha256, /^[a-f0-9]{64}$/u);
      assert.match(target.manifest.sha256, /^[a-f0-9]{64}$/u);
      assert.equal(typeof target.manifest.value, 'object');
    }
    assert.deepEqual(Object.keys(report.targets.javascriptEsm.manifest.value).sort(), [
      'artifact',
      'artifactFormat',
      'canonicalization',
      'compilerFormat',
      'compilerRequestSha256',
      'entry',
      'hashAlgorithm',
      'hostProfile',
      'kernelSha256',
      'linkedProgramSha256',
      'projectionArtifactSha256',
      'runtimeFormat',
    ]);
    assert.deepEqual(Object.keys(report.targets.python.manifest.value).sort(), Object.keys(report.targets.javascriptEsm.manifest.value).sort());
    for (const [name, compiled] of [
      ['javascriptEsm', direct.javascriptEsm],
      ['python', direct.python],
    ]) {
      assert.equal(report.targets[name].artifact.sha256, compiled.artifact.sha256);
      assert.equal(report.targets[name].manifest.sha256, compiled.manifest.sha256);
      assert.deepEqual(report.targets[name].manifest.value, JSON.parse(new TextDecoder().decode(compiled.manifest.bytes)));
    }
    assert.equal(existsSync(outDir), false, 'shadow compilation must not create the requested output directory');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('run KIR shadow compares RT-1, isolated emitted JavaScript, and isolated emitted Python without replaying program stdout', () => {
  requireBuiltCli();
  const directory = mkdtempSync(resolve(tmpdir(), 'kern-cli-kir-shadow-run-'));
  try {
    const input = resolve(directory, 'main.kern');
    writeFileSync(input, PROGRAM);
    const result = command(['run', input, '--kir-shadow', '--kir-shadow-entry', 'main.kern#main']);
    const report = parseReport(result);
    assert.deepEqual(Object.keys(report).sort(), ['entry', 'executions', 'projection']);
    assert.deepEqual(report.entry, { handlerName: 'main', moduleId: 'main.kern' });
    assert.equal(report.projection.status, 'projected');
    assert.deepEqual(Object.keys(report.executions).sort(), ['javascriptEsm', 'python', 'rt1']);
    const normalized = report.executions.rt1.normalized;
    assert.deepEqual(report.executions.javascriptEsm.normalized, normalized);
    assert.deepEqual(report.executions.python.normalized, normalized);
    assert.equal(normalized.outcome, 'success');
    assert.deepEqual(normalized.events, [{ op: 'stdout', text: 'hello' }]);
    assert.equal(result.stdout.includes('hello\n'), false, 'program stdout is report data, never CLI replay in shadow mode');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('run KIR shadow result is source-sensitive and cannot be satisfied by a fixed hello stub', () => {
  requireBuiltCli();
  const directory = mkdtempSync(resolve(tmpdir(), 'kern-cli-kir-shadow-sensitive-'));
  try {
    const token = `shadow-${process.pid}-${Date.now()}`;
    const input = resolve(directory, 'variant.kern');
    writeFileSync(input, [
      'fn name=observe export=true returns=string',
      '  handler lang=kern',
      `    print value="\\"${token}\\""`,
      `    return value="\\"${token}\\""`,
      '',
    ].join('\n'));
    const result = command(['run', input, '--kir-shadow', '--kir-shadow-entry', 'variant.kern#observe']);
    const report = parseReport(result);
    assert.deepEqual(report.executions.rt1.normalized.events, [{ op: 'stdout', text: token }]);
    assert.deepEqual(report.executions.rt1.normalized.result, {
      presence: 'value',
      value: { tag: 'text', value: token },
    });
    assert.equal(result.stdout.includes(`${token}\n`), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('KIR shadow rejects excluded inputs atomically and never falls back to legacy compile or run', () => {
  requireBuiltCli();
  const directory = mkdtempSync(resolve(tmpdir(), 'kern-cli-kir-shadow-reject-'));
  try {
    const cases = [
      ['missing entry', ['run', resolve(directory, 'plain.kern'), '--kir-shadow']],
      ['duplicate activation', ['run', resolve(directory, 'plain.kern'), '--kir-shadow', '--kir-shadow', '--kir-shadow-entry', 'plain.kern#main']],
      ['malformed activation', ['run', resolve(directory, 'plain.kern'), '--kir-shadow=true', '--kir-shadow-entry', 'plain.kern#main']],
      ['legacy run flag', ['run', resolve(directory, 'plain.kern'), '--kir-shadow', '--kir-shadow-entry', 'plain.kern#main', '--iteration-budget', '10']],
      ['legacy compile flag', ['compile', resolve(directory, 'plain.kern'), '--kir-shadow', '--kir-shadow-entry', 'plain.kern#main', '--target', 'lib']],
      ['directory', ['run', directory, '--kir-shadow', '--kir-shadow-entry', 'plain.kern#main']],
      ['module mismatch', ['run', resolve(directory, 'plain.kern'), '--kir-shadow', '--kir-shadow-entry', 'other.kern#main']],
      ['parameter', ['run', resolve(directory, 'parameter.kern'), '--kir-shadow', '--kir-shadow-entry', 'parameter.kern#main']],
      ['capability', ['run', resolve(directory, 'capability.kern'), '--kir-shadow', '--kir-shadow-entry', 'capability.kern#main']],
      ['file capability', ['run', resolve(directory, 'file-capability.kern'), '--kir-shadow', '--kir-shadow-entry', 'file-capability.kern#main']],
      ['import', ['run', resolve(directory, 'import.kern'), '--kir-shadow', '--kir-shadow-entry', 'import.kern#main']],
      ['malformed entry value', ['run', resolve(directory, 'plain.kern'), '--kir-shadow', '--kir-shadow-entry', '--kir-shadow']],
      ['invalid UTF-8', ['run', resolve(directory, 'invalid.kern'), '--kir-shadow', '--kir-shadow-entry', 'invalid.kern#main']],
      ['multiline import', ['run', resolve(directory, 'multiline-import.kern'), '--kir-shadow', '--kir-shadow-entry', 'multiline-import.kern#main']],
      ['duplicate KERN handlers', ['run', resolve(directory, 'duplicate-handler.kern'), '--kir-shadow', '--kir-shadow-entry', 'duplicate-handler.kern#main']],
    ];
    writeFileSync(resolve(directory, 'plain.kern'), PROGRAM);
    writeFileSync(resolve(directory, 'parameter.kern'), [
      'fn name=main export=true returns=string',
      '  param name=value type=string',
      '  handler lang=kern',
      '    return value="value"',
      '',
    ].join('\n'));
    writeFileSync(resolve(directory, 'capability.kern'), [
      'fn name=main export=true returns=string',
      '  handler lang=kern',
      '    capability namespace=fixture operation=get name=value',
      '    return value="value"',
      '',
    ].join('\n'));
    writeFileSync(resolve(directory, 'file-capability.kern'), [
      'fn name=helper export=false returns=string',
      '  handler lang=kern',
      '    capability namespace=fixture operation=get name=value',
      '    return value="value"',
      '',
      ...PROGRAM.split('\n'),
    ].join('\n'));
    writeFileSync(resolve(directory, 'import.kern'), [
      'use path="./helper"',
      '  from name=helper kind=fn as=helper',
      ...PROGRAM.split('\n'),
    ].join('\n'));
    writeFileSync(resolve(directory, 'invalid.kern'), Buffer.from([0x66, 0x6e, 0x20, 0xff]));
    writeFileSync(resolve(directory, 'multiline-import.kern'), [
      'fn name=helper export=false returns=string',
      '  handler lang=kern',
      '    return value="helper"',
      'use path="./helper"',
      ...PROGRAM.split('\n'),
    ].join('\n'));
    writeFileSync(resolve(directory, 'duplicate-handler.kern'), [
      'fn name=main export=true returns=string',
      '  handler lang=kern',
      '    return value="first"',
      '  handler lang=kern',
      '    return value="second"',
      '',
    ].join('\n'));
    for (const [label, args] of cases) {
      const result = command(args);
      assert.equal(result.status, 2, `${label}: ${result.stderr || result.stdout}`);
      assert.equal(result.stdout, '', `${label}: admission failures must be atomic stderr errors`);
      assert.ok(result.stderr.length > 0 && result.stderr.length <= 512, `${label}: stderr must be non-empty and bounded`);
    }
    assert.deepEqual(readdirSync(directory).sort(), [
      'capability.kern',
      'duplicate-handler.kern',
      'file-capability.kern',
      'import.kern',
      'invalid.kern',
      'multiline-import.kern',
      'parameter.kern',
      'plain.kern',
    ]);
    for (const path of readdirSync(directory).map((name) => resolve(directory, name))) assert.equal(statSync(path).isFile(), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('KIR shadow operational failures stay report-shaped and never fall back', () => {
  requireBuiltCli();
  const directory = mkdtempSync(resolve(tmpdir(), 'kern-cli-kir-shadow-unavailable-'));
  try {
    const input = resolve(directory, 'main.kern');
    writeFileSync(input, PROGRAM);
    const missingPython = command(['run', input, '--kir-shadow', '--kir-shadow-entry', 'main.kern#main'], {
      env: { KERN_PYTHON: resolve(directory, 'missing-python') },
    });
    assert.equal(missingPython.status, 2);
    assert.equal(missingPython.stderr, '');
    const missingPythonReport = JSON.parse(missingPython.stdout);
    assert.equal(missingPythonReport.outcome, 'unavailable');
    assert.equal(missingPythonReport.report.error.code, 'python-host-unavailable');
    assert.equal(missingPythonReport.report.projection.status, 'projected');
    assert.match(missingPythonReport.report.projection.artifactSha256, /^[a-f0-9]{64}$/u);

    const unsupported = resolve(directory, 'unsupported.kern');
    writeFileSync(unsupported, [
      'fn name=main export=true returns=string',
      '  handler lang=kern',
      '    let name=bad value="Json.stringify"',
      '    return value="bad"',
      '',
    ].join('\n'));
    const unsupportedResult = command([
      'compile',
      unsupported,
      '--kir-shadow',
      '--kir-shadow-entry',
      'unsupported.kern#main',
    ]);
    assert.equal(unsupportedResult.status, 2);
    assert.equal(unsupportedResult.stderr, '');
    const unsupportedReport = JSON.parse(unsupportedResult.stdout);
    assert.equal(unsupportedReport.outcome, 'unavailable');
    assert.equal(unsupportedReport.report.error.code, 'handler-entry-unsupported');
    assert.equal(unsupportedReport.report.projection.status, 'projected');
    assert.match(unsupportedReport.report.projection.artifactSha256, /^[a-f0-9]{64}$/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('kir-shadow entry without activation is rejected instead of changing a default command route', () => {
  requireBuiltCli();
  const directory = mkdtempSync(resolve(tmpdir(), 'kern-cli-kir-shadow-opt-in-'));
  try {
    const input = resolve(directory, 'main.kern');
    writeFileSync(input, PROGRAM);
    for (const name of ['compile', 'run']) {
      const result = command([name, input, '--kir-shadow-entry', 'main.kern#main']);
      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
