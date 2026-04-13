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
});
