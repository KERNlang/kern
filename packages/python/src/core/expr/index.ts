/**
 * Shared Python expression lowering — framework-agnostic.
 *
 * PHASE 1 CONTRACT (re-export shim, to be replaced by the Phase 1 forge):
 * The Phase 1 forge MOVES the bodies of `rewriteFastAPIExpr` and the
 * helper preamble constants OUT of `fastapi-response.ts` and
 * `codegen-body-python.ts` INTO this module, then deletes the originals.
 * Every existing call site (currently importing from the old locations)
 * is updated to import from here. The re-exports below keep the source
 * tree green during the move so the structural assertion
 *   grep -c '^export function rewriteFastAPIExpr' packages/python/src/fastapi-response.ts
 *   == 0
 * fires when (and only when) the body has actually been relocated.
 *
 * Rename note: `rewriteFastAPIExpr` is re-exported AS `rewriteExpr` because
 * the function is framework-agnostic (it lowers portable JS expressions to
 * Python; nothing about it is FastAPI-specific). The old name remains as
 * an alias in the framework adapter layer (Phase 3) for back-compat.
 */

export {
  KERN_FMT_HELPER_PY,
  KERN_I32_HELPER_PY,
  KERN_JS_HELPER_PY,
  KERN_PAIR_HELPERS_PY,
  KERN_TMOD_HELPER_PY,
} from '../../codegen-body-python.js';
export { extractExprCode, rewriteFastAPIExpr as rewriteExpr } from '../../fastapi-response.js';
