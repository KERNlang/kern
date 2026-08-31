import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModuleKind, Project } from 'ts-morph';
import { runTSCDiagnostics, runTSCDiagnosticsFromPaths } from '../src/external-tools.js';
import { reviewDirectory, reviewFile, reviewSource } from '../src/index.js';

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

  test('does not report TS1470 for ESM .mjs import.meta when the canonical check is clean', () => {
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
      // read-only diagnostic set. The canonical check has no TS1470 here.
      expect(runTSCDiagnosticsFromPaths([esmFile]).find((f) => f.ruleId === 'ts1470')).toBeUndefined();
      expect(reviewFile(esmFile).findings.find((f) => f.ruleId === 'ts1470')).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not let an unrelated TS1470 filter a reviewed on-disk diagnostic', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-review-unrelated-ts1470-'));
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
      writeFileSync(join(srcDir, 'unrelated.cts'), 'export const here = import.meta.url;\n');
      const looseFile = join(dir, 'loose.ts');
      writeFileSync(looseFile, 'export const value: number = "wrong";\n');

      const project = new Project({
        compilerOptions: { module: ModuleKind.NodeNext, target: 9 },
        skipAddingFilesFromTsConfig: true,
      });
      project.addSourceFileAtPath(join(srcDir, 'unrelated.cts'));
      project.addSourceFileAtPath(looseFile);
      expect(
        runTSCDiagnostics(project, { canonicalFilePaths: [looseFile] }).find((finding) => finding.ruleId === 'ts2322'),
      ).toBeDefined();
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

  test('keeps real diagnostics when an incremental canonical build is already current', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-review-incremental-tsc-'));
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
      const file = join(srcDir, 'tool.mjs');
      writeFileSync(file, 'export const value: number = "wrong"; export const here = import.meta.url;\n');

      reviewFile(file, { noCache: true });
      expect(reviewFile(file, { noCache: true }).findings.find((finding) => finding.ruleId === 'ts2322')).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not write build artifacts while canonicalizing a TS1470 review', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-review-readonly-tsc-'));
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
      const file = join(srcDir, 'tool.mjs');
      writeFileSync(file, 'export const here = import.meta.url;\n');

      expect(
        reviewFile(file, { noCache: true }).findings.find((finding) => finding.ruleId === 'ts1470'),
      ).toBeUndefined();
      expect(existsSync(join(dir, 'dist'))).toBe(false);
      expect(existsSync(join(dir, 'tsconfig.tsbuildinfo'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('batches canonical builds for a directory review', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-review-batched-tsc-'));
    try {
      const srcDir = join(dir, 'src');
      const tscDir = join(dir, 'node_modules', 'typescript', 'bin');
      const callsFile = join(dir, 'canonical-build-calls.txt');
      mkdirSync(srcDir);
      mkdirSync(tscDir, { recursive: true });
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
      writeFileSync(
        join(tscDir, 'tsc'),
        `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(callsFile)}, 'build\\n');\n`,
      );
      writeFileSync(join(srcDir, 'one.ts'), 'export const one = import.meta.url;\n');
      writeFileSync(join(srcDir, 'two.ts'), 'export const two = import.meta.url;\n');

      reviewDirectory(srcDir, false, { noCache: true });
      expect(readFileSync(callsFile, 'utf8').trim().split('\n')).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('caches a failed canonical build for the directory request', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-review-failed-batched-tsc-'));
    try {
      const srcDir = join(dir, 'src');
      const tscDir = join(dir, 'node_modules', 'typescript', 'bin');
      const callsFile = join(dir, 'canonical-build-calls.txt');
      mkdirSync(srcDir);
      mkdirSync(tscDir, { recursive: true });
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
      writeFileSync(
        join(tscDir, 'tsc'),
        `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(callsFile)}, 'build\\n');\nprocess.stderr.write('canonical unavailable\\n');\nprocess.exitCode = 1;\n`,
      );
      writeFileSync(join(srcDir, 'one.ts'), 'export const one = import.meta.url;\n');
      writeFileSync(join(srcDir, 'two.ts'), 'export const two = import.meta.url;\n');

      reviewDirectory(srcDir, false, { noCache: true });
      expect(readFileSync(callsFile, 'utf8').trim().split('\n')).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('suppresses ad-hoc composite project loading diagnostics', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-review-project-membership-'));
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
            strict: true,
          },
          include: ['src/**/*'],
        }),
      );
      const indexFile = join(srcDir, 'index.ts');
      writeFileSync(indexFile, "export { value } from './dep.js';\n");
      writeFileSync(join(srcDir, 'dep.ts'), 'export const value = 1;\n');
      const project = new Project({
        skipAddingFilesFromTsConfig: true,
        tsConfigFilePath: join(dir, 'tsconfig.json'),
      });
      project.addSourceFileAtPath(indexFile);

      expect(runTSCDiagnostics(project).some((finding) => finding.ruleId === 'ts6307')).toBe(true);
      expect(
        runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true }).some(
          (finding) => finding.ruleId === 'ts6307',
        ),
      ).toBe(false);
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
