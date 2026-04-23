/**
 * Shared utilities for cross-stack concept rules.
 *
 * Every rule that correlates a frontend network call against a server-side
 * route — contract-drift, untyped-api-response, and the upcoming
 * tainted-across-wire — uses the same URL normalisation + route matching
 * pipeline. Centralising it here means a bug fix (or new matching case like
 * Next.js catch-all `[...slug]`) applies to every rule in one place.
 */

import type { ConceptMap, ConceptNode } from '@kernlang/core';

/**
 * Multiplier applied to a node's base confidence when firing a cross-stack
 * finding. Each current rule matches only on URL-path shape — no HTTP-method
 * correlation, no body-type correlation — so we intentionally cap confidence
 * below 1.0 to reflect the heuristic nature. Upgrade per-rule once the
 * matching is richer (e.g. once the Python mapper surfaces response_model=,
 * untyped-api-response can bump its own multiplier).
 */
export const CROSS_STACK_HEURISTIC_CONFIDENCE = 0.7;

/**
 * Multiplier for rules where the correlation is unambiguous: the path matches
 * exactly AND a second dimension (HTTP method, auth header, …) disagrees.
 * `contract-method-drift`, `duplicate-route`, and `auth-drift` use this —
 * once the path matches, a verb mismatch, duplicate declaration, or missing
 * Authorization header is a real bug, not a heuristic.
 */
export const CROSS_STACK_EXACT_CONFIDENCE = 0.9;

/** Client URLs we consider "internal" to the reviewed project. */
export const API_PATH_RE = /^\/api\//;

export interface ServerRoute {
  path: string;
  method: string | undefined;
  /** Present when the caller needs to cite the server route in a finding. */
  node?: ConceptNode;
}

export function hasFastApiEvidence(map: ConceptMap): boolean {
  if (map.language !== 'py') return false;
  return map.edges.some((edge) => {
    if (edge.kind !== 'dependency' || edge.payload.kind !== 'dependency') return false;
    return edge.payload.specifier === 'fastapi' || edge.payload.specifier.startsWith('fastapi.');
  });
}

export function isFastApiRouteMissingResponseModel(node: ConceptNode, map?: ConceptMap): boolean {
  if (node.language !== 'py') return false;
  if (node.kind !== 'entrypoint' || node.payload.kind !== 'entrypoint') return false;
  if (node.payload.subtype !== 'route') return false;
  if (node.payload.responseModel) return false;
  return map ? hasFastApiEvidence(map) : false;
}

/**
 * Pull every server-side route out of a concept map. Callers typically fold
 * this across `ctx.allConcepts` to collect routes for the whole project.
 *
 * Per-file use (legacy signature): just emits the decorator path as-is.
 *
 * Cross-project use (preferred): call `collectRoutesAcrossGraph` instead,
 * which joins route-mount concepts (FastAPI `app.include_router(prefix=…)`)
 * with the per-file route decorators so `@router.get("/current")` mounted
 * under `prefix="/api/nutrition-goals"` surfaces as `/api/nutrition-goals/current`.
 * Without that join the wedge rules silently find nothing on every FastAPI
 * app that follows the standard APIRouter pattern.
 */
export function collectRoutes(map: ConceptMap, routes: ServerRoute[]): void {
  for (const node of map.nodes) {
    if (node.kind !== 'entrypoint' || node.payload.kind !== 'entrypoint' || node.payload.subtype !== 'route') continue;
    const path = node.payload.name;
    if (typeof path !== 'string' || !path.startsWith('/')) continue;
    routes.push({ path, method: node.payload.httpMethod, node });
  }
}

/**
 * Graph-wide route collection with FastAPI router-prefix expansion.
 *
 * Walks every concept map twice:
 *   1. Collect `route-mount` concepts (FastAPI `app.include_router(<router>,
 *      prefix=…)` calls). Each mount carries `prefix`, `routerName`, and —
 *      when the router was imported from another module — `sourceModule`
 *      like `app.api.nutrition_goals`.
 *   2. For each per-file `route` concept, look up a matching mount by
 *      `sourceModule` ↔ file path suffix (Python `app.api.nutrition_goals`
 *      resolves to any file path ending in `app/api/nutrition_goals.py`),
 *      falling back to a project-wide `routerName` match when the mount
 *      is in the same file as the routes.
 *
 * Per-file routes with no mount are still emitted with their declared path
 * — Flask / Express routes and FastAPI apps that decorate directly on
 * `@app.get(...)` already carry the full path.
 */
export function collectRoutesAcrossGraph(allConcepts: ReadonlyMap<string, ConceptMap>): ServerRoute[] {
  const routes: ServerRoute[] = [];
  // Build the mount index first so each route can look up its prefix.
  const mountsByModule = new Map<string, string[]>();
  const mountsByRouter = new Map<string, Array<{ prefix: string; mountFile: string }>>();
  for (const [mountFile, map] of allConcepts) {
    for (const node of map.nodes) {
      if (node.kind !== 'entrypoint' || node.payload.kind !== 'entrypoint') continue;
      if (node.payload.subtype !== 'route-mount') continue;
      const prefix = node.payload.name;
      const routerName = node.payload.routerName;
      const sourceModule = node.payload.sourceModule;
      if (sourceModule) {
        const list = mountsByModule.get(sourceModule) ?? [];
        list.push(prefix);
        mountsByModule.set(sourceModule, list);
      }
      if (routerName) {
        const list = mountsByRouter.get(routerName) ?? [];
        list.push({ prefix, mountFile });
        mountsByRouter.set(routerName, list);
      }
    }
  }

  for (const [routeFile, map] of allConcepts) {
    for (const node of map.nodes) {
      if (node.kind !== 'entrypoint' || node.payload.kind !== 'entrypoint') continue;
      if (node.payload.subtype !== 'route') continue;
      const path = node.payload.name;
      if (typeof path !== 'string' || !path.startsWith('/')) continue;

      const prefix = resolveMountPrefix(routeFile, node.payload.routerName, mountsByModule, mountsByRouter);
      const fullPath = prefix ? joinPaths(prefix, path) : path;
      routes.push({ path: fullPath, method: node.payload.httpMethod, node });
    }
  }
  return routes;
}

function resolveMountPrefix(
  routeFile: string,
  routerName: string | undefined,
  mountsByModule: ReadonlyMap<string, string[]>,
  mountsByRouter: ReadonlyMap<string, Array<{ prefix: string; mountFile: string }>>,
): string | undefined {
  // Module-based match. TS mounts emit a `sourceModule` that already carries a
  // code extension (e.g. `routes/review.ts`) — use it as a path suffix directly.
  // Python mounts emit a dotted module name (`app.api.nutrition_goals`) — translate
  // to `app/api/nutrition_goals.py` first. The leading-slash boundary check in
  // both branches prevents `blog/api.py` from false-matching module `api`.
  for (const [sourceModule, prefixes] of mountsByModule) {
    if (prefixes.length === 0) continue;
    const relTail = /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(sourceModule)
      ? sourceModule
      : `${sourceModule.replace(/\./g, '/')}.py`;
    if (routeFile === relTail || routeFile.endsWith(`/${relTail}`)) return prefixes[0];
  }
  // Same-file match: `router = APIRouter(); app.include_router(router, prefix=…)`.
  // The mount has no `sourceModule` but shares the file with the routes.
  if (routerName) {
    const entries = mountsByRouter.get(routerName);
    if (entries) {
      const sameFile = entries.find((e) => e.mountFile === routeFile);
      if (sameFile) return sameFile.prefix;
    }
  }
  return undefined;
}

function joinPaths(prefix: string, path: string): string {
  const trimmedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  if (trimmedPath === '/') return trimmedPrefix || '/';
  return `${trimmedPrefix}${trimmedPath}`;
}

/**
 * Strip scheme/host, query string, and fragment from a client URL so it can
 * match against a server route template. Returns undefined when the input
 * isn't a recognisable path (e.g. a bare variable reference or an
 * unresolved template expression).
 */
export function normalizeClientUrl(raw: string): string | undefined {
  let url = raw.trim();
  if (url.startsWith('`') && !url.startsWith('`/')) return undefined;
  url = url.replace(/^`|`$/g, '');
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const pathStart = url.indexOf('/', url.indexOf('://') + 3);
    url = pathStart === -1 ? '/' : url.slice(pathStart);
  }
  const q = url.indexOf('?');
  if (q !== -1) url = url.slice(0, q);
  const h = url.indexOf('#');
  if (h !== -1) url = url.slice(0, h);
  return url || undefined;
}

/**
 * Match a client-side concrete path against server-side route templates.
 * Returns the first matching route (so callers can cite it in findings) or
 * `undefined`. Server templates may contain params — Express/Koa `:id`,
 * FastAPI `{id}` — which match any single segment. Trailing slashes are
 * normalised on both sides. Case-sensitive (matches Express/FastAPI default
 * behaviour).
 */
export function findMatchingRoute(clientPath: string, routes: readonly ServerRoute[]): ServerRoute | undefined {
  const clientSegments = trimTrailing(clientPath).split('/');
  for (const route of routes) {
    const routeSegments = trimTrailing(route.path).split('/');
    if (routeSegments.length !== clientSegments.length) continue;
    let matched = true;
    for (let i = 0; i < routeSegments.length; i++) {
      const rs = routeSegments[i];
      const cs = clientSegments[i];
      if (isParamSegment(rs)) continue;
      if (rs !== cs) {
        matched = false;
        break;
      }
    }
    if (matched) return route;
  }
  return undefined;
}

/** Boolean-returning thin wrapper preserved for callers that just need a yes/no. */
export function hasMatchingRoute(clientPath: string, routes: readonly ServerRoute[]): boolean {
  return findMatchingRoute(clientPath, routes) !== undefined;
}

/**
 * Return every server route whose path template matches the client path,
 * regardless of HTTP method. Used by `contract-method-drift` and
 * `orphan-route` to distinguish "no server exists here" (contract-drift
 * territory) from "server exists but only responds to a different verb /
 * no one calls it" (method-drift / orphan-route territory).
 */
export function findRoutesAtPath(clientPath: string, routes: readonly ServerRoute[]): ServerRoute[] {
  const clientSegments = trimTrailing(clientPath).split('/');
  const matches: ServerRoute[] = [];
  for (const route of routes) {
    const routeSegments = trimTrailing(route.path).split('/');
    if (routeSegments.length !== clientSegments.length) continue;
    let matched = true;
    for (let i = 0; i < routeSegments.length; i++) {
      const rs = routeSegments[i];
      const cs = clientSegments[i];
      if (isParamSegment(rs)) continue;
      if (rs !== cs) {
        matched = false;
        break;
      }
    }
    if (matched) matches.push(route);
  }
  return matches;
}

function trimTrailing(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Resolve an inline Express handler's concept from a route node. Only
 * meaningful for `route` entrypoints whose mapper set `handlerConceptId`
 * (inline arrow/function handlers — not imported identifiers). Returns
 * undefined when the route has no inline handler or the expected concept
 * is absent from the map (e.g., stripped during serialisation).
 *
 * Rules that reason about handler body contents — body-shape drift, auth
 * checks, response envelope detection — use this as the single lookup
 * point so callers don't re-implement span-or-id matching in each rule.
 */
export function findHandlerConcept(map: ConceptMap, route: ConceptNode): ConceptNode | undefined {
  if (route.kind !== 'entrypoint' || route.payload.kind !== 'entrypoint') return undefined;
  const handlerId = route.payload.handlerConceptId;
  if (!handlerId) return undefined;
  return map.nodes.find((n) => n.id === handlerId);
}

function isParamSegment(seg: string): boolean {
  return seg.startsWith(':') || (seg.startsWith('{') && seg.endsWith('}'));
}
