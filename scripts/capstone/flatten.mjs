/**
 * Mechanical host flattener: JSON value -> flat parent-link rows.
 *
 * This is the ONLY host-side transformation in the item-2 self-hosting
 * capstone (see .agon-goals/item2-capstone-spec.md, "structural parent-link
 * encoding v2"). It is deliberately dumb: document order, no sorting, no
 * dedup, no comparison, no key parsing. ALL comparison semantics (recursive
 * tree compare, key-order-insensitive map matching, NaN policy, diagnostics)
 * live in the .kern engine under examples/capstone-assertion-engine/.
 *
 * Row shape (one row per JSON node, document order, root always at index 0):
 *   parentIdx: number  — row index of the parent node; -1 for the root
 *   keyStr:    string  — map key VERBATIM (never escaped/parsed, it is data);
 *                        "" for array elements and the root
 *   keyIdx:    number  — array position for array elements; -1 for map
 *                        fields/root
 *   type:      string  — "null" | "bool" | "num" | "str" | "list" | "map"
 *   value:     string  — JSON.stringify for num/str/bool ("null" for null);
 *                        containers (list/map) get their child count as a
 *                        decimal string. JSON.parse already collapsed
 *                        1 vs 1.0, so this mirrors JSON's own numeric
 *                        taxonomy rather than inventing one.
 *
 * This is a BIJECTION with nested JSON: nothing is lossy (null-in-array,
 * empty containers, hostile keys are all plain typed rows).
 *
 * Known limitation (by design, not a bug): this flattener walks
 * `Object.keys(value)`, so a hand-authored JS object literal with PURELY
 * numeric-string keys (e.g. `{"2":"a","1":"b"}`) would be reordered by the
 * JS engine's own integer-key iteration rule before we ever see it — the
 * flattener cannot recover a "true" document order the host language itself
 * discarded. The capstone fixture corpus (scripts/capstone/fixtures.mjs)
 * avoids purely-numeric string keys for this reason.
 */

/** @typedef {{parentIdx: number, keyStr: string, keyIdx: number, type: string, value: string}} FlatRow */

/**
 * Flatten a JSON value into an array of FlatRow, document order, root first.
 * @param {unknown} root
 * @returns {FlatRow[]}
 */
export function flattenJson(root) {
  const rows = [];
  flattenNode(root, rows, -1, '', -1);
  return rows;
}

function flattenNode(value, rows, parentIdx, keyStr, keyIdx) {
  const idx = rows.length;
  let type;
  let val;
  if (value === null) {
    type = 'null';
    val = 'null';
  } else if (typeof value === 'boolean') {
    type = 'bool';
    val = JSON.stringify(value);
  } else if (typeof value === 'number') {
    type = 'num';
    val = JSON.stringify(value);
  } else if (typeof value === 'string') {
    type = 'str';
    val = JSON.stringify(value);
  } else if (Array.isArray(value)) {
    type = 'list';
    val = String(value.length);
  } else if (value && typeof value === 'object') {
    type = 'map';
    val = String(Object.keys(value).length);
  } else {
    throw new Error(`flattenJson: unsupported JSON value ${String(value)}`);
  }
  rows.push({ parentIdx, keyStr, keyIdx, type, value: val });
  if (type === 'list') {
    value.forEach((el, i) => flattenNode(el, rows, idx, '', i));
  } else if (type === 'map') {
    for (const k of Object.keys(value)) {
      flattenNode(value[k], rows, idx, k, -1);
    }
  }
  return idx;
}

/**
 * Escape a raw JS string into a KERN string-literal token, ready to be
 * embedded inside an OUTER double-quoted `.kern` node attribute (the
 * declarative `key="value"` node syntax nests a KERN expression string
 * inside an attribute string, so the produced literal's own quotes/
 * backslashes must be escaped a SECOND time for the outer attribute).
 *
 * kernStringLiteral('a"b') -> the text: \"a\\\"b\"
 * which, once the outer attribute quotes are stripped by the .kern parser,
 * reads back as: "a\"b" — a valid KERN string literal for the JS string
 * `a"b`.
 * @param {string} raw
 * @returns {string}
 */
export function kernStringLiteral(raw) {
  const jsonLiteral = JSON.stringify(raw);
  return jsonLiteral.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
