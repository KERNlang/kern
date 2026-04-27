import type { ConceptNode } from '@kernlang/core';
import type { RootCause } from '../types.js';

function methodKey(method: string | undefined, fallback = 'GET'): string {
  return (method ?? fallback).toUpperCase();
}

export function apiCallRootCause(
  clientNode: ConceptNode,
  normalizedPath: string,
  method?: string,
  routeNode?: ConceptNode,
): RootCause {
  const httpMethod = methodKey(method);
  const routePart = routeNode ? ` route=${routeNode.id}` : '';
  return {
    kind: 'api-call',
    key: `api-call client=${clientNode.id} method=${httpMethod} path=${normalizedPath}${routePart}`,
    facets: {
      clientNodeId: clientNode.id,
      method: httpMethod,
      path: normalizedPath,
      ...(routeNode ? { routeNodeId: routeNode.id } : {}),
    },
  };
}

export function routeRootCause(routeNode: ConceptNode, method?: string): RootCause {
  const name = routeNode.payload.kind === 'entrypoint' ? routeNode.payload.name : routeNode.id;
  const httpMethod = methodKey(method, 'ANY');
  return {
    kind: 'route',
    key: `route node=${routeNode.id} method=${httpMethod} path=${name}`,
    facets: {
      routeNodeId: routeNode.id,
      method: httpMethod,
      path: name,
    },
  };
}
