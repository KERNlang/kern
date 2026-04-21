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
});
