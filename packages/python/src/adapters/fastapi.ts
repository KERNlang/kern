/**
 * FastAPI adapter — Phase 3a contract.
 *
 * Takes a list of framework-agnostic `PurePythonHandler` values (from the
 * `python` target) and emits a FastAPI app skin that wraps each handler in
 * a decorated endpoint with Pydantic validation. The handler body is
 * IMPORTED from the pure-python module — the adapter only does request
 * marshalling (build the PureRequest dict from FastAPI's `Request`/path-
 * params/body model) and response unpacking ((status, body) → JSONResponse).
 *
 * Acceptance: the existing FastAPI conformance fixtures must continue to
 * pass when routed via the adapter (no behaviour change visible to a
 * conformance HTTP probe). The current monolithic `transpiler-fastapi.ts`
 * stays as the default until the adapter ships; after Phase 3a lands the
 * monolith is retired in favour of `pure-python + adapter`.
 */

import type { PurePythonHandler } from '../core/handlers/index.js';

export interface FastAPIAdapterArtifacts {
  /** Python source for the FastAPI app file (imports, app = FastAPI(), decorated endpoints). */
  appPy: string;
  /** Imports the adapter itself needs (e.g. `'from fastapi import FastAPI, Request'`). */
  imports: Set<string>;
}

export function emitFastAPIAdapter(_handlers: PurePythonHandler[]): FastAPIAdapterArtifacts {
  throw new Error('emitFastAPIAdapter: Phase 3a has not yet implemented the FastAPI wrapper layer.');
}
