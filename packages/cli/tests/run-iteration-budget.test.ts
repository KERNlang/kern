import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const cli = resolve(root, 'packages/cli/dist/cli.js');
let directory: string;

beforeAll(() => {
  if (!existsSync(cli)) throw new Error(`iteration-budget tests require built CLI at ${cli}`);
  directory = mkdtempSync(join(tmpdir(), 'kern-run-budget-'));
});

afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});

function program(body: readonly string[]): string {
  return ['fn name=main returns=void', '  handler lang="kern"', ...body.map((line) => `    ${line}`)].join('\n');
}

function sourceFile(body: readonly string[]): string {
  const file = join(directory, 'program.kern');
  writeFileSync(file, program(body));
  return file;
}

function run(...args: readonly string[]) {
  const result = spawnSync(process.execPath, [cli, 'run', ...args], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (result.error) throw result.error;
  return result;
}

describe('kern run --iteration-budget', () => {
  test('preserves omission compatibility and forwards an explicit exact sync budget', () => {
    const file = sourceFile(['for name=i from="0" to="2"', '  print value="i"']);

    const omitted = run(file);
    expect(omitted.status).toBe(0);
    expect(omitted.stdout).toBe('0\n1\n');

    const exhausted = run('--iteration-budget', '1', file);
    expect(exhausted.status).toBe(2);
    expect(exhausted.stdout).toBe('');
    expect(exhausted.stderr).toMatch(/budget exhausted/u);

    const exact = run('--iteration-budget', '2', file);
    expect(exact.status).toBe(0);
    expect(exact.stdout).toBe('0\n1\n');
    expect(exact.stderr).toBe('');
  });

  test('forwards an explicit budget through the real async CLI lane', () => {
    const file = sourceFile([
      'for name=i from="0" to="2"',
      '  capability namespace=llm operation=complete name=answer input="{ prompt: \'step\' }"',
      '  print value="answer"',
    ]);

    const exhausted = run('--llm-response', 'ok', '--iteration-budget', '1', file);
    expect(exhausted.status).toBe(2);
    expect(exhausted.stdout).toBe('');
    expect(exhausted.stderr).toMatch(/budget exhausted/u);

    const exact = run('--llm-response', 'ok', '--iteration-budget', '2', file);
    expect(exact.status).toBe(0);
    expect(exact.stdout).toBe('ok\nok\n');
    expect(exact.stderr).toBe('');
  });

  test.each(['0', '-1', '1.5', 'NaN', '9007199254740992', '9'.repeat(400)])('rejects invalid value %s', (value) => {
    const file = sourceFile(['print value="1"']);
    const result = run('--iteration-budget', value, file);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: kern run');
  });

  test('rejects missing, duplicate, and non-execution usage', () => {
    const file = sourceFile(['print value="1"']);
    for (const args of [
      ['--iteration-budget', file],
      ['--iteration-budget', '1', '--iteration-budget', '2', file],
      ['--capabilities', '--iteration-budget', '1', file],
    ]) {
      const result = run(...args);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Usage: kern run');
    }
  });
});
