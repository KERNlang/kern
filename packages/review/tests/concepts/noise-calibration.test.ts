import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { runConceptRules } from '../../src/concept-rules/index.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';
import { extractPythonConceptsFallback } from '../../src/python-fallback.js';

const NEW_RULE_IDS = new Set([
  'unhandled-api-error-shape',
  'auth-propagation-drift',
  'unbounded-collection-query',
  'mutation-without-idempotency',
  'request-validation-drift',
]);

function tsConceptsOf(source: string, filePath: string): ConceptMap {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  return extractTsConcepts(project.createSourceFile(filePath, source), filePath);
}

function findingsFor(files: ConceptMap[], crossStackMode: 'guard' | 'audit' = 'guard') {
  const allConcepts = new Map<string, ConceptMap>();
  for (const map of files) allConcepts.set(map.filePath, map);
  return files.flatMap((map) => runConceptRules(map, map.filePath, allConcepts, undefined, { crossStackMode }));
}

function newRuleIds(findings: Array<{ ruleId: string }>): string[] {
  return findings.map((finding) => finding.ruleId).filter((ruleId) => NEW_RULE_IDS.has(ruleId));
}

describe('new cross-stack rule noise calibration', () => {
  it('stays silent on a healthy Express app with auth, errors, pagination, validation, and idempotency', () => {
    const client = tsConceptsOf(
      `
        async function parseApi(response: Response) {
          if (!response.ok) throw new Error('api failed');
          return response.json();
        }

        export async function loadMe(token: string) {
          return parseApi(await fetch('/api/me', {
            headers: { Authorization: 'Bearer ' + token },
          }));
        }

        export async function loadUsers() {
          return parseApi(await fetch('/api/users?limit=25'));
        }

        export async function createOrder(token: string, sku: string) {
          return parseApi(await fetch('/api/orders', {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), sku }),
          }));
        }
      `,
      'src/client.ts',
    );

    const server = tsConceptsOf(
      `
        app.get('/api/me', (req, res) => {
          if (!req.user) return res.status(401).json({ error: 'unauthorized' });
          res.json({ id: req.user.id });
        });

        app.get('/api/users', async (req, res) => {
          const limit = Number(req.query.limit ?? 25);
          const users = await prisma.user.findMany({ take: limit });
          res.json(users);
        });

        app.post(
          '/api/orders',
          body('idempotencyKey').isString(),
          body('sku').isString(),
          async (req, res) => {
            const existing = await prisma.order.findUnique({
              where: { idempotencyKey: req.body.idempotencyKey },
            });
            if (existing) return res.json(existing);
            const order = await prisma.order.create({
              data: { idempotencyKey: req.body.idempotencyKey, sku: req.body.sku },
            });
            res.status(201).json(order);
          },
        );
      `,
      'src/server.ts',
    );

    expect(newRuleIds(findingsFor([client, server]))).toEqual([]);
  });

  it('stays silent on a healthy FastAPI app with Pydantic validation and bounded list queries', () => {
    const client = tsConceptsOf(
      `
        async function parseApi(response: Response) {
          if (!response.ok) throw new Error('api failed');
          return response.json();
        }

        export async function loadUsers() {
          return parseApi(await fetch('/api/fastapi/users?limit=25'));
        }

        export async function createOrder(token: string, sku: string) {
          return parseApi(await fetch('/api/fastapi/orders', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token },
            body: JSON.stringify({ idempotency_key: crypto.randomUUID(), sku }),
          }));
        }
      `,
      'src/fastapi-client.ts',
    );

    const server = extractPythonConceptsFallback(
      `
from pydantic import BaseModel

class OrderCreate(BaseModel):
    idempotency_key: str
    sku: str

@router.get("/api/fastapi/users")
def list_users(limit: int = 25):
    return db.users.find().limit(limit)

@router.post("/api/fastapi/orders")
def create_order(payload: OrderCreate):
    existing = db.orders.find_one({"idempotency_key": payload.idempotency_key})
    if existing:
        return existing
    return db.orders.insert_one(payload.model_dump())
      `,
      'app/api/orders.py',
    );

    expect(newRuleIds(findingsFor([client, server]))).toEqual([]);
  });

  it('lets older owner rules suppress newer overlapping findings at the same call span', () => {
    const client = tsConceptsOf(
      `
        export async function loadMe() {
          return fetch('/api/me').then((response) => response.json());
        }
      `,
      'src/client.ts',
    );
    const server = tsConceptsOf(
      `
        app.get('/api/me', (req, res) => {
          if (!req.user) return res.status(401).json({ error: 'unauthorized' });
          res.json({ id: req.user.id });
        });
      `,
      'src/server.ts',
    );

    const ruleIds = findingsFor([client, server]).map((finding) => finding.ruleId);
    expect(ruleIds).toContain('auth-drift');
    expect(ruleIds).not.toContain('unhandled-api-error-shape');
  });

  it('keeps overlapping findings in audit mode for deeper local investigation', () => {
    const client = tsConceptsOf(
      `
        export async function loadMe() {
          return fetch('/api/me').then((response) => response.json());
        }
      `,
      'src/client.ts',
    );
    const server = tsConceptsOf(
      `
        app.get('/api/me', (req, res) => {
          if (!req.user) return res.status(401).json({ error: 'unauthorized' });
          res.json({ id: req.user.id });
        });
      `,
      'src/server.ts',
    );

    const ruleIds = findingsFor([client, server], 'audit').map((finding) => finding.ruleId);
    expect(ruleIds).toContain('auth-drift');
    expect(ruleIds).toContain('unhandled-api-error-shape');
  });
});
