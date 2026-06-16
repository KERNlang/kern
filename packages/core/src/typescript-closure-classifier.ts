/** Slice 0.9 — TypeScript-backed closure-classifier adapter (Node/codegen side).
 *
 *  This module is the ONLY place where the browser-safe closure-classifier seam
 *  is wired to the TypeScript-AST gate in `closure-eligibility.ts`. Because it
 *  statically imports `closure-eligibility.ts` (which imports `typescript`), it
 *  is reachable ONLY by direct module/subpath import — it is intentionally NOT
 *  re-exported from the `@kernlang/core` barrel, so importing the barrel or the
 *  parser never drags in `typescript` (R1 barrel-isolation).
 *
 *  Codegen and any caller that needs to parse block-bodied arrows imports
 *  `typescriptClosureClassifier` from here and injects it via
 *  `parseExpression(input, { closureClassifier: typescriptClosureClassifier })`. */

import type { ClosureClassifier } from './closure-classifier.js';
import {
  classifyClosureBlock,
  collectClosureBlockMemberAccesses,
  collectClosureBlockRegexHostViolations,
  collectClosureBlockTypeofOperands,
  parseClosureBlockAst,
} from './closure-eligibility.js';
import { isHostNamespaceRoot, unmappedHostNamespaceMessage } from './codegen/host-namespace.js';

/** The full-fidelity closure classifier: the TypeScript-AST gate that has
 *  always validated block-bodied arrows. Injecting this restores byte-identical
 *  accept/reject behavior (`closure-this`, `closure-nested-function`, …). */
export const typescriptClosureClassifier: ClosureClassifier = {
  available: true,
  parseBlock(raw: string): unknown | null {
    return parseClosureBlockAst(raw);
  },
  classifyBlock(raw: string): string | null {
    return classifyClosureBlock(raw);
  },
};

export function validateClosureBlockHostNamespacesTS(rawBlock: string, isUserBinding: (name: string) => boolean): void {
  // Slice 2 review fix — close the block-bodied-arrow bypass of the host-`RegExp`
  // fail-close. The generic member-access scan below only inspects `Root.member`
  // host accesses with an IDENTIFIER root, so a bare-value `RegExp` reference
  // (`() => { return RegExp; }`, `() => { const R = RegExp; return R; }`) and a
  // regex-literal property/element read (`() => { return /x/["source"]; }`) both
  // slipped through inside block bodies — the SAME Slice-2 positions the
  // non-block emit/validate paths already close. Run the dedicated regex-host
  // AST walk FIRST so these throw the regex-specific `REGEX_HOST_REGEXP_FAILCLOSE`
  // message (NOT degraded to the generic host-namespace diagnostic), honoring
  // user shadowing exactly as the bare-value emit screen does: a block-LOCAL
  // re-declaration (`locallyShadowed`) or an OUTER user binding makes `RegExp`
  // the user's value. Regex-literal reads never honor a binding (the receiver is
  // a literal), so they always fail-close.
  for (const violation of collectClosureBlockRegexHostViolations(rawBlock)) {
    if (violation.kind === 'regexLiteralAccess') {
      // A regex-LITERAL access never honors a user binding (the receiver is a
      // literal). The walk already classified the exact message (regex-host /
      // .exec / `/g`-`.test`), so throw it verbatim.
      throw new Error(violation.message);
    }
    // A bare `RegExp` VALUE reference fails-close unless a block-scope local or
    // an OUTER user binding shadows it.
    if (!violation.locallyShadowed && !isUserBinding(violation.root)) {
      throw new Error(violation.message);
    }
  }
  for (const access of collectClosureBlockMemberAccesses(rawBlock)) {
    if (!access.locallyShadowed && !isUserBinding(access.root)) {
      rejectRawBlockHostNamespaceTS(access.root, access.member);
    }
  }
  // Round-6 fix — `typeof <bare host-namespace root>` inside a block fails-close,
  // keeping the closure-walk leg byte-aligned with the expression legs (and with
  // the Python block lowering, which routes `typeof Date` through `emitPyTypeof` →
  // the same fail-close). `RegExp` is intentionally EXCLUDED here: a bare `RegExp`
  // in `typeof` position is already a value reference caught by the regex walk
  // above with the regex-specific message (round-6 removed its `typeof` exemption).
  // Non-RegExp host roots (`typeof Date`/`typeof process`) take the generic host
  // message. A block-LOCAL shadow or an OUTER user binding makes the name the
  // user's value (no reject); a non-host operand (`typeof userLocal`) is untouched.
  for (const operand of collectClosureBlockTypeofOperands(rawBlock)) {
    if (operand.name === 'RegExp') continue;
    if (!operand.locallyShadowed && !isUserBinding(operand.name)) {
      rejectRawBlockHostNamespaceTS(operand.name, 'typeof');
    }
  }
}

function rejectRawBlockHostNamespaceTS(root: string, member: string): void {
  if (!isHostNamespaceRoot(root)) return;
  throw new Error(unmappedHostNamespaceMessage('TypeScript', root, member));
}
