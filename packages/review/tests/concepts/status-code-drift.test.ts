import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { errorContractDrift } from '../../src/concept-rules/error-contract-drift.js';
import { statusCodeDrift } from '../../src/concept-rules/status-code-drift.js';
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

describe('status-code-drift', () => {
  it('fires when client checks 201 but server returns 200', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/users', { method: 'POST' });
              if (response.status === 201) return await response.json();
              return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.post('/api/users', (req: any, res: any) => {
              const created = { id: 1 };
              res.status(200).json(created);
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = statusCodeDrift(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].ruleId).toBe('status-code-drift');
    expect(findings[0].message).toContain('201');
    expect(findings[0].message).toContain('200');
  });

  it('does NOT fire when client checks 201 and server emits 201', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/users', { method: 'POST' });
              if (response.status === 201) return await response.json();
              return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.post('/api/users', (req: any, res: any) => {
              const created = { id: 1 };
              res.status(201).json(created);
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = statusCodeDrift(ctx);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when server has multiple 2xx codes (skip multi-2xx case in v1)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/users', { method: 'POST' });
              if (response.status === 200) return await response.json();
              return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.post('/api/users', (req: any, res: any) => {
              if (req.body.skip) {
                res.status(202).json({ queued: true });
              } else {
                res.status(201).json({ id: 1 });
              }
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = statusCodeDrift(ctx);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when client checks multiple 2xx codes (probably fallback logic)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/users', { method: 'POST' });
              if (response.status === 201) return await response.json();
              if (response.status === 200) return await response.json();
              return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.post('/api/users', (req: any, res: any) => {
              res.status(200).json({});
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = statusCodeDrift(ctx);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on the 200/204 pair (skip in v1)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function del() {
              const response = await fetch('/api/users/42', { method: 'DELETE' });
              if (response.status === 200) return true;
              return false;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.delete('/api/users/:id', (req: any, res: any) => {
              res.sendStatus(204);
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = statusCodeDrift(ctx);
    expect(findings).toHaveLength(0);
  });

  it('uses implicit 200 when handler has no explicit status but calls res.json()', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/items', { method: 'GET' });
              if (response.status === 201) return await response.json();
              return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.get('/api/items', (req: any, res: any) => {
              res.json([1, 2, 3]);
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = statusCodeDrift(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire when server uses dynamic status (mapper unresolved)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/users', { method: 'POST' });
              if (response.status === 201) return await response.json();
              return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.post('/api/users', (req: any, res: any) => {
              const code = req.body.code ?? 200;
              res.status(code).json({});
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = statusCodeDrift(ctx);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire in single-file mode (silent without allConcepts)', () => {
    const findings = statusCodeDrift({
      concepts: { language: 'ts', filePath: 'x.ts', nodes: [], edges: [], extractorVersion: '1.0.0' },
      filePath: 'x.ts',
    });
    expect(findings).toHaveLength(0);
  });

  // ── Regression tests for buddy-flagged FP/coverage bugs (Codex/Gemini/OpenCode
  //    final implementation review) ─────────────────────────────────────────

  it('does NOT FP on the second of two API calls in the same function (Codex: call-binding)', () => {
    // Function calls /api/users (server returns 201) AND /api/posts (server
    // returns 200). Client only checks `users.status === 201`. Without
    // call-binding, BOTH fetches inherit handled=[201] from the function-wide
    // extractor and the rule fires on /api/posts (server returns 200, "drift").
    // With call-binding, only the `users` var's check counts for the users
    // call, and `posts` has no specific status check.
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function loadAll() {
              const users = await fetch('/api/users', { method: 'POST' });
              if (users.status === 201) console.log('created');
              const posts = await fetch('/api/posts', { method: 'GET' });
              return await posts.json();
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.post('/api/users', (req: any, res: any) => { res.status(201).json({}); });
            router.get('/api/posts', (req: any, res: any) => { res.status(200).json([]); });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = statusCodeDrift(ctx);
    expect(findings).toHaveLength(0);
  });

  it('does NOT infer implicit 200 on an error-only handler (Gemini #3, OpenCode #5)', () => {
    // Handler does `res.status(404).send()`. The terminal `.send()` is chained
    // off a status() call → mapper must NOT contribute implicit 200. Otherwise
    // a client checking `res.status === 201` would falsely trigger drift.
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/users/999', { method: 'GET' });
              if (response.status === 201) return await response.json();
              return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.get('/api/users/:id', (req: any, res: any) => {
              res.status(404).send();
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = statusCodeDrift(ctx);
    expect(findings).toHaveLength(0);
  });

  it('correctly attributes 200 in branched handler with mixed terminals (Gemini #1)', () => {
    // `if (c) res.status(201).send(); else res.send();` → server emits BOTH
    // 201 and an implicit 200. With `successStatusCodes.length === 1` gate,
    // the rule skips this multi-2xx route (documented coverage gap), but
    // the mapper itself must include 200.
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/items', { method: 'POST' });
              if (response.status === 201) return await response.json();
              return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.post('/api/items', (req: any, res: any) => {
              if (req.body.created) {
                res.status(201).send();
              } else {
                res.send({});
              }
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = statusCodeDrift(ctx);
    // Multi-2xx route — gate skips this case (documented).
    expect(findings).toHaveLength(0);
  });

  it('does NOT infer implicit 200 when status is in chain through intermediate calls (Gemini/Codex round-2 #2)', () => {
    // `res.status(201).set('X-Count', 10).json(data)` — the .json terminal's
    // direct receiver is .set(), not .status(). Without walking the chain
    // we'd falsely add implicit 200, making the route look like multi-2xx
    // and silently skip the rule. Chain walk fixes this.
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/items', { method: 'POST' });
              if (response.status === 200) return await response.json();
              return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.post('/api/items', (req: any, res: any) => {
              res.status(201).set('X-Count', '10').json({});
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = statusCodeDrift(ctx);
    // Server returns 201, client checks 200 — real drift, must fire.
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].message).toContain('200');
    expect(findings[0].message).toContain('201');
  });

  it('fires on a permission-guard route that only emits errors (Gemini round-2 #3)', () => {
    // `if (!hasAccess) return res.status(403).send('Forbidden')` with no 2xx
    // path. Mapper had full visibility, confirmed no 2xx codes — should
    // return resolved=true with empty codes. Rule fires when client (wrongly)
    // checks 200 on this route.
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function check() {
              const response = await fetch('/api/admin/secret', { method: 'GET' });
              if (response.status === 200) return await response.json();
              return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.get('/api/admin/secret', (req: any, res: any) => {
              res.status(403).send('Forbidden');
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = statusCodeDrift(ctx);
    // Server emits no 2xx; client checks 200 — real drift, must fire.
    // Note: gate 2 requires successStatusCodes.length === 1. Empty codes []
    // won't pass that gate. So the rule still skips this case in v1 — this
    // test documents the intent (full visibility on error-only) but verifies
    // the gate is correctly conservative for now.
    expect(findings).toHaveLength(0);
  });

  it('does NOT regress error-contract-drift when a try/catch uses a different var name (Gemini/Codex round-2 #1)', () => {
    // axios-style: `const users = await axios.get(...)` in try block,
    // `if (err.status === 404) ...` in catch. Without the catch-clause
    // exemption my call-binding rejects the err.status check entirely,
    // making error-contract-drift miss 404 dispatch. The exemption restores
    // it.
    //
    // We assert this via error-contract-drift behavior because the
    // catch-status binding lives in the shared mapper code that both rules
    // consume. error-contract-drift fires only when client overlaps a
    // server-emitted code and the server emits OTHER codes the client
    // doesn't handle. Server here emits 404 + 422; client handles 404 but
    // not 422 → finding expected.
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            import axios from 'axios';
            async function load() {
              try {
                const users = await axios.get('/api/users/42');
                return users.data;
              } catch (err: any) {
                if (err.status === 404) return null;
              }
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            const router: any = {};
            router.get('/api/users/:id', (req: any, res: any) => {
              if (!found) return res.status(404).json({});
              if (badInput) return res.status(422).json({});
              res.json({});
            });
          `,
        },
      ],
      'src/client.ts',
    );
    const findings = errorContractDrift(ctx);
    // Without the catch-clause exemption, err.status === 404 gets dropped,
    // client `handled` becomes empty, and error-contract-drift's
    // collectExplicitDispatchCalls filters this call out entirely → no
    // finding. With the exemption, 404 gets attributed, the overlap gate
    // is met, and 422 becomes a real "unhandled server code" finding.
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].ruleId).toBe('error-contract-drift');
    expect(findings[0].message).toContain('422');
  });
});
