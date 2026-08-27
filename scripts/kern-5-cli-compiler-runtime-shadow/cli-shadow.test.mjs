import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = resolve(ROOT, 'packages/cli/dist/cli.js');
const OWNER = resolve(ROOT, 'packages/cli/src/kir-shadow/owner.ts');
const COMPILE = resolve(ROOT, 'packages/cli/src/commands/compile.ts');
const RUN = resolve(ROOT, 'packages/cli/src/commands/run.ts');

const PROGRAM = [
  'fn name=main export=true returns=string',
  '  handler lang=kern',
  '    print value="hello"',
  '    return value="hello"',
  '',
].join('\n');

function source(path) {
  return readFileSync(path, 'utf8');
}

function command(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, stderr: result.stderr ?? '', stdout: result.stdout ?? '' };
}

function parseReport(result) {
  assert.equal(result.status, 0, result.stderr);
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

test('KERN 5 CLI shadow has one focused owner and compile/run delegate to it', () => {
  assert.ok(existsSync(OWNER), `CLI_KIR_SHADOW_OWNER_MISSING: expected ${OWNER}`);
  const owner = source(OWNER);
  assert.match(owner, /KERN_CLI_KIR_SHADOW_OWNER\s*=\s*['"]kern\.cli\.kir-shadow\.owner\.v1['"]/u);
  assert.match(source(COMPILE), /from ['"]\.\.\/kir-shadow\/owner\.js['"]/u);
  assert.match(source(RUN), /from ['"]\.\.\/kir-shadow\/owner\.js['"]/u);
  assert.doesNotMatch(
    owner,
    /(?:executeKernSource|ReferenceRunner|transpileAndWrite|parseDocument|parseExpression|@kernlang\/core\/runner)/u,
    'the KIR-shadow owner may consume only packaged projection, RT-1, and target compiler contracts',
  );
});

test('compile KIR shadow projects real source and reports deterministic target artifact identities without new outputs', (t) => {
  if (!existsSync(OWNER)) return t.skip('CLI KIR shadow owner is not implemented yet');
  if (!existsSync(CLI)) return t.skip(`CLI build missing at ${CLI}`);
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
    assert.deepEqual(Object.keys(report).sort(), ['entry', 'projection', 'targets']);
    assert.deepEqual(report.entry, { handlerName: 'main', moduleId: 'main.kern' });
    assert.equal(report.projection.status, 'projected');
    assert.match(report.projection.artifactSha256, /^[a-f0-9]{64}$/u);
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
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('run KIR shadow compares RT-1, isolated emitted JavaScript, and isolated emitted Python without replaying program stdout', (t) => {
  if (!existsSync(OWNER)) return t.skip('CLI KIR shadow owner is not implemented yet');
  if (!existsSync(CLI)) return t.skip(`CLI build missing at ${CLI}`);
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
