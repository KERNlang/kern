import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { contractDrift } from '../../src/concept-rules/contract-drift.js';
import { collectRoutesAcrossGraph } from '../../src/concept-rules/cross-stack-utils.js';
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

describe('Express app.use() route-mount expansion', () => {
  it('joins router.get("/foo") with app.use("/api/review", reviewRoutes)', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const mountSrc = `
      import express from 'express';
      import reviewRoutes from './routes/review.js';
      const app = express();
      app.use('/api/review', reviewRoutes);
    `;
    const routeSrc = `
      import { Router } from 'express';
      const router = Router();
      router.get('/comments', (req, res) => res.json({}));
      router.post('/verify', (req, res) => res.json({}));
      export default router;
    `;
    const mountFile = '/repo/src/index.ts';
    const routeFile = '/repo/src/routes/review.ts';
    const mountMap = extractTsConcepts(project.createSourceFile(mountFile, mountSrc), mountFile);
    const routeMap = extractTsConcepts(project.createSourceFile(routeFile, routeSrc), routeFile);
    const all = mergeMaps(mountMap, routeMap);
    const routes = collectRoutesAcrossGraph(all);
    const paths = routes.map((r) => r.path).sort();
    expect(paths).toEqual(['/api/review/comments', '/api/review/verify']);
    expect(routes.find((r) => r.path === '/api/review/comments')?.method).toBe('GET');
    expect(routes.find((r) => r.path === '/api/review/verify')?.method).toBe('POST');
  });

  it('does not mis-emit app.use() as a routeless route entrypoint', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const src = `
      import express from 'express';
      import reviewRoutes from './routes/review.js';
      const app = express();
      app.use('/api/review', reviewRoutes);
    `;
    const file = '/repo/src/index.ts';
    const map = extractTsConcepts(project.createSourceFile(file, src), file);
    const routeEntrypoints = map.nodes.filter(
      (n) => n.kind === 'entrypoint' && n.payload.kind === 'entrypoint' && n.payload.subtype === 'route',
    );
    expect(routeEntrypoints).toHaveLength(0);
    const mounts = map.nodes.filter(
      (n) => n.kind === 'entrypoint' && n.payload.kind === 'entrypoint' && n.payload.subtype === 'route-mount',
    );
    expect(mounts).toHaveLength(1);
    if (mounts[0].payload.kind === 'entrypoint') {
      expect(mounts[0].payload.name).toBe('/api/review');
      expect(mounts[0].payload.routerName).toBe('reviewRoutes');
    }
  });

  it('handles app.use("/prefix", middleware, subRouter) — sub-router is last arg', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const mountSrc = `
      import express from 'express';
      import rateLimiter from './middleware/rateLimit.js';
      import licenseRoutes from './routes/license.js';
      const app = express();
      app.use('/api/license', rateLimiter, licenseRoutes);
    `;
    const routeSrc = `
      import { Router } from 'express';
      const router = Router();
      router.post('/verify', (req, res) => res.json({}));
      export default router;
    `;
    const mountFile = '/repo/src/index.ts';
    const routeFile = '/repo/src/routes/license.ts';
    const mountMap = extractTsConcepts(project.createSourceFile(mountFile, mountSrc), mountFile);
    const routeMap = extractTsConcepts(project.createSourceFile(routeFile, routeSrc), routeFile);
    const routes = collectRoutesAcrossGraph(mergeMaps(mountMap, routeMap));
    expect(routes.map((r) => r.path)).toEqual(['/api/license/verify']);
  });

  it('does not emit a mount when .use() has no sub-router identifier (middleware-only)', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const src = `
      import express from 'express';
      const app = express();
      app.use('/docs', express.static('public'));
      app.use((req, res, next) => next());
    `;
    const file = '/repo/src/index.ts';
    const map = extractTsConcepts(project.createSourceFile(file, src), file);
    const mounts = map.nodes.filter(
      (n) => n.kind === 'entrypoint' && n.payload.kind === 'entrypoint' && n.payload.subtype === 'route-mount',
    );
    expect(mounts).toHaveLength(0);
  });

  it('contract-drift is silent when the frontend URL matches a prefix-mounted Express route', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const clientPath = '/repo/client/src/reviewApi.ts';
    const frontend = `
      const API_BASE = '';
      async function loadReview(slug: string) {
        await fetch(\`\${API_BASE}/api/review/\${slug}/comments\`);
      }
    `;
    const mountSrc = `
      import express from 'express';
      import reviewRoutes from './routes/review.js';
      const app = express();
      app.use('/api/review', reviewRoutes);
    `;
    const routeSrc = `
      import { Router } from 'express';
      const router = Router();
      router.get('/:slug/comments', (req, res) => res.json({}));
      export default router;
    `;
    const mountFile = '/repo/server/src/index.ts';
    const routeFile = '/repo/server/src/routes/review.ts';
    const clientMap = extractTsConcepts(project.createSourceFile(clientPath, frontend), clientPath);
    const mountMap = extractTsConcepts(project.createSourceFile(mountFile, mountSrc), mountFile);
    const routeMap = extractTsConcepts(project.createSourceFile(routeFile, routeSrc), routeFile);
    const findings = contractDrift({
      concepts: clientMap,
      filePath: clientPath,
      allConcepts: mergeMaps(clientMap, mountMap, routeMap),
    });
    expect(findings).toHaveLength(0);
  });

  it('contract-drift fires when the frontend URL misses the mounted Express path', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const clientPath = '/repo/client/src/reviewApi.ts';
    const frontend = `
      async function loadReview(slug: string) {
        await fetch(\`/api/reviews/\${slug}\`); // note: /reviews, not /review
      }
    `;
    const mountSrc = `
      import express from 'express';
      import reviewRoutes from './routes/review.js';
      const app = express();
      app.use('/api/review', reviewRoutes);
    `;
    const routeSrc = `
      import { Router } from 'express';
      const router = Router();
      router.get('/:slug', (req, res) => res.json({}));
      export default router;
    `;
    const mountFile = '/repo/server/src/index.ts';
    const routeFile = '/repo/server/src/routes/review.ts';
    const clientMap = extractTsConcepts(project.createSourceFile(clientPath, frontend), clientPath);
    const mountMap = extractTsConcepts(project.createSourceFile(mountFile, mountSrc), mountFile);
    const routeMap = extractTsConcepts(project.createSourceFile(routeFile, routeSrc), routeFile);
    const findings = contractDrift({
      concepts: clientMap,
      filePath: clientPath,
      allConcepts: mergeMaps(clientMap, mountMap, routeMap),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('/api/reviews/');
  });
});
