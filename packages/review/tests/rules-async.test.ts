import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const cfg: ReviewConfig = { target: 'web' };

describe('Async Rules', () => {
  describe('promise-all-error-swallow', () => {
    it('flags Promise.all without catch or try', () => {
      const src = `
export function f() {
  Promise.all([fetch('/a'), fetch('/b')]);
}
`;
      const r = reviewSource(src, 'f.ts', cfg);
      expect(r.findings.find((x) => x.ruleId === 'promise-all-error-swallow')).toBeDefined();
    });

    it('does not flag Promise.all with .catch', () => {
      const src = `
export function f() {
  Promise.all([fetch('/a'), fetch('/b')]).catch((e) => console.error(e));
}
`;
      const r = reviewSource(src, 'f.ts', cfg);
      expect(r.findings.find((x) => x.ruleId === 'promise-all-error-swallow')).toBeUndefined();
    });

    it('does not flag awaited Promise.all in async function', () => {
      const src = `
export async function f() {
  await Promise.all([fetch('/a'), fetch('/b')]);
}
`;
      const r = reviewSource(src, 'f.ts', cfg);
      expect(r.findings.find((x) => x.ruleId === 'promise-all-error-swallow')).toBeUndefined();
    });

    it('does not flag Promise.allSettled', () => {
      const src = `
export function f() {
  Promise.allSettled([fetch('/a'), fetch('/b')]);
}
`;
      const r = reviewSource(src, 'f.ts', cfg);
      expect(r.findings.find((x) => x.ruleId === 'promise-all-error-swallow')).toBeUndefined();
    });
  });

  describe('abortcontroller-leak', () => {
    it('flags AbortController in useEffect without abort in cleanup', () => {
      const src = `
import { useEffect } from 'react';
export function C() {
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/x', { signal: ctrl.signal });
  }, []);
  return null;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      const f = r.findings.find((x) => x.ruleId === 'abortcontroller-leak');
      expect(f).toBeDefined();
      expect(f!.autofix).toBeDefined();
      expect(f!.autofix!.replacement).toMatch(/ctrl\.abort/);
    });

    it('does not flag when cleanup aborts the controller', () => {
      const src = `
import { useEffect } from 'react';
export function C() {
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/x', { signal: ctrl.signal });
    return () => ctrl.abort();
  }, []);
  return null;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((x) => x.ruleId === 'abortcontroller-leak')).toBeUndefined();
    });

    it('does not flag when returned cleanup identifier aborts the controller', () => {
      const src = `
import { useEffect } from 'react';
export function C() {
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/x', { signal: ctrl.signal });
    const cleanup = () => ctrl.abort();
    return cleanup;
  }, []);
  return null;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((x) => x.ruleId === 'abortcontroller-leak')).toBeUndefined();
    });

    it('still flags when returned cleanup identifier does not abort the controller', () => {
      const src = `
import { useEffect } from 'react';
export function C() {
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/x', { signal: ctrl.signal });
    const cleanup = () => console.log('cleanup');
    return cleanup;
  }, []);
  return null;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((x) => x.ruleId === 'abortcontroller-leak')).toBeDefined();
    });
  });
});
