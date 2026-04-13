/**
 * Shared types and constants for the FastAPI transpiler.
 */

import type { GeneratedArtifact, IRNode } from '@kernlang/core';

export const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

export interface MiddlewareArtifactRef {
  artifact: GeneratedArtifact;
  className: string;
  fileBase: string;
}

export interface RouteArtifactRef {
  artifact: GeneratedArtifact;
  routerName: string;
  fileBase: string;
}

export interface SchemaShape {
  body?: string;
  params?: string;
  query?: string;
  response?: string;
}

export interface RouteCapabilities {
  hasStream: boolean;
  hasSpawn: boolean;
  hasTimer: boolean;
  streamNode?: IRNode;
  spawnNode?: IRNode;
  timerNode?: IRNode;
}

export interface MiddlewareUsage {
  importLine?: string;
  addLine: string;
}

export interface WebSocketArtifactRef {
  artifact: GeneratedArtifact;
  funcName: string;
  fileBase: string;
  wsPath: string;
}
