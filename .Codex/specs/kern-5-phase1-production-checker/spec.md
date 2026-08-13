# KERN 5 Phase 1 Production Checker Contract

**Status:** VERIFIED FOR PUBLICATION

**Date:** 2026-08-13

**Baseline:** `5f02bd151d3d2f94faa28229ff33e981335d9367`

**Tribunal:**
`tribunal-1786577085295-lw5l77-kern5-phase1-source-ownership` (3/3,
`claude,codex,agy`); decomposition follow-up
`tribunal-1786577674795-0e6jw1-kern5-checker-source-decompositi` (3/3);
review-remediation follow-up
`tribunal-1786579310959-g526bi-kern5-checker-review-remediation` (3/3);
native-cardinality follow-up
`tribunal-1786580646165-6xoo5w-kern5-checker-native-cardinality` (3/3);
security-remediation follow-up
`tribunal-1786582119747-xo3v3e-kern5-checker-security-remediati` (3/3)

**Review:** Initial high-risk role review
`review-1786581662047-3lxfuf-kern5-production-checker-remedia`; targeted
security confirmation
`review-1786582950711-y3w7lk-kern5-checker-security-confirmat` (1/1,
`claude`, zero findings)

**Confidence:** 0.98

## Decision

- **[P1C-D1 DECIDED]** The first Phase 1 terminal slice is the production KERN
  checker over an authenticated structural-facts boundary. Cross-line frontend
  framing is deferred because `ParsedLine[]` is not durable until tree, span,
  validation, diagnostic, and KIR ownership close together.
- **[P1C-D2 DECIDED]** The input is the existing checker-v2 parallel-table
  representation plus a declaration-row owner for each parameter, versioned as
  `kern.checker.facts.2`. The output is `kern.checker.result.1`.
- **[P1C-D3 DECIDED]** Bootstrap TypeScript may produce facts and independently
  calculate oracle verdicts during Phase 1. It may not calculate, rewrite, or
  suppress the production KERN checker verdict. The future KERN frontend
  replaces the producer while this checker boundary remains unchanged.
- **[P1C-D4 DECIDED]** The existing broad nominal `kern check` behavior is not
  replaced by this admitted self-host/toolchain checker profile. Canonical CLI
  source cutover belongs to the later frontend/canonical-cutover phases.
- **[P1C-D5 DECIDED]** Preserve `checker.kern` byte-identically at SHA-256
  `44a7ac9c556c0e876ec65c8a25ebca406c75346ab091ac70e9e8bc46fa56a614`
  and 613 lines. Its path-and-ordinal function identities feed 136 historical
  evidence files; decomposition is a separate identity-migration slice.
- **[P1C-D6 DECIDED]** `test:kern-checker` is promoted atomically only after the
  production entrypoint, packaged authenticated assets, contract tests,
  differential wall, hostile inputs, and mutation gate all pass. No placeholder
  script or partial status promotion is allowed.
- **[P1C-D7 DECIDED]** `kern.checker.facts.1` is rejected. It cannot authenticate
  parameters when duplicate declarations share a function name because
  `paramFn` contains no declaration identity. `facts.2` adds `paramOwnerStmt`
  and requires canonical, contiguous call-argument and declaration-parameter
  rows before semantic checker execution.
- **[P1C-D8 DECIDED]** Packaged assets are consumed through a compiled private
  CLI runner. Expected source, policy, and composition identities are embedded
  outside the mutable asset directory; raw JSON is byte-bounded before parsing.
- **[P1C-D9 DECIDED]** The production checker is the compiled authenticator plus
  native KERN semantic checker as one composite internal product. Exact
  `callArgCount` cardinality is host-authenticated compatibility metadata because
  frozen `checkModule` does not consume either count array. Native KERN validates
  the domains and canonical ordering of `argCall`/`argOrdinal`, which it does
  consume. Direct `checkFacts` is a pre-authenticated internal seam, not a second
  production entrypoint or a claim of complete native malformed-input ownership.
- **[P1C-D10 DECIDED]** The compiled boundary computes versioned conservative
  `kern.checker.native-work.1` before entering the frozen checker. The policy
  pins the 48-envelope corpus receipt, its 4,019,311,161-work maximum, and a
  25% headroom ceiling of 5,024,138,952; larger valid shapes fail before native
  execution. The CLI escapes U+2028/U+2029 only at NDJSON serialization so path
  semantics and JSON round trips remain unchanged.

## Current Evidence

- **[P1C-V1 VERIFIED]** `checker.kern` implements the current checker verdict
  over 57 ordered semantic fact arrays and is 613 handwritten lines. The new
  entry receives one additional ownership array that is not passed to the
  frozen checker.
- **[P1C-V2 VERIFIED]** `checker-while.kern` is 377 handwritten lines.
- **[P1C-V3 VERIFIED]** `main.kern` is a generated 150,780-line test aggregate,
  not handwritten source.
- **[P1C-V4 VERIFIED]** `test:capstone-checker-subset` currently proves 48/48
  TypeScript/KERN output parity, 36 accept-but-abstain rejections, accepted-tool
  execution, and 23 safe-integer cases.
- **[P1C-V5 VERIFIED]** The existing flattener imports the bootstrap TypeScript
  parser and expression parser. It is a fact producer and differential oracle,
  not proof of frontend ownership.
- **[P1C-V6 VERIFIED]** `executeKernRuntimeHandlerSync` is already the bounded
  internal product seam used by the KERN canonicalizer; the checker may use the
  same ABI without claiming interpreter ownership.
- **[P1C-V7 VERIFIED]** The admitted wall peaks at 1,689 rows in one family, 762
  calls, 1,602 arguments, and 259 parameters. The configured 2,048-row family
  ceiling retains 21% row headroom and bounds the native declaration-to-parameter
  ownership scan below 4.2 million comparisons.

## Contract

### Input

`kern.checker.facts.2` is an exact-key record:

1. `format`: exactly `kern.checker.facts.2`;
2. `path`: non-empty UTF-8 source identity within configured byte limits;
3. `tables`: exactly the 58 ordered arrays declared by
   `KERN_CHECKER_TABLES` in the private compiled CLI contract. The first 57
   retain the frozen `DATA_ARRAYS`/`checkModule` ABI; `paramOwnerStmt` is the
   facts.2 ownership extension.

No unknown fields, missing fields, sparse arrays, non-finite numbers,
non-safe integers, wrong scalar types, or row-count overflow are accepted.
Statement, index, call, argument, and parameter table families must have
internally equal lengths. Parent and statement references must be integers
within their declared family domains. `stmtExprArgCount` and `callArgCount` are
non-negative. Argument rows are ordered by `argCall`, with exactly
`callArgCount[call]` unique contiguous ordinals. This exact count relationship
is authenticated by the compiled production boundary; native KERN independently
validates the domains and canonical grouping of the argument references it
consumes. Parameter rows are ordered by
`paramOwnerStmt`; each owner is a function statement, `paramFn` equals that
statement's name, and ordinals are unique and contiguous within the owning
declaration. This preserves duplicate same-name declarations without ambiguous
ownership. Unknown or legacy input versions fail before checker semantics run.

### Output

`kern.checker.result.1` contains:

- `format`: exactly `kern.checker.result.1`;
- `outcome`: `accept`, `reject`, or `failure`;
- `path`: the authenticated input path;
- `diagnostics`: ordered checker lines, byte-identical to the checker oracle for
  admitted valid inputs;
- `checker`: packaged source byte count and SHA-256 identity.

An accepted module has exactly the authenticated line
`${path}:1:1|T10_MODULE|accept|ok`. A rejected module has one or more ordered,
structurally decoded `T10_*|reject|` lines. Outcome authentication never uses a
substring search over caller-controlled text. Contract, runtime, malformed
result, limit, or asset failures use `failure` and never masquerade as an
ordinary semantic rejection.

### Exit semantics

- `0`: authenticated `accept`;
- `1`: authenticated semantic `reject`;
- `2`: input-contract, limit, asset, runtime, or malformed-result `failure`.

The root test gate asserts these meanings in subprocesses; library helpers
return data and do not mutate `process.exitCode`.

## Native KERN Ownership

- The packaged source is composed from handwritten KERN modules in dependency
  order. `use` declarations are composition metadata and are removed from the
  single packaged source.
- A KERN `checkFacts` entrypoint accepts only pre-authenticated facts from the
  compiled runner and independently validates format, group lengths, reference
  domains, consumed argument ordering, parameter ownership/ordinals, and
  configured row/cell limits before calling `checkModule`; result-diagnostic
  limits are enforced on the returned envelope.
- Checker decisions, diagnostic code/detail, ordering, and accept/reject
  polarity are produced only by KERN code.
- TypeScript host code is restricted to exact-shape decoding, UTF-8/byte
  containment, runtime ABI invocation, and result-envelope decoding.
- The source guard rejects calls or imports that delegate checker decisions to
  the TypeScript reference, parser, filesystem, child process, crypto digest,
  fixture lookup, or host callbacks.

## Source Containment

- **[P1C-A1 ACCEPT]** Every new or materially edited handwritten source file is
  below 500 lines. `checker.kern` remains byte-identical at the recorded hash
  and line count, receives no new responsibility, and may be a packaged
  dependency of a new below-500-line entry module.
- Keep `checker-while.kern` under 500 lines.
- Mark the generated aggregate as generated and authenticate regeneration; its
  size is exempt from the handwritten-source rule.
- A gate checks the frozen hash and line count, zero diff to the baseline, all
  new `.kern` files below 500 lines, and continued resolution of every live
  `checker.kern#ordinal:function` witness.
- A later dedicated decomposition must version the witness-identity scheme,
  publish an explicit old-to-new correspondence map, rerun current measurements,
  and retain historical receipts. It must not ride along with a feature slice.

## Policy and Assets

A versioned JSON policy owns changeable limits, including maximum input bytes,
path bytes, rows per table family, total fact cells, diagnostics, result bytes,
runtime steps, runtime collection length, and runtime string bytes. Stable
format identifiers and diagnostic codes may be literals.

The CLI build emits a private `dist/kern-checker` asset set containing:

- the composed KERN source;
- the exact policy bytes;
- a composition record binding ordered source paths, bytes, and SHA-256;
- an asset manifest binding the composed source and policy.

The compiled private loader rejects missing, extra, stale, symlinked, malformed,
or digest-drifted assets against identities embedded outside the asset set. Its
stdin runner bounds raw bytes before `JSON.parse`, executes the authenticated
KERN source, and owns exit meanings 0/1/2. Pack tests later consume this same
runner and private asset set.

## Binary Acceptance

- **[P1C-A2 ACCEPT]** A RED test first fails because the production facts/result
  formats and `test:kern-checker` do not exist at baseline.
- **[P1C-A3 ACCEPT]** All existing 48 fixtures produce byte-identical ordered
  diagnostics from KERN and the independent TypeScript reference.
- **[P1C-A4 ACCEPT]** Every admitted handwritten tool source is accepted and
  executes where marked runnable; every documented accept-but-abstain attack is
  rejected.
- **[P1C-A5 ACCEPT]** Unknown versions/fields, missing fields, type drift,
  unequal table families, invalid references, non-canonical call/parameter
  ownership, ordinal/count drift, unsafe integers, raw/object/result byte
  limits, stale assets, and malformed runtime results fail closed as outcome
  `failure` with exit 2 and no partial semantic output.
- **[P1C-A6 ACCEPT]** Repeated runs are byte-identical after excluding no fields;
  the result contract contains no wall-clock value, temporary path, locale, or
  process identifier.
- **[P1C-A7 ACCEPT]** Adversarial tests kill native format-check and
  always-accept source mutations, stale or rewritten asset identities,
  non-canonical call and parameter ownership, unsafe reference/count/limit
  inputs, hostile transport bytes, and malformed runtime result tapes.
  Production dependency inspection confirms that the independent TypeScript
  oracle is not loaded by the runner. The direct native seam is explicitly
  tested as pre-authenticated-only for compatibility count metadata it does
  not consume.
- **[P1C-A8 ACCEPT]** `pnpm test:kern-checker`, the pre-existing checker gate,
  CLI/core type checks, focused tests, build, formatting, and diff hygiene pass.
- **[P1C-A8A ACCEPT]** The authenticated corpus stays below the native-work
  wall; equality is admitted, limit-plus-one and a 2,048-row multiplicative
  attack are rejected pre-runtime in under one second; Unicode line separators
  remain one escaped NDJSON record with exact parse round-trip and exit status.
- **[P1C-A9 ACCEPT]** Policy, remaining-gate ledger, support matrix, release
  train, and goal agree that `kern-checker` is current and name the exact gate.
  Formatter and frontend remain planned with absent root scripts.
- **[P1C-A10 ACCEPT]** Independent Agon review runs after the local gate using
  the current roster and risk-derived breadth; every finding is verified
  against current source before publication.

## Exclusions

- Raw-source frontend ownership, decorators, multiline framing, tree building,
  source-to-KIR emission, and public parser cutover.
- Trivia capture or formatting.
- Replacing the broad nominal `@kernlang/check` behavior.
- KERN compiler, fixed point, interpreter, canonical consumer cutover, packed
  release, version change, tag, or registry publication.
- Claiming the bootstrap fact producer or current TypeScript runtime as
  KERN-owned.

## Subsequent Phase 1 Order

1. Produce a lossless raw-byte trivia/layout tape as internal evidence.
2. Implement the deterministic idempotent formatter over that tape and promote
   `test:kern-formatter` only on the complete formatter contract.
3. Complete document framing, decorators, multiline blocks, tree/span/
   diagnostic ownership, and source-to-KIR parity together.
4. Replace the checker bootstrap fact producer with KERN frontend output and
   promote `test:kern-frontend` only on the complete source contract.

## Rollback

The production checker gate and private assets can be removed without changing
the existing nominal checker or parser path. Any future frontend producer must
continue to satisfy `kern.checker.facts.2`; incompatible facts require an
explicit new format version and dual-version transition.
