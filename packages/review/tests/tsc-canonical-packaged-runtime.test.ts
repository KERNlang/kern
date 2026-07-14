import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTSCDiagnosticsFromPaths } from '../src/external-tools.js';

describe('canonical tsc lookup in packaged review runtimes', () => {
  test('filters ts-morph-only diagnostics when the reviewed repo and cwd have no TypeScript install', () => {
    const originalCwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), 'kern-review-packaged-tsc-'));
    try {
      const srcDir = join(dir, 'src');
      mkdirSync(srcDir);
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            composite: true,
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            outDir: 'dist',
            rootDir: 'src',
            target: 'ES2022',
          },
          include: ['src/**/*'],
        }),
      );
      writeFileSync(join(srcDir, 'index.ts'), 'export const canonical = true;\n');
      const looseFile = join(dir, 'loose.ts');
      writeFileSync(looseFile, 'const value: number = "ts-morph-only";\nexport { value };\n');

      process.chdir(dir);
      expect(runTSCDiagnosticsFromPaths([looseFile])).toEqual([]);
    } finally {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
