/**
 * Fitness test for the JSX usage index — Phase 1 of cross-file ProvenanceChain
 * extension (Plan v3, see /private/tmp/kern-lang-handoff-cross-file-provenance.md).
 *
 * Forge target: `src/jsx-usage-index.ts` must export
 *
 *   buildJsxUsageIndex(project: Project, graph: GraphResult): JsxUsageIndex
 *
 * where
 *
 *   interface JsxUsageIndex {
 *     // Look up every JSX usage site of `exportName` declared in `file`.
 *     // `file` is canonicalised internally — callers may pass either the
 *     // display path or the canonical path.
 *     findUsages(file: string, exportName: string): JsxUsageSite[];
 *   }
 *
 *   interface JsxUsageSite {
 *     file: string;                 // canonical path of the consuming file
 *     line: number;                 // 1-indexed line of the opening JSX tag
 *     col: number;                  // 1-indexed col of the opening JSX tag
 *     localName: string;            // the identifier used at the JSX site
 *     parentComponentName?: string; // enclosing component fn/const name, if any
 *     inlinePropNames: string[];    // attributes whose value is an inline
 *                                   // object literal, array literal, or
 *                                   // arrow function (lexicographic order)
 *   }
 *
 * The index must:
 *   - Reuse the supplied ts-morph Project + GraphResult (no `new Project()`).
 *   - NOT mutate the call-graph (preserves dead-export semantics: a Card
 *     rendered only by Card.test.tsx is still a dead export).
 *   - Resolve named, default, namespace-member, aliased, and barrel-re-exported
 *     imports back to the canonical declaration `file#exportName`.
 *   - Exclude `*.test.tsx`, `*.test.ts`, `*.spec.tsx`, `*.spec.ts`, and any
 *     file under a `__tests__` segment from contributing usage sites.
 *   - Detect inline props: attribute values whose expression is an
 *     ObjectLiteralExpression, ArrayLiteralExpression, ArrowFunction, or
 *     FunctionExpression count; bare identifiers and member-access expressions
 *     do not.
 *
 * Plan v3 design notes (informational — these tests are the source of truth):
 *   - Lazy: callers construct the index on demand from the same Project the
 *     pipeline already owns. Single AST walk over all in-graph .tsx/.jsx files.
 *   - Append-only invariant lives in `extendCrossFileChains`, NOT here. The
 *     index is read-only state.
 */

import { Project } from 'ts-morph';
import { resolveImportGraph } from '../src/graph.js';
import { buildJsxUsageIndex } from '../src/jsx-usage-index.js';

function createTestProject(): Project {
  return new Project({
    compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100, jsx: 4 },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
}

function setup(
  files: Array<{ path: string; code: string }>,
  entries: string[],
): { index: ReturnType<typeof buildJsxUsageIndex> } {
  const project = createTestProject();
  for (const f of files) project.createSourceFile(f.path, f.code, { overwrite: true });
  const graph = resolveImportGraph(entries, { project });
  return { index: buildJsxUsageIndex(project, graph) };
}

describe('buildJsxUsageIndex', () => {
  it('1. named import + JSX is indexed as a usage of the declared symbol', () => {
    const { index } = setup(
      [
        { path: '/src/foo.tsx', code: 'export function Foo() { return null; }\n' },
        {
          path: '/src/app.tsx',
          code: "import { Foo } from './foo';\nexport function App() { return <Foo />; }\n",
        },
      ],
      ['/src/app.tsx'],
    );

    const usages = index.findUsages('/src/foo.tsx', 'Foo');
    expect(usages).toHaveLength(1);
    expect(usages[0].file).toMatch(/app\.tsx$/);
    expect(usages[0].localName).toBe('Foo');
    expect(usages[0].inlinePropNames).toEqual([]);
  });

  it('2. default import + JSX is indexed under the declared symbol', () => {
    const { index } = setup(
      [
        { path: '/src/foo.tsx', code: 'export default function Foo() { return null; }\n' },
        {
          path: '/src/app.tsx',
          code: "import Foo from './foo';\nexport function App() { return <Foo />; }\n",
        },
      ],
      ['/src/app.tsx'],
    );

    const usages = index.findUsages('/src/foo.tsx', 'Foo');
    expect(usages).toHaveLength(1);
    expect(usages[0].file).toMatch(/app\.tsx$/);
    expect(usages[0].localName).toBe('Foo');
  });

  it('3. namespace import with member-access JSX (`<M.Foo />`) is indexed', () => {
    const { index } = setup(
      [
        { path: '/src/mod.tsx', code: 'export function Foo() { return null; }\n' },
        {
          path: '/src/app.tsx',
          code: "import * as M from './mod';\nexport function App() { return <M.Foo />; }\n",
        },
      ],
      ['/src/app.tsx'],
    );

    const usages = index.findUsages('/src/mod.tsx', 'Foo');
    expect(usages).toHaveLength(1);
    expect(usages[0].localName).toBe('M.Foo');
  });

  it('4. aliased named import (`import { Foo as Bar }`) resolves back to the canonical export', () => {
    const { index } = setup(
      [
        { path: '/src/foo.tsx', code: 'export function Foo() { return null; }\n' },
        {
          path: '/src/app.tsx',
          code: "import { Foo as Bar } from './foo';\nexport function App() { return <Bar />; }\n",
        },
      ],
      ['/src/app.tsx'],
    );

    const usages = index.findUsages('/src/foo.tsx', 'Foo');
    expect(usages).toHaveLength(1);
    expect(usages[0].localName).toBe('Bar');

    // Lookup under the alias should NOT find anything — the index keys on the
    // canonical declaration name, not the local alias.
    expect(index.findUsages('/src/foo.tsx', 'Bar')).toEqual([]);
  });

  it('5. default + member-access (`<Lib.Foo />`) where Lib is a default import resolves Lib', () => {
    const { index } = setup(
      [
        {
          path: '/src/lib.tsx',
          code: 'export function Foo() { return null; }\nexport default { Foo };\n',
        },
        {
          path: '/src/app.tsx',
          code: "import Lib from './lib';\nexport function App() { return <Lib.Foo />; }\n",
        },
      ],
      ['/src/app.tsx'],
    );

    // Member-access on a default import — we index this as a usage of the
    // namespace root (Lib resolves to lib.tsx's default export). The Foo
    // suffix is preserved in localName for diagnostics.
    const usages = index.findUsages('/src/lib.tsx', 'default');
    expect(usages.length).toBeGreaterThanOrEqual(1);
    expect(usages.some((u) => u.localName === 'Lib.Foo')).toBe(true);
  });

  it('6. conditional JSX (`{cond && <Foo />}`) counts as a single usage site', () => {
    const { index } = setup(
      [
        { path: '/src/foo.tsx', code: 'export function Foo() { return null; }\n' },
        {
          path: '/src/app.tsx',
          code:
            "import { Foo } from './foo';\nexport function App({ show }: { show: boolean }) {\n  return <div>{show && <Foo />}</div>;\n}\n",
        },
      ],
      ['/src/app.tsx'],
    );

    const usages = index.findUsages('/src/foo.tsx', 'Foo');
    expect(usages).toHaveLength(1);
  });

  it('7. JSX inside `.map()` callbacks counts as a usage site of the rendered component', () => {
    const { index } = setup(
      [
        { path: '/src/row.tsx', code: 'export function Row(_: { id: string }) { return null; }\n' },
        {
          path: '/src/app.tsx',
          code:
            "import { Row } from './row';\nexport function App({ items }: { items: string[] }) {\n  return <div>{items.map((i) => <Row key={i} id={i} />)}</div>;\n}\n",
        },
      ],
      ['/src/app.tsx'],
    );

    const usages = index.findUsages('/src/row.tsx', 'Row');
    expect(usages).toHaveLength(1);
    expect(usages[0].localName).toBe('Row');
  });

  it('8. inline object literal prop (`<Foo data={{}} />`) is flagged in inlinePropNames', () => {
    const { index } = setup(
      [
        {
          path: '/src/foo.tsx',
          code: 'export function Foo(_: { data: unknown }) { return null; }\n',
        },
        {
          path: '/src/app.tsx',
          code:
            "import { Foo } from './foo';\nexport function App() { return <Foo data={{ a: 1 }} />; }\n",
        },
      ],
      ['/src/app.tsx'],
    );

    const usages = index.findUsages('/src/foo.tsx', 'Foo');
    expect(usages).toHaveLength(1);
    expect(usages[0].inlinePropNames).toEqual(['data']);
  });

  it('9. inline array literal prop (`<Foo items={[]} />`) is flagged in inlinePropNames', () => {
    const { index } = setup(
      [
        {
          path: '/src/foo.tsx',
          code: 'export function Foo(_: { items: unknown[] }) { return null; }\n',
        },
        {
          path: '/src/app.tsx',
          code:
            "import { Foo } from './foo';\nexport function App() { return <Foo items={[1, 2]} />; }\n",
        },
      ],
      ['/src/app.tsx'],
    );

    const usages = index.findUsages('/src/foo.tsx', 'Foo');
    expect(usages).toHaveLength(1);
    expect(usages[0].inlinePropNames).toEqual(['items']);
  });

  it('10. inline arrow-function prop (`<Foo onClick={() => {}} />`) is flagged in inlinePropNames', () => {
    const { index } = setup(
      [
        {
          path: '/src/foo.tsx',
          code: 'export function Foo(_: { onClick: () => void }) { return null; }\n',
        },
        {
          path: '/src/app.tsx',
          code:
            "import { Foo } from './foo';\nexport function App() { return <Foo onClick={() => undefined} />; }\n",
        },
      ],
      ['/src/app.tsx'],
    );

    const usages = index.findUsages('/src/foo.tsx', 'Foo');
    expect(usages).toHaveLength(1);
    expect(usages[0].inlinePropNames).toEqual(['onClick']);
  });

  it('11. identifier-valued prop (`<Foo data={memo} />`) is NOT flagged inline', () => {
    const { index } = setup(
      [
        {
          path: '/src/foo.tsx',
          code: 'export function Foo(_: { data: unknown }) { return null; }\n',
        },
        {
          path: '/src/app.tsx',
          code:
            "import { useMemo } from 'react';\nimport { Foo } from './foo';\nexport function App() {\n  const memo = useMemo(() => ({ a: 1 }), []);\n  return <Foo data={memo} />;\n}\n",
        },
      ],
      ['/src/app.tsx'],
    );

    const usages = index.findUsages('/src/foo.tsx', 'Foo');
    expect(usages).toHaveLength(1);
    expect(usages[0].inlinePropNames).toEqual([]);
  });

  it('12. parent component is attributed to the enclosing function declaration', () => {
    const { index } = setup(
      [
        { path: '/src/foo.tsx', code: 'export function Foo() { return null; }\n' },
        {
          path: '/src/app.tsx',
          code:
            "import { Foo } from './foo';\nexport function App() { return <Foo />; }\nexport const Sidebar = () => <Foo />;\n",
        },
      ],
      ['/src/app.tsx'],
    );

    const usages = index.findUsages('/src/foo.tsx', 'Foo');
    expect(usages).toHaveLength(2);
    const parents = usages.map((u) => u.parentComponentName).sort();
    expect(parents).toEqual(['App', 'Sidebar']);
  });

  it('13. barrel re-export resolves usages back to the original declaration file', () => {
    const { index } = setup(
      [
        { path: '/src/components/foo.tsx', code: 'export function Foo() { return null; }\n' },
        {
          path: '/src/components/index.ts',
          code: "export { Foo } from './foo';\n",
        },
        {
          path: '/src/app.tsx',
          code:
            "import { Foo } from './components';\nexport function App() { return <Foo />; }\n",
        },
      ],
      ['/src/app.tsx'],
    );

    // Looking up by the canonical declaration path must find the usage even
    // though the consumer imported through the barrel.
    const directHits = index.findUsages('/src/components/foo.tsx', 'Foo');
    expect(directHits).toHaveLength(1);
    expect(directHits[0].file).toMatch(/app\.tsx$/);
  });

  it('14. test files (`*.test.tsx`) do NOT contribute usage sites', () => {
    const { index } = setup(
      [
        { path: '/src/card.tsx', code: 'export function Card() { return null; }\n' },
        {
          path: '/src/card.test.tsx',
          code:
            "import { Card } from './card';\nexport function renderCard() { return <Card />; }\n",
        },
      ],
      ['/src/card.test.tsx'],
    );

    // Card has zero PRODUCTION usages — only a test renders it. Per Codex Q1,
    // the index must apply test-file exclusion or dead-export will stop
    // flagging Card (it would look "used" from the test file).
    const usages = index.findUsages('/src/card.tsx', 'Card');
    expect(usages).toEqual([]);
  });
});
