import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { unhandledApiErrorShape } from '../../src/concept-rules/unhandled-api-error-shape.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

function conceptsOf(source: string, filePath: string): ConceptMap {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  return extractTsConcepts(project.createSourceFile(filePath, source), filePath);
}

function ctxFrom(files: Array<{ path: string; source: string }>, primary: string) {
  const allConcepts = new Map<string, ConceptMap>();
  for (const file of files) allConcepts.set(file.path, conceptsOf(file.source, file.path));
  const concepts = allConcepts.get(primary);
  if (!concepts) throw new Error(`missing ${primary}`);
  return { concepts, filePath: primary, allConcepts };
}

function ctxFromMaps(files: ConceptMap[], primary: string) {
  const allConcepts = new Map<string, ConceptMap>();
  for (const map of files) allConcepts.set(map.filePath, map);
  const concepts = allConcepts.get(primary);
  if (!concepts) throw new Error(`missing ${primary}`);
  return { concepts, filePath: primary, allConcepts };
}

function fastApiRouteWithErrors(): ConceptMap {
  return {
    filePath: 'app/routes/users.py',
    language: 'py',
    extractorVersion: 'test',
    nodes: [
      {
        id: 'app/routes/users.py#entrypoint@1',
        kind: 'entrypoint',
        primarySpan: { file: 'app/routes/users.py', startLine: 4, startCol: 1, endLine: 4, endCol: 40 },
        evidence: '@router.get("/api/users/{id}")',
        confidence: 1,
        language: 'py',
        payload: {
          kind: 'entrypoint',
          subtype: 'route',
          name: '/api/users/{id}',
          httpMethod: 'GET',
          errorStatusCodes: [404],
        },
      },
    ],
    edges: [],
  };
}

describe('unhandled-api-error-shape', () => {
  it('fires when an Express route can return 401 and the client only parses success JSON', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function loadMe() {
              const data = await fetch('/api/me').then((r) => r.json());
              return data;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/me', (req, res) => {
              if (!req.user) return res.status(401).json({ error: 'unauthorized' });
              res.json({ id: req.user.id });
            });
          `,
        },
      ],
      'src/client.ts',
    );

    const findings = unhandledApiErrorShape(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('401');
  });

  it('is silent when the client checks response.ok before parsing JSON', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function loadMe() {
              const data = await fetch('/api/me').then((r) => {
                if (!r.ok) throw new Error('failed');
                return r.json();
              });
              return data;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/me', (req, res) => {
              if (!req.user) return res.status(401).json({ error: 'unauthorized' });
              res.json({ id: req.user.id });
            });
          `,
        },
      ],
      'src/client.ts',
    );

    expect(unhandledApiErrorShape(ctx)).toEqual([]);
  });

  it('fires for FastAPI HTTPException status evidence in the graph', () => {
    const client = conceptsOf(
      `
        async function loadUser(id: string) {
          const user = await fetch(\`/api/users/\${id}\`).then((r) => r.json());
          return user;
        }
      `,
      'src/client.ts',
    );

    const findings = unhandledApiErrorShape(ctxFromMaps([client, fastApiRouteWithErrors()], 'src/client.ts'));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('404');
  });

  it('is silent for axios calls because axios rejects non-2xx responses upstream', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            import axios from 'axios';
            export async function loadMe() {
              return axios.get('/api/me');
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/me', (req, res) => {
              if (!req.user) return res.status(401).json({ error: 'unauthorized' });
              res.json({ id: req.user.id });
            });
          `,
        },
      ],
      'src/client.ts',
    );

    expect(unhandledApiErrorShape(ctx)).toEqual([]);
  });

  it('is silent when the graph has duplicate matching backend routes', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function loadMe() {
              return fetch('/api/me').then((r) => r.json());
            }
          `,
        },
        {
          path: 'src/server-a.ts',
          source: `
            app.get('/api/me', (req, res) => {
              if (!req.user) return res.status(401).json({ error: 'unauthorized' });
              res.json({ id: req.user.id });
            });
          `,
        },
        {
          path: 'src/server-b.ts',
          source: `
            app.get('/api/me', (req, res) => {
              if (!req.user) return res.status(403).json({ error: 'forbidden' });
              res.json({ id: req.user.id });
            });
          `,
        },
      ],
      'src/client.ts',
    );

    expect(unhandledApiErrorShape(ctx)).toEqual([]);
  });
});
