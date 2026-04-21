import type { ConceptMap, EffectPayload } from '@kernlang/core';
import { Project } from 'ts-morph';
import { contractDrift } from '../../src/concept-rules/contract-drift.js';
import { untypedApiResponse } from '../../src/concept-rules/untyped-api-response.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

function conceptsOf(source: string, filePath = 'src/test.ts'): ConceptMap {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const sf = project.createSourceFile(filePath, source);
  return extractTsConcepts(sf, filePath);
}

function networkEffects(map: ConceptMap) {
  return map.nodes
    .filter((n) => n.kind === 'effect' && (n.payload as EffectPayload).subtype === 'network')
    .map((n) => n.payload as EffectPayload);
}

describe('wrapped-client effects', () => {
  it('recognizes a local class-based wrapper where methods call fetch', () => {
    const source = `
      class ApiClient {
        async request<T>(path: string, init?: RequestInit): Promise<T> {
          const res = await fetch('https://api.example.com' + path, init);
          return res.json();
        }
        get<T>(path: string) { return this.request<T>(path); }
        post<T>(path: string, body?: unknown) { return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) }); }
      }
      const api = new ApiClient();
      async function run() {
        await api.get<{ id: number }>('/api/users/1');
        await api.post<{ ok: boolean }>('/api/users', { name: 'x' });
      }
    `;
    const map = conceptsOf(source);
    const effects = networkEffects(map);
    // Expect: 1 fetch (inside request) + 2 wrapped-client calls.
    const targets = effects.map((e) => e.target).filter(Boolean);
    expect(targets).toEqual(expect.arrayContaining(['/api/users/1', '/api/users']));
    const wrapped = effects.filter((e) => e.target?.startsWith('/api/'));
    expect(wrapped).toHaveLength(2);
    // Generic type args flip responseAsserted to true.
    expect(wrapped.every((e) => e.responseAsserted === true)).toBe(true);
  });

  it('recognizes an imported apiClient from a local path', () => {
    const source = `
      import { apiClient } from './api/client';
      async function loadFoods() {
        const res = await apiClient.get<{ items: string[] }>('/api/nutrition/foods');
        return res;
      }
    `;
    const map = conceptsOf(source, 'src/features/nutrition.ts');
    const effects = networkEffects(map);
    expect(effects).toHaveLength(1);
    expect(effects[0].target).toBe('/api/nutrition/foods');
    expect(effects[0].responseAsserted).toBe(true);
  });

  it('recognizes apiClient imported via @/ alias', () => {
    const source = `
      import { apiClient } from '@/src/api/client';
      async function save(goal: { target: number }) {
        await apiClient.put<{ ok: boolean }>('/api/progress/goals', goal);
      }
    `;
    const map = conceptsOf(source, 'src/features/progress.ts');
    const effects = networkEffects(map);
    expect(effects).toHaveLength(1);
    expect(effects[0].target).toBe('/api/progress/goals');
    expect(effects[0].bodyKind).toBe('dynamic');
    expect(effects[0].responseAsserted).toBe(true);
  });

  it('recognizes an axios.create() instance as a client', () => {
    const source = `
      import axios from 'axios';
      const http = axios.create({ baseURL: '/' });
      async function signup(formData: { email: string }) {
        await http.post('/api/signup', formData);
      }
    `;
    const map = conceptsOf(source);
    const effects = networkEffects(map);
    const signup = effects.find((e) => e.target === '/api/signup');
    expect(signup).toBeDefined();
    expect(signup?.bodyKind).toBe('dynamic');
  });

  it('does not treat third-party imports as clients even if the name matches', () => {
    const source = `
      import { client } from 'some-third-party-lib';
      async function run() {
        await client.get('/api/x');
      }
    `;
    const map = conceptsOf(source);
    const effects = networkEffects(map);
    expect(effects).toHaveLength(0);
  });

  it('does not fire on method calls that do not match CLIENT_HTTP_METHODS', () => {
    const source = `
      import { apiClient } from './client';
      async function run() {
        apiClient.setBaseUrl('/api');
        apiClient.configure({ timeout: 1000 });
      }
    `;
    const map = conceptsOf(source);
    const effects = networkEffects(map);
    expect(effects).toHaveLength(0);
  });

  it('classifies wrapped POST with a variable body as dynamic', () => {
    const source = `
      import { apiClient } from './client';
      async function submit(formData: { email: string }) {
        await apiClient.post('/api/signup', formData);
      }
    `;
    const map = conceptsOf(source);
    const effects = networkEffects(map);
    expect(effects).toHaveLength(1);
    expect(effects[0].bodyKind).toBe('dynamic');
  });

  it('classifies wrapped POST with a static object body as static', () => {
    const source = `
      import { apiClient } from './client';
      async function ping() {
        await apiClient.post('/api/ping', { msg: 'hello' });
      }
    `;
    const map = conceptsOf(source);
    const effects = networkEffects(map);
    expect(effects).toHaveLength(1);
    expect(effects[0].bodyKind).toBe('static');
  });

  it('leaves responseAsserted undefined when no generic type arg and no .json consumption', () => {
    const source = `
      import { apiClient } from './client';
      async function run() {
        await apiClient.get('/api/users');
      }
    `;
    const map = conceptsOf(source);
    const effects = networkEffects(map);
    expect(effects).toHaveLength(1);
    expect(effects[0].responseAsserted).toBe(undefined);
  });

  it('treats imported HttpClient-suffix names as clients', () => {
    const source = `
      import { MyApiClient } from './api';
      async function run() {
        await MyApiClient.get<string[]>('/api/list');
      }
    `;
    const map = conceptsOf(source);
    const effects = networkEffects(map);
    expect(effects).toHaveLength(1);
    expect(effects[0].target).toBe('/api/list');
  });

  // ── End-to-end: wedge rules fire on wrapped-client codebases ──────────
  // This is the actual pitch-demo scenario. Before the mapper fix the rules
  // silently found nothing on ~75% of real apps; these tests lock in that
  // the rules now light up.

  it('contract-drift fires on a wrapped-client call with no matching server route', () => {
    const frontend = `
      import { apiClient } from '@/src/api/client';
      async function loadFoods() {
        const res = await apiClient.get<{ items: string[] }>('/api/nutrition/foods');
        return res;
      }
    `;
    const server = `
      // Only an unrelated route — /api/nutrition/foods drifted away.
      app.get('/api/users', (req, res) => res.json({}));
    `;
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const clientPath = 'src/features/nutrition.ts';
    const serverPath = 'src/server.ts';
    const clientMap = extractTsConcepts(project.createSourceFile(clientPath, frontend), clientPath);
    const serverMap = extractTsConcepts(project.createSourceFile(serverPath, server), serverPath);
    const allConcepts = new Map([
      [clientPath, clientMap],
      [serverPath, serverMap],
    ]);
    const findings = contractDrift({ concepts: clientMap, filePath: clientPath, allConcepts });
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('/api/nutrition/foods');
  });

  it('untyped-api-response stays silent on generic-typed wrapped calls', () => {
    // The generic `<Food>` is the assertion; no `.json()` consumption is
    // needed for wrapped clients. The rule must not fire.
    const frontend = `
      import { apiClient } from '@/src/api/client';
      async function loadFoods() {
        const res = await apiClient.get<{ items: string[] }>('/api/foods');
        return res;
      }
    `;
    const server = `
      app.get('/api/foods', (req, res) => res.json({ items: [] }));
    `;
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const clientPath = 'src/features/nutrition.ts';
    const serverPath = 'src/server.ts';
    const clientMap = extractTsConcepts(project.createSourceFile(clientPath, frontend), clientPath);
    const serverMap = extractTsConcepts(project.createSourceFile(serverPath, server), serverPath);
    const allConcepts = new Map([
      [clientPath, clientMap],
      [serverPath, serverMap],
    ]);
    const findings = untypedApiResponse({ concepts: clientMap, filePath: clientPath, allConcepts });
    expect(findings).toHaveLength(0);
  });

  it('untyped-api-response fires on untyped wrapped calls', () => {
    const frontend = `
      import { apiClient } from '@/src/api/client';
      async function loadFoods() {
        const res = await apiClient.get('/api/foods');
        return res;
      }
    `;
    const server = `
      app.get('/api/foods', (req, res) => res.json({ items: [] }));
    `;
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const clientPath = 'src/features/nutrition.ts';
    const serverPath = 'src/server.ts';
    const clientMap = extractTsConcepts(project.createSourceFile(clientPath, frontend), clientPath);
    const serverMap = extractTsConcepts(project.createSourceFile(serverPath, server), serverPath);
    const allConcepts = new Map([
      [clientPath, clientMap],
      [serverPath, serverMap],
    ]);
    const findings = untypedApiResponse({ concepts: clientMap, filePath: clientPath, allConcepts });
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('/api/foods');
  });
});
