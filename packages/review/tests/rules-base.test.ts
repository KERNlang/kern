import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

describe('Base Rules', () => {
  // ── memory-leak ──

  describe('memory-leak', () => {
    it('detects useEffect with addEventListener but no cleanup', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    window.addEventListener('resize', handleResize);
  }, []);
  return null;
}
function handleResize() {}
`;
      const report = reviewSource(source, 'comp.tsx');
      const leak = report.findings.find((f) => f.ruleId === 'memory-leak');
      expect(leak).toBeDefined();
      expect(leak!.severity).toBe('error');
    });

    it('does not flag useEffect with cleanup', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);
  return null;
}
function handleResize() {}
`;
      const report = reviewSource(source, 'comp.tsx');
      const leak = report.findings.find((f) => f.ruleId === 'memory-leak');
      expect(leak).toBeUndefined();
    });

    it('still flags when returned cleanup does not remove the subscription', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => console.log('cleanup');
  }, []);
  return null;
}
function handleResize() {}
`;
      const report = reviewSource(source, 'comp.tsx');
      const leak = report.findings.find((f) => f.ruleId === 'memory-leak');
      expect(leak).toBeDefined();
    });

    it('does not flag subscribe when the returned unsubscribe function is returned directly', () => {
      const source = `
import { useEffect } from 'react';
export function Component({ store }: { store: { subscribe(cb: () => void): () => void } }) {
  useEffect(() => {
    return store.subscribe(() => {});
  }, [store]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx');
      const leak = report.findings.find((f) => f.ruleId === 'memory-leak');
      expect(leak).toBeUndefined();
    });

    it('does not flag subscribe when unsubscribe identifier is returned', () => {
      const source = `
import { useEffect } from 'react';
export function Component({ store }: { store: { subscribe(cb: () => void): () => void } }) {
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {});
    return unsubscribe;
  }, [store]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx');
      const leak = report.findings.find((f) => f.ruleId === 'memory-leak');
      expect(leak).toBeUndefined();
    });

    it('does not flag observers when cleanup disconnects them', () => {
      const source = `
import { useEffect } from 'react';
export function Component({ el }: { el: Element }) {
  useEffect(() => {
    const observer = new ResizeObserver(() => {});
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx');
      const leak = report.findings.find((f) => f.ruleId === 'memory-leak');
      expect(leak).toBeUndefined();
    });
  });

  // ── unhandled-async ──

  describe('unhandled-async', () => {
    it('detects async function without try/catch', () => {
      const source = `
export async function fetchData(url: string): Promise<any> {
  const res = await fetch(url);
  return res.json();
}
`;
      const report = reviewSource(source, 'api.ts');
      const finding = report.findings.find((f) => f.ruleId === 'unhandled-async');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('info');
    });

    it('does not flag async with try/catch', () => {
      const source = `
export async function fetchData(url: string): Promise<any> {
  try {
    const res = await fetch(url);
    return res.json();
  } catch (err) {
    console.error(err);
    throw err;
  }
}
`;
      const report = reviewSource(source, 'api.ts');
      const finding = report.findings.find((f) => f.ruleId === 'unhandled-async');
      expect(finding).toBeUndefined();
    });
  });

  // ── empty-catch ──

  describe('empty-catch', () => {
    it('detects empty catch block (via ignored-error concept rule, empty-catch suppressed)', () => {
      const source = `
export function doSomething(): void {
  try {
    riskyOperation();
  } catch (err) {
  }
}
function riskyOperation(): void {}
`;
      const report = reviewSource(source, 'ops.ts');
      // ignored-error (concept rule) fires and suppresses empty-catch (base rule)
      const ignoredError = report.findings.find((f) => f.ruleId === 'ignored-error');
      expect(ignoredError).toBeDefined();
      expect(ignoredError!.severity).toBe('error');
      // empty-catch should be suppressed when ignored-error covers the same line
      const emptyCatch = report.findings.find((f) => f.ruleId === 'empty-catch');
      expect(emptyCatch).toBeUndefined();
    });

    it('does not flag catch with body', () => {
      const source = `
export function doSomething(): void {
  try {
    riskyOperation();
  } catch (err) {
    console.error(err);
  }
}
function riskyOperation(): void {}
`;
      const report = reviewSource(source, 'ops.ts');
      const finding = report.findings.find((f) => f.ruleId === 'empty-catch');
      expect(finding).toBeUndefined();
    });
  });

  // ── machine-gap ──

  describe('machine-gap', () => {
    it('detects unreachable states in machine', () => {
      const source = `
export type OrderState = 'pending' | 'shipped' | 'delivered' | 'orphaned';

export class OrderStateError extends Error {
  constructor(public readonly expected: string, public readonly actual: string) {
    super('Invalid state');
  }
}

export function shipOrder<T extends { state: OrderState }>(e: T): T {
  return { ...e, state: 'shipped' as OrderState };
}
`;
      const report = reviewSource(source, 'order.ts');
      const machine = report.inferred.find((r) => r.node.type === 'machine');
      expect(machine).toBeDefined();

      // 'orphaned' has no transition leading to it
      const gap = report.findings.find((f) => f.ruleId === 'machine-gap' && f.message.includes('orphaned'));
      expect(gap).toBeDefined();
    });
  });

  // ── cognitive-complexity ──

  describe('cognitive-complexity', () => {
    it('flags functions exceeding complexity threshold', () => {
      // Nested ifs + loops + ternary should easily exceed threshold of 15
      const source = `
function complex(a: number, b: string, c: boolean) {
  if (a > 0) {
    if (b === 'x') {
      for (let i = 0; i < a; i++) {
        if (c) {
          while (i > 0) {
            if (a && b) {
              const x = c ? 1 : 2;
            }
          }
        }
      }
    } else if (b === 'y') {
      switch (a) {
        case 1: break;
        case 2: break;
      }
    } else {
      try { foo(); } catch (e) { bar(); }
    }
  }
}
`;
      const report = reviewSource(source, 'complex.ts');
      const cc = report.findings.find((f) => f.ruleId === 'cognitive-complexity');
      expect(cc).toBeDefined();
      expect(cc!.severity).toBe('info');
      expect(cc!.message).toContain('cognitive complexity');
    });

    it('keeps cognitive complexity as warning in audit mode', () => {
      const source = `
function complex(a: number, b: string, c: boolean) {
  if (a > 0) {
    if (b === 'x') {
      for (let i = 0; i < a; i++) {
        if (c) {
          while (i > 0) {
            if (a && b) {
              const x = c ? 1 : 2;
            }
          }
        }
      }
    } else if (b === 'y') {
      switch (a) {
        case 1: break;
        case 2: break;
      }
    } else {
      try { foo(); } catch (e) { bar(); }
    }
  }
}
`;
      const report = reviewSource(source, 'complex.ts', { crossStackMode: 'audit' });
      const cc = report.findings.find((f) => f.ruleId === 'cognitive-complexity');
      expect(cc).toBeDefined();
      expect(cc!.severity).toBe('warning');
    });

    it('passes simple functions', () => {
      const source = `
function simple(x: number) {
  if (x > 0) return x;
  return -x;
}
`;
      const report = reviewSource(source, 'simple.ts');
      const cc = report.findings.find((f) => f.ruleId === 'cognitive-complexity');
      expect(cc).toBeUndefined();
    });
  });

  // ── non-exhaustive-switch ──

  describe('non-exhaustive-switch', () => {
    it('detects missing cases in switch over known union', () => {
      const source = `
export type Color = 'red' | 'green' | 'blue';

export function describe(c: Color): string {
  switch (c) {
    case 'red':
      return 'warm';
    case 'green':
      return 'cool';
    // missing 'blue'
  }
  return 'unknown';
}
`;
      const report = reviewSource(source, 'color.ts');
      const finding = report.findings.find((f) => f.ruleId === 'non-exhaustive-switch');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('blue');
    });

    it('does not flag switch with default clause', () => {
      const source = `
export type Color = 'red' | 'green' | 'blue';

export function describe(c: Color): string {
  switch (c) {
    case 'red': return 'warm';
    default: return 'other';
  }
}
`;
      const report = reviewSource(source, 'color.ts');
      const finding = report.findings.find((f) => f.ruleId === 'non-exhaustive-switch');
      expect(finding).toBeUndefined();
    });
  });

  // ── template-available ──

  describe('template-available', () => {
    it('suggests template when registered', () => {
      const source = `
import { create } from 'zustand';

interface BearState { bears: number; increase: () => void; }

const useBearStore = create<BearState>((set) => ({
  bears: 0,
  increase: () => set((state) => ({ bears: state.bears + 1 })),
}));
`;
      const config: ReviewConfig = {
        registeredTemplates: ['zustand-store'],
      };
      const report = reviewSource(source, 'store.ts', config);
      const finding = report.findings.find((f) => f.ruleId === 'template-available');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('zustand');
    });
  });

  // ── floating-promise ──

  describe('floating-promise', () => {
    it('detects .then() chain without await', () => {
      const source = `
export function doWork() {
  fetch('/api').then(res => res.json());
}
`;
      const report = reviewSource(source, 'work.ts');
      const f = report.findings.find((f) => f.ruleId === 'floating-promise');
      expect(f).toBeDefined();
      expect(f!.message).toContain('.then(');
    });

    it('does not flag awaited promise', () => {
      const source = `
export async function doWork() {
  await fetch('/api').then(res => res.json());
}
`;
      const report = reviewSource(source, 'work.ts');
      const f = report.findings.find((f) => f.ruleId === 'floating-promise');
      expect(f).toBeUndefined();
    });
  });

  // ── state-mutation ──

  describe('state-mutation', () => {
    it('detects state.push()', () => {
      const source = `
const state = { items: [] as string[] };
state.items.push('new');
`;
      const report = reviewSource(source, 'store.ts');
      const f = report.findings.find((f) => f.ruleId === 'state-mutation');
      expect(f).toBeDefined();
      expect(f!.message).toContain('push');
    });

    it('does not flag mutation inside produce()', () => {
      const source = `
import { produce } from 'immer';
const next = produce(state, draft => {
  draft.items.push('new');
});
`;
      const report = reviewSource(source, 'store.ts');
      const f = report.findings.find((f) => f.ruleId === 'state-mutation');
      expect(f).toBeUndefined();
    });
  });

  // ── sync-in-async ──

  describe('sync-in-async', () => {
    it('detects readFileSync inside async function', () => {
      const source = `
import { readFileSync } from 'fs';
export async function loadConfig() {
  const data = readFileSync('/etc/config.json', 'utf-8');
  return JSON.parse(data);
}
`;
      const report = reviewSource(source, 'config.ts');
      const f = report.findings.find((f) => f.ruleId === 'sync-in-async');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('info');
      expect(f!.message).toContain('readFileSync');
    });

    it('does not flag sync ops in synchronous function', () => {
      const source = `
import { readFileSync } from 'fs';
export function loadConfig() {
  return readFileSync('/etc/config.json', 'utf-8');
}
`;
      const report = reviewSource(source, 'config.ts');
      const f = report.findings.find((f) => f.ruleId === 'sync-in-async');
      expect(f).toBeUndefined();
    });
  });

  // ── bare-rethrow ──

  describe('bare-rethrow', () => {
    it('detects catch that only rethrows the same error', () => {
      const source = `
export function doWork() {
  try {
    riskyOperation();
  } catch (err) {
    throw err;
  }
}
function riskyOperation() {}
`;
      const report = reviewSource(source, 'work.ts');
      const f = report.findings.find((f) => f.ruleId === 'bare-rethrow');
      expect(f).toBeDefined();
    });

    it('does not flag catch that wraps the error', () => {
      const source = `
export function doWork() {
  try {
    riskyOperation();
  } catch (err) {
    throw new Error('failed to do work', { cause: err });
  }
}
function riskyOperation() {}
`;
      const report = reviewSource(source, 'work.ts');
      const f = report.findings.find((f) => f.ruleId === 'bare-rethrow');
      expect(f).toBeUndefined();
    });
  });

  // ── Unified finding structure ──

  describe('finding structure', () => {
    it('all findings have source, ruleId, severity, category, primarySpan, fingerprint', () => {
      const source = `
export async function doWork(): Promise<void> {
  const result = await fetch('/api');
}
`;
      const report = reviewSource(source, 'work.ts');
      for (const f of report.findings) {
        expect(f.source).toBeDefined();
        expect(f.ruleId).toBeDefined();
        expect(f.severity).toBeDefined();
        expect(f.category).toBeDefined();
        expect(f.primarySpan).toBeDefined();
        expect(f.primarySpan.file).toBeDefined();
        expect(f.primarySpan.startLine).toBeGreaterThanOrEqual(0);
        expect(f.fingerprint).toBeDefined();
      }
    });
  });
});
