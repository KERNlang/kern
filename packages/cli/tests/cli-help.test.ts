import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/cli.js');

describe('kern top-level help', () => {
  for (const flag of ['--help', '-h']) {
    test(`${flag} prints usage and exits successfully`, () => {
      const result = spawnSync(process.execPath, [CLI, flag], {
        encoding: 'utf8',
        timeout: 5_000,
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Usage: kern');
      expect(result.stderr).toBe('');
    });
  }
});
