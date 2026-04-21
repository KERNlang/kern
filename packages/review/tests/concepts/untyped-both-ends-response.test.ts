import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { untypedBothEndsResponse } from '../../src/concept-rules/untyped-both-ends-response.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

function conceptsOf(source: string, filePath: string): ConceptMap {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  return extractTsConcepts(project.createSourceFile(filePath, source), filePath);
}

function pythonRoute(path: string, responseModel?: string): ConceptMap {
  return {
    filePath: 'app/api/users.py',
    language: 'py',
    extractorVersion: 'test',
    nodes: [
      {
        id: 'app/api/users.py#entrypoint@1',
        kind: 'entrypoint',
        primarySpan: { file: 'app/api/users.py', startLine: 4, startCol: 1, endLine: 4, endCol: 30 },
        evidence: `@router.get("${path}")`,
        confidence: 1,
        language: 'py',
        payload: { kind: 'entrypoint', subtype: 'route', name: path, httpMethod: 'GET', responseModel },
      },
    ],
    edges: [
      {
        id: 'app/api/users.py#dep@1',
        kind: 'dependency',
        sourceId: 'app/api/users.py',
        targetId: 'fastapi',
        primarySpan: { file: 'app/api/users.py', startLine: 1, startCol: 1, endLine: 1, endCol: 30 },
        evidence: 'from fastapi import APIRouter',
        confidence: 1,
        language: 'py',
        payload: { kind: 'dependency', subtype: 'external', specifier: 'fastapi' },
      },
    ],
  };
}

function flaskRoute(path: string): ConceptMap {
  return { ...pythonRoute(path), edges: [] };
}

function ctxFrom(files: ConceptMap[], primary: string) {
  const allConcepts = new Map<string, ConceptMap>();
  for (const map of files) allConcepts.set(map.filePath, map);
  const concepts = allConcepts.get(primary);
  if (!concepts) throw new Error(`primary file ${primary} not in allConcepts`);
  return { concepts, filePath: primary, allConcepts };
}

describe('untyped-both-ends-response', () => {
  it('fires when client response consumption and matching Python route are both untyped', () => {
    const client = conceptsOf(
      `
      async function loadUsers() {
        const data = await fetch('/api/users').then(r => r.json());
        return data;
      }
    `,
      'src/client.ts',
    );

    const findings = untypedBothEndsResponse(ctxFrom([client, pythonRoute('/api/users')], 'src/client.ts'));
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('untyped-both-ends-response');
    expect(findings[0].relatedSpans?.[0].file).toBe('app/api/users.py');
  });

  it('is silent when the Python route declares responseModel', () => {
    const client = conceptsOf(
      `
      async function loadUsers() {
        const data = await fetch('/api/users').then(r => r.json());
        return data;
      }
    `,
      'src/client.ts',
    );

    expect(untypedBothEndsResponse(ctxFrom([client, pythonRoute('/api/users', 'UserOut')], 'src/client.ts'))).toEqual(
      [],
    );
  });

  it('is silent when the matching Python route is not a FastAPI route', () => {
    const client = conceptsOf(
      `
      async function loadUsers() {
        const data = await fetch('/api/users').then(r => r.json());
        return data;
      }
    `,
      'src/client.ts',
    );

    expect(untypedBothEndsResponse(ctxFrom([client, flaskRoute('/api/users')], 'src/client.ts'))).toEqual([]);
  });

  it('is silent when the client asserts the response type', () => {
    const client = conceptsOf(
      `
      interface User { id: string }
      async function loadUsers() {
        const data = (await fetch('/api/users').then(r => r.json())) as User[];
        return data;
      }
    `,
      'src/client.ts',
    );

    expect(untypedBothEndsResponse(ctxFrom([client, pythonRoute('/api/users')], 'src/client.ts'))).toEqual([]);
  });

  it('is silent when no backend route matches the client path', () => {
    const client = conceptsOf(
      `
      async function loadUsers() {
        const data = await fetch('/api/users').then(r => r.json());
        return data;
      }
    `,
      'src/client.ts',
    );

    expect(untypedBothEndsResponse(ctxFrom([client, pythonRoute('/api/posts')], 'src/client.ts'))).toEqual([]);
  });
});
