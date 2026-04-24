import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { mutationWithoutIdempotency } from '../../src/concept-rules/mutation-without-idempotency.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

function conceptsOf(source: string, filePath: string): ConceptMap {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  return extractTsConcepts(project.createSourceFile(filePath, source), filePath);
}

describe('mutation-without-idempotency', () => {
  it('fires when a POST route writes to the DB without duplicate protection evidence', () => {
    const concepts = conceptsOf(
      `
        app.post('/api/orders', async (req, res) => {
          const order = await prisma.order.create({ data: req.body });
          res.json(order);
        });
      `,
      'src/server.ts',
    );

    const findings = mutationWithoutIdempotency({ concepts, filePath: 'src/server.ts' });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('POST /api/orders');
  });

  it('is silent when the route has unique/idempotency evidence', () => {
    const concepts = conceptsOf(
      `
        app.post('/api/orders', async (req, res) => {
          const existing = await prisma.order.findUnique({ where: { idempotencyKey: req.header('Idempotency-Key') } });
          if (existing) return res.json(existing);
          const order = await prisma.order.create({ data: req.body });
          res.json(order);
        });
      `,
      'src/server.ts',
    );

    expect(mutationWithoutIdempotency({ concepts, filePath: 'src/server.ts' })).toEqual([]);
  });

  it('is silent for PATCH routes in the low-noise release gate', () => {
    const concepts = conceptsOf(
      `
        app.patch('/api/orders/:id', async (req, res) => {
          const order = await prisma.order.update({ where: { id: req.params.id }, data: req.body });
          res.json(order);
        });
      `,
      'src/server.ts',
    );

    expect(mutationWithoutIdempotency({ concepts, filePath: 'src/server.ts' })).toEqual([]);
  });

  it('fires for PATCH routes in audit mode', () => {
    const concepts = conceptsOf(
      `
        app.patch('/api/orders/:id', async (req, res) => {
          const order = await prisma.order.update({ where: { id: req.params.id }, data: req.body });
          res.json(order);
        });
      `,
      'src/server.ts',
    );

    const findings = mutationWithoutIdempotency({ concepts, filePath: 'src/server.ts', crossStackMode: 'audit' });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('PATCH /api/orders/:id');
  });
});
