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

  it('does NOT mark command-registry imports as dead exports', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/cli.ts',
      `
import { runApply } from './apply.js';

const COMMANDS = { apply: runApply };

export function main() {
  const handler = COMMANDS.apply;
  handler([]);
}
`,
    );
    project.createSourceFile(
      '/src/apply.ts',
      `
export function runApply(args: string[]) { return args.length; }
export function unused() { return 0; }
`,
    );

    const graph = resolveImportGraph(['/src/cli.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    expect(callGraph.deadExports).not.toContain('/src/apply.ts#runApply');
    expect(callGraph.deadExports).toContain('/src/apply.ts#unused');
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

  it('walks 3-hop curated barrel chain to the real declaration', () => {
    // Outer barrel re-exports from inner barrel re-exports from worker. When
    // ts-morph's `getExportedDeclarations()` traces this end-to-end the chain
    // walk is unused; when it cannot (the empirically observed failure mode)
    // the explicit walk lands the binding at worker.ts so dead-export does
    // not flag worker.ts#helper as a false positive.
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import { helper } from './outer-barrel.js';
export function main() { helper(); }
`,
    );
    project.createSourceFile('/src/outer-barrel.ts', `export { helper } from './inner-barrel.js';`);
    project.createSourceFile('/src/inner-barrel.ts', `export { helper } from './worker.js';`);
    project.createSourceFile('/src/worker.ts', `export function helper() { return 1; }`);

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    expect(callGraph.deadExports).not.toContain('/src/worker.ts#helper');
    const fnHelper = callGraph.functions.get('/src/worker.ts#helper');
    expect(fnHelper!.calledBy.some((c) => c.callerFile === '/src/main.ts')).toBe(true);
  });

  it('does not overgeneralise: chain lands on the re-export target, not a same-named twin', () => {
    // A different file that happens to export `helper` must NOT be wired up
    // as the call target just because the names match — that is the file-scope
    // trap from the three known-broken paths. The decoy is reachable in the
    // import graph (main.ts imports it) so it lives in `callGraph.functions`,
    // and we assert the call from main.ts lands on worker, not on decoy.
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import { helper } from './barrel.js';
import { helper as decoyHelper } from './decoy.js';
export function main() { helper(); decoyHelper; }
`,
    );
    project.createSourceFile('/src/barrel.ts', `export { helper } from './worker.js';`);
    project.createSourceFile('/src/worker.ts', `export function helper() { return 1; }`);
    project.createSourceFile('/src/decoy.ts', `export function helper() { return 999; }`);

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    const fnMain = callGraph.functions.get('/src/main.ts#main');
    const helperCall = fnMain!.calls.find((c) => c.targetName === 'helper');
    expect(helperCall!.targetFile).toBe('/src/worker.ts');

    const fnDecoy = callGraph.functions.get('/src/decoy.ts#helper');
    expect(fnDecoy!.calledBy.length).toBe(0);
  });

  it('handles `as` alias rename in the middle of a re-export chain', () => {
    // outer re-exports `foo` (no rename). middle re-exports `realFoo as foo`.
    // The chain walker must use the OUTGOING name to match the consumer's
    // import (`foo`) at outer, then switch to the UPSTREAM name (`realFoo`)
    // when looking it up in worker. Swapping the alias direction would
    // silently break, so this is a guard against that regression.
    const project = createTestProject();
    project.createSourceFile(
      '/src/main.ts',
      `
import { foo } from './outer.js';
export function main() { foo(); }
`,
    );
    project.createSourceFile('/src/outer.ts', `export { foo } from './middle.js';`);
    project.createSourceFile('/src/middle.ts', `export { realFoo as foo } from './worker.js';`);
    project.createSourceFile('/src/worker.ts', `export function realFoo() { return 1; }`);

    const graph = resolveImportGraph(['/src/main.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    const fnReal = callGraph.functions.get('/src/worker.ts#realFoo');
    expect(fnReal!.calledBy.some((c) => c.callerFile === '/src/main.ts')).toBe(true);
    expect(callGraph.deadExports).not.toContain('/src/worker.ts#realFoo');
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

// Phase 4 step 5 — test files are NOT production consumers. A helper called
// only by *.test.ts must still be flagged dead so the user can clean up
// stale code; otherwise tests anchor unused production exports forever.
// Red-team #3 specifically called out this loophole: tests imported and
// called the helper, so calledBy was non-empty AND importedExportKeys
// contained the symbol — both checks the dead-export rule depends on.
describe('Phase 4 test files excluded from caller closure', () => {
  it('flags a production helper that is only called by a *.test.ts file', () => {
    const project = createTestProject();
    project.createSourceFile(
      '/src/helpers.ts',
      `export function prodHelper() { return 42; }\nexport function liveHelper() { return 1; }\n`,
    );
    // Production caller of liveHelper — it stays alive.
    project.createSourceFile(
      '/src/main.ts',
      `import { liveHelper } from './helpers.js';\nexport function run() { return liveHelper(); }\n`,
    );
    // Only this test file references prodHelper. Without the step-5 filter
    // the test would call prodHelper() and pin it as alive forever.
    project.createSourceFile(
      '/src/helpers.test.ts',
      `import { prodHelper } from './helpers.js';\nexport function spec() { return prodHelper(); }\n`,
    );

    const graph = resolveImportGraph(['/src/main.ts', '/src/helpers.test.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    expect(callGraph.deadExports).toContain('/src/helpers.ts#prodHelper');
    expect(callGraph.deadExports).not.toContain('/src/helpers.ts#liveHelper');
  });

  it('also filters when the test only IMPORTS the helper (no call yet)', () => {
    const project = createTestProject();
    project.createSourceFile('/src/helpers.ts', `export function imported() { return 1; }\n`);
    // Test imports but doesn't call. Without the importedExportKeys filter
    // for test files, just the import would silence dead-export.
    project.createSourceFile(
      '/src/helpers.test.ts',
      `import { imported } from './helpers.js';\nexport function spec() { /* TODO */ void imported; }\n`,
    );

    const graph = resolveImportGraph(['/src/helpers.test.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    expect(callGraph.deadExports).toContain('/src/helpers.ts#imported');
  });

  it('does NOT misfire on a helper used by both production and tests', () => {
    const project = createTestProject();
    project.createSourceFile('/src/helpers.ts', `export function shared() { return 1; }\n`);
    project.createSourceFile(
      '/src/main.ts',
      `import { shared } from './helpers.js';\nexport function run() { return shared(); }\n`,
    );
    project.createSourceFile(
      '/src/helpers.test.ts',
      `import { shared } from './helpers.js';\nexport function spec() { return shared(); }\n`,
    );

    const graph = resolveImportGraph(['/src/main.ts', '/src/helpers.test.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    expect(callGraph.deadExports).not.toContain('/src/helpers.ts#shared');
  });
});

// Phase 4 step 9b — symbol-scoped reachability blockers and the default-export
// alias. Two FP shapes Codex flagged HIGH-severity in the plan-review pass:
//   1. Seed says (path, 'default') but call graph stores 'Page' → mismatch.
//   2. Hard suppression lost recall AND broke fpRateEstimate; the cap+trail
//      preserves both.
describe('Phase 4 default-alias + reachability blocker (step 9b)', () => {
  function createTestProject(): Project {
    return new Project({
      compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100 },
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
  }

  it('populates callGraph.defaultExportNames from `export default function Page()`', () => {
    const project = createTestProject();
    project.createSourceFile('/src/page.tsx', `export default function Page() { return null; }\n`);
    project.createSourceFile('/src/dummy.ts', `export const x = 1;\n`);

    const graph = resolveImportGraph(['/src/page.tsx', '/src/dummy.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    expect(callGraph.defaultExportNames.get('/src/page.tsx')).toBe('Page');
  });

  it("treats a `(path, 'default')` seed as proof `(path, 'Page')` is public — default-alias", () => {
    const project = createTestProject();
    // Page has no caller in the graph — but the framework seed says
    // pagePath#default is public, and Page IS the default. No FP.
    project.createSourceFile('/src/app/page.tsx', `export default function Page() { return null; }\n`);

    const graph = resolveImportGraph(['/src/app/page.tsx'], { project });
    const callGraph = buildCallGraph(graph, project);

    const publicApi = {
      entryFiles: new Set<string>(),
      explicitSymbols: new Set(['/src/app/page.tsx#default']),
    };
    const findings = deadExportRule(callGraph, '/src/app/page.tsx', publicApi);
    expect(findings).toEqual([]);
  });

  it('caps confidence at 0.4 and demotes severity to info when a blocker matches the symbol', () => {
    const project = createTestProject();
    project.createSourceFile('/src/handlers.ts', `export function handlerA() {}\nexport function handlerB() {}\n`);
    project.createSourceFile(
      '/src/registry.ts',
      `import { handlerA } from './handlers.js';\nexport function used() { handlerA(); }\n`,
    );

    const graph = resolveImportGraph(['/src/registry.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    // Pretend the graph couldn't prove handlerB unreachable (e.g. a
    // non-literal `import(routes[id])` somewhere targeted it). The
    // blocker carries the exact (file, name).
    const blockers = [
      {
        reason: 'non-literal-dynamic-import' as const,
        filePath: '/src/handlers.ts',
        exportName: 'handlerB',
        site: { file: '/src/registry.ts', line: 1 },
      },
    ];
    const findings = deadExportRule(callGraph, '/src/handlers.ts', undefined, blockers);

    const blocked = findings.find((f) => f.message.includes('handlerB'));
    expect(blocked).toBeDefined();
    expect(blocked?.severity).toBe('info');
    expect(blocked?.confidence).toBeLessThanOrEqual(0.4);
    expect(blocked?.calibrationTrail).toBeDefined();
    expect(blocked?.calibrationTrail?.[0]?.stage).toBe('reachability:blocker');
    expect(blocked?.calibrationTrail?.[0]?.reason).toBe('non-literal-dynamic-import');
    // afterConfidence equals the cap (or the original if it was lower).
    expect(blocked?.calibrationTrail?.[0]?.afterConfidence).toBe(blocked?.confidence);
  });

  it('does NOT silence unrelated exports in the same file (red-team CRITICAL #1)', () => {
    const project = createTestProject();
    // Two independent exports. Only handlerB has a blocker.
    project.createSourceFile('/src/handlers.ts', `export function handlerA() {}\nexport function handlerB() {}\n`);
    project.createSourceFile('/src/registry.ts', `// nothing imported\nexport function noop() {}\n`);

    const graph = resolveImportGraph(['/src/registry.ts', '/src/handlers.ts'], { project });
    const callGraph = buildCallGraph(graph, project);

    const blockers = [
      {
        reason: 'non-literal-dynamic-import' as const,
        filePath: '/src/handlers.ts',
        exportName: 'handlerB',
        site: { file: '/src/registry.ts', line: 1 },
      },
    ];
    const findings = deadExportRule(callGraph, '/src/handlers.ts', undefined, blockers);

    // handlerA stays at warning severity — the blocker on handlerB does
    // not cross-contaminate. This is the symbol-scope invariant.
    const a = findings.find((f) => f.message.includes('handlerA'));
    const b = findings.find((f) => f.message.includes('handlerB'));
    expect(a?.severity).toBe('warning');
    expect(a?.calibrationTrail).toBeUndefined();
    expect(b?.severity).toBe('info');
  });

  it('blocker cap matches via default-alias when the seed says default but the call graph stored Page', () => {
    const project = createTestProject();
    project.createSourceFile('/src/app/page.tsx', `export default function Page() { return null; }\n`);

    const graph = resolveImportGraph(['/src/app/page.tsx'], { project });
    const callGraph = buildCallGraph(graph, project);

    const blockers = [
      {
        reason: 'unresolved-re-export' as const,
        filePath: '/src/app/page.tsx',
        exportName: 'default',
        site: { file: '/src/app/page.tsx', line: 1 },
      },
    ];
    const findings = deadExportRule(callGraph, '/src/app/page.tsx', undefined, blockers);

    const blocked = findings.find((f) => f.message.includes('Page'));
    expect(blocked?.severity).toBe('info');
    expect(blocked?.confidence).toBeLessThanOrEqual(0.4);
  });
});
