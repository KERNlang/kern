import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { duplicateRoute } from '../../src/concept-rules/duplicate-route.js';
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

describe('duplicate-route', () => {
  it('fires when the same path+method is declared twice in one file', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users', (req, res) => res.json({}));
            app.get('/api/users', (req, res) => res.json({}));
          `,
        },
      ],
      'src/server.ts',
    );
    const findings = duplicateRoute(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('GET /api/users');
    expect(findings[0].ruleId).toBe('duplicate-route');
  });

  it('is silent when paths or methods differ', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users', (req, res) => res.json({}));
            app.post('/api/users', (req, res) => res.json({}));
            app.get('/api/posts', (req, res) => res.json({}));
          `,
        },
      ],
      'src/server.ts',
    );
    expect(duplicateRoute(ctx)).toEqual([]);
  });

  it('fires when same path+method appears across two files', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/server-a.ts', source: `app.get('/api/users', (req, res) => res.json({}));` },
        { path: 'src/server-b.ts', source: `app.get('/api/users', (req, res) => res.json({}));` },
      ],
      'src/server-b.ts',
    );
    const findings = duplicateRoute(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('server-a.ts');
    expect(findings[0].primarySpan.file).toBe('src/server-b.ts');
  });

  it('only flags the second declaration (first is canonical)', () => {
    const ctxA = ctxFrom(
      [
        { path: 'src/server-a.ts', source: `app.get('/api/users', (req, res) => res.json({}));` },
        { path: 'src/server-b.ts', source: `app.get('/api/users', (req, res) => res.json({}));` },
      ],
      'src/server-a.ts',
    );
    expect(duplicateRoute(ctxA)).toEqual([]);
  });

  it('fires on wildcard vs specific-verb shadowing (app.all + app.get on same path)', () => {
    // Codex review: `app.all('/x')` + `app.get('/x')` shadow each other
    // depending on registration order. Keying only on exact method missed
    // this collision class.
    const ctx = ctxFrom(
      [
        {
          path: 'src/server.ts',
          source: `
            app.all('/api/users', (req, res, next) => next());
            app.get('/api/users', (req, res) => res.json({}));
          `,
        },
      ],
      'src/server.ts',
    );
    const findings = duplicateRoute(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('shadowed by wildcard');
    expect(findings[0].message).toContain('GET /api/users');
  });

  it('returns no findings in single-file (non-graph) mode', () => {
    const concepts = conceptsOf(
      `app.get('/api/users', (req, res) => res.json({})); app.get('/api/users', (req, res) => res.json({}));`,
      'src/server.ts',
    );
    expect(duplicateRoute({ concepts, filePath: 'src/server.ts' })).toEqual([]);
  });
});
