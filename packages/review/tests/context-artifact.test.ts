import type { ProjectContextGraph } from '@kernlang/context';
import type { CallGraph, FunctionNode } from '../src/call-graph.js';
import { buildContextArtifact } from '../src/context-artifact.js';
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
