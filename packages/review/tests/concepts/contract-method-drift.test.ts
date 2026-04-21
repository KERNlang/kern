import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { contractMethodDrift } from '../../src/concept-rules/contract-method-drift.js';
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

describe('contract-method-drift', () => {
  it('fires when client POSTs to a path the server only exposes as GET', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `await fetch('/api/users/42', { method: 'POST', body: JSON.stringify({}) });`,
        },
        { path: 'src/server.ts', source: `app.get('/api/users/:id', (req, res) => res.json({}));` },
      ],
      'src/client.ts',
    );
    const findings = contractMethodDrift(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('POST');
    expect(findings[0].message).toContain('Did you mean');
  });

  it('is silent when the methods match', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users/42', { method: 'GET' });` },
        { path: 'src/server.ts', source: `app.get('/api/users/:id', (req, res) => res.json({}));` },
      ],
      'src/client.ts',
    );
    expect(contractMethodDrift(ctx)).toEqual([]);
  });

  it('treats raw fetch(url) with no options as GET', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users/42');` },
        { path: 'src/server.ts', source: `app.get('/api/users/:id', (req, res) => res.json({}));` },
      ],
      'src/client.ts',
    );
    expect(contractMethodDrift(ctx)).toEqual([]);
  });

  it('is silent when the path does not match any route (contract-drift territory)', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users/42', { method: 'POST' });` },
        { path: 'src/server.ts', source: `app.get('/api/posts/:id', (req, res) => res.json({}));` },
      ],
      'src/client.ts',
    );
    expect(contractMethodDrift(ctx)).toEqual([]);
  });

  it('stays silent when the server uses app.use wildcard (httpMethod undefined)', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users/42', { method: 'POST' });` },
        { path: 'src/server.ts', source: `app.use('/api/users/:id', (req, res, next) => next());` },
      ],
      'src/client.ts',
    );
    expect(contractMethodDrift(ctx)).toEqual([]);
  });

  it('stays silent when the server uses app.all (httpMethod "ALL" is a wildcard)', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users/42', { method: 'POST' });` },
        { path: 'src/server.ts', source: `app.all('/api/users/:id', (req, res) => res.json({}));` },
      ],
      'src/client.ts',
    );
    expect(contractMethodDrift(ctx)).toEqual([]);
  });

  it('fires when one of several verbs is missing (GET+PUT, client POSTs)', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users/42', { method: 'POST' });` },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users/:id', (req, res) => res.json({}));
            app.put('/api/users/:id', (req, res) => res.json({}));
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = contractMethodDrift(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('GET, PUT');
    expect(findings[0].message).not.toContain('Did you mean');
  });

  it('recognises axios-style method calls as their own verb', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            import axios from 'axios';
            await axios.put('/api/users/42', { name: 'bob' });
          `,
        },
        { path: 'src/server.ts', source: `app.get('/api/users/:id', (req, res) => res.json({}));` },
      ],
      'src/client.ts',
    );
    const findings = contractMethodDrift(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('PUT');
  });

  it('recognises wrapped-client calls (apiClient.post) when imported from a local path', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            import { apiClient } from '@/lib/api';
            await apiClient.post<{ ok: true }>('/api/users/42', { a: 1 });
          `,
        },
        { path: 'src/server.ts', source: `app.get('/api/users/:id', (req, res) => res.json({}));` },
      ],
      'src/client.ts',
    );
    const findings = contractMethodDrift(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('POST');
  });

  it('returns no findings in single-file (non-graph) mode', () => {
    const concepts = conceptsOf(`await fetch('/api/users/42', { method: 'POST' });`, 'src/client.ts');
    expect(contractMethodDrift({ concepts, filePath: 'src/client.ts' })).toEqual([]);
  });

  it('stays silent when the client method is a runtime variable', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `async function run(verb: string) { await fetch('/api/users/42', { method: verb }); }`,
        },
        { path: 'src/server.ts', source: `app.get('/api/users/:id', (req, res) => res.json({}));` },
      ],
      'src/client.ts',
    );
    expect(contractMethodDrift(ctx)).toEqual([]);
  });

  it('stays silent when fetch options contain a spread (could override method)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function run(opts: RequestInit) {
              await fetch('/api/users/42', { method: 'GET', ...opts });
            }
          `,
        },
        { path: 'src/server.ts', source: `app.post('/api/users/:id', (req, res) => res.json({}));` },
      ],
      'src/client.ts',
    );
    expect(contractMethodDrift(ctx)).toEqual([]);
  });

  it('treats HEAD as matching a GET route (framework auto-response semantics)', () => {
    // Codex review: Express and Starlette/FastAPI respond to HEAD requests
    // on GET-registered routes. Firing method-drift here would be a false
    // positive.
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users/42', { method: 'HEAD' });` },
        { path: 'src/server.ts', source: `app.get('/api/users/:id', (req, res) => res.json({}));` },
      ],
      'src/client.ts',
    );
    expect(contractMethodDrift(ctx)).toEqual([]);
  });

  it('fingerprint encodes rule id so it cannot collide with contract-drift', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/users/42', { method: 'POST' });` },
        { path: 'src/server.ts', source: `app.get('/api/users/:id', (req, res) => res.json({}));` },
      ],
      'src/client.ts',
    );
    const findings = contractMethodDrift(ctx);
    expect(findings[0].fingerprint).toContain('contract-method-drift');
  });
});
