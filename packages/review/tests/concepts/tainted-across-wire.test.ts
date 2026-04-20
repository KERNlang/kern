import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { taintedAcrossWire } from '../../src/concept-rules/tainted-across-wire.js';
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

describe('tainted-across-wire', () => {
  it('fires when a dynamic POST body targets an /api/ route whose handler has no validation guard', () => {
    const client = `
      async function submit(formData: { name: string }) {
        await fetch('/api/signup', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
      }
    `;
    // Handler has no schema.parse / zod / yup / etc.
    const server = `
      app.post('/api/signup', (req, res) => {
        db.users.insert(req.body);
        res.json({ ok: true });
      });
    `;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    const findings = taintedAcrossWire(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].ruleId).toBe('tainted-across-wire');
    expect(findings[0].message).toContain('/api/signup');
    expect(findings[0].category).toBe('pattern');
  });

  it('is silent when the server handler validates with zod (schema.parse in scope)', () => {
    const client = `
      async function submit(formData: { name: string }) {
        await fetch('/api/signup', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
      }
    `;
    const server = `
      const SignupSchema = z.object({ name: z.string() });
      app.post('/api/signup', (req, res) => {
        const data = SignupSchema.parse(req.body);
        db.users.insert(data);
        res.json({ ok: true });
      });
    `;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(taintedAcrossWire(ctx)).toEqual([]);
  });

  it('is silent when the request body is a static literal (no user data on the wire)', () => {
    const client = `
      async function ping() {
        await fetch('/api/heartbeat', {
          method: 'POST',
          body: '{"ping":true}',
        });
      }
    `;
    const server = `app.post('/api/heartbeat', (req, res) => res.json({ ok: true }));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(taintedAcrossWire(ctx)).toEqual([]);
  });

  it('is silent when no matching server route exists (contract-drift owns that class)', () => {
    const client = `
      async function submit(data: unknown) {
        await fetch('/api/missing', { method: 'POST', body: JSON.stringify(data) });
      }
    `;
    const server = `app.post('/api/signup', (req, res) => res.json({}));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(taintedAcrossWire(ctx)).toEqual([]);
  });

  it('fires when body is a template literal with interpolation', () => {
    const client = `
      async function send(name: string) {
        await fetch('/api/submit', {
          method: 'POST',
          body: \`{"name":"\${name}"}\`,
        });
      }
    `;
    const server = `app.post('/api/submit', (req, res) => res.json({}));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(taintedAcrossWire(ctx).length).toBe(1);
  });

  it('is silent on GET requests (no body on the wire)', () => {
    const client = `await fetch('/api/users').then(r => r.json());`;
    const server = `app.get('/api/users', (req, res) => res.json([]));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(taintedAcrossWire(ctx)).toEqual([]);
  });

  it('is silent in single-file (non-graph) mode', () => {
    const client = `await fetch('/api/signup', { method: 'POST', body: JSON.stringify({}) });`;
    const concepts = conceptsOf(client, 'src/client.ts');
    expect(taintedAcrossWire({ concepts, filePath: 'src/client.ts' })).toEqual([]);
  });

  it('fires on shorthand fetch body property `{ method, body }` (codex regression on d8f95d49)', () => {
    // RequestInit shorthand — `body` is a variable reference, not a literal.
    // Before the fix, the mapper returned undefined and the rule stayed silent.
    const client = `
      async function submit(body: string) {
        await fetch('/api/signup', { method: 'POST', body });
      }
    `;
    const server = `app.post('/api/signup', (req, res) => res.json({}));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(taintedAcrossWire(ctx).length).toBe(1);
  });

  it('fires on axios-style calls where the 2nd arg IS the body (gemini regression on d8f95d49)', () => {
    // Before the fix, the mapper treated `axios.post(url, obj)` as a
    // fetch-style call and looked for `obj.body` (which doesn't exist),
    // returning bodyKind='none' and silencing the finding.
    const client = `
      async function submit(formData: { name: string }) {
        await axios.post('/api/signup', formData);
      }
    `;
    const server = `app.post('/api/signup', (req, res) => res.json({}));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    const findings = taintedAcrossWire(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('/api/signup');
  });

  it('fires on FastAPI-style {id} routes when client body is dynamic and no validator is in scope', () => {
    const client = `
      async function updateUser(id: string, payload: { name: string }) {
        await fetch(\`/api/users/\${id}\`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      }
    `;
    const server = `app.put('/api/users/{id}', (req, res) => res.json({}));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(taintedAcrossWire(ctx).length).toBe(1);
  });
});
