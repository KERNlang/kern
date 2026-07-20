# KERN 5 — Deterministic Closure Power Complexity

**Status:** COMPLETE — PUBLICATION PENDING

## Grounded Evidence

[VERIFIED] PR #544 fails only when the host TypeScript parser successfully
builds a 3,000-operand right-associated power tree; the same test passes on a
smaller local V8 stack because `ts.createSourceFile` throws and the analyzer
returns `null`.

[VERIFIED] The analyzer already traverses the AST iteratively. Its result is
therefore determined by an undocumented host parser-stack boundary, not by a
KERN-owned complexity policy.

[VERIFIED] A 1,200-operand power chain is an existing supported regression
case, while a 3,000-operand non-power chain must remain supported.

[VERIFIED] The final clean core build regenerates the canonicalizer receipt
with compiled-core digest
`1c30b1f3a53ee83663a9d46f7152464571ac5be8fdb44f600b087bc78b1e1f54`.
The older `592b…` digest remains historical evidence for the exact M4.5a tree,
not a claim about this later core-fix tree.

## Decision

[DECIDED] Introduce a KERN-owned `maxPowerOperators` policy with an exported
default of 1,199 and a validated caller override. This makes the existing
1,200-operand supported regression the exact default ceiling. Overrides may
only narrow that proven ceiling; widening above a host-safe boundary is
rejected. Count only `**` AST nodes; ordinary closure expression size is
unchanged.

[DECIDED] Apply the same default policy in the closure classifier, analyzer,
and both TypeScript and Python closure lowerers. Classifier/analyzer overrides
may narrow but never widen the ceiling; lowerers deliberately enforce the
single default so the production emission paths cannot drift from their gate.
Invalid limits fail loudly; authored source over the accepted limit keeps the
existing parse-failure contract on every path.

[DECIDED] Defer normalization of selected power nodes until the complete
iterative traversal proves the block is within policy.

[REJECTED] Increasing the test process stack or reducing the fixture depth
would preserve environment-dependent behavior rather than define the language
boundary.

## Acceptance

- [x] A larger-stack Node process reproduces the former CI failure before the
      fix and passes afterward.
- [x] The default accepts 1,200 operands and rejects both the first larger
      chain and the 3,000-operand CI regression on ordinary and enlarged V8
      stacks.
- [x] A caller override deterministically changes the accepted power depth.
- [x] A 3,000-operand non-power chain remains accepted.
- [x] Core build/tests and the complete KERN 5 fitness wall pass.
- [x] Full-roster Agon review passes.

## Review Adjudication

[VERIFIED] Full-roster review `review-1784551605577-8ahu1o-kern-5-closure-power-ci-determin`
identified that invalid limits were validated only after parsing and that the
initial 2,048-operator ceiling was not reachable on the ordinary local V8
stack. Limits now validate before parsing, and the ceiling is the exact
1,199-operator supported regression boundary. The receipt/spec wording now
distinguishes the historical M4.5a digest from this fix's regenerated digest.

[VERIFIED] Follow-up full-roster review
`review-1784552121741-bu08ii-kern-5-closure-power-ci-determin` identified a
direct Python-lowerer bypass. The exported Python lowerer now applies the same
default policy before emission, and its enlarged-stack regression returns the
same parse-failure rejection contract as the classifier path.

[VERIFIED] Final exact-code review
`review-1784552634948-wqr23o-kern-5-closure-power-ci-determin` completed all six
usable engines with zero consensus-verified findings. Suggestions to expose a
separate Python-lowerer override or redefine the policy as nesting depth would
change the decided contract; they are not regressions in this slice.

Confidence: 0.99. The failing branch and platform dependency are reproduced,
the deterministic policy is implemented, the complete wall passes, and the
final exact-code review has zero verified findings; only publication remains.
