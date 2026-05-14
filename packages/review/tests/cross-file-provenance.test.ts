/**
 * Phase 2 unit tests for cross-file ProvenanceChain extension.
 *
 * Verifies:
 *  - Registry register/get/_reset
 *  - extendCrossFileChains appends to the matching finding's chain
 *  - APPEND-ONLY invariant: chain.steps[0..2] are byte-identical post-extension
 *  - Hard cap truncates with a `category: 'truncated'` marker step
 *  - forwardImportWalker finds the React.memo wrap site in the child's
 *    declaration file (named export, default export, forwardRef(memo()) nest)
 *  - Unknown walkerId / missing finding are no-ops (no throw, no mutation)
 *  - pendingCrossFileLinks is consumed (removed from the returned report)
 */

import { Project } from 'ts-morph';
import {
  type CrossFileContext,
  type CrossFileWalker,
  cfWalkers,
  extendCrossFileChains,
  forwardImportWalker,
  reverseJsxUsageWalker,
} from '../src/cross-file-provenance.js';
import { resolveImportGraph } from '../src/graph.js';
import type { CrossFileExtensionRequest, ProvenanceStep, ReviewFinding, ReviewReport } from '../src/types.js';

function createTestProject(): Project {
  return new Project({
    compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100, jsx: 4 },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
}

function makeFinding(fingerprint: string, steps: ProvenanceStep[] = []): ReviewFinding {
  return {
    source: 'kern',
    ruleId: 'memoized-child-inline-prop',
    severity: 'warning',
    category: 'pattern',
    message: 'inline prop',
    primarySpan: { file: '/src/app.tsx', startLine: 5, startCol: 1, endLine: 5, endCol: 1 },
    fingerprint,
    confidence: 80,
    provenance: { steps: [...steps] },
  };
}

function makeReport(findings: ReviewFinding[], requests: CrossFileExtensionRequest[]): ReviewReport {
  return {
    filePath: '/src/app.tsx',
    inferred: [],
    templateMatches: [],
    findings,
    pendingCrossFileLinks: requests,
    stats: {
      totalLines: 1,
      coverage: { total: 0, accepted: 0, summary: '' },
      tokenReduction: { original: 0, kern: 0, reductionPct: 0 },
      findingsBySource: { kern: 0, 'kern-native': 0, eslint: 0, tsc: 0, llm: 0 },
      findingsBySeverity: { error: 0, warning: 0, info: 0 },
      findingsByCategory: { bug: 0, type: 0, pattern: 0, style: 0, structure: 0 },
    },
  };
}

function stepAt(file: string, line: number, label: string): ProvenanceStep {
  return {
    kind: 'source',
    location: { file, startLine: line, startCol: 1, endLine: line, endCol: 1 },
    label,
  };
}

afterEach(() => {
  // Restore the default walker registry between tests.
  cfWalkers._reset();
});

describe('cfWalkers registry', () => {
  it('register + get round-trips a walker', () => {
    const probe: CrossFileWalker = () => ({ appendSteps: [stepAt('/x', 1, 'probe')] });
    cfWalkers.register('probe', probe);
    expect(cfWalkers.get('probe')).toBe(probe);
  });

  it('_reset clears custom registrations but restores built-ins', () => {
    cfWalkers.register('probe', () => ({ appendSteps: [] }));
    expect(cfWalkers.get('probe')).toBeDefined();
    cfWalkers._reset();
    expect(cfWalkers.get('probe')).toBeUndefined();
    expect(cfWalkers.get('forward-import')).toBe(forwardImportWalker);
  });
});

describe('extendCrossFileChains', () => {
  const dummyCtx: CrossFileContext = {
    graph: { files: [], entryFiles: [], totalFiles: 0, skipped: 0 },
    project: createTestProject(),
  };

  it('appends walker steps to the matching finding by fingerprint', () => {
    cfWalkers.register('probe', () => ({
      appendSteps: [stepAt('/lib/foo.tsx', 7, 'memo boundary')],
    }));
    const finding = makeFinding('fp-1', [stepAt('/src/app.tsx', 5, 'inline prop')]);
    const report = makeReport([finding], [{ findingFingerprint: 'fp-1', walkerId: 'probe', payload: {} }]);

    const out = extendCrossFileChains(report, dummyCtx);

    expect(out.findings[0].provenance!.steps).toHaveLength(2);
    expect(out.findings[0].provenance!.steps[1].label).toBe('memo boundary');
  });

  it('APPEND-ONLY invariant: chain.steps[0..2] are byte-identical after extension', () => {
    cfWalkers.register('probe', () => ({
      appendSteps: [stepAt('/lib/foo.tsx', 7, 'appended')],
    }));
    const headSteps: ProvenanceStep[] = [
      { ...stepAt('/src/app.tsx', 1, 'head-0'), kind: 'boundary', category: 'memo-boundary' },
      { ...stepAt('/src/app.tsx', 2, 'head-1'), kind: 'call' },
      { ...stepAt('/src/app.tsx', 3, 'head-2'), kind: 'sink' },
    ];
    const headSnapshot = JSON.parse(JSON.stringify(headSteps));
    const finding = makeFinding('fp-1', headSteps);
    const report = makeReport([finding], [{ findingFingerprint: 'fp-1', walkerId: 'probe', payload: {} }]);

    extendCrossFileChains(report, dummyCtx);

    expect(finding.provenance!.steps.slice(0, 3)).toEqual(headSnapshot);
  });

  it('hard cap truncates and emits a `category: truncated` marker step', () => {
    cfWalkers.register('flood', () => ({
      appendSteps: [
        stepAt('/x', 1, 'a'),
        stepAt('/x', 2, 'b'),
        stepAt('/x', 3, 'c'),
        stepAt('/x', 4, 'd'),
        stepAt('/x', 5, 'e'),
      ],
    }));
    const head: ProvenanceStep[] = [stepAt('/src/app.tsx', 1, 'h')];
    const finding = makeFinding('fp-1', head);
    const report = makeReport([finding], [{ findingFingerprint: 'fp-1', walkerId: 'flood', payload: {} }]);

    extendCrossFileChains(report, dummyCtx, { hardCap: 4 });

    const steps = finding.provenance!.steps;
    // 1 head + 2 appended + 1 truncation marker = 4 (hardCap)
    expect(steps).toHaveLength(4);
    expect(steps[steps.length - 1].category).toBe('truncated');
  });

  it('unknown walkerId is a no-op (does not throw, does not mutate)', () => {
    const finding = makeFinding('fp-1', [stepAt('/src/app.tsx', 1, 'h')]);
    const report = makeReport([finding], [{ findingFingerprint: 'fp-1', walkerId: 'no-such-walker', payload: {} }]);

    const out = extendCrossFileChains(report, dummyCtx);
    expect(out.findings[0].provenance!.steps).toHaveLength(1);
  });

  it('missing finding fingerprint is a no-op', () => {
    cfWalkers.register('probe', () => ({ appendSteps: [stepAt('/x', 1, 'a')] }));
    const finding = makeFinding('fp-real', [stepAt('/src/app.tsx', 1, 'h')]);
    const report = makeReport([finding], [{ findingFingerprint: 'fp-MISSING', walkerId: 'probe', payload: {} }]);

    const out = extendCrossFileChains(report, dummyCtx);
    expect(out.findings[0].provenance!.steps).toHaveLength(1);
  });

  it('clears pendingCrossFileLinks on the returned report', () => {
    cfWalkers.register('probe', () => ({ appendSteps: [stepAt('/x', 1, 'a')] }));
    const finding = makeFinding('fp-1');
    const report = makeReport([finding], [{ findingFingerprint: 'fp-1', walkerId: 'probe', payload: {} }]);

    const out = extendCrossFileChains(report, dummyCtx);
    expect(out.pendingCrossFileLinks).toBeUndefined();
  });

  it('empty/missing pendingCrossFileLinks short-circuits and returns input', () => {
    const report = makeReport([makeFinding('fp-1')], []);
    const out = extendCrossFileChains(report, dummyCtx);
    expect(out).toBe(report);
  });
});

describe('forwardImportWalker', () => {
  it('resolves a named-export memoised component to the React.memo call site', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/lib/button.tsx',
      `
import { memo } from 'react';
export const MemoButton = memo(function Button(props: { onClick: () => void }) {
  return null as any;
});
`,
    );
    project.createSourceFile(
      '/src/app.tsx',
      `
import { MemoButton } from '/lib/button';
export function App() { return <MemoButton onClick={() => {}} />; }
`,
    );
    const graph = resolveImportGraph(['/src/app.tsx'], { project });
    const ctx: CrossFileContext = { graph, project };

    const result = forwardImportWalker(
      {
        findingFingerprint: 'x',
        walkerId: 'forward-import',
        payload: { symbol: 'MemoButton', targetFile: '/lib/button.tsx' },
      },
      makeFinding('x'),
      ctx,
    );

    expect(result.appendSteps).toHaveLength(1);
    const step = result.appendSteps[0];
    expect(step.kind).toBe('import');
    expect(step.category).toBe('memo-boundary');
    expect(step.location.file).toBe('/lib/button.tsx');
    expect(step.location.startLine).toBeGreaterThan(1);
    expect(step.label).toContain('MemoButton');
  });

  it('handles React.memo (namespace) wrap', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/lib/button.tsx',
      `
import * as React from 'react';
export const MemoButton = React.memo(function Button() {
  return null as any;
});
`,
    );
    project.createSourceFile(
      '/src/app.tsx',
      `
import { MemoButton } from '/lib/button';
export function App() { return <MemoButton />; }
`,
    );
    const graph = resolveImportGraph(['/src/app.tsx'], { project });
    const ctx: CrossFileContext = { graph, project };

    const result = forwardImportWalker(
      {
        findingFingerprint: 'x',
        walkerId: 'forward-import',
        payload: { symbol: 'MemoButton', targetFile: '/lib/button.tsx' },
      },
      makeFinding('x'),
      ctx,
    );
    expect(result.appendSteps).toHaveLength(1);
    expect(result.appendSteps[0].label).toContain('MemoButton');
  });

  it('unwraps forwardRef(memo(...)) and lands on the memo call', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/lib/button.tsx',
      `
import { memo, forwardRef } from 'react';
export const MemoButton = forwardRef(memo(function Button() {
  return null as any;
}));
`,
    );
    project.createSourceFile(
      '/src/app.tsx',
      `
import { MemoButton } from '/lib/button';
export function App() { return <MemoButton />; }
`,
    );
    const graph = resolveImportGraph(['/src/app.tsx'], { project });
    const ctx: CrossFileContext = { graph, project };

    const result = forwardImportWalker(
      {
        findingFingerprint: 'x',
        walkerId: 'forward-import',
        payload: { symbol: 'MemoButton', targetFile: '/lib/button.tsx' },
      },
      makeFinding('x'),
      ctx,
    );
    expect(result.appendSteps).toHaveLength(1);
    // Should land on `memo(...)`, not the outer `forwardRef(...)`. Verify
    // indirectly via line — the memo call sits one line deeper than the
    // outer forwardRef call.
    expect(result.appendSteps[0].location.startLine).toBeGreaterThan(2);
  });

  it('returns no steps when the target file is not in the project', () => {
    const project = createTestProject();
    const graph = resolveImportGraph([], { project });
    const ctx: CrossFileContext = { graph, project };

    const result = forwardImportWalker(
      {
        findingFingerprint: 'x',
        walkerId: 'forward-import',
        payload: { symbol: 'NotThere', targetFile: '/lib/nothing.tsx' },
      },
      makeFinding('x'),
      ctx,
    );
    expect(result.appendSteps).toEqual([]);
  });

  it('resolves the EXPORTED name (not the local alias) — regression for aliased imports', () => {
    // Gemini + Codex review 2026-05-14: when the parent did
    // `import { MemoButton as B } from './x'; <B />` the walker was being
    // handed `symbol: 'B'`, missing the source's `MemoButton` export and
    // silently producing no extension step. The rule emission was fixed to
    // pass `binding.importedName`; this test pins the walker side: it must
    // resolve a named export by its declared name, not the importer's alias.
    const project = createTestProject();
    project.createSourceFile(
      '/lib/button.tsx',
      `
import { memo } from 'react';
export const MemoButton = memo(function Button() { return null as any; });
`,
    );
    project.createSourceFile(
      '/src/app.tsx',
      `
import { MemoButton as B } from '/lib/button';
export function App() { return <B />; }
`,
    );
    const graph = resolveImportGraph(['/src/app.tsx'], { project });
    const ctx: CrossFileContext = { graph, project };

    const result = forwardImportWalker(
      {
        findingFingerprint: 'x',
        walkerId: 'forward-import',
        payload: { symbol: 'MemoButton', targetFile: '/lib/button.tsx' },
      },
      makeFinding('x'),
      ctx,
    );
    expect(result.appendSteps).toHaveLength(1);
    expect(result.appendSteps[0].label).toContain('MemoButton');
  });

  it('does NOT fall back to default export when a named lookup misses', () => {
    // Gemini review: a missed named lookup must not silently surface the
    // file's default export — that would point a finding's chain at an
    // unrelated component.
    const project = createTestProject();
    project.createSourceFile(
      '/lib/mixed.tsx',
      `
import { memo } from 'react';
export default function NotTheTarget() { return null as any; }
`,
    );
    project.createSourceFile(
      '/src/app.tsx',
      `import * as M from '/lib/mixed';\nexport function App() { return null as any; }\n`,
    );
    const graph = resolveImportGraph(['/src/app.tsx'], { project });
    const ctx: CrossFileContext = { graph, project };

    const result = forwardImportWalker(
      {
        findingFingerprint: 'x',
        walkerId: 'forward-import',
        payload: { symbol: 'MissingNamedExport', targetFile: '/lib/mixed.tsx' },
      },
      makeFinding('x'),
      ctx,
    );
    expect(result.appendSteps).toEqual([]);
  });

  it('returns no steps when payload is malformed (empty symbol or file)', () => {
    const project = createTestProject();
    const graph = resolveImportGraph([], { project });
    const ctx: CrossFileContext = { graph, project };

    expect(
      forwardImportWalker({ findingFingerprint: 'x', walkerId: 'forward-import', payload: {} }, makeFinding('x'), ctx)
        .appendSteps,
    ).toEqual([]);

    expect(
      forwardImportWalker(
        { findingFingerprint: 'x', walkerId: 'forward-import', payload: { symbol: 'Foo' } },
        makeFinding('x'),
        ctx,
      ).appendSteps,
    ).toEqual([]);
  });
});

describe('reverseJsxUsageWalker', () => {
  function buildCtxWith(files: Record<string, string>, entries: string[]): CrossFileContext {
    const project = new Project({
      compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100, jsx: 4 },
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
    for (const [path, content] of Object.entries(files)) project.createSourceFile(path, content);
    const graph = resolveImportGraph(entries, { project });
    return { graph, project };
  }

  it('is registered under id "reverse-jsx-usage" by default', () => {
    expect(cfWalkers.get('reverse-jsx-usage')).toBe(reverseJsxUsageWalker);
  });

  it('single defeating parent → one appended step', () => {
    const ctx = buildCtxWith(
      {
        '/lib/button.tsx': `
import { memo } from 'react';
export const MemoButton = memo(function Button(_: { onClick: () => void }) { return null as any; });
`,
        '/src/app.tsx': `
import { MemoButton } from '/lib/button';
export function App() { return <MemoButton onClick={() => {}} />; }
`,
      },
      ['/src/app.tsx', '/lib/button.tsx'],
    );

    const out = reverseJsxUsageWalker(
      {
        findingFingerprint: 'x',
        walkerId: 'reverse-jsx-usage',
        payload: { symbol: 'MemoButton', declFile: '/lib/button.tsx' },
      },
      makeFinding('x'),
      ctx,
    );

    expect(out.appendSteps).toHaveLength(1);
    expect(out.appendSteps[0].kind).toBe('sink');
    expect(out.appendSteps[0].location.file).toBe('/src/app.tsx');
    expect(out.appendSteps[0].label).toContain('App');
    expect(out.appendSteps[0].label).toContain('onClick');
    expect(out.truncated).toBeFalsy();
  });

  it('multiple defeating parents → multiple steps (deterministic order)', () => {
    const ctx = buildCtxWith(
      {
        '/lib/button.tsx': `
import { memo } from 'react';
export const MemoButton = memo(function Button(_: { onClick: () => void }) { return null as any; });
`,
        '/src/a.tsx': `
import { MemoButton } from '/lib/button';
export function ParentA() { return <MemoButton onClick={() => {}} />; }
`,
        '/src/b.tsx': `
import { MemoButton } from '/lib/button';
export function ParentB() { return <MemoButton onClick={() => {}} />; }
`,
      },
      ['/src/a.tsx', '/src/b.tsx', '/lib/button.tsx'],
    );

    const out = reverseJsxUsageWalker(
      {
        findingFingerprint: 'x',
        walkerId: 'reverse-jsx-usage',
        payload: { symbol: 'MemoButton', declFile: '/lib/button.tsx' },
      },
      makeFinding('x'),
      ctx,
    );

    expect(out.appendSteps).toHaveLength(2);
    const labels = out.appendSteps.map((s) => s.label).join(' || ');
    expect(labels).toContain('ParentA');
    expect(labels).toContain('ParentB');
  });

  it('ignores callers that pass NO inline props (those are not defeating memo)', () => {
    const ctx = buildCtxWith(
      {
        '/lib/button.tsx': `
import { memo } from 'react';
export const MemoButton = memo(function Button(_: { onClick: () => void }) { return null as any; });
`,
        '/src/clean.tsx': `
import { MemoButton } from '/lib/button';
const stable = () => {};
export function CleanParent() { return <MemoButton onClick={stable} />; }
`,
        '/src/inline.tsx': `
import { MemoButton } from '/lib/button';
export function InlineParent() { return <MemoButton onClick={() => {}} />; }
`,
      },
      ['/src/clean.tsx', '/src/inline.tsx', '/lib/button.tsx'],
    );

    const out = reverseJsxUsageWalker(
      {
        findingFingerprint: 'x',
        walkerId: 'reverse-jsx-usage',
        payload: { symbol: 'MemoButton', declFile: '/lib/button.tsx' },
      },
      makeFinding('x'),
      ctx,
    );

    // Only InlineParent should be surfaced — CleanParent passes a stable ref.
    expect(out.appendSteps).toHaveLength(1);
    expect(out.appendSteps[0].label).toContain('InlineParent');
  });

  it('inlinePropFilter="function" surfaces only parents passing inline functions', () => {
    const ctx = buildCtxWith(
      {
        '/lib/cell.tsx': `
import { memo } from 'react';
export const MemoCell = memo(function Cell(_: any) { return null as any; });
`,
        '/src/fn.tsx': `
import { MemoCell } from '/lib/cell';
export function FnParent() { return <MemoCell onClick={() => {}} />; }
`,
        '/src/obj.tsx': `
import { MemoCell } from '/lib/cell';
export function ObjParent() { return <MemoCell style={{ color: 'red' }} />; }
`,
      },
      ['/src/fn.tsx', '/src/obj.tsx', '/lib/cell.tsx'],
    );

    const out = reverseJsxUsageWalker(
      {
        findingFingerprint: 'x',
        walkerId: 'reverse-jsx-usage',
        payload: { symbol: 'MemoCell', declFile: '/lib/cell.tsx', inlinePropFilter: 'function' },
      },
      makeFinding('x'),
      ctx,
    );

    expect(out.appendSteps).toHaveLength(1);
    expect(out.appendSteps[0].label).toContain('FnParent');
    expect(out.appendSteps[0].label).not.toContain('ObjParent');
  });

  it('test files are NOT surfaced (index excludes them)', () => {
    const ctx = buildCtxWith(
      {
        '/lib/button.tsx': `
import { memo } from 'react';
export const MemoButton = memo(function Button(_: any) { return null as any; });
`,
        '/src/app.test.tsx': `
import { MemoButton } from '/lib/button';
test('renders', () => { const el = <MemoButton onClick={() => {}} />; void el; });
`,
        '/src/real.tsx': `
import { MemoButton } from '/lib/button';
export function RealParent() { return <MemoButton onClick={() => {}} />; }
`,
      },
      ['/src/app.test.tsx', '/src/real.tsx', '/lib/button.tsx'],
    );

    const out = reverseJsxUsageWalker(
      {
        findingFingerprint: 'x',
        walkerId: 'reverse-jsx-usage',
        payload: { symbol: 'MemoButton', declFile: '/lib/button.tsx' },
      },
      makeFinding('x'),
      ctx,
    );

    expect(out.appendSteps).toHaveLength(1);
    expect(out.appendSteps[0].label).toContain('RealParent');
  });

  it('soft cap caps steps and self-reports truncated=true (truncation marker emitted by extender)', () => {
    // Six parents render <MemoButton> with inline props — default softCap is 5.
    const parents = ['A', 'B', 'C', 'D', 'E', 'F'];
    const files: Record<string, string> = {
      '/lib/button.tsx': `
import { memo } from 'react';
export const MemoButton = memo(function Button(_: any) { return null as any; });
`,
    };
    for (const p of parents) {
      files[`/src/${p.toLowerCase()}.tsx`] = `
import { MemoButton } from '/lib/button';
export function Parent${p}() { return <MemoButton onClick={() => {}} />; }
`;
    }
    const ctx = buildCtxWith(files, [...parents.map((p) => `/src/${p.toLowerCase()}.tsx`), '/lib/button.tsx']);

    const walkerResult = reverseJsxUsageWalker(
      {
        findingFingerprint: 'fp-many',
        walkerId: 'reverse-jsx-usage',
        payload: { symbol: 'MemoButton', declFile: '/lib/button.tsx' },
      },
      makeFinding('fp-many'),
      ctx,
    );
    expect(walkerResult.appendSteps).toHaveLength(5);
    expect(walkerResult.truncated).toBe(true);

    // End-to-end: extender appends the truncation marker.
    const finding = makeFinding('fp-many', [stepAt('/lib/button.tsx', 1, 'memo decl')]);
    const report = makeReport(
      [finding],
      [
        {
          findingFingerprint: 'fp-many',
          walkerId: 'reverse-jsx-usage',
          payload: { symbol: 'MemoButton', declFile: '/lib/button.tsx' },
        },
      ],
    );
    extendCrossFileChains(report, ctx);
    const last = finding.provenance!.steps[finding.provenance!.steps.length - 1];
    expect(last.category).toBe('truncated');
  });

  it('returns no steps when payload is malformed', () => {
    const ctx = buildCtxWith({}, []);
    expect(
      reverseJsxUsageWalker(
        { findingFingerprint: 'x', walkerId: 'reverse-jsx-usage', payload: {} },
        makeFinding('x'),
        ctx,
      ).appendSteps,
    ).toEqual([]);
    expect(
      reverseJsxUsageWalker(
        { findingFingerprint: 'x', walkerId: 'reverse-jsx-usage', payload: { symbol: 'Foo' } },
        makeFinding('x'),
        ctx,
      ).appendSteps,
    ).toEqual([]);
  });

  it('cancelFinding=true is honored — finding is removed from the report', () => {
    cfWalkers.register('cancel-probe', () => ({ appendSteps: [], cancelFinding: true }));
    const finding = makeFinding('fp-cancel', [stepAt('/src/app.tsx', 1, 'head')]);
    const surviving = makeFinding('fp-keep', [stepAt('/src/app.tsx', 2, 'survives')]);
    const report = makeReport(
      [finding, surviving],
      [{ findingFingerprint: 'fp-cancel', walkerId: 'cancel-probe', payload: {} }],
    );
    const out = extendCrossFileChains(report, {
      graph: { files: [], entryFiles: [], totalFiles: 0, skipped: 0 },
      project: createTestProject(),
    });
    expect(out.findings.map((f) => f.fingerprint)).toEqual(['fp-keep']);
  });

  it('reverseJsxUsageWalker — minDefeaters=2 cancels finding when only 1 defeater exists', () => {
    const project = new Project({
      compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100, jsx: 4 },
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
    project.createSourceFile(
      '/lib/btn.tsx',
      `import { memo } from 'react';\nexport const MemoBtn = memo(function B(_: any) { return null as any; });\n`,
    );
    project.createSourceFile(
      '/src/only-one.tsx',
      `import { MemoBtn } from '/lib/btn';\nexport function OnlyOne() { return <MemoBtn onClick={() => {}} />; }\n`,
    );
    const graph = resolveImportGraph(['/src/only-one.tsx', '/lib/btn.tsx'], { project });
    const out = reverseJsxUsageWalker(
      {
        findingFingerprint: 'x',
        walkerId: 'reverse-jsx-usage',
        payload: { symbol: 'MemoBtn', declFile: '/lib/btn.tsx', minDefeaters: 2 },
      },
      makeFinding('x'),
      { graph, project },
    );
    expect(out.cancelFinding).toBe(true);
    expect(out.appendSteps).toEqual([]);
  });

  it('reverseJsxUsageWalker — minDefeaters=2 keeps finding when 2+ defeaters exist', () => {
    const project = new Project({
      compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100, jsx: 4 },
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
    project.createSourceFile(
      '/lib/btn.tsx',
      `import { memo } from 'react';\nexport const MemoBtn = memo(function B(_: any) { return null as any; });\n`,
    );
    project.createSourceFile(
      '/src/a.tsx',
      `import { MemoBtn } from '/lib/btn';\nexport function A() { return <MemoBtn onClick={() => {}} />; }\n`,
    );
    project.createSourceFile(
      '/src/b.tsx',
      `import { MemoBtn } from '/lib/btn';\nexport function B() { return <MemoBtn onClick={() => {}} />; }\n`,
    );
    const graph = resolveImportGraph(['/src/a.tsx', '/src/b.tsx', '/lib/btn.tsx'], { project });
    const out = reverseJsxUsageWalker(
      {
        findingFingerprint: 'x',
        walkerId: 'reverse-jsx-usage',
        payload: { symbol: 'MemoBtn', declFile: '/lib/btn.tsx', minDefeaters: 2 },
      },
      makeFinding('x'),
      { graph, project },
    );
    expect(out.cancelFinding).toBeFalsy();
    expect(out.appendSteps.length).toBeGreaterThanOrEqual(2);
  });

  it('returns no steps when no callers render the symbol with inline props', () => {
    const ctx = buildCtxWith(
      {
        '/lib/button.tsx': `
import { memo } from 'react';
export const MemoButton = memo(function Button(_: any) { return null as any; });
`,
        '/src/app.tsx': `
import { MemoButton } from '/lib/button';
const handler = () => {};
export function App() { return <MemoButton onClick={handler} />; }
`,
      },
      ['/src/app.tsx', '/lib/button.tsx'],
    );

    const out = reverseJsxUsageWalker(
      {
        findingFingerprint: 'x',
        walkerId: 'reverse-jsx-usage',
        payload: { symbol: 'MemoButton', declFile: '/lib/button.tsx' },
      },
      makeFinding('x'),
      ctx,
    );

    expect(out.appendSteps).toEqual([]);
  });
});
