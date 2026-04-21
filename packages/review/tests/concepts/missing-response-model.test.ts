import type { ConceptMap, ConceptNode, EntrypointPayload } from '@kernlang/core';
import { missingResponseModel } from '../../src/concept-rules/missing-response-model.js';

function route(
  overrides: Omit<Partial<ConceptNode>, 'payload'> & { payload?: Partial<EntrypointPayload> } = {},
): ConceptNode {
  const { payload: payloadOverrides, ...nodeOverrides } = overrides;
  const payload: EntrypointPayload = {
    kind: 'entrypoint',
    subtype: 'route',
    name: '/api/users',
    httpMethod: 'GET',
    ...payloadOverrides,
  };

  return {
    id: 'app.py#entrypoint@1',
    kind: 'entrypoint',
    primarySpan: { file: 'app.py', startLine: 3, startCol: 1, endLine: 3, endCol: 30 },
    evidence: '@router.get("/api/users")',
    confidence: 1,
    language: 'py',
    payload,
    ...nodeOverrides,
  };
}

function map(nodes: ConceptNode[], fastApi = true): ConceptMap {
  return {
    filePath: 'app.py',
    language: 'py',
    extractorVersion: 'test',
    nodes,
    edges: fastApi
      ? [
          {
            id: 'app.py#dep@1',
            kind: 'dependency',
            sourceId: 'app.py',
            targetId: 'fastapi',
            primarySpan: { file: 'app.py', startLine: 1, startCol: 1, endLine: 1, endCol: 30 },
            evidence: 'from fastapi import APIRouter',
            confidence: 1,
            language: 'py',
            payload: { kind: 'dependency', subtype: 'external', specifier: 'fastapi' },
          },
        ]
      : [],
  };
}

describe('missing-response-model', () => {
  it('fires when a Python route has no responseModel', () => {
    const concepts = map([route()]);
    const findings = missingResponseModel({ concepts, filePath: 'app.py' });
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('missing-response-model');
    expect(findings[0].message).toContain('/api/users');
  });

  it('is silent when a Python route has responseModel', () => {
    const concepts = map([route({ payload: { responseModel: 'UserOut' } })]);
    expect(missingResponseModel({ concepts, filePath: 'app.py' })).toEqual([]);
  });

  it('is silent for Python routes when the file has no FastAPI evidence', () => {
    const concepts = map([route()], false);
    expect(missingResponseModel({ concepts, filePath: 'app.py' })).toEqual([]);
  });

  it('is silent for TypeScript routes because responseModel is a Python signal', () => {
    const concepts = map([
      route({
        language: 'ts',
        primarySpan: { file: 'server.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      }),
    ]);
    expect(missingResponseModel({ concepts, filePath: 'server.ts' })).toEqual([]);
  });

  it('is silent for route-mount concepts', () => {
    const concepts = map([route({ payload: { subtype: 'route-mount', name: '/api', routerName: 'router' } })]);
    expect(missingResponseModel({ concepts, filePath: 'app.py' })).toEqual([]);
  });

  it('is silent for non-route entrypoints', () => {
    const concepts = map([route({ payload: { subtype: 'main', name: 'main', httpMethod: undefined } })]);
    expect(missingResponseModel({ concepts, filePath: 'app.py' })).toEqual([]);
  });

  it('uses node confidence multiplied by the cross-stack heuristic', () => {
    const concepts = map([route({ confidence: 0.6 })]);
    const findings = missingResponseModel({ concepts, filePath: 'app.py' });
    expect(findings[0].confidence).toBeCloseTo(0.42);
  });

  it('emits one finding per route missing a responseModel', () => {
    const concepts = map([
      route({
        id: 'app.py#entrypoint@1',
        primarySpan: { file: 'app.py', startLine: 3, startCol: 1, endLine: 3, endCol: 30 },
        payload: { name: '/api/users' },
      }),
      route({
        id: 'app.py#entrypoint@2',
        primarySpan: { file: 'app.py', startLine: 7, startCol: 1, endLine: 7, endCol: 30 },
        payload: { name: '/api/posts' },
      }),
      route({
        id: 'app.py#entrypoint@3',
        primarySpan: { file: 'app.py', startLine: 11, startCol: 1, endLine: 11, endCol: 30 },
        payload: { name: '/api/me', responseModel: 'MeOut' },
      }),
    ]);

    const findings = missingResponseModel({ concepts, filePath: 'app.py' });
    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('/api/users'),
      expect.stringContaining('/api/posts'),
    ]);
  });

  it('keeps the route decorator as the primary span', () => {
    const concepts = map([
      route({ primarySpan: { file: 'app.py', startLine: 9, startCol: 5, endLine: 9, endCol: 40 } }),
    ]);
    const findings = missingResponseModel({ concepts, filePath: 'app.py' });
    expect(findings[0].primarySpan.startLine).toBe(9);
    expect(findings[0].primarySpan.startCol).toBe(5);
  });
});
