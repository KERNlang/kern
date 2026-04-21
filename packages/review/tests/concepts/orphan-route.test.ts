import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { orphanRoute } from '../../src/concept-rules/orphan-route.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

function conceptsOf(source: string, filePath: string): ConceptMap {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const sf = project.createSourceFile(filePath, source);
  return extractTsConcepts(sf, filePath);
}

function ctxFrom(files: Array<{ path: string; source: string }>, primary: string) {
  const allConcepts = new Map<string, ConceptMap>();
  for (const f of files) allConcepts.set(f.path, conceptsOf(f.source, f.path));
  const concepts = allConcepts.get(primary);
  if (!concepts) throw new Error(`primary file ${primary} not in allConcepts`);
  return { concepts, filePath: primary, allConcepts };
}

describe('orphan-route', () => {
  it('fires on a server route with no matching client caller', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users/1');` },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users/:id', (req, res) => res.json({}));
            app.get('/api/dead-endpoint', (req, res) => res.json({}));
          `,
        },
      ],
      'src/server.ts',
    );
    const findings = orphanRoute(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('/api/dead-endpoint');
    expect(findings[0].ruleId).toBe('orphan-route');
  });

  it('is silent when every route has a matching client call', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            await fetch('/api/users/42');
            await fetch('/api/posts');
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users/:id', (req, res) => res.json({}));
            app.get('/api/posts', (req, res) => res.json({}));
          `,
        },
      ],
      'src/server.ts',
    );
    expect(orphanRoute(ctx)).toEqual([]);
  });

  it('stays silent when no client calls exist at all (backend-only project)', () => {
    const ctx = ctxFrom(
      [{ path: 'src/server.ts', source: `app.get('/api/users/:id', (req, res) => res.json({}));` }],
      'src/server.ts',
    );
    expect(orphanRoute(ctx)).toEqual([]);
  });

  it('matches client concrete paths against server template params', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users/42');` },
        { path: 'src/server.ts', source: `app.get('/api/users/:id', (req, res) => res.json({}));` },
      ],
      'src/server.ts',
    );
    expect(orphanRoute(ctx)).toEqual([]);
  });

  it('only emits findings on the file being reviewed', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/active');` },
        { path: 'src/server-a.ts', source: `app.get('/api/orphan-a', (req, res) => res.json({}));` },
        { path: 'src/server-b.ts', source: `app.get('/api/orphan-b', (req, res) => res.json({}));` },
      ],
      'src/server-a.ts',
    );
    const findings = orphanRoute(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].primarySpan.file).toBe('src/server-a.ts');
  });

  it('stays silent when any client call has an unresolved target (imported URL, variable)', () => {
    // Codex review: a `fetch(USERS_URL)` could hit any server route, so the
    // rule must abstain rather than flag routes as orphaned based only on
    // the literal-URL subset.
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            import { USERS_URL } from './constants';
            await fetch(USERS_URL);
            await fetch('/api/users/42');
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users/:id', (req, res) => res.json({}));
            app.get('/api/lookslike-orphan', (req, res) => res.json({}));
          `,
        },
      ],
      'src/server.ts',
    );
    expect(orphanRoute(ctx)).toEqual([]);
  });

  it('returns no findings in single-file (non-graph) mode', () => {
    const concepts = conceptsOf(`app.get('/api/users/:id', (req, res) => res.json({}));`, 'src/server.ts');
    expect(orphanRoute({ concepts, filePath: 'src/server.ts' })).toEqual([]);
  });
});
