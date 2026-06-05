import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContextJson, buildContextSpine, collectSourceFiles } from '../src/commands/context.js';

describe('kern context — collectSourceFiles', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-ctx-'));
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;');
    writeFileSync(join(dir, 'b.tsx'), 'export const b = 2;');
    writeFileSync(join(dir, 'types.d.ts'), 'export declare const c: number;');
    writeFileSync(join(dir, 'readme.md'), '# nope');
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'pkg', 'index.ts'), 'export const x = 1;');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('collects .ts/.tsx, skips .d.ts, non-source, and node_modules', () => {
    const files = collectSourceFiles([dir]).map((f) => f.split('/').pop());
    expect(files.sort()).toEqual(['a.ts', 'b.tsx']);
  });
});

describe('kern context — buildContextJson (end-to-end)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-ctx-e2e-'));
    writeFileSync(join(dir, 'db.ts'), 'export function query(s) { return s; }');
    writeFileSync(
      join(dir, 'auth.ts'),
      "import { query } from './db.js';\n" +
        'export function login(id) { return query(id); }\n' +
        'export function logout() { return login(0); }\n',
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('produces a versioned artifact with files, symbols, and usage edges', () => {
    const artifact = buildContextJson([dir]);
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.files.length).toBe(2);

    const names = artifact.symbols.map((s) => s.name).sort();
    expect(names).toContain('login');
    expect(names).toContain('query');

    // login is called once (from logout); the call-graph usage made it into the artifact.
    const login = artifact.symbols.find((s) => s.name === 'login');
    expect(artifact.usage[login!.id].totalCount).toBeGreaterThanOrEqual(1);

    // the import edge db.ts{query} was captured on auth.ts
    const auth = artifact.files.find((f) => f.path.endsWith('auth.ts'));
    expect(auth?.imports?.some((i) => i.symbols?.includes('query'))).toBe(true);
  });

  test('base option relativizes all paths for a portable artifact', () => {
    const artifact = buildContextJson([dir], { base: dir });
    // file + import + use-site paths are now relative to the base (no leading /).
    expect(artifact.files.map((f) => f.path).sort()).toEqual(['auth.ts', 'db.ts']);
    for (const f of artifact.files) {
      for (const imp of f.imports ?? []) expect(imp.path.startsWith('/')).toBe(false);
    }
    for (const u of Object.values(artifact.usage)) {
      for (const c of u.callers) expect(c.path.startsWith('/')).toBe(false);
    }
  });
});

describe('kern context — buildContextSpine (--spine)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-ctx-spine-'));
    writeFileSync(join(dir, 'db.ts'), 'export function query(s) { return s; }');
    writeFileSync(
      join(dir, 'auth.ts'),
      "import { query } from './db.js';\n" +
        'export function login(id) { return query(id); }\n' +
        'export function logout() { return login(0); }\n',
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('renders a compact <kern-map> spine scoped to the whole project', () => {
    const spine = buildContextSpine([dir], { base: dir });
    expect(spine).toContain('<kern-map');
    expect(spine).toContain('</kern-map>');
    // whole-project: symbols from across files surface in the spine
    expect(spine).toContain('login');
    expect(spine).toContain('query');
    // it is compact — the spine is far smaller than the full JSON artifact
    const json = JSON.stringify(buildContextJson([dir], { base: dir }));
    expect(spine.length).toBeLessThan(json.length);
  });

  test('respects a tiny spine budget without exceeding it (degrades/clips)', () => {
    const tiny = buildContextSpine([dir], { base: dir, spineBudget: 30 });
    // ~4 chars/token estimate → stay within a small multiple of the budget, never the full map
    const full = buildContextSpine([dir], { base: dir });
    expect(tiny.length).toBeLessThanOrEqual(full.length);
  });
});
