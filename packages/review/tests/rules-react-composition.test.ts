import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const cfg: ReviewConfig = { target: 'web' };

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
