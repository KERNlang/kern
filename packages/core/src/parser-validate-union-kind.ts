/** Slice 4 — `union kind=result|option` validator.
 *
 *  Spec: docs/language/result-option-spec.md
 *
 *  Walks every `union` node and rejects:
 *    1. `kind=<other>` — only `result` and `option` are recognised in slice 4.
 *       Empty string and ExprObject `kind={{ ... }}` also error per the
 *       slice 6 effects pattern (the prop is a literal-only string).
 *    2. `kind=result` shape — the union must declare exactly two variants
 *       named `ok` and `err` (either order). Any other variant set is a
 *       `KIND_SHAPE_VIOLATION`.
 *    3. `kind=option` shape — exactly two variants named `some` and `none`.
 *    4. `discriminant != 'kind'` on `kind=result|option` — the spec mandates
 *       `discriminant=kind` so slice 7's `?` / `!` propagation operators can
 *       check `r.kind === 'err'` uniformly across targets.
 *
 *  These rules are what make the slice 4 stdlib helpers safe — `map`,
 *  `unwrapOr`, etc. assume `x.kind === 'ok'` / `x.value` / `x.error`. The
 *  schema enforces the shape so the helpers don't need defensive checks.
 *
 *  Does NOT change codegen — unions that pass the walker emit unchanged. */

import type { ParseState } from './parser-diagnostics.js';
import { emitDiagnostic } from './parser-diagnostics.js';
import { type IRNode, isExprObject } from './types.js';

const VALID_KINDS = new Set(['result', 'option']);

const REQUIRED_VARIANTS: Record<string, ReadonlySet<string>> = {
  result: new Set(['ok', 'err']),
  option: new Set(['some', 'none']),
};

function describeKindValue(raw: unknown): string {
  if (typeof raw === 'string') return raw === '' ? '<empty>' : raw;
  if (isExprObject(raw)) return '<expression>';
  return String(raw);
}

function variantNames(node: IRNode): string[] {
  const names: string[] = [];
  for (const child of node.children || []) {
    if (child.type !== 'variant') continue;
    const name = child.props?.name;
    if (typeof name === 'string') names.push(name);
  }
  return names;
}

function validateNode(state: ParseState, node: IRNode): void {
  if (node.type === 'union') {
    const props = node.props || {};
    const kindRaw = props.kind;
    const kindPresent =
      kindRaw !== undefined && (typeof kindRaw === 'string' || isExprObject(kindRaw) || typeof kindRaw === 'boolean');

    if (kindPresent) {
      // 1. Reject any kind value other than the two recognised literals.
      if (typeof kindRaw !== 'string' || !VALID_KINDS.has(kindRaw)) {
        emitDiagnostic(
          state,
          'INVALID_UNION_KIND',
          'error',
          `\`kind=${describeKindValue(kindRaw)}\` is not a recognised union kind — slice 4 accepts \`result\` or \`option\`. See docs/language/result-option-spec.md.`,
          node.loc?.line ?? 0,
          node.loc?.col ?? 0,
        );
      } else {
        const nameProp = typeof props.name === 'string' ? props.name : '<anonymous>';

        // 4. discriminant must be `kind` — load-bearing for slice 7 propagation
        // operators (they desugar to `r.kind === 'err'`). The schema does NOT
        // default discriminant, and `generateUnion` falls back to `'type'` if
        // missing, so a `union kind=result` without `discriminant=kind` would
        // silently emit `{ type: 'ok' …}` and break the contract. Codex/Gemini
        // review fix: enforce presence (not just "if present, must equal").
        if (props.discriminant !== 'kind') {
          const got = props.discriminant === undefined ? '<missing>' : String(props.discriminant);
          emitDiagnostic(
            state,
            'KIND_SHAPE_VIOLATION',
            'error',
            `\`union name=${nameProp} kind=${kindRaw}\` must use \`discriminant=kind\` (got \`discriminant=${got}\`). The slice 7 \`?\` / \`!\` operators rely on this. See docs/language/result-option-spec.md.`,
            node.loc?.line ?? 0,
            node.loc?.col ?? 0,
          );
        } else {
          // 2/3. Variant-shape check for the two recognised kinds.
          // Gemini review fix: compare the SET of variant names so duplicates
          // like `[ok, ok]` for kind=result are rejected (the prior `every`
          // form let `length === 2 && all in required` slip through).
          const required = REQUIRED_VARIANTS[kindRaw];
          const found = variantNames(node);
          const foundSet = new Set(found);
          const sameSet =
            found.length === required.size &&
            foundSet.size === required.size &&
            [...required].every((n) => foundSet.has(n));
          if (!sameSet) {
            const expected = [...required].join(' / ');
            const got = found.length === 0 ? '<none>' : found.join(', ');
            emitDiagnostic(
              state,
              'KIND_SHAPE_VIOLATION',
              'error',
              `\`union name=${nameProp} kind=${kindRaw}\` must declare exactly the variants \`${expected}\` (got: ${got}). See docs/language/result-option-spec.md.`,
              node.loc?.line ?? 0,
              node.loc?.col ?? 0,
            );
          }
        }
      }
    }
  }

  if (node.children) {
    for (const child of node.children) validateNode(state, child);
  }
}

export function validateUnionKind(state: ParseState, root: IRNode): void {
  validateNode(state, root);
}
