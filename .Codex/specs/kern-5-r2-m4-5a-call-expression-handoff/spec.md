# KERN 5 R2 M4.5a — Call-Expression Handoff Evidence

**Status:** COMPLETE — capability/evidence gate closed; publication pending

**Parent objective:** preserve causal selection evidence before any KERN
canonicalizer or handwritten-corpus change for call expressions.

## Grounded Evidence

[VERIFIED] Published commit
`91a1f91509f39887c7e5f23b413da28e8fb03c22` is based on current
`origin/main` and contains the exact completed M4.5 profile-promotion tree.

[VERIFIED] Its canonical coverage summary is format 4 with SHA-256
`7baf457852184a7e6c2df54ab9ff2e7870e6b8cb5c58f2844187624c5ba75e50`.
The source policy SHA-256 is
`363a6ebcdc27dd7801d6528bdbdb7f2fa7c3324a0a3187facf6f4120c503fcef`;
the executable canonicalizer SHA-256 is
`d7116ba9cb7bb3c86d5692dfb72f98a715322b028f59cec622dc21588aaa66cc`.

[VERIFIED] The exact snapshot contains nine handwritten corpus members, 104
functions, four tools, and six base-complete functions. Its deterministic
winner is `call-expression`: two newly complete functions, one tool, 481
occurrences, and sorted witnesses `pathAppendIndex` and
`reasonLengthMismatch` from the assertion-engine diagnostic tool.

[VERIFIED] Receipt format 4 currently exposes two historical fields:
`selectionProvenance` for the promoted binary family and
`implementationSelectionProvenance` for the now-promoted conditional family.
Neither field can honestly represent both its existing base-promotion role and
the new call-expression implementation authorization.

## Decision

[DECIDED] Add one canonical, digest-pinned
`coverage-call-selection-provenance.json` record using the existing selection
provenance format. It must bind the exact commit, source digests, summary
format, counts, winner row, and witness order above.

[DECIDED] Advance receipt and summary to format 5. Normalize all three immutable
records into an ordered append-only `selectionProvenances` array, authenticated
by distinct family ids and digests. Add one
`implementationSelectionProvenanceDigest` pointer to the current call-selection
record. Future tranches append evidence and update the pointer without moving,
renaming, or duplicating historical records.

[REJECTED] Appending `nextImplementationSelectionProvenance` preserves fewer
diff lines now but becomes misleading after every promotion and requires a new
field name for each tranche.

[DECIDED] Coverage measurement authenticates every base promotion against the
family-keyed view of the append-only list, rejects duplicate selected families,
and requires the implementation pointer to resolve to exactly one record. It
does not require the frozen call selection to equal future live evidence after
implementation begins.

[VERIFIED] Nero run `nero-1784473503920-aoxj6q` marked the first proposal
`FLAWED`. Its signature-migration, unordered-map serialization, and
architecture-specific duplicate-family scenarios do not exist in this
repository: historical files are not rewritten, canonical evidence is an
ordered JSON array, and policy family ids are unique semantic capabilities.
Its tranche-boundary mutation concern was applicable and caused the append-only
list plus digest-pointer redesign. Git commits publish each evidence tree
atomically; there is no mutable runtime migration window.

[DECIDED] This slice changes no coverage policy, family ranking, corpus member,
KERN source/composition byte, KIR/runtime/public contract, or ownership claim.
The live M4.5 semantic measurement must remain identical; receipt/summary
schema, evidence fields, implementation-closure digest, and a documented clean
compiled-output correction may change.

## RED and Mutation Contract

[PROPOSED] First require the third pinned loader, exact M4.5 snapshot, ordered
append-only provenance list, exact call implementation pointer, and format 5.
The test must fail against sealed M4.5.

[PROPOSED] Mutations must reject noncanonical JSON, an unknown format, source
digest drift, commit drift, selection-family drift, count drift, reordered or
duplicate witnesses, duplicate historical family ids, missing promotion
evidence, and receipt/summary role drift.

[PROPOSED] The checker must execute the handoff proof and regenerated summary
must remain deterministic across repeated runs.

## Expected File Surface

- one new call-selection provenance JSON record;
- selection-provenance loader and exact digest pin;
- coverage evidence, receipt, and summary schema plumbing;
- handoff/coverage/checker mutation tests;
- regenerated format-5 summary;
- this spec and the release train.

## Acceptance

- [x] One adversarial Nero pass materially improves the schema.
- [x] Intended RED fails before production evidence plumbing exists.
- [x] Three provenance records load independently from canonical pinned bytes.
- [x] Historical base promotions authenticate from an ordered family-keyed
      view; the exact pointer resolves to the call-expression selection.
- [x] Live winner, ranking, counts, policy, corpus, and canonicalizer bytes are
      unchanged from published M4.5.
- [x] Focused Node 22 canonicalizer gate passes 63 Node tests, 18
      golden/idempotence/KIR fixtures, five measured witnesses, three
      profile-limit fixtures, and 128 hostile fixtures.
- [x] Complete Node 22 `pnpm fitness:kern-5` wall passes, including repo
      consistency, lint, build, workspace tests, infrastructure proof chain,
      cross-target/native conformance, capstones, application behavior, browser
      budget, KIR guards, source-runner convergence, and repeated canonicalizer
      evidence.
- [x] Exact-tree full usable-roster Agon review
      `review-1784548446121-pw3ita` completed all six engines with zero
      consensus-verified findings. The one claimed blocker identified a real
      stale-output difference in the old worktree, but the checked-in `592b…`
      digest is the correct clean-build value and passed the complete wall.
- [ ] Signed commit is fetched/rebased before one verified push.

## Stop Conditions

Stop and re-adjudicate if the evidence slice requires a KERN source/corpus
change, alters ranking, invents historical facts, weakens exact format checks,
or makes immutable selection evidence depend on post-implementation live
measurement.

Confidence: 0.99. Exact source facts, the third causal record, append-only
schema, mutation oracles, focused behavior, and the complete wall are verified;
independent review is adjudicated and signed publication remains.

## Review Adjudication

[VERIFIED] The old M4.5 worktree contains orphaned
`packages/core/dist/typescript-generated-helper-safety.js` bytes copied from a
CLI module; the source does not exist in the core tree and a clean build does
not emit it. Because the dependency receipt intentionally hashes every
compiled core JavaScript file, that stale output produced `f72c…`. This clean
worktree started without `dist`, reproducibly emits
`592b39f856f626b9fe89d5106e77509b8c6cb6c2631611818d477ed48a1291`, and
passed both focused and complete walls. The format-5 summary therefore repairs
an environment-contaminated receipt rather than introducing core drift.

[VERIFIED] `.Codex/specs` is established tracked repository evidence, with
dozens of prior specs; the ignore-convention claim is false.

[VERIFIED] Source commit `91a1f91509f39887c7e5f23b413da28e8fb03c22`
is published on the active feature branch. It is intentionally not yet in
`origin/main`; the final fetch/rebase must remain a no-op for that pinned
history before publication of this dependent slice.
