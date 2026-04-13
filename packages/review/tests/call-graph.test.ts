/**
 * Call graph tests — function-level call resolution and dead code detection.
 */

import { Project } from 'ts-morph';
import { buildCallGraph } from '../src/call-graph.js';
import { resolveImportGraph } from '../src/graph.js';
import { crossFileAsyncRule, deadExportRule } from '../src/rules/dead-code.js';

function createTestProject(): Project {
  return new Project({
    compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100 },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
}

describe('Call Graph: intra-file', () => {
  it('resolves direct function calls within a file', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
export function a() { b(); }
function b() { c(); }
function c() { return 42; }
`,
    );

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    const fnA = callGraph.functions.get('/src/main.ts#a');
    expect(fnA).toBeDefined();
    expect(fnA!.calls.some((c) => c.targetName === 'b' && c.resolved)).toBe(true);

    const fnB = callGraph.functions.get('/src/main.ts#b');
    expect(fnB).toBeDefined();
    expect(fnB!.calls.some((c) => c.targetName === 'c' && c.resolved)).toBe(true);
  });

  it('detects orphan functions (not exported, not called)', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
export function used() { return 1; }
function orphan() { return 2; }
`,
    );

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    expect(callGraph.orphanFunctions).toContain('/src/main.ts#orphan');
  });

  it('does NOT mark non-exported function as orphan if called internally', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
export function main() { helper(); }
function helper() { return 42; }
`,
    );

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    expect(callGraph.orphanFunctions).not.toContain('/src/main.ts#helper');
  });
});

describe('Call Graph: cross-file', () => {
  it('resolves imported function calls', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import { helper } from './helper.js';
export function main() { helper(); }
`,
    );
    project.createSourceFile(
      '/src/helper.ts',
      `
export function helper() { return 42; }
`,
    );

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    const fnMain = callGraph.functions.get('/src/main.ts#main');
    expect(fnMain).toBeDefined();
    const helperCall = fnMain!.calls.find((c) => c.targetName === 'helper');
    expect(helperCall).toBeDefined();
    expect(helperCall!.resolved).toBe(true);
    expect(helperCall!.targetFile).toBe('/src/helper.ts');

    // helper should have calledBy edge
    const fnHelper = callGraph.functions.get('/src/helper.ts#helper');
    expect(fnHelper).toBeDefined();
    expect(fnHelper!.calledBy.length).toBeGreaterThanOrEqual(1);
  });

  it('detects dead exports (exported but never imported)', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import { used } from './lib.js';
export function main() { used(); }
`,
    );
    project.createSourceFile(
      '/src/lib.ts',
      `
export function used() { return 1; }
export function unused() { return 2; }
`,
    );

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    expect(callGraph.deadExports).toContain('/src/lib.ts#unused');
    expect(callGraph.deadExports).not.toContain('/src/lib.ts#used');
  });
});

describe('Dead export rule', () => {
  it('produces finding for dead exports', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import { used } from './lib.js';
export function main() { used(); }
`,
    );
    project.createSourceFile(
      '/src/lib.ts',
      `
export function used() { return 1; }
export function unused() { return 2; }
`,
    );

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    const findings = deadExportRule(callGraph, '/src/lib.ts');
    expect(findings.some((f) => f.ruleId === 'dead-export' && f.message.includes('unused'))).toBe(true);
    expect(findings.some((f) => f.message.includes('used') && !f.message.includes('unused'))).toBe(false);
  });
});

describe('Cross-file async rule', () => {
  it('detects missing await on imported async function', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import { fetchData } from './api.js';
export function handler() { fetchData(); }
`,
    );
    project.createSourceFile(
      '/src/api.ts',
      `
export async function fetchData() { return []; }
`,
    );

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    const findings = crossFileAsyncRule(callGraph, '/src/main.ts');
    expect(findings.some((f) => f.ruleId === 'floating-promise' && f.message.includes('fetchData'))).toBe(true);
  });

  it('does NOT flag awaited calls', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import { fetchData } from './api.js';
export async function handler() { await fetchData(); }
`,
    );
    project.createSourceFile(
      '/src/api.ts',
      `
export async function fetchData() { return []; }
`,
    );

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    const findings = crossFileAsyncRule(callGraph, '/src/main.ts');
    expect(findings.length).toBe(0);
  });
});
