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
import { isNonJsonFastApiResponseClass } from '../python-response-contract.js';

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
 * Compute the wire-payload confidence (integer 0–100) from a concept-node's
 * inference confidence (0–1) and a cross-stack quality multiplier (0–1).
 * Centralizes the unit conversion so every concept-rule emits in the same
 * format expected by `ReviewFinding.confidence`.
 */
export function crossStackConfidence(nodeConfidence: number, multiplier: number): number {
  if (!Number.isFinite(nodeConfidence) || !Number.isFinite(multiplier)) return 0;
  return Math.max(0, Math.min(100, Math.round(nodeConfidence * multiplier * 100)));
}

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

/** Pagination anchor sets — exposed for both the mapper (server-side handler
 *  inspection) and `pagination-key-drift` (client-side query inspection).
 *  Size keys (`limit`, `take`, `pageSize`, `perPage`) are intentionally NOT
 *  anchors — `limit` works with offset OR cursor pagination; classifying it
 *  as offset-anchor would produce false positives against cursor-paginated
 *  servers that also accept a limit. */
export const PAGE_ANCHORS: ReadonlySet<string> = new Set(['page', 'pageNumber', 'page_number']);
export const OFFSET_ANCHORS: ReadonlySet<string> = new Set(['offset', 'skip']);
export const CURSOR_ANCHORS: ReadonlySet<string> = new Set(['cursor', 'after', 'before', 'next', 'previous']);

/** Classifies a single query-key string against the anchor sets. Returns
 *  `undefined` when the key is not a pagination anchor (size keys, filters,
 *  sort keys, etc.). */
export function classifyPaginationAnchor(key: string): 'page' | 'offset' | 'cursor' | undefined {
  if (PAGE_ANCHORS.has(key)) return 'page';
  if (OFFSET_ANCHORS.has(key)) return 'offset';
  if (CURSOR_ANCHORS.has(key)) return 'cursor';
  return undefined;
}

/** Aggregates a list of query-key strings into a single strategy. Mirrors the
 *  server-side classification done in the Express mapper so client and server
 *  can be compared on equal terms. */
export function aggregatePaginationStrategy(keys: readonly string[]): 'page' | 'offset' | 'cursor' | 'mixed' | 'none' {
  const families = new Set<'page' | 'offset' | 'cursor'>();
  for (const key of keys) {
    const family = classifyPaginationAnchor(key);
    if (family) families.add(family);
  }
  if (families.size === 0) return 'none';
  if (families.size > 1) return 'mixed';
  return families.values().next().value as 'page' | 'offset' | 'cursor';
}

export interface ServerRoute {
  path: string;
  method: string | undefined;
  includeInSchema?: boolean;
  mounted?: boolean;
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
  if (node.payload.includeInSchema === false) return false;
  if (isNonJsonFastApiResponseClass(node.payload.responseClass)) return false;
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
    routes.push({
      path,
      method: node.payload.httpMethod,
      includeInSchema: node.payload.includeInSchema,
      mounted:
        node.payload.routerName === undefined ||
        node.payload.routerName === 'app' ||
        node.payload.routerName === 'application',
      node,
    });
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
  interface RouteMount {
    prefix: string;
    mountFile: string;
    includeInSchema?: boolean;
    routerName?: string;
    routerNameAuthoritative?: boolean;
  }
  // Build the mount index first so each route can look up its prefix.
  const mountsByModule = new Map<string, RouteMount[]>();
  const mountsByRouter = new Map<string, RouteMount[]>();
  for (const [mountFile, map] of allConcepts) {
    for (const node of map.nodes) {
      if (node.kind !== 'entrypoint' || node.payload.kind !== 'entrypoint') continue;
      if (node.payload.subtype !== 'route-mount') continue;
      const prefix = node.payload.name;
      const routerName = node.payload.routerName;
      const sourceModule = node.payload.sourceModule;
      const mount = {
        prefix,
        mountFile,
        includeInSchema: node.payload.includeInSchema,
        routerName,
        routerNameAuthoritative: node.payload.routerNameAuthoritative,
      };
      if (sourceModule) {
        const list = mountsByModule.get(sourceModule) ?? [];
        list.push(mount);
        mountsByModule.set(sourceModule, list);
      }
      if (routerName) {
        const list = mountsByRouter.get(routerName) ?? [];
        list.push(mount);
        mountsByRouter.set(routerName, list);
      }
    }
  }

  for (const [routeFile, map] of allConcepts) {
    const routeRouterNames = new Set(
      map.nodes.flatMap((node) =>
        node.kind === 'entrypoint' &&
        node.payload.kind === 'entrypoint' &&
        node.payload.subtype === 'route' &&
        node.payload.routerName
          ? [node.payload.routerName]
          : [],
      ),
    );
    for (const node of map.nodes) {
      if (node.kind !== 'entrypoint' || node.payload.kind !== 'entrypoint') continue;
      if (node.payload.subtype !== 'route') continue;
      const path = node.payload.name;
      if (typeof path !== 'string' || !path.startsWith('/')) continue;

      const mounts = resolveRouteMounts(
        routeFile,
        node.payload.routerName,
        routeRouterNames,
        mountsByModule,
        mountsByRouter,
      );
      const effectiveMounts = mounts.length > 0 ? mounts : [undefined];
      const directAppRoute =
        node.payload.routerName === undefined ||
        node.payload.routerName === 'app' ||
        node.payload.routerName === 'application';
      for (const mount of effectiveMounts) {
        routes.push({
          path: mount ? joinPaths(mount.prefix, path) : path,
          method: node.payload.httpMethod,
          includeInSchema: combineSchemaInclusion(node.payload.includeInSchema, mount?.includeInSchema),
          mounted: mount !== undefined || directAppRoute,
          node,
        });
      }
    }
  }
  return routes;
}

function resolveRouteMounts<
  T extends { prefix: string; mountFile: string; routerName?: string; routerNameAuthoritative?: boolean },
>(
  routeFile: string,
  routerName: string | undefined,
  routeRouterNames: ReadonlySet<string>,
  mountsByModule: ReadonlyMap<string, T[]>,
  mountsByRouter: ReadonlyMap<string, T[]>,
): T[] {
  const normalizedRouteFile = routeFile.replace(/\\/g, '/');
  const moduleMatches: T[] = [];
  // Module-based match. TS mounts emit a `sourceModule` that already carries a
  // code extension (e.g. `routes/review.ts`) — use it as a path suffix directly.
  // Python mounts emit a dotted module name (`app.api.nutrition_goals`) — translate
  // to `app/api/nutrition_goals.py` first. The leading-slash boundary check in
  // both branches prevents `blog/api.py` from false-matching module `api`.
  // A package-level `from app.web import router` may re-export the router from
  // `app/web/router.py`, so Python module candidates include that conventional
  // child plus the package `__init__.py`.
  for (const [sourceModule, mounts] of mountsByModule) {
    if (mounts.length === 0) continue;
    for (const mount of mounts) {
      if (routerName && mount.routerName && routerName !== mount.routerName) {
        const ambiguousAliasFallback = mount.routerNameAuthoritative === false && routeRouterNames.size === 1;
        if (!ambiguousAliasFallback) continue;
      }
      const relTails = pythonOrTsModuleCandidates(sourceModule, mount.mountFile);
      if (relTails.some((relTail) => normalizedRouteFile === relTail || normalizedRouteFile.endsWith(`/${relTail}`))) {
        moduleMatches.push(mount);
      }
    }
  }
  if (moduleMatches.length > 0) return moduleMatches;
  // Same-file match: `router = APIRouter(); app.include_router(router, prefix=…)`.
  // The mount has no `sourceModule` but shares the file with the routes.
  if (routerName) {
    const entries = mountsByRouter.get(routerName);
    if (entries) {
      return entries.filter((entry) => entry.mountFile.replace(/\\/g, '/') === normalizedRouteFile);
    }
  }
  return [];
}

function combineSchemaInclusion(routeValue: boolean | undefined, mountValue: boolean | undefined): boolean | undefined {
  if (routeValue === false || mountValue === false) return false;
  if (routeValue === true || mountValue === true) return true;
  return undefined;
}

function pythonOrTsModuleCandidates(sourceModule: string, mountFile: string): string[] {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(sourceModule)) return [sourceModule];

  const leadingDots = sourceModule.match(/^\.+/)?.[0].length ?? 0;
  const moduleSuffix = sourceModule.slice(leadingDots);
  let moduleParts: string[];
  if (leadingDots > 0) {
    const mountDirectory = mountFile.replace(/\\/g, '/').split('/').slice(0, -1);
    const packageBase = mountDirectory.slice(0, Math.max(0, mountDirectory.length - (leadingDots - 1)));
    moduleParts = [...packageBase, ...moduleSuffix.split('.').filter(Boolean)];
  } else {
    moduleParts = moduleSuffix.split('.').filter(Boolean);
  }

  const modulePath = moduleParts.join('/');
  return [`${modulePath}.py`, `${modulePath}/router.py`, `${modulePath}/__init__.py`];
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
    if (routePathMatchesSegments(route.path, clientSegments)) return route;
  }
  return undefined;
}

export function findMatchingRouteForMethod(
  clientPath: string,
  clientMethod: string | undefined,
  routes: readonly ServerRoute[],
): ServerRoute | undefined {
  const clientSegments = trimTrailing(clientPath).split('/');
  for (const route of routes) {
    if (!routePathMatchesSegments(route.path, clientSegments)) continue;
    if (!clientMethod || routeMethodMatches(route.method, clientMethod)) return route;
  }
  return undefined;
}

/**
 * Noise-gated route match for newer cross-stack rules.
 *
 * The older matcher intentionally returns the first path-shaped match so
 * legacy rules retain broad coverage. Newer rules that can feel speculative
 * should use this helper instead: it requires a known client method, exactly
 * one matching server route for that method, a concrete internal API path, and
 * no catch-all/wildcard route shapes.
 */
export function findHighConfidenceRouteForMethod(
  clientPath: string,
  clientMethod: string | undefined,
  routes: readonly ServerRoute[],
): ServerRoute | undefined {
  if (!isHighConfidenceClientPath(clientPath)) return undefined;
  if (!clientMethod) return undefined;

  const matches = findRoutesAtPath(clientPath, routes).filter((route) => {
    if (!route.node) return false;
    if (route.node.confidence < 0.75) return false;
    if (!route.method) return false;
    if (WILDCARD_METHODS.has(route.method.toUpperCase())) return false;
    if (!routeMethodMatches(route.method, clientMethod)) return false;
    if (!isHighConfidenceServerPath(route.path)) return false;
    return true;
  });

  return matches.length === 1 ? matches[0] : undefined;
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
    if (routePathMatchesSegments(route.path, clientSegments)) matches.push(route);
  }
  return matches;
}

function trimTrailing(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function routePathMatchesSegments(routePath: string, clientSegments: readonly string[]): boolean {
  const routeSegments = trimTrailing(routePath).split('/');
  if (routeSegments.length !== clientSegments.length) return false;
  for (let i = 0; i < routeSegments.length; i++) {
    const rs = routeSegments[i];
    const cs = clientSegments[i];
    if (isParamSegment(rs)) continue;
    if (rs !== cs) return false;
  }
  return true;
}

function isHighConfidenceClientPath(path: string): boolean {
  if (!API_PATH_RE.test(path)) return false;
  if (hasCatchAllOrWildcardSegment(path)) return false;
  const segments = trimTrailing(path).split('/').filter(Boolean);
  return segments.every((segment) => {
    if (!segment.includes('${')) return true;
    return /^\$\{[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\}$/.test(segment);
  });
}

function isHighConfidenceServerPath(path: string): boolean {
  if (!API_PATH_RE.test(path)) return false;
  return !hasCatchAllOrWildcardSegment(path);
}

function hasCatchAllOrWildcardSegment(path: string): boolean {
  return trimTrailing(path)
    .split('/')
    .some((segment) => {
      if (!segment) return false;
      if (segment === '*' || segment.includes('...')) return true;
      if (segment.startsWith('*')) return true;
      if (/^\{[^}:]+:path\}$/.test(segment)) return true;
      return false;
    });
}

// Verbs emitted by route declarations that intentionally accept any method.
const WILDCARD_METHODS = new Set(['ALL', 'ANY']);

export function routeMethodMatches(routeMethod: string | undefined, clientMethod: string): boolean {
  if (!routeMethod) return true;
  const r = routeMethod.toUpperCase();
  if (WILDCARD_METHODS.has(r)) return true;
  const c = clientMethod.toUpperCase();
  if (r === c) return true;
  // Express and Starlette/FastAPI both auto-respond to HEAD on GET routes.
  if (c === 'HEAD' && r === 'GET') return true;
  return false;
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
