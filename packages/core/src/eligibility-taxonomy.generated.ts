/** GENERATED — do not edit by hand.
 *
 *  Source of truth: packages/core/src/eligibility-taxonomy.json (human-edited).
 *  Regenerate with: node scripts/generate-eligibility-taxonomy-module.mjs
 *
 *  Grammar-sovereignty phase 2 (taxonomy AUTHORITY inversion): this typed
 *  `as const` is the PRODUCTION authority source the eligibility classifier
 *  validates its emitted reason strings against — it replaced the former
 *  runtime `node:fs` JSON read. A sync test pins this const to the JSON. */

import type { EligibilityTaxonomy } from './eligibility-taxonomy.js';

export const ELIGIBILITY_TAXONOMY = {
  $schema: 'declarative eligibility taxonomy — shadow mode, phase 1 step 2',
  description:
    'CURRENT behavior of the native-eligibility classifier, transcribed from native-eligibility-ast.ts / closure-eligibility.ts / instanceof-rhs.ts. Reason-keyed rows (verdict eligible|ineligible) are shadow-verified against the golden snapshot; contextual rows (verdict contextual, when:[imperative]) describe surface constructs whose verdict depends on shape predicates a flat row cannot evaluate — the phase-2 (consumption-inversion) backlog. No production path imports this file.',
  rows: [
    {
      construct: 'bare-block',
      verdict: 'ineligible',
      reason: 'bare-block',
      rationale: 'A bare `{ … }` block statement has no body-stmt form.',
    },
    {
      construct: 'block-bodied-arrow',
      verdict: 'contextual',
      rationale:
        'A block-bodied arrow is eligible only when every statement is in the closure accept set (let/const/return/expr/if) with no rejected construct (this/await/loop/…); otherwise one of the closure-* reasons. Verdict depends on the whole block.',
      when: ['imperative'],
    },
    {
      construct: 'break-labeled',
      verdict: 'ineligible',
      reason: 'break-labeled',
      rationale: 'A labeled `break` has no body-stmt form.',
    },
    {
      construct: 'break-outside-loop',
      verdict: 'ineligible',
      reason: 'break-outside-loop',
      rationale: 'A `break` outside any loop context.',
    },
    {
      construct: 'closure-assign-value-position',
      verdict: 'ineligible',
      reason: 'closure-assign-value-position',
      rationale: 'A value-position assignment (e.g. const y = (x = 5)) inside a block-bodied arrow.',
    },
    {
      construct: 'closure-await',
      verdict: 'ineligible',
      reason: 'closure-await',
      rationale: 'An `await` inside a block-bodied arrow — v1 closures are synchronous.',
    },
    {
      construct: 'closure-break-continue',
      verdict: 'ineligible',
      reason: 'closure-break-continue',
      rationale: 'A `break`/`continue` inside a block-bodied arrow.',
    },
    {
      construct: 'closure-class',
      verdict: 'ineligible',
      reason: 'closure-class',
      rationale: 'A class declaration/expression inside a block-bodied arrow.',
    },
    {
      construct: 'closure-destructure',
      verdict: 'ineligible',
      reason: 'closure-destructure',
      rationale: 'A destructuring declaration inside a block-bodied arrow.',
    },
    {
      construct: 'closure-incdec-value-position',
      verdict: 'ineligible',
      reason: 'closure-incdec-value-position',
      rationale: 'A value-position ++/-- (e.g. arr.push(x++)) inside a block-bodied arrow.',
    },
    {
      construct: 'closure-labeled',
      verdict: 'ineligible',
      reason: 'closure-labeled',
      rationale: 'A labeled statement inside a block-bodied arrow.',
    },
    {
      construct: 'closure-loop',
      verdict: 'ineligible',
      reason: 'closure-loop',
      rationale: 'Any loop (for/for-of/for-in/while/do) inside a block-bodied arrow — v1 closures reject loops.',
    },
    {
      construct: 'closure-nested-function',
      verdict: 'ineligible',
      reason: 'closure-nested-function',
      rationale: 'A nested arrow/function/function-declaration inside a block-bodied arrow.',
    },
    {
      construct: 'closure-parse-error',
      verdict: 'ineligible',
      reason: 'closure-parse-error',
      rationale: 'A raw closure block that does not parse as a single function body block.',
    },
    {
      construct: 'closure-spread',
      verdict: 'ineligible',
      reason: 'closure-spread',
      rationale: 'A spread element/assignment inside a block-bodied arrow.',
    },
    {
      construct: 'closure-switch',
      verdict: 'ineligible',
      reason: 'closure-switch',
      rationale: 'A `switch` inside a block-bodied arrow.',
    },
    {
      construct: 'closure-this',
      verdict: 'ineligible',
      reason: 'closure-this',
      rationale: 'A `this` usage (incl. a this-rooted assignment target) inside a block-bodied arrow.',
    },
    {
      construct: 'closure-throw',
      verdict: 'ineligible',
      reason: 'closure-throw',
      rationale: 'A `throw` inside a block-bodied arrow.',
    },
    {
      construct: 'closure-try',
      verdict: 'ineligible',
      reason: 'closure-try',
      rationale: 'A `try` inside a block-bodied arrow.',
    },
    {
      construct: 'closure-uninitialized-decl',
      verdict: 'ineligible',
      reason: 'closure-uninitialized-decl',
      rationale: 'An uninitialised `let`/`const` inside a block-bodied arrow.',
    },
    {
      construct: 'closure-unsupported-assign-target',
      verdict: 'ineligible',
      reason: 'closure-unsupported-assign-target',
      rationale: 'A destructuring/parenthesized assignment target inside a block-bodied arrow (fail-closed).',
    },
    {
      construct: 'closure-unsupported-operator',
      verdict: 'ineligible',
      reason: 'closure-unsupported-operator',
      rationale: 'An assignment operator outside {=,+=,-=,*=,/=,%=} inside a block-bodied arrow.',
    },
    {
      construct: 'closure-unsupported-stmt-',
      verdict: 'ineligible',
      reason: 'closure-unsupported-stmt-',
      rationale: 'A statement outside the closure accept set (let/const/return/expr/if) inside a block-bodied arrow.',
    },
    {
      construct: 'closure-var',
      verdict: 'ineligible',
      reason: 'closure-var',
      rationale: 'A `var` declaration inside a block-bodied arrow.',
    },
    {
      construct: 'closure-with',
      verdict: 'ineligible',
      reason: 'closure-with',
      rationale: 'A `with` statement inside a block-bodied arrow.',
    },
    {
      construct: 'closure-yield',
      verdict: 'ineligible',
      reason: 'closure-yield',
      rationale: 'A `yield` inside a block-bodied arrow.',
    },
    {
      construct: 'comments-present',
      verdict: 'ineligible',
      reason: 'comments-present',
      rationale:
        'A comment that does not sit at a migratable statement boundary; the migrator would drop it, so the body is rejected.',
    },
    {
      construct: 'continue-labeled',
      verdict: 'ineligible',
      reason: 'continue-labeled',
      rationale: 'A labeled `continue` has no body-stmt form.',
    },
    {
      construct: 'continue-outside-loop',
      verdict: 'ineligible',
      reason: 'continue-outside-loop',
      rationale: 'A `continue` outside any loop context.',
    },
    {
      construct: 'do-while-stmt',
      verdict: 'ineligible',
      reason: 'do-while-stmt',
      rationale: 'A `do…while` statement has no body-stmt form.',
    },
    {
      construct: 'empty',
      verdict: 'eligible',
      rationale: 'A whitespace-only body is trivially eligible (classifyHandlerBodyAst returns reason "empty").',
    },
    {
      construct: 'expr-stmt-assignment',
      verdict: 'ineligible',
      reason: 'expr-stmt-assignment',
      rationale: 'A compound assignment operator outside the supported set (e.g. logical &&=/??=).',
    },
    {
      construct: 'expr-stmt-bad-assign-target',
      verdict: 'ineligible',
      reason: 'expr-stmt-bad-assign-target',
      rationale: 'An assignment target that is not a valid KERN assignment target (e.g. optional-chained).',
    },
    {
      construct: 'expr-stmt-bad-assign-value',
      verdict: 'ineligible',
      reason: 'expr-stmt-bad-assign-value',
      rationale: 'An assignment value that is not a valid KERN assignment value.',
    },
    {
      construct: 'expr-stmt-bad-expr',
      verdict: 'ineligible',
      reason: 'expr-stmt-bad-expr',
      rationale: 'An expression statement that is not a valid KERN expression (e.g. comma expression).',
    },
    {
      construct: 'expr-stmt-mutation',
      verdict: 'ineligible',
      reason: 'expr-stmt-mutation',
      rationale: 'A prefix ++/-- whose source text the migrator cannot byte-reproduce (postfix is accepted).',
    },
    {
      construct: 'expression-statement',
      verdict: 'contextual',
      rationale:
        'An expression statement is eligible as a plain call/valid expression, a supported (compound) assignment, or a postfix ++/--; otherwise one of the expr-stmt-* reasons. Verdict depends on the expression shape.',
      when: ['imperative'],
    },
    {
      construct: 'for-of-async-entry',
      verdict: 'ineligible',
      reason: 'for-of-async-entry',
      rationale: 'A `for await` key-only/value-only entry binding — unsupported.',
    },
    {
      construct: 'for-of-async-object-entries',
      verdict: 'ineligible',
      reason: 'for-of-async-object-entries',
      rationale: 'A `for await` over Object.entries(...) — unsupported async-entry shape.',
    },
    {
      construct: 'for-of-bad-expr',
      verdict: 'ineligible',
      reason: 'for-of-bad-expr',
      rationale: 'The for-of iterable expression is not a valid KERN expression.',
    },
    {
      construct: 'for-of-bad-type',
      verdict: 'ineligible',
      reason: 'for-of-bad-type',
      rationale: 'A for-of binding type annotation that is not a valid KERN type annotation.',
    },
    {
      construct: 'for-of-destructure',
      verdict: 'ineligible',
      reason: 'for-of-destructure',
      rationale: 'A for-of object-destructuring binding (only [k]/[k,v]/[,v] array patterns lift).',
    },
    {
      construct: 'for-of-destructure-type',
      verdict: 'ineligible',
      reason: 'for-of-destructure-type',
      rationale: 'A type annotation on a for-of destructuring binding is unsupported.',
    },
    {
      construct: 'for-of-empty-body',
      verdict: 'ineligible',
      reason: 'for-of-empty-body',
      rationale: 'An empty for-of block body has nothing to emit.',
    },
    {
      construct: 'for-of-init',
      verdict: 'ineligible',
      reason: 'for-of-init',
      rationale: 'A for-of declarator carrying an initializer.',
    },
    {
      construct: 'for-of-loop',
      verdict: 'contextual',
      rationale:
        'A `for…of` is eligible only as a const, single-declarator, non-empty braced loop over a valid iterable with a supported binding shape; otherwise one of the for-of-* reasons. Verdict depends on header + body shape.',
      when: ['imperative'],
    },
    {
      construct: 'for-of-multi-decl',
      verdict: 'ineligible',
      reason: 'for-of-multi-decl',
      rationale: 'A for-of with more than one declarator.',
    },
    {
      construct: 'for-of-non-block',
      verdict: 'ineligible',
      reason: 'for-of-non-block',
      rationale: 'A non-block for-of body (`for (...) stmt;`); `each` always braces (strict mode).',
    },
    {
      construct: 'for-of-non-const',
      verdict: 'ineligible',
      reason: 'for-of-non-const',
      rationale: 'A for-of whose binding is not `const`.',
    },
    {
      construct: 'for-of-non-decl',
      verdict: 'ineligible',
      reason: 'for-of-non-decl',
      rationale: 'A for-of whose initializer is not a variable declaration list.',
    },
    {
      construct: 'for-of-sync-pair',
      verdict: 'ineligible',
      reason: 'for-of-sync-pair',
      rationale:
        'A sync key-only/value-only binding not over Object.entries(...) (only entries=true emits those modes).',
    },
    {
      construct: 'for-stmt',
      verdict: 'ineligible',
      reason: 'for-stmt',
      rationale: 'A C-style `for` / `for-in` statement has no body-stmt form.',
    },
    {
      construct: 'foreign-by-design',
      verdict: 'ineligible',
      reason: 'foreign-by-design',
      rationale:
        'Host-interop surface (res/process/db/req?., import(), useEffect, fetch, new Pool/AbortController) — stays a foreign boundary.',
    },
    {
      construct: 'handler-body',
      verdict: 'contextual',
      rationale:
        'The whole handler body is eligible only when it parses, is not a host-interop/template/comment boundary, and every top-level statement is eligible. The aggregate verdict is the conjunction of all per-statement verdicts.',
      when: ['imperative'],
    },
    {
      construct: 'if-bad-cond',
      verdict: 'ineligible',
      reason: 'if-bad-cond',
      rationale: 'The if-condition is not a valid KERN expression.',
    },
    {
      construct: 'if-non-block-else',
      verdict: 'ineligible',
      reason: 'if-non-block-else',
      rationale: 'A non-block, non-else-if else-branch (`else stmt;`) would lose byte-equivalence (strict mode).',
    },
    {
      construct: 'if-non-block-then',
      verdict: 'ineligible',
      reason: 'if-non-block-then',
      rationale:
        'A non-block then-branch (`if (c) stmt;`) would lose byte-equivalence; the emitter always braces (strict mode).',
    },
    {
      construct: 'if-statement',
      verdict: 'contextual',
      rationale:
        'An `if` is eligible only with a valid condition AND braced (or else-if) branches whose statements are all themselves eligible; otherwise if-bad-cond / if-non-block-then / if-non-block-else. Verdict depends on branch shape.',
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
      construct: 'instanceof-rhs-not-a-type-name',
      verdict: 'ineligible',
      reason: 'instanceof-rhs-not-a-type-name',
      rationale: 'An instanceof RHS that is not an identifier or qualified member name (call/literal/binary).',
    },
    {
      construct: 'instanceof-rhs-unsupported-builtin',
      verdict: 'ineligible',
      reason: 'instanceof-rhs-unsupported-builtin',
      rationale: 'A built-in RHS with no verified cross-target host mapping (Object/Date/Map/Set/…).',
    },
    {
      construct: 'instanceof-rhs-wrapper-rejected',
      verdict: 'ineligible',
      reason: 'instanceof-rhs-wrapper-rejected',
      rationale: 'A primitive-wrapper RHS (String/Number/Boolean) — the wrapper-parity trap; fail-closed.',
    },
    {
      construct: 'ok',
      verdict: 'eligible',
      rationale:
        'Every top-level statement (and nested if/try branch) maps to a body-statement form the migrator can emit.',
    },
    {
      construct: 'return-bad-expr',
      verdict: 'ineligible',
      reason: 'return-bad-expr',
      rationale: 'The returned expression is not a valid KERN expression.',
    },
    {
      construct: 'return-template-escapes',
      verdict: 'ineligible',
      reason: 'return-template-escapes',
      rationale: 'A returned template literal carrying a TS-only escape that diverges cross-target.',
    },
    {
      construct: 'return-template-multiline',
      verdict: 'ineligible',
      reason: 'return-template-multiline',
      rationale: 'A returned template literal containing a raw newline.',
    },
    {
      construct: 'switch-stmt',
      verdict: 'ineligible',
      reason: 'switch-stmt',
      rationale: 'A `switch` statement has no body-stmt form.',
    },
    {
      construct: 'template-literal-initializer',
      verdict: 'contextual',
      rationale:
        'A template-literal const/return is eligible when single-line with only cross-target-safe escapes; otherwise *-template-multiline / *-template-escapes. Verdict depends on the literal contents.',
      when: ['imperative'],
    },
    {
      construct: 'template-placeholder',
      verdict: 'ineligible',
      reason: 'template-placeholder',
      rationale: 'A {{ ident }} mustache placeholder in an unparseable body — a templating boundary, not a lift gap.',
    },
    {
      construct: 'throw-bad-expr',
      verdict: 'ineligible',
      reason: 'throw-bad-expr',
      rationale: 'The thrown expression is not a valid KERN expression.',
    },
    {
      construct: 'try-destruct-catch',
      verdict: 'ineligible',
      reason: 'try-destruct-catch',
      rationale: 'A destructuring catch binding (`catch ({ e })`) cannot map to the body-stmt catch name.',
    },
    {
      construct: 'try-statement',
      verdict: 'contextual',
      rationale:
        'A `try` is eligible with catch and/or finally, an identifier-named catch binding, and eligible branch bodies; a destructuring catch is try-destruct-catch and a catch/finally-less try is a parse error. Verdict depends on clause shape.',
      when: ['imperative'],
    },
    {
      construct: 'ts-parse-error',
      verdict: 'ineligible',
      reason: 'ts-parse-error',
      rationale: 'The body fails to parse as TypeScript and matches no foreign/template boundary — not migratable.',
    },
    {
      construct: 'unsupported-stmt-',
      verdict: 'ineligible',
      reason: 'unsupported-stmt-',
      rationale:
        'Any other statement kind (import/export-default-less/enum/interface/labeled/debugger/…) surfaces its SyntaxKind name.',
    },
    {
      construct: 'var-bad-expr',
      verdict: 'ineligible',
      reason: 'var-bad-expr',
      rationale: 'The initializer expression is not a valid KERN expression.',
    },
    {
      construct: 'var-bad-type',
      verdict: 'ineligible',
      reason: 'var-bad-type',
      rationale: 'The declared type annotation is not a valid KERN type annotation (round-trip-unsafe).',
    },
    {
      construct: 'var-destructure',
      verdict: 'ineligible',
      reason: 'var-destructure',
      rationale: 'A destructuring binding whose shape the migrator cannot emit (incl. uninitialised destructure).',
    },
    {
      construct: 'var-destructure-bad-expr',
      verdict: 'ineligible',
      reason: 'var-destructure-bad-expr',
      rationale: 'A destructuring initializer that is not a valid KERN expression.',
    },
    {
      construct: 'var-destructure-computed',
      verdict: 'ineligible',
      reason: 'var-destructure-computed',
      rationale: 'A computed property name ([k]) in a destructuring pattern is unsupported.',
    },
    {
      construct: 'var-destructure-default',
      verdict: 'ineligible',
      reason: 'var-destructure-default',
      rationale: 'A default value (= 1) on a destructuring element is unsupported.',
    },
    {
      construct: 'var-destructure-empty',
      verdict: 'ineligible',
      reason: 'var-destructure-empty',
      rationale: 'An empty destructuring pattern ({} / []) binds nothing.',
    },
    {
      construct: 'var-destructure-nested',
      verdict: 'ineligible',
      reason: 'var-destructure-nested',
      rationale: 'A nested destructuring pattern is unsupported.',
    },
    {
      construct: 'var-destructure-rest',
      verdict: 'ineligible',
      reason: 'var-destructure-rest',
      rationale: 'A rest element (...rest) in a destructuring pattern is unsupported.',
    },
    {
      construct: 'var-multi-decl',
      verdict: 'ineligible',
      reason: 'var-multi-decl',
      rationale: 'A declaration list with more than one declarator cannot map to a single body-stmt.',
    },
    {
      construct: 'var-non-const',
      verdict: 'ineligible',
      reason: 'var-non-const',
      rationale: 'A `var` declaration; only `const`/`let` lift.',
    },
    {
      construct: 'var-template-escapes',
      verdict: 'ineligible',
      reason: 'var-template-escapes',
      rationale:
        'A template-literal initializer carrying a TS-only escape (e.g. \\u{NNNN}) that diverges cross-target.',
    },
    {
      construct: 'var-template-multiline',
      verdict: 'ineligible',
      reason: 'var-template-multiline',
      rationale: 'A template-literal initializer containing a raw newline cannot sit in a KERN attribute value.',
    },
    {
      construct: 'variable-declaration',
      verdict: 'contextual',
      rationale:
        'A `let`/`const` is eligible only when single-declarator, identifier- or simple-pattern-named, with a valid type and a valid (or template) initializer; otherwise one of the var-* reasons. Verdict depends on declarator shape.',
      when: ['imperative'],
    },
    {
      construct: 'while-bad-cond',
      verdict: 'ineligible',
      reason: 'while-bad-cond',
      rationale: 'The while-condition is not a valid KERN expression.',
    },
    {
      construct: 'while-empty-body',
      verdict: 'ineligible',
      reason: 'while-empty-body',
      rationale: 'An empty while block body has nothing to emit.',
    },
    {
      construct: 'while-loop',
      verdict: 'contextual',
      rationale:
        'A `while` is eligible only with a valid condition and a non-empty braced body; otherwise while-bad-cond / while-non-block / while-empty-body. Verdict depends on body shape.',
      when: ['imperative'],
    },
    {
      construct: 'while-non-block',
      verdict: 'ineligible',
      reason: 'while-non-block',
      rationale: 'A non-block while body (`while (c) stmt;`); the emitter always braces (strict mode).',
    },
  ],
} as const satisfies EligibilityTaxonomy;
