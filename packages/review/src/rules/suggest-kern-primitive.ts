/**
 * suggest-kern-primitive — migration rule that flags JS array-method call sites
 * where an equivalent KERN primitive exists.
 *
 * Fires as `info` / precision=`experimental` so kern-sight hides it by default.
 * Opt in with `--rule suggest-kern-primitive` for a one-shot migration scan.
 *
 * Covers the 22 shipped array primitives (post PR #93 + #103 + PR C):
 *   filter, find, some, every, findIndex, reduce, map, flatMap, flat, slice,
 *   at, sort, reverse, join, includes, indexOf, lastIndexOf, concat, forEach,
 *   compact, pluck, unique.
 *
 * Special-cased shapes (route to the narrower primitive rather than the generic one):
 *   - `.filter(Boolean)`              → `compact`
 *   - `.map(x => x.prop[.chain])`     → `pluck`
 *   - `[...new Set(coll)]`            → `unique`
 *
 * Not yet covered (deferred):
 *   - `.filter(Boolean).map(x => x.y)` pipelines stack as two findings (compact + pluck).
 *   - Template literals → needs a dedicated `fmt` rule.
 *   - Ternary JSX → needs a dedicated `conditional` rule.
 *   - async IIFE + try/catch → needs a dedicated `async` rule.
 *
 * Immutability note: TS `.sort()` and `.reverse()` mutate; KERN emits the
 * immutable `[...coll].sort(...)` / `[...coll].reverse()` shape. Suggestions
 * for those two methods include a callout so authors can audit callers before
 * migrating.
 */

import type { ArrowFunction, CallExpression, FunctionExpression, Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, ReviewRule, RuleContext } from '../types.js';
import { finding } from './utils.js';

type MethodShape =
  | 'predicate'
  | 'expr'
  | 'reduce'
  | 'slice'
  | 'at'
  | 'flat'
  | 'value'
  | 'join'
  | 'concat'
  | 'sort'
  | 'reverse'
  | 'forEach';

interface MethodSpec {
  kernNode: string;
  shape: MethodShape;
}

const ARRAY_METHODS: Record<string, MethodSpec> = {
  filter: { kernNode: 'filter', shape: 'predicate' },
  find: { kernNode: 'find', shape: 'predicate' },
  some: { kernNode: 'some', shape: 'predicate' },
  every: { kernNode: 'every', shape: 'predicate' },
  findIndex: { kernNode: 'findIndex', shape: 'predicate' },
  map: { kernNode: 'map', shape: 'expr' },
  flatMap: { kernNode: 'flatMap', shape: 'expr' },
  reduce: { kernNode: 'reduce', shape: 'reduce' },
  slice: { kernNode: 'slice', shape: 'slice' },
  at: { kernNode: 'at', shape: 'at' },
  flat: { kernNode: 'flat', shape: 'flat' },
  join: { kernNode: 'join', shape: 'join' },
  includes: { kernNode: 'includes', shape: 'value' },
  indexOf: { kernNode: 'indexOf', shape: 'value' },
  lastIndexOf: { kernNode: 'lastIndexOf', shape: 'value' },
  concat: { kernNode: 'concat', shape: 'concat' },
  forEach: { kernNode: 'forEach', shape: 'forEach' },
  sort: { kernNode: 'sort', shape: 'sort' },
  reverse: { kernNode: 'reverse', shape: 'reverse' },
};

// Node kinds whose descendants should be skipped — don't flag opportunities
// inside test files, type-only files, or generated code paths by path hint.
function shouldSkipFile(ctx: RuleContext): boolean {
  const p = ctx.filePath.toLowerCase();
  if (p.endsWith('.d.ts')) return true;
  if (p.includes('/node_modules/')) return true;
  if (p.includes('/dist/') || p.includes('/build/')) return true;
  if (p.includes('/generated/')) return true;
  return false;
}

function isArrowLike(n: TsNode | undefined): n is ArrowFunction | FunctionExpression {
  return !!n && (Node.isArrowFunction(n) || Node.isFunctionExpression(n));
}

/**
 * Extract an arrow/function body as a single expression string.
 * Returns null for block bodies (multi-statement), which aren't a clean fit
 * for an inline `where=` / `expr=` suggestion — those need a handler block.
 */
function extractSingleExprBody(arrow: ArrowFunction | FunctionExpression): string | null {
  const body = arrow.getBody();
  if (Node.isBlock(body)) return null;
  return body.getText();
}

function escapeKernString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function paramName(arrow: ArrowFunction | FunctionExpression, idx: number): string | null {
  const params = arrow.getParameters();
  if (params.length <= idx) return null;
  const name = params[idx].getName();
  // Destructured or rest parameters — skip, they don't round-trip into a bare identifier binding.
  if (name.startsWith('{') || name.startsWith('[') || name.startsWith('...')) return null;
  return name;
}

/**
 * If the arrow body is a property-access chain rooted at `item` (the first
 * parameter), return the dot-path without the item prefix. Returns null for
 * anything else — computed access, method calls, nested expressions, or
 * optional-chain segments (since `pluck` emits plain dot-access that would
 * throw if an intermediate is nullish).
 *
 *   item => item.name                 → "name"
 *   u    => u.profile.address.city    → "profile.address.city"
 *   u    => u.profile?.name           → null  (optional chain; kern `pluck` emits plain `.`)
 *   x    => x.toUpperCase()           → null  (method call, not property chain)
 *   x    => x[0]                      → null  (computed, index access)
 *   x    => x                         → null  (just the parameter, no projection)
 */
function propertyAccessChainFromItem(arrow: ArrowFunction | FunctionExpression, itemName: string): string | null {
  const body = arrow.getBody();
  if (Node.isBlock(body)) return null;
  if (!Node.isPropertyAccessExpression(body)) return null;

  const segments: string[] = [];
  let cur: TsNode = body;
  while (Node.isPropertyAccessExpression(cur)) {
    // Optional-chain segments would require KERN to emit `item.a?.b`, which
    // the current `pluck` lowering does not support. Fall back to `map`.
    if (cur.hasQuestionDotToken()) return null;
    segments.unshift(cur.getName());
    cur = cur.getExpression();
  }
  if (!Node.isIdentifier(cur) || cur.getText() !== itemName) return null;
  return segments.join('.');
}

/**
 * Is the TS text safe to inject into a KERN bare prop value (after `prop=`)?
 * KERN's bare-prop parser stops at whitespace, `{`, and `$`. Anything else
 * must be wrapped in a raw-expression form `{{ … }}` so the receiver survives
 * parsing intact.
 */
function isBareKernValue(s: string): boolean {
  return /^[A-Za-z_$][\w.$[\]]*$/.test(s);
}

/**
 * Wrap a TS expression text for use as a KERN bare prop value. Identifiers
 * and simple property paths pass through; anything else becomes a raw-
 * expression block so whitespace/operators/calls don't break parsing.
 */
function toKernInValue(s: string): string {
  return isBareKernValue(s) ? s : `{{ ${s} }}`;
}

/**
 * Build the KERN primitive suggestion string for a single JS call site.
 * Returns null when the call shape can't be cleanly migrated (e.g. block body,
 * missing required args) — caller should skip silently in those cases.
 */
function buildSuggestion(spec: MethodSpec, collection: string, call: CallExpression): string | null {
  const args = call.getArguments();
  const name = '<name>';
  // Wrap non-bare receivers (chained calls, parenthesized, whitespace) so
  // KERN bare-prop parsing doesn't truncate at the first space.
  const inVal = toKernInValue(collection);

  switch (spec.shape) {
    case 'predicate': {
      // Skip arrows whose body references the second (index) parameter —
      // KERN's predicate-form primitives don't bind an index, so migrating
      // `(x, i) => i === 0` would silently drop `i`.
      if (args.length !== 1 || !isArrowLike(args[0])) return null;
      const arrow = args[0];
      if (arrow.getParameters().length > 1) return null;
      const item = paramName(arrow, 0);
      if (!item) return null;
      const body = extractSingleExprBody(arrow);
      if (body === null) return null;
      const itemProp = item === 'item' ? '' : ` item=${item}`;
      return `${spec.kernNode} name=${name} in=${inVal}${itemProp} where="${escapeKernString(body)}"`;
    }
    case 'expr': {
      if (args.length !== 1 || !isArrowLike(args[0])) return null;
      const arrow = args[0];
      if (arrow.getParameters().length > 1) return null;
      const item = paramName(arrow, 0);
      if (!item) return null;
      const body = extractSingleExprBody(arrow);
      if (body === null) return null;
      const itemProp = item === 'item' ? '' : ` item=${item}`;
      return `${spec.kernNode} name=${name} in=${inVal}${itemProp} expr="${escapeKernString(body)}"`;
    }
    case 'reduce': {
      if (args.length < 1 || !isArrowLike(args[0])) return null;
      const arrow = args[0];
      if (arrow.getParameters().length > 2) return null;
      const acc = paramName(arrow, 0);
      const item = paramName(arrow, 1);
      if (!acc || !item) return null;
      const body = extractSingleExprBody(arrow);
      if (body === null) return null;
      const initial = args[1]?.getText();
      if (!initial) return null;
      const accProp = acc === 'acc' ? '' : ` acc=${acc}`;
      const itemProp = item === 'item' ? '' : ` item=${item}`;
      return `reduce name=${name} in=${inVal}${accProp}${itemProp} initial="${escapeKernString(initial)}" expr="${escapeKernString(body)}"`;
    }
    case 'slice': {
      const parts: string[] = [`slice name=${name} in=${inVal}`];
      const start = args[0]?.getText();
      const end = args[1]?.getText();
      if (start) parts.push(`start=${start}`);
      if (end) parts.push(`end=${end}`);
      return parts.join(' ');
    }
    case 'at': {
      const index = args[0]?.getText();
      if (!index) return null;
      return `at name=${name} in=${inVal} index=${index}`;
    }
    case 'flat': {
      const depth = args[0]?.getText();
      return depth ? `flat name=${name} in=${inVal} depth=${depth}` : `flat name=${name} in=${inVal}`;
    }
    case 'join': {
      const arg = args[0];
      if (!arg) return `join name=${name} in=${inVal}`;
      // Only string literals are safe as bare `separator=` props. Non-
      // literal separators need the raw-expression form; skip everything
      // else so the suggestion never changes runtime behavior.
      if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
        return `join name=${name} in=${inVal} separator=${arg.getText()}`;
      }
      return `join name=${name} in=${inVal} separator={{ ${arg.getText()} }}`;
    }
    case 'value': {
      const arg = args[0];
      if (!arg) return null;
      const value = arg.getText();
      // String literals can safely ride inside the double-quoted `value=`
      // prop (with escaping). Non-literal values need the raw-expression
      // form so the parser doesn't treat an identifier as a literal string.
      const valueProp =
        Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)
          ? `value="${escapeKernString(value)}"`
          : `value={{ ${value} }}`;
      const from = args[1]?.getText();
      const fromProp = from ? ` from=${from}` : '';
      return `${spec.kernNode} name=${name} in=${inVal} ${valueProp}${fromProp}`;
    }
    case 'concat': {
      if (args.length < 1) return null;
      const withArg = args.map((a) => a.getText()).join(', ');
      return `concat name=${name} in=${inVal} with={{ ${withArg} }}`;
    }
    case 'forEach': {
      if (args.length !== 1 || !isArrowLike(args[0])) return null;
      const arrow = args[0];
      const item = paramName(arrow, 0);
      if (!item) return null;
      const idx = paramName(arrow, 1);
      const idxProp = idx ? ` index=${idx}` : '';
      const itemProp = item === 'item' ? '' : ` item=${item}`;
      return `forEach in=${inVal}${itemProp}${idxProp}\n  handler <<<\n    ...\n  >>>`;
    }
    case 'sort': {
      if (args.length === 0) {
        return `sort name=${name} in=${inVal}  # NOTE: kern sort is immutable (spread source); TS .sort() mutates in place`;
      }
      if (!isArrowLike(args[0])) return null;
      const arrow = args[0];
      const a = paramName(arrow, 0);
      const b = paramName(arrow, 1);
      if (!a || !b) return null;
      const body = extractSingleExprBody(arrow);
      if (body === null) return null;
      const aProp = a === 'a' ? '' : ` a=${a}`;
      const bProp = b === 'b' ? '' : ` b=${b}`;
      return `sort name=${name} in=${inVal}${aProp}${bProp} compare="${escapeKernString(body)}"  # NOTE: kern sort is immutable`;
    }
    case 'reverse': {
      if (args.length !== 0) return null;
      return `reverse name=${name} in=${inVal}  # NOTE: kern reverse is immutable`;
    }
  }
}

export function suggestKernPrimitive(ctx: RuleContext): ReviewFinding[] {
  if (shouldSkipFile(ctx)) return [];
  const findings: ReviewFinding[] = [];

  // `[...new Set(coll)]` → route to the dedicated `unique` primitive.
  for (const arr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression)) {
    const elements = arr.getElements();
    if (elements.length !== 1) continue;
    const first = elements[0];
    if (!Node.isSpreadElement(first)) continue;
    const spread = first.getExpression();
    if (!Node.isNewExpression(spread)) continue;
    if (spread.getExpression().getText() !== 'Set') continue;
    const args = spread.getArguments();
    if (args.length !== 1) continue;
    const source = args[0].getText();
    findings.push(
      finding(
        'suggest-kern-primitive',
        'info',
        'pattern',
        'JS [...new Set(...)] could migrate to KERN `unique` — named primitive for dedup',
        ctx.filePath,
        arr.getStartLineNumber(),
        1,
        { suggestion: `unique name=<name> in=${toKernInValue(source)}` },
      ),
    );
  }

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;

    const methodName = callee.getName();
    const spec = ARRAY_METHODS[methodName];
    if (!spec) continue;

    const collection = callee.getExpression().getText();
    const collectionIn = toKernInValue(collection);

    // `.filter(Boolean)` → route to the dedicated `compact` primitive.
    if (methodName === 'filter' && call.getArguments().length === 1) {
      const arg = call.getArguments()[0];
      if (Node.isIdentifier(arg) && arg.getText() === 'Boolean') {
        findings.push(
          finding(
            'suggest-kern-primitive',
            'info',
            'pattern',
            'JS .filter(Boolean) could migrate to KERN `compact` — named primitive for drop-falsy',
            ctx.filePath,
            call.getStartLineNumber(),
            1,
            { suggestion: `compact name=<name> in=${collectionIn}` },
          ),
        );
        continue;
      }
    }

    // `.map(x => x.prop[.chain])` → route to the dedicated `pluck` primitive.
    // Only fires on single-param arrows (to skip `(x, i) => ...` which KERN
    // can't represent) and non-optional property chains.
    if (methodName === 'map' && call.getArguments().length === 1) {
      const arg = call.getArguments()[0];
      if (isArrowLike(arg) && arg.getParameters().length === 1) {
        const item = paramName(arg, 0);
        if (item) {
          const path = propertyAccessChainFromItem(arg, item);
          if (path) {
            findings.push(
              finding(
                'suggest-kern-primitive',
                'info',
                'pattern',
                'JS .map(x => x.<prop>) could migrate to KERN `pluck` — named primitive for property extraction',
                ctx.filePath,
                call.getStartLineNumber(),
                1,
                {
                  suggestion:
                    item === 'item'
                      ? `pluck name=<name> in=${collectionIn} prop=${path}`
                      : `pluck name=<name> in=${collectionIn} item=${item} prop=${path}`,
                },
              ),
            );
            continue;
          }
        }
      }
    }

    const suggestion = buildSuggestion(spec, collection, call);
    if (!suggestion) continue;

    findings.push(
      finding(
        'suggest-kern-primitive',
        'info',
        'pattern',
        `JS .${methodName}(…) could migrate to KERN \`${spec.kernNode}\` — one declarative binding instead of a handler-embedded call`,
        ctx.filePath,
        call.getStartLineNumber(),
        call.getStart() - call.getSourceFile().getFullText().lastIndexOf('\n', call.getStart()),
        { suggestion },
      ),
    );
  }

  return findings;
}

export const suggestKernPrimitiveRules: ReviewRule[] = [suggestKernPrimitive];
