import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { paramNameSwap } from '../../src/concept-rules/param-name-swap.js';
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

function pyRoute(filePath: string, path: string, method = 'GET'): ConceptMap {
  return {
    filePath,
    language: 'py',
    extractorVersion: '1.0.0',
    nodes: [
      {
        id: `${filePath}#ep@1`,
        kind: 'entrypoint',
        primarySpan: { file: filePath, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        evidence: `@router.${method.toLowerCase()}("${path}")`,
        confidence: 1,
        language: 'py',
        payload: { kind: 'entrypoint', subtype: 'route', name: path, httpMethod: method, routerName: 'router' },
      },
    ],
    edges: [],
  };
}

describe('param-name-swap', () => {
  it('fires when client and server have the same path shape but a named param swaps position', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const clientPath = '/client/api.ts';
    const clientSrc = `
      async function load(userId: string, postId: number) {
        await fetch(\`/api/users/\${userId}/posts/\${postId}\`);
      }
    `;
    const clientMap = extractTsConcepts(project.createSourceFile(clientPath, clientSrc), clientPath);
    const all = mergeMaps(clientMap, pyRoute('/server/api.py', '/api/users/{postId}/posts/{userId}'));
    const findings = paramNameSwap({ concepts: clientMap, filePath: clientPath, allConcepts: all });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/userId/);
    // `/api/users/:userId/posts/:postId` → segments 4 (userId) and 6 (postId)
    expect(findings[0].message).toMatch(/position 4.*position 6/s);
  });

  it('is silent when client and server path params align positionally', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const clientPath = '/client/api.ts';
    const clientSrc = `
      async function load(userId: string, postId: number) {
        await fetch(\`/api/users/\${userId}/posts/\${postId}\`);
      }
    `;
    const clientMap = extractTsConcepts(project.createSourceFile(clientPath, clientSrc), clientPath);
    const all = mergeMaps(clientMap, pyRoute('/server/api.py', '/api/users/{userId}/posts/{postId}'));
    const findings = paramNameSwap({ concepts: clientMap, filePath: clientPath, allConcepts: all });
    expect(findings).toHaveLength(0);
  });

  it('is silent when param names simply differ without a swap', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const clientPath = '/client/api.ts';
    const clientSrc = `
      async function load(id: string) {
        await fetch(\`/api/users/\${id}\`);
      }
    `;
    const clientMap = extractTsConcepts(project.createSourceFile(clientPath, clientSrc), clientPath);
    const all = mergeMaps(clientMap, pyRoute('/server/api.py', '/api/users/{userId}'));
    const findings = paramNameSwap({ concepts: clientMap, filePath: clientPath, allConcepts: all });
    expect(findings).toHaveLength(0);
  });

  it('is silent when paths have different segment counts (contract-drift territory)', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const clientPath = '/client/api.ts';
    const clientSrc = `
      async function load(id: string) {
        await fetch(\`/api/users/\${id}\`);
      }
    `;
    const clientMap = extractTsConcepts(project.createSourceFile(clientPath, clientSrc), clientPath);
    const all = mergeMaps(clientMap, pyRoute('/server/api.py', '/api/users/{userId}/profile'));
    const findings = paramNameSwap({ concepts: clientMap, filePath: clientPath, allConcepts: all });
    expect(findings).toHaveLength(0);
  });

  it('fires on an Express route with the swap (via route-mount join)', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const clientPath = '/client/api.ts';
    const clientSrc = `
      async function load(userId: string, postId: number) {
        await fetch(\`/api/users/\${userId}/posts/\${postId}\`);
      }
    `;
    const mountPath = '/server/src/index.ts';
    const mountSrc = `
      import express from 'express';
      import usersRoutes from './routes/users.js';
      const app = express();
      app.use('/api/users', usersRoutes);
    `;
    const routePath = '/server/src/routes/users.ts';
    const routeSrc = `
      import { Router } from 'express';
      const router = Router();
      router.get('/:postId/posts/:userId', (req, res) => res.json({}));
      export default router;
    `;
    const clientMap = extractTsConcepts(project.createSourceFile(clientPath, clientSrc), clientPath);
    const mountMap = extractTsConcepts(project.createSourceFile(mountPath, mountSrc), mountPath);
    const routeMap = extractTsConcepts(project.createSourceFile(routePath, routeSrc), routePath);
    const findings = paramNameSwap({
      concepts: clientMap,
      filePath: clientPath,
      allConcepts: mergeMaps(clientMap, mountMap, routeMap),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/userId|postId/);
  });
});
