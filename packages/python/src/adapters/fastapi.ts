/**
 * FastAPI adapter — revised contract (post nero red-team).
 *
 * Takes a list of framework-agnostic `PurePythonHandler` values and emits a
 * FastAPI app skin that wraps each handler in a decorated endpoint. The
 * adapter does ONLY marshalling — it builds a `PureRequest` dict from
 * FastAPI's `Request` + path/query/body, calls the pure handler, unpacks
 * the `PureResponse` tuple, and returns a `JSONResponse`. ROUTE LOWERING
 * STAYS IN THE PURE HANDLER (the adapter never re-implements derive/guard/
 * respond — that's the whole point of decoupling).
 *
 * Adapter responsibilities (the ONLY things it does):
 *   1. Wire path params from FastAPI's typed signature into PureRequest.path_params
 *      (using `PurePythonHandler.pathParamTypes` for coercion).
 *   2. Wire query params from `request.query_params` into PureRequest.query
 *      (using `PurePythonHandler.queryParamTypes` for coercion).
 *   3. Wire body — if `validatesSchema` is set, attach the existing Pydantic
 *      model as a FastAPI body param; pass `.model_dump()` into the dict.
 *      Else: `await request.json()` if content-type is JSON, else raw bytes.
 *   4. Build the PureRequest dict.
 *   5. Call the pure handler `fnName(pure_request)`.
 *   6. Unpack `(status, body[, headers])` → `JSONResponse(content=body, status_code=status, headers=headers or {})`.
 *
 * Acceptance (Phase 3a smoke + Wave 3 end-to-end):
 *   - Synthetic PureRequest fixture (hand-built in the smoke, not from any
 *     framework) → pure handler returns expected (status, body).
 *   - The existing fastapi conformance suite (194/194 fixtures) passes when
 *     routed through `pure-python + this adapter` pipeline (Wave 3).
 *
 * The current monolithic `transpiler-fastapi.ts` stays as the default until
 * Phase 3a + Phase 2 both land and a follow-up flips the wiring. This phase
 * only ADDS the adapter; it does not remove the monolith.
 */

import type { PurePythonHandler } from '../core/handlers/index.js';

export interface FastAPIAdapterArtifacts {
  /** Python source for the FastAPI app file (imports, `app = FastAPI()`, decorated endpoints). */
  appPy: string;
  /** Python source for the pure-handlers module (re-emitted as a sibling .py file the adapter imports). Phase 3a's smoke uses a synthetic version of this; in production the python target writes the real one. */
  pureHandlersPy: string;
  /** Imports the ADAPTER itself needs at the top of appPy. */
  imports: Set<string>;
}

export function emitFastAPIAdapter(_handlers: PurePythonHandler[]): FastAPIAdapterArtifacts {
  throw new Error('emitFastAPIAdapter: Phase 3a has not yet implemented the FastAPI wrapper layer.');
}
