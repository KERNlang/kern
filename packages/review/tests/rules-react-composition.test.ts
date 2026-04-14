import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { reviewFile, reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const cfg: ReviewConfig = { target: 'web' };
const TMP = join(tmpdir(), 'kern-review-react-composition');

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('React Composition Rules (Wave 4)', () => {
  describe('children-not-used', () => {
    it('flags component that destructures children but never renders it', () => {
      const src = `
export function Wrapper({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="wrapper"><h1>{title}</h1></div>;
}
`;
      const r = reviewSource(src, 'w.tsx', cfg);
      const f = r.findings.find((x) => x.ruleId === 'children-not-used');
      expect(f).toBeDefined();
      expect(f!.autofix).toBeDefined();
    });

    it('does not flag when children is rendered', () => {
      const src = `
export function Wrapper({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
`;
      const r = reviewSource(src, 'w.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'children-not-used')).toBeUndefined();
    });
  });

  describe('prop-drill-passthrough', () => {
    it('flags pure passthrough component', () => {
      const src = `
export function Middle({ user, theme, locale, perms }: { user: string; theme: string; locale: string; perms: string }) {
  return <Inner user={user} theme={theme} locale={locale} perms={perms} />;
}
`;
      const r = reviewSource(src, 'm.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'prop-drill-passthrough')).toBeDefined();
    });

    it('does not flag when most props are consumed and only one is drilled', () => {
      const src = `
export function Middle({ user, theme, locale, perms }: { user: string; theme: string; locale: string; perms: string }) {
  const label = \`\${user} \${theme} \${locale}\`;
  return <Inner label={label} perms={perms} />;
}
`;
      const r = reviewSource(src, 'm.tsx', cfg);
      // Only perms is drilled — passthroughCount (1) < 2, so rule does not fire.
      const f = r.findings.find((x) => x.ruleId === 'prop-drill-passthrough');
      expect(f).toBeUndefined();
    });

    it('flags props-object passthrough component', () => {
      const src = `
export function Middle(props: { user: string; theme: string }) {
  return <Inner user={props.user} theme={props.theme} />;
}
`;
      const r = reviewSource(src, 'm.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'prop-drill-passthrough')).toBeDefined();
    });

    it('flags aliased destructured passthrough component', () => {
      const src = `
export function Middle({ user: currentUser, theme }: { user: string; theme: string }) {
  return <Inner user={currentUser} theme={theme} />;
}
`;
      const r = reviewSource(src, 'm.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'prop-drill-passthrough')).toBeDefined();
    });
  });

  describe('memoized-child-inline-prop', () => {
    it('flags inline object and callback props passed to memoized child', () => {
      const src = `
import React, { memo } from 'react';

const Child = memo(function Child(props: any) {
  return <div>{props.label}</div>;
});

export function Parent({ label }: { label: string }) {
  return <Child label={label} options={{ dense: true }} onSave={() => console.log(label)} />;
}
`;
      const r = reviewSource(src, 'memo.tsx', cfg);
      const f = r.findings.find((x) => x.ruleId === 'memoized-child-inline-prop');
      expect(f).toBeDefined();
      expect(f!.message).toContain('options');
      expect(f!.message).toContain('onSave');
    });

    it('does not flag stable memoized child props', () => {
      const src = `
import React, { memo, useCallback, useMemo } from 'react';

const Child = memo(function Child(props: any) {
  return <div>{props.label}</div>;
});

export function Parent({ label }: { label: string }) {
  const options = useMemo(() => ({ dense: true }), []);
  const onSave = useCallback(() => console.log(label), [label]);
  return <Child label={label} options={options} onSave={onSave} />;
}
`;
      const r = reviewSource(src, 'memo.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'memoized-child-inline-prop')).toBeUndefined();
    });

    it('does not flag inline props on non-memoized child', () => {
      const src = `
function Child(props: any) {
  return <div>{props.label}</div>;
}

export function Parent({ label }: { label: string }) {
  return <Child label={label} options={{ dense: true }} onSave={() => console.log(label)} />;
}
`;
      const r = reviewSource(src, 'memo.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'memoized-child-inline-prop')).toBeUndefined();
    });

    it('flags inline props passed to imported aliased memoized child', () => {
      const dir = join(TMP, 'memo-imported-prop');
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });

      writeFileSync(
        join(dir, 'child.tsx'),
        `
import React, { memo } from 'react';

export const Child = memo(function Child(props: any) {
  return <div>{props.label}</div>;
});
`,
      );

      writeFileSync(
        join(dir, 'parent.tsx'),
        `
import React from 'react';
import { Child as MemoChild } from './child.js';

export function Parent({ label }: { label: string }) {
  return <MemoChild label={label} options={{ dense: true }} onSave={() => console.log(label)} />;
}
`,
      );

      const report = reviewFile(join(dir, 'parent.tsx'), cfg);
      expect(report.findings.find((f) => f.ruleId === 'memoized-child-inline-prop')).toBeDefined();
    });
  });

  describe('memoized-child-inline-children', () => {
    it('flags inline JSX children passed to memoized child', () => {
      const src = `
import React, { memo } from 'react';

const Panel = memo(function Panel(props: any) {
  return <section>{props.children}</section>;
});

export function Parent() {
  return <Panel><span>inline</span></Panel>;
}
`;
      const r = reviewSource(src, 'memo-children.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'memoized-child-inline-children')).toBeDefined();
    });

    it('does not flag primitive children passed to memoized child', () => {
      const src = `
import React, { memo } from 'react';

const Panel = memo(function Panel(props: any) {
  return <section>{props.children}</section>;
});

export function Parent() {
  return <Panel>stable text</Panel>;
}
`;
      const r = reviewSource(src, 'memo-children.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'memoized-child-inline-children')).toBeUndefined();
    });

    it('flags inline JSX children passed to imported default memoized child', () => {
      const dir = join(TMP, 'memo-imported-children');
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });

      writeFileSync(
        join(dir, 'panel.tsx'),
        `
import React, { memo } from 'react';

const Panel = memo(function Panel(props: any) {
  return <section>{props.children}</section>;
});

export default Panel;
`,
      );

      writeFileSync(
        join(dir, 'parent.tsx'),
        `
import React from 'react';
import Panel from './panel.js';

export function Parent() {
  return <Panel><span>inline</span></Panel>;
}
`,
      );

      const report = reviewFile(join(dir, 'parent.tsx'), cfg);
      expect(report.findings.find((f) => f.ruleId === 'memoized-child-inline-children')).toBeDefined();
    });
  });

  describe('prop-drill-chain', () => {
    it('flags multi-hop prop drilling across imported wrapper components', () => {
      const dir = join(TMP, 'prop-drill-chain');
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });

      writeFileSync(
        join(dir, 'outer.tsx'),
        `
import { Middle } from './middle.js';
export function Outer({ user, theme, locale }: { user: string; theme: string; locale: string }) {
  return <Middle user={user} theme={theme} locale={locale} />;
}
`,
      );

      writeFileSync(
        join(dir, 'middle.tsx'),
        `
function Inner(props: any) {
  return <div>{props.user}</div>;
}

export function Middle({ user, theme, locale }: { user: string; theme: string; locale: string }) {
  return <Inner user={user} theme={theme} locale={locale} />;
}
`,
      );

      const report = reviewFile(join(dir, 'outer.tsx'), cfg);
      expect(report.findings.find((f) => f.ruleId === 'prop-drill-chain')).toBeDefined();
    });

    it('recomputes outer-file findings when an imported wrapper changes', () => {
      const dir = join(TMP, 'prop-drill-chain-cache');
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });

      writeFileSync(
        join(dir, 'outer.tsx'),
        `
import { Middle } from './middle.js';
export function Outer({ user, theme, locale }: { user: string; theme: string; locale: string }) {
  return <Middle user={user} theme={theme} locale={locale} />;
}
`,
      );

      writeFileSync(
        join(dir, 'middle.tsx'),
        `
function Inner(props: any) {
  return <div>{props.user}</div>;
}

export function Middle({ user, theme, locale }: { user: string; theme: string; locale: string }) {
  return <Inner user={user} theme={theme} locale={locale} />;
}
`,
      );

      const firstReport = reviewFile(join(dir, 'outer.tsx'), cfg);
      expect(firstReport.findings.find((f) => f.ruleId === 'prop-drill-chain')).toBeDefined();

      writeFileSync(
        join(dir, 'middle.tsx'),
        `
function Inner(props: any) {
  return <div>{props.user}</div>;
}

export function Middle({ user, theme, locale }: { user: string; theme: string; locale: string }) {
  const summary = \`\${user}-\${theme}-\${locale}\`;
  return <Inner label={summary} />;
}
`,
      );

      const secondReport = reviewFile(join(dir, 'outer.tsx'), cfg);
      expect(secondReport.findings.find((f) => f.ruleId === 'prop-drill-chain')).toBeUndefined();
    });

    it('flags aliased imported wrapper components too', () => {
      const dir = join(TMP, 'prop-drill-chain-aliased');
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });

      writeFileSync(
        join(dir, 'outer.tsx'),
        `
import { Middle as Shell } from './middle.js';
export function Outer({ user, theme, locale }: { user: string; theme: string; locale: string }) {
  return <Shell user={user} theme={theme} locale={locale} />;
}
`,
      );

      writeFileSync(
        join(dir, 'middle.tsx'),
        `
function Inner(props: any) {
  return <div>{props.user}</div>;
}

export function Middle({ user, theme, locale }: { user: string; theme: string; locale: string }) {
  return <Inner user={user} theme={theme} locale={locale} />;
}
`,
      );

      const report = reviewFile(join(dir, 'outer.tsx'), cfg);
      expect(report.findings.find((f) => f.ruleId === 'prop-drill-chain')).toBeDefined();
    });
  });

  describe('parent-rerender-via-state', () => {
    it('flags child that does not receive any state', () => {
      const src = `
import { useState } from 'react';
export function Parent() {
  const [count, setCount] = useState(0);
  return (
    <div onClick={() => setCount(count + 1)}>
      <ExpensiveChild unrelatedProp={1} />
    </div>
  );
}
`;
      const r = reviewSource(src, 'p.tsx', cfg);
      // ExpensiveChild does not see count/setCount
      expect(r.findings.find((f) => f.ruleId === 'parent-rerender-via-state')).toBeDefined();
    });

    it('does not flag when child receives setter in callback', () => {
      const src = `
import { useState } from 'react';
export function Parent() {
  const [count, setCount] = useState(0);
  return <Button onClick={() => setCount(count + 1)}>{count}</Button>;
}
`;
      const r = reviewSource(src, 'p.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'parent-rerender-via-state')).toBeUndefined();
    });

    it('does not flag when component already accepts children', () => {
      const src = `
import { useState } from 'react';
export function Parent({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);
  return <div onClick={() => setCount(count + 1)}>{count}{children}</div>;
}
`;
      const r = reviewSource(src, 'p.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'parent-rerender-via-state')).toBeUndefined();
    });
  });
});
