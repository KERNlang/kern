import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { paginationKeyDrift } from '../../src/concept-rules/pagination-key-drift.js';
import { statusCodeDrift } from '../../src/concept-rules/status-code-drift.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';
import { extractPythonConceptsFallback } from '../../src/python-fallback.js';

// P2-A integration tests: TS client + FastAPI server (via python-fallback,
// regex-only). Verifies that the `successStatusCodes` and `paginationStrategy`
// fields populated by the fallback feed cross-stack rules correctly.

function tsClient(source: string, filePath = 'src/client.ts'): ConceptMap {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  return extractTsConcepts(project.createSourceFile(filePath, source), filePath);
}

function ctxFromMaps(files: ConceptMap[], primary: string) {
  const allConcepts = new Map<string, ConceptMap>();
  for (const map of files) allConcepts.set(map.filePath, map);
  const concepts = allConcepts.get(primary);
  if (!concepts) throw new Error(`missing ${primary}`);
  return { concepts, filePath: primary, allConcepts };
}

describe('status-code-drift with FastAPI server (P2-A)', () => {
  it('fires when client checks 201 but FastAPI route has no status_code (defaults to 200)', () => {
    const client = tsClient(`
      async function load() {
        const response = await fetch('/api/users', { method: 'POST' });
        if (response.status === 201) return await response.json();
        return null;
      }
    `);
    const server = extractPythonConceptsFallback(
      `
@router.post("/api/users")
def create_user():
    return {"id": 1}
      `,
      'app/api/users.py',
    );
    const findings = statusCodeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('201');
    expect(findings[0].message).toContain('200');
  });

  it('does NOT fire when FastAPI decorator status_code matches client check', () => {
    const client = tsClient(`
      async function load() {
        const response = await fetch('/api/users', { method: 'POST' });
        if (response.status === 201) return await response.json();
        return null;
      }
    `);
    const server = extractPythonConceptsFallback(
      `
@router.post("/api/users", status_code=201)
def create_user():
    return {"id": 1}
      `,
      'app/api/users.py',
    );
    const findings = statusCodeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings).toHaveLength(0);
  });

  it('fires when client checks 201 but FastAPI uses status.HTTP_202_ACCEPTED', () => {
    const client = tsClient(`
      async function load() {
        const response = await fetch('/api/items', { method: 'POST' });
        if (response.status === 201) return await response.json();
        return null;
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from fastapi import status

@router.post("/api/items", status_code=status.HTTP_202_ACCEPTED)
def create():
    return {}
      `,
      'app/api/items.py',
    );
    const findings = statusCodeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('201');
    expect(findings[0].message).toContain('202');
  });

  it('does NOT fire when FastAPI status_code is dynamic (resolved=false)', () => {
    const client = tsClient(`
      async function load() {
        const response = await fetch('/api/items', { method: 'POST' });
        if (response.status === 201) return await response.json();
        return null;
      }
    `);
    const server = extractPythonConceptsFallback(
      `
DEFAULT_CODE = 202

@router.post("/api/items", status_code=DEFAULT_CODE)
def create():
    return {}
      `,
      'app/api/items.py',
    );
    const findings = statusCodeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings).toHaveLength(0);
  });
});

describe('pagination-key-drift with FastAPI server (P2-A)', () => {
  it('fires when client uses ?page= but FastAPI handler reads skip/limit', () => {
    const client = tsClient(`
      async function load() {
        const response = await fetch('/api/items?page=2', { method: 'GET' });
        return await response.json();
      }
    `);
    const server = extractPythonConceptsFallback(
      `
@router.get("/api/items")
def list_items(skip: int = 0, limit: int = 10):
    return []
      `,
      'app/api/items.py',
    );
    const findings = paginationKeyDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('page');
    expect(findings[0].message).toContain('offset');
  });

  it('does NOT fire when client and FastAPI server agree on offset family', () => {
    const client = tsClient(`
      async function load() {
        const response = await fetch('/api/items?skip=20&limit=10', { method: 'GET' });
        return await response.json();
      }
    `);
    const server = extractPythonConceptsFallback(
      `
@router.get("/api/items")
def list_items(skip: int = 0, limit: int = 10):
    return []
      `,
      'app/api/items.py',
    );
    const findings = paginationKeyDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when FastAPI handler has Request param (resolved=false)', () => {
    const client = tsClient(`
      async function load() {
        const response = await fetch('/api/items?page=2', { method: 'GET' });
        return await response.json();
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from fastapi import Request

@router.get("/api/items")
def list_items(request: Request):
    return []
      `,
      'app/api/items.py',
    );
    const findings = paginationKeyDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings).toHaveLength(0);
  });

  it('uses Query(alias="...") literal alias over param name', () => {
    // Client uses `?offset=`, FastAPI param is named `start` but aliased to `offset`.
    const client = tsClient(`
      async function load() {
        const response = await fetch('/api/items?offset=20&limit=10', { method: 'GET' });
        return await response.json();
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from fastapi import Query

@router.get("/api/items")
def list_items(start: int = Query(0, alias="offset"), limit: int = 10):
    return []
      `,
      'app/api/items.py',
    );
    const findings = paginationKeyDrift(ctxFromMaps([client, server], 'src/client.ts'));
    // Both ends are offset family → no drift.
    expect(findings).toHaveLength(0);
  });

  it('fallback handles multi-line decorator with status_code (Codex impl-review #3)', () => {
    // Multi-line decorator: status_code= falls on a continuation line.
    // Without expanding the decorator text across lines, the fallback would
    // miss it and fall back to the default 200, false-firing on the client.
    const client = tsClient(`
      async function load() {
        const response = await fetch('/api/items', { method: 'POST' });
        if (response.status === 202) return await response.json();
        return null;
      }
    `);
    const server = extractPythonConceptsFallback(
      `
@router.post(
    "/api/items",
    response_model=Item,
    status_code=202,
)
def create():
    return {}
      `,
      'app/api/items.py',
    );
    const findings = statusCodeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    // Server emits 202, client checks 202 → no drift.
    expect(findings).toHaveLength(0);
  });

  it('handles Annotated[T, Query(alias="...")] in fallback path (Gemini/OpenCode impl-review)', () => {
    // Modern FastAPI ≥ 0.95: Query() lives inside the type annotation via
    // Annotated[]. Verifies the regex fallback path also picks up the alias.
    const client = tsClient(`
      async function load() {
        const response = await fetch('/api/items?page=2', { method: 'GET' });
        return await response.json();
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from typing import Annotated
from fastapi import Query

@router.get("/api/items")
def list_items(p: Annotated[int, Query(alias="page")] = 1, size: int = 10):
    return []
      `,
      'app/api/items.py',
    );
    const findings = paginationKeyDrift(ctxFromMaps([client, server], 'src/client.ts'));
    // Both ends are page family → no drift.
    expect(findings).toHaveLength(0);
  });
});
