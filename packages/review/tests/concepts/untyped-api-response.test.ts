import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { untypedApiResponse } from '../../src/concept-rules/untyped-api-response.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

function conceptsOf(source: string, filePath: string): ConceptMap {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const sf = project.createSourceFile(filePath, source);
  return extractTsConcepts(sf, filePath);
}

function ctxFrom(files: Array<{ path: string; source: string }>, primary: string) {
  const allConcepts = new Map<string, ConceptMap>();
  for (const f of files) allConcepts.set(f.path, conceptsOf(f.source, f.path));
  const concepts = allConcepts.get(primary);
  if (!concepts) throw new Error(`primary file ${primary} not in allConcepts`);
  return { concepts, filePath: primary, allConcepts };
}

function ctxFromMaps(files: ConceptMap[], primary: string) {
  const allConcepts = new Map<string, ConceptMap>();
  for (const map of files) allConcepts.set(map.filePath, map);
  const concepts = allConcepts.get(primary);
  if (!concepts) throw new Error(`primary file ${primary} not in allConcepts`);
  return { concepts, filePath: primary, allConcepts };
}

function fastApiRoute(path: string, responseModel?: string): ConceptMap {
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

describe('untyped-api-response', () => {
  it('fires when an /api/ response is consumed with no type annotation and the server has the route', () => {
    const client = `
      async function loadUsers() {
        const data = await fetch('/api/users').then(r => r.json());
        return data;
      }
    `;
    const server = `app.get('/api/users', (req, res) => res.json([]));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    const findings = untypedApiResponse(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].ruleId).toBe('untyped-api-response');
    expect(findings[0].message).toContain('/api/users');
  });

  it('is silent when the consumer uses `as T` on the json result', () => {
    const client = `
      interface User { id: string }
      async function loadUsers() {
        const data = (await fetch('/api/users').then(r => r.json())) as User[];
        return data;
      }
    `;
    const server = `app.get('/api/users', (req, res) => res.json([]));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(untypedApiResponse(ctx)).toEqual([]);
  });

  it('is silent when the consumer declares the awaited value with a type annotation', () => {
    const client = `
      interface User { id: string }
      async function loadUsers() {
        const data: User[] = await fetch('/api/users').then(r => r.json());
        return data;
      }
    `;
    const server = `app.get('/api/users', (req, res) => res.json([]));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(untypedApiResponse(ctx)).toEqual([]);
  });

  it('is silent when the URL is not in the reviewed project (no matching server route)', () => {
    const client = `await fetch('/api/users').then(r => r.json());`;
    // Server has a DIFFERENT route — contract-drift catches the mismatch,
    // this rule stays out of the way so we don't double-fire.
    const server = `app.get('/api/posts', (req, res) => res.json([]));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(untypedApiResponse(ctx)).toEqual([]);
  });

  it('is silent when the matching FastAPI route has no response_model', () => {
    const client = conceptsOf(
      `
      async function loadUsers() {
        const data = await fetch('/api/users').then(r => r.json());
        return data;
      }
    `,
      'src/client.ts',
    );

    expect(untypedApiResponse(ctxFromMaps([client, fastApiRoute('/api/users')], 'src/client.ts'))).toEqual([]);
  });

  it('fires when the matching FastAPI route declares response_model', () => {
    const client = conceptsOf(
      `
      async function loadUsers() {
        const data = await fetch('/api/users').then(r => r.json());
        return data;
      }
    `,
      'src/client.ts',
    );

    const findings = untypedApiResponse(ctxFromMaps([client, fastApiRoute('/api/users', 'UserOut')], 'src/client.ts'));
    expect(findings).toHaveLength(1);
  });

  it('is silent when the URL is external (not /api/)', () => {
    const client = `await fetch('https://api.stripe.com/v1/charges').then(r => r.json());`;
    const server = `app.get('/api/users', (req, res) => res.json([]));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(untypedApiResponse(ctx)).toEqual([]);
  });

  it('returns no findings in single-file (non-graph) mode', () => {
    const client = `await fetch('/api/users').then(r => r.json());`;
    const concepts = conceptsOf(client, 'src/client.ts');
    expect(untypedApiResponse({ concepts, filePath: 'src/client.ts' })).toEqual([]);
  });

  it('fires on FastAPI-style {id} routes when client path is untyped', () => {
    // Landing the await in a variable declaration gives the mapper the
    // assertion-free signal it needs (statement-level fire-and-forget would
    // return `undefined` from the mapper, which the rule intentionally
    // suppresses to avoid firing on discarded responses).
    const client = `
      async function loadUser() {
        const user = await fetch('/api/users/42').then(r => r.json());
        return user;
      }
    `;
    const server = `app.get('/api/users/{id}', (req, res) => res.json({}));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    const findings = untypedApiResponse(ctx);
    expect(findings.length).toBe(1);
  });

  it('stays silent on discarded responses (no variable, no .then consumer)', () => {
    // `await fetch(url).then(r => r.json());` at statement level throws the
    // result away. There is no "consumer" to be untyped — mapper returns
    // `undefined`, rule suppresses. Contract-drift would still fire on URL
    // drift, but untyped-api-response should not double-warn here.
    const client = `
      async function ping() {
        await fetch('/api/users').then(r => r.json());
      }
    `;
    const server = `app.get('/api/users', (req, res) => res.json([]));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(untypedApiResponse(ctx)).toEqual([]);
  });

  it('does not fire on the split fetch + typed .json() pattern (codex regression on 550a57ec)', () => {
    // Before the mapper fix, this emitted responseAsserted=false on the
    // raw Response variable because `const res` has no annotation. That is
    // a false positive: the payload IS typed, just on the next line.
    const client = `
      interface User { id: string }
      async function loadUsers() {
        const res = await fetch('/api/users');
        const data: User[] = await res.json();
        return data;
      }
    `;
    const server = `app.get('/api/users', (req, res) => res.json([]));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(untypedApiResponse(ctx)).toEqual([]);
  });

  it('still stays silent on split fetch + untyped .json() (responseAsserted undefined, rule suppressed)', () => {
    // Related to the split-pattern fix above: without cross-variable
    // dataflow the mapper returns `undefined` for the Response's eventual
    // consumption. The rule treats undefined as "can't tell" and stays
    // quiet rather than fire a questionable finding.
    const client = `
      async function loadUsers() {
        const res = await fetch('/api/users');
        const data = await res.json();
        return data;
      }
    `;
    const server = `app.get('/api/users', (req, res) => res.json([]));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(untypedApiResponse(ctx)).toEqual([]);
  });

  it('treats .then callbacks that do not call .json() as non-payload consumers', () => {
    // A `.then(r => r.status)` chain doesn't parse JSON, so the mapper
    // must NOT mark the outer Promise<number> consumer as untyped-JSON.
    const client = `
      async function getStatus() {
        const code = await fetch('/api/users').then(r => r.status);
        return code;
      }
    `;
    const server = `app.get('/api/users', (req, res) => res.json([]));`;
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: client },
        { path: 'src/server.ts', source: server },
      ],
      'src/client.ts',
    );
    expect(untypedApiResponse(ctx)).toEqual([]);
  });
});
