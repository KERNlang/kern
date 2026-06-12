/** Slice 0.9 — browser-safe closure-classifier capability seam.
 *
 *  Block-bodied arrow functions (`(x) => { … }`) need a TypeScript-AST analysis
 *  to (a) confirm the raw text parses as a single statement block and (b) decide
 *  whether the v1 closure gate accepts it. That analysis lives in
 *  `closure-eligibility.ts`, which statically imports `typescript` (~10MB).
 *
 *  To keep the parser browser-safe, `parser-expression.ts` depends ONLY on this
 *  dependency-free capability interface — never on `closure-eligibility.ts`. The
 *  TypeScript-backed implementation is provided out-of-band by
 *  `typescript-closure-classifier.ts` (Node/codegen side) and injected through
 *  `parseExpression(input, { closureClassifier })`.
 *
 *  When no classifier is injected, the default `unavailableClosureClassifier` is
 *  active: ordinary expressions and expression-bodied arrows parse normally, and
 *  ONLY block-bodied arrows fail closed with `closure-parser-unavailable`. */

/** A synchronous capability for analyzing the raw text of a block-bodied arrow
 *  body (`{ … }`, braces included). Intentionally minimal and target-agnostic:
 *  the interface is expressed in core-own types so no `ts.*` type leaks into the
 *  browser-safe surface (the parsed-block value is opaque `unknown`). */
export interface ClosureClassifier {
  /** Whether this classifier can actually analyze block bodies. The default
   *  unavailable classifier reports `false`, which makes the parser fail closed
   *  on block-bodied arrows before any parse/classify call. */
  readonly available: boolean;
  /** Parse the raw block into an opaque AST node, or `null` if it does not
   *  parse cleanly as a single statement block. */
  parseBlock(raw: string): unknown | null;
  /** Return the v1 closure-gate reject reason (e.g. `closure-this`), or `null`
   *  if the block is accepted. */
  classifyBlock(raw: string): string | null;
}

/** Target-agnostic fail-closed reason for block-bodied arrows when no closure
 *  classifier capability is injected (R2). Must NOT name a runtime
 *  (typescript/node/browser/deno/bun) — it describes the missing CAPABILITY. */
export const CLOSURE_PARSER_UNAVAILABLE_REASON = 'closure-parser-unavailable';

/** The full fail-closed diagnostic message thrown by the parser when a
 *  block-bodied arrow is encountered without a classifier capability. */
export const CLOSURE_PARSER_UNAVAILABLE_MESSAGE =
  `${CLOSURE_PARSER_UNAVAILABLE_REASON}: block-bodied arrow functions require a closure classifier ` +
  `capability, which is not provided in this environment. Use an expression-bodied arrow, or pass a ` +
  `closure classifier to parseExpression.`;

/** Dependency-free default. Active whenever no classifier is injected — keeps
 *  the parser spine free of `typescript`. `available: false` makes the parser
 *  fail closed on block-bodied arrows; `classifyBlock` reports the
 *  target-agnostic reason for any caller that inspects it directly. */
export const unavailableClosureClassifier: ClosureClassifier = {
  available: false,
  parseBlock(): unknown | null {
    return null;
  },
  classifyBlock(): string | null {
    return CLOSURE_PARSER_UNAVAILABLE_REASON;
  },
};
