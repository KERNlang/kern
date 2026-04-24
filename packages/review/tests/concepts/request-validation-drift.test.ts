import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { requestValidationDrift } from '../../src/concept-rules/request-validation-drift.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';
import { extractPythonConceptsFallback } from '../../src/python-fallback.js';

function conceptsOf(source: string, filePath: string): ConceptMap {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  return extractTsConcepts(project.createSourceFile(filePath, source), filePath);
}

function ctxFrom(files: Array<{ path: string; source: string }>, primary: string) {
  const allConcepts = new Map<string, ConceptMap>();
  for (const file of files) allConcepts.set(file.path, conceptsOf(file.source, file.path));
  const concepts = allConcepts.get(primary);
  if (!concepts) throw new Error(`missing ${primary}`);
  return { concepts, filePath: primary, allConcepts };
}

function ctxFromMaps(files: ConceptMap[], primary: string) {
  const allConcepts = new Map<string, ConceptMap>();
  for (const map of files) allConcepts.set(map.filePath, map);
  const concepts = allConcepts.get(primary);
  if (!concepts) throw new Error(`missing ${primary}`);
  return { concepts, filePath: primary, allConcepts };
}

describe('request-validation-drift', () => {
  it('fires when a DB-writing route reads req.body fields without validation', () => {
    const concepts = conceptsOf(
      `
        app.post('/api/users', async (req, res) => {
          const { email, name } = req.body;
          const user = await prisma.user.create({ data: { email, name } });
          res.json(user);
        });
      `,
      'src/server.ts',
    );

    const findings = requestValidationDrift({ concepts, filePath: 'src/server.ts' });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('email');
  });

  it('fires when the client sends a field outside the backend validator schema', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function createUser(email: string, role: string) {
              await fetch('/api/users', {
                method: 'POST',
                body: JSON.stringify({ email, role }),
              });
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.post('/api/users', body('email').isEmail(), async (req, res) => {
              const { email } = req.body;
              const user = await prisma.user.create({ data: { email } });
              res.json(user);
            });
          `,
        },
      ],
      'src/client.ts',
    );

    const findings = requestValidationDrift(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('role');
  });

  it('is silent when the client payload matches the resolved backend validator fields', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function createUser(email: string) {
              await fetch('/api/users', { method: 'POST', body: JSON.stringify({ email }) });
            }
          `,
        },
        {
          path: 'src/server.ts',
          source: `
            app.post('/api/users', body('email').isEmail(), async (req, res) => {
              const { email } = req.body;
              const user = await prisma.user.create({ data: { email } });
              res.json(user);
            });
          `,
        },
      ],
      'src/client.ts',
    );

    expect(requestValidationDrift(ctx)).toEqual([]);
  });

  it('uses Python fallback Pydantic fields for client/server validation drift', () => {
    const client = conceptsOf(
      `
        async function createUser(email: string, role: string) {
          await fetch('/api/users', {
            method: 'POST',
            body: JSON.stringify({ email, role }),
          });
        }
      `,
      'src/client.ts',
    );
    const server = extractPythonConceptsFallback(
      `
from pydantic import BaseModel

class UserCreate(BaseModel):
    email: str

@router.post("/api/users")
def create_user(payload: UserCreate):
    db.user.create(payload.model_dump())
    return payload
      `,
      'app/api/users.py',
    );

    const findings = requestValidationDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('role');
  });

  it('is silent when duplicate graph routes make the backend partner ambiguous', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            async function createUser(email: string, role: string) {
              await fetch('/api/users', {
                method: 'POST',
                body: JSON.stringify({ email, role }),
              });
            }
          `,
        },
        {
          path: 'src/server-a.ts',
          source: `
            app.post('/api/users', body('email').isEmail(), async (req, res) => {
              const user = await prisma.user.create({ data: { email: req.body.email } });
              res.json(user);
            });
          `,
        },
        {
          path: 'src/server-b.ts',
          source: `
            app.post('/api/users', body('email').isEmail(), async (req, res) => {
              const user = await prisma.user.create({ data: { email: req.body.email } });
              res.json(user);
            });
          `,
        },
      ],
      'src/client.ts',
    );

    expect(requestValidationDrift(ctx)).toEqual([]);
  });
});
