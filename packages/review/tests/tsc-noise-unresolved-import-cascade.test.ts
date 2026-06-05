import { Project } from 'ts-morph';
import { runTSCDiagnostics } from '../src/external-tools.js';

// kern-guard PR #376 surfaced TS18046 ("'u' is of type 'unknown'") and TS2698
// ("Spread types may only be created from object types") on a file that
// consumed a brand-new workspace package (@kernlang/context) introduced in the
// same PR. Root cause: kern-guard reviews a sparse clone with NO node_modules,
// so the import is unresolvable. TS2307 (the root miss) is already downgraded
// as module-resolution noise; the degraded type then cascades —
//   unresolved import  -> type `any`
//   Object.entries(any) -> `[string, unknown][]`  (generic T defaults to unknown)
//   u.callers           -> TS18046 ("'u' is of type 'unknown'")
//   { ...u }            -> TS2698 ("Spread types may only be created from ...")
// A full `tsc -b` with the package built emits ZERO of these (proven). They are
// pure environmental false positives, suppressed in review mode — but ONLY in a
// file that already has a suppressed module miss, so a genuine unknown-handling
// bug in a cleanly-resolved file still surfaces.

// NOTE: no explicit `lib` option — let ts-morph bundle the default libs so
// `Object.entries` carries its real `[string, unknown][]` signature. Specifying
// `lib: ['es2022']` makes the in-memory FS fail to load the lib and `Object`
// itself goes missing, which would not reproduce this cascade.
function projectWith(files: Record<string, string>) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100, noEmit: true },
  });
  for (const [name, source] of Object.entries(files)) project.createSourceFile(name, source);
  return project;
}

// The real shape from packages/cli/src/commands/context.ts (relativizeArtifact):
// imports a type from an unresolvable module, then maps over Object.entries.
const CASCADE_SOURCE = `
import type { Graph } from '@scope/does-not-exist';
function rel(p: string): string { return p; }
export function relativize(a: Graph) {
  return Object.fromEntries(
    Object.entries(a.usage).map(([id, u]) => [
      id,
      { ...u, callers: u.callers.map((c: any) => ({ ...c, path: rel(c.path) })) },
    ]),
  );
}
`;

describe('runTSCDiagnostics — unresolved-import type-erosion cascade (kern-guard PR #376)', () => {
  it('downgrades TS18046 / TS2698 cascade in a file with a suppressed module miss', () => {
    const project = projectWith({ '/test.ts': CASCADE_SOURCE });
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => f.ruleId === 'ts18046')).toBeUndefined();
    expect(findings.find((f) => f.ruleId === 'ts2698')).toBeUndefined();
    // the root miss itself is also downgraded (bare-module noise)
    expect(findings.find((f) => f.ruleId === 'ts2307')).toBeUndefined();
  });

  it('STILL surfaces a real unknown-handling bug in a cleanly-resolved file (per-file gate)', () => {
    // /clean.ts has NO unresolved import — its TS18046/TS2698 are real bugs the
    // developer wrote and must NOT be hidden, even when ANOTHER file in the same
    // Project run has a suppressed miss.
    const project = projectWith({
      '/with-miss.ts': CASCADE_SOURCE,
      '/clean.ts': `
        export function readUnknown(x: unknown) { return x.foo; }
        export function spreadUnknown(x: unknown) { return { ...x }; }
      `,
    });
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });

    // The cascade in the file WITH the miss is suppressed...
    const inWithMiss = findings.filter((f) => f.primarySpan.file === '/with-miss.ts');
    expect(inWithMiss.find((f) => f.ruleId === 'ts18046')).toBeUndefined();
    expect(inWithMiss.find((f) => f.ruleId === 'ts2698')).toBeUndefined();

    // ...but the genuine unknown bug in the CLEAN file still surfaces.
    const inClean = findings.filter((f) => f.primarySpan.file === '/clean.ts');
    expect(inClean.find((f) => f.ruleId === 'ts18046')).toBeDefined();
    expect(inClean.find((f) => f.ruleId === 'ts2698')).toBeDefined();
  });

  it('does NOT suppress the cascade in lint mode (downgradeProjectLoadingErrors=false)', () => {
    // The explicit --lint/typecheck path must surface everything, including the
    // root TS2307, so a genuinely broken environment is reported.
    const project = projectWith({ '/test.ts': CASCADE_SOURCE });
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: false });
    expect(findings.find((f) => f.ruleId === 'ts18046')).toBeDefined();
    expect(findings.find((f) => f.ruleId === 'ts2698')).toBeDefined();
    expect(findings.find((f) => f.ruleId === 'ts2307')).toBeDefined();
  });
});
