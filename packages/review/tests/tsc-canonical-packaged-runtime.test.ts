import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewFile } from '../src/index.js';
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

  test('does not report TS1470 for ESM .mjs import.meta when canonical tsc -b is clean', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-review-esm-tsc-'));
    try {
      const srcDir = join(dir, 'src');
      mkdirSync(srcDir);
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            allowJs: true,
            checkJs: true,
            composite: true,
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            outDir: 'dist',
            strict: true,
            target: 'ES2022',
          },
          include: ['src/**/*'],
        }),
      );
      const esmFile = join(srcDir, 'tool.mjs');
      writeFileSync(esmFile, 'export const here = import.meta.url;\n');

      // This helper compares ts-morph diagnostics against the exact canonical
      // `tsc -b` diagnostic set. The canonical build has no TS1470 here.
      expect(runTSCDiagnosticsFromPaths([esmFile]).find((f) => f.ruleId === 'ts1470')).toBeUndefined();
      expect(reviewFile(esmFile).findings.find((f) => f.ruleId === 'ts1470')).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
