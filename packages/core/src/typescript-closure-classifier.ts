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
  collectClosureBlockLocalBindingNames,
  collectClosureBlockMemberAccesses,
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

export function validateClosureBlockHostNamespacesTS(
  rawBlock: string,
  isUserBinding: (name: string) => boolean,
): void {
  const localBindings = collectClosureBlockLocalBindingNames(rawBlock);
  const isShadowed = (name: string): boolean => localBindings.has(name) || isUserBinding(name);

  for (const access of collectClosureBlockMemberAccesses(rawBlock)) {
    if (!isShadowed(access.root)) {
      rejectRawBlockHostNamespaceTS(access.root, access.member);
    }
  }
}

function rejectRawBlockHostNamespaceTS(root: string, member: string): void {
  if (!isHostNamespaceRoot(root)) return;
  throw new Error(unmappedHostNamespaceMessage('TypeScript', root, member));
}
