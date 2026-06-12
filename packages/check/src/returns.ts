/**
 * @kernlang/check — declared-return contract checking (slice 4, FINAL).
 *
 * `checkReturns` walks every `fn` AND class `method` node that declares a
 * nominal `returns=<KnownClass>` and reports one rule:
 *
 *   - check-return-type — a `return new <Actual>()` whose `<Actual>` class is
 *                         NOT assignable to the declared return class (per
 *                         slice-1 `assignable`: subclass ACCEPT, sibling /
 *                         supertype REJECT, unknown SKIP).
 *
 * ZERO-FP SCOPE (the literal-only, SKIP-by-default v1). Mirroring slices 3/4's
 * discipline, the rule fires on exactly ONE return shape whose nominal type is
 * unambiguous WITHOUT use-def / Promise-unwrap / structural analysis:
 *
 *   - Declared type: `returns=<Name>` is checked ONLY when `<Name>` is a KNOWN
 *     class (in classByName, built first-wins via `collectClassInfos` exactly
 *     as slices 2–3). A `returns=` that is a primitive / generic / type alias /
 *     unknown name (`number`, `string`, `void`, `Promise<...>`, `User[]`, `T`)
 *     → the WHOLE fn SKIPs. (This is the #1 corpus shape — `returns=number` et
 *     al. — and the dominant FP vector; it must produce zero diagnostics.)
 *   - Return value: known ONLY when it parses to literally `new <Ident>(...)`
 *     with `<Ident>` a known class (reusing `newClassName` from `shared.ts`).
 *     EVERY other return shape SKIPs: bare ident, call (`makeDog()`,
 *     `Promise.resolve(new Dog())`), ternary, member, await, object / array
 *     literal, template, `new UnknownClass()`, `return` with no value.
 *
 * RETURN COLLECTION boundary (spec §1a): a fn's returns are the `return` nodes
 * reachable through its block children (handler / if / each / …) but NOT
 * through any nested `fn` / `method` / `class` — those returns belong to the
 * nested declaration, never the enclosing one (the nested-fn ZERO-FP fixture).
 *
 * EXPLICITLY OUT OF SCOPE (FP vectors, NOT implemented): Promise<T> unwrapping,
 * object-literal property projection, structural reconciliation, use-def / ident
 * resolution, route / handler response models, fail-fast on unknown node kinds.
 */

import { parseExpression } from '../../core/dist/parser-expression.js';
import { typescriptClosureClassifier } from '../../core/dist/typescript-closure-classifier.js';
import { assignable } from './assignable.js';
import { buildClassByName, expressionPropText, type IRNode, newClassName, stringProp, walkTree } from './shared.js';

// Slice 0.9 review fix (codex blocking) — same Node-side classifier injection
// as calls.ts: a bare parse would throw on block-bodied arrows and the
// swallowing catch would silently drop real return diagnostics.
const TS_PARSE_OPTS = { closureClassifier: typescriptClosureClassifier };
function parseExpr(input: string): ReturnType<typeof parseExpression> {
  return parseExpression(input, TS_PARSE_OPTS);
}

/** The return-check rule identifier. */
export type ReturnCheckRule = 'check-return-type';

/** A single declared-return diagnostic produced by {@link checkReturns}. */
export interface ReturnCheckDiagnostic {
  rule: ReturnCheckRule;
  /** Declaring `fn`/`method` name, when present. */
  fnName?: string;
  /** The declared `returns=` class. */
  declared: string;
  /** The actual `new <actual>()` class of the offending return. */
  actual: string;
  reason: string;
}

/**
 * Result of a {@link checkReturns} run: the diagnostics plus a non-vacuity
 * counter. `returnChecksRun` is the number of (fn, return) pairs that actually
 * REACHED the `assignable()` comparison — i.e. a known declared class AND a
 * `new <KnownClass>()` return. The acceptance wall asserts a floor on this so
 * the checker is provably non-vacuous (see acceptance-wall.test.ts).
 */
export interface ReturnCheckResult {
  diagnostics: ReturnCheckDiagnostic[];
  returnChecksRun: number;
}

/**
 * Walk a parsed KERN program and report declared-return contract violations
 * against every `fn` / `method` that declares a known-class `returns=`.
 *
 * @param root the parsed program IR (a `document`/module root).
 */
export function checkReturns(root: IRNode): ReturnCheckResult {
  const diagnostics: ReturnCheckDiagnostic[] = [];
  let returnChecksRun = 0;

  // classByName: first-wins, mirroring the validator (slice 2 / core).
  const classByName = buildClassByName(root);

  // Every fn/method ANYWHERE in the tree is a candidate declaration. A method
  // is its own node type nested under a class; a fn may be top-level or nested
  // in a handler. We visit ALL of them — the nested-fn boundary is enforced by
  // collectReturns NOT descending into nested declarations, NOT by limiting
  // which declarations we consider here.
  walkTree(root, (node) => {
    if (node.type !== 'fn' && node.type !== 'method') return;
    const declared = stringProp(node, 'returns');
    // SKIP the whole declaration unless `returns=` names a KNOWN class.
    if (declared === undefined || !classByName.has(declared)) return;

    for (const text of collectReturnTexts(node)) {
      let value: ReturnType<typeof parseExpression>;
      try {
        value = parseExpr(text);
      } catch {
        continue; // unparseable return value → SKIP silently.
      }
      const actual = newClassName(value);
      // Fire ONLY on a literal `new <KnownClass>()` return; all else SKIPs.
      if (actual === undefined || !classByName.has(actual)) continue;
      returnChecksRun += 1;
      const verdict = assignable(actual, declared, classByName);
      if (verdict.ok === false) {
        const fnName = stringProp(node, 'name');
        diagnostics.push({
          rule: 'check-return-type',
          ...(fnName !== undefined ? { fnName } : {}),
          declared,
          actual,
          reason:
            `Return value of type '${actual}' is not assignable to the declared return ` +
            `type '${declared}'. A returned value's type must be a subtype of the declared ` +
            `return type.`,
        });
      }
    }
  });

  return { diagnostics, returnChecksRun };
}

/**
 * Collect the source text of every `return` value reachable from a declaring
 * `fn`/`method`, descending through its block children (handler / if / each /
 * …) but NEVER into a nested `fn` / `method` / `class` — those returns belong
 * to the nested declaration. Returns with no `value` prop are omitted (a
 * value-less `return` SKIPs).
 */
function collectReturnTexts(decl: IRNode): string[] {
  const texts: string[] = [];
  const descend = (node: IRNode): void => {
    for (const child of node.children ?? []) {
      // A nested declaration owns its own returns — do not attribute them here.
      if (child.type === 'fn' || child.type === 'method' || child.type === 'class') continue;
      if (child.type === 'return') {
        const text = expressionPropText(child.props?.value);
        if (text !== undefined) texts.push(text);
      }
      descend(child);
    }
  };
  descend(decl);
  return texts;
}
