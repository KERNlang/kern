import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { unboundedCollectionQuery } from '../../src/concept-rules/unbounded-collection-query.js';
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

const UNBOUNDED_SERVER = `
  app.get('/api/users', async (req, res) => {
    const users = await prisma.user.findMany();
    res.json(users);
  });
`;

describe('unbounded-collection-query', () => {
  it('fires when client and server both omit pagination bounds on a list endpoint', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function loadUsers() {
              const users = await fetch('/api/users').then((r) => r.json());
              return users;
            }
          `,
        },
        { path: 'src/server.ts', source: UNBOUNDED_SERVER },
      ],
      'src/client.ts',
    );

    const findings = unboundedCollectionQuery(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('/api/users');
  });

  it('is silent when the client sends a limit query parameter', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users?limit=25').then((r) => r.json());` },
        { path: 'src/server.ts', source: UNBOUNDED_SERVER },
      ],
      'src/client.ts',
    );

    expect(unboundedCollectionQuery(ctx)).toEqual([]);
  });

  it('is silent when the server query is bounded', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users').then((r) => r.json());` },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users', async (req, res) => {
              const users = await prisma.user.findMany({ take: 25 });
              res.json(users);
            });
          `,
        },
      ],
      'src/client.ts',
    );

    expect(unboundedCollectionQuery(ctx)).toEqual([]);
  });

  it('is silent when duplicate graph routes make the backend partner ambiguous', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users').then((r) => r.json());` },
        { path: 'src/server-a.ts', source: UNBOUNDED_SERVER },
        { path: 'src/server-b.ts', source: UNBOUNDED_SERVER },
      ],
      'src/client.ts',
    );

    expect(unboundedCollectionQuery(ctx)).toEqual([]);
  });
});
