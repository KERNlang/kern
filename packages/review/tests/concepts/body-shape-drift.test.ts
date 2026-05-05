import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { bodyShapeDrift } from '../../src/concept-rules/body-shape-drift.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

function mergeMaps(...maps: ConceptMap[]): Map<string, ConceptMap> {
  const out = new Map<string, ConceptMap>();
  for (const m of maps) {
    const existing = out.get(m.filePath);
    if (existing) {
      out.set(m.filePath, { ...existing, nodes: [...existing.nodes, ...m.nodes] });
    } else {
      out.set(m.filePath, m);
    }
  }
  return out;
}

describe('body-shape-drift', () => {
  const project = () => new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });

  it('fires when the client omits a field the server destructures off req.body', () => {
    const p = project();
    const clientSrc = `
      async function create(name: string) {
        await fetch('/api/users', {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
      }
    `;
    const serverSrc = `
      import express from 'express';
      const app = express();
      app.post('/api/users', (req: any, res: any) => {
        const { name, email } = req.body;
        res.json({ name, email });
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({
      concepts: cMap,
      filePath: cf,
      allConcepts: mergeMaps(cMap, sMap),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/email/);
    expect(findings[0].message).toMatch(/\/api\/users/);
  });

  it('is silent when the client sends every required field', () => {
    const p = project();
    const clientSrc = `
      async function create(name: string, email: string) {
        await fetch('/api/users', { method: 'POST', body: JSON.stringify({ name, email }) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      const app = express();
      app.post('/api/users', (req: any, res: any) => {
        const { name, email } = req.body;
        res.json({ name, email });
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
    expect(findings).toHaveLength(0);
  });

  it('derives sent fields from a typed fetch payload variable', () => {
    const p = project();
    const clientSrc = `
      interface CreateUserInput {
        name: string;
        email: string;
      }
      async function create(input: CreateUserInput) {
        await fetch('/api/users', { method: 'POST', body: JSON.stringify(input) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      const app = express();
      app.post('/api/users', (req: any, res: any) => {
        const { name, email } = req.body;
        res.json({ name, email });
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
    expect(findings).toHaveLength(0);
  });

  it('treats optional typed payload fields as not guaranteed on the wire', () => {
    const p = project();
    const clientSrc = `
      interface CreateUserInput {
        name: string;
        email?: string;
      }
      async function create(input: CreateUserInput) {
        await fetch('/api/users', { method: 'POST', body: JSON.stringify(input) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      const app = express();
      app.post('/api/users', (req: any, res: any) => {
        const { name, email } = req.body;
        res.json({ name, email });
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/email/);
  });

  it('derives sent fields from axios-style typed payload arguments', () => {
    const p = project();
    const clientSrc = `
      import axios from 'axios';
      interface CreateUserInput {
        name: string;
      }
      async function create(input: CreateUserInput) {
        await axios.post('/api/users', input);
      }
    `;
    const serverSrc = `
      import express from 'express';
      const app = express();
      app.post('/api/users', (req: any, res: any) => {
        const { name, email } = req.body;
        res.json({ name, email });
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/email/);
  });

  it('fires on property-access reads (req.body.X) the same way as destructuring', () => {
    const p = project();
    const clientSrc = `
      async function create(name: string) {
        await fetch('/api/users', { method: 'POST', body: JSON.stringify({ name }) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      const app = express();
      app.post('/api/users', (req: any, res: any) => {
        res.json({ name: req.body.name, email: req.body.email });
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/email/);
  });

  it('treats default-value destructuring as optional (no fire on omitted default field)', () => {
    const p = project();
    const clientSrc = `
      async function create(name: string) {
        await fetch('/api/users', { method: 'POST', body: JSON.stringify({ name }) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      const app = express();
      app.post('/api/users', (req: any, res: any) => {
        const { name, status = 'active' } = req.body;
        res.json({ name, status });
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
    expect(findings).toHaveLength(0);
  });

  it('stays silent when the server uses a rest element (handler may need arbitrary fields)', () => {
    const p = project();
    const clientSrc = `
      async function create(name: string) {
        await fetch('/api/things', { method: 'POST', body: JSON.stringify({ name }) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      const app = express();
      app.post('/api/things', (req: any, res: any) => {
        const { name, ...rest } = req.body;
        res.json({ name, rest });
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
    expect(findings).toHaveLength(0);
  });

  it('stays silent when the client body uses a spread operator', () => {
    const p = project();
    const clientSrc = `
      async function create(name: string, base: any) {
        await fetch('/api/users', { method: 'POST', body: JSON.stringify({ ...base, name }) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      const app = express();
      app.post('/api/users', (req: any, res: any) => {
        const { name, email } = req.body;
        res.json({ name, email });
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
    expect(findings).toHaveLength(0);
  });

  it('stays silent when the server whole-body forwards (const body = req.body)', () => {
    const p = project();
    const clientSrc = `
      async function create(name: string) {
        await fetch('/api/proxy', { method: 'POST', body: JSON.stringify({ name }) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      const app = express();
      app.post('/api/proxy', (req: any, res: any) => {
        const body = req.body;
        res.json(body);
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
    expect(findings).toHaveLength(0);
  });

  it('reports all missing fields in one message when multiple are omitted', () => {
    const p = project();
    const clientSrc = `
      async function create(name: string) {
        await fetch('/api/users', { method: 'POST', body: JSON.stringify({ name }) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      const app = express();
      app.post('/api/users', (req: any, res: any) => {
        const { name, email, phone, country } = req.body;
        res.json({ name, email, phone, country });
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/email/);
    expect(findings[0].message).toMatch(/phone/);
    expect(findings[0].message).toMatch(/country/);
  });

  it('does not fire on the "extra" direction (client sends a field server ignores)', () => {
    const p = project();
    const clientSrc = `
      async function create(name: string, unused: string) {
        await fetch('/api/users', { method: 'POST', body: JSON.stringify({ name, unused }) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      const app = express();
      app.post('/api/users', (req: any, res: any) => {
        const { name } = req.body;
        res.json({ name });
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
    expect(findings).toHaveLength(0);
  });

  it('fires across an Express route-mount (app.use("/api/users", router))', () => {
    const p = project();
    const clientSrc = `
      async function create(name: string) {
        await fetch('/api/users/register', { method: 'POST', body: JSON.stringify({ name }) });
      }
    `;
    const mountSrc = `
      import express from 'express';
      import userRoutes from './routes/users.js';
      const app = express();
      app.use('/api/users', userRoutes);
    `;
    const routeSrc = `
      import { Router } from 'express';
      const router = Router();
      router.post('/register', (req: any, res: any) => {
        const { name, email } = req.body;
        res.json({ name, email });
      });
      export default router;
    `;
    const cf = '/client/api.ts';
    const mf = '/server/src/index.ts';
    const rf = '/server/src/routes/users.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const mMap = extractTsConcepts(p.createSourceFile(mf, mountSrc), mf);
    const rMap = extractTsConcepts(p.createSourceFile(rf, routeSrc), rf);
    const findings = bodyShapeDrift({
      concepts: cMap,
      filePath: cf,
      allConcepts: mergeMaps(cMap, mMap, rMap),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/email/);
  });

  it('stays silent when the server handler is an imported identifier (v1 non-goal)', () => {
    const p = project();
    const clientSrc = `
      async function create(name: string) {
        await fetch('/api/users', { method: 'POST', body: JSON.stringify({ name }) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      import { createUser } from './handlers.js';
      const app = express();
      app.post('/api/users', createUser);
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
    expect(findings).toHaveLength(0);
  });

  // ── Type-mismatch step (server bodyFieldTypes × client sentFieldTypes) ──
  //
  // Lifts the rule from "name overlap" to "name + type overlap". When BOTH
  // sides have concrete type evidence and the tags disagree, that is a
  // high-precision bug that pure-name matching misses (real LLM-authored
  // pattern: client `userId: string`, server `userId: number`).
  //
  // Precision discipline: the type-aware step skips any pair where either
  // tag is `'unknown'`, so the default Express `req.body: any` (every tag
  // collapses to 'unknown') stays silent — no FPs against the long tail of
  // untyped handlers.

  describe('type-mismatch step (body-shape-drift/type)', () => {
    it('fires body-shape-drift/type when name overlaps but client/server type tags disagree', () => {
      const p = project();
      const clientSrc = `
        async function f() {
          await fetch('/api/users', {
            method: 'POST',
            body: JSON.stringify({ userId: 'u-123', count: 5 }),
          });
        }
      `;
      // Local-shim app: avoids depending on @types/express in the in-memory
      // project. The req parameter carries an inline type so destructured
      // bindings pick up real TS types.
      const serverSrc = `
        declare const app: { post: (path: string, handler: (req: { body: { userId: number; count: number } }, res: { json: (x: unknown) => void }) => void) => void };
        app.post('/api/users', (req, res) => {
          const { userId, count } = req.body;
          res.json({ userId, count });
        });
      `;
      const cf = '/client/api.ts';
      const sf = '/server/index.ts';
      const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
      const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
      const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
      const typeFinding = findings.find((f) => f.ruleId === 'body-shape-drift/type');
      expect(typeFinding).toBeDefined();
      expect(typeFinding?.message).toMatch(/userId/);
      expect(typeFinding?.message).toMatch(/client `string`/);
      expect(typeFinding?.message).toMatch(/server `number`/);
      // The matching `count` (both 'number') should NOT appear in the message.
      expect(typeFinding?.message).not.toMatch(/count/);
    });

    it('is silent when server side is untyped (req: any) — every server tag is unknown', () => {
      const p = project();
      const clientSrc = `
        async function f() {
          await fetch('/api/users', {
            method: 'POST',
            body: JSON.stringify({ userId: 'u-123' }),
          });
        }
      `;
      const serverSrc = `
        import express from 'express';
        const app = express();
        app.post('/api/users', (req: any, res: any) => {
          const { userId } = req.body;
          res.json({ userId });
        });
      `;
      const cf = '/client/api.ts';
      const sf = '/server/index.ts';
      const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
      const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
      const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
      // Sent and required fields fully agree by name; type step must skip
      // because server tag is 'unknown'.
      expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(0);
    });

    it('emits BOTH missing-fields and type findings independently when both apply', () => {
      const p = project();
      const clientSrc = `
        async function f() {
          await fetch('/api/users', {
            method: 'POST',
            body: JSON.stringify({ userId: 'u-123' }),
          });
        }
      `;
      const serverSrc = `
        declare const app: { post: (path: string, handler: (req: { body: { userId: number; email: string } }, res: { json: (x: unknown) => void }) => void) => void };
        app.post('/api/users', (req, res) => {
          const { userId, email } = req.body;
          res.json({ userId, email });
        });
      `;
      const cf = '/client/api.ts';
      const sf = '/server/index.ts';
      const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
      const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
      const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
      const ids = findings.map((f) => f.ruleId).sort();
      expect(ids).toEqual(['body-shape-drift', 'body-shape-drift/type']);
    });

    it('coarsens server union `T | null` to T so it matches a client primitive', () => {
      const p = project();
      const clientSrc = `
        async function f() {
          await fetch('/api/users', {
            method: 'POST',
            body: JSON.stringify({ label: 'hello' }),
          });
        }
      `;
      const serverSrc = `
        declare const app: { post: (path: string, handler: (req: { body: { label: string | null } }, res: { json: (x: unknown) => void }) => void) => void };
        app.post('/api/users', (req, res) => {
          const { label } = req.body;
          res.json({ label });
        });
      `;
      const cf = '/client/api.ts';
      const sf = '/server/index.ts';
      const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
      const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
      const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
      expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(0);
    });

    // Codex review fix: the extractor previously hard-matched the literal
    // text `req.body`, missing the very common typed-handler pattern of
    // casting `req.body as Body` (or a non-null/parens variant). Verify
    // the unwrapping path actually surfaces type tags now.
    it('extracts type tags through `req.body as Body` casts (destructure)', () => {
      const p = project();
      const clientSrc = `
        async function f() {
          await fetch('/api/users', {
            method: 'POST',
            body: JSON.stringify({ userId: 'u-123' }),
          });
        }
      `;
      const serverSrc = `
        declare const app: { post: (path: string, handler: (req: any, res: any) => void) => void };
        interface Body { userId: number; }
        app.post('/api/users', (req, res) => {
          const { userId } = req.body as Body;
          res.json({ userId });
        });
      `;
      const cf = '/client/api.ts';
      const sf = '/server/index.ts';
      const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
      const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
      const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
      const typeFinding = findings.find((f) => f.ruleId === 'body-shape-drift/type');
      expect(typeFinding).toBeDefined();
      expect(typeFinding?.message).toMatch(/userId/);
      expect(typeFinding?.message).toMatch(/client `string`/);
      expect(typeFinding?.message).toMatch(/server `number`/);
    });

    it('extracts type tags through `(req.body as Body).foo` property access', () => {
      const p = project();
      const clientSrc = `
        async function f() {
          await fetch('/api/users', {
            method: 'POST',
            body: JSON.stringify({ count: 'five' }),
          });
        }
      `;
      const serverSrc = `
        declare const app: { post: (path: string, handler: (req: any, res: any) => void) => void };
        interface Body { count: number; }
        app.post('/api/users', (req, res) => {
          res.json({ doubled: (req.body as Body).count * 2 });
        });
      `;
      const cf = '/client/api.ts';
      const sf = '/server/index.ts';
      const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
      const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
      const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
      const typeFinding = findings.find((f) => f.ruleId === 'body-shape-drift/type');
      expect(typeFinding).toBeDefined();
      expect(typeFinding?.message).toMatch(/count/);
    });

    // Codex review fix: the legacy missing-fields branch matched routes by
    // path only. For high-precision /type findings, this could fire across
    // a verb collision (POST/PUT on the same path with different body
    // shapes). The /type branch is now method-gated.
    it('does NOT fire /type when client method differs from the matched route method', () => {
      const p = project();
      // Client POSTs (creates) — server PUT handler shouldn't gate the type
      // finding even if the path-only matcher returned the PUT route first.
      const clientSrc = `
        async function f() {
          await fetch('/api/users', {
            method: 'POST',
            body: JSON.stringify({ userId: 'u-123' }),
          });
        }
      `;
      const serverSrc = `
        declare const app: {
          put: (path: string, handler: (req: any, res: any) => void) => void;
          post: (path: string, handler: (req: any, res: any) => void) => void;
        };
        interface PutBody { userId: number; }
        // PUT handler has typed body (would mismatch client's string userId)
        app.put('/api/users', (req, res) => {
          const { userId } = req.body as PutBody;
          res.json({ userId });
        });
        // POST handler reads userId off untyped body — server tag will be
        // 'unknown', so even on the correct path-method match the /type
        // branch stays silent (precision over recall).
        app.post('/api/users', (req, res) => {
          const { userId } = req.body;
          res.json({ userId });
        });
      `;
      const cf = '/client/api.ts';
      const sf = '/server/index.ts';
      const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
      const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
      const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
      // No /type finding — even though the path-only matcher might have
      // returned the PUT route, methods disagree, so /type is silent.
      expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(0);
    });

    it('handles type tags from req.body.foo property access readings', () => {
      const p = project();
      const clientSrc = `
        async function f() {
          await fetch('/api/users', {
            method: 'POST',
            body: JSON.stringify({ count: 'five' }),
          });
        }
      `;
      const serverSrc = `
        declare const app: { post: (path: string, handler: (req: { body: { count: number } }, res: { json: (x: unknown) => void }) => void) => void };
        app.post('/api/users', (req, res) => {
          // property-access reading, no destructuring
          res.json({ doubled: req.body.count * 2 });
        });
      `;
      const cf = '/client/api.ts';
      const sf = '/server/index.ts';
      const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
      const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
      const findings = bodyShapeDrift({ concepts: cMap, filePath: cf, allConcepts: mergeMaps(cMap, sMap) });
      const typeFinding = findings.find((f) => f.ruleId === 'body-shape-drift/type');
      expect(typeFinding).toBeDefined();
      expect(typeFinding?.message).toMatch(/count/);
      expect(typeFinding?.message).toMatch(/client `string`/);
      expect(typeFinding?.message).toMatch(/server `number`/);
    });
  });
});
