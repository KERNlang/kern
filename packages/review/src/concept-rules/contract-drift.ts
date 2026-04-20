/**
 * Rule: contract-drift
 *
 * Cross-stack rule — fires when a frontend (TS) network call targets an API
 * path that has no matching server-side route in the reviewed project.
 *
 * This is the moat rule for TS ↔ Python projects: Pydantic schemas drift,
 * endpoints get renamed, frontend hits `/api/users/:id` but the FastAPI
 * handler was moved to `/api/v2/users/:id`. ESLint and Bandit can't see
 * this because they each only see one side of the wire.
 *
 * v1 scope: URL-path drift only (is there a server for this client?). Body
 * shape / Pydantic field correlation is a follow-up once the mappers emit
 * body concepts — see the TODO comments in ts-concepts.ts / review-python.
 *
 * Requires graph mode: `ctx.allConcepts` must be populated. Single-file
 * review silently returns no findings (can't correlate from one file).
 */

import type { ConceptMap, ConceptNode } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import type { ConceptRuleContext } from './index.js';

const API_PATH_RE = /^\/api\//;

interface ServerRoute {
  path: string;
  method: string | undefined;
  node: ConceptNode;
}

interface ClientCall {
  target: string;
  normalizedPath: string;
  node: ConceptNode;
}

export function contractDrift(ctx: ConceptRuleContext): ReviewFinding[] {
  // Graph mode only — URL correlation is useless within a single file.
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes: ServerRoute[] = [];
  const clientCalls: ClientCall[] = [];

  for (const [, conceptMap] of ctx.allConcepts) {
    collect(conceptMap, serverRoutes, clientCalls);
  }

  // Rule gate: need at least one route AND one client call, otherwise the
  // project isn't a full-stack app and we'd fire on every external API hit.
  if (serverRoutes.length === 0 || clientCalls.length === 0) return [];

  const findings: ReviewFinding[] = [];

  for (const call of clientCalls) {
    // Only report on calls that happen in files from the reviewed project —
    // avoids firing on third-party SDK targets.
    if (call.node.primarySpan.file !== ctx.filePath) continue;
    if (hasMatchingRoute(call.normalizedPath, serverRoutes)) continue;

    findings.push({
      source: 'kern',
      ruleId: 'contract-drift',
      severity: 'warning',
      category: 'bug',
      message: `Frontend calls \`${call.target}\` but no server-side route matches this path in the reviewed project. Either the endpoint was renamed/removed on the backend or the frontend is targeting the wrong URL.`,
      primarySpan: call.node.primarySpan,
      fingerprint: createFingerprint('contract-drift', call.node.primarySpan.startLine, call.node.primarySpan.startCol),
      confidence: call.node.confidence * 0.7, // heuristic — we don't yet know the HTTP method of the fetch
    });
  }

  return findings;
}

function collect(map: ConceptMap, routes: ServerRoute[], calls: ClientCall[]): void {
  for (const node of map.nodes) {
    if (node.kind === 'entrypoint' && node.payload.kind === 'entrypoint' && node.payload.subtype === 'route') {
      const path = node.payload.name;
      if (typeof path !== 'string' || !path.startsWith('/')) continue;
      routes.push({ path, method: node.payload.httpMethod, node });
      continue;
    }

    if (node.kind === 'effect' && node.payload.kind === 'effect' && node.payload.subtype === 'network') {
      const target = node.payload.target;
      if (typeof target !== 'string') continue;
      const normalized = normalizeClientUrl(target);
      if (!normalized || !API_PATH_RE.test(normalized)) continue;
      calls.push({ target, normalizedPath: normalized, node });
    }
  }
}

/**
 * Strip scheme/host, query string, and fragment from a client URL so it can
 * match against a server route template. Returns undefined when the input
 * isn't a recognisable path (e.g. a bare variable reference).
 */
function normalizeClientUrl(raw: string): string | undefined {
  let url = raw.trim();
  // Bail on unresolved template expressions — we can't match them structurally.
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
 * Server templates may contain params — Express/Koa `:id`, FastAPI `{id}` —
 * which match any single segment. Trailing slashes are normalised away on
 * both sides.
 */
function hasMatchingRoute(clientPath: string, routes: ServerRoute[]): boolean {
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
    if (matched) return true;
  }
  return false;
}

function trimTrailing(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function isParamSegment(seg: string): boolean {
  return seg.startsWith(':') || (seg.startsWith('{') && seg.endsWith('}'));
}
