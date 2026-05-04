import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { mixedHostSameEndpoint } from '../../src/concept-rules/mixed-host-same-endpoint.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

function conceptsOf(source: string, filePath: string): ConceptMap {
  // Module-mode forced via `export {}` so `useInMemoryFileSystem` doesn't
  // treat the source as a script (would shadow lib.dom and break symbol res
  // for const-resolution downstream).
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const sf = project.createSourceFile(filePath, `export {};\n${source}`);
  return extractTsConcepts(sf, filePath);
}

function ctxFrom(files: Array<{ path: string; source: string }>, primary: string) {
  const allConcepts = new Map<string, ConceptMap>();
  for (const f of files) allConcepts.set(f.path, conceptsOf(f.source, f.path));
  const concepts = allConcepts.get(primary);
  if (!concepts) throw new Error(`primary file ${primary} not in allConcepts`);
  return { concepts, filePath: primary, allConcepts };
}

describe('mixed-host-same-endpoint', () => {
  it('fires when the same `(GET, /api/users)` is fetched against two different non-dev hosts', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/lib/users.ts',
          source: `
            async function load(id: string) {
              return fetch(\`https://api.example.com/api/users/\${id}\`);
            }
          `,
        },
        {
          path: 'src/admin/legacy.ts',
          source: `
            async function load(id: string) {
              return fetch(\`https://beta-api.example.com/api/users/\${id}\`);
            }
          `,
        },
      ],
      'src/lib/users.ts',
    );
    const findings = mixedHostSameEndpoint(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].ruleId).toBe('mixed-host-same-endpoint');
    expect(findings[0].message).toContain('api.example.com');
    expect(findings[0].message).toContain('beta-api.example.com');
    expect(findings[0].message).toContain('GET /api/users/:id');
  });

  it('fires on every call-site that participates — but only emits findings for calls in the reviewed file', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/a.ts',
          source: `
            async function f(id: string) {
              return fetch(\`https://api.example.com/api/items/\${id}\`);
            }
          `,
        },
        {
          path: 'src/b.ts',
          source: `
            async function f(id: string) {
              return fetch(\`https://stale.example.com/api/items/\${id}\`);
            }
          `,
        },
      ],
      'src/a.ts',
    );
    const findings = mixedHostSameEndpoint(ctx);
    // Both files participate in the divergence, but the per-file context
    // for src/a.ts emits findings only for calls inside src/a.ts.
    expect(findings.length).toBe(1);
    expect(findings[0].primarySpan.file).toBe('src/a.ts');
  });

  it('is silent when both fetches use the SAME host', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/a.ts',
          source: `
            async function f() { return fetch('https://api.example.com/api/users'); }
          `,
        },
        {
          path: 'src/b.ts',
          source: `
            async function g() { return fetch('https://api.example.com/api/users'); }
          `,
        },
      ],
      'src/a.ts',
    );
    expect(mixedHostSameEndpoint(ctx)).toEqual([]);
  });

  it('is silent when paths differ (only same path+method counts)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/a.ts',
          source: `
            async function f() { return fetch('https://api.example.com/api/users'); }
          `,
        },
        {
          path: 'src/b.ts',
          source: `
            async function g() { return fetch('https://beta-api.example.com/api/profiles'); }
          `,
        },
      ],
      'src/a.ts',
    );
    expect(mixedHostSameEndpoint(ctx)).toEqual([]);
  });

  it('is silent when methods differ for the same path', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/a.ts',
          source: `
            async function f() { return fetch('https://api.example.com/api/users', { method: 'GET' }); }
          `,
        },
        {
          path: 'src/b.ts',
          source: `
            async function g() { return fetch('https://beta-api.example.com/api/users', { method: 'POST' }); }
          `,
        },
      ],
      'src/a.ts',
    );
    expect(mixedHostSameEndpoint(ctx)).toEqual([]);
  });

  it('is silent when one of the two hosts is `localhost` (dev/prod is normal)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/a.ts',
          source: `
            async function f() { return fetch('http://localhost:3000/api/users'); }
          `,
        },
        {
          path: 'src/b.ts',
          source: `
            async function g() { return fetch('https://api.example.com/api/users'); }
          `,
        },
      ],
      'src/a.ts',
    );
    expect(mixedHostSameEndpoint(ctx)).toEqual([]);
  });

  it('is silent when one of the hosts is `127.0.0.1`', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/a.ts',
          source: `
            async function f() { return fetch('http://127.0.0.1:9877/api/health'); }
          `,
        },
        {
          path: 'src/b.ts',
          source: `
            async function g() { return fetch('https://api.example.com/api/health'); }
          `,
        },
      ],
      'src/a.ts',
    );
    expect(mixedHostSameEndpoint(ctx)).toEqual([]);
  });

  it('is silent when one of the hosts is a `.local` TLD', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/a.ts',
          source: `
            async function f() { return fetch('https://my-machine.local/api/items'); }
          `,
        },
        {
          path: 'src/b.ts',
          source: `
            async function g() { return fetch('https://api.example.com/api/items'); }
          `,
        },
      ],
      'src/a.ts',
    );
    expect(mixedHostSameEndpoint(ctx)).toEqual([]);
  });

  it('is silent on non-internal paths (path must look like /api/…)', () => {
    // The /api/ gate prevents random third-party SDK calls (e.g. analytics
    // beacon vs CDN) from looking like a stale base URL bug.
    const ctx = ctxFrom(
      [
        {
          path: 'src/a.ts',
          source: `
            async function f() { return fetch('https://cdn.example.com/static/v1'); }
          `,
        },
        {
          path: 'src/b.ts',
          source: `
            async function g() { return fetch('https://other-cdn.example.com/static/v1'); }
          `,
        },
      ],
      'src/a.ts',
    );
    expect(mixedHostSameEndpoint(ctx)).toEqual([]);
  });

  it('is silent when there is only one call-site for the endpoint (no comparison possible)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/a.ts',
          source: `
            async function f() { return fetch('https://api.example.com/api/users'); }
          `,
        },
      ],
      'src/a.ts',
    );
    expect(mixedHostSameEndpoint(ctx)).toEqual([]);
  });

  it('is silent when allConcepts is empty (single-file review mode)', () => {
    // No allConcepts → rule has no cross-file scope and silently no-ops.
    const ctx = ctxFrom(
      [
        {
          path: 'src/a.ts',
          source: `async function f() { return fetch('https://api.example.com/api/users'); }`,
        },
      ],
      'src/a.ts',
    );
    // Strip allConcepts to simulate single-file review mode.
    const singleFileCtx = { concepts: ctx.concepts, filePath: ctx.filePath };
    expect(mixedHostSameEndpoint(singleFileCtx)).toEqual([]);
  });

  it('is silent when host is not populated (relative URLs)', () => {
    // Rule has nothing to compare without populated host. The +41pp host
    // data is what unlocks this rule in the first place.
    const ctx = ctxFrom(
      [
        {
          path: 'src/a.ts',
          source: `
            async function f() { return fetch('/api/users'); }
          `,
        },
        {
          path: 'src/b.ts',
          source: `
            async function g() { return fetch('/api/users'); }
          `,
        },
      ],
      'src/a.ts',
    );
    expect(mixedHostSameEndpoint(ctx)).toEqual([]);
  });

  it('fires across 3+ hosts and lists all of them in the message', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/a.ts',
          source: `async function f() { return fetch('https://a.example.com/api/x'); }`,
        },
        {
          path: 'src/b.ts',
          source: `async function f() { return fetch('https://b.example.com/api/x'); }`,
        },
        {
          path: 'src/c.ts',
          source: `async function f() { return fetch('https://c.example.com/api/x'); }`,
        },
      ],
      'src/a.ts',
    );
    const findings = mixedHostSameEndpoint(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('a.example.com');
    expect(findings[0].message).toContain('b.example.com');
    expect(findings[0].message).toContain('c.example.com');
  });

  it('confidence is 0.7 (CROSS_STACK_HEURISTIC_CONFIDENCE × node 1.0)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/a.ts',
          source: `async function f() { return fetch('https://api.example.com/api/users'); }`,
        },
        {
          path: 'src/b.ts',
          source: `async function g() { return fetch('https://stale.example.com/api/users'); }`,
        },
      ],
      'src/a.ts',
    );
    const findings = mixedHostSameEndpoint(ctx);
    expect(findings.length).toBe(1);
    // Direct fetch confidence is 1.0 in the mapper; CROSS_STACK_HEURISTIC_CONFIDENCE = 0.7
    expect(findings[0].confidence).toBeCloseTo(0.7, 2);
  });
});
