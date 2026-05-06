import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { bodyShapeDrift } from '../../src/concept-rules/body-shape-drift.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';
import { extractPythonConceptsFallback } from '../../src/python-fallback.js';

// body-shape-drift with Pydantic-validated server schemas. Mirrors the
// Zod work in body-shape-drift-zod-types.test.ts: when a FastAPI handler
// declares a `payload: UserCreate` parameter and `UserCreate(BaseModel)`
// fields are typed (`str`, `int`, `Optional[bool]`, `Literal['x','y']`,
// `List[T]` …), those tags now flow into `validatedBodyFieldTypes` on
// the route entrypoint payload. /type uses them as a fallback when the
// handler-read tag is `'unknown'`.
//
// Exercises both code paths:
//   1. `extractPythonConceptsFallback` (regex-only, used in this test
//      because review-python's tree-sitter loader is heavy in tests).

function ctxFromMaps(files: ConceptMap[], primary: string) {
  const allConcepts = new Map<string, ConceptMap>();
  for (const map of files) allConcepts.set(map.filePath, map);
  const concepts = allConcepts.get(primary);
  if (!concepts) throw new Error(`missing ${primary}`);
  return { concepts, filePath: primary, allConcepts };
}

function tsClient(source: string, filePath = 'src/client.ts'): ConceptMap {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  return extractTsConcepts(project.createSourceFile(filePath, source), filePath);
}

describe('body-shape-drift with Pydantic-validated server schemas', () => {
  it('fires /type when client sends string for an int Pydantic field', () => {
    const client = tsClient(`
      async function send() {
        await fetch('/api/items', {
          method: 'POST',
          body: JSON.stringify({ count: 'three' }),
        });
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from pydantic import BaseModel

class CreateItem(BaseModel):
    count: int

@router.post("/api/items")
def create_item(payload: CreateItem):
    return payload
      `,
      'app/api/items.py',
    );
    const findings = bodyShapeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    const t = findings.filter((f) => f.ruleId === 'body-shape-drift/type');
    expect(t).toHaveLength(1);
    expect(t[0].message).toMatch(/count.*client `string` vs server `number`/);
  });

  it('fires /type when client sends number for a bool Pydantic field', () => {
    const client = tsClient(`
      async function send() {
        await fetch('/api/items', {
          method: 'POST',
          body: JSON.stringify({ active: 1 }),
        });
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from pydantic import BaseModel

class CreateItem(BaseModel):
    active: bool

@router.post("/api/items")
def create_item(payload: CreateItem):
    return payload
      `,
      'app/api/items.py',
    );
    const findings = bodyShapeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(1);
  });

  it('drops Optional[T] wrapper before tag agreement (str | None reads as string)', () => {
    const client = tsClient(`
      async function send() {
        await fetch('/api/items', {
          method: 'POST',
          body: JSON.stringify({ note: 42 }),
        });
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from pydantic import BaseModel
from typing import Optional

class CreateItem(BaseModel):
    note: Optional[str] = None

@router.post("/api/items")
def create_item(payload: CreateItem):
    return payload
      `,
      'app/api/items.py',
    );
    const findings = bodyShapeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(1);
  });

  it('coarsens List[int] to array', () => {
    const client = tsClient(`
      async function send() {
        await fetch('/api/items', {
          method: 'POST',
          body: JSON.stringify({ ids: 'one' }),
        });
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from pydantic import BaseModel
from typing import List

class CreateItem(BaseModel):
    ids: List[int]

@router.post("/api/items")
def create_item(payload: CreateItem):
    return payload
      `,
      'app/api/items.py',
    );
    const findings = bodyShapeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    const t = findings.filter((f) => f.ruleId === 'body-shape-drift/type');
    expect(t).toHaveLength(1);
    expect(t[0].message).toMatch(/client `string` vs server `array`/);
  });

  it('handles PEP 604 union (int | None) — drops null branch', () => {
    const client = tsClient(`
      async function send() {
        await fetch('/api/items', {
          method: 'POST',
          body: JSON.stringify({ count: 'abc' }),
        });
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from pydantic import BaseModel

class CreateItem(BaseModel):
    count: int | None

@router.post("/api/items")
def create_item(payload: CreateItem):
    return payload
      `,
      'app/api/items.py',
    );
    const findings = bodyShapeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(1);
  });

  it('mixed-tag union (int | str) collapses to unknown — silent', () => {
    const client = tsClient(`
      async function send() {
        await fetch('/api/items', {
          method: 'POST',
          body: JSON.stringify({ value: true }),
        });
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from pydantic import BaseModel

class CreateItem(BaseModel):
    value: int | str

@router.post("/api/items")
def create_item(payload: CreateItem):
    return payload
      `,
      'app/api/items.py',
    );
    const findings = bodyShapeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    // Server side coarsens to 'unknown' (mixed primitive union); /type stays silent.
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(0);
  });

  it('Literal["a", "b"] coarsens to string (matching) — silent on string client', () => {
    const client = tsClient(`
      async function send() {
        await fetch('/api/items', {
          method: 'POST',
          body: JSON.stringify({ kind: 'small' }),
        });
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from pydantic import BaseModel
from typing import Literal

class CreateItem(BaseModel):
    kind: Literal["small", "large"]

@router.post("/api/items")
def create_item(payload: CreateItem):
    return payload
      `,
      'app/api/items.py',
    );
    const findings = bodyShapeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(0);
  });

  it('is silent on method mismatch (client PUT vs server POST)', () => {
    const client = tsClient(`
      async function send() {
        await fetch('/api/items', {
          method: 'PUT',
          body: JSON.stringify({ count: 'abc' }),
        });
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from pydantic import BaseModel

class CreateItem(BaseModel):
    count: int

@router.post("/api/items")
def create_item(payload: CreateItem):
    return payload
      `,
      'app/api/items.py',
    );
    const findings = bodyShapeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings).toHaveLength(0);
  });

  it('is silent when client sends null against Optional[str] (codex-flagged FP fix)', () => {
    // Server `Optional[str]` accepts None. Coarsener drops the null
    // branch and returns 'string' (preserving the non-null mismatch
    // case: client sending number → /type fires). The rule then skips
    // /type when client is literal null, so this case stays silent.
    const client = tsClient(`
      async function send() {
        await fetch('/api/items', {
          method: 'POST',
          body: JSON.stringify({ note: null }),
        });
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from pydantic import BaseModel
from typing import Optional

class CreateItem(BaseModel):
    note: Optional[str] = None

@router.post("/api/items")
def create_item(payload: CreateItem):
    return payload
      `,
      'app/api/items.py',
    );
    const findings = bodyShapeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(0);
  });

  it('is silent on capitalized bare ident server types (Status enum/alias) (codex-flagged FP fix)', () => {
    // `class Status(str, Enum)` or `Status = Literal[...]` would have
    // been tagged 'object' pre-fix, FP'ing string clients. Now coarsens
    // to 'unknown' so /type stays silent.
    const client = tsClient(`
      async function send() {
        await fetch('/api/items', {
          method: 'POST',
          body: JSON.stringify({ status: 'active' }),
        });
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from enum import Enum
from pydantic import BaseModel

class Status(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"

class CreateItem(BaseModel):
    status: Status

@router.post("/api/items")
def create_item(payload: CreateItem):
    return payload
      `,
      'app/api/items.py',
    );
    const findings = bodyShapeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(0);
  });

  it('mixed-primitive Literal["a", 1] collapses to unknown — silent (opencode-flagged FP fix)', () => {
    // Pre-fix coarsen returned the FIRST literal's tag, so
    // `Literal['a', 1]` was 'string' and a number client FP'd. Now
    // mixed-primitive literals collapse to 'unknown' — server accepts
    // either branch, so /type cannot prove a mismatch.
    const client = tsClient(`
      async function send() {
        await fetch('/api/items', {
          method: 'POST',
          body: JSON.stringify({ value: 1 }),
        });
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from pydantic import BaseModel
from typing import Literal

class CreateItem(BaseModel):
    value: Literal["a", 1]

@router.post("/api/items")
def create_item(payload: CreateItem):
    return payload
      `,
      'app/api/items.py',
    );
    const findings = bodyShapeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(0);
  });

  it('handles Pydantic newtypes (EmailStr, UUID) as strings', () => {
    const client = tsClient(`
      async function send() {
        await fetch('/api/items', {
          method: 'POST',
          body: JSON.stringify({ email: 1, uid: false }),
        });
      }
    `);
    const server = extractPythonConceptsFallback(
      `
from pydantic import BaseModel, EmailStr
from uuid import UUID

class CreateItem(BaseModel):
    email: EmailStr
    uid: UUID

@router.post("/api/items")
def create_item(payload: CreateItem):
    return payload
      `,
      'app/api/items.py',
    );
    const findings = bodyShapeDrift(ctxFromMaps([client, server], 'src/client.ts'));
    const t = findings.filter((f) => f.ruleId === 'body-shape-drift/type');
    expect(t).toHaveLength(1);
    // Both fields should be flagged.
    expect(t[0].message).toMatch(/email/);
    expect(t[0].message).toMatch(/uid/);
  });
});
