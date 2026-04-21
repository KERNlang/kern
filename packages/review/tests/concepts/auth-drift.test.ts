import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { authDrift } from '../../src/concept-rules/auth-drift.js';
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

// The TS mapper extracts an auth guard from `if (!req.user) return …`. Using
// this pattern as the test fixture exercises the integration end-to-end
// rather than synthesizing ConceptNodes by hand.
const AUTH_PROTECTED_SERVER = `
  app.get('/api/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    res.json({ id: req.user.id });
  });
`;

const UNPROTECTED_SERVER = `app.get('/api/public', (req, res) => res.json({ ok: true }));`;

describe('auth-drift', () => {
  it('fires when fetch() hits an auth-protected route without an Authorization header', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/me');` },
        { path: 'src/server.ts', source: AUTH_PROTECTED_SERVER },
      ],
      'src/client.ts',
    );
    const findings = authDrift(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].ruleId).toBe('auth-drift');
    expect(findings[0].message).toContain('/api/me');
  });

  it('is silent when client sends an Authorization header', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } });`,
        },
        { path: 'src/server.ts', source: AUTH_PROTECTED_SERVER },
      ],
      'src/client.ts',
    );
    expect(authDrift(ctx)).toEqual([]);
  });

  it('is silent when the server route file has no auth guard', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/public');` },
        { path: 'src/server.ts', source: UNPROTECTED_SERVER },
      ],
      'src/client.ts',
    );
    expect(authDrift(ctx)).toEqual([]);
  });

  it('is silent for wrapped-client calls (hasAuthHeader undefined)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            import { apiClient } from '@/lib/api';
            await apiClient.get('/api/me');
          `,
        },
        { path: 'src/server.ts', source: AUTH_PROTECTED_SERVER },
      ],
      'src/client.ts',
    );
    expect(authDrift(ctx)).toEqual([]);
  });

  it('is silent when fetch options are a variable (hasAuthHeader undefined)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `async function run(opts: RequestInit) { await fetch('/api/me', opts); }`,
        },
        { path: 'src/server.ts', source: AUTH_PROTECTED_SERVER },
      ],
      'src/client.ts',
    );
    expect(authDrift(ctx)).toEqual([]);
  });

  it('treats case-insensitive Authorization header as present', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `await fetch('/api/me', { headers: { 'authorization': 'Bearer x' } });`,
        },
        { path: 'src/server.ts', source: AUTH_PROTECTED_SERVER },
      ],
      'src/client.ts',
    );
    expect(authDrift(ctx)).toEqual([]);
  });

  it('stays silent for cookie auth (credentials: "include")', () => {
    // Codex review: same-origin / session-cookie auth doesn't need an
    // Authorization header. `extractHasAuthHeader` returns undefined when
    // credentials flag is present, so auth-drift stays silent.
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `await fetch('/api/me', { credentials: 'include' });`,
        },
        { path: 'src/server.ts', source: AUTH_PROTECTED_SERVER },
      ],
      'src/client.ts',
    );
    expect(authDrift(ctx)).toEqual([]);
  });

  it('stays silent on mixed files (one guarded + one public route)', () => {
    // Codex review: file-level guard presence was too coarse. A file with
    // both `/api/me` (guarded) and `/api/public` (not) should not fire
    // auth-drift on the public endpoint's unauthenticated caller.
    const mixedServer = `
      app.get('/api/me', (req, res) => {
        if (!req.user) return res.status(401).json({});
        res.json({});
      });
      app.get('/api/public', (req, res) => res.json({ ok: true }));
    `;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/public');` },
        { path: 'src/server.ts', source: mixedServer },
      ],
      'src/client.ts',
    );
    expect(authDrift(ctx)).toEqual([]);
  });

  it('returns no findings in single-file (non-graph) mode', () => {
    const concepts = conceptsOf(`await fetch('/api/me');`, 'src/client.ts');
    expect(authDrift({ concepts, filePath: 'src/client.ts' })).toEqual([]);
  });
});
