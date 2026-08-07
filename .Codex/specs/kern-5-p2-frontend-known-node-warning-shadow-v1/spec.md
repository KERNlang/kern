# KERN 5 Phase 2: known-node warning shadow v1

**Milestone:** M4.163
**Status:** implemented and verified; signed publication pending
**Risk:** high, inherited parser-evidence and diagnostic-recognition contract
**Tribunal:** `tribunal-1786068544177-633ls4-m4163-known-node-warning`
**Confidence:** 0.99

## Decision

[D1] M4.163 adds the internal release-blocking format
`kern.frontend.known-node-warning-shadow.1`.

[D2] A new native-KERN successor calls
`observemutablenodetyperegistrysnapshot` exactly once. It combines the four
already independent predicates from M4.162:

- immutable built-in membership;
- evolved/dynamic membership;
- effective multiline membership;
- template-name membership.

[D3] An admitted identifier is `known` when any predicate is true and
`unknown` only when all four predicates are false. A non-admitted first token
is `dropped`. Inherited failures remain failures.

[D4] Warning state is tri-state:

- `dropped` has `warning=none`;
- `known` has `warning=false`;
- `unknown` has `warning=true`.

Non-admission must never be represented as admitted-but-unknown.

[D5] M4.163 owns recognition of the single
`UNKNOWN_NODE_TYPE` diagnostic for this retained, unindented, single-line
seam. It owns exact code, severity, line, UTF-16 column, and UTF-16 end column.
Message text, category, suggestion, general diagnostic ordering, and
multi-line coordinates remain bootstrap-owned and deferred.

[D6] The production TypeScript parser remains the bootstrap oracle. M4.163
does not alter `parser-core.ts`, `isKnownNodeType`, `KernRuntime`, public
parser APIs, or the canonical call chain.

## Grounded bootstrap predicate

[B1] After `TokenStream.tryIdent()` admits token zero, bootstrap
`parser-core.ts` emits `UNKNOWN_NODE_TYPE` exactly when:

```text
!builtin && !evolved && !multiline && !template
```

[B2] M4.161 authenticates `builtin` and its exact catalog index. M4.162
authenticates `evolved`, `multiline`, and `template`, plus the complete
M4.161 result, under one fused source/runtime/parse-epoch binding.

[B3] M4.163 consumes the same fused evidence object once. It may not create a
portable snapshot token, second parse, digest, MAC, key, caller-controlled gap,
or independently replayable classification object.

[B4] The admitted M4.160 source profile is retained content beginning at
synthetic line 1, column 1. Warning coordinates are therefore line `1`,
column `1`, and end column `1 + utf16Units(admittedType)`. The native source
uses the already composed bounded `utf16units` helper; scalar length or UTF-8
byte length is not an acceptable substitute.

## Envelope contract

[E1] One format field precedes fixed-width 16-field records. Success contains:

1. one `decision` record;
2. contiguous `snapshot-auth` records reproducing every M4.162 field;
3. exactly one `diagnostic` record only for `unknown`;
4. one terminal `seal` record.

[E2] An inherited failure contains:

1. one `failure` record;
2. contiguous `snapshot-auth` records reproducing the complete M4.162
   failure envelope;
3. one terminal `failure-seal` record.

No partial outer or inherited record may escape.

[E3] The `decision` record fields are:

1. tag (`decision`);
2. state (`dropped | known | unknown`);
3. inherited admission state (`dropped | admitted`);
4. exact admitted type or empty;
5. built-in predicate (`none | true | false`);
6. evolved predicate (`none | true | false`);
7. multiline predicate (`none | true | false`);
8. template predicate (`none | true | false`);
9. warning (`none | true | false`);
10. warning-record count (`0 | 1`);
11. runtime instance;
12. parse epoch;
13. M4.162 format link;
14. complete M4.162 field count;
15. inherited built-in catalog index or `none`;
16. empty reserved field.

[E4] Dropped records require empty admitted type, `none` for all four
predicates and warning, zero warning records, and `none` catalog index.
Known/unknown records require admitted status, four canonical booleans, a
canonical warning boolean, positive runtime/epoch, and the exact inherited
catalog index.

[E5] Each `snapshot-auth` record contains tag, contiguous chunk index,
contiguous inherited field start, a payload count from 1 through 12, the next
exact M4.162 fields, then empty padding through field 16. Counts are bounded
before allocation or iteration.

[E6] The optional `diagnostic` record contains tag, code
`UNKNOWN_NODE_TYPE`, severity `warning`, line, column, end column, exact
admitted type, then nine empty reserved fields. It appears exactly once for
`unknown` and never for `known` or `dropped`.

[E7] The terminal `seal` repeats state, warning, admitted type, all four
predicates, runtime instance, parse epoch, exact source, M4.162 format, M4.162
field count, warning-record count, inherited admission state, and inherited
catalog index.

[E8] The `failure` record contains tag, inherited code, inherited detail,
complete M4.162 field count, and twelve empty fields. The
`failure-seal` repeats code, detail, exact source, M4.162 format, field count,
runtime instance, parse epoch, then eight empty fields.

## Authentication and containment

[A1] Native KERN copies the complete M4.162 envelope structurally. It uses
only the fixed decision summary to compute M4.163 state, then closes that state
with the terminal seal. It does not duplicate M4.162's variable-length
registry and inherited-envelope validator.

[A2] The host concatenates the counted `snapshot-auth` payloads and passes
the reconstruction to the existing
`parseMutableNodeTypeRegistrySnapshotEnvelope`. Only after that complete
validator succeeds may the host accept the outer decision or propagated
failure.

[A3] The host compares the reconstructed M4.162 normalized result, every
outer field, and the terminal seal against an independent M4.163 oracle. A
copied summary or seal is not evidence for omitted inherited fields.

[A4] Native source containment requires exactly one M4.163 member and exactly
one call to M4.162. The M4.163 member may not contain
`UNKNOWN_NODE_TYPE`, `isKnownNodeType`, parser entry points, runtime
collections, TypeScript host helpers, oracle functions, cryptographic
primitives, capabilities, or callbacks. The format constant is permitted;
the diagnostic code is supplied as policy input rather than embedded as a
delegation escape.

[A5] The policy supplies the outer format, source profile, diagnostic code,
and diagnostic severity. It inherits all source, runtime, registry, and name
limits from M4.162 and derives the maximum M4.163 envelope field count. That
derived maximum must fit the runtime collection ceiling.

[A6] Exact-count comparison uses the fused bootstrap `parseResult`. For an
admitted source it requires precisely one matching warning for `unknown`
and zero for `known`; duplicate matching warnings fail. Other diagnostic
codes remain outside this slice and do not affect the count.

[A7] Structural replay, second consumption, stale epoch, cross-runtime,
cross-source, proxied collection, altered iterator, unsafe identity, and
registry/name overflow rejection remain inherited from the one-time M4.162
evidence boundary and must stay covered end to end.

## Independent oracle

[O1] The oracle first calls the existing independent M4.162 oracle. It does
not parse the M4.163 result to derive expected state.

[O2] For admitted identifiers it converts M4.161's attestation to the built-in
boolean, reads each independently authenticated mutable boolean, evaluates the
four-way OR, and derives `known | unknown` plus `false | true`.

[O3] For dropped admission it emits `dropped/none` without consulting
membership. For inherited failure it preserves the exact code/detail.

[O4] The oracle derives warning coordinates from the admitted normalized type
using JavaScript UTF-16 code-unit length and the synthetic line/column origin.

## Binary verification contract

[V1] RED-at-base is the absence of the M4.163 source, checker, policy, oracle,
fixtures, tests, package command, fitness rows, and support-matrix claim.

[V2] The differential corpus covers the complete admitted 16-row truth table
for built-in/evolved/multiline/template membership, plus one dropped state.
Overlapping categories use one exact admitted name. Built-in false/true rows
use names selected from the checked-in catalog rather than a duplicated
hardcoded catalog.

[V3] Exact bootstrap comparison asserts warning cardinality, code, severity,
line, column, and end column. It includes known and unknown ASCII identifiers,
normalized `evolved:name`, inline-comment retention boundaries, and unrelated
tokenizer diagnostics without broadening this slice's ownership. The current
inherited tokenizer rejects non-ASCII identifier input as
`UNSUPPORTED_UNKNOWN`, so the conditional astral fixture is unreachable. Exact
`utf16units(admittedType)` ownership is instead source-contained and scalar/
UTF-8 helper substitutions are killed before execution.

[V4] Inherited failure fixtures cover each reachable M4.162 failure family:
`EMPTY_RETAINED_CODE`, `UNSUPPORTED_UNKNOWN`, `CODE_POINTS_LIMIT`,
`TOKEN_LIMIT`, `DIAGNOSTIC_LIMIT`, `INVALID_LIMITS`, and `REGISTRY_INVALID`.
`RECORD_LIMIT` is unreachable under valid policy because its ceiling equals
`maxTokens + maxDiagnostics`; the remaining inherited failure codes are
internal invariant rejections rather than input-reachable families.
Malformed outer and inherited envelopes cover truncation, duplication,
reordering, noncanonical chunk indices/counts/padding, forged format/count/
source/runtime/epoch/catalog index, and success/failure coercion.

[V5] Named mutations kill at least: constant known; constant unknown; OR to
AND; omission of each of the four predicates; dropped as unknown; failure as
dropped; zero or two M4.162 calls; warning count zero/two; scalar or UTF-8
length substituted for UTF-16; forged diagnostic code/severity/coordinate;
swapped inherited chunks; altered chunk payload/padding; forged seal; and
partial inherited authentication.

[V6] Resource tests prove the maximum M4.162 envelope plus outer authentication
records fits the configured collection bound. One-above policy values fail
during policy validation. Runtime execution uses structural step/output
limits; wall-clock timing is not an acceptance criterion.

[V7] Focused gates include the M4.163 direct suite, differential checker, and
the complete M4.153-M4.163 frontend regression wall. The root fitness policy,
support matrix, package scripts, canonicalizer compiled-core receipts, and
complete Node 22 KERN 5 wall must agree.

[V8] Post-implementation review uses automatic high-risk routing, exact roster
`claude,codex,agy,kimi-for-coding-k3,minimax-coding-plan-minimax-m3,zai-coding-plan-glm-5.2`,
primary engine `codex`, and `--roles auto`. Every verified blocker is
fixed and affected gates rerun before publication.

## Verification outcome

[R1] The complete Node 22 `pnpm fitness:kern-5` wall exited zero before review.
It included both 737/737 canonicalizer proof runs, 434/434 cross-target plus
109/109 class conformance, 233 native KERN tests at 100% declared coverage, and
the complete M4.153-M4.163 frontend receipt.

[R2] Automatic high-risk role-lens review
`review-1786075484759-1ygf5g-m4163-known-node-warning` completed 6/6. Its two
verified blockers were reproduced RED-first and fixed: duplicate successor
members now reject, and the release-blocking adversarial contract now covers
the exact named mutation, inherited failure, hostile envelope, and one-above
resource boundaries.

[R3] Targeted correctness review
`review-1786076500434-3scr37-m4163-review-fix-confirmation` completed 1/1 and
found that admission could be forged consistently in the decision and seal.
The host now compares it to authenticated M4.162 status, with an isolated
RED-to-GREEN envelope mutation.

[R4] Final targeted correctness review
`review-1786077071056-ynssuj-m4163-admission-fix-confirmation` completed 1/1
with no verified finding. Its failure-code needs-check was rejected from source:
the reused M4.162 parser independently compares the reconstructed failure to
its oracle before the M4.163 outer equality can succeed.

[R5] After review fixes, the direct suite passes 9/9, the complete
M4.153-M4.163 frontend regression receipt passes, lint checks 1,354 files
cleanly, KERN 5 fitness-policy tests pass 9/9, and `git diff --check` is clean.

## Claim and explicit deferrals

[C1] This slice may claim only:
`kern-frontend-known-node-warning-shadow: internal-oracle`.

[X1] M4.163 does not own diagnostic message/category/suggestion rendering,
general diagnostic ordering, physical indentation, multi-line spans,
comment/trivia attachment outside the inherited retained boundary,
parser-hint definitions, template bodies/expansion, properties, styles,
themes, successful parsed nodes, tree recovery, AST, KIR, public APIs, or
frontend cutover.

[X2] It does not modify bootstrap parser authority, remove the TypeScript
`isKnownNodeType` path, or promote `kern-frontend`.

[X3] The next slice must continue after warning recognition into the smallest
authenticated property or successful-node parsing seam selected from current
source evidence; this spec does not pre-choose that boundary.

## Tribunal plan delta

[T1] The initial approach proposed full diagnostic projection. The tribunal
rejected it because bootstrap diagnostics also own message, category, and
suggestion, which would overstate M4.163.

[T2] The accepted delta keeps a new successor but narrows ownership to
tri-state recognition plus fixed code/severity/coordinates, requires exact
warning count, and expands the differential matrix to all 16 predicate
combinations plus dropped.

[T3] The tribunal rejected retrofitting published M4.162, changing production
parser authority, and inventing digest/MAC infrastructure. The existing
M4.162 host validator remains the single full inherited authenticator.
