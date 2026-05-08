import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { paginationKeyDrift } from '../../src/concept-rules/pagination-key-drift.js';
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

describe('pagination-key-drift', () => {
  it('fires when client uses ?page= but server reads only req.query.offset', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              await fetch('/api/users?page=2', { method: 'GET' });
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.get('/api/users', (req: any, res: any) => {
              const offset = Number(req.query.offset ?? 0);
              res.json({ offset });
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = paginationKeyDrift(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].ruleId).toBe('pagination-key-drift');
    expect(findings[0].message).toContain('page');
    expect(findings[0].message).toContain('offset');
  });

  it('does NOT fire when both ends use the same anchor family', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              await fetch('/api/users?page=2', { method: 'GET' });
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.get('/api/users', (req: any, res: any) => {
              const page = Number(req.query.page ?? 1);
              res.json({ page });
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = paginationKeyDrift(ctx);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when server reads multiple anchor families (mixed strategy tolerates either)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              await fetch('/api/users?page=2', { method: 'GET' });
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.get('/api/users', (req: any, res: any) => {
              const page = Number(req.query.page);
              const offset = Number(req.query.offset);
              res.json({ page, offset });
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = paginationKeyDrift(ctx);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when server reads only size keys (no anchor — strategy is none)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              await fetch('/api/users?page=2', { method: 'GET' });
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.get('/api/users', (req: any, res: any) => {
              const limit = Number(req.query.limit ?? 50);
              res.json({ limit });
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = paginationKeyDrift(ctx);
    expect(findings).toHaveLength(0);
  });

  it('fires when client uses ?cursor= but server reads only req.query.page', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              await fetch('/api/items?cursor=abc', { method: 'GET' });
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.get('/api/items', (req: any, res: any) => {
              const page = Number(req.query.page ?? 1);
              res.json({ page });
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = paginationKeyDrift(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].message).toContain('cursor');
    expect(findings[0].message).toContain('page');
  });

  it('does NOT fire when server uses destructuring with rest (mapper unresolved)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              await fetch('/api/users?page=2', { method: 'GET' });
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.get('/api/users', (req: any, res: any) => {
              const { ...rest } = req.query;
              res.json(rest);
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = paginationKeyDrift(ctx);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when client URL has no pagination anchors', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              await fetch('/api/users?filter=active', { method: 'GET' });
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.get('/api/users', (req: any, res: any) => {
              const offset = Number(req.query.offset ?? 0);
              res.json({ offset });
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = paginationKeyDrift(ctx);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire in single-file mode (silent without allConcepts)', () => {
    const findings = paginationKeyDrift({
      concepts: { language: 'ts', filePath: 'x.ts', nodes: [], edges: [], extractorVersion: '1.0.0' },
      filePath: 'x.ts',
    });
    expect(findings).toHaveLength(0);
  });

  // ── Regression tests for buddy-flagged FP bugs (Gemini final review) ────

  it('does NOT FP when server aliases `req.query` to a single identifier (Gemini #2)', () => {
    // `const q = req.query` previously returned strategy='none', resolved=true
    // (false confidence). With the fix, aliasing marks unresolved → rule
    // silently skips the route rather than firing.
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              await fetch('/api/users?page=2', { method: 'GET' });
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.get('/api/users', (req: any, res: any) => {
              const q = req.query;
              const offset = Number(q.offset ?? 0);
              res.json({ offset });
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = paginationKeyDrift(ctx);
    expect(findings).toHaveLength(0);
  });

  it('does NOT FP when server passes `req.query` as an argument (Gemini #2 generalisation)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              await fetch('/api/users?page=2', { method: 'GET' });
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            function paginate(q: any) { return q; }
            const router: any = {};
            router.get('/api/users', (req: any, res: any) => {
              const result = paginate(req.query);
              res.json(result);
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = paginationKeyDrift(ctx);
    expect(findings).toHaveLength(0);
  });
});
