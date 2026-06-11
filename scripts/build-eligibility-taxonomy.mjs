#!/usr/bin/env node
/**
 * One-shot AUTHORING helper for packages/core/src/eligibility-taxonomy.json.
 *
 * Grammar-sovereignty phase 1, step 2 (declarative taxonomy, SHADOW mode).
 * This is NOT part of the gate or the runtime — it is the scaffold that
 * stamped out the deterministic reason-keyed rows from the golden snapshot plus
 * the hand-written rationales below, so the taxonomy covers every snapshot
 * reason code by construction. The committed JSON is the artifact; re-run this
 * only to re-stamp after the snapshot's reason set changes.
 *
 *   node scripts/build-eligibility-taxonomy.mjs        # rewrite the JSON
 *   node scripts/build-eligibility-taxonomy.mjs --check # fail if stale
 *
 * SHADOW-ONLY: nothing on the production path imports the taxonomy or this
 * script.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const SNAPSHOT_PATH = join(REPO, 'packages/core/tests/__snapshots__/eligibility-golden.json');
const TAXONOMY_PATH = join(REPO, 'packages/core/src/eligibility-taxonomy.json');

/** Hand-written rationale per reason code, transcribed from the classifier
 *  source (native-eligibility-ast.ts / closure-eligibility.ts / instanceof-rhs.ts).
 *  Describes the CURRENT behavior — not a proposal. */
const RATIONALE = {
  // eligible verdicts
  empty: 'A whitespace-only body is trivially eligible (classifyHandlerBodyAst returns reason "empty").',
  ok: 'Every top-level statement (and nested if/try branch) maps to a body-statement form the migrator can emit.',
  // parse boundary / scanner
  'ts-parse-error': 'The body fails to parse as TypeScript and matches no foreign/template boundary — not migratable.',
  'template-placeholder': 'A {{ ident }} mustache placeholder in an unparseable body — a templating boundary, not a lift gap.',
  'foreign-by-design': 'Host-interop surface (res/process/db/req?., import(), useEffect, fetch, new Pool/AbortController) — stays a foreign boundary.',
  'comments-present': 'A comment that does not sit at a migratable statement boundary; the migrator would drop it, so the body is rejected.',
  // var family
  'var-non-const': 'A `var` declaration; only `const`/`let` lift.',
  'var-multi-decl': 'A declaration list with more than one declarator cannot map to a single body-stmt.',
  'var-bad-type': 'The declared type annotation is not a valid KERN type annotation (round-trip-unsafe).',
  'var-bad-expr': 'The initializer expression is not a valid KERN expression.',
  'var-template-multiline': 'A template-literal initializer containing a raw newline cannot sit in a KERN attribute value.',
  'var-template-escapes': 'A template-literal initializer carrying a TS-only escape (e.g. \\u{NNNN}) that diverges cross-target.',
  'var-destructure': 'A destructuring binding whose shape the migrator cannot emit (incl. uninitialised destructure).',
  'var-destructure-bad-expr': 'A destructuring initializer that is not a valid KERN expression.',
  'var-destructure-empty': 'An empty destructuring pattern ({} / []) binds nothing.',
  'var-destructure-rest': 'A rest element (...rest) in a destructuring pattern is unsupported.',
  'var-destructure-default': 'A default value (= 1) on a destructuring element is unsupported.',
  'var-destructure-nested': 'A nested destructuring pattern is unsupported.',
  'var-destructure-computed': 'A computed property name ([k]) in a destructuring pattern is unsupported.',
  // return / throw
  'return-bad-expr': 'The returned expression is not a valid KERN expression.',
  'return-template-multiline': 'A returned template literal containing a raw newline.',
  'return-template-escapes': 'A returned template literal carrying a TS-only escape that diverges cross-target.',
  'throw-bad-expr': 'The thrown expression is not a valid KERN expression.',
  // break / continue
  'break-labeled': 'A labeled `break` has no body-stmt form.',
  'break-outside-loop': 'A `break` outside any loop context.',
  'continue-labeled': 'A labeled `continue` has no body-stmt form.',
  'continue-outside-loop': 'A `continue` outside any loop context.',
  // if family
  'if-bad-cond': 'The if-condition is not a valid KERN expression.',
  'if-non-block-then': 'A non-block then-branch (`if (c) stmt;`) would lose byte-equivalence; the emitter always braces (strict mode).',
  'if-non-block-else': 'A non-block, non-else-if else-branch (`else stmt;`) would lose byte-equivalence (strict mode).',
  // try family
  'try-destruct-catch': 'A destructuring catch binding (`catch ({ e })`) cannot map to the body-stmt catch name.',
  // expr-stmt family
  'expr-stmt-assignment': 'A compound assignment operator outside the supported set (e.g. logical &&=/??=).',
  'expr-stmt-bad-assign-target': 'An assignment target that is not a valid KERN assignment target (e.g. optional-chained).',
  'expr-stmt-bad-assign-value': 'An assignment value that is not a valid KERN assignment value.',
  'expr-stmt-mutation': 'A prefix ++/-- whose source text the migrator cannot byte-reproduce (postfix is accepted).',
  'expr-stmt-bad-expr': 'An expression statement that is not a valid KERN expression (e.g. comma expression).',
  // for-of family
  'for-of-non-decl': 'A for-of whose initializer is not a variable declaration list.',
  'for-of-non-const': 'A for-of whose binding is not `const`.',
  'for-of-multi-decl': 'A for-of with more than one declarator.',
  'for-of-init': 'A for-of declarator carrying an initializer.',
  'for-of-destructure': 'A for-of object-destructuring binding (only [k]/[k,v]/[,v] array patterns lift).',
  'for-of-async-object-entries': 'A `for await` over Object.entries(...) — unsupported async-entry shape.',
  'for-of-async-entry': 'A `for await` key-only/value-only entry binding — unsupported.',
  'for-of-sync-pair': 'A sync key-only/value-only binding not over Object.entries(...) (only entries=true emits those modes).',
  'for-of-destructure-type': 'A type annotation on a for-of destructuring binding is unsupported.',
  'for-of-bad-type': 'A for-of binding type annotation that is not a valid KERN type annotation.',
  'for-of-bad-expr': 'The for-of iterable expression is not a valid KERN expression.',
  'for-of-non-block': 'A non-block for-of body (`for (...) stmt;`); `each` always braces (strict mode).',
  'for-of-empty-body': 'An empty for-of block body has nothing to emit.',
  // while family
  'while-bad-cond': 'The while-condition is not a valid KERN expression.',
  'while-non-block': 'A non-block while body (`while (c) stmt;`); the emitter always braces (strict mode).',
  'while-empty-body': 'An empty while block body has nothing to emit.',
  // unsupported statement kinds
  'for-stmt': 'A C-style `for` / `for-in` statement has no body-stmt form.',
  'do-while-stmt': 'A `do…while` statement has no body-stmt form.',
  'switch-stmt': 'A `switch` statement has no body-stmt form.',
  'bare-block': 'A bare `{ … }` block statement has no body-stmt form.',
  'unsupported-stmt-': 'Any other statement kind (import/export-default-less/enum/interface/labeled/debugger/…) surfaces its SyntaxKind name.',
  // closure gate
  'closure-this': 'A `this` usage (incl. a this-rooted assignment target) inside a block-bodied arrow.',
  'closure-await': 'An `await` inside a block-bodied arrow — v1 closures are synchronous.',
  'closure-yield': 'A `yield` inside a block-bodied arrow.',
  'closure-spread': 'A spread element/assignment inside a block-bodied arrow.',
  'closure-loop': 'Any loop (for/for-of/for-in/while/do) inside a block-bodied arrow — v1 closures reject loops.',
  'closure-throw': 'A `throw` inside a block-bodied arrow.',
  'closure-try': 'A `try` inside a block-bodied arrow.',
  'closure-switch': 'A `switch` inside a block-bodied arrow.',
  'closure-break-continue': 'A `break`/`continue` inside a block-bodied arrow.',
  'closure-labeled': 'A labeled statement inside a block-bodied arrow.',
  'closure-with': 'A `with` statement inside a block-bodied arrow.',
  'closure-var': 'A `var` declaration inside a block-bodied arrow.',
  'closure-uninitialized-decl': 'An uninitialised `let`/`const` inside a block-bodied arrow.',
  'closure-destructure': 'A destructuring declaration inside a block-bodied arrow.',
  'closure-nested-function': 'A nested arrow/function/function-declaration inside a block-bodied arrow.',
  'closure-class': 'A class declaration/expression inside a block-bodied arrow.',
  'closure-unsupported-operator': 'An assignment operator outside {=,+=,-=,*=,/=,%=} inside a block-bodied arrow.',
  'closure-unsupported-assign-target': 'A destructuring/parenthesized assignment target inside a block-bodied arrow (fail-closed).',
  'closure-incdec-value-position': 'A value-position ++/-- (e.g. arr.push(x++)) inside a block-bodied arrow.',
  'closure-assign-value-position': 'A value-position assignment (e.g. const y = (x = 5)) inside a block-bodied arrow.',
  'closure-parse-error': 'A raw closure block that does not parse as a single function body block.',
  'closure-unsupported-stmt-': 'A statement outside the closure accept set (let/const/return/expr/if) inside a block-bodied arrow.',
  // instanceof RHS
  'instanceof-rhs-wrapper-rejected': 'A primitive-wrapper RHS (String/Number/Boolean) — the wrapper-parity trap; fail-closed.',
  'instanceof-rhs-unsupported-builtin': 'A built-in RHS with no verified cross-target host mapping (Object/Date/Map/Set/…).',
  'instanceof-rhs-not-a-type-name': 'An instanceof RHS that is not an identifier or qualified member name (call/literal/binary).',
};

/** Contextual construct-family rows — the IMPERATIVE-ONLY phase-2 backlog.
 *  These describe surface constructs whose verdict is NOT a single value: it is
 *  decided by shape predicates (is-block? is-const? valid-cond? supported-op?)
 *  that a flat taxonomy row cannot evaluate. They are EXCLUDED from shadow eval
 *  (no snapshot row maps to a bare construct key — every snapshot row carries a
 *  precise reason code, covered by the reason-keyed rows above). The
 *  consumption-inversion slice (steps 4-7) will express these `when` predicates;
 *  until then they are the documented backlog. */
const CONTEXTUAL_ROWS = [
  {
    construct: 'variable-declaration',
    verdict: 'contextual',
    rationale:
      'A `let`/`const` is eligible only when single-declarator, identifier- or simple-pattern-named, with a valid type and a valid (or template) initializer; otherwise one of the var-* reasons. Verdict depends on declarator shape.',
    when: ['imperative'],
  },
  {
    construct: 'if-statement',
    verdict: 'contextual',
    rationale:
      'An `if` is eligible only with a valid condition AND braced (or else-if) branches whose statements are all themselves eligible; otherwise if-bad-cond / if-non-block-then / if-non-block-else. Verdict depends on branch shape.',
    when: ['imperative'],
  },
  {
    construct: 'for-of-loop',
    verdict: 'contextual',
    rationale:
      'A `for…of` is eligible only as a const, single-declarator, non-empty braced loop over a valid iterable with a supported binding shape; otherwise one of the for-of-* reasons. Verdict depends on header + body shape.',
    when: ['imperative'],
  },
  {
    construct: 'while-loop',
    verdict: 'contextual',
    rationale:
      'A `while` is eligible only with a valid condition and a non-empty braced body; otherwise while-bad-cond / while-non-block / while-empty-body. Verdict depends on body shape.',
    when: ['imperative'],
  },
  {
    construct: 'try-statement',
    verdict: 'contextual',
    rationale:
      'A `try` is eligible with catch and/or finally, an identifier-named catch binding, and eligible branch bodies; a destructuring catch is try-destruct-catch and a catch/finally-less try is a parse error. Verdict depends on clause shape.',
    when: ['imperative'],
  },
  {
    construct: 'expression-statement',
    verdict: 'contextual',
    rationale:
      'An expression statement is eligible as a plain call/valid expression, a supported (compound) assignment, or a postfix ++/--; otherwise one of the expr-stmt-* reasons. Verdict depends on the expression shape.',
    when: ['imperative'],
  },
  {
    construct: 'block-bodied-arrow',
    verdict: 'contextual',
    rationale:
      'A block-bodied arrow is eligible only when every statement is in the closure accept set (let/const/return/expr/if) with no rejected construct (this/await/loop/…); otherwise one of the closure-* reasons. Verdict depends on the whole block.',
    when: ['imperative'],
  },
  {
    construct: 'instanceof-expression',
    verdict: 'contextual',
    rationale:
      'An `instanceof` is eligible when its RHS is an identifier outside the reject set or a qualified member name; otherwise one of the instanceof-rhs-* reasons. Verdict depends on the RHS shape.',
    when: ['imperative'],
  },
  {
    construct: 'template-literal-initializer',
    verdict: 'contextual',
    rationale:
      'A template-literal const/return is eligible when single-line with only cross-target-safe escapes; otherwise *-template-multiline / *-template-escapes. Verdict depends on the literal contents.',
    when: ['imperative'],
  },
  {
    construct: 'handler-body',
    verdict: 'contextual',
    rationale:
      'The whole handler body is eligible only when it parses, is not a host-interop/template/comment boundary, and every top-level statement is eligible. The aggregate verdict is the conjunction of all per-statement verdicts.',
    when: ['imperative'],
  },
];

function buildTaxonomy() {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));
  const eligibleByReason = new Map();
  for (const row of snapshot) {
    if (!eligibleByReason.has(row.reason)) eligibleByReason.set(row.reason, row.eligible);
  }
  // Reason-keyed deterministic rows. Replace the two dynamic-family instances in
  // the snapshot with their prefix construct so the row covers the whole family.
  const reasonRows = [];
  const seenConstructs = new Set();
  const reasonToConstruct = (reason) => {
    if (reason.startsWith('unsupported-stmt-')) return 'unsupported-stmt-';
    if (reason.startsWith('closure-unsupported-stmt-')) return 'closure-unsupported-stmt-';
    return reason;
  };
  for (const reason of [...eligibleByReason.keys()].sort()) {
    const construct = reasonToConstruct(reason);
    if (seenConstructs.has(construct)) continue;
    seenConstructs.add(construct);
    const eligible = eligibleByReason.get(reason);
    const rationale = RATIONALE[construct];
    if (!rationale) throw new Error(`Missing rationale for construct "${construct}"`);
    const row = {
      construct,
      verdict: eligible ? 'eligible' : 'ineligible',
      rationale,
    };
    if (!eligible) row.reason = construct;
    reasonRows.push(row);
  }
  const rows = [...reasonRows, ...CONTEXTUAL_ROWS].sort((a, b) =>
    a.construct < b.construct ? -1 : a.construct > b.construct ? 1 : 0,
  );
  return {
    $schema: 'declarative eligibility taxonomy — production authority (phase 2)',
    description:
      'CURRENT behavior of the native-eligibility classifier, transcribed from native-eligibility-ast.ts / closure-eligibility.ts / instanceof-rhs.ts. Reason-keyed rows (verdict eligible|ineligible) are snapshot-verified against the golden corpus AND consumed in production as the authority for emitted reasons (native-eligibility-ast.ts reject(), via the generated eligibility-taxonomy.generated.ts — no fs at runtime); contextual rows (verdict contextual, when:[imperative]) describe surface constructs whose verdict depends on shape predicates a flat row cannot evaluate — the phase-2.5 (deterministic-row extraction) backlog.',
    rows,
  };
}

const taxonomy = buildTaxonomy();
const serialized = `${JSON.stringify(taxonomy, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let onDisk;
  try {
    onDisk = readFileSync(TAXONOMY_PATH, 'utf-8');
  } catch {
    console.error(`Missing taxonomy: ${TAXONOMY_PATH}`);
    process.exit(1);
  }
  if (onDisk !== serialized) {
    console.error('eligibility-taxonomy.json is out of date. Run: node scripts/build-eligibility-taxonomy.mjs');
    process.exit(1);
  }
  console.log(`eligibility-taxonomy.json is current (${taxonomy.rows.length} rows).`);
  process.exit(0);
}

writeFileSync(TAXONOMY_PATH, serialized);
console.log(`Wrote ${taxonomy.rows.length} taxonomy rows → ${TAXONOMY_PATH}`);
