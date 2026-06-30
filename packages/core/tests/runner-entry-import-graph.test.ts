/** Runner-standalone slice — anti-rot HARD GATE for `@kernlang/core/runner`.
 *
 *  Proves the standalone runtime entries stay typescript-free: walking the
 *  STATIC import graph of the built `dist/runner.js` and browser subpath
 *  `dist/runner-browser.js` must resolve a bare-specifier set of EXACTLY
 *  `['decimal.js']` (the Decimal "calculator" — the only sanctioned external
 *  dep), never `typescript` and never `node:vm`, and never reach the
 *  differential-test harness chain (`harness → ts-leg → body-ts →
 *  closure-eligibility`) or any of the 5 compiler-puller modules.
 *
 *  This is the regression guard for the decoupling: after the single
 *  `ir/semantics/index.ts` harness re-export was moved to the test-only
 *  `ir/semantics/testing.ts` barrel, the runner closure's only external dependency
 *  is `decimal.js` (the pinned invariant below — module COUNT is deliberately not
 *  pinned, since legitimately adding a contract would churn it). Any future PR that
 *  imports a TS-backed helper into a contract, the runner, or the parser spine
 *  re-acquires the ~10MB compiler edge and FAILS the `decimal.js`-only pin here.
 *
 *  Mechanism mirrors `browser-spine-import-graph.test.ts`: recursively read each
 *  ESM module's static `import`/`export … from` specifiers (emitted dist is plain
 *  ESM with explicit `./x.js` specifiers), follow every RELATIVE specifier, and
 *  flag any BARE specifier or any relative path resolving to a forbidden module.
 *  Dynamic `import()` is intentionally NOT followed — the runtime entry must be
 *  STATICALLY typescript-free.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '../dist');

/** Extract the module specifiers of every STATIC `import`/`export … from`
 *  statement. Deliberately ignores dynamic `import(…)` calls.
 *
 *  The middle is `[^;]*?` (NOT `[^;\n]*?`): it tolerates NEWLINES so a tsc-emitted
 *  MULTILINE re-export (`export {\n  a,\n  b,\n} from './x.js'`) and `export * from
 *  './x.js'` are both captured — the line-anchored `\n`-excluding variant under-
 *  approximated the graph (a real false-negative risk for an anti-rot gate). The
 *  `(?:^|\n)\s*(?:import|export)` STATEMENT anchor still rejects a `from '…'` that
 *  appears inside a comment or string literal (those lines start with `*`/`//`/code,
 *  not `import`/`export`), so the broadening adds no spurious specifiers. The `;`
 *  bound keeps a match from running across statements. */
function staticSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const keyword = importExportKeywordAt(source, index);
    if (!keyword) {
      index = skipNonCode(source, index);
      continue;
    }
    const statementEnd = findStatementEnd(source, index);
    const statement = source.slice(index, statementEnd + 1);
    const spec = specifierFromStaticImportExport(statement);
    if (spec) specs.push(spec);
    index = statementEnd;
  }
  return specs;
}

function importExportKeywordAt(source: string, index: number): 'import' | 'export' | undefined {
  const prev = index === 0 ? '' : source[index - 1];
  if ((prev && /[$\w]/.test(prev)) || !startsAtStatementBoundary(source, index)) return undefined;
  if (source.startsWith('import', index) && !/[$\w]/.test(source[index + 'import'.length] ?? '')) {
    const rest = source.slice(index + 'import'.length).trimStart();
    if (rest.startsWith('(') || rest.startsWith('.') || rest.startsWith(':')) return undefined;
    return 'import';
  }
  if (source.startsWith('export', index) && !/[$\w]/.test(source[index + 'export'.length] ?? '')) {
    const rest = source.slice(index + 'export'.length).trimStart();
    if (rest.startsWith('*') || rest.startsWith('{') || /^type\s+\{/.test(rest)) return 'export';
  }
  return undefined;
}

function startsAtStatementBoundary(source: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = source[i];
    if (ch === '\n' || ch === ';' || ch === '}') return true;
    if (ch === '/' && source[i - 1] === '*') return true;
    if (!/\s/.test(ch)) return false;
  }
  return true;
}

function skipNonCode(source: string, index: number): number {
  const ch = source[index];
  const next = source[index + 1];
  if (ch === '/' && next === '/') {
    const end = source.indexOf('\n', index + 2);
    return end === -1 ? source.length : Math.max(index, end - 1);
  }
  if (ch === '/' && next === '*') {
    const end = source.indexOf('*/', index + 2);
    return end === -1 ? source.length : end + 1;
  }
  if (ch === '`') return Math.min(skipTemplate(source, index), source.length - 1);
  if (ch === '"' || ch === "'") return Math.min(skipQuoted(source, index, ch), source.length - 1);
  return index;
}

function skipQuoted(source: string, index: number, quote: string): number {
  for (let i = index + 1; i < source.length; i += 1) {
    if (source[i] === '\\') {
      i += 1;
      continue;
    }
    if (source[i] === quote) return i;
  }
  return source.length;
}

function skipTemplate(source: string, index: number): number {
  for (let i = index + 1; i < source.length; i += 1) {
    if (source[i] === '\\') {
      i += 1;
      continue;
    }
    if (source[i] === '`') return i;
    if (source[i] === '$' && source[i + 1] === '{') {
      i = skipTemplateExpression(source, i + 1);
    }
  }
  return source.length;
}

function skipTemplateExpression(source: string, openBraceIndex: number): number {
  let depth = 1;
  for (let i = openBraceIndex + 1; i < source.length; i += 1) {
    const skipped = skipNonCode(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const ch = source[i];
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return source.length;
}

function findStatementEnd(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const skipped = skipNonCode(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const ch = source[i];
    if (ch === '{' || ch === '(' || ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (source[i] === ';') return i;
    if (ch === '\n' && depth === 0) {
      const statement = source.slice(start, i);
      if (specifierFromStaticImportExport(statement)) return i;
    }
  }
  return source.length;
}

function specifierFromStaticImportExport(statement: string): string | undefined {
  const sideEffect = /^\s*import\s*['"]([^'"]+)['"]/.exec(statement);
  if (sideEffect?.[1]) return sideEffect[1];
  const from = /\bfrom\s*['"]([^'"]+)['"]/.exec(statement);
  return from?.[1];
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
    if (!existsSync(file)) {
      throw new Error(`runner import graph references missing module: ${file}`);
    }
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
  'rag-retrieve-runner.js',
  'rag-index-runner.js',
  'rag-ingest.js',
  'rag-embedding-node.js',
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
      // basename equality, not `endsWith('/' + forbidden)`: `resolve()` yields
      // backslash separators on Windows, where a forward-slash suffix check would
      // silently never match (a false negative in the anti-rot gate).
      const reached = [...visited].some((p) => basename(p) === forbidden);
      expect({ forbidden, reached }).toEqual({ forbidden, reached: false });
    }
  });

  test('runner closure never reaches Node-only RAG capability implementations', () => {
    const { visited } = walkGraph(entry);
    const forbidden = ['rag-retrieve-runner.js', 'rag-index-runner.js', 'rag-ingest.js', 'rag-embedding-node.js'];
    for (const moduleName of forbidden) {
      const reached = [...visited].some((p) => basename(p) === moduleName);
      expect({ moduleName, reached }).toEqual({ moduleName, reached: false });
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

describe('@kernlang/core/runner/browser — browser runtime subpath import-graph proof', () => {
  const entry = resolve(DIST, 'runner-browser.js');

  test('dist/runner-browser.js exists (build ran)', () => {
    expect(existsSync(entry)).toBe(true);
  });

  test('browser runner static graph bare specifiers are EXACTLY ["decimal.js"] (HARD GATE)', () => {
    const { bare } = walkGraph(entry);
    expect([...bare].sort()).toEqual(['decimal.js']);
  });

  test('browser runner closure never reaches the harness chain or any compiler-puller module', () => {
    const { visited } = walkGraph(entry);
    for (const forbidden of FORBIDDEN_MODULES) {
      const reached = [...visited].some((p) => basename(p) === forbidden);
      expect({ forbidden, reached }).toEqual({ forbidden, reached: false });
    }
  });

  test('browser runner closure never reaches the public `.` barrel (dist/index.js)', () => {
    const { visited } = walkGraph(entry);
    expect([...visited]).not.toContain(resolve(DIST, 'index.js'));
  });

  test('browser runner runtime exports omit direct IR registry internals', async () => {
    const module = await import(pathToFileURL(entry).href);
    for (const exportName of [
      'analyzeKernSourceCapabilities',
      'createMemoryStorageCapability',
      'createWebCryptoCapability',
      'executeKernSource',
      'executeKernSourceAsync',
      'inferRagAnswerGroundingSpansFromInlineCitations',
      'invokeRunnerCapabilityAsync',
    ]) {
      expect(typeof module[exportName]).toBe('function');
    }
    for (const exportName of ['CONTRACT_REGISTRY', 'makeEnv']) {
      expect(Object.hasOwn(module, exportName)).toBe(false);
    }
  });
});
