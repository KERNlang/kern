import { Project } from 'ts-morph';
import { runTSCDiagnostics } from '../src/external-tools.js';

// kern-guard flagged every describe/it/expect in a React-Native repo whose
// local `pnpm typecheck` was clean: the worker's sandbox Project can't reach
// the host's `types: ["jest"]` ambient types, so TS emits TS2582/TS2593 for
// describe/suite/it/test (the hardcoded test-runner-hint names) and plain
// TS2304 for the rest of the jest/vitest global surface (expect, beforeEach,
// vi, …). Same environmental class as the @types/node globals (TS2580/2591),
// suppressed in review mode. The TS2304 leg is additionally gated to
// test-like file paths so a stray `expect` in production code still surfaces.

function projectFor(source: string, filename = '/src/example.test.ts') {
  // No tsConfigFilePath, no node_modules — mirrors the worker scenario where
  // the host's test-runner ambient types are unreachable.
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100, noEmit: true, lib: ['es2022'] },
  });
  project.createSourceFile(filename, source);
  return project;
}

describe('runTSCDiagnostics — test-runner global noise suppression', () => {
  it('drops TS2582/TS2593 for describe/it when test-runner types are missing in review mode', () => {
    const project = projectFor(`
      describe('suite', () => {
        it('works', () => {});
      });
    `);
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /Cannot find name 'describe'/.test(f.message))).toBeUndefined();
    expect(findings.find((f) => /Cannot find name 'it'/.test(f.message))).toBeUndefined();
  });

  it('drops TS2304 for expect/beforeEach/jest/vi in a test-like file in review mode', () => {
    const project = projectFor(`
      beforeEach(() => {
        jest.resetAllMocks();
        vi.clearAllMocks();
      });
      expect(1).toBe(1);
    `);
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /Cannot find name 'expect'/.test(f.message))).toBeUndefined();
    expect(findings.find((f) => /Cannot find name 'beforeEach'/.test(f.message))).toBeUndefined();
    expect(findings.find((f) => /Cannot find name 'jest'/.test(f.message))).toBeUndefined();
    expect(findings.find((f) => /Cannot find name 'vi'/.test(f.message))).toBeUndefined();
  });

  it('drops TS2304 for focus/skip variants (fit/xit/xdescribe) in a test-like file', () => {
    const project = projectFor(`
      xdescribe('skipped suite', () => {
        fit('focused', () => {});
        xit('skipped', () => {});
      });
    `);
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /Cannot find name 'xdescribe'/.test(f.message))).toBeUndefined();
    expect(findings.find((f) => /Cannot find name 'fit'/.test(f.message))).toBeUndefined();
    expect(findings.find((f) => /Cannot find name 'xit'/.test(f.message))).toBeUndefined();
  });

  it('drops TS2304 for Mocha aliases in a test-like file', () => {
    const project = projectFor(`
      context('suite', () => {
        specify('case', () => {});
      });
      setup(() => {});
      teardown(() => {});
      suiteSetup(() => {});
      suiteTeardown(() => {});
    `);
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    for (const name of ['context', 'specify', 'setup', 'teardown', 'suiteSetup', 'suiteTeardown']) {
      expect(findings.find((f) => new RegExp(`Cannot find name '${name}'`).test(f.message))).toBeUndefined();
    }
  });

  it('drops TS2304 for beforeEach in a runner setup file (vitest.setup.ts)', () => {
    const project = projectFor(
      `
      beforeEach(() => {});
    `,
      '/vitest.setup.ts',
    );
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /Cannot find name 'beforeEach'/.test(f.message))).toBeUndefined();
  });

  it('treats uppercase and exact test/helper filenames as test-like paths', () => {
    const projects = [
      projectFor('expect(1).toBe(1);', '/src/Foo.TEST.ts'),
      projectFor('expect(1).toBe(1);', '/src/__Tests__/helper.ts'),
      projectFor('expect(1).toBe(1);', '/src/test.ts'),
      projectFor('expect(1).toBe(1);', '/src/test-utils.ts'),
    ];

    for (const project of projects) {
      const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
      expect(findings.find((f) => /Cannot find name 'expect'/.test(f.message))).toBeUndefined();
    }
  });

  it('drops TS2503 for jest namespace in type position (let m: jest.Mock) in a test file', () => {
    const project = projectFor(`
      let mockFn: jest.Mock | undefined;
      mockFn = undefined;
    `);
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /Cannot find namespace 'jest'/.test(f.message))).toBeUndefined();
  });

  it('drops TS2304 for beforeEach in hyphen-separated setup files (test-setup.ts)', () => {
    const project = projectFor(
      `
      beforeEach(() => {});
    `,
      '/test-setup.ts',
    );
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /Cannot find name 'beforeEach'/.test(f.message))).toBeUndefined();
  });

  it('STILL surfaces TS2582/TS2593 for describe in a production (non-test) file', () => {
    const project = projectFor(
      `
      describe('not a test file', () => {});
    `,
      '/src/app.ts',
    );
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /Cannot find name 'describe'/.test(f.message))).toBeDefined();
  });

  it('STILL surfaces TS2304 for expect in a production (non-test) file', () => {
    const project = projectFor(
      `
      expect(1);
    `,
      '/src/app.ts',
    );
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /Cannot find name 'expect'/.test(f.message))).toBeDefined();
  });

  it('STILL surfaces real "Cannot find name" errors in test files for non-runner names', () => {
    const project = projectFor(`
      describe('suite', () => {
        NotARealGlobal();
      });
    `);
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /Cannot find name 'NotARealGlobal'/.test(f.message))).toBeDefined();
  });

  it('does NOT suppress in lint mode (downgradeProjectLoadingErrors=false)', () => {
    const project = projectFor(`
      describe('suite', () => {});
      expect(1);
    `);
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: false });
    expect(findings.find((f) => /Cannot find name 'describe'/.test(f.message))).toBeDefined();
    expect(findings.find((f) => /Cannot find name 'expect'/.test(f.message))).toBeDefined();
  });
});
