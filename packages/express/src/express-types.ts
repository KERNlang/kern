import type { IRNode } from '@kernlang/core';
import { getFirstChild } from '@kernlang/core';

export const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

export interface MiddlewareArtifactRef {
  artifact: import('@kernlang/core').GeneratedArtifact;
  exportName: string;
  fileBase: string;
}

export interface RouteArtifactRef {
  artifact: import('@kernlang/core').GeneratedArtifact;
  registerName: string;
  fileBase: string;
}

export interface SchemaShape {
  body?: string;
  params?: string;
  query?: string;
  response?: string;
}

export interface MiddlewareUsage {
  importLine?: string;
  invocation: string;
}

// ── Route capability analysis ────────────────────────────────────────────

export interface RouteCapabilities {
  hasStream: boolean;
  hasSpawn: boolean;
  hasTimer: boolean;
  streamNode?: IRNode;
  spawnNode?: IRNode;
  timerNode?: IRNode;
  needsAbortController: boolean;
  needsChildProcess: boolean;
}

export function analyzeRouteCapabilities(routeNode: IRNode): RouteCapabilities {
  const streamNode = getFirstChild(routeNode, 'stream');
  // spawn must be inside stream (for SSE output), not standalone on route
  const spawnNode = streamNode ? getFirstChild(streamNode, 'spawn') : undefined;
  const timerNode = getFirstChild(routeNode, 'timer');

  const hasStream = !!streamNode;
  const hasSpawn = !!spawnNode;
  const hasTimer = !!timerNode;

  return {
    hasStream,
    hasSpawn,
    hasTimer,
    streamNode,
    spawnNode,
    timerNode,
    needsAbortController: hasStream || hasSpawn || hasTimer,
    needsChildProcess: hasSpawn,
  };
}

export interface KeyTypeInfo {
  key: string;
  type: string;  // 'string' | 'number' | 'boolean' | 'object' — JS typeof categories
}

export interface CoreArtifactRef {
  artifact: import('@kernlang/core').GeneratedArtifact;
  importPath: string;
  exportNames: string[];
}
