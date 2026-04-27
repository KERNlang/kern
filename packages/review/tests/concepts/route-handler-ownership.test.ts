import { Project } from 'ts-morph';
import { findHandlerConcept } from '../../src/concept-rules/cross-stack-utils.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

describe('route → handler concept ownership', () => {
  const project = () => new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });

  it('links an inline arrow handler: route.handlerConceptId resolves to the function_declaration', () => {
    const p = project();
    const src = `
      import express from 'express';
      const app = express();
      app.post('/users', (req: any, res: any) => {
        const { name, email } = req.body;
        res.json({ name, email });
      });
    `;
    const file = '/repo/src/index.ts';
    const map = extractTsConcepts(p.createSourceFile(file, src), file);
    const route = map.nodes.find(
      (n) => n.kind === 'entrypoint' && n.payload.kind === 'entrypoint' && n.payload.subtype === 'route',
    );
    expect(route).toBeDefined();
    if (!route || route.payload.kind !== 'entrypoint') return;
    expect(route.payload.handlerConceptId).toBeDefined();

    const handler = findHandlerConcept(map, route);
    expect(handler).toBeDefined();
    expect(handler?.kind).toBe('function_declaration');
    if (handler?.payload.kind === 'function_declaration') {
      expect(handler.payload.name).toBe('POST_/users');
    }
  });

  it('links an inline function-expression handler the same way', () => {
    const p = project();
    const src = `
      import express from 'express';
      const app = express();
      app.get('/health', function (req: any, res: any) { res.json({ ok: true }); });
    `;
    const file = '/repo/src/index.ts';
    const map = extractTsConcepts(p.createSourceFile(file, src), file);
    const route = map.nodes.find(
      (n) => n.kind === 'entrypoint' && n.payload.kind === 'entrypoint' && n.payload.subtype === 'route',
    );
    const handler = route ? findHandlerConcept(map, route) : undefined;
    expect(handler).toBeDefined();
    expect(handler?.kind).toBe('function_declaration');
  });

  it('picks the LAST arrow arg when middlewares precede the handler', () => {
    const p = project();
    const src = `
      import express from 'express';
      const app = express();
      const mw = (req: any, _res: any, next: any) => next();
      app.post('/x', mw, (req: any, res: any) => {
        const { value } = req.body;
        res.send(value);
      });
    `;
    const file = '/repo/src/index.ts';
    const map = extractTsConcepts(p.createSourceFile(file, src), file);
    const route = map.nodes.find(
      (n) => n.kind === 'entrypoint' && n.payload.kind === 'entrypoint' && n.payload.subtype === 'route',
    );
    const handler = route ? findHandlerConcept(map, route) : undefined;
    expect(handler).toBeDefined();
    if (handler?.payload.kind === 'function_declaration') {
      expect(handler.payload.name).toBe('POST_/x');
    }
  });

  it('leaves handlerConceptId undefined for an imported-identifier handler', () => {
    const p = project();
    const src = `
      import express from 'express';
      import { userHandler } from './handlers.js';
      const app = express();
      app.get('/users', userHandler);
    `;
    const file = '/repo/src/index.ts';
    const map = extractTsConcepts(p.createSourceFile(file, src), file);
    const route = map.nodes.find(
      (n) => n.kind === 'entrypoint' && n.payload.kind === 'entrypoint' && n.payload.subtype === 'route',
    );
    expect(route).toBeDefined();
    if (route?.payload.kind === 'entrypoint') {
      expect(route.payload.handlerConceptId).toBeUndefined();
    }
    expect(findHandlerConcept(map, route!)).toBeUndefined();
  });

  it('route-mount concepts never carry handlerConceptId', () => {
    const p = project();
    const src = `
      import express from 'express';
      import userRoutes from './routes/users.js';
      const app = express();
      app.use('/api/users', userRoutes);
    `;
    const file = '/repo/src/index.ts';
    const map = extractTsConcepts(p.createSourceFile(file, src), file);
    const mount = map.nodes.find(
      (n) => n.kind === 'entrypoint' && n.payload.kind === 'entrypoint' && n.payload.subtype === 'route-mount',
    );
    expect(mount).toBeDefined();
    if (mount?.payload.kind === 'entrypoint') {
      expect(mount.payload.handlerConceptId).toBeUndefined();
    }
  });

  it('finds the handler concept for each of multiple routes in one file', () => {
    const p = project();
    const src = `
      import express from 'express';
      const app = express();
      app.get('/a', (req: any, res: any) => res.send('a'));
      app.post('/b', (req: any, res: any) => res.send('b'));
      app.delete('/c', (req: any, res: any) => res.send('c'));
    `;
    const file = '/repo/src/index.ts';
    const map = extractTsConcepts(p.createSourceFile(file, src), file);
    const routes = map.nodes.filter(
      (n) => n.kind === 'entrypoint' && n.payload.kind === 'entrypoint' && n.payload.subtype === 'route',
    );
    expect(routes).toHaveLength(3);
    for (const r of routes) {
      const h = findHandlerConcept(map, r);
      expect(h).toBeDefined();
      if (r.payload.kind === 'entrypoint' && h?.payload.kind === 'function_declaration') {
        expect(h.payload.name).toMatch(
          new RegExp(`^(GET|POST|DELETE)_${(r.payload.name as string).replace('/', '\\/')}$`),
        );
      }
    }
  });
});
