import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTSCDiagnosticsFromPaths } from '../src/external-tools.js';
import { reviewFile, reviewSource } from '../src/index.js';

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

  test('preserves diagnostics from unsaved reviewSource input instead of comparing against disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-review-unsaved-tsc-'));
    try {
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, target: 'ES2022' },
          include: ['src/**/*'],
        }),
      );
      const srcDir = join(dir, 'src');
      mkdirSync(srcDir);
      const file = join(srcDir, 'value.ts');
      writeFileSync(file, 'export const value: number = 1;\n');

      const report = reviewSource('export const value: number = "unsaved";\n', file);
      expect(report.findings.find((finding) => finding.ruleId === 'ts2322')).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refreshes canonical build diagnostics after project source changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-review-refresh-tsc-'));
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
            strict: true,
            target: 'ES2022',
          },
          include: ['src/**/*'],
        }),
      );
      const file = join(srcDir, 'value.ts');
      writeFileSync(file, 'export const value: number = 1;\n');
      expect(runTSCDiagnosticsFromPaths([file])).toEqual([]);

      writeFileSync(file, 'export const value: number = "changed";\n');
      expect(runTSCDiagnosticsFromPaths([file]).find((finding) => finding.ruleId === 'ts2322')).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not invoke a canonical build for a standard clean per-file review', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-review-no-eager-tsc-'));
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
            strict: true,
            target: 'ES2022',
          },
          include: ['src/**/*'],
        }),
      );
      const file = join(srcDir, 'value.ts');
      writeFileSync(file, 'export const value = 1;\n');

      reviewFile(file, { noCache: true });
      expect(existsSync(join(dir, 'dist'))).toBe(false);
      expect(existsSync(join(dir, 'tsconfig.tsbuildinfo'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
