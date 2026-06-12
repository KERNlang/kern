/** Slice 0.9 — R1 barrel-isolation HARD GATE.
 *
 *  Proves the browser parser spine no longer drags in TypeScript: walking the
 *  STATIC import graph of the built `dist/parser-expression.js` AND the core
 *  barrel `dist/index.js` must resolve ZERO `typescript` modules and never
 *  reach `closure-eligibility.js` (the module that statically imports
 *  `typescript`).
 *
 *  Mechanism: recursively read each ESM module's static `import`/`export … from`
 *  specifiers (the emitted dist is plain ESM with explicit `./x.js` specifiers),
 *  follow every RELATIVE specifier, and flag any BARE specifier (e.g.
 *  `typescript`) or any relative path that resolves to `closure-eligibility.js`.
 *  Dynamic `import()` is intentionally NOT followed — the parser spine must be
 *  statically free of TypeScript, and slice 0.9 forbids dynamic
 *  `import('typescript')` inside the parser anyway.
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
  // `import … from '…'`, `import '…'`, `export … from '…'` (single or double quote).
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
      if (spec.startsWith('.')) {
        const resolved = resolve(dirname(file), spec);
        stack.push(resolved);
      } else {
        // Bare specifier — a real external package dependency (incl. node:*).
        bare.add(spec);
      }
    }
  }
  return { bare, visited };
}

describe('browser parser spine — R1 import-graph proof', () => {
  // ── HARD GATE: the browser-safe parser spine ────────────────────────────
  // `parser-expression.js` is what Game Studio (and any browser consumer)
  // imports for `parseExpression`/`parseDocument`. Its static import graph must
  // resolve ZERO `typescript` modules and never reach `closure-eligibility.js`
  // (the module that statically imports `typescript`). This is the slice-0.9
  // deliverable and R1's core obligation.
  // Both browser-facing entry points — `parser-expression.js` (`parseExpression`)
  // and `parser.js` (the `@kernlang/core/parser` subpath: `parseDocument`,
  // `parseDocumentWithDiagnostics`, `parse`, `parseStrict`) — must be spine-clean.
  for (const entryFile of ['parser-expression.js', 'parser.js', 'parser-core.js']) {
    test(`dist/${entryFile} static graph resolves zero typescript modules (HARD GATE)`, () => {
      const entry = resolve(DIST, entryFile);
      expect(existsSync(entry)).toBe(true);
      const { bare, visited } = walkGraph(entry);
      expect([...bare]).not.toContain('typescript');
      const reachesClosureEligibility = [...visited].some((p) => p.endsWith('closure-eligibility.js'));
      expect(reachesClosureEligibility).toBe(false);
    });
  }

  // R1 "exclusively" proof: enumerate EVERY module in the barrel graph that
  // statically imports `typescript`. After slice 0.9 the ONLY such module is
  // `closure-eligibility.js` (reached via the Node-only TS-codegen re-parse path,
  // body-ts → typescript-closure-classifier → closure-eligibility). This pins the
  // remaining barrel taint to that single, explicitly-deferred path — so the
  // follow-up barrel-cleanup slice knows it is the last edge to cut.
  test('dist/index.js (barrel) static typescript edges are exactly {closure-eligibility.js}', () => {
    const entry = resolve(DIST, 'index.js');
    expect(existsSync(entry)).toBe(true);
    const visited = new Set<string>();
    const tsImporters = new Set<string>();
    const stack = [entry];
    while (stack.length > 0) {
      const file = stack.pop();
      if (file === undefined || visited.has(file)) continue;
      visited.add(file);
      if (!existsSync(file)) continue;
      const source = readFileSync(file, 'utf8');
      for (const spec of staticSpecifiers(source)) {
        if (spec.startsWith('.')) stack.push(resolve(dirname(file), spec));
        else if (spec === 'typescript') tsImporters.add(file.replace(`${DIST}/`, ''));
      }
    }
    expect([...tsImporters].sort()).toEqual(['closure-eligibility.js']);
  });

  // R1 literal: the closure helpers must LEAVE the barrel (index.ts re-exported
  // them from `closure-eligibility.js`). Assert the barrel module itself no
  // longer statically imports/re-exports the closure-eligibility / closure-python
  // lowering / TS-closure-classifier / importer / native-eligibility-ast modules.
  // (The barrel still re-exports the Node-only TS-codegen entrypoints —
  // `emitNativeKernBodyTS` / `generateCoreNode` — which the one-pager explicitly
  // permits: "root export cleanup is not part of this slice; a Node/root
  // entrypoint may still export TS-backed helpers." Full-barrel typescript
  // freedom requires de-typescripting the TS codegen re-parse path, a deferred
  // follow-up slice.)
  test('dist/index.js (core barrel) no longer statically re-exports the closure-eligibility module', () => {
    const entry = resolve(DIST, 'index.js');
    expect(existsSync(entry)).toBe(true);
    const directSpecs = staticSpecifiers(readFileSync(entry, 'utf8'));
    const resolvedDirect = directSpecs
      .filter((s) => s.startsWith('.'))
      .map((s) => resolve(dirname(entry), s).replace(`${DIST}/`, ''));
    for (const forbidden of [
      'closure-eligibility.js',
      'closure-python-lowering.js',
      'typescript-closure-classifier.js',
      'importer.js',
      'native-eligibility-ast.js',
    ]) {
      expect(resolvedDirect).not.toContain(forbidden);
    }
  });

  test('the typescript adapter IS reachable by direct subpath import (Node/codegen side)', () => {
    // The adapter must still exist and statically depend on closure-eligibility,
    // proving the capability was moved out of the spine, not deleted.
    const entry = resolve(DIST, 'typescript-closure-classifier.js');
    expect(existsSync(entry)).toBe(true);
    const { visited } = walkGraph(entry);
    const reachesClosureEligibility = [...visited].some((p) => p.endsWith('closure-eligibility.js'));
    expect(reachesClosureEligibility).toBe(true);
  });

  test('the @kernlang/core/node subpath exposes the TS-backed closure capability', () => {
    const entry = resolve(DIST, 'node.js');
    expect(existsSync(entry)).toBe(true);
    const { bare, visited } = walkGraph(entry);
    expect([...bare]).toContain('typescript');
    expect([...visited].some((p) => p.endsWith('closure-eligibility.js'))).toBe(true);
  });
});
