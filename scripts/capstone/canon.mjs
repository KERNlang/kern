/**
 * The TS assertion core, verbatim, per the item-2 capstone's acceptance
 * target: .agon-goals/item2-capstone-spec.md cites scripts/conformance.mjs:1662
 *   canon(v, mode) = JSON.stringify(mode === 'shape' ? shapeOf(v) : sortValue(v))
 *
 * This is a DELIBERATE, CITED duplicate (not a re-import) — conformance.mjs
 * runs top-level side effects on load (mkdtempSync, an exit handler, etc.)
 * and is not import-safe. shapeOf/sortValue/canon are small, stable,
 * side-effect-free pure functions; copying them here keeps the capstone
 * harness independent of conformance.mjs's runnable-script shape while
 * staying byte-identical to the acceptance target's own definition.
 * Keep this in sync with scripts/conformance.mjs if that definition ever
 * changes.
 */

export function shapeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.map(shapeOf);
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = shapeOf(v[k]);
    return o;
  }
  return typeof v;
}

export function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortValue(v[k]);
    return o;
  }
  return v;
}

export const canon = (v, mode) => JSON.stringify(mode === 'shape' ? shapeOf(v) : sortValue(v));

/** Verdict the TS assertion core reaches for a fixture pair, in 'value' mode
 *  (the only mode the capstone .kern engine implements). */
export function tsVerdict(a, b) {
  return canon(a, 'value') === canon(b, 'value') ? 'PASS' : 'FAIL';
}
