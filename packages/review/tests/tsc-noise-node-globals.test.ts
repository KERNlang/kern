import { Project } from 'ts-morph';
import { runTSCDiagnostics } from '../src/external-tools.js';

// kern-sight PR #7 reported TS2552 ("Cannot find name 'URL'") on review,
// even though `tsc --noEmit` against the same project succeeds. Root
// cause: kern-guard's worker shallow-clones the repo without
// node_modules, so @types/node isn't reachable from ts-morph's project.
// Same class as TS2580/TS2591 ("Cannot find name 'process'/'require'"),
// just for a wider set of globals (URL, URLSearchParams, __dirname,
// Buffer, etc.). Suppress as environmental noise in review mode.

function projectFor(source: string, filename = '/test.ts') {
  // No tsConfigFilePath, no node_modules — mirrors the worker scenario
  // where @types/node is unreachable. lib defaults exclude DOM, so URL
  // and __dirname have no source.
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100, noEmit: true, lib: ['es2022'] },
  });
  project.createSourceFile(filename, source);
  return project;
}

describe('runTSCDiagnostics — Node-global noise suppression (kern-sight PR #7)', () => {
  it('drops TS2552/TS2304 for URL when @types/node is missing in review mode', () => {
    const project = projectFor(`
      let url: URL;
      url = new URL('https://example.com');
      console.log(url.href);
    `);
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /Cannot find name 'URL'/.test(f.message))).toBeUndefined();
  });

  it('drops TS2552/TS2304 for __dirname when @types/node is missing in review mode', () => {
    const project = projectFor(`
      console.log(__dirname);
    `);
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /__dirname/.test(f.message))).toBeUndefined();
  });

  it('drops Buffer / URLSearchParams / AbortController in review mode', () => {
    const project = projectFor(`
      const buf: Buffer = Buffer.from('x');
      const u = new URLSearchParams();
      const c = new AbortController();
      console.log(buf, u, c);
    `);
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /Cannot find name 'Buffer'/.test(f.message))).toBeUndefined();
    expect(findings.find((f) => /Cannot find name 'URLSearchParams'/.test(f.message))).toBeUndefined();
    expect(findings.find((f) => /Cannot find name 'AbortController'/.test(f.message))).toBeUndefined();
  });

  it('STILL surfaces real "Cannot find name" errors for non-Node globals', () => {
    const project = projectFor(`
      console.log(NotARealGlobal);
    `);
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /Cannot find name 'NotARealGlobal'/.test(f.message))).toBeDefined();
  });

  it('does NOT suppress in lint mode (downgradeProjectLoadingErrors=false)', () => {
    // --lint path must surface real env-misconfig errors so they aren't masked
    const project = projectFor(`
      let url: URL;
    `);
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: false });
    expect(findings.find((f) => /Cannot find name 'URL'/.test(f.message))).toBeDefined();
  });
});

// Gemini-flagged BLOCKER: NodeJS used as a namespace emits TS2503
// ("Cannot find namespace 'X'"), not TS2304 ("Cannot find name 'X'").
// `let timer: NodeJS.Timeout` is the canonical case. Suppression now
// covers TS2503 and the helper regex matches both "name" and "namespace".
describe('runTSCDiagnostics — TS2503/TS2584 namespace + console suppression (gemini/codex)', () => {
  it('drops TS2503 for NodeJS namespace when @types/node is missing in review mode', async () => {
    const { Project } = await import('ts-morph');
    const { runTSCDiagnostics } = await import('../src/external-tools.js');
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100, noEmit: true, lib: ['es2022'] },
    });
    project.createSourceFile(
      '/test.ts',
      `
      let timer: NodeJS.Timeout | undefined;
      timer = undefined;
    `,
    );
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /Cannot find namespace 'NodeJS'/.test(f.message))).toBeUndefined();
  });

  it('STILL surfaces TS2503 for unknown namespaces (non-Node)', async () => {
    const { Project } = await import('ts-morph');
    const { runTSCDiagnostics } = await import('../src/external-tools.js');
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100, noEmit: true, lib: ['es2022'] },
    });
    project.createSourceFile(
      '/test.ts',
      `
      let x: NotARealNamespace.SomeType | undefined;
      x = undefined;
    `,
    );
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /Cannot find namespace 'NotARealNamespace'/.test(f.message))).toBeDefined();
  });

  it('drops TS2584 for `console` (codex-flagged)', async () => {
    // TS2584 form: "Cannot find name 'console'. Do you need to change your
    // target library? Try changing the 'lib' compiler option to include 'dom'."
    // Same noise class as TS2580/TS2591 — the dev's IDE has the right libs;
    // the worker doesn't.
    const { Project } = await import('ts-morph');
    const { runTSCDiagnostics } = await import('../src/external-tools.js');
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100, noEmit: true, lib: ['es2022'] },
    });
    project.createSourceFile(
      '/test.ts',
      `
      console.log('hi');
    `,
    );
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => /Cannot find name 'console'/.test(f.message))).toBeUndefined();
  });
});
