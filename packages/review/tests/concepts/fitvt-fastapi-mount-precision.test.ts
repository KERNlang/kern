import type { ConceptMap, ConceptNode, EntrypointPayload } from '@kernlang/core';
import { duplicateRoute } from '../../src/concept-rules/duplicate-route.js';
import { missingResponseModel } from '../../src/concept-rules/missing-response-model.js';
import { extractPythonConceptsFallback } from '../../src/python-fallback.js';

function graphContext(maps: ConceptMap[], primary: string) {
  const allConcepts = new Map(maps.map((map) => [map.filePath, map]));
  const concepts = allConcepts.get(primary);
  if (!concepts) throw new Error(`missing concept map for ${primary}`);
  return { concepts, filePath: primary, allConcepts };
}

describe('FitVT FastAPI mount precision regressions', () => {
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
});
