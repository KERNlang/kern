import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { contractDrift } from '../../src/concept-rules/contract-drift.js';
import { collectRoutesAcrossGraph } from '../../src/concept-rules/cross-stack-utils.js';
import { untypedApiResponse } from '../../src/concept-rules/untyped-api-response.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

// Python concept maps are built by hand here to avoid dragging the native
// tree-sitter build into unit tests (the review-python package is exercised
// end-to-end elsewhere). The shape mirrors what `@kernlang/review-python`
// emits after the 2026-04-21 mapper update.

function pythonRoute(filePath: string, path: string, method: string, routerName: string, startIndex = 1): ConceptMap {
  return {
    filePath,
    language: 'py',
    extractorVersion: '1.0.0',
    nodes: [
      {
        id: `${filePath}#entrypoint@${startIndex}`,
        kind: 'entrypoint',
        primarySpan: { file: filePath, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        evidence: `@${routerName}.${method.toLowerCase()}("${path}")`,
        confidence: 1,
        language: 'py',
        payload: { kind: 'entrypoint', subtype: 'route', name: path, httpMethod: method, routerName },
      },
    ],
    edges: [],
  };
}

function pythonMount(
  filePath: string,
  prefix: string,
  routerName: string,
  sourceModule?: string,
  startIndex = 1,
): ConceptMap {
  return {
    filePath,
    language: 'py',
    extractorVersion: '1.0.0',
    nodes: [
      {
        id: `${filePath}#entrypoint@${startIndex}`,
        kind: 'entrypoint',
        primarySpan: { file: filePath, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        evidence: `app.include_router(${sourceModule ? `${sourceModule.split('.').pop()}.${routerName}` : routerName}, prefix="${prefix}")`,
        confidence: 0.95,
        language: 'py',
        payload: { kind: 'entrypoint', subtype: 'route-mount', name: prefix, routerName, sourceModule },
      },
    ],
    edges: [],
  };
}

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

describe('FastAPI router-prefix expansion', () => {
  it('joins @router.get("/current") with include_router(prefix="/api/nutrition-goals")', () => {
    const all = mergeMaps(
      pythonRoute('app/api/nutrition_goals.py', '/current', 'GET', 'router'),
      pythonMount('app/main.py', '/api/nutrition-goals', 'router', 'app.api.nutrition_goals'),
    );
    const routes = collectRoutesAcrossGraph(all);
    expect(routes.map((r) => r.path)).toEqual(['/api/nutrition-goals/current']);
    expect(routes[0].method).toBe('GET');
  });

  it('handles an empty prefix (include_router without prefix=)', () => {
    const all = mergeMaps(
      pythonRoute('app/api/health.py', '/healthz', 'GET', 'router'),
      pythonMount('app/main.py', '', 'router', 'app.api.health'),
    );
    const routes = collectRoutesAcrossGraph(all);
    expect(routes.map((r) => r.path)).toEqual(['/healthz']);
  });

  it('preserves path-only routes when no matching mount exists (Flask-style)', () => {
    const all = mergeMaps(pythonRoute('app/api/standalone.py', '/api/x', 'GET', 'app'));
    const routes = collectRoutesAcrossGraph(all);
    expect(routes.map((r) => r.path)).toEqual(['/api/x']);
  });

  it('joins a same-file mount (router = APIRouter(); app.include_router(router, prefix=…))', () => {
    const all = mergeMaps(
      pythonRoute('app/single.py', '/current', 'GET', 'router'),
      pythonMount('app/single.py', '/api/single', 'router'),
    );
    const routes = collectRoutesAcrossGraph(all);
    expect(routes.map((r) => r.path)).toEqual(['/api/single/current']);
  });

  it('contract-drift fires when frontend URL misses the prefixed backend route', () => {
    // Frontend calls /api/nutrition/goals but backend is mounted at
    // /api/nutrition-goals — a realistic prefix-typo drift.
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const clientPath = 'src/features/nutrition.ts';
    const frontend = `
      import { apiClient } from '@/src/api/client';
      async function loadGoals() {
        const res = await apiClient.get<{ target: number }>('/api/nutrition/goals');
        return res;
      }
    `;
    const clientMap = extractTsConcepts(project.createSourceFile(clientPath, frontend), clientPath);
    const all = mergeMaps(
      clientMap,
      pythonRoute('app/api/nutrition_goals.py', '/current', 'GET', 'router'),
      pythonMount('app/main.py', '/api/nutrition-goals', 'router', 'app.api.nutrition_goals'),
    );
    const findings = contractDrift({ concepts: clientMap, filePath: clientPath, allConcepts: all });
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('/api/nutrition/goals');
  });

  it('contract-drift is silent when the frontend URL matches the full prefixed path', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const clientPath = 'src/features/nutrition.ts';
    const frontend = `
      import { apiClient } from '@/src/api/client';
      async function loadGoals() {
        await apiClient.get<{ target: number }>('/api/nutrition-goals/current');
      }
    `;
    const clientMap = extractTsConcepts(project.createSourceFile(clientPath, frontend), clientPath);
    const all = mergeMaps(
      clientMap,
      pythonRoute('app/api/nutrition_goals.py', '/current', 'GET', 'router'),
      pythonMount('app/main.py', '/api/nutrition-goals', 'router', 'app.api.nutrition_goals'),
    );
    const findings = contractDrift({ concepts: clientMap, filePath: clientPath, allConcepts: all });
    expect(findings).toHaveLength(0);
  });

  it('untyped-api-response fires on an untyped wrapped call against a prefixed FastAPI route', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const clientPath = 'src/features/nutrition.ts';
    const frontend = `
      import { apiClient } from '@/src/api/client';
      async function loadGoals() {
        const res = await apiClient.get('/api/nutrition-goals/current');
        return res;
      }
    `;
    const clientMap = extractTsConcepts(project.createSourceFile(clientPath, frontend), clientPath);
    const all = mergeMaps(
      clientMap,
      pythonRoute('app/api/nutrition_goals.py', '/current', 'GET', 'router'),
      pythonMount('app/main.py', '/api/nutrition-goals', 'router', 'app.api.nutrition_goals'),
    );
    const findings = untypedApiResponse({ concepts: clientMap, filePath: clientPath, allConcepts: all });
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('/api/nutrition-goals/current');
  });
});
