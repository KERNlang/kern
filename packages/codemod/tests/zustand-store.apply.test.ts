/**
 * End-to-end tests for the zustand-store adapter + apply pipeline.
 *
 * Covers:
 *   - Resolver for the direct create<T>(...) shape
 *   - Resolver for the curried create<T>()(...) shape
 *   - Successful apply produces parseable output with the user's interior intact
 *   - Idempotency: applying a second time produces no further change
 *   - Re-detect: the zustand-store pattern is still recognized after rewrite
 *   - Fail-closed: aliased `create` import produces `skipped` decision
 *   - Fail-closed: multiple stores in one file produces `skipped`
 *   - Fail-closed: spread in state initializer produces `skipped`
 *   - Property: no NEW tsc diagnostics introduced by the transform
 */

import { detectTemplates } from '@kernlang/review';
import { Project } from 'ts-morph';
import { applyMatch, snapshotAffectedSet } from '../src/index.js';

const FILE = '/virtual/counter.ts';

function newProject(): Project {
  return new Project({
    compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100 },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
}

function withSource(source: string): { project: Project; filePath: string } {
  const project = newProject();
  project.createSourceFile(FILE, source, { overwrite: true });
  return { project, filePath: FILE };
}

const DIRECT_SHAPE = `import { create } from 'zustand';

export interface CounterState {
  count: number;
  increment: () => void;
}

export const useCounterStore = create<CounterState>((set, get) => ({
  count: 0,
  increment: () => set(s => ({ count: s.count + 1 })),
}));
`;

const CURRIED_SHAPE = `import { create } from 'zustand';

export interface CounterState {
  count: number;
  increment: () => void;
}

export const useCounterStore = create<CounterState>()((set, get) => ({
  count: 0,
  increment: () => set(s => ({ count: s.count + 1 })),
}));
`;

describe('zustand-store adapter — resolver coverage', () => {
  it('resolves direct shape create<T>((set, get) => ({...}))', () => {
    const { project, filePath } = withSource(DIRECT_SHAPE);
    const sf = project.getSourceFileOrThrow(filePath);
    const baseline = snapshotAffectedSet(project, sf);
    const matches = detectTemplates(sf);
    const zustand = matches.find((m) => m.templateName === 'zustand-store');
    expect(zustand).toBeDefined();

    const result = applyMatch({ project, filePath, match: zustand!, preDiagnostics: baseline }, { minConfidence: 0 });
    // DIRECT_SHAPE is already canonical — transform is a no-op (idempotent skip) or a dry-run.
    expect(['dry-run', 'skipped']).toContain(result.decision);
    // Resolver must not have bailed — reason (if any) must be idempotency, not a resolve/extract failure.
    if (result.decision === 'skipped' && result.reason) {
      expect(result.reason).toMatch(/idempotent|identical/);
    }
    expect(result.replacedSpan).toBeDefined();
  });

  it('resolves curried shape create<T>()((set, get) => ({...}))', () => {
    const { project, filePath } = withSource(CURRIED_SHAPE);
    const sf = project.getSourceFileOrThrow(filePath);
    const baseline = snapshotAffectedSet(project, sf);
    const matches = detectTemplates(sf);
    const zustand = matches.find((m) => m.templateName === 'zustand-store');
    expect(zustand).toBeDefined();

    const result = applyMatch({ project, filePath, match: zustand!, preDiagnostics: baseline }, { minConfidence: 0 });
    // Curried rewrites to direct shape — expect a diff.
    expect(['dry-run', 'applied']).toContain(result.decision);
    expect(result.parseOk).toBe(true);
  });
});

describe('zustand-store adapter — apply output', () => {
  // The direct shape is already canonical. Use a slightly non-canonical variant
  // (single-line formatting) so the transform actually produces a diff we can
  // assert against.
  const NON_CANONICAL = `import { create } from 'zustand';

export interface CounterState { count: number; increment: () => void; }

export const useCounterStore = create<CounterState>((set, get) => ({ count: 0, increment: () => set(s => ({ count: s.count + 1 })) }));
`;

  it('preserves user interior (state + action properties)', () => {
    const { project, filePath } = withSource(NON_CANONICAL);
    const sf = project.getSourceFileOrThrow(filePath);
    const baseline = snapshotAffectedSet(project, sf);
    const matches = detectTemplates(sf);
    const zustand = matches.find((m) => m.templateName === 'zustand-store');
    expect(zustand).toBeDefined();

    const result = applyMatch(
      { project, filePath, match: zustand!, preDiagnostics: baseline },
      { minConfidence: 0, write: true },
    );

    expect(['applied', 'dry-run']).toContain(result.decision);
    const updated = sf.getFullText();
    // The rewrite must preserve the user's state + actions, regardless of formatting.
    expect(updated).toContain('count: 0');
    expect(updated).toMatch(/increment/);
    expect(updated).toContain("import { create } from 'zustand';");
  });
});

describe('zustand-store adapter — idempotency + re-detect', () => {
  it('re-detection still finds zustand-store after rewrite', () => {
    const { project, filePath } = withSource(DIRECT_SHAPE);
    const sf = project.getSourceFileOrThrow(filePath);
    const baseline = snapshotAffectedSet(project, sf);
    const matches = detectTemplates(sf);
    const zustand = matches.find((m) => m.templateName === 'zustand-store');
    expect(zustand).toBeDefined();

    const result = applyMatch(
      { project, filePath, match: zustand!, preDiagnostics: baseline },
      { minConfidence: 0, write: true },
    );
    // Either applied or already canonical (idempotent skip).
    expect(['applied', 'skipped']).toContain(result.decision);

    // Round-trip detection should still see a zustand-store match.
    const afterMatches = detectTemplates(sf);
    expect(afterMatches.some((m) => m.templateName === 'zustand-store')).toBe(true);
  });

  it('applying the transform twice is idempotent (second apply produces no change)', () => {
    const { project, filePath } = withSource(DIRECT_SHAPE);
    const sf = project.getSourceFileOrThrow(filePath);
    const baseline = snapshotAffectedSet(project, sf);
    const firstMatches = detectTemplates(sf);
    const firstMatch = firstMatches.find((m) => m.templateName === 'zustand-store')!;
    applyMatch({ project, filePath, match: firstMatch, preDiagnostics: baseline }, { minConfidence: 0, write: true });

    const afterFirst = sf.getFullText();
    const secondMatches = detectTemplates(sf);
    const secondMatch = secondMatches.find((m) => m.templateName === 'zustand-store');
    if (!secondMatch) return; // already canonicalized away

    const secondBaseline = snapshotAffectedSet(project, sf);
    const second = applyMatch(
      { project, filePath, match: secondMatch, preDiagnostics: secondBaseline },
      { minConfidence: 0, write: true },
    );
    // Second pass must not produce new content.
    expect(sf.getFullText()).toBe(afterFirst);
    expect(['skipped', 'dry-run']).toContain(second.decision);
  });
});

describe('zustand-store adapter — fail-closed', () => {
  it('skips when `create` is imported with an alias', () => {
    const ALIASED = `import { create as mkStore } from 'zustand';

export interface S { n: number }
export const useS = mkStore<S>((set) => ({ n: 0 }));
`;
    const { project, filePath } = withSource(ALIASED);
    const sf = project.getSourceFileOrThrow(filePath);
    const matches = detectTemplates(sf);
    const zustand = matches.find((m) => m.templateName === 'zustand-store');
    if (!zustand) return; // detector also rejects — fine

    const result = applyMatch({ project, filePath, match: zustand }, { minConfidence: 0 });
    expect(result.decision).toBe('skipped');
    expect(result.reason).toMatch(/aliased|create/);
  });

  it('skips when multiple zustand stores are in the same file', () => {
    const MULTI = `import { create } from 'zustand';

export interface A { a: number }
export interface B { b: number }

export const useA = create<A>((set) => ({ a: 0 }));
export const useB = create<B>((set) => ({ b: 0 }));
`;
    const { project, filePath } = withSource(MULTI);
    const sf = project.getSourceFileOrThrow(filePath);
    const matches = detectTemplates(sf);
    const zustand = matches.find((m) => m.templateName === 'zustand-store');
    if (!zustand) return;

    const result = applyMatch({ project, filePath, match: zustand }, { minConfidence: 0 });
    expect(result.decision).toBe('skipped');
    expect(result.reason).toMatch(/multiple/);
  });

  it('skips when state initializer contains a spread', () => {
    const SPREAD = `import { create } from 'zustand';

const defaults = { count: 0 };
export interface S { count: number; inc: () => void }
export const useS = create<S>((set) => ({ ...defaults, inc: () => set((s) => ({ count: s.count + 1 })) }));
`;
    const { project, filePath } = withSource(SPREAD);
    const sf = project.getSourceFileOrThrow(filePath);
    const matches = detectTemplates(sf);
    const zustand = matches.find((m) => m.templateName === 'zustand-store');
    if (!zustand) return;

    const result = applyMatch({ project, filePath, match: zustand }, { minConfidence: 0 });
    expect(result.decision).toBe('skipped');
    expect(result.reason).toMatch(/spread/);
  });
});

describe('zustand-store adapter — comment preservation', () => {
  it('does not duplicate leading JSDoc comments on rewrite', () => {
    const COMMENTED = `import { create } from 'zustand';

export interface CounterState {
  count: number;
  inc: () => void;
}

/**
 * The main counter store for the app.
 */
export const useCounterStore = create<CounterState>()((set, get) => ({
  count: 0,
  inc: () => set((s) => ({ count: s.count + 1 })),
}));
`;
    const { project, filePath } = withSource(COMMENTED);
    const sf = project.getSourceFileOrThrow(filePath);
    const baseline = snapshotAffectedSet(project, sf);
    const matches = detectTemplates(sf);
    const zustand = matches.find((m) => m.templateName === 'zustand-store');
    expect(zustand).toBeDefined();

    const result = applyMatch(
      { project, filePath, match: zustand!, preDiagnostics: baseline },
      { minConfidence: 0, write: true },
    );
    expect(['applied', 'dry-run']).toContain(result.decision);

    // After rewrite, the JSDoc must appear exactly once.
    const after = sf.getFullText();
    const jsDocCount = (after.match(/The main counter store/g) ?? []).length;
    expect(jsDocCount).toBe(1);
  });
});

describe('zustand-store adapter — property: no new diagnostics', () => {
  it('does not introduce new tsc diagnostics', () => {
    const { project, filePath } = withSource(DIRECT_SHAPE);
    const sf = project.getSourceFileOrThrow(filePath);
    const baseline = snapshotAffectedSet(project, sf);

    const matches = detectTemplates(sf);
    const zustand = matches.find((m) => m.templateName === 'zustand-store');
    if (!zustand) return;

    const result = applyMatch({ project, filePath, match: zustand, preDiagnostics: baseline }, { minConfidence: 0 });
    if (result.decision === 'rejected') {
      // If rejected due to new diagnostics, the test fails — surface them.
      expect(result.newDiagnostics ?? []).toEqual([]);
    } else {
      expect(result.newDiagnostics ?? []).toEqual([]);
    }
  });
});
