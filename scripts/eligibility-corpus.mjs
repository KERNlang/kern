/**
 * Single source of truth for the native-eligibility GOLDEN SNAPSHOT corpus.
 *
 * Grammar-sovereignty phase 1, step 0-1 (snapshot). This module owns:
 *   1. CORPUS — a curated, deterministic list of minimal handler-body /
 *      closure-block snippets, one row per reason code the real classifier
 *      can emit (plus the accepted-construct families). Every snippet here was
 *      verified against the live classifier to produce the reason its comment
 *      claims; the drift-wall test re-derives the verdicts and pins them.
 *   2. ALL_REASON_CODES — the full universe of reason-code literals grepped
 *      mechanically out of the three classifier source files
 *      (native-eligibility-ast.ts + closure-eligibility.ts + instanceof-rhs.ts).
 *      The snapshot test asserts every entry here is exercised at least once,
 *      and reports any code no snippet can trigger (dead / defensive code).
 *   3. buildSnapshot() — a pure runner. Both the generator script and the
 *      drift-wall test call it, injecting the REAL classifier functions
 *      (`classifyHandlerBodyAst`, `classifyClosureBlock`) from core. Keeping
 *      the runner here guarantees the script-written JSON and the test-derived
 *      snapshot can never drift apart — they execute identical code.
 *
 * SHADOW-ONLY: this module is imported only by the snapshot script and the
 * eligibility tests. Nothing on the production path imports it.
 *
 * Each classifier is identified by a `classifier` tag:
 *   'handler-body'  → classifyHandlerBodyAst(snippet)
 *   'closure-block' → classifyClosureBlock(rawBlock)  (raw `{ … }` text)
 *
 * Closure reason codes (`closure-*`) surface through BOTH entries: through
 * 'handler-body' when the snippet wraps the block in an arrow inside a
 * statement, and directly through 'closure-block'. The 'closure-block' rows
 * exist mainly to reach `closure-parse-error`, which is unreachable from
 * 'handler-body' (a block extracted from an already-parsed arrow always
 * re-parses cleanly) — but is a real verdict of the exported closure gate the
 * existing closure tests drive directly.
 */

/** @typedef {{ snippet: string, classifier: 'handler-body' | 'closure-block' }} CorpusEntry */

/** The curated snippet corpus. Order here is irrelevant — buildSnapshot sorts
 *  the output for a stable, diff-friendly snapshot. */
/** @type {CorpusEntry[]} */
export const CORPUS = [
  // ── ELIGIBLE: accepted statement / construct families ───────────────────
  { snippet: '', classifier: 'handler-body' }, // empty
  { snippet: 'return x + 1;', classifier: 'handler-body' }, // ok (return expr)
  { snippet: 'return;', classifier: 'handler-body' }, // ok (bare return)
  { snippet: 'const x = 1;', classifier: 'handler-body' }, // ok (const)
  { snippet: 'let x = 1;', classifier: 'handler-body' }, // ok (let)
  { snippet: 'let x;', classifier: 'handler-body' }, // ok (let, no init — now eligible)
  { snippet: 'const x: number = 1;', classifier: 'handler-body' }, // ok (typed const)
  { snippet: 'const { a, b } = o;', classifier: 'handler-body' }, // ok (object destructure)
  { snippet: 'const [a, b] = pair;', classifier: 'handler-body' }, // ok (array destructure)
  { snippet: 'const { p: local } = o;', classifier: 'handler-body' }, // ok (renamed destructure)
  { snippet: 'throw err;', classifier: 'handler-body' }, // ok (throw expr)
  { snippet: 'if (c) { g(); }', classifier: 'handler-body' }, // ok (if block)
  { snippet: 'if (c) { g(); } else { h(); }', classifier: 'handler-body' }, // ok (if/else)
  { snippet: 'if (c) { g(); } else if (d) { h(); }', classifier: 'handler-body' }, // ok (else-if chain)
  { snippet: 'try { g(); } catch (e) { h(); }', classifier: 'handler-body' }, // ok (try/catch)
  { snippet: 'try { g(); } finally { cleanup(); }', classifier: 'handler-body' }, // ok (try/finally)
  { snippet: 'try { g(); } catch (e) { h(); } finally { c(); }', classifier: 'handler-body' }, // ok (catch+finally)
  { snippet: 'for (const x of xs) { g(x); }', classifier: 'handler-body' }, // ok (each loop)
  { snippet: 'for (const [k, v] of pairs) { g(k, v); }', classifier: 'handler-body' }, // ok (pair each)
  { snippet: 'for (const k of Object.entries(o)) { g(k); }', classifier: 'handler-body' }, // ok (key-only entries)
  { snippet: 'for (const x of xs) { break; }', classifier: 'handler-body' }, // ok (break in loop)
  { snippet: 'for (const x of xs) { continue; }', classifier: 'handler-body' }, // ok (continue in loop)
  { snippet: 'while (c) { g(); }', classifier: 'handler-body' }, // ok (while loop)
  { snippet: 'g();', classifier: 'handler-body' }, // ok (plain call expr stmt)
  { snippet: 'x = 1;', classifier: 'handler-body' }, // ok (plain assign)
  { snippet: 'x += 1;', classifier: 'handler-body' }, // ok (compound assign)
  { snippet: 'x++;', classifier: 'handler-body' }, // ok (postfix incr stmt)
  { snippet: 'x--;', classifier: 'handler-body' }, // ok (postfix decr stmt)
  { snippet: 'acc.total = 1;', classifier: 'handler-body' }, // ok (member write)
  { snippet: 'acc[i] = v;', classifier: 'handler-body' }, // ok (index write)
  { snippet: 'void 0;', classifier: 'handler-body' }, // ok (void expr stmt — accepted)
  { snippet: 'return `hi ${name}`;', classifier: 'handler-body' }, // ok (return template)
  { snippet: 'const t = `hi ${name}`;', classifier: 'handler-body' }, // ok (const template)
  { snippet: 'export const z = 1;', classifier: 'handler-body' }, // ok (export const — accepted)
  // closures (eligible) through handler-body
  { snippet: 'const f = (x) => { acc.push(x); };', classifier: 'handler-body' }, // ok (call on capture)
  { snippet: 'const f = (x) => { total += x; };', classifier: 'handler-body' }, // ok (free compound assign)
  { snippet: 'const f = (x) => { acc.total = x; };', classifier: 'handler-body' }, // ok (member write in closure)
  { snippet: 'const f = (x) => { count++; };', classifier: 'handler-body' }, // ok (postfix in closure)
  { snippet: 'const f = (x) => { const y = x + 1; return y; };', classifier: 'handler-body' }, // ok (local + return)
  { snippet: 'const f = (x) => { if (x) { g(x); } };', classifier: 'handler-body' }, // ok (if in closure)
  // closures (eligible) directly
  { snippet: '{ return x + 1; }', classifier: 'closure-block' }, // null (closure ok)
  { snippet: '{ acc.push(x); }', classifier: 'closure-block' }, // null (closure ok)
  { snippet: '{ total += 1; }', classifier: 'closure-block' }, // null (closure ok)
  // instanceof (eligible RHS)
  { snippet: 'return x instanceof Array;', classifier: 'handler-body' }, // ok (host RHS Array)
  { snippet: 'return e instanceof Error;', classifier: 'handler-body' }, // ok (host RHS Error)
  { snippet: 'return x instanceof TypeError;', classifier: 'handler-body' }, // ok (native RHS as-is)
  { snippet: 'return x instanceof MyClass;', classifier: 'handler-body' }, // ok (user class RHS)
  { snippet: 'return x instanceof a.b.C;', classifier: 'handler-body' }, // ok (qualified RHS)

  // ── INELIGIBLE: parse boundary / scanner reasons ────────────────────────
  { snippet: 'notify(@@@);', classifier: 'handler-body' }, // ts-parse-error
  { snippet: 'return {{ userName }};', classifier: 'handler-body' }, // template-placeholder
  { snippet: 'return res.status(200);', classifier: 'handler-body' }, // foreign-by-design
  { snippet: 'foo(/* mid */);', classifier: 'handler-body' }, // comments-present

  // ── INELIGIBLE: var family ──────────────────────────────────────────────
  { snippet: 'var x = 1;', classifier: 'handler-body' }, // var-non-const
  { snippet: 'const a = 1, b = 2;', classifier: 'handler-body' }, // var-multi-decl
  { snippet: 'const x: typeof import("fs") = v;', classifier: 'handler-body' }, // var-bad-type
  { snippet: 'const x = function () {};', classifier: 'handler-body' }, // var-bad-expr
  { snippet: 'const t = `a\nb`;', classifier: 'handler-body' }, // var-template-multiline
  { snippet: 'const t = `a\\u{1F600}b`;', classifier: 'handler-body' }, // var-template-escapes
  { snippet: 'const { a };', classifier: 'handler-body' }, // var-destructure (uninit destructure)
  { snippet: 'const { a } = function () {};', classifier: 'handler-body' }, // var-destructure-bad-expr
  { snippet: 'const {} = o;', classifier: 'handler-body' }, // var-destructure-empty
  { snippet: 'const { ...rest } = o;', classifier: 'handler-body' }, // var-destructure-rest
  { snippet: 'const { a = 1 } = o;', classifier: 'handler-body' }, // var-destructure-default
  { snippet: 'const { a: { b } } = o;', classifier: 'handler-body' }, // var-destructure-nested
  { snippet: 'const { ["k"]: v } = o;', classifier: 'handler-body' }, // var-destructure-computed

  // ── INELIGIBLE: return / throw family ───────────────────────────────────
  { snippet: 'return function () {};', classifier: 'handler-body' }, // return-bad-expr
  { snippet: 'return `a\nb`;', classifier: 'handler-body' }, // return-template-multiline
  { snippet: 'return `a\\u{1F600}b`;', classifier: 'handler-body' }, // return-template-escapes
  { snippet: 'throw function () {};', classifier: 'handler-body' }, // throw-bad-expr

  // ── INELIGIBLE: break / continue family ─────────────────────────────────
  { snippet: 'break;', classifier: 'handler-body' }, // break-outside-loop
  { snippet: 'continue;', classifier: 'handler-body' }, // continue-outside-loop
  { snippet: 'for (const x of xs) { break outer; }', classifier: 'handler-body' }, // break-labeled
  { snippet: 'for (const x of xs) { continue outer; }', classifier: 'handler-body' }, // continue-labeled

  // ── INELIGIBLE: if family ───────────────────────────────────────────────
  { snippet: 'if (function () {}) { g(); }', classifier: 'handler-body' }, // if-bad-cond
  { snippet: 'if (c) g();', classifier: 'handler-body' }, // if-non-block-then
  { snippet: 'if (c) { g(); } else h();', classifier: 'handler-body' }, // if-non-block-else

  // ── INELIGIBLE: try family ──────────────────────────────────────────────
  { snippet: 'try { g(); } catch ({ e }) {}', classifier: 'handler-body' }, // try-destruct-catch

  // ── INELIGIBLE: expression-statement family ─────────────────────────────
  { snippet: 'x &&= 2;', classifier: 'handler-body' }, // expr-stmt-assignment (logical compound)
  { snippet: 'a.b?.c = 1;', classifier: 'handler-body' }, // expr-stmt-bad-assign-target
  { snippet: 'x = function () {};', classifier: 'handler-body' }, // expr-stmt-bad-assign-value
  { snippet: '++x;', classifier: 'handler-body' }, // expr-stmt-mutation (prefix)
  { snippet: 'x = y, z;', classifier: 'handler-body' }, // expr-stmt-bad-expr (comma)

  // ── INELIGIBLE: for-of family ───────────────────────────────────────────
  { snippet: 'for (x of xs) { g(x); }', classifier: 'handler-body' }, // for-of-non-decl
  { snippet: 'for (let x of xs) { g(x); }', classifier: 'handler-body' }, // for-of-non-const
  { snippet: 'for (const x = 1 of xs) { g(x); }', classifier: 'handler-body' }, // for-of-init
  { snippet: 'for (const { a } of xs) { g(a); }', classifier: 'handler-body' }, // for-of-destructure
  { snippet: 'for await (const [k, v] of Object.entries(o)) { g(k); }', classifier: 'handler-body' }, // for-of-async-object-entries
  { snippet: 'for await (const [k] of m) { g(k); }', classifier: 'handler-body' }, // for-of-async-entry
  { snippet: 'for (const [k] of m) { g(k); }', classifier: 'handler-body' }, // for-of-sync-pair
  { snippet: 'for (const [k, v]: [string, number] of m) { g(k); }', classifier: 'handler-body' }, // for-of-destructure-type
  { snippet: 'for (const x: typeof import("fs") of xs) { g(x); }', classifier: 'handler-body' }, // for-of-bad-type
  { snippet: 'for (const x of function () {}) { g(x); }', classifier: 'handler-body' }, // for-of-bad-expr
  { snippet: 'for (const x of xs) g(x);', classifier: 'handler-body' }, // for-of-non-block
  { snippet: 'for (const x of xs) {}', classifier: 'handler-body' }, // for-of-empty-body
  { snippet: 'for (const a = 1, b = 2 of xs) { g(a); }', classifier: 'handler-body' }, // for-of-multi-decl

  // ── INELIGIBLE: while family ────────────────────────────────────────────
  { snippet: 'while (function () {}) { g(); }', classifier: 'handler-body' }, // while-bad-cond
  { snippet: 'while (c) g();', classifier: 'handler-body' }, // while-non-block
  { snippet: 'while (c) {}', classifier: 'handler-body' }, // while-empty-body

  // ── INELIGIBLE: unsupported statement kinds ─────────────────────────────
  { snippet: 'for (let i = 0; i < 3; i++) { g(i); }', classifier: 'handler-body' }, // for-stmt (C-style)
  { snippet: 'for (const k in obj) { g(k); }', classifier: 'handler-body' }, // for-stmt (for-in)
  { snippet: 'do { g(); } while (c);', classifier: 'handler-body' }, // do-while-stmt
  { snippet: 'switch (x) { case 1: break; }', classifier: 'handler-body' }, // switch-stmt
  { snippet: '{ g(); }', classifier: 'handler-body' }, // bare-block
  { snippet: 'import x from "y";', classifier: 'handler-body' }, // unsupported-stmt-ImportDeclaration
  { snippet: 'interface I {}', classifier: 'handler-body' }, // unsupported-stmt-InterfaceDeclaration

  // ── INELIGIBLE: instanceof RHS ──────────────────────────────────────────
  { snippet: 'return x instanceof String;', classifier: 'handler-body' }, // instanceof-rhs-wrapper-rejected
  { snippet: 'return x instanceof Date;', classifier: 'handler-body' }, // instanceof-rhs-unsupported-builtin
  { snippet: 'return x instanceof foo();', classifier: 'handler-body' }, // instanceof-rhs-not-a-type-name

  // ── INELIGIBLE: closure gate reasons (through handler-body arrow) ────────
  { snippet: 'const f = (x) => { this.y = 1; };', classifier: 'handler-body' }, // closure-this
  { snippet: 'const f = (x) => { await g(); };', classifier: 'handler-body' }, // closure-await
  { snippet: 'const f = (x) => { yield 1; };', classifier: 'handler-body' }, // closure-yield
  { snippet: 'const f = (x) => { foo(...a); };', classifier: 'handler-body' }, // closure-spread
  { snippet: 'const f = (x) => { for (const a of b) {} };', classifier: 'handler-body' }, // closure-loop
  { snippet: 'const f = (x) => { throw e; };', classifier: 'handler-body' }, // closure-throw
  { snippet: 'const f = (x) => { try { g(); } catch (e) {} };', classifier: 'handler-body' }, // closure-try
  { snippet: 'const f = (x) => { switch (a) {} };', classifier: 'handler-body' }, // closure-switch
  { snippet: 'const f = (x) => { break; };', classifier: 'handler-body' }, // closure-break-continue
  { snippet: 'const f = (x) => { lbl: g(); };', classifier: 'handler-body' }, // closure-labeled
  { snippet: 'const f = (x) => { with (o) {} };', classifier: 'handler-body' }, // closure-with
  { snippet: 'const f = (x) => { var y = 1; };', classifier: 'handler-body' }, // closure-var
  { snippet: 'const f = (x) => { let y; };', classifier: 'handler-body' }, // closure-uninitialized-decl
  { snippet: 'const f = (x) => { const { a } = o; };', classifier: 'handler-body' }, // closure-destructure
  { snippet: 'const f = (x) => { const g = () => 1; };', classifier: 'handler-body' }, // closure-nested-function
  { snippet: 'const f = (x) => { class C {} };', classifier: 'handler-body' }, // closure-class
  { snippet: 'const f = (x) => { x **= 1; };', classifier: 'handler-body' }, // closure-unsupported-operator
  { snippet: 'const f = (x) => { ({ a } = o); };', classifier: 'handler-body' }, // closure-unsupported-assign-target
  { snippet: 'const f = (x) => { arr.push(x++); };', classifier: 'handler-body' }, // closure-incdec-value-position
  { snippet: 'const f = (x) => { const y = (x = 5); };', classifier: 'handler-body' }, // closure-assign-value-position
  { snippet: 'const f = (x) => { import y from "z"; };', classifier: 'handler-body' }, // closure-unsupported-stmt-ImportDeclaration

  // ── INELIGIBLE: closure gate reasons (direct closure-block entry) ────────
  { snippet: 'not a block', classifier: 'closure-block' }, // closure-parse-error
];

/** The full universe of reason-code literals, grepped mechanically from the
 *  three classifier source files. The drift-wall test cross-checks this list
 *  against what `git grep` finds, so it cannot silently fall behind the source.
 *
 *  The two dynamic families are represented by a single concrete instance each
 *  (the `unsupported-stmt-<Kind>` and `closure-unsupported-stmt-<Kind>` slugs);
 *  the test matches them by prefix.
 *
 *  NOTE — four codes here are DEFENSIVE / structurally unreachable through the
 *  public classifier entries and are reported (not deleted) by the test:
 *    - throw-no-expr        (`throw;` is always a TS parse error)
 *    - try-no-catch         (`try {}` w/o catch|finally is always a parse error)
 *    - var-no-init          (uninit destructure short-circuits to var-destructure
 *                            before the var-no-init branch is reachable)
 *    - closure-param-default (params are stripped before the block is parsed;
 *                            an arrow default param fails the outer expr check)
 */
export const ALL_REASON_CODES = [
  // native-eligibility-ast.ts — eligible verdicts
  'empty',
  'ok',
  // native-eligibility-ast.ts — parse boundary / scanner
  'ts-parse-error',
  'template-placeholder',
  'foreign-by-design',
  'comments-present',
  // native-eligibility-ast.ts — var family
  'var-non-const',
  'var-multi-decl',
  'var-bad-type',
  'var-no-init',
  'var-bad-expr',
  'var-template-multiline',
  'var-template-escapes',
  'var-destructure',
  'var-destructure-bad-expr',
  'var-destructure-empty',
  'var-destructure-rest',
  'var-destructure-default',
  'var-destructure-nested',
  'var-destructure-computed',
  // native-eligibility-ast.ts — return / throw
  'return-bad-expr',
  'return-template-multiline',
  'return-template-escapes',
  'throw-no-expr',
  'throw-bad-expr',
  // native-eligibility-ast.ts — break / continue
  'break-labeled',
  'break-outside-loop',
  'continue-labeled',
  'continue-outside-loop',
  // native-eligibility-ast.ts — if family
  'if-bad-cond',
  'if-non-block-then',
  'if-non-block-else',
  // native-eligibility-ast.ts — try family
  'try-no-catch',
  'try-destruct-catch',
  // native-eligibility-ast.ts — expr-stmt family
  'expr-stmt-assignment',
  'expr-stmt-bad-assign-target',
  'expr-stmt-bad-assign-value',
  'expr-stmt-mutation',
  'expr-stmt-bad-expr',
  // native-eligibility-ast.ts — for-of family
  'for-of-non-decl',
  'for-of-non-const',
  'for-of-multi-decl',
  'for-of-init',
  'for-of-destructure',
  'for-of-async-object-entries',
  'for-of-async-entry',
  'for-of-sync-pair',
  'for-of-destructure-type',
  'for-of-bad-type',
  'for-of-bad-expr',
  'for-of-non-block',
  'for-of-empty-body',
  // native-eligibility-ast.ts — while family
  'while-bad-cond',
  'while-non-block',
  'while-empty-body',
  // native-eligibility-ast.ts — unsupported statement kinds
  'for-stmt',
  'do-while-stmt',
  'switch-stmt',
  'bare-block',
  'unsupported-stmt-', // dynamic family prefix
  // closure-eligibility.ts
  'closure-this',
  'closure-await',
  'closure-yield',
  'closure-spread',
  'closure-loop',
  'closure-throw',
  'closure-try',
  'closure-switch',
  'closure-break-continue',
  'closure-labeled',
  'closure-with',
  'closure-var',
  'closure-uninitialized-decl',
  'closure-destructure',
  'closure-nested-function',
  'closure-class',
  'closure-param-default',
  'closure-unsupported-operator',
  'closure-unsupported-assign-target',
  'closure-incdec-value-position',
  'closure-assign-value-position',
  'closure-parse-error',
  'closure-unsupported-stmt-', // dynamic family prefix
  // instanceof-rhs.ts
  'instanceof-rhs-wrapper-rejected',
  'instanceof-rhs-unsupported-builtin',
  'instanceof-rhs-not-a-type-name',
];

/** The two dynamic reason-code families, matched by prefix in the snapshot. */
export const DYNAMIC_REASON_PREFIXES = ['unsupported-stmt-', 'closure-unsupported-stmt-'];

/** Reason codes that are DEFENSIVE / structurally unreachable through the
 *  public classifier entries — no snippet can trigger them. Reported by the
 *  drift-wall test (spec step-1 "report, don't delete"). */
export const UNTRIGGERABLE_REASON_CODES = [
  'throw-no-expr',
  'try-no-catch',
  'var-no-init',
  'closure-param-default',
];

/**
 * Run the corpus through the REAL classifiers and produce the sorted, stable
 * snapshot rows. Classifiers are injected so the same runner serves both the
 * generator script (core dist) and the drift-wall test (core src→dist).
 *
 * @param {{
 *   classifyHandlerBodyAst: (body: string) => { eligible: boolean, reason: string },
 *   classifyClosureBlock: (raw: string) => string | null,
 * }} classifiers
 * @returns {{ snippet: string, classifier: string, eligible: boolean, reason: string }[]}
 */
export function buildSnapshot({ classifyHandlerBodyAst, classifyClosureBlock }) {
  const rows = CORPUS.map((entry) => {
    if (entry.classifier === 'handler-body') {
      const r = classifyHandlerBodyAst(entry.snippet);
      return { snippet: entry.snippet, classifier: entry.classifier, eligible: r.eligible, reason: r.reason };
    }
    // closure-block: classifyClosureBlock returns null when eligible, else a reason.
    const reason = classifyClosureBlock(entry.snippet);
    return {
      snippet: entry.snippet,
      classifier: entry.classifier,
      eligible: reason === null,
      reason: reason === null ? 'ok' : reason,
    };
  });
  // Deterministic ordering: by classifier, then snippet, then reason.
  rows.sort((a, b) => {
    if (a.classifier !== b.classifier) return a.classifier < b.classifier ? -1 : 1;
    if (a.snippet !== b.snippet) return a.snippet < b.snippet ? -1 : 1;
    return a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0;
  });
  return rows;
}
