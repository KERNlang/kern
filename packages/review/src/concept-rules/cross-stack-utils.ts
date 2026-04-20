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

/** Client URLs we consider "internal" to the reviewed project. */
export const API_PATH_RE = /^\/api\//;

export interface ServerRoute {
  path: string;
  method: string | undefined;
  /** Present when the caller needs to cite the server route in a finding. */
  node?: ConceptNode;
}

/**
 * Pull every server-side route out of a concept map. Callers typically fold
 * this across `ctx.allConcepts` to collect routes for the whole project.
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

function trimTrailing(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function isParamSegment(seg: string): boolean {
  return seg.startsWith(':') || (seg.startsWith('{') && seg.endsWith('}'));
}
