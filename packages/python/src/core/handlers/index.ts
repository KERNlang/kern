/**
 * Framework-agnostic Python handler emission — revised contract (post nero red-team).
 *
 * The `python` target (targets/python.ts) emits a list of `PurePythonHandler`
 * values. Framework adapters (Phase 3: fastapi, django, asgi) take that list
 * and wrap each in their own routing/validation skin.
 *
 * KEY: the boundary is EXPLICIT. A handler consumes a `PureRequest` (a plain
 * dict whose shape is defined HERE, not borrowed from FastAPI or Django) and
 * returns a `PureResponse` (status, body, optional headers). The adapter is
 * the ONLY place that knows about its framework's native request object —
 * the pure handler never sees `fastapi.Request`, `django.http.HttpRequest`,
 * or any framework type.
 *
 * Why explicit instead of `request: dict`? nero pointed out that "request:
 * dict" silently leaks FastAPI's auto-parsed shape into the handler (FastAPI
 * gives you parsed JSON in one place, Django gives you `.POST`/`.GET`/raw
 * body in another). By specifying PureRequest's shape here, the handler is
 * portable BY CONSTRUCTION and the Phase 2 smoke can prove it: hand-build a
 * PureRequest (neither FastAPI- nor Django-shaped) and the handler still
 * works.
 *
 * EXPLICIT REQUEST/RESPONSE SHAPE (the contract every adapter must marshal to/from):
 *
 *   PureRequest:
 *     method:       str                    # 'GET' | 'POST' | ...
 *     path_params:  dict[str, str]         # already-coerced path params
 *     query:        dict[str, str|list]    # already-parsed (single or list per key)
 *     body:         Any (typically dict)   # JSON-decoded body if content-type is JSON
 *     headers:      dict[str, str]         # lowercased keys
 *     user:         Any (optional)         # auth-supplied user object, opaque to handler
 *
 *   PureResponse:
 *     tuple[int, Any]                      # (status, body) — body is JSON-serialisable
 *     tuple[int, Any, dict[str, str]]      # (status, body, extra_headers)
 *
 * Guard rejections return `(status, {"detail": "<msg>"})` — same unified
 * error shape used by the FastAPI and Go targets (#3 error-semantics).
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
  /** Full Python `def` signature line (no body): `def <fnName>(request: dict) -> tuple:`. */
  signature: string;
  /** Indented Python body lines (4-space indent baked in). */
  bodyLines: string[];
  /** Imports the body needs — STDLIB ONLY (`'import json'`, `'from typing import Any'`). NO `from fastapi import`, NO `from pydantic import`, NO `from django import`. The Phase 2 oracle enforces this. */
  imports: Set<string>;
  /** Path parameter name → Python type annotation (`{ id: 'str', count: 'int' }`). Adapter uses these to coerce path param strings. */
  pathParamTypes: Record<string, string>;
  /** Query parameter name → Python type annotation. Adapter uses these to coerce query strings. */
  queryParamTypes: Record<string, string>;
  /** Body schema reference (interface name) if the route declared `validate <name>`. Adapter uses this to attach framework validation (FastAPI: Pydantic model; Django: serializer). */
  validatesSchema?: string;
  /** Extra response headers the handler always sets (e.g. for streaming). Empty by default. */
  responseHeaders: Record<string, string>;
}

/**
 * Phase 2 forge implements: scan the IR's server children, lower each route
 * to a `PurePythonHandler`. Mirrors the shape of `generatePortableChildFastAPI`
 * (fastapi-portable.ts) for IR-node handling, BUT emits FRAMEWORK-AGNOSTIC
 * Python — no FastAPI decorators, no HTTPException, no `Depends()`, no
 * Pydantic. Bodies call `rewriteExpr` from `../expr/` for derive/guard/
 * respond expression lowering.
 *
 * The emitted Python function MUST work when invoked with a hand-constructed
 * PureRequest dict (neither FastAPI's nor Django's auto-parsed shape) —
 * the Phase 2 oracle proves this behaviorally.
 */
export function emitPureHandlers(_serverNode: IRNode, _imports: Set<string>): PurePythonHandler[] {
  throw new Error('emitPureHandlers: Phase 2 has not yet implemented framework-agnostic handler emission.');
}
