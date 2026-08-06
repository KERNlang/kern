# KERN 5 Phase 1: Canonical KIR v1 Freeze and Alpha Acceptance

Status: approved for implementation after Agon tribunal `tribunal-1785982286972-v6291t`

## Decision

- [CONFIRMED] Freeze a machine-readable, internally importable `kern.kir.v1`
  envelope. A documentation-only constitution or a digest list without a
  decoder is insufficient.
- [CONFIRMED] Preserve the historical Alpha semantic and evidence formats
  unchanged. They remain authenticated constituents and retain their existing
  `ALPHA-NO-GO` labels; this slice does not rewrite history.
- [CONFIRMED] Keep the v1 codec internal to `@kernlang/core`: no root-barrel
  export and no package export subpath.
- [CONFIRMED] Promote `pnpm test:kern-ir` and `versioned-kir-v1` only when the
  complete executable contract and a durable acceptance manifest pass.
- [CONFIRMED] Keep `publicReaderExport`, `runtimeCutover`,
  `semanticSelfHosting`, and Phase 1 completion false.

## Canonical profile

- [DECIDED] `kern.kir.v1` is a canonical-value encoded envelope with exactly
  these ordered fields: `components`, `format`, `profile`.
- [DECIDED] `profile` is exactly `kern.kir.profile.v1`.
- [DECIDED] `components` has exactly two entries in this order:
  `semantic-module` and `diagnostic-evidence`.
- [DECIDED] Each component contains exactly `encoding`, `format`, `kind`,
  `payload`, and `sha256`. `encoding` is `hex`; `payload` is lowercase even
  length hexadecimal; `sha256` is the digest of decoded payload bytes.
- [DECIDED] The semantic payload must decode as the existing
  `kern.kir.modules.r1.5e.1-alpha` artifact. The evidence payload must decode
  as `kern.kir.evidence.r1.5d.1-alpha`, bind the exact semantic bytes, and
  validate against the supplied source inputs.
- [DECIDED] Canonical identity includes component order and bytes. Semantic
  identity remains available as the semantic component digest; evidence stays
  separately versioned and does not change the inner semantic artifact.
- [DECIDED] Unknown envelope versions, profiles, fields, component kinds,
  formats, encodings, duplicates, reordering, malformed hex, digest mismatch,
  and inner-artifact mismatch reject before a decoded v1 artifact is returned.
- [DECIDED] Any compatible reader may accept only these exact v1 bytes. Adding,
  removing, or reinterpreting a field or component requires a new envelope
  version; historical constituent version changes require an explicit profile
  successor.

## Executable oracle

- [CONFIRMED] Add a focused `test:kern-ir-profile` command for codec, manifest,
  containment, and hostile mutation tests.
- [CONFIRMED] Add `test:kern-ir` as the release-blocking aggregate. It runs the
  focused v1 profile proof plus the existing eligibility, canonical value,
  structural constitution/codec, module graph, runtime binding, composed runner
  evidence, coverage closure, diagnostic evidence, Alpha receipt, and runtime
  contract v1 oracles.
- [CONFIRMED] Existing containment checks that deliberately forbid
  `test:kern-ir` must be updated atomically: they must instead require the
  promoted script while continuing to forbid public exports and unauthorized
  production consumers.
- [CONFIRMED] RED-at-base evidence must show that a bare Alpha artifact cannot
  decode as v1, a payload mutation with a retained digest rejects, reordered or
  duplicate components reject, encode/decode/encode is byte-identical, public
  import remains unavailable, and forbidden acceptance claims reject.

## Durable Alpha acceptance

- [DECIDED] A tracked manifest cannot contain the SHA of the same commit that
  introduces it. Use a two-commit lineage in one push:
  1. commit the complete frozen implementation and promoted policy;
  2. from that clean commit, run the acceptance generator and commit the new
     immutable SHA-named manifest as the only acceptance-commit addition.
- [DECIDED] The manifest format is `kern.kir.v1-alpha-acceptance.1`. It records
  the accepted implementation commit SHA, exact frozen-authority binding
  digests, exact oracle argv/status rows, exclusions, and status claims.
- [DECIDED] The acceptance generator checks a clean tree, captures HEAD, runs
  the configured oracles, then re-checks both cleanliness and HEAD equality
  before writing. An existing SHA-named manifest must be byte-identical.
- [DECIDED] The final validator verifies the accepted SHA exists, every bound
  file at that commit matches its recorded digest, the current frozen authority
  bytes still match, and the acceptance commit adds only the expected manifest.
  Future unrelated commits may descend from that acceptance commit without
  invalidating the historical receipt.
- [CONFIRMED] Repair the same missing post-oracle HEAD-equality check in the
  existing Alpha receipt generator.
- [DECIDED] Accepted status is exactly `alphaAccepted=true`,
  `kirV1Frozen=true`, `runtimeHandlerAbi=true`, with
  `publicReaderExport=false`, `runtimeCutover=false`, and
  `semanticSelfHosting=false`.
- [DECIDED] Published acceptance manifests are append-only. Correction requires
  a digest-bound supersession record or a v2 acceptance, never rewriting an
  accepted SHA-named file.

## Policy and documentation promotion

- [CONFIRMED] Promote fitness gate `kir-v1` from `planned` to `current`, update
  the fitness-policy test that currently treats the script as premature, and
  add the exact entrypoint command to policy.
- [CONFIRMED] Promote ownership row `versioned-kir-v1` from `not-shipped` to
  `internal-oracle` with evidence `pnpm test:kern-ir`.
- [CONFIRMED] Promote eligibility from the internal Alpha no-go state to the
  internal accepted-v1 state and set only `alphaAccepted` and `kirV1Frozen`
  true in addition to the already frozen runtime ABI.
- [CONFIRMED] Mark R1.5c, R1.5d, and their R1.5 parent complete, documenting
  this exact internal freeze without claiming public export, semantic cutover,
  self-hosting, or a KERN 5 release.

## Verification and rollback

- [CONFIRMED] Run focused RED/GREEN tests, build/typecheck, the complete Node 22
  `pnpm fitness:kern-5` wall, and automatic high-risk role-lens Agon review
  using primary engine `codex` and the live `claude,codex,agy` roster.
- [CONFIRMED] Verify every review finding against current files and fix genuine
  blockers with targeted regression tests.
- [DECIDED] Before public consumption, rollback is an atomic revert of the v1
  envelope, gate, eligibility, and matrix promotion while preserving historical
  Alpha receipts. After an acceptance manifest exists, do not delete or mutate
  it; append a supersession record.

## Explicit non-goals

- [CONFIRMED] No package version, public KIR reader/export, runtime cutover,
  frontend/compiler promotion, formatter promotion, semantic self-hosting,
  public tag, release, or deploy.
- [CONFIRMED] No rename or rewrite of historical Alpha constituent formats.
