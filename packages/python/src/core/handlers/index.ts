/**
 * Framework-agnostic Python handler emission — Phase 2 contract.
 *
 * The `python` target (targets/python.ts) emits a list of `PurePythonHandler`
 * values; framework adapters (Phase 3: fastapi, django, asgi) take that list
 * and wrap each one in their own routing/validation skin. No FastAPI
 * imports, no Django imports, no web-framework dependencies appear in a
 * PurePythonHandler — its `bodyLines` use only stdlib + the helpers from
 * `core/expr/`. That's what makes the same handler reusable across adapters.
 *
 * Handler signature (stable contract):
 *   def <fnName>(request: PureRequest) -> PureResponse
 *
 * Where:
 *   PureRequest  = dict with keys: path_params, query, body, headers, user
 *   PureResponse = tuple[int, dict]  # (status, body)  OR
 *                  tuple[int, dict, dict]  # (status, body, extra_headers)
 *
 * Guard rejections return (status, {"detail": "..."}) — same unified shape
 * used by FastAPI and Go targets (#3 error-semantics).
 */

import type { IRNode } from '@kernlang/core';

/** A single route lowered to a framework-agnostic Python function. */
export interface PurePythonHandler {
  /** HTTP method, uppercase: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | ... */
  method: string;
  /** Route path with `:param` placeholders, e.g. `/api/users/:id`. */
  path: string;
  /** Python def name, sanitised + uniquified, e.g. `handle_get_api_users_by_id`. */
  fnName: string;
  /** Full Python `def` signature line (no body), e.g. `def handle_get_api_users(request: dict) -> tuple[int, dict]:`. */
  signature: string;
  /** Indented Python body lines (4-space indent baked in). */
  bodyLines: string[];
  /** Imports the body needs (e.g. `'import json'`, `'from typing import Any'`). */
  imports: Set<string>;
  /** Validation schema name if the route declared one, else undefined. */
  validatesSchema?: string;
}

/**
 * Phase 2 forge implements: scan the IR's server children, lower each route
 * to a `PurePythonHandler`. Mirrors the shape of `generatePortableChildFastAPI`
 * (fastapi-portable.ts) but emits FRAMEWORK-AGNOSTIC Python — no FastAPI
 * decorators, no HTTPException, no `Depends()`.
 */
export function emitPureHandlers(_serverNode: IRNode, _imports: Set<string>): PurePythonHandler[] {
  throw new Error('emitPureHandlers: Phase 2 has not yet implemented framework-agnostic handler emission.');
}
