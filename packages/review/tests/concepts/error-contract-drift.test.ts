import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { errorContractDrift } from '../../src/concept-rules/error-contract-drift.js';
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

// The 0.9 evidence stack from the campfire round (Codex/Gemini/OpenCode):
// path+method match, server emits semantic error statuses, client has
// EXPLICIT literal-status dispatch, client already covers at least one
// server status (proves the dispatch is endpoint-specific).
describe('error-contract-drift', () => {
  it('fires when server emits 404 + 422 but client only branches on 404 (overlap proves endpoint binding)', () => {
    // Statuses 404 and 422 are both in the Express mapper's
    // API_ERROR_STATUS_CODES whitelist (ts-concepts.ts:540), so the
    // server-side `errorStatusCodes` payload contains both. 409 / 429
    // / 405 are NOT in the mapper's whitelist today — expanding it is
    // a phase-1.5 follow-up.
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/users/42', { method: 'GET' });
              if (response.status === 404) return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users/:id', (req, res) => {
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
    expect(findings.length).toBe(1);
    expect(findings[0].ruleId).toBe('error-contract-drift');
    expect(findings[0].message).toContain('422');
    expect(findings[0].message).toContain('GET /api/users/:id');
  });

  it('is silent when client already handles every semantic server status', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/users/42', { method: 'GET' });
              if (response.status === 404) return null;
              if (response.status === 422) return 'invalid';
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users/:id', (req, res) => {
              if (!found) return res.status(404).json({});
              if (badInput) return res.status(422).json({});
              res.json({});
            });
          `,
        },
      ],
      'src/client.ts',
    );
    expect(errorContractDrift(ctx)).toEqual([]);
  });

  it('is silent when client has no explicit status dispatch (generic catch only — the FP gate)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              try {
                await fetch('/api/users/42', { method: 'GET' });
              } catch (e) {
                console.error(e);
              }
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users/:id', (req, res) => {
              if (!found) return res.status(404).json({});
              if (badInput) return res.status(422).json({});
              res.json({});
            });
          `,
        },
      ],
      'src/client.ts',
    );
    // Empty `handledErrorStatusCodes` — phase-1 mapper says "this call-site
    // is generic-handle-only", so the rule declines to fire even though the
    // server emits semantic statuses.
    expect(errorContractDrift(ctx)).toEqual([]);
  });

  it('is silent when client branches only on statuses NOT in the server set (no overlap)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/users/42', { method: 'GET' });
              // 401 is global auth handling, not endpoint-specific
              if (response.status === 401) return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users/:id', (req, res) => {
              if (!found) return res.status(404).json({});
              if (badInput) return res.status(422).json({});
              res.json({});
            });
          `,
        },
      ],
      'src/client.ts',
    );
    // No overlap between client {401} and server {404, 422} — the client's
    // 401 handling is likely a global auth interceptor, not endpoint-specific.
    // Firing on this would be the exact FP class Codex/Gemini both warned
    // about.
    expect(errorContractDrift(ctx)).toEqual([]);
  });

  it('is silent when method does not match (contract-method-drift territory)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/users/42', { method: 'POST' });
              if (response.status === 404) return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users/:id', (req, res) => {
              if (!found) return res.status(404).json({});
            });
          `,
        },
      ],
      'src/client.ts',
    );
    // POST != GET — the high-confidence matcher returns no route, so we stay silent.
    expect(errorContractDrift(ctx)).toEqual([]);
  });

  it('excludes inferred 500s — the next(err)/throw class Codex flagged', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/users/42', { method: 'GET' });
              if (response.status === 404) return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users/:id', (req, res, next) => {
              if (!found) return res.status(404).json({});
              return next(new Error('boom')); // mapper records 500 here
            });
          `,
        },
      ],
      'src/client.ts',
    );
    // Server emits {404, 500}. After the semantic-only filter, only 404
    // remains. Client handles 404 → no unhandled semantic codes → silent.
    // This is the v1 rule explicitly excluding inferred 500s.
    expect(errorContractDrift(ctx)).toEqual([]);
  });

  it('fires on a switch-based dispatch with one missing case', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/users/42', { method: 'GET' });
              switch (response.status) {
                case 200: return [];
                case 404: return null;
                // 422 missing
              }
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users/:id', (req, res) => {
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
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('422');
  });

  it('is silent when server emits no semantic codes (only 500-class)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/users/42', { method: 'GET' });
              if (response.status === 404) return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users/:id', (req, res, next) => next(new Error('boom')));
          `,
        },
      ],
      'src/client.ts',
    );
    // Server's only emit is an inferred 500. After semantic filter,
    // serverCodes is empty → rule skips.
    expect(errorContractDrift(ctx)).toEqual([]);
  });

  it('confidence is at least 0.7 when fired (cross-stack-exact gate × node confidence)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/users/42', { method: 'GET' });
              if (response.status === 404) return null;
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.get('/api/users/:id', (req, res) => {
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
    expect(findings.length).toBe(1);
    // Direct fetch has confidence 1.0 in the mapper; CROSS_STACK_EXACT_CONFIDENCE
    // is 0.9. Final = 1.0 × 0.9 = 0.9.
    expect(findings[0].confidence).toBeCloseTo(0.9, 2);
  });

  it('is silent on empty allConcepts (single-file review mode)', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function load() {
              const response = await fetch('/api/users/42', { method: 'GET' });
              if (response.status === 404) return null;
            }
          `,
        },
      ],
      'src/client.ts',
    );
    // Only client file — no server routes in graph. Rule needs cross-stack
    // graph mode, returns [] silently.
    expect(errorContractDrift(ctx)).toEqual([]);
  });
});
