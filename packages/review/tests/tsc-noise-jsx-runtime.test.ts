import { Project, ts } from 'ts-morph';
import { runTSCDiagnostics } from '../src/external-tools.js';

// kern-guard observed TS2875 ("This JSX tag requires the module path
// 'react/jsx-runtime' to exist, but none could be found") failing ephemeral PR
// review on healthy React-19 repos that use the automatic JSX runtime
// (tsconfig `jsx: "react-jsx"`, `moduleResolution: "Bundler"`). The worker
// shallow-clones the PR without node_modules, so review's ts-morph Project
// can't resolve the `react/jsx-runtime` exports subpath — even though the dev's
// local `tsc --noEmit` resolves it cleanly. ts2875 is the automatic-runtime
// equivalent of the classic-runtime ts7026/ts2503 namespace break and of the
// ts2307 bare-module miss we already downgrade. Suppress it in review mode
// only; the explicit --lint path must still surface it. Mirrors the
// tsc-noise-jsx-namespace / tsc-noise-node-globals patterns.

function automaticRuntimeProject(files: Record<string, string>) {
  // jsx: ReactJSX (automatic runtime, == tsconfig "react-jsx"),
  // moduleResolution: Bundler — mirrors a React-19 + Vite consumer. No
  // node_modules, so `react/jsx-runtime` is unresolvable and TS emits ts2875
  // per JSX tag (confirmed via the live compiler against typescript@6).
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      strict: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      noEmit: true,
      lib: ['es2022', 'dom'],
    },
  });
  for (const [path, contents] of Object.entries(files)) {
    project.createSourceFile(path, contents);
  }
  return project;
}

// Host element (<button>) — the common case; co-fires ts7026 + ts2875.
const HOST_ELEMENT_TSX = `
  import { useState } from "react";
  export function Counter() {
    const [n, setN] = useState(0);
    return <button onClick={() => setN(n + 1)}>{n}</button>;
  }
`;

// Component-only JSX (no intrinsic elements) — ts2875 fires WITHOUT ts7026,
// so this is the case the direct ts2875 suppression must catch on its own.
const COMPONENT_ONLY_TSX = `
  type ReactNode = unknown;
  function Card(props: { title: string; children: ReactNode }) { return props.children; }
  export function Page() {
    return <Card title="hi"><Card title="nested">x</Card></Card>;
  }
`;

describe('runTSCDiagnostics — automatic JSX runtime noise (kern-guard ts2875 FP)', () => {
  it('drops TS2875 (react/jsx-runtime unresolved) in review mode', () => {
    const project = automaticRuntimeProject({ '/Counter.tsx': HOST_ELEMENT_TSX });
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => f.ruleId === 'ts2875')).toBeUndefined();
    // The host element also co-fires ts7026 (no JSX.IntrinsicElements), which
    // is suppressed as environmental noise in review mode too — assert it so a
    // regression that leaks ts7026 alongside ts2875 is caught here.
    expect(findings.find((f) => f.ruleId === 'ts7026')).toBeUndefined();
  });

  it('drops TS2875 even for component-only JSX (no host element, no co-firing ts7026)', () => {
    const project = automaticRuntimeProject({ '/Page.tsx': COMPONENT_ONLY_TSX });
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => f.ruleId === 'ts2875')).toBeUndefined();
  });

  it('STILL surfaces TS2875 in lint mode (downgradeProjectLoadingErrors=false)', () => {
    // A repo genuinely lacking the JSX runtime must still see it via --lint.
    const project = automaticRuntimeProject({ '/Counter.tsx': HOST_ELEMENT_TSX });
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: false });
    expect(findings.find((f) => f.ruleId === 'ts2875')).toBeDefined();
  });

  it('does NOT over-suppress: a real type error in the same project still surfaces in review mode', () => {
    // Guards the message gate: only jsx-runtime 2875s are environmental noise.
    // A genuine assignability error (ts2322) must keep firing.
    const project = automaticRuntimeProject({
      '/bug.ts': `export const count: number = "not a number";`,
    });
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => f.ruleId === 'ts2322')).toBeDefined();
  });
});
