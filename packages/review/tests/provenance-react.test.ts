/**
 * Provenance chain coverage for the React rule pack.
 *
 * Asserts that the three pilot rules (exhaustive-deps, stale-closure,
 * memoized-child-inline-prop) populate `Finding.provenance` with a non-empty
 * `steps[]` array carrying the expected kinds/categories/labels. Downstream
 * products (kern-sight hover, kern-guard PR comments, the SARIF reporter)
 * read this same field — these tests pin the shape they rely on.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { clearReviewCache, resetFsProject, reviewGraph, reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const cfg: ReviewConfig = { target: 'web' };

describe('Provenance chains — React rules', () => {
  describe('memoized-child-inline-prop', () => {
    it('emits a 3-step chain: memo-boundary → prop-pass → render-cycle', () => {
      const src = `
import { memo } from 'react';
const Card = memo(function Card(props: { onTap: () => void }) {
  return <button onClick={props.onTap}>tap</button>;
});
export function List() {
  return <Card onTap={() => console.log('hi')} />;
}
`;
      const report = reviewSource(src, 'list.tsx', cfg);
      const f = report.findings.find((x) => x.ruleId === 'memoized-child-inline-prop');
      expect(f).toBeDefined();
      expect(f!.provenance).toBeDefined();
      expect(f!.provenance!.steps.length).toBe(3);

      const [boundary, propPass, sink] = f!.provenance!.steps;
      expect(boundary.kind).toBe('boundary');
      expect(boundary.category).toBe('memo-boundary');
      expect(boundary.label).toContain('Card');

      expect(propPass.kind).toBe('call');
      expect(propPass.category).toBe('prop-pass');
      expect(propPass.label).toContain('onTap');

      expect(sink.kind).toBe('sink');
      expect(sink.category).toBe('render-cycle');
    });

    it('falls back to import-kind boundary when memo lives in another file', () => {
      const src = `
import { Card } from './memo-card';
export function List() {
  return <Card onTap={() => 1} />;
}
`;
      // We don't have a real ./memo-card file here, so the rule's
      // cross-file memo check returns false and the finding shouldn't fire.
      // This test asserts the rule still doesn't crash on the import path.
      expect(() => reviewSource(src, 'list.tsx', cfg)).not.toThrow();
    });

    it('namespace + barrel re-export — <UI.Button /> resolves through `export { Button } from`', () => {
      // Codex Phase 7-v3 review: `import * as UI from './index'; <UI.Button />`
      // where `./index.ts` does `export { Button } from './button'` was
      // pointing the cross-file extension at the barrel and finding no memo
      // wrap there (since the actual decl lives in `./button`). The fix uses
      // `getExportedDeclarations()` to chase the re-export chain in both
      // `isMemoizedExport` (rule side) and `findMemoBoundary` (walker side).
      const repo = mkdtempSync(join(tmpdir(), 'kern-ns-barrel-'));
      function write(path: string, content: string): void {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      }
      try {
        write(
          join(repo, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              target: 'ES2022',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              jsx: 'preserve',
              strict: true,
              esModuleInterop: true,
              skipLibCheck: true,
            },
            include: ['src/**/*'],
          }),
        );
        write(join(repo, 'package.json'), JSON.stringify({ name: 'ns-barrel', private: true }));
        write(
          join(repo, 'src/button.tsx'),
          `import { memo } from 'react';
export const Button = memo(function Btn(_: { onClick: () => void }) { return null as any; });
`,
        );
        write(join(repo, 'src/index.ts'), `export { Button } from './button';\n`);
        write(
          join(repo, 'src/app.tsx'),
          `import * as UI from './index';
export function App() { return <UI.Button onClick={() => {}} />; }
`,
        );
        const reports = reviewGraph(
          [join(repo, 'src/app.tsx'), join(repo, 'src/index.ts'), join(repo, 'src/button.tsx')],
          { noCache: true, target: 'web' },
        );
        const app = reports.find((r) => r.filePath === join(repo, 'src/app.tsx'));
        const f = app!.findings.find((x) => x.ruleId === 'memoized-child-inline-prop');
        expect(f).toBeDefined();
        // Cross-file extension must fire and land on the REAL decl file
        // (`button.tsx`), not on the barrel (`index.ts`).
        const lastStep = f!.provenance!.steps[f!.provenance!.steps.length - 1];
        expect(lastStep.location.file).toContain('button.tsx');
        expect(lastStep.location.file).not.toContain('index.ts');
      } finally {
        rmSync(repo, { recursive: true, force: true });
        resetFsProject();
        clearReviewCache();
      }
    });

    it('namespace-imported memoised child is detected via <UI.Button /> (Gemini Phase 7 gap)', () => {
      // Gemini Phase 7 review: `findImportBinding` previously only checked
      // default + named imports, missing `<UI.Button />` with `import * as UI
      // from './lib'`. This test pins the fix — graph mode resolves the
      // property access against the namespace's export.
      const repo = mkdtempSync(join(tmpdir(), 'kern-namespace-memo-'));
      function write(path: string, content: string): void {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      }
      try {
        write(
          join(repo, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              target: 'ES2022',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              jsx: 'preserve',
              strict: true,
              esModuleInterop: true,
              skipLibCheck: true,
            },
            include: ['src/**/*'],
          }),
        );
        write(join(repo, 'package.json'), JSON.stringify({ name: 'ns-memo', private: true }));
        write(
          join(repo, 'src/lib.tsx'),
          `import { memo } from 'react';
export const Button = memo(function Btn(_: { onClick: () => void }) { return null as any; });
`,
        );
        write(
          join(repo, 'src/app.tsx'),
          `import * as UI from './lib';
export function App() { return <UI.Button onClick={() => {}} />; }
`,
        );
        const reports = reviewGraph([join(repo, 'src/app.tsx'), join(repo, 'src/lib.tsx')], {
          noCache: true,
          target: 'web',
        });
        const app = reports.find((r) => r.filePath === join(repo, 'src/app.tsx'));
        const f = app!.findings.find((x) => x.ruleId === 'memoized-child-inline-prop');
        expect(f).toBeDefined();
        // Intra-file chain is 3 steps; cross-file extension appends 1 step
        // landing in lib.tsx — the namespace fix makes that extension fire.
        expect(f!.provenance!.steps.length).toBeGreaterThanOrEqual(4);
        const lastStep = f!.provenance!.steps[f!.provenance!.steps.length - 1];
        expect(lastStep.location.file).toContain('lib.tsx');
      } finally {
        rmSync(repo, { recursive: true, force: true });
        resetFsProject();
        clearReviewCache();
      }
    });
  });

  describe('stale-closure', () => {
    it('emits a chain pointing at empty deps → timer → stale read', () => {
      const src = `
import { useEffect, useState } from 'react';
export function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setInterval(() => console.log(count), 1000);
  }, []);
  return <div>{count}</div>;
}
`;
      const report = reviewSource(src, 'counter.tsx', cfg);
      const f = report.findings.find((x) => x.ruleId === 'stale-closure');
      expect(f).toBeDefined();
      expect(f!.provenance).toBeDefined();
      expect(f!.provenance!.steps.length).toBe(3);

      const [hookDep, capture, sink] = f!.provenance!.steps;
      expect(hookDep.kind).toBe('boundary');
      expect(hookDep.category).toBe('hook-dep');
      expect(hookDep.label).toContain('[]');

      expect(capture.kind).toBe('call');
      expect(capture.category).toBe('closure-capture');
      expect(capture.label).toContain('setInterval');

      expect(sink.kind).toBe('sink');
      expect(sink.category).toBe('render-cycle');
    });
  });

  describe('exhaustive-deps', () => {
    it('emits a chain: value-decl → hook-body read → deps array', () => {
      const src = `
import { useEffect, useState } from 'react';
export function Profile({ userId }: { userId: string }) {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    fetch('/u/' + userId).then((r) => setData(String(r)));
  }, []);
  return <div>{data}</div>;
}
`;
      const report = reviewSource(src, 'profile.tsx', cfg);
      const f = report.findings.find((x) => x.ruleId === 'exhaustive-deps');
      expect(f).toBeDefined();
      expect(f!.provenance).toBeDefined();
      // We expect 3 steps when the declaration of a missing dep is resolvable.
      expect(f!.provenance!.steps.length).toBe(3);

      const [decl, read, deps] = f!.provenance!.steps;
      expect(decl.kind).toBe('source');
      expect(decl.category).toBe('value-decl');
      expect(decl.label).toContain('userId');

      expect(read.kind).toBe('call');
      expect(read.category).toBe('hook-body');
      expect(read.label).toContain('userId');

      expect(deps.kind).toBe('boundary');
      expect(deps.category).toBe('hook-dep');
      expect(deps.label).toContain('userId');
    });

    it('chain stays valid (deps step only) when the declaration is unresolvable', () => {
      // No declaration of `external` in the enclosing fn — the rule's filter
      // requires definedInEnclosing so `external` won't be flagged. This test
      // pins behavior: when nothing fires, no chain to assert.
      const src = `
import { useEffect } from 'react';
declare const external: string;
export function C() {
  useEffect(() => { console.log(external); }, []);
  return null;
}
`;
      const report = reviewSource(src, 'c.tsx', cfg);
      const f = report.findings.find((x) => x.ruleId === 'exhaustive-deps');
      // Either no finding (external is module-level, ignored) or, if fired,
      // the chain has at least the deps step.
      if (f && f.provenance) {
        expect(f.provenance.steps.some((s) => s.category === 'hook-dep')).toBe(true);
      }
    });
  });

  describe('chain ceiling', () => {
    it('no chain exceeds 5 steps (Sight hover budget)', () => {
      const src = `
import { useEffect, useState, memo } from 'react';
const Heavy = memo(function Heavy(p: { onA: () => void; onB: () => void }) {
  return <div onClick={p.onA} />;
});
export function Page() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  useEffect(() => {
    setInterval(() => console.log(a, b), 1000);
  }, []);
  return <Heavy onA={() => setA(a + 1)} onB={() => setB(b + 1)} />;
}
`;
      const report = reviewSource(src, 'page.tsx', cfg);
      for (const f of report.findings) {
        if (f.provenance) expect(f.provenance.steps.length).toBeLessThanOrEqual(5);
      }
    });
  });

  describe('effect-self-update-loop', () => {
    it('emits a chain: hook-dep → state-write → render-cycle', () => {
      const src = `
import { useEffect, useState } from 'react';
export function Bouncer() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(count + 1);
  }, [count]);
  return <div>{count}</div>;
}
`;
      const report = reviewSource(src, 'bouncer.tsx', cfg);
      const f = report.findings.find((x) => x.ruleId === 'effect-self-update-loop');
      expect(f).toBeDefined();
      expect(f!.provenance).toBeDefined();
      const cats = f!.provenance!.steps.map((s) => s.category);
      expect(cats).toEqual(['hook-dep', 'state-write', 'render-cycle']);
    });
  });

  describe('hook-order', () => {
    it('emits a chain: control-flow → hook-call', () => {
      const src = `
import { useState } from 'react';
export function Maybe({ enabled }: { enabled: boolean }) {
  if (enabled) {
    const [v, setV] = useState(0);
    return <div>{v}</div>;
  }
  return null;
}
`;
      const report = reviewSource(src, 'maybe.tsx', cfg);
      const f = report.findings.find((x) => x.ruleId === 'hook-order');
      expect(f).toBeDefined();
      expect(f!.provenance).toBeDefined();
      const [outer, inner] = f!.provenance!.steps;
      expect(outer.category).toBe('control-flow');
      expect(inner.category).toBe('hook-call');
      expect(inner.label).toContain('useState');
    });
  });

  describe('async-effect', () => {
    it('emits a chain: effect-schedule → render-cycle', () => {
      const src = `
import { useEffect } from 'react';
export function Loader() {
  useEffect(async () => {
    await Promise.resolve();
  }, []);
  return null;
}
`;
      const report = reviewSource(src, 'loader.tsx', cfg);
      const f = report.findings.find((x) => x.ruleId === 'async-effect');
      expect(f).toBeDefined();
      expect(f!.provenance).toBeDefined();
      expect(f!.provenance!.steps[0].category).toBe('effect-schedule');
    });
  });

  describe('inline-context-value', () => {
    it('emits a chain: context-provider → prop-pass → render-cycle', () => {
      const src = `
import { createContext } from 'react';
const Ctx = createContext({ name: '' });
export function Provider({ name }: { name: string }) {
  return <Ctx.Provider value={{ name }}>x</Ctx.Provider>;
}
`;
      const report = reviewSource(src, 'provider.tsx', cfg);
      const f = report.findings.find((x) => x.ruleId === 'inline-context-value');
      expect(f).toBeDefined();
      expect(f!.provenance).toBeDefined();
      const cats = f!.provenance!.steps.map((s) => s.category);
      expect(cats).toEqual(['context-provider', 'prop-pass', 'render-cycle']);
    });
  });

  describe('react-memo-defeated-by-spread', () => {
    it('emits a chain: memo-boundary → prop-pass → render-cycle', () => {
      const src = `
import { memo } from 'react';
const Inner = memo(function Inner(p: { a: number }) { return <div>{p.a}</div>; });
export function Wrap(props: { a: number }) {
  return <Inner {...props} />;
}
`;
      const report = reviewSource(src, 'wrap.tsx', cfg);
      const f = report.findings.find((x) => x.ruleId === 'react-memo-defeated-by-spread');
      expect(f).toBeDefined();
      expect(f!.provenance).toBeDefined();
      const cats = f!.provenance!.steps.map((s) => s.category);
      expect(cats).toEqual(['memo-boundary', 'prop-pass', 'render-cycle']);
    });
  });

  describe('unstable-key', () => {
    it('emits a chain: list-render → key-collision when key={index}', () => {
      const src = `
export function List({ items }: { items: string[] }) {
  return <ul>{items.map((item, i) => <li key={i}>{item}</li>)}</ul>;
}
`;
      const report = reviewSource(src, 'list.tsx', cfg);
      const f = report.findings.find((x) => x.ruleId === 'unstable-key');
      expect(f).toBeDefined();
      expect(f!.provenance).toBeDefined();
      const cats = f!.provenance!.steps.map((s) => s.category);
      expect(cats).toEqual(['list-render', 'key-collision']);
    });
  });

  describe('state-explosion', () => {
    it('emits a chain: state-decl → render-body → complexity', () => {
      const src = `
import { useState } from 'react';
export function Wizard() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  const [d, setD] = useState(0);
  const [e, setE] = useState(0);
  const [f, setF] = useState(0);
  return <div>{a + b + c + d + e + f}</div>;
}
`;
      const report = reviewSource(src, 'wizard.tsx', cfg);
      const f = report.findings.find((x) => x.ruleId === 'state-explosion');
      expect(f).toBeDefined();
      expect(f!.provenance).toBeDefined();
      const cats = f!.provenance!.steps.map((s) => s.category);
      expect(cats).toEqual(['state-decl', 'render-body', 'complexity']);
    });
  });

  describe('ref-in-render', () => {
    it('emits a chain: ref-decl → render-cycle', () => {
      const src = `
import { useRef } from 'react';
export function Bad() {
  const myRef = useRef<number>(0);
  myRef.current = 42;
  return <div>{myRef.current}</div>;
}
`;
      const report = reviewSource(src, 'bad.tsx', cfg);
      const f = report.findings.find((x) => x.ruleId === 'ref-in-render');
      expect(f).toBeDefined();
      expect(f!.provenance).toBeDefined();
      const cats = f!.provenance!.steps.map((s) => s.category);
      expect(cats).toEqual(['ref-decl', 'render-cycle']);
      expect(f!.provenance!.steps[0].label).toContain('useRef');
    });
  });

  describe('reducer-mutation', () => {
    it('emits a chain: reducer → mutation on direct property assignment', () => {
      const src = `
import { useReducer } from 'react';
type S = { count: number };
type A = { type: 'inc' };
function reducer(state: S, action: A): S {
  state.count = state.count + 1;
  return state;
}
export function Counter() {
  const [s, dispatch] = useReducer(reducer, { count: 0 });
  return <button onClick={() => dispatch({ type: 'inc' })}>{s.count}</button>;
}
`;
      const report = reviewSource(src, 'reducer.ts', cfg);
      const f = report.findings.find((x) => x.ruleId === 'reducer-mutation');
      expect(f).toBeDefined();
      expect(f!.provenance).toBeDefined();
      const cats = f!.provenance!.steps.map((s) => s.category);
      expect(cats).toEqual(['reducer', 'mutation']);
    });
  });

  // Plan v3 v2 — parent-rerender-via-state cross-file extension. The rule
  // emits its 3-step intra-file chain, and when the unnecessarily-re-rendered
  // child is imported, a forward-import walker appends one more step pointing
  // at the child's declaration file.
  describe('parent-rerender-via-state cross-file extension', () => {
    let repo: string;
    afterEach(() => {
      if (repo) rmSync(repo, { recursive: true, force: true });
      resetFsProject();
      clearReviewCache();
    });

    function write(path: string, content: string): void {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }

    it('appends an import-boundary step pointing at the child declaration file', () => {
      repo = mkdtempSync(join(tmpdir(), 'kern-prv-react-'));
      write(
        join(repo, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            jsx: 'preserve',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
          },
          include: ['src/**/*'],
        }),
      );
      write(join(repo, 'package.json'), JSON.stringify({ name: 'prv-react-cross', private: true }));

      // Child declared in its own file — no React.memo wrap, the rule fires
      // because the parent has state but doesn't pass it to <Child />.
      write(
        join(repo, 'src/child.tsx'),
        `export function Child(props: { label: string }) { return <span>{props.label}</span>; }\n`,
      );
      write(
        join(repo, 'src/parent.tsx'),
        `import { useState } from 'react';
import { Child } from './child';
export function Parent() {
  const [count, setCount] = useState(0);
  return (
    <div onClick={() => setCount(count + 1)}>
      <Child label="static" />
    </div>
  );
}
`,
      );

      const reports = reviewGraph([join(repo, 'src/parent.tsx')], { noCache: true, target: 'web' });
      const parentReport = reports.find((r) => r.filePath === join(repo, 'src/parent.tsx'));
      expect(parentReport).toBeDefined();
      const finding = parentReport!.findings.find((f) => f.ruleId === 'parent-rerender-via-state');
      expect(finding).toBeDefined();
      expect(finding!.provenance).toBeDefined();

      // Intra-file chain was 3 steps (state-decl, parent-render, render-cycle).
      // The forward-import walker must have appended one step landing in
      // child.tsx — the chain length grows by 1.
      const steps = finding!.provenance!.steps;
      expect(steps.length).toBeGreaterThanOrEqual(4);
      const lastStep = steps[steps.length - 1];
      expect(lastStep.location.file).toContain('child.tsx');
      expect(lastStep.kind).toBe('import');
    });

    it('memo-component-widely-defeated fires on the memo declaration when ≥2 parents pass inline props', () => {
      repo = mkdtempSync(join(tmpdir(), 'kern-prv-react-widedef-'));
      function write(path: string, content: string): void {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      }
      write(
        join(repo, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            jsx: 'preserve',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
          },
          include: ['src/**/*'],
        }),
      );
      write(join(repo, 'package.json'), JSON.stringify({ name: 'widedef', private: true }));
      write(
        join(repo, 'src/btn.tsx'),
        `import { memo } from 'react';
export const MemoBtn = memo(function Btn(_: { onClick: () => void }) { return null as any; });
`,
      );
      write(
        join(repo, 'src/a.tsx'),
        `import { MemoBtn } from './btn';
export function ParentA() { return <MemoBtn onClick={() => {}} />; }
`,
      );
      write(
        join(repo, 'src/b.tsx'),
        `import { MemoBtn } from './btn';
export function ParentB() { return <MemoBtn onClick={() => {}} />; }
`,
      );

      const reports = reviewGraph([join(repo, 'src/a.tsx'), join(repo, 'src/b.tsx'), join(repo, 'src/btn.tsx')], {
        noCache: true,
        target: 'web',
      });
      const btnReport = reports.find((r) => r.filePath === join(repo, 'src/btn.tsx'));
      expect(btnReport).toBeDefined();
      const finding = btnReport!.findings.find((f) => f.ruleId === 'memo-component-widely-defeated');
      expect(finding).toBeDefined();
      // 2-step intra-file chain + N defeater steps (one per defeating parent).
      // Two defeaters here → chain length ≥ 4.
      expect(finding!.provenance!.steps.length).toBeGreaterThanOrEqual(4);
      const labels = finding!.provenance!.steps.map((s) => s.label ?? '').join(' || ');
      expect(labels).toContain('ParentA');
      expect(labels).toContain('ParentB');
    });

    it('memo-component-widely-defeated detects separate-export pattern (`const X = memo(); export { X }`)', () => {
      // Gemini + OpenCode Phase 7-v3 review: the rule originally only fired
      // when the VariableStatement had an inline `export` modifier. When the
      // export was a separate `export { X }` ExportDeclaration, the rule
      // silently skipped the component even though consumers could still
      // import + defeat it.
      repo = mkdtempSync(join(tmpdir(), 'kern-prv-react-reexport-'));
      function write(path: string, content: string): void {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      }
      write(
        join(repo, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            jsx: 'preserve',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
          },
          include: ['src/**/*'],
        }),
      );
      write(join(repo, 'package.json'), JSON.stringify({ name: 'reexport-widedef', private: true }));
      write(
        join(repo, 'src/btn.tsx'),
        `import { memo } from 'react';
const MemoBtn = memo(function Btn(_: { onClick: () => void }) { return null as any; });
export { MemoBtn };
`,
      );
      write(
        join(repo, 'src/a.tsx'),
        `import { MemoBtn } from './btn';
export function ParentA() { return <MemoBtn onClick={() => {}} />; }
`,
      );
      write(
        join(repo, 'src/b.tsx'),
        `import { MemoBtn } from './btn';
export function ParentB() { return <MemoBtn onClick={() => {}} />; }
`,
      );

      const reports = reviewGraph([join(repo, 'src/a.tsx'), join(repo, 'src/b.tsx'), join(repo, 'src/btn.tsx')], {
        noCache: true,
        target: 'web',
      });
      const btnReport = reports.find((r) => r.filePath === join(repo, 'src/btn.tsx'));
      expect(btnReport).toBeDefined();
      const finding = btnReport!.findings.find((f) => f.ruleId === 'memo-component-widely-defeated');
      expect(finding).toBeDefined();
      const labels = finding!.provenance!.steps.map((s) => s.label ?? '').join(' || ');
      expect(labels).toContain('ParentA');
      expect(labels).toContain('ParentB');
    });

    it('memo-component-widely-defeated detects `export default memo(...)` default-export pattern', () => {
      // Gemini Phase 7-v3 review: the rule originally only scanned
      // VariableDeclaration nodes, missing `export default memo(...)` where
      // the memo call lives in an ExportAssignment.
      repo = mkdtempSync(join(tmpdir(), 'kern-prv-react-default-'));
      function write(path: string, content: string): void {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      }
      write(
        join(repo, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            jsx: 'preserve',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
          },
          include: ['src/**/*'],
        }),
      );
      write(join(repo, 'package.json'), JSON.stringify({ name: 'default-widedef', private: true }));
      write(
        join(repo, 'src/btn.tsx'),
        `import { memo } from 'react';
export default memo(function MemoBtn(_: { onClick: () => void }) { return null as any; });
`,
      );
      write(
        join(repo, 'src/a.tsx'),
        `import MemoBtn from './btn';
export function ParentA() { return <MemoBtn onClick={() => {}} />; }
`,
      );
      write(
        join(repo, 'src/b.tsx'),
        `import MemoBtn from './btn';
export function ParentB() { return <MemoBtn onClick={() => {}} />; }
`,
      );

      const reports = reviewGraph([join(repo, 'src/a.tsx'), join(repo, 'src/b.tsx'), join(repo, 'src/btn.tsx')], {
        noCache: true,
        target: 'web',
      });
      const btnReport = reports.find((r) => r.filePath === join(repo, 'src/btn.tsx'));
      expect(btnReport).toBeDefined();
      const finding = btnReport!.findings.find((f) => f.ruleId === 'memo-component-widely-defeated');
      expect(finding).toBeDefined();
      const labels = finding!.provenance!.steps.map((s) => s.label ?? '').join(' || ');
      expect(labels).toContain('ParentA');
      expect(labels).toContain('ParentB');
    });

    it('memo-component-widely-defeated does NOT fire when only 1 defeater (walker cancels)', () => {
      repo = mkdtempSync(join(tmpdir(), 'kern-prv-react-cancel-'));
      function write(path: string, content: string): void {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      }
      write(
        join(repo, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            jsx: 'preserve',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
          },
          include: ['src/**/*'],
        }),
      );
      write(join(repo, 'package.json'), JSON.stringify({ name: 'cancel-widedef', private: true }));
      write(
        join(repo, 'src/btn.tsx'),
        `import { memo } from 'react';
export const MemoBtn = memo(function Btn(_: { onClick: () => void }) { return null as any; });
`,
      );
      write(
        join(repo, 'src/a.tsx'),
        `import { MemoBtn } from './btn';
export function OnlyParent() { return <MemoBtn onClick={() => {}} />; }
`,
      );

      const reports = reviewGraph([join(repo, 'src/a.tsx'), join(repo, 'src/btn.tsx')], {
        noCache: true,
        target: 'web',
      });
      const btnReport = reports.find((r) => r.filePath === join(repo, 'src/btn.tsx'));
      expect(btnReport).toBeDefined();
      // Walker cancelled the speculative finding — only 1 defeater, threshold is 2.
      expect(btnReport!.findings.find((f) => f.ruleId === 'memo-component-widely-defeated')).toBeUndefined();
    });

    it('does NOT extend when the child is local (no cross-file boundary to cross)', () => {
      repo = mkdtempSync(join(tmpdir(), 'kern-prv-react-local-'));
      write(
        join(repo, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            jsx: 'preserve',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
          },
          include: ['src/**/*'],
        }),
      );
      write(join(repo, 'package.json'), JSON.stringify({ name: 'prv-react-local', private: true }));
      write(
        join(repo, 'src/parent.tsx'),
        `import { useState } from 'react';
function Child(props: { label: string }) { return <span>{props.label}</span>; }
export function Parent() {
  const [count, setCount] = useState(0);
  return (
    <div onClick={() => setCount(count + 1)}>
      <Child label="static" />
    </div>
  );
}
`,
      );

      const reports = reviewGraph([join(repo, 'src/parent.tsx')], { noCache: true, target: 'web' });
      const parentReport = reports.find((r) => r.filePath === join(repo, 'src/parent.tsx'));
      const finding = parentReport!.findings.find((f) => f.ruleId === 'parent-rerender-via-state');
      expect(finding).toBeDefined();
      // Intra-file chain only — exactly 3 steps, no import-boundary appended.
      expect(finding!.provenance!.steps).toHaveLength(3);
    });
  });
});
