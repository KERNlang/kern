import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const cfg: ReviewConfig = { target: 'web' };

describe('perf Rules', () => {
  describe('image-no-lazy', () => {
    it('flags img without loading attribute', () => {
      const src = `export function C() { return <img src="/x.jpg" alt="" />; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      const f = r.findings.find((x) => x.ruleId === 'image-no-lazy');
      expect(f).toBeDefined();
      expect(f!.autofix).toBeDefined();
      expect(f!.autofix!.replacement).toBe(' loading="lazy"');
    });

    it('does not flag img with loading="lazy"', () => {
      const src = `export function C() { return <img src="/x.jpg" alt="" loading="lazy" />; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'image-no-lazy')).toBeUndefined();
    });

    it('does not flag img with fetchPriority="high"', () => {
      const src = `export function C() { return <img src="/x.jpg" alt="" fetchPriority="high" />; }`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'image-no-lazy')).toBeUndefined();
    });
  });

  describe('heavy-computation-in-render', () => {
    it('flags chained sort+filter inline in JSX', () => {
      const src = `
export function List({ items }: { items: number[] }) {
  return <ul>{items.sort().filter((x) => x > 0).map((x) => <li key={x}>{x}</li>)}</ul>;
}
`;
      const r = reviewSource(src, 'list.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'heavy-computation-in-render')).toBeDefined();
    });

    it('does not flag single .map()', () => {
      const src = `
export function List({ items }: { items: number[] }) {
  return <ul>{items.map((x) => <li key={x}>{x}</li>)}</ul>;
}
`;
      const r = reviewSource(src, 'list.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'heavy-computation-in-render')).toBeUndefined();
    });
  });

  describe('large-list-no-virtualization', () => {
    it('flags .map() on list-named identifier without virtualization import', () => {
      const src = `
export function List({ items }: { items: number[] }) {
  return <ul>{items.map((x) => <li key={x}>{x}</li>)}</ul>;
}
`;
      const r = reviewSource(src, 'list.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'large-list-no-virtualization')).toBeDefined();
    });

    it('does not flag when react-window is imported', () => {
      const src = `
import { FixedSizeList } from 'react-window';
export function List({ items }: { items: number[] }) {
  return <ul>{items.map((x) => <li key={x}>{x}</li>)}</ul>;
}
`;
      const r = reviewSource(src, 'list.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'large-list-no-virtualization')).toBeUndefined();
    });

    it('does not flag .map() on non-list-named identifier', () => {
      const src = `
export function C({ config }: { config: { foo: number[] } }) {
  return <ul>{config.foo.map((x) => <li key={x}>{x}</li>)}</ul>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'large-list-no-virtualization')).toBeUndefined();
    });
  });

  describe('nondeterministic-in-render', () => {
    it('flags Math.random() in component body', () => {
      const src = `
export function C() {
  const id = Math.random();
  return <div>{id}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'nondeterministic-in-render')).toBeDefined();
    });

    it('flags Date.now() in JSX', () => {
      const src = `
export function C() {
  return <div>now: {Date.now()}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'nondeterministic-in-render')).toBeDefined();
    });

    it('flags new Date() with no args', () => {
      const src = `
export function C() {
  const d = new Date();
  return <div>{String(d)}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'nondeterministic-in-render')).toBeDefined();
    });

    it('flags crypto.randomUUID() in render path', () => {
      const src = `
export function C() {
  const id = crypto.randomUUID();
  return <div>{id}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'nondeterministic-in-render')).toBeDefined();
    });

    it('flags Math.random() inside list.map() in render path', () => {
      const src = `
export function C({ list }: { list: number[] }) {
  return <ul>{list.map((x) => <li key={x + Math.random()}>{x}</li>)}</ul>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'nondeterministic-in-render')).toBeDefined();
    });

    it('does not flag inside useEffect callback', () => {
      const src = `
import { useEffect } from 'react';
export function C() {
  useEffect(() => {
    console.log(Date.now());
  }, []);
  return <div />;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'nondeterministic-in-render')).toBeUndefined();
    });

    it('does not flag inside useState lazy initializer', () => {
      const src = `
import { useState } from 'react';
export function C() {
  const [id] = useState(() => crypto.randomUUID());
  return <div>{id}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'nondeterministic-in-render')).toBeUndefined();
    });

    it('does not flag inside useMemo callback', () => {
      const src = `
import { useMemo } from 'react';
export function C() {
  const v = useMemo(() => Math.random(), []);
  return <div>{v}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'nondeterministic-in-render')).toBeUndefined();
    });

    it('does not flag inside JSX onClick handler', () => {
      const src = `
export function C() {
  return <button onClick={() => alert(Date.now())}>x</button>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'nondeterministic-in-render')).toBeUndefined();
    });

    it('does not flag in non-component utility function', () => {
      const src = `
function makeId() {
  return Math.random();
}
export const x = makeId();
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'nondeterministic-in-render')).toBeUndefined();
    });

    it('does not flag new Date(timestamp) with args', () => {
      const src = `
export function C({ ts }: { ts: number }) {
  const d = new Date(ts);
  return <div>{String(d)}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'nondeterministic-in-render')).toBeUndefined();
    });
  });

  describe('regex-literal-in-render', () => {
    it('flags regex literal used in str.replace() inside render', () => {
      const src = `
export function C({ name }: { name: string }) {
  const cleaned = name.replace(/\\s+/g, '-');
  return <div>{cleaned}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'regex-literal-in-render')).toBeDefined();
    });

    it('flags regex literal as JSX attribute value', () => {
      const src = `
declare function Input(props: { pattern: RegExp }): JSX.Element;
export function C() {
  return <Input pattern={/^[a-z]+$/i} />;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'regex-literal-in-render')).toBeDefined();
    });

    it('does not flag regex literal at module scope', () => {
      const src = `
const RE = /\\s+/g;
export function C({ name }: { name: string }) {
  return <div>{name.replace(RE, '-')}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'regex-literal-in-render')).toBeUndefined();
    });

    it('does not flag regex literal inside useMemo', () => {
      const src = `
import { useMemo } from 'react';
export function C({ name }: { name: string }) {
  const cleaned = useMemo(() => name.replace(/\\s+/g, '-'), [name]);
  return <div>{cleaned}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'regex-literal-in-render')).toBeUndefined();
    });

    it('does not flag regex literal inside event handler', () => {
      const src = `
export function C({ onSubmit }: { onSubmit: (s: string) => void }) {
  return <button onClick={() => onSubmit('x'.replace(/x/g, 'y'))}>go</button>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'regex-literal-in-render')).toBeUndefined();
    });
  });
});
