import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectContextGraph } from '@kernlang/context';
import type { CallGraph, FunctionNode } from '../src/call-graph.js';
import { buildContextArtifact } from '../src/context-artifact.js';
import { reviewGraph } from '../src/index.js';
import { inferFromSource } from '../src/inferrer.js';
import { buildLLMPrompt } from '../src/llm-review.js';
import type { GraphFile, GraphResult, InferResult } from '../src/types.js';

function gf(path: string, canonicalPath: string, importEdges: GraphFile['importEdges'] = []): GraphFile {
  return { path, canonicalPath, distance: 0, imports: [], importedBy: [], importEdges, incomingEdges: [] };
}

function fn(partial: Partial<FunctionNode> & Pick<FunctionNode, 'name' | 'filePath'>): FunctionNode {
  return {
    line: 1,
    isExported: true,
    isAsync: false,
    paramCount: 0,
    calls: [],
    calledBy: [],
    ...partial,
  };
}

describe('buildContextArtifact', () => {
  // login.ts imports {query} from db.ts; login() is called once from api/routes.ts.
  const graph: GraphResult = {
    files: [
      gf('auth/login.ts', '/canon/auth/login.ts', [
        {
          from: '/canon/auth/login.ts',
          to: '/canon/db.ts',
          specifier: '../db',
          kind: 'named-import',
          importedName: 'query',
          via: 'ts-morph',
        },
      ]),
      gf('db.ts', '/canon/db.ts'),
      gf('api/routes.ts', '/canon/api/routes.ts'),
    ],
    entryFiles: ['auth/login.ts'],
    totalFiles: 3,
    skipped: 0,
  };

  const callGraph: CallGraph = {
    functions: new Map([
      [
        '/canon/auth/login.ts#login',
        fn({
          name: 'login',
          filePath: '/canon/auth/login.ts',
          line: 12,
          calledBy: [
            {
              callerName: 'handler',
              callerFile: '/canon/api/routes.ts',
              targetName: 'login',
              targetFile: '/canon/auth/login.ts',
              line: 42,
              argumentCount: 1,
              resolved: true,
              isHandled: true,
            },
          ],
        }),
      ],
    ]),
    deadExports: [],
    orphanFunctions: [],
    unresolvedCallCount: 0,
    defaultExportNames: new Map(),
  };

  it('maps canonical paths to display paths for files, symbols, and use-sites', () => {
    const artifact = buildContextArtifact(graph, callGraph);
    const loginFile = artifact.files.find((f) => f.path === 'auth/login.ts');
    expect(loginFile).toBeDefined();
    // import edge target mapped /canon/db.ts → db.ts, with bound name
    expect(loginFile?.imports).toEqual([{ path: 'db.ts', symbols: ['query'] }]);

    const login = artifact.symbols.find((s) => s.name === 'login');
    expect(login).toBeDefined();
    expect(login?.fileId).toBe(loginFile?.id);
    expect(login?.exported).toBe(true);

    // calledBy → usage, caller canonical path mapped to display, confidence resolved
    const usage = artifact.usage[login!.id];
    expect(usage.totalCount).toBe(1);
    expect(usage.callers[0]).toEqual({ path: 'api/routes.ts', line: 42, confidence: 'resolved' });
  });

  it('marks unresolved calls so the spine never asserts them as fact', () => {
    const cg: CallGraph = {
      ...callGraph,
      functions: new Map([
        [
          '/canon/auth/login.ts#login',
          fn({
            name: 'login',
            filePath: '/canon/auth/login.ts',
            calledBy: [
              {
                callerName: '?',
                callerFile: '/canon/jobs/cron.ts',
                targetName: 'login',
                targetFile: '/canon/auth/login.ts',
                line: 9,
                argumentCount: 0,
                resolved: false,
                isHandled: true,
              },
            ],
          }),
        ],
      ]),
    };
    const artifact = buildContextArtifact(graph, cg);
    expect(artifact.usage[artifact.symbols[0].id].callers[0].confidence).toBe('unresolved');
  });

  it('skips functions whose file is outside the graph file set', () => {
    const cg: CallGraph = {
      ...callGraph,
      functions: new Map([['/canon/orphan.ts#ghost', fn({ name: 'ghost', filePath: '/canon/orphan.ts' })]]),
    };
    expect(buildContextArtifact(graph, cg).symbols).toHaveLength(0);
  });
});

describe('reviewGraph context artifact (★1 auto-populate + #2 wider symbols)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-ctxg-'));
    writeFileSync(
      join(dir, 'models.ts'),
      'export const SECRET_KEY = "x";\nexport class Session { t = ""; }\nexport type Status = "on" | "off";\n',
    );
    writeFileSync(
      join(dir, 'app.ts'),
      'import { SECRET_KEY, Session } from "./models.js";\n' +
        'export function boot() { return new Session().t + SECRET_KEY; }\n' +
        'export function run() { return boot(); }\n',
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('★1: attaches the same artifact reference to every report', () => {
    const reports = reviewGraph([join(dir, 'app.ts'), join(dir, 'models.ts')]);
    const art = reports.find((r) => r.contextArtifact)?.contextArtifact;
    expect(art).toBeDefined();
    expect(reports.every((r) => r.contextArtifact === art)).toBe(true);
  });

  test('#2: includes class/const/type symbols with import-derived usage', () => {
    const reports = reviewGraph([join(dir, 'app.ts'), join(dir, 'models.ts')]);
    const art = reports.find((r) => r.contextArtifact)?.contextArtifact;
    const byName = (n: string) => art?.symbols.find((s) => s.name === n);
    expect(byName('Session')?.kind).toBe('class');
    expect(byName('SECRET_KEY')?.kind).toBe('const');
    expect(byName('Status')?.kind).toBe('type');
    // Session + SECRET_KEY are value-imported by app.ts → used in ≥1 file.
    expect(art?.usage[byName('Session')!.id].totalCount).toBeGreaterThanOrEqual(1);
    expect(art?.usage[byName('SECRET_KEY')!.id].totalCount).toBeGreaterThanOrEqual(1);
    // boot() is called by run() → function usage still comes from the call graph.
    expect(art?.usage[byName('boot')!.id].totalCount).toBeGreaterThanOrEqual(1);
  });

  test('value+type same name coexist; arrow-fn const dedups against the call graph', () => {
    const d = mkdtempSync(join(tmpdir(), 'kern-ns-'));
    writeFileSync(
      join(d, 'm.ts'),
      'export function Foo() { return 1; }\nexport type Foo = string;\nexport const bar = () => 2;\n',
    );
    try {
      const art = reviewGraph([join(d, 'm.ts')]).find((r) => r.contextArtifact)?.contextArtifact;
      const foos = art?.symbols.filter((s) => s.name === 'Foo').map((s) => s.kind);
      expect(foos?.sort()).toEqual(['function', 'type']); // both namespaces kept
      const bars = art?.symbols.filter((s) => s.name === 'bar') ?? [];
      expect(bars).toHaveLength(1); // not double-counted as function + const
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('the shared artifact is frozen (read-only across reports)', () => {
    const art = reviewGraph([join(dir, 'models.ts')]).find((r) => r.contextArtifact)?.contextArtifact;
    expect(Object.isFrozen(art)).toBe(true);
  });
});

describe('buildLLMPrompt spine injection', () => {
  const source = 'export function getUser(id) { return id; }';
  let inferred: InferResult[];
  beforeAll(() => {
    inferred = inferFromSource(source, 'user.ts');
  });

  const artifact: ProjectContextGraph = {
    schemaVersion: 1,
    files: [{ id: 'f1', path: '/user.ts' }],
    symbols: [{ id: 's1', fileId: 'f1', name: 'getUser', kind: 'function', exported: true, line: 1 }],
    usage: { s1: { callers: [{ path: 'api.ts', line: 9, confidence: 'resolved' }], totalCount: 1 } },
  };

  it('injects a <kern-map> spine with usage when an artifact is present', () => {
    const prompt = buildLLMPrompt(inferred, [], {
      fileDistances: new Map([['/user.ts', 0]]),
      artifact,
    });
    expect(prompt).toContain('<kern-map');
    expect(prompt).toContain('sym getUser fn exp');
    expect(prompt).toContain('callby api.ts:9');
  });

  it('omits the spine entirely when no artifact is supplied (backward compatible)', () => {
    const prompt = buildLLMPrompt(inferred, [], { fileDistances: new Map([['/user.ts', 0]]) });
    expect(prompt).not.toContain('<kern-map');
    // existing distance markers still present
    expect(prompt).toContain('[CHANGED]');
  });
});
