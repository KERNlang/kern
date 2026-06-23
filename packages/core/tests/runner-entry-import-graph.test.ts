/** Runner-standalone slice — anti-rot HARD GATE for `@kernlang/core/runner`.
 *
 *  Proves the standalone runtime entry stays typescript-free: walking the STATIC
 *  import graph of the built `dist/runner.js` must resolve a bare-specifier set of
 *  EXACTLY `['decimal.js']` (the Decimal "calculator" — the only sanctioned
 *  external dep), never `typescript` and never `node:vm`, and never reach the
 *  differential-test harness chain (`harness → ts-leg → body-ts →
 *  closure-eligibility`) or any of the 5 compiler-puller modules.
 *
 *  This is the regression guard for the decoupling: the runner closure was
 *  measured at 28 modules / `decimal.js`-only after the single
 *  `ir/semantics/index.ts` harness re-export was moved to the test-only
 *  `ir/semantics/testing.ts` barrel. Any future PR that imports a TS-backed
 *  helper into a contract, the runner, or the parser spine re-acquires the ~10MB
 *  compiler edge and FAILS here.
 *
 *  Mechanism mirrors `browser-spine-import-graph.test.ts`: recursively read each
 *  ESM module's static `import`/`export … from` specifiers (emitted dist is plain
 *  ESM with explicit `./x.js` specifiers), follow every RELATIVE specifier, and
 *  flag any BARE specifier or any relative path resolving to a forbidden module.
 *  Dynamic `import()` is intentionally NOT followed — the runtime entry must be
 *  STATICALLY typescript-free.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '../dist');

/** Extract the module specifiers of every STATIC `import`/`export … from`
 *  statement. Deliberately ignores dynamic `import(…)` calls. */
function staticSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\b[^;\n]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const spec = m[1] ?? m[2];
    if (spec) specs.push(spec);
  }
  return specs;
}

/** Walk the static import graph starting at `entry` (absolute dist path).
 *  Returns the set of BARE specifiers encountered and the set of resolved
 *  relative module paths visited. */
function walkGraph(entry: string): { bare: Set<string>; visited: Set<string> } {
  const bare = new Set<string>();
  const visited = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) continue;
    const source = readFileSync(file, 'utf8');
    for (const spec of staticSpecifiers(source)) {
      if (spec.startsWith('.')) stack.push(resolve(dirname(file), spec));
      else bare.add(spec);
    }
  }
  return { bare, visited };
}

// Modules that statically `import ts from 'typescript'` (the ~10MB pull) plus the
// harness chain that reaches them. The runner closure must touch NONE of these.
const FORBIDDEN_MODULES = [
  'harness.js',
  'ts-leg.js',
  'body-ts.js',
  'closure-eligibility.js',
  'assignment-operators-ts.js',
  'closure-python-lowering.js',
  'native-eligibility-ast.js',
  'importer.js',
];

describe('@kernlang/core/runner — standalone runtime entry import-graph proof', () => {
  const entry = resolve(DIST, 'runner.js');

  test('dist/runner.js exists (build ran)', () => {
    expect(existsSync(entry)).toBe(true);
  });

  test('runner static graph bare specifiers are EXACTLY ["decimal.js"] (HARD GATE)', () => {
    const { bare } = walkGraph(entry);
    // The pin: decimal.js is the only sanctioned external dep. If the runner ever
    // re-acquires the compiler, `typescript` (and likely `node:vm`) appear here.
    expect([...bare].sort()).toEqual(['decimal.js']);
  });

  test('runner static graph resolves zero typescript and zero node:vm', () => {
    const { bare } = walkGraph(entry);
    expect([...bare]).not.toContain('typescript');
    expect([...bare]).not.toContain('node:vm');
  });

  test('runner closure never reaches the harness chain or any compiler-puller module', () => {
    const { visited } = walkGraph(entry);
    for (const forbidden of FORBIDDEN_MODULES) {
      const reached = [...visited].some((p) => p.endsWith(`/${forbidden}`));
      expect({ forbidden, reached }).toEqual({ forbidden, reached: false });
    }
  });

  test('runner closure never reaches the public `.` barrel (dist/index.js)', () => {
    // Importing from the `.` barrel would drag in node.js → the TS compiler. The
    // runner must source its runtime surface from `ir/semantics/index.js`, never
    // the public root barrel.
    const { visited } = walkGraph(entry);
    expect([...visited]).not.toContain(resolve(DIST, 'index.js'));
  });
});
