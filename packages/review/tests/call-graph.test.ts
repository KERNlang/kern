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

  it('resolves aliased named imports through re-export chains', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import { baz } from './barrel.js';
export function main() { baz(); }
`,
    );
    project.createSourceFile(
      '/src/barrel.ts',
      `
export { helper as baz } from './helper.js';
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
    const helperCall = fnMain!.calls.find((c) => c.targetFile === '/src/helper.ts');
    expect(helperCall).toBeDefined();
    expect(helperCall!.resolved).toBe(true);
    expect(helperCall!.targetName).toBe('helper');

    const fnHelper = callGraph.functions.get('/src/helper.ts#helper');
    expect(fnHelper!.calledBy.some((c) => c.callerFile === '/src/main.ts')).toBe(true);
  });

  it('resolves namespace imports through barrel re-exports', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import * as api from './barrel.js';
export function main() { api.helper(); }
`,
    );
    project.createSourceFile(
      '/src/barrel.ts',
      `
export { helper } from './helper.js';
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
    const helperCall = fnMain!.calls.find((c) => c.targetFile === '/src/helper.ts');
    expect(helperCall).toBeDefined();
    expect(helperCall!.resolved).toBe(true);
    expect(helperCall!.targetName).toBe('helper');
  });

  it('resolves default imports to the actual exported function name', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import helper from './helper.js';
export function main() { helper(); }
`,
    );
    project.createSourceFile(
      '/src/helper.ts',
      `
export default function helper() { return 42; }
`,
    );

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    const fnMain = callGraph.functions.get('/src/main.ts#main');
    const helperCall = fnMain!.calls.find((c) => c.targetFile === '/src/helper.ts');
    expect(helperCall).toBeDefined();
    expect(helperCall!.resolved).toBe(true);
    expect(helperCall!.targetName).toBe('helper');
  });
});

describe('Call Graph: local alias tracking', () => {
  it('resolves local alias to imported function — const f = imported; f()', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import { fetchData } from './api.js';
const f = fetchData;
export async function handler() { await f(); }
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

    const fnHandler = callGraph.functions.get('/src/main.ts#handler');
    const call = fnHandler!.calls.find((c) => c.targetName === 'fetchData');
    expect(call).toBeDefined();
    expect(call!.resolved).toBe(true);
    expect(call!.targetFile).toBe('/src/api.ts');

    const fnFetch = callGraph.functions.get('/src/api.ts#fetchData');
    expect(fnFetch!.calledBy.some((c) => c.callerFile === '/src/main.ts')).toBe(true);
  });

  it('resolves local alias to local function — const g = helper; g()', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
function helper() { return 42; }
const g = helper;
export function main() { g(); }
`,
    );

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    const fnMain = callGraph.functions.get('/src/main.ts#main');
    const call = fnMain!.calls.find((c) => c.targetName === 'helper');
    expect(call).toBeDefined();
    expect(call!.resolved).toBe(true);
    expect(call!.targetFile).toBe('/src/main.ts');
  });

  it('resolves transitive alias — const g = f where f = imported', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import { fetchData } from './api.js';
const f = fetchData;
const g = f;
export async function handler() { await g(); }
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

    const fnHandler = callGraph.functions.get('/src/main.ts#handler');
    const call = fnHandler!.calls.find((c) => c.targetName === 'fetchData');
    expect(call).toBeDefined();
    expect(call!.resolved).toBe(true);
    expect(call!.targetFile).toBe('/src/api.ts');
  });

  it('does not create alias for non-identifier RHS — const x = 42', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import { fetchData } from './api.js';
const x = 42;
const fn = fetchData;
export async function main() { await fn(); await fetchData(); void x; }
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

    const fnMain = callGraph.functions.get('/src/main.ts#main');
    // Both alias call (fn) and direct import call should resolve to fetchData
    const resolvedToFetch = fnMain!.calls.filter(
      (c) => c.resolved && c.targetFile === '/src/api.ts' && c.targetName === 'fetchData',
    );
    expect(resolvedToFetch.length).toBe(2);
  });

  it('does NOT apply file-global alias inside a function that shadows the name', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import { fetchData } from './api.js';
const load = fetchData;
function localFallback() { return []; }
export function handler() {
  const load = localFallback;
  load();
}
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

    const fnHandler = callGraph.functions.get('/src/main.ts#handler');
    // The `load()` call MUST NOT resolve to fetchData — the inner `const load`
    // shadows the outer alias.
    const fetchDataCall = fnHandler!.calls.find(
      (c) => c.resolved && c.targetFile === '/src/api.ts' && c.targetName === 'fetchData',
    );
    expect(fetchDataCall).toBeUndefined();

    // fetchData in api.ts should have ZERO callers from handler()
    const fnFetch = callGraph.functions.get('/src/api.ts#fetchData');
    expect(fnFetch!.calledBy.some((c) => c.callerFile === '/src/main.ts' && c.callerName === 'handler')).toBe(false);
  });

  it('cross-file async rule catches missing await through an alias', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import { fetchData } from './api.js';
const load = fetchData;
export function handler() { load(); }
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

    const fp = findings.find((f) => f.ruleId === 'floating-promise' && f.message.includes('fetchData'));
    expect(fp).toBeDefined();
  });

  it('dead export rule no longer flags an export that is called through an alias', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import { used } from './lib.js';
const u = used;
export function main() { u(); }
`,
    );
    project.createSourceFile(
      '/src/lib.ts',
      `
export function used() { return 1; }
`,
    );

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

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
    const deadExport = findings.find((f) => f.ruleId === 'dead-export' && f.message.includes('unused'));
    expect(deadExport).toBeDefined();
    expect(findings.some((f) => f.message.includes('used') && !f.message.includes('unused'))).toBe(false);
    expect(deadExport?.provenance?.summary).toContain('No resolved callers');
    expect(deadExport?.provenance?.steps[0]?.label).toContain('unused');
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
    const fp = findings.find((f) => f.ruleId === 'floating-promise' && f.message.includes('fetchData'));
    expect(fp).toBeDefined();
    expect(fp?.relatedSpans?.[0]?.file).toBe('/src/api.ts');
    expect(fp?.provenance?.summary).toContain('calls async fetchData()');
    expect(fp?.provenance?.steps).toHaveLength(2);
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
