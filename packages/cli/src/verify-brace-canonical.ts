/**
 * Opt-in `--canonicalize-braces` migration-verify comparator (W2).
 *
 * The default `kern migrate native-handlers --verify` requires the compiled
 * TypeScript to stay BYTE-identical before/after. That rejects the
 * `if-non-block-then` / `while-non-block` / `for-of-non-block` lift, because the
 * native-KERN emitter always braces control-flow bodies: `if (x) return x;`
 * re-emits as `if (x) { return x; }` — a real byte difference.
 *
 * `isBraceOnlyDelta` is the SOUND relaxation that backs the opt-in mode. It
 * accepts an `after` file iff it differs from `before` ONLY by the closed,
 * semantics-preserving transform:
 *
 *     a non-block control-flow body `S`  ↔  a single-statement block `{ S }`
 *
 * applied at if-then / if-else / while / for / for-of / do body positions.
 *
 * Safety (the #1 invariant — a false-accept silently miscompiles user code):
 *   - Direction: only a BEFORE-side non-block statement may be wrapped in an
 *     AFTER-side `{ S }`. The emitter never removes braces, so this is the only
 *     shape that can occur; the reverse is rejected.
 *   - Every node outside a relaxed body position must match by source text
 *     (`getText()`), and every leaf token must match by text — so any operator
 *     change, rename, reordering, inserted/dropped statement, or moved `else`
 *     fails. Dangling-else is caught structurally: an `if` with vs without an
 *     `else` has a different child count.
 *   - The ordered list of comment texts must be identical: brace insertion
 *     never adds, drops, or rewrites a comment, so any comment delta rejects.
 * A false-reject (a correct migration left raw) is acceptable; a false-accept
 * is structurally impossible.
 */

import ts from 'typescript';

/** True when `afterText` differs from `beforeText` only by brace-wrapping
 *  non-block control-flow bodies (and is otherwise byte-for-byte identical in
 *  tokens and comments). */
export function isBraceOnlyDelta(beforeText: string, afterText: string): boolean {
  if (beforeText === afterText) return true;
  // Comment invariant: brace insertion never touches comments, so any change
  // to the ordered comment-text stream is a real drift.
  if (!sameComments(beforeText, afterText)) return false;
  const before = ts.createSourceFile(
    '__before.ts',
    beforeText,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TS,
  );
  const after = ts.createSourceFile(
    '__after.ts',
    afterText,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TS,
  );
  // A parse error on either side is treated as drift — never relax something
  // we cannot structurally reason about.
  if (hasParseErrors(before) || hasParseErrors(after)) return false;
  return equiv(before, after);
}

function hasParseErrors(sf: ts.SourceFile): boolean {
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics;
  return !!diags && diags.length > 0;
}

/** Structural equivalence modulo the single brace-wrap relaxation. */
function equiv(a: ts.Node, b: ts.Node): boolean {
  // Fast path: identical kind + source text ⇒ identical subtree.
  if (a.kind === b.kind && a.getText() === b.getText()) return true;
  // Directional brace relaxation: a non-block body on the BEFORE side may be a
  // single-statement block on the AFTER side, only at a control-flow body
  // position. Compare the unwrapped statement (recursively — nested non-block
  // bodies relax independently).
  if (isRelaxableBodyPosition(a) && !ts.isBlock(a) && ts.isBlock(b) && b.statements.length === 1) {
    return equiv(a, b.statements[0]);
  }
  if (a.kind !== b.kind) return false;
  const ac = a.getChildren();
  const bc = b.getChildren();
  if (ac.length !== bc.length) return false;
  // Leaf token (identifier, literal, punctuation): text must match exactly.
  if (ac.length === 0) return a.getText() === b.getText();
  for (let i = 0; i < ac.length; i++) {
    if (!equiv(ac[i], bc[i])) return false;
  }
  return true;
}

/** A node that is the body of a control-flow statement — the only position
 *  where the `S ↔ { S }` relaxation may apply. */
function isRelaxableBodyPosition(node: ts.Node): boolean {
  const p = node.parent;
  if (!p) return false;
  if (ts.isIfStatement(p)) return p.thenStatement === node || p.elseStatement === node;
  if (ts.isWhileStatement(p) || ts.isDoStatement(p)) return p.statement === node;
  if (ts.isForStatement(p) || ts.isForInStatement(p) || ts.isForOfStatement(p)) return p.statement === node;
  return false;
}

function collectComments(text: string): string[] {
  const out: string[] = [];
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /*skipTrivia*/ false);
  scanner.setText(text);
  for (;;) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      out.push(scanner.getTokenText());
    }
  }
  return out;
}

function sameComments(a: string, b: string): boolean {
  const ca = collectComments(a);
  const cb = collectComments(b);
  if (ca.length !== cb.length) return false;
  for (let i = 0; i < ca.length; i++) {
    if (ca[i] !== cb[i]) return false;
  }
  return true;
}
