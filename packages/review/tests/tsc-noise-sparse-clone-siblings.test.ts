import { Project } from 'ts-morph';
import { runTSCDiagnostics } from '../src/external-tools.js';

// kern-guard reviews a SPARSE clone (only the PR's changed files, no
// node_modules). The under-500 refactor on fitvt PR #19 split screens into
// sibling `.tsx` / `.types.ts` / `.helpers.ts` / `.sections.tsx` modules; the
// sparse clone dropped siblings and the host tsconfig's jsx (via
// `extends: "expo/tsconfig.base"`) never resolved. That produced four
// environmental false-positive classes a full local `tsc --noEmit` (siblings +
// node_modules present) does NOT emit. Each is suppressed in REVIEW mode only,
// and never at the expense of the corresponding genuine bug.

function projectWith(files: Record<string, string>) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100, noEmit: true },
  });
  for (const [name, source] of Object.entries(files)) project.createSourceFile(name, source);
  return project;
}

describe('runTSCDiagnostics — sparse-clone sibling/jsx noise (fitvt PR #19)', () => {
  // ---- A: TS6142 "'--jsx' is not set" on importing a .tsx sibling ----
  it('suppresses TS6142 when importing a .tsx module with jsx unset (review mode)', () => {
    const findings = runTSCDiagnostics(
      projectWith({
        '/b.tsx': `export const B = 1;`,
        '/a.tsx': `import { B } from './b'; export const x = B;`,
      }),
      { downgradeProjectLoadingErrors: true },
    );
    expect(findings.find((f) => f.ruleId === 'ts6142')).toBeUndefined();
  });

  it('STILL surfaces TS6142 in lint mode (downgradeProjectLoadingErrors=false)', () => {
    const findings = runTSCDiagnostics(
      projectWith({
        '/b.tsx': `export const B = 1;`,
        '/a.tsx': `import { B } from './b'; export const x = B;`,
      }),
      { downgradeProjectLoadingErrors: false },
    );
    expect(findings.find((f) => f.ruleId === 'ts6142')).toBeDefined();
  });

  // ---- C: TS2305 through a barrel that star-reexports an ABSENT sibling ----
  it('suppresses TS2305 for a name re-exported through a barrel whose sibling is absent', () => {
    const findings = runTSCDiagnostics(
      projectWith({
        '/types/index.ts': `export * from './unified-food.types';`,
        '/consumer.ts': `import { UnifiedFood } from './types'; export const u = {} as UnifiedFood;`,
      }),
      { downgradeProjectLoadingErrors: true },
    );
    expect(findings.find((f) => f.ruleId === 'ts2305')).toBeUndefined();
    // the barrel's own TS2307 on the absent relative sibling is also downgraded
    expect(findings.find((f) => f.ruleId === 'ts2307')).toBeUndefined();
  });

  it('STILL surfaces a REAL TS2305 when the barrel sibling IS present (member genuinely missing)', () => {
    // The per-condition gate: 2305 is suppressed only when the star-export
    // target is ABSENT. A present sibling that simply lacks the member is a
    // real bug and must surface.
    const findings = runTSCDiagnostics(
      projectWith({
        '/present.ts': `export const A = 1;`,
        '/barrel.ts': `export * from './present';`,
        '/c2.ts': `import { Missing } from './barrel'; export const z = Missing;`,
      }),
      { downgradeProjectLoadingErrors: true },
    );
    expect(findings.find((f) => f.ruleId === 'ts2305')).toBeDefined();
  });

  // ---- Raw TS2307 on an absent RELATIVE sibling import ----
  it('suppresses the raw TS2307 for an absent relative sibling import (review mode)', () => {
    const findings = runTSCDiagnostics(
      projectWith({ '/consumer.ts': `import { handle } from './helpers'; handle();` }),
      { downgradeProjectLoadingErrors: true },
    );
    expect(findings.find((f) => f.ruleId === 'ts2307')).toBeUndefined();
  });

  it('STILL surfaces the raw TS2307 in lint mode', () => {
    const findings = runTSCDiagnostics(
      projectWith({ '/consumer.ts': `import { handle } from './helpers'; handle();` }),
      { downgradeProjectLoadingErrors: false },
    );
    expect(findings.find((f) => f.ruleId === 'ts2307')).toBeDefined();
  });

  // ---- D: TS2304 on RN/Expo/DOM-lib globals (e.g. __DEV__) ----
  it('suppresses TS2304 "Cannot find name \'__DEV__\'" (RN/Expo global) in review mode', () => {
    const findings = runTSCDiagnostics(projectWith({ '/d.ts': `export const flag = __DEV__ ? 1 : 0;` }), {
      downgradeProjectLoadingErrors: true,
    });
    expect(findings.find((f) => f.ruleId === 'ts2304')).toBeUndefined();
  });

  it('STILL surfaces TS2304 for a genuinely-undefined name (not a known global)', () => {
    const findings = runTSCDiagnostics(projectWith({ '/g.ts': `export const q = someTrulyUndefinedThing + 1;` }), {
      downgradeProjectLoadingErrors: true,
    });
    expect(findings.find((f) => f.ruleId === 'ts2304')).toBeDefined();
  });

  // ---- Boundary: the new relative-sibling gate must not disturb bare/package
  // miss handling. A bare miss (`lodash`) was, and stays, suppressed in review
  // mode via the pre-existing isReviewModeModuleResolutionNoise path — NOT via
  // the new isAbsentRelativeSibling gate, which is relative-only. This regression
  // guard proves the collector change (adding `|| isAbsentRelativeSibling`) left
  // bare-miss behavior untouched, and that lint mode still reports it. ----
  it('keeps a bare/package module miss suppressed in review mode (unchanged path) but reports it in lint mode', () => {
    const files = { '/consumer.ts': `import { foo } from 'lodash'; export const x = foo;` };
    const review = runTSCDiagnostics(projectWith(files), { downgradeProjectLoadingErrors: true });
    expect(review.find((f) => f.ruleId === 'ts2307')).toBeUndefined();
    const lint = runTSCDiagnostics(projectWith(files), { downgradeProjectLoadingErrors: false });
    expect(lint.find((f) => f.ruleId === 'ts2307')).toBeDefined();
  });
});
