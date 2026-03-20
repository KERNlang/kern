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
      const leak = report.findings.find(f => f.ruleId === 'memory-leak');
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
      const leak = report.findings.find(f => f.ruleId === 'memory-leak');
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
      const finding = report.findings.find(f => f.ruleId === 'unhandled-async');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('warning');
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
      const finding = report.findings.find(f => f.ruleId === 'unhandled-async');
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
      const ignoredError = report.findings.find(f => f.ruleId === 'ignored-error');
      expect(ignoredError).toBeDefined();
      expect(ignoredError!.severity).toBe('error');
      // empty-catch should be suppressed when ignored-error covers the same line
      const emptyCatch = report.findings.find(f => f.ruleId === 'empty-catch');
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
      const finding = report.findings.find(f => f.ruleId === 'empty-catch');
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
      const machine = report.inferred.find(r => r.node.type === 'machine');
      expect(machine).toBeDefined();

      // 'orphaned' has no transition leading to it
      const gap = report.findings.find(f =>
        f.ruleId === 'machine-gap' && f.message.includes('orphaned')
      );
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
      const cc = report.findings.find(f => f.ruleId === 'cognitive-complexity');
      expect(cc).toBeDefined();
      expect(cc!.severity).toBe('warning');
      expect(cc!.message).toContain('cognitive complexity');
    });

    it('passes simple functions', () => {
      const source = `
function simple(x: number) {
  if (x > 0) return x;
  return -x;
}
`;
      const report = reviewSource(source, 'simple.ts');
      const cc = report.findings.find(f => f.ruleId === 'cognitive-complexity');
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
      const finding = report.findings.find(f => f.ruleId === 'non-exhaustive-switch');
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
      const finding = report.findings.find(f => f.ruleId === 'non-exhaustive-switch');
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
      const finding = report.findings.find(f => f.ruleId === 'template-available');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('zustand');
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
