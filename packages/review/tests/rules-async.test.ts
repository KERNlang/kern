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

  describe('unchecked-fetch-response', () => {
    it('flags res.json() without res.ok / res.status check', () => {
      const src = `
export async function f() {
  const res = await fetch('/a');
  const data = await res.json();
  return data;
}
`;
      const r = reviewSource(src, 'f.ts', cfg);
      expect(r.findings.find((x) => x.ruleId === 'unchecked-fetch-response')).toBeDefined();
    });

    it('is silent when res.ok is checked before the body read', () => {
      const src = `
export async function f() {
  const res = await fetch('/a');
  if (!res.ok) throw new Error('fetch failed');
  return await res.json();
}
`;
      const r = reviewSource(src, 'f.ts', cfg);
      expect(r.findings.find((x) => x.ruleId === 'unchecked-fetch-response')).toBeUndefined();
    });

    it('is silent when res.status is inspected', () => {
      const src = `
export async function f() {
  const res = await fetch('/a');
  if (res.status === 404) return null;
  return await res.json();
}
`;
      const r = reviewSource(src, 'f.ts', cfg);
      expect(r.findings.find((x) => x.ruleId === 'unchecked-fetch-response')).toBeUndefined();
    });

    it('flags the anonymous form (await (await fetch(...)).json())', () => {
      const src = `
export async function f() {
  const data = await (await fetch('/a')).json();
  return data;
}
`;
      const r = reviewSource(src, 'f.ts', cfg);
      expect(r.findings.find((x) => x.ruleId === 'unchecked-fetch-response')).toBeDefined();
    });

    it('flags res.text() as well', () => {
      const src = `
export async function f() {
  const res = await fetch('/a');
  return await res.text();
}
`;
      const r = reviewSource(src, 'f.ts', cfg);
      expect(r.findings.find((x) => x.ruleId === 'unchecked-fetch-response')).toBeDefined();
    });

    it('is silent when fetch + body read sit in a try/catch', () => {
      // Rationale: .json() on an HTML error body throws a JSON parse error,
      // so the catch still surfaces the failure.
      const src = `
export async function f() {
  try {
    const res = await fetch('/a');
    return await res.json();
  } catch (e) {
    return null;
  }
}
`;
      const r = reviewSource(src, 'f.ts', cfg);
      expect(r.findings.find((x) => x.ruleId === 'unchecked-fetch-response')).toBeUndefined();
    });

    it('flags an unchecked fetch INSIDE a catch clause (the try-exemption must not leak)', () => {
      const src = `
export async function f() {
  try {
    throw new Error();
  } catch (e) {
    const res = await fetch('/fallback');
    return await res.json();
  }
}
`;
      const r = reviewSource(src, 'f.ts', cfg);
      expect(r.findings.find((x) => x.ruleId === 'unchecked-fetch-response')).toBeDefined();
    });

    it('flags an unchecked fetch INSIDE a finally block (no safety net)', () => {
      const src = `
export async function f() {
  try {
    // main path
  } finally {
    const res = await fetch('/telemetry');
    await res.json();
  }
}
`;
      const r = reviewSource(src, 'f.ts', cfg);
      expect(r.findings.find((x) => x.ruleId === 'unchecked-fetch-response')).toBeDefined();
    });

    it('is silent when the variable came from axios, not fetch', () => {
      const src = `
import axios from 'axios';
export async function f() {
  const res = await axios.get('/a');
  return res.data;
}
`;
      const r = reviewSource(src, 'f.ts', cfg);
      expect(r.findings.find((x) => x.ruleId === 'unchecked-fetch-response')).toBeUndefined();
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
