/**
 * suggest-kern-primitive — migration rule that flags JS array-method call sites
 * where an equivalent KERN primitive exists.
 *
 * Fires as `info` / precision=`experimental` so kern-sight hides it by default.
 * Opt in with `--rule suggest-kern-primitive` for a one-shot migration scan.
 *
 * Covers the 19 shipped array primitives (post PR #93 + #103):
 *   filter, find, some, every, findIndex, reduce, map, flatMap, flat, slice,
 *   at, sort, reverse, join, includes, indexOf, lastIndexOf, concat, forEach.
 *
 * Not covered (deferred to later PRs):
 *   - `.filter(Boolean)` → will route to `compact` once PR E ships.
 *   - `.map(x => x.prop)` → will route to `pluck` once PR E ships.
 *   - `[...new Set(arr)]` → will route to `unique` once PR E ships.
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
 * Build the KERN primitive suggestion string for a single JS call site.
 * Returns null when the call shape can't be cleanly migrated (e.g. block body,
 * missing required args) — caller should skip silently in those cases.
 */
function buildSuggestion(spec: MethodSpec, collection: string, call: CallExpression): string | null {
  const args = call.getArguments();
  const name = '<name>';

  switch (spec.shape) {
    case 'predicate': {
      if (args.length !== 1 || !isArrowLike(args[0])) return null;
      const arrow = args[0];
      const item = paramName(arrow, 0);
      if (!item) return null;
      const body = extractSingleExprBody(arrow);
      if (body === null) return null;
      const itemProp = item === 'item' ? '' : ` item=${item}`;
      return `${spec.kernNode} name=${name} in=${collection}${itemProp} where="${escapeKernString(body)}"`;
    }
    case 'expr': {
      if (args.length !== 1 || !isArrowLike(args[0])) return null;
      const arrow = args[0];
      const item = paramName(arrow, 0);
      if (!item) return null;
      const body = extractSingleExprBody(arrow);
      if (body === null) return null;
      const itemProp = item === 'item' ? '' : ` item=${item}`;
      return `${spec.kernNode} name=${name} in=${collection}${itemProp} expr="${escapeKernString(body)}"`;
    }
    case 'reduce': {
      if (args.length < 1 || !isArrowLike(args[0])) return null;
      const arrow = args[0];
      const acc = paramName(arrow, 0);
      const item = paramName(arrow, 1);
      if (!acc || !item) return null;
      const body = extractSingleExprBody(arrow);
      if (body === null) return null;
      const initial = args[1]?.getText();
      if (!initial) return null;
      const accProp = acc === 'acc' ? '' : ` acc=${acc}`;
      const itemProp = item === 'item' ? '' : ` item=${item}`;
      return `reduce name=${name} in=${collection}${accProp}${itemProp} initial="${escapeKernString(initial)}" expr="${escapeKernString(body)}"`;
    }
    case 'slice': {
      const parts: string[] = [`slice name=${name} in=${collection}`];
      const start = args[0]?.getText();
      const end = args[1]?.getText();
      if (start) parts.push(`start=${start}`);
      if (end) parts.push(`end=${end}`);
      return parts.join(' ');
    }
    case 'at': {
      const index = args[0]?.getText();
      if (!index) return null;
      return `at name=${name} in=${collection} index=${index}`;
    }
    case 'flat': {
      const depth = args[0]?.getText();
      return depth ? `flat name=${name} in=${collection} depth=${depth}` : `flat name=${name} in=${collection}`;
    }
    case 'join': {
      const sep = args[0]?.getText();
      return sep ? `join name=${name} in=${collection} separator=${sep}` : `join name=${name} in=${collection}`;
    }
    case 'value': {
      const value = args[0]?.getText();
      if (!value) return null;
      const from = args[1]?.getText();
      const fromProp = from ? ` from=${from}` : '';
      return `${spec.kernNode} name=${name} in=${collection} value="${escapeKernString(value)}"${fromProp}`;
    }
    case 'concat': {
      if (args.length < 1) return null;
      const withArg = args.map((a) => a.getText()).join(', ');
      return `concat name=${name} in=${collection} with="${escapeKernString(withArg)}"`;
    }
    case 'forEach': {
      if (args.length !== 1 || !isArrowLike(args[0])) return null;
      const arrow = args[0];
      const item = paramName(arrow, 0);
      if (!item) return null;
      const idx = paramName(arrow, 1);
      const idxProp = idx ? ` index=${idx}` : '';
      const itemProp = item === 'item' ? '' : ` item=${item}`;
      return `forEach in=${collection}${itemProp}${idxProp}\n  handler <<<\n    ...\n  >>>`;
    }
    case 'sort': {
      if (args.length === 0) {
        return `sort name=${name} in=${collection}  # NOTE: kern sort is immutable (spread source); TS .sort() mutates in place`;
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
      return `sort name=${name} in=${collection}${aProp}${bProp} compare="${escapeKernString(body)}"  # NOTE: kern sort is immutable`;
    }
    case 'reverse': {
      if (args.length !== 0) return null;
      return `reverse name=${name} in=${collection}  # NOTE: kern reverse is immutable`;
    }
  }
}

export function suggestKernPrimitive(ctx: RuleContext): ReviewFinding[] {
  if (shouldSkipFile(ctx)) return [];
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;

    const methodName = callee.getName();
    const spec = ARRAY_METHODS[methodName];
    if (!spec) continue;

    // Reserve .filter(Boolean) for a future `compact` primitive — don't
    // emit a noisy `filter where="Boolean(item)"` suggestion in the meantime.
    if (methodName === 'filter' && call.getArguments().length === 1) {
      const arg = call.getArguments()[0];
      if (Node.isIdentifier(arg) && arg.getText() === 'Boolean') continue;
    }

    const collection = callee.getExpression().getText();
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
