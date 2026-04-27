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
});
