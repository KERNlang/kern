import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = resolve(ROOT, 'packages/cli/dist/cli.js');
const OWNER = resolve(ROOT, 'packages/cli/src/kir-shadow/owner.ts');
const PROGRAM = [
  'fn name=main export=true returns=string',
  '  handler lang=kern',
  '    return value="\\"hello\\""',
  '',
].join('\n');

function command(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: 20_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, stderr: result.stderr ?? '', stdout: result.stdout ?? '' };
}

test('equals-form shadow flags activate the owner and never reach legacy writes', () => {
  assert.ok(existsSync(OWNER), `CLI_KIR_SHADOW_OWNER_MISSING: expected ${OWNER}`);
  assert.ok(existsSync(CLI), `CLI_KIR_SHADOW_BUILD_MISSING: expected ${CLI}`);
  const directory = mkdtempSync(resolve(tmpdir(), 'kern-cli-kir-shadow-equals-'));
  try {
    const input = resolve(directory, 'main.kern');
    const outDir = resolve(directory, 'generated');
    writeFileSync(input, PROGRAM);
    for (const flag of ['--kir-shadow=true', '--kir-shadow-entry=main.kern#main']) {
      const result = command(['compile', input, `--outdir=${outDir}`, flag]);
      assert.equal(result.status, 2, `${flag}: ${result.stderr || result.stdout}`);
      assert.equal(result.stdout, '', `${flag}: malformed shadow flags are atomic stderr failures`);
      assert.match(result.stderr, /KERN_CLI_KIR_SHADOW:/u);
      assert.equal(existsSync(outDir), false, `${flag}: legacy compile must not create output`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
