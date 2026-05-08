/// <reference types="jest" />
import type { ConceptNode, EntrypointPayload } from '@kernlang/core';
import { extractPythonConcepts } from '../src/mapper.js';

function isEntrypointNode(node: ConceptNode): node is ConceptNode & { payload: EntrypointPayload } {
  return node.kind === 'entrypoint' && node.payload.kind === 'entrypoint';
}

function routePayloads(source: string) {
  return extractPythonConcepts(source, 'app/api/users.py')
    .nodes.filter(isEntrypointNode)
    .map((node) => ({ node, payload: node.payload }));
}

describe('Python route entrypoint payloads', () => {
  it('extracts FastAPI response_model from route decorator kwargs', () => {
    const routes = routePayloads(`
from fastapi import APIRouter
router = APIRouter()

@router.get("/users", response_model=UserOut)
def list_users():
    return []
`);

    expect(routes).toHaveLength(1);
    expect(routes[0].payload.responseModel).toBe('UserOut');
  });

  it('extracts bracketed response_model expressions', () => {
    const routes = routePayloads(`
@router.get("/users", response_model=list[schemas.UserOut])
def list_users():
    return []
`);

    expect(routes[0].payload.responseModel).toBe('list[schemas.UserOut]');
  });

  it('extracts nested response_model generic expressions', () => {
    const routes = routePayloads(`
@router.get("/users", response_model=dict[str, list[schemas.UserOut]], status_code=200)
def list_users():
    return {}
`);

    expect(routes[0].payload.responseModel).toBe('dict[str, list[schemas.UserOut]]');
  });

  it('leaves responseModel undefined when response_model is absent or None', () => {
    const routes = routePayloads(`
@router.get("/healthz")
def healthz():
    return {"ok": True}

@router.get("/raw", response_model=None)
def raw():
    return {"ok": True}
`);

    expect(routes.map((route) => route.payload.responseModel)).toEqual([undefined, undefined]);
  });

  it('marks async def route handlers as async', () => {
    const routes = routePayloads(`
@router.get("/users", response_model=UserOut)
async def list_users():
    return []
`);

    expect(routes[0].payload.isAsync).toBe(true);
  });

  it('marks sync def route handlers as not async', () => {
    const routes = routePayloads(`
@router.get("/users", response_model=UserOut)
def list_users():
    return []
`);

    expect(routes[0].payload.isAsync).toBe(false);
  });

  it('sets the route containerId to the decorated function container', () => {
    const concepts = extractPythonConcepts(
      `
@router.get("/users")
def list_users():
    requests.get("https://example.com")
`,
      'app/api/users.py',
    );

    const route = concepts.nodes.find((node) => node.kind === 'entrypoint');
    const effect = concepts.nodes.find((node) => node.kind === 'effect');
    expect(route?.containerId).toBeDefined();
    expect(route?.containerId).toBe(effect?.containerId);
  });

  it('extracts Pydantic request model fields from annotated route parameters', () => {
    const routes = routePayloads(`
from pydantic import BaseModel

class UserCreate(BaseModel):
    email: str
    name: str

@router.post("/users")
def create_user(payload: UserCreate):
    return payload
`);

    expect(routes).toHaveLength(1);
    expect(routes[0].payload.hasBodyValidation).toBe(true);
    expect(routes[0].payload.bodyValidationResolved).toBe(true);
    expect(routes[0].payload.validatedBodyFields).toEqual(['email', 'name']);
  });

  // ── P2-A: FastAPI success status codes ─────────────────────────────────

  it('extracts decorator status_code literal', () => {
    const routes = routePayloads(`
@router.post("/items", status_code=201)
def create():
    return {}
`);
    expect(routes[0].payload.successStatusCodesResolved).toBe(true);
    expect(routes[0].payload.successStatusCodes).toEqual([201]);
  });

  it('extracts status.HTTP_NNN_NAME constant from decorator', () => {
    const routes = routePayloads(`
from fastapi import status

@router.post("/items", status_code=status.HTTP_202_ACCEPTED)
def create():
    return {}
`);
    expect(routes[0].payload.successStatusCodesResolved).toBe(true);
    expect(routes[0].payload.successStatusCodes).toEqual([202]);
  });

  it('defaults to 200 when decorator has no status_code', () => {
    // Codex plan-review #1: FastAPI default is always 200, regardless of method.
    const routes = routePayloads(`
@router.post("/items")
def create():
    return {"id": 1}
`);
    expect(routes[0].payload.successStatusCodesResolved).toBe(true);
    expect(routes[0].payload.successStatusCodes).toEqual([200]);
  });

  it('marks unresolved when decorator status_code is dynamic', () => {
    const routes = routePayloads(`
DEFAULT_CODE = 201

@router.post("/items", status_code=DEFAULT_CODE)
def create():
    return {}
`);
    expect(routes[0].payload.successStatusCodesResolved).toBe(false);
  });

  it('extracts JSONResponse(status_code=N) from handler body', () => {
    const routes = routePayloads(`
from fastapi.responses import JSONResponse

@router.post("/items")
def create():
    return JSONResponse(status_code=201, content={"id": 1})
`);
    expect(routes[0].payload.successStatusCodesResolved).toBe(true);
    // No plain return path → only the explicit JSONResponse code (201) — no 200 default added.
    expect(routes[0].payload.successStatusCodes).toEqual([201]);
  });

  it('unions decorator default 200 with body-side Response codes when plain return paths exist', () => {
    // Codex plan-review #3: handler with both an explicit Response branch
    // and a plain `return data` branch emits a multi-2xx route.
    const routes = routePayloads(`
from fastapi.responses import JSONResponse

@router.post("/items")
def create(data: dict):
    if data.get("created"):
        return JSONResponse(status_code=201, content=data)
    return data
`);
    expect(routes[0].payload.successStatusCodesResolved).toBe(true);
    expect(routes[0].payload.successStatusCodes).toEqual([200, 201]);
  });

  it('extracts response.status_code = N mutation', () => {
    const routes = routePayloads(`
from fastapi import Response

@router.post("/items")
def create(response: Response):
    response.status_code = 202
    return {}
`);
    expect(routes[0].payload.successStatusCodesResolved).toBe(true);
    expect(routes[0].payload.successStatusCodes).toEqual([202]);
  });

  // ── P2-A: FastAPI pagination strategy ──────────────────────────────────

  it('classifies offset/skip/limit handler as offset family', () => {
    const routes = routePayloads(`
@router.get("/items")
def list(skip: int = 0, limit: int = 10):
    return []
`);
    expect(routes[0].payload.paginationStrategyResolved).toBe(true);
    expect(routes[0].payload.paginationStrategy).toBe('offset');
  });

  it('classifies page handler as page family', () => {
    const routes = routePayloads(`
@router.get("/items")
def list(page: int = 1, page_size: int = 20):
    return []
`);
    expect(routes[0].payload.paginationStrategyResolved).toBe(true);
    expect(routes[0].payload.paginationStrategy).toBe('page');
  });

  it('classifies cursor handler as cursor family', () => {
    const routes = routePayloads(`
@router.get("/items")
def list(cursor: str | None = None, limit: int = 10):
    return []
`);
    expect(routes[0].payload.paginationStrategyResolved).toBe(true);
    expect(routes[0].payload.paginationStrategy).toBe('cursor');
  });

  it('classifies handler with no anchor params as none', () => {
    const routes = routePayloads(`
@router.get("/items")
def list(filter: str = ""):
    return []
`);
    expect(routes[0].payload.paginationStrategyResolved).toBe(true);
    expect(routes[0].payload.paginationStrategy).toBe('none');
  });

  it('classifies multi-family handler as mixed', () => {
    const routes = routePayloads(`
@router.get("/items")
def list(page: int = 1, cursor: str | None = None):
    return []
`);
    expect(routes[0].payload.paginationStrategyResolved).toBe(true);
    expect(routes[0].payload.paginationStrategy).toBe('mixed');
  });

  it('marks unresolved when handler has Request parameter (opaque)', () => {
    const routes = routePayloads(`
from fastapi import Request

@router.get("/items")
def list(request: Request):
    return []
`);
    expect(routes[0].payload.paginationStrategyResolved).toBe(false);
  });

  it('marks unresolved when handler has **kwargs (opaque)', () => {
    const routes = routePayloads(`
@router.get("/items")
def list(**kwargs):
    return []
`);
    expect(routes[0].payload.paginationStrategyResolved).toBe(false);
  });

  it('uses Query(alias="...") literal alias over the param name', () => {
    // Codex plan-review #5: wire-key may differ from param identifier.
    // `skip: int = Query(0, alias="offset")` — param name `skip` is offset
    // family already; verify the alias takes precedence cleanly when the
    // param name itself isn't an anchor.
    const routes = routePayloads(`
from fastapi import Query

@router.get("/items")
def list(start: int = Query(0, alias="offset"), limit: int = 10):
    return []
`);
    expect(routes[0].payload.paginationStrategyResolved).toBe(true);
    expect(routes[0].payload.paginationStrategy).toBe('offset');
  });

  it('handles modern FastAPI Annotated[T, Query(alias="...")] (Gemini/OpenCode impl-review)', () => {
    // FastAPI 0.95+ idiomatic syntax: Query() lives inside the type annotation
    // via Annotated[]. Without scanning typeText we'd fall back to the param
    // identifier (`p` here) and miss the page anchor.
    const routes = routePayloads(`
from typing import Annotated
from fastapi import Query

@router.get("/items")
def list(p: Annotated[int, Query(alias="page")] = 1, size: int = 10):
    return []
`);
    expect(routes[0].payload.paginationStrategyResolved).toBe(true);
    expect(routes[0].payload.paginationStrategy).toBe('page');
  });

  it('handles multi-line decorator with status_code on subsequent line (Gemini #4)', () => {
    // Long decorators wrap onto multiple lines in production code. The
    // extractor must pick up `status_code=` regardless of where it falls.
    const routes = routePayloads(`
@router.post(
    "/items",
    response_model=Item,
    status_code=202,
)
def create():
    return {}
`);
    expect(routes[0].payload.successStatusCodesResolved).toBe(true);
    expect(routes[0].payload.successStatusCodes).toEqual([202]);
  });

  it('decorator status_code is dead when ALL returns use explicit Response (Codex impl-review #1)', () => {
    // FastAPI uses the returned Response's status, not the decorator. Without
    // this fix, mapper would falsely report multi-2xx [201, 202] for a route
    // that only emits 202 — letting clients checking 201 pass the gate.
    const routes = routePayloads(`
from fastapi.responses import JSONResponse

@router.post("/items", status_code=201)
def create():
    return JSONResponse(status_code=202, content={})
`);
    expect(routes[0].payload.successStatusCodesResolved).toBe(true);
    expect(routes[0].payload.successStatusCodes).toEqual([202]);
  });

  it('does NOT treat `== 200` comparison as a dynamic mutation (forge round, Claude engine)', () => {
    // `if response.status_code == 200:` is a comparison, not an assignment.
    // Without the `=(?!=)` lookahead, the mutation regex captured `200) ...`
    // as a dynamic RHS and incorrectly marked the route resolved=false.
    const routes = routePayloads(`
from fastapi import Response

@router.post("/items", status_code=201)
def create(response: Response):
    if response.status_code == 200:
        return {"unreachable": True}
    return {"id": 1}
`);
    expect(routes[0].payload.successStatusCodesResolved).toBe(true);
    // Decorator says 201, plain returns inherit it. The `==` comparison
    // contributes nothing.
    expect(routes[0].payload.successStatusCodes).toEqual([201]);
  });

  it('detects status_code mutation under non-conventional Response param name (Codex impl-review #2)', () => {
    // Param injected as `out: Response` instead of the conventional
    // `response`. Without broadened receiver matching, mutation is missed and
    // route falls back to default 200, FP-firing on clients checking 201.
    const routes = routePayloads(`
from fastapi import Response

@router.post("/items")
def create(out: Response):
    out.status_code = 201
    return {}
`);
    expect(routes[0].payload.successStatusCodesResolved).toBe(true);
    expect(routes[0].payload.successStatusCodes).toEqual([201]);
  });
});
