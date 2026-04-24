import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { mutationWithoutIdempotency } from '../../src/concept-rules/mutation-without-idempotency.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

function conceptsOf(source: string, filePath: string): ConceptMap {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  return extractTsConcepts(project.createSourceFile(filePath, source), filePath);
}

function conceptsFromProject(files: Array<{ path: string; source: string }>, primary: string): ConceptMap {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  for (const file of files) project.createSourceFile(file.path, file.source);
  return extractTsConcepts(project.getSourceFileOrThrow(primary), primary);
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

  it('fires when a POST route uses a same-file named handler that writes to the DB', () => {
    const concepts = conceptsOf(
      `
        async function createOrder(req, res) {
          const order = await prisma.order.create({ data: req.body });
          res.json(order);
        }
        app.post('/api/orders', createOrder);
      `,
      'src/server.ts',
    );

    const findings = mutationWithoutIdempotency({ concepts, filePath: 'src/server.ts' });
    expect(findings).toHaveLength(1);
  });

  it('fires when a POST route uses an imported named handler that writes to the DB', () => {
    const concepts = conceptsFromProject(
      [
        {
          path: 'src/server.ts',
          source: `
            import { createOrder } from './handlers.js';
            app.post('/api/orders', createOrder);
          `,
        },
        {
          path: 'src/handlers.ts',
          source: `
            export async function createOrder(req, res) {
              const order = await prisma.order.create({ data: req.body });
              res.json(order);
            }
          `,
        },
      ],
      'src/server.ts',
    );

    const findings = mutationWithoutIdempotency({ concepts, filePath: 'src/server.ts' });
    expect(findings).toHaveLength(1);
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
