import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { trailingSlashDrift } from '../../src/concept-rules/trailing-slash-drift.js';
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

describe('trailing-slash-drift', () => {
  it('fires when client adds a trailing slash that server route omits', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users/', { method: 'GET' });` },
        { path: 'src/server.ts', source: `app.get('/api/users', (req, res) => res.json([]));` },
      ],
      'src/client.ts',
    );
    const findings = trailingSlashDrift(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toMatch(/trailing slash/);
    expect(findings[0].message).toMatch(/Drop the trailing slash/);
  });

  it('fires when client omits a trailing slash that server route requires', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users', { method: 'POST' });` },
        { path: 'src/server.ts', source: `app.post('/api/users/', (req, res) => res.json({}));` },
      ],
      'src/client.ts',
    );
    const findings = trailingSlashDrift(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toMatch(/trailing slash/);
  });

  it('is silent when path matches a route exactly (no slash drift)', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users', { method: 'GET' });` },
        { path: 'src/server.ts', source: `app.get('/api/users', (req, res) => res.json([]));` },
      ],
      'src/client.ts',
    );
    expect(trailingSlashDrift(ctx)).toEqual([]);
  });

  it('is silent when no server route matches even with the slash flipped', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/orphans/', { method: 'GET' });` },
        { path: 'src/server.ts', source: `app.get('/api/users', (req, res) => res.json([]));` },
      ],
      'src/client.ts',
    );
    expect(trailingSlashDrift(ctx)).toEqual([]);
  });

  it('is silent when only the client file is in scope (no server context)', () => {
    const ctx = ctxFrom([{ path: 'src/client.ts', source: `await fetch('/api/users/');` }], 'src/client.ts');
    expect(trailingSlashDrift(ctx)).toEqual([]);
  });
});
