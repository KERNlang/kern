import { Project } from 'ts-morph';
import { runTSCDiagnostics } from '../src/external-tools.js';

// kern-guard observed TS2741 ("Property 'children' is missing") firing in
// review mode on JSX call sites that DO supply children between
// `<Tag>...</Tag>` — and where `tsc --noEmit` locally passes. Root cause:
// the worker shallow-clones the PR without `node_modules`, so `@types/react`
// is unreachable from ts-morph's project. Without `JSX.ElementChildrenAttribute`
// (provided by the JSX global namespace from @types/react), TS no longer
// routes `<Tag>...</Tag>` content to the `children` prop. Every JSX user
// component that declares `children: ReactNode` as required then reports a
// false TS2741. This whole class is environmental — same shape as
// @types/node-globals (kern-sight PR #7). Suppress when the file shows
// the JSX namespace is also broken (TS7026 or TS2503-JSX co-firing).

function jsxProject(files: Record<string, string>) {
  // No tsConfigFilePath, no node_modules — mirrors the worker's sparse
  // clone. jsx mode is set so the parser accepts the syntax, but the
  // global JSX namespace (normally from @types/react) is absent.
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      strict: true,
      target: 99,
      module: 99,
      moduleResolution: 100,
      jsx: 4 /* Preserve */,
      noEmit: true,
      lib: ['es2022', 'dom'],
    },
  });
  for (const [path, contents] of Object.entries(files)) {
    project.createSourceFile(path, contents);
  }
  return project;
}

describe('runTSCDiagnostics — JSX namespace noise (kern-guard PR #431)', () => {
  it('drops TS2741 "children is missing" when JSX.IntrinsicElements is also missing', () => {
    const project = jsxProject({
      '/Card.tsx': `
        // Local React-shaped types so the example compiles without
        // node_modules. The point is the JSX global namespace is still
        // absent — same as the sparse-clone case.
        type ReactNode = unknown;
        export function Card(props: {
          title?: ReactNode;
          actions?: ReactNode;
          children: ReactNode;
        }) {
          return props.children;
        }
      `,
      '/page.tsx': `
        import { Card } from './Card.js';
        export default function Page() {
          return (
            <Card title="A" actions={<a href="/x">x</a>}>
              <p>real children content</p>
            </Card>
          );
        }
      `,
    });
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    const ts2741Children = findings.filter(
      (f) => f.ruleId === 'ts2741' && /Property 'children' is missing/.test(f.message),
    );
    expect(ts2741Children).toEqual([]);
  });

  it('drops TS7026 (no JSX.IntrinsicElements) unconditionally in review mode', () => {
    const project = jsxProject({
      '/page.tsx': `
        export default function Page() {
          return <div>hello</div>;
        }
      `,
    });
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    expect(findings.find((f) => f.ruleId === 'ts7026')).toBeUndefined();
  });

  it('STILL surfaces TS2741 when the missing prop is NOT `children` (real bug)', () => {
    // Same broken-JSX-namespace file, but the consumer omits a different
    // required prop. children-inference is the noisy path; non-children
    // missing-prop diagnostics must keep firing — otherwise we'd hide
    // real "you forgot to pass `userId`" bugs that the dev should see.
    const project = jsxProject({
      '/Widget.tsx': `
        type ReactNode = unknown;
        export function Widget(props: {
          userId: string;
          children?: ReactNode;
        }) {
          return props.userId;
        }
      `,
      '/page.tsx': `
        import { Widget } from './Widget.js';
        export default function Page() {
          return <Widget />;
        }
      `,
    });
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true });
    const realMissingProp = findings.find(
      (f) => f.ruleId === 'ts2741' && /Property 'userId' is missing/.test(f.message),
    );
    expect(realMissingProp).toBeDefined();
  });

  it('does NOT suppress in lint mode (downgradeProjectLoadingErrors=false)', () => {
    // --lint surfaces every diagnostic so real env-misconfig (e.g.
    // the dev's host project genuinely missing @types/react) is visible.
    const project = jsxProject({
      '/page.tsx': `
        export default function Page() {
          return <div>hello</div>;
        }
      `,
    });
    const findings = runTSCDiagnostics(project, { downgradeProjectLoadingErrors: false });
    expect(findings.find((f) => f.ruleId === 'ts7026')).toBeDefined();
  });
});
