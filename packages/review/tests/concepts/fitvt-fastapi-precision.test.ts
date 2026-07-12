import type { ConceptMap, ConceptNode, EntrypointPayload } from '@kernlang/core';
import { collectRoutesAcrossGraph } from '../../src/concept-rules/cross-stack-utils.js';
import { duplicateRoute } from '../../src/concept-rules/duplicate-route.js';
import { missingResponseModel } from '../../src/concept-rules/missing-response-model.js';
import { extractPythonConceptsFallback } from '../../src/python-fallback.js';

function routeNodes(map: ConceptMap): Array<ConceptNode & { payload: EntrypointPayload }> {
  return map.nodes.filter(
    (node): node is ConceptNode & { payload: EntrypointPayload } =>
      node.kind === 'entrypoint' && node.payload.kind === 'entrypoint' && node.payload.subtype === 'route',
  );
}

function graphContext(maps: ConceptMap[], primary: string) {
  const allConcepts = new Map(maps.map((map) => [map.filePath, map]));
  const concepts = allConcepts.get(primary);
  if (!concepts) throw new Error(`missing concept map for ${primary}`);
  return { concepts, filePath: primary, allConcepts };
}

describe('FitVT FastAPI precision regressions', () => {
  it('does not extract route decorators from docstrings', () => {
    const concepts = extractPythonConceptsFallback(
      `
def dependency():
    """Usage example.

    Escaped delimiter text: \\"""

    @router.get("/me")
    async def example():
        return {"id": 1}
    """
    return None
`,
      'app/dependencies/common.py',
    );

    expect(routeNodes(concepts)).toEqual([]);
  });

  it('extracts path and response model from a multiline decorator', () => {
    const concepts = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
router = APIRouter()

@router.get(
    "/history",
    description=") is documentation, not decorator structure",
    response_model=list[HistoryOut],
)
async def history():
    return []
`,
      'app/api/history.py',
    );

    const routes = routeNodes(concepts);
    expect(routes).toHaveLength(1);
    expect(routes[0].payload.name).toBe('/history');
    expect(routes[0].payload.responseModel).toBe('list[HistoryOut]');
    expect(missingResponseModel({ concepts, filePath: concepts.filePath })).toEqual([]);
  });

  it('ignores include_router text inside decorator strings', () => {
    const concepts = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
router = APIRouter()

@router.get(
    "/history",
    description="See app.include_router() for mounting details",
    response_model=HistoryOut,
)
async def history():
    return {}
`,
      'app/api/history.py',
    );

    expect(routeNodes(concepts)[0].payload.responseModel).toBe('HistoryOut');
  });

  it('extracts keyword-first fallback route paths', () => {
    const concepts = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
router = APIRouter()

@router.get(
    summary="Users",
    path="/keyword-users",
    description="Documentation mentions status_code=201)",
    response_model=UserOut,
)
def list_users():
    return []
`,
      'app/api/users.py',
    );

    expect(routeNodes(concepts)).toHaveLength(1);
    expect(routeNodes(concepts)[0].payload.name).toBe('/keyword-users');
    expect(routeNodes(concepts)[0].payload.successStatusCodes).toEqual([200]);
  });

  it('does not emit fallback routes with dynamic paths', () => {
    const concepts = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
router = APIRouter()
PATH = "/runtime"

@router.get(path=PATH)
def runtime():
    return {}
`,
      'app/api/runtime.py',
    );

    expect(routeNodes(concepts)).toEqual([]);
  });

  it('mounts bare imported router objects without requiring the export name to match', () => {
    const routes = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
router = APIRouter()
auth_router = router

@router.get("/auth", response_model=AuthOut)
def auth():
    return {}
`,
      'app/routes.py',
    );
    const main = extractPythonConceptsFallback(
      `
from fastapi import FastAPI
from app.routes import auth_router
app = FastAPI()
app.include_router(auth_router, prefix="/api")
`,
      'app/main.py',
    );

    const allConcepts = new Map([
      [routes.filePath, routes],
      [main.filePath, main],
    ]);
    expect(collectRoutesAcrossGraph(allConcepts).map((route) => route.path)).toContain('/api/auth');
  });

  it('does not apply a bare imported router mount to sibling routers in the same module', () => {
    const routes = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
public_router = APIRouter()
admin_router = APIRouter()

@public_router.get("/public", response_model=PublicOut)
def public():
    return {}

@admin_router.get("/admin", response_model=AdminOut)
def admin():
    return {}
`,
      'app/routes.py',
    );
    const main = extractPythonConceptsFallback(
      `
from fastapi import FastAPI
from app.routes import admin_router
app = FastAPI()
app.include_router(admin_router, prefix="/api/admin")
`,
      'app/main.py',
    );

    const allConcepts = new Map([
      [routes.filePath, routes],
      [main.filePath, main],
    ]);
    expect(collectRoutesAcrossGraph(allConcepts).map((route) => route.path)).toEqual(['/public', '/api/admin/admin']);
  });

  it('extracts fallback routes declared on custom router identifiers', () => {
    const concepts = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
auth_router = APIRouter()

@auth_router.get("/me", response_model=UserOut)
def me():
    return {}
`,
      'app/api/auth.py',
    );

    expect(routeNodes(concepts)).toHaveLength(1);
    expect(routeNodes(concepts)[0].payload.routerName).toBe('auth_router');
  });

  it('applies fallback APIRouter-level prefix and schema exclusion', () => {
    const concepts = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
api_router = APIRouter(
    prefix="/api",
    include_in_schema=False,
)

@api_router.get("/users")
def list_users():
    return []
`,
      'app/api/users.py',
    );

    expect(routeNodes(concepts)).toHaveLength(1);
    expect(routeNodes(concepts)[0].payload.name).toBe('/api/users');
    expect(routeNodes(concepts)[0].payload.includeInSchema).toBe(false);
    expect(missingResponseModel({ concepts, filePath: concepts.filePath })).toEqual([]);
  });

  it('does not derive route behavior from handler docstrings', () => {
    const concepts = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
router = APIRouter()

@router.get("/items", response_model=list[ItemOut])
def items():
    """Documentation examples only.
    raise HTTPException(status_code=404)
    return JSONResponse({}, status_code=201)
    session.query(Item).all()
    db.commit()
    idempotency_key = "example"
    """
    return []
`,
      'app/api/items.py',
    );

    const route = routeNodes(concepts)[0].payload;
    expect(route.errorStatusCodes).toBeUndefined();
    expect(route.successStatusCodes).toEqual([200]);
    expect(route.hasUnboundedCollectionQuery).toBe(false);
    expect(route.hasDbWrite).toBe(false);
    expect(route.hasIdempotencyProtection).toBe(false);
  });

  it('applies fallback router mounts before duplicate-route comparison', () => {
    const auth = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
router = APIRouter()

@router.post("/refresh", response_model=TokenOut)
def refresh():
    return {}
`,
      'app/api/auth.py',
    );
    const admin = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
router = APIRouter()

@router.post("/refresh", response_model=AdminTokenOut)
def refresh():
    return {}
`,
      'app/api/admin_session.py',
    );
    const main = extractPythonConceptsFallback(
      `
from fastapi import FastAPI
from .api import (
    admin_session,
    auth,
)
from .web import router as site_router

"""Documentation only:
from fake.web import router as site_router
"""

app = FastAPI()
@app.get("/", response_model=RootOut)
def root():
    return {}

app.include_router(router=auth.router, prefix=r"/api/auth")
app.include_router(admin_session.router, prefix="/api/admin/session")
app.include_router(site_router, prefix="/site", include_in_schema=False)
`,
      'app/main.py',
    );
    const site = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
router = APIRouter()

@router.get("/", include_in_schema=True)
def home():
    return HTMLResponse("home")
`,
      'app\\web\\router.py',
    );

    expect(duplicateRoute(graphContext([auth, admin, main, site], admin.filePath))).toEqual([]);
    expect(duplicateRoute(graphContext([auth, admin, main, site], site.filePath))).toEqual([]);
    expect(missingResponseModel(graphContext([auth, admin, main, site], site.filePath))).toEqual([]);
  });

  it('extracts fallback router keywords regardless of argument order', () => {
    const concepts = extractPythonConceptsFallback(
      `
from fastapi import FastAPI
from . import auth

app = FastAPI()
# app.include_router(auth.router, prefix="/commented")
HELP = "Example: app.include_router(auth.router, prefix='/string')"
app.include_router(
    dependencies=[Depends(check(router=wrong_router, prefix="/wrong", description=")"))],
    prefix="/auth",
    include_in_schema=False,
    router=auth.router,
)
`,
      'app/main.py',
    );

    const mounts = concepts.nodes.filter(
      (node): node is ConceptNode & { payload: EntrypointPayload } =>
        node.kind === 'entrypoint' && node.payload.kind === 'entrypoint' && node.payload.subtype === 'route-mount',
    );
    expect(mounts).toHaveLength(1);
    expect(mounts[0].payload.name).toBe('/auth');
    expect(mounts[0].payload.routerName).toBe('router');
    expect(mounts[0].payload.sourceModule).toBe('.auth');
    expect(mounts[0].payload.includeInSchema).toBe(false);
  });

  it('does not require a public contract for an unmounted example router in graph mode', () => {
    const example = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
router = APIRouter(prefix="/example")

@router.get("/simple")
def simple():
    return {"ok": True}
`,
      'app/api/example_usage.py',
    );

    expect(missingResponseModel(graphContext([example], example.filePath))).toEqual([]);
  });

  it('requires a response contract when an example-named router is publicly mounted', () => {
    const example = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
router = APIRouter()

@router.get("/simple")
def simple():
    return {"ok": True}
`,
      'app/api/example_usage.py',
    );
    const main = extractPythonConceptsFallback(
      `
from fastapi import FastAPI
from .api import example_usage
app = FastAPI()
app.include_router(example_usage.router, prefix="/api")
`,
      'app/main.py',
    );

    expect(missingResponseModel(graphContext([example, main], example.filePath))).toHaveLength(1);
  });

  it('still reports an unresolved runtime router in graph mode', () => {
    const runtime = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
router = APIRouter()

@router.get("/runtime")
def runtime_route():
    return {"ok": True}
`,
      'app/api/unresolved_runtime.py',
    );

    expect(missingResponseModel(graphContext([runtime], runtime.filePath))).toHaveLength(1);
  });

  it('keeps a response-model warning when any matching router mount is public', () => {
    const runtime = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
router = APIRouter()

@router.get("/users")
def users():
    return []
`,
      'app/api/users.py',
    );
    const main = extractPythonConceptsFallback(
      `
from fastapi import FastAPI
from .api import users
app = FastAPI()

app.include_router(users.router, prefix="/private", include_in_schema=False)
app.include_router(users.router, prefix="/public")
`,
      'app/main.py',
    );

    expect(missingResponseModel(graphContext([runtime, main], runtime.filePath))).toHaveLength(1);
  });

  it('recognizes inferred return models in the fallback', () => {
    const concepts = extractPythonConceptsFallback(
      `
from typing import Any
from fastapi import APIRouter
router = APIRouter()

@router.get("/limits")
def limits(
    pattern: str = "):",
) -> dict[str, Any]:
    return {"limit": 1}
`,
      'app/api/progress_photos.py',
    );

    expect(routeNodes(concepts)[0].payload.responseModel).toBe('dict[str, Any]');
    expect(missingResponseModel({ concepts, filePath: concepts.filePath })).toEqual([]);
  });

  it('does not require models for non-JSON or schema-excluded fallback routes', () => {
    const concepts = extractPythonConceptsFallback(
      `
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
app = FastAPI()

@app.get("/media/{filename}", response_class=FileResponse)
def media(filename: str) -> FileResponse:
    return FileResponse(filename)

@app.get("/.well-known/association", include_in_schema=False)
def association() -> JSONResponse:
    return JSONResponse({"ok": True})

@app.get("/typed-json", response_class=JSONResponse)
def typed_json() -> TypedJsonOut:
    return TypedJsonOut(ok=True)
`,
      'app/main.py',
    );

    expect(routeNodes(concepts).map((node) => node.payload.responseClass)).toEqual([
      'FileResponse',
      'JSONResponse',
      'JSONResponse',
    ]);
    expect(routeNodes(concepts).map((node) => node.payload.responseModel)).toEqual([
      undefined,
      undefined,
      'TypedJsonOut',
    ]);
    expect(routeNodes(concepts).map((node) => node.payload.includeInSchema)).toEqual([undefined, false, undefined]);
    expect(missingResponseModel({ concepts, filePath: concepts.filePath })).toEqual([]);
  });

  it('still reports unmodeled production JSON routes and explicit response_model=None', () => {
    const concepts = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
router = APIRouter()

@router.get("/untyped")
def untyped():
    return {"ok": True}

@router.get("/disabled", response_model=None)
def disabled() -> dict[str, bool]:
    return {"ok": True}

@router.get(
    "/documented",
    description="response_model=Fake and include_in_schema=False are documentation text",
)
def documented():
    return {"ok": True}
`,
      'app/api/untyped.py',
    );

    expect(missingResponseModel({ concepts, filePath: concepts.filePath })).toHaveLength(3);
  });

  it('does not infer a response model from an arrow inside a default string', () => {
    const concepts = extractPythonConceptsFallback(
      `
from fastapi import APIRouter
router = APIRouter()

@router.get("/untyped")
def untyped(label: str = "a -> b"):
    return {"ok": True}
`,
      'app/api/untyped.py',
    );

    expect(routeNodes(concepts)[0].payload.responseModel).toBeUndefined();
    expect(missingResponseModel({ concepts, filePath: concepts.filePath })).toHaveLength(1);
  });

  it('does not enforce production response contracts on test-only routes', () => {
    const concepts = extractPythonConceptsFallback(
      `
from fastapi import FastAPI
app = FastAPI()

@app.get("/test")
def route():
    return {"ok": True}
`,
      'tests/middleware/test_rate_limit_middleware.py',
    );

    expect(missingResponseModel({ concepts, filePath: concepts.filePath })).toEqual([]);
  });
});
