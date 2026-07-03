/**
 * Shared fixture corpus for the item-2 self-hosting capstone.
 *
 * Single source of truth consumed by BOTH legs of the parity check
 * (scripts/check-capstone-assertion-engine.mjs):
 *   - the TS assertion core leg: scripts/capstone/canon.mjs's `canon()`
 *     (a verbatim copy of scripts/conformance.mjs:1662's canon/sortValue/
 *     shapeOf) computes the expected PASS/FAIL verdict for each `a`/`b`
 *     pair.
 *   - the .kern engine leg: scripts/capstone/gen-fixtures-kern.mjs flattens
 *     each `a`/`b` pair (scripts/capstone/flatten.mjs) and regenerates
 *     examples/capstone-assertion-engine/main.kern, which is executed by
 *     `kern run` and printed as result lines.
 *
 * Each fixture documents the specific wrong-implementation it kills (see
 * .agon-goals/item2-capstone-spec.md, "Discriminating fixtures").
 */

/** @typedef {{id: string, a: unknown, b: unknown, why: string}} CapstoneFixture */

/** @type {CapstoneFixture[]} */
export const FIXTURES = [
  {
    id: 'nan-isolation',
    a: [Number.NaN, 1],
    b: [Number.NaN, 2],
    why:
      'must FAIL at index [1], not [0] — kills a wrong-impl that leaks IEEE-754 ' +
      'self-inequality (NaN !== NaN) into structural compare instead of using the ' +
      'same JSON.stringify canonicalization the TS assertion core uses (which ' +
      'collapses NaN to the token "null" on both sides, so index [0] MATCHES).',
  },
  {
    id: 'key-order-insensitive',
    a: { a: 1, b: 2 },
    b: { b: 2, a: 1 },
    why:
      'must PASS — kills positional/document-order key compare; in the flat ' +
      'encoding this specifically kills "compare document-order rows without ' +
      'sorting the keys first".',
  },
  {
    id: 'deep-descent',
    a: { a: { b: { c: { d: 1 } } } },
    b: { a: { b: { c: { d: 2 } } } },
    why:
      'must FAIL at the exact leaf path a.b.c.d — kills depth-truncated traversal ' +
      '(an impl that stops descending early would falsely PASS) and wrong ' +
      'path-escaping (an impl deriving structure from an escaped path string ' +
      'instead of parent links would misreport the path).',
  },
  {
    id: 'type-confusion',
    a: { a: null, b: [] },
    b: { a: {}, b: {} },
    why:
      'must FAIL — kills a tag-ignoring compare that only looks at childCount ' +
      '(null has no children, an empty map has 0 children — a compare that ' +
      'skips the type tag would see "0 children" on both sides of `a` and ' +
      'wrongly PASS it). NOTE: sorted-key compare short-circuits at key "a" ' +
      '(null vs map), so the list-vs-map pair on `b` is NOT exercised here — ' +
      'the empty-list-vs-empty-map fixture isolates that kill.',
  },
  {
    id: 'empty-list-vs-empty-map',
    a: { x: [] },
    b: { x: {} },
    why:
      'must FAIL with a type mismatch at path x — the ONLY difference is an ' +
      'empty list vs an empty map (both flatten to childCount "0"), so this is ' +
      'the lone fixture isolating the list/map TYPE-TAG check on empty ' +
      'containers: a tag-ignoring compare (0 children == 0 children, value ' +
      '"0" == "0") would wrongly PASS it and survive every other fixture in ' +
      'the corpus (type-confusion short-circuits at key "a" before reaching ' +
      'its list-vs-map pair).',
  },
  {
    id: 'hostile-key-dotted',
    a: { 'a.b': 1 },
    b: { a: { b: 1 } },
    why:
      'must FAIL — kills any impl that re-derives structure from key strings ' +
      '(escaping/parsing "a.b") instead of the parent-link rows; {"a.b":1} is a ' +
      'ONE-row-deep map, {a:{b:1}} is TWO rows deep with distinct keys "a" then "b".',
  },
  {
    id: 'hostile-key-empty',
    a: { '': 1 },
    b: {},
    why:
      'must FAIL — kills an impl that treats an empty-string key as "no key" and ' +
      'therefore ignores/drops the row; {"":1} has one child, {} has zero.',
  },
  {
    id: 'hostile-key-bracket',
    a: { '[0]': 'x' },
    b: ['x'],
    why:
      'must FAIL — kills an impl that re-parses a key string that LOOKS like an ' +
      'array-index token ("[0]") into an actual array index; a map with key ' +
      '"[0]" is not a list.',
  },
  {
    id: 'duplicate-length-prefix',
    a: ['ab', 'c'],
    b: ['a', 'bc'],
    why:
      'must FAIL at index [0] ("ab" vs "a") — kills any compare that reduces an ' +
      'array to a joined string ("ab"+"c" === "a"+"bc" === "abc") instead of ' +
      'comparing elements position by position.',
  },
  {
    id: 'sort-stability',
    a: { x: 'vx', 'x.': 'vdot', x0: 'v0' },
    b: { x0: 'v0', x: 'vx', 'x.': 'vdot' },
    why:
      'must PASS — same key/value pairs in different document order, with keys ' +
      'chosen ("x", "x.", "x0") so a comparator that does not respect the true ' +
      'lexicographic order (\'.\' 0x2E sorts before \'0\' 0x30, and "x" is a ' +
      'proper prefix of both) mis-pairs keys across the two sorted lists and ' +
      'reports a false mismatch.',
  },
  {
    id: 'sibling-identity',
    a: { a: { x: 1 }, b: { x: 2 } },
    b: { a: { x: 2 }, b: { x: 1 } },
    why:
      'must FAIL — kills a parent-link compare that matches children GLOBALLY ' +
      '(by type/value alone) instead of per-parent: a.x=1 must compare against ' +
      'b.a.x=2 (its OWN sibling under "a"), not against some other x=1 elsewhere ' +
      'in the tree.',
  },
  {
    id: 'happy-path-scalar',
    a: 42,
    b: 42,
    why: 'baseline sanity — identical scalar roots must PASS.',
  },
  {
    id: 'happy-path-mismatch',
    a: { status: 'ok', count: 3 },
    b: { status: 'ok', count: 4 },
    why: 'baseline sanity — a single differing leaf must FAIL at that leaf only.',
  },
];
