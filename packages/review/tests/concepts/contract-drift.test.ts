import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { contractDrift } from '../../src/concept-rules/contract-drift.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

function conceptsOf(source: string, filePath: string): ConceptMap {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const sf = project.createSourceFile(filePath, source);
  return extractTsConcepts(sf, filePath);
}

/** Build the cross-file context the rule expects in graph mode. */
function ctxFrom(files: Array<{ path: string; source: string }>, primary: string) {
  const allConcepts = new Map<string, ConceptMap>();
  for (const f of files) allConcepts.set(f.path, conceptsOf(f.source, f.path));
  const concepts = allConcepts.get(primary);
  if (!concepts) throw new Error(`primary file ${primary} not in allConcepts`);
  return { concepts, filePath: primary, allConcepts };
}

describe('contract-drift', () => {
  it('fires when a frontend fetch targets an /api/ path that no server route matches', () => {
    const frontend = `
      async function loadUsers() {
        const res = await fetch('/api/users/42');
        return res.json();
      }
    `;
    const server = `
      // A related but different route lives on the server.
      app.get('/api/posts/:id', (req, res) => res.json({}));
    `;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: frontend },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    const findings = contractDrift(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].ruleId).toBe('contract-drift');
    expect(findings[0].message).toContain('/api/users/42');
    expect(findings[0].primarySpan.file).toBe('src/client.ts');
  });

  it('is silent when the server has a matching template route with a param', () => {
    const frontend = `
      async function loadUser() {
        await fetch('/api/users/42');
      }
    `;
    const server = `
      app.get('/api/users/:id', (req, res) => res.json({}));
    `;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: frontend },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(contractDrift(ctx)).toEqual([]);
  });

  it('also accepts FastAPI-style {param} route templates', () => {
    const frontend = `await fetch('/api/users/42');`;
    // Simulate a Python-side route via the same entrypoint shape the Python
    // mapper will emit (path + httpMethod). Using the Express-like syntax here
    // is just the TS test-harness equivalent; the rule compares strings.
    const server = `app.get('/api/users/{id}', (req, res) => res.json({}));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: frontend },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(contractDrift(ctx)).toEqual([]);
  });

  it('ignores non-api-path targets so the rule does not fire on external APIs', () => {
    const frontend = `await fetch('https://api.stripe.com/v1/charges');`;
    const server = `app.get('/api/users/:id', (req, res) => res.json({}));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: frontend },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(contractDrift(ctx)).toEqual([]);
  });

  it('returns no findings in single-file (non-graph) mode even if a fetch is present', () => {
    const frontend = `await fetch('/api/users/42');`;
    const concepts = conceptsOf(frontend, 'src/client.ts');
    // No allConcepts → rule gate returns early.
    expect(contractDrift({ concepts, filePath: 'src/client.ts' })).toEqual([]);
  });

  it('does not fire when the project has no server routes at all (pure frontend lib)', () => {
    const frontend = `await fetch('/api/users/42');`;
    const ctx = ctxFrom([{ path: 'src/client.ts', source: frontend }], 'src/client.ts');
    expect(contractDrift(ctx)).toEqual([]);
  });

  it('strips query strings before matching', () => {
    const frontend = `await fetch('/api/users/42?expand=true');`;
    const server = `app.get('/api/users/:id', (req, res) => res.json({}));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: frontend },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(contractDrift(ctx)).toEqual([]);
  });
});
