# KERN 5 Ownership Support Matrix

**Release status:** R1 internal Alpha constitution; KERN 5.0 is not complete.
**Current product baseline:** KERN 4.5.0; KERN 5 contract audited from `main` at
`bc168288`.
**Release meaning:** KERN 5 parses, checks, compiles, and executes its canonical
handler language through KERN-authored semantic tooling over versioned KIR.
Host code provides explicit capabilities and transport only. A clean bootstrap
must prove a deterministic Stage 1 equals Stage 2 fixed point.

This document is the human-readable mirror of
`scripts/kern-5-fitness-policy.json`. The eight terminal rows are additionally
bound to `scripts/kern-5-remaining-gates-v1.json` for completion categories and
accepted evidence. `pnpm check:kern-5-contract` requires exact agreement. A
current gate is runnable now; a planned gate is deliberately absent until its
implementation slice promotes the policy, ledger, and matrix atomically.

The fail-closed rule applies throughout: unsupported runtime shapes reject
before partial output, result, diagnostic, or implicit host effect escapes.

## Canonical Gates

<!-- KERN5_GATE_MATRIX_START -->
| ID | Gate | Status | Command |
| --- | --- | --- | --- |
| repo-consistency | Repository consistency | current | `pnpm check:repo` |
| lint | Formatting and lint | current | `pnpm lint` |
| build | Build and typecheck | current | `pnpm build` |
| workspace-tests | Full workspace tests | current | `pnpm test` |
| cross-target-conformance | TypeScript and Python conformance | current | `pnpm check:conformance` |
| native-kern | Native KERN tests | current | `pnpm test:kern` |
| runner-smoke | Runner and self-host smoke | current | `pnpm test:runner-smoke` |
| app-behavior | Three-leg app behavior | current | `pnpm test:app-behavior` |
| drift-showcase | Backend drift showcase | current | `pnpm test:drift-showcase` |
| browser-budget | Required browser budget | current | `pnpm check:runner-browser-budget:required` |
| kir-seam-probe | Typed semantic KIR seam probe | current | `pnpm test:kern-ir-probe` |
| kir-reader-candidate | Internal semantic KIR reader candidate | current | `pnpm test:kern-ir-reader-candidate` |
| semantic-ownership-proof | Bootstrap-dependent semantic ownership proof | current | `pnpm test:kern-semantic-ownership` |
| kir-v1-eligibility | KIR v1 coverage and identity eligibility | current | `pnpm test:kern-ir-eligibility` |
| canonical-value-reader | Bounded canonical value reader | current | `pnpm test:kern-canonical-value` |
| kir-structural-constitution | Structural KIR node and property constitution | current | `pnpm test:kern-kir-structural-constitution` |
| kir-structural-codec | Bounded structural KIR writer and reader | current | `pnpm test:kern-kir-structural-codec` |
| kir-module-graph | Structural KIR module and symbol graph | current | `pnpm test:kern-kir-module-graph` |
| internal-decoded-module-kir-binding | Decoded Module KIR to internal runtime handler binding | current | `pnpm test:kern-kir-runtime-binding` |
| kir-runner-composed-evidence | Internal composed KIR runner witnesses and structural blockers | current | `pnpm test:kern-kir-runner-composed-evidence` |
| kir-coverage-closure | Structural KIR coverage witness closure | current | `pnpm test:kern-kir-coverage-closure` |
| kir-evidence | Diagnostic and UTF-8 location evidence | current | `pnpm test:kern-kir-evidence` |
| kir-alpha-receipt | Clean-HEAD immutable Alpha receipt | current | `pnpm test:kern-alpha-receipt` |
| internal-runtime-envelope | Internal runtime envelope, handler entry, source link, capability seam, scheduler control, and private effect machine | current | `pnpm test:kern-runtime-envelope` |
| diff-hygiene | Git diff hygiene | current | `git diff --check` |
| kir-v1 | Versioned canonical KIR | current | `pnpm test:kern-ir` |
| runtime-handler-abi | Default-off public typed runtime handler ABI | current | `pnpm test:runtime-abi` |
| runtime-contract-v1 | Frozen runtime handler, capability, event, diagnostic, limit, and rejection contract v1 | current | `pnpm test:kern-runtime-contract-v1` |
| core-runtime-internalization | CoreRuntime public-ABI quarantine and internalization | current | `pnpm test:core-runtime-internalization` |
| source-runner-convergence | Source runner convergence, call-site isolation, and blocker non-growth | current | `pnpm test:source-runner-convergence` |
| kern-kir-canonicalizer | KERN-authored bounded KIR canonicalizer profile | current | `pnpm test:kern-canonicalizer` |
| kern-frontend-tokenizer-shadow | KERN-authored bounded frontend tokenizer shadow | current | `pnpm test:kern-frontend-tokenizer` |
| kern-frontend-stitch-shadow | KERN-authored bounded frontend framing and stitch shadow | current | `pnpm test:kern-frontend-stitch-shadow` |
| kern-frontend-indentation-shadow | KERN-authored bounded frontend indentation observation shadow | current | `pnpm test:kern-frontend-indentation-shadow` |
| kern-frontend-lexical-shadow | KERN-authored bounded frontend conditional lexical-checkpoint shadow | current | `pnpm test:kern-frontend-lexical-shadow` |
| kern-frontend-comment-boundary-shadow | KERN-authored bounded frontend inline-comment boundary shadow | current | `pnpm test:kern-frontend-comment-boundary-shadow` |
| kern-frontend-whitespace-trim-shadow | KERN-authored bounded pre-tokenization whitespace-trim shadow | current | `pnpm test:kern-frontend-whitespace-trim-shadow` |
| kern-frontend-retained-token-stream-shadow | KERN-authored bounded retained-code token-stream shadow | current | `pnpm test:kern-frontend-retained-token-stream-shadow` |
| kern-frontend-node-type-token-admission-shadow | KERN-authored bounded node-type-token admission shadow | current | `pnpm test:kern-frontend-node-type-token-admission-shadow` |
| kern-frontend-builtin-node-type-attestation-shadow | KERN-authored immutable built-in node-type attestation shadow | current | `pnpm test:kern-frontend-builtin-node-type-attestation-shadow` |
| kern-frontend-mutable-node-type-registry-snapshot-shadow | KERN-authored mutable node-type registry snapshot shadow | current | `pnpm test:kern-frontend-mutable-node-type-registry-snapshot-shadow` |
| kern-frontend-known-node-warning-shadow | KERN-authored known-node warning shadow | current | `pnpm test:kern-frontend-known-node-warning-shadow` |
| kern-frontend-generic-property-admission-shadow | KERN-authored generic property-admission shadow | current | `pnpm test:kern-frontend-generic-property-admission-shadow` |
| kern-frontend-generic-property-loop-shadow | KERN-authored generic property-loop shadow | current | `pnpm test:kern-frontend-generic-property-loop-shadow` |
| kern-frontend-generic-property-theme-refs-shadow | KERN-authored theme-enabled generic property-loop shadow | current | `pnpm test:kern-frontend-generic-property-theme-refs-shadow` |
| kern-frontend-generic-property-style-theme | KERN-authored style-and-theme generic property-loop shadow | current | `pnpm test:kern-frontend-generic-property-style-theme` |
| kern-frontend-generic-property-style-theme-diagnostics | KERN-authored generic property style/theme diagnostic shadow | current | `pnpm test:kern-frontend-generic-property-style-theme-diagnostics` |
| kern-frontend-evolved-hints | KERN-authored evolved parser-hint shadow | current | `pnpm test:kern-frontend-evolved-hints` |
| kern-frontend-keyword-handlers | KERN-authored keyword-handler shadow | current | `pnpm test:kern-frontend-keyword-handlers` |
| kern-frontend-successful-line-composition | KERN-authored successful-line composition shadow | current | `pnpm test:kern-frontend-successful-line-composition` |
| kern-checker | Production KERN checker | current | `pnpm test:kern-checker` |
| kern-formatter | Trivia-preserving KERN formatter | current | `pnpm test:kern-formatter` |
| kern-frontend | KERN-authored frontend | planned | `pnpm test:kern-frontend` |
| kern-compiler | KERN-authored compiler | planned | `pnpm test:kern-compiler` |
| selfhost-fixed-point | Stage 1 equals Stage 2 | planned | `pnpm test:selfhost-fixed-point` |
| kern-interpreter-shadow | KERN interpreter shadow | planned | `pnpm test:kern-interpreter-shadow` |
| kern-canonical-cutover | Canonical consumer cutover | planned | `pnpm test:kern-canonical-cutover` |
| packed-release | Packed release proof | planned | `pnpm test:packed-release` |
<!-- KERN5_GATE_MATRIX_END -->

`pnpm fitness:kern-5` validates this contract, then executes every current gate
in the listed order without a shell and stops on the first failure. Planned
commands are not silently skipped; they are explicitly outside the current
wall and must remain absent until promoted.

## Ownership Status

<!-- KERN5_OWNERSHIP_MATRIX_START -->
| ID | Ownership boundary | Status | Evidence |
| --- | --- | --- | --- |
| direct-source-runtime | Direct .kern source runtime | shipped-4.5 | `packages/core/tests/runner-source-executor.test.ts` |
| browser-safe-runner | Browser-safe runner | shipped-4.5 | `scripts/check-runner-browser-budget.mjs` |
| kern-assertion-engine | KERN assertion engine | internal-oracle | `pnpm test:capstone-assertion-engine` |
| kern-module-validator | KERN module validator | internal-oracle | `pnpm test:selfhost-validator` |
| kern-checker-v1 | KERN checker subset v1 | shipped-4.5 | `git show v4.5.0:examples/capstone-checker-subset/checker.kern` |
| checker-v2 | Checker v2 and production shadow | internal-oracle | `pnpm test:capstone-checker-subset` |
| kern-checker | Production KERN checker | internal-product | `pnpm test:kern-checker` |
| kir-seam-selection | Typed semantic KIR seam selection | internal-oracle | `pnpm test:kern-ir-probe` |
| kir-reader-candidate | Internal semantic KIR reader candidate | internal-oracle | `pnpm test:kern-ir-reader-candidate` |
| semantic-ownership-proof | Non-circular semantic ownership substrate | internal-oracle | `pnpm test:kern-semantic-ownership` |
| kir-v1-eligibility | KIR v1 coverage and identity eligibility | internal-oracle | `pnpm test:kern-ir-eligibility` |
| canonical-value-reader | Bounded canonical value reader | internal-oracle | `pnpm test:kern-canonical-value` |
| kir-structural-constitution | Structural KIR node and property constitution | internal-oracle | `pnpm test:kern-kir-structural-constitution` |
| kir-structural-codec | Bounded structural KIR writer and reader | internal-oracle | `pnpm test:kern-kir-structural-codec` |
| kir-module-graph | Structural KIR module and symbol graph | internal-oracle | `pnpm test:kern-kir-module-graph` |
| internal-decoded-module-kir-binding | Decoded Module KIR to internal runtime handler binding | internal-oracle | `pnpm test:kern-kir-runtime-binding` |
| kir-runner-composed-evidence | Internal composed KIR runner witness closure | internal-oracle | `pnpm test:kern-kir-runner-composed-evidence` |
| kir-coverage-closure | Structural KIR coverage witness closure | internal-oracle | `pnpm test:kern-kir-coverage-closure` |
| kir-evidence | Diagnostic and UTF-8 location evidence | internal-oracle | `pnpm test:kern-kir-evidence` |
| kir-alpha-receipt | Clean-HEAD immutable Alpha receipt | internal-oracle | `pnpm test:kern-alpha-receipt` |
| internal-runtime-envelope | Default-off transactional runtime envelope | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-handler-entry | Typed current-domain handler entry | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-source-handler-link | Bounded source handler identity and link | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-capability-seam | Default-off capability interception seam | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-scheduler-control | Default-off cancellation and timeout control | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine | Private sync and async effect-machine convergence | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-if | Private effect-machine if and else frames | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-branch | Private effect-machine branch frames | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-while | Private effect-machine while frames | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-for | Private effect-machine counted for frames | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-each-array | Private effect-machine array each frames | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-architecture | Private effect-machine architecture boundary | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-try | Private effect-machine try, catch, and finally frames | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-evaluator-boundary | Legacy-free stable machine and scalar-evaluator import boundary | internal-oracle | `pnpm test:kern-runtime-envelope` |
| versioned-kir-v1 | Versioned canonical KIR v1 | internal-oracle | `pnpm test:kern-ir` |
| typed-runtime-handler-abi | Frozen default-off public typed runtime handler ABI | internal-oracle | `pnpm test:kern-runtime-contract-v1` |
| core-runtime-internalization | CoreRuntime public-ABI quarantine and internalization | internal-oracle | `pnpm test:core-runtime-internalization` |
| source-runner-convergence | Sync/async source-runner convergence and pre-execution selector | internal-oracle | `pnpm test:source-runner-convergence` |
| kern-kir-canonicalizer-profile | Bounded KERN-authored KIR canonicalizer profile | internal-oracle | `pnpm test:kern-canonicalizer` |
| kern-frontend-tokenizer-shadow | Bounded KERN-authored line-tokenizer shadow | internal-oracle | `pnpm test:kern-frontend-tokenizer` |
| kern-frontend-stitch-shadow | Bounded KERN-authored physical framing and multiline stitch shadow | internal-oracle | `pnpm test:kern-frontend-stitch-shadow` |
| kern-frontend-indentation-shadow | Bounded KERN-authored indentation observation shadow | internal-oracle | `pnpm test:kern-frontend-indentation-shadow` |
| kern-frontend-lexical-shadow | Bounded KERN-authored conditional lexical-checkpoint shadow | internal-oracle | `pnpm test:kern-frontend-lexical-shadow` |
| kern-frontend-comment-boundary-shadow | Bounded KERN-authored inline-comment boundary shadow | internal-oracle | `pnpm test:kern-frontend-comment-boundary-shadow` |
| kern-frontend-whitespace-trim-shadow | Bounded KERN-authored pre-tokenization whitespace-trim shadow | internal-oracle | `pnpm test:kern-frontend-whitespace-trim-shadow` |
| kern-frontend-retained-token-stream-shadow | Bounded KERN-authored retained-code token-stream shadow | internal-oracle | `pnpm test:kern-frontend-retained-token-stream-shadow` |
| kern-frontend-node-type-token-admission-shadow | Bounded KERN-authored node-type-token admission shadow | internal-oracle | `pnpm test:kern-frontend-node-type-token-admission-shadow` |
| kern-frontend-builtin-node-type-attestation-shadow | Immutable KERN-authored built-in node-type attestation shadow | internal-oracle | `pnpm test:kern-frontend-builtin-node-type-attestation-shadow` |
| kern-frontend-mutable-node-type-registry-snapshot-shadow | Mutable KERN-authored node-type registry snapshot shadow | internal-oracle | `pnpm test:kern-frontend-mutable-node-type-registry-snapshot-shadow` |
| kern-frontend-known-node-warning-shadow | KERN-authored known-node warning shadow | internal-oracle | `pnpm test:kern-frontend-known-node-warning-shadow` |
| kern-frontend-generic-property-admission-shadow | KERN-authored generic property-admission shadow | internal-oracle | `pnpm test:kern-frontend-generic-property-admission-shadow` |
| kern-frontend-generic-property-loop-shadow | KERN-authored generic property-loop shadow | internal-oracle | `pnpm test:kern-frontend-generic-property-loop-shadow` |
| kern-frontend-generic-property-theme-refs-shadow | KERN-authored theme-enabled generic property-loop shadow | internal-oracle | `pnpm test:kern-frontend-generic-property-theme-refs-shadow` |
| kern-frontend-generic-property-style-theme | KERN-authored style-and-theme generic property-loop shadow | internal-oracle | `pnpm test:kern-frontend-generic-property-style-theme` |
| kern-frontend-generic-property-style-theme-diagnostics | KERN-authored generic property style/theme diagnostic shadow | internal-oracle | `pnpm test:kern-frontend-generic-property-style-theme-diagnostics` |
| kern-frontend-evolved-hints | KERN-authored evolved parser-hint shadow | internal-oracle | `pnpm test:kern-frontend-evolved-hints` |
| kern-frontend-keyword-handlers | KERN-authored keyword-handler shadow | internal-oracle | `pnpm test:kern-frontend-keyword-handlers` |
| kern-frontend-successful-line-composition | KERN-authored successful-line composition shadow | internal-oracle | `pnpm test:kern-frontend-successful-line-composition` |
| kern-formatter | Lossless KERN formatter | internal-product | `pnpm test:kern-formatter` |
| kern-frontend | KERN-authored source frontend | not-shipped | R2 planned |
| kern-compiler | KERN-authored compiler | not-shipped | R2 planned |
| selfhost-fixed-point | Clean Stage 1 equals Stage 2 | not-shipped | R2 planned |
| kern-interpreter | KERN semantic interpreter | not-shipped | R2 and R3 planned |
| kern-canonical-cutover | Canonical consumer cutover from TypeScript semantics | not-shipped | `scripts/kern-5-remaining-gates-v1.json` |
| packed-release-proof | Exact packed release proof | not-shipped | R4 planned |
<!-- KERN5_OWNERSHIP_MATRIX_END -->

`shipped-4.5` means public substrate in the current product. `internal-product`
means a terminal KERN-owned component is packaged and release-blocking behind
an explicit bootstrap boundary that a later cutover phase must replace.
`internal-oracle`
means KERN-authored logic participates in a release-blocking differential
harness but is not yet the production API or semantic authority. `not-shipped`
means the ownership boundary cannot support a KERN 5 release claim.

The internal `kern.kir.v1` envelope composes the historical Alpha semantic and
evidence payloads behind a strict canonical decoder and immutable acceptance
lineage. It is deliberately absent from package exports and is not the runtime
semantic authority.

M4.152 adds an opt-in `kern canonicalize` distribution preview backed by the
authenticated KERN canonicalizer. It remains `internal-oracle`: the command
uses the TypeScript bootstrap frontend, is bounded to the admitted structural
profile, and rejects comment syntax because it cannot preserve trivia. It
therefore does not promote the `kern-formatter` or `kern-frontend` ownership
rows.

M4.153 begins frontend ownership with a handwritten KERN line-tokenizer shadow.
It covers the eleven bootstrap line-token kinds and four tokenizer diagnostics
over a bounded scalar-safe profile, with KERN-owned boundary deltas and a
terminal source seal validated and normalized to UTF-8 byte positions by the
oracle. The whole public envelope is byte-ceiling checked before parsing.
Standalone non-ASCII unknown tokens and malformed UTF-16 fail closed. This is
an `internal-oracle` slice;
multi-line parsing, token-stream parsing, KIR production, and production
frontend cutover remain absent, so `kern-frontend` stays `not-shipped`.

M4.154 extends that internal oracle with LF-only physical-record framing and a
KERN-owned decision for multiline double-quoted properties and nested
`{{ ... }}` expressions. The emitted tape preserves exact indentation, LF
extent, contiguous group membership, boundary termination, open state, and
document-relative UTF-8 token and diagnostic positions. File-comment and
closed-profile raw-opener classes are observational boundaries only: trivia,
indentation meaning, raw bodies, parsing, KIR emission, and frontend cutover
remain unclaimed. Source-hashed corpus selection, aggregate limits, envelope
validation, and mutation tests make this a bounded
`kern-frontend-stitch-shadow: internal-oracle`; `kern-frontend` remains
`not-shipped`.

M4.155 composes that KERN-authored stitch envelope inside KERN and emits one
exact indentation observation for each complete ordinary group. It binds the
group and first physical record, maximal ASCII space/tab prefix, exact content
witness, source-derived UTF-8/code-unit boundary, and `initial`/`same`/`deeper`/
`shallower` relation. Blank, comment, raw-opener, continuation, boundary, and
EOF-unclosed records do not invent observations. The tape deliberately claims
no tree, node admission, tab validity, `INDENT_JUMP`, trivia attachment, AST,
KIR, or cutover, so this is only
`kern-frontend-indentation-shadow: internal-oracle`; `kern-frontend` remains
`not-shipped`.

M4.156 composes the same stitch envelope inside KERN and emits a bounded
conditional lexical checkpoint for every physical record in each complete
ordinary group. Each checkpoint binds record identity and exact content to
terminal quote, escape, expression-depth, and style-depth state. Scanning stops
at the first neutral inline `#` or `//` marker after ASCII space/tab,
so hostile comment payload cannot alter the checkpoint. Inserted LF escape
consumption and Unicode-scalar marker offsets are explicit. This does not split
comments, trim code, attach trivia, admit nodes, emit AST/KIR, or cut over the
frontend; it adds only
`kern-frontend-lexical-shadow: internal-oracle`, while `kern-frontend` remains
`not-shipped`.

M4.157 composes the authenticated lexical-checkpoint envelope inside KERN and
maps every checkpoint to an exact marker/payload partition. It classifies `#`
and `//`, preserves record identity and terminal lexical state, and copies the
raw payload through Unicode-scalar slicing without rescanning it. Fixed-width
records, source seals, an independent boundary oracle, hostile payloads, named
mutations, and inherited atomic failures are release-blocking. Code trimming,
normative whitespace ownership, trivia attachment, node admission, AST/KIR,
and frontend cutover remain explicitly absent, so this adds only
`kern-frontend-comment-boundary-shadow: internal-oracle`; `kern-frontend`
remains `not-shipped`.

M4.158 extracts M4.156's line-local lexical scanner into one shared native-KERN
helper and adds a bounded pre-tokenization whitespace-trim profile. The new
handler scans one admitted parser content record, computes scalar code/trivia
end offsets with an explicit ECMAScript WhiteSpace/LineTerminator table, and
tokenizes only retained code. This mirrors bootstrap ordering without widening
the general tokenizer: non-table unknowns in retained code still fail, while
well-formed payload and removable suffix scalars remain outside tokenization.
Record-end content is deliberately untrimmed. Fixed-width records, exact
source seals, full-table predicate evidence, integrated reachable-table cases,
legacy M4.156/M4.157 parity, and named mutations are release-blocking. Comment
attachment, node admission, AST/KIR, diagnostics changes, public APIs, and
frontend cutover remain absent, so this adds only
`kern-frontend-whitespace-trim-shadow: internal-oracle`; `kern-frontend`
remains `not-shipped`.

M4.159 composes the authenticated M4.158 retained-code boundary with the
unchanged M4.153 tokenizer and emits the complete ordered token and diagnostic
stream consumed before bootstrap node admission. Fixed-width records bind each
token kind/value to exact scalar and UTF-8 byte starts, bind diagnostic spans
independently, preserve the original source and trim partition, and seal both
ordered delta tapes. Empty retained code fails atomically; discarded Unicode
suffixes and comment payloads remain outside tokenization. Independent oracle
parity, astral byte coordinates, normalized token values, multi-diagnostic
starts, complete bounds, source seals, second-token corruption, and named
mutations are release-blocking. Trivia attachment, node admission, AST/KIR,
public APIs, and frontend cutover remain absent, so this adds only
`kern-frontend-retained-token-stream-shadow: internal-oracle`; `kern-frontend`
remains `not-shipped`.

M4.160 composes the complete authenticated M4.159 retained token stream and
shadows bootstrap `TokenStream.tryIdent()` at cursor zero. An identifier token
advances exactly once and exposes its normalized value; every other token kind
drops without skipping whitespace or consulting mutable known-node registries.
Dropped streams preserve the exact content-relative `DROPPED_LINE` diagnostic
and `__error` recovery value over retained code, while comment payload and
removed trivia remain authenticated but excluded. Independent oracle parity,
evolved-name normalization, leading-whitespace rejection, every non-identifier
token kind, UTF-16/scalar/byte coordinates, the configured 512-token and
64-diagnostic authentication bounds, phase seals, and named mutations are
release-blocking. The broader M4.159 producer limits remain unchanged.
Known-node classification, props,
successful parsed nodes, indentation/document coordinates, `export fn`, public
APIs, and frontend cutover remain absent, so this adds only
`kern-frontend-node-type-token-admission-shadow: internal-oracle`;
`kern-frontend` remains `not-shipped`.

M4.161 composes and completely authenticates the M4.160 admission envelope,
then attests exact membership in the immutable ordered `NODE_TYPES` catalog.
Positive membership returns `builtin` with its canonical zero-based index;
absence returns the deliberately nonterminal state `unresolved`. A generated
native-KERN catalog and checked-in canonical catalog data are mechanically
bound to the statically analyzable top-level const literal, while the
independent oracle reads only the checked-in data. Dynamic evolved types,
multiline parser hints, and template registrations remain mutable runtime state
and cannot change this attestation. `unresolved` therefore does not mean
unknown, rejected, or warning-worthy. Complete inherited authentication,
catalog drift, exact indices, registry non-claim asymmetry, bounded full-catalog
evaluation, and named mutations are release-blocking. Unknown-node warning
ownership, mutable registry snapshots, props, successful parsed nodes, AST/KIR,
public APIs, and frontend cutover remain absent, so this adds only
`kern-frontend-builtin-node-type-attestation-shadow: internal-oracle`;
`kern-frontend` remains `not-shipped`.

M4.162 fuses mutable-registry capture with one synchronous bootstrap parse and
binds the evidence to a process-local runtime identity plus a monotonically
increasing parse-call epoch. Canonical evolved, effective multiline, and
template-name membership lists are independently attested in native KERN after
composing M4.161. Direct legacy Set/Map writes remain compatible; restored
membership still receives a new parse epoch, duplicate membership is
idempotent, all six default multiline owners are mandatory, and altered
collection prototypes, iterators, proxy traps, stale evidence, and configured
count/name overflows fail closed. Snapshot evidence is privately bound to the
exact source and runtime and is consumable once. The three mutable flags and
inherited built-in verdict remain separate, so the slice neither emits nor owns
`UNKNOWN_NODE_TYPE`. Parser-hint definitions, template bodies, final knownness,
AST/KIR, public APIs, and frontend cutover remain absent, so this adds only
`kern-frontend-mutable-node-type-registry-snapshot-shadow: internal-oracle`;
`kern-frontend` remains `not-shipped`.

M4.163 composes M4.162 exactly once and combines the independently
authenticated built-in, evolved, effective multiline, and template-name
predicates into the bootstrap known-node decision. Admitted identifiers are
`known` when any predicate is true and `unknown` only when all four are false;
non-admission remains the separate state `dropped`. The slice owns exact
`UNKNOWN_NODE_TYPE` cardinality, code, severity, and synthetic single-line
UTF-16 coordinates, while message/category/suggestion rendering remains
bootstrap-owned. Complete inherited-envelope forwarding, the existing M4.162
host authenticator, one-time fused evidence consumption, all 16 admitted
predicate combinations plus dropped, typed failures, hostile envelopes,
named mutations, and maximum configured registry evidence are
release-blocking. Production parser authority, general diagnostic ordering,
physical indentation, multi-line spans, props, successful parsed nodes,
AST/KIR, public APIs, and frontend cutover remain absent, so this adds only
`kern-frontend-known-node-warning-shadow: internal-oracle`; `kern-frontend`
remains `not-shipped`.

M4.164 composes and completely authenticates M4.163 exactly once, then
re-observes the same retained token stream through the already published
M4.159 native observer. It owns one immediate generic property-admission unit:
leading token whitespace, adjacent identifier/equals recognition, exact
empty/quoted/expression/bare value projection, quoted-origin metadata, and
token-cursor handoff. Its dedicated pre-parse entry rejects adjacent
`__proto__=` before snapshot capture or bootstrap parser entry; quoted text and
inline comments containing those bytes remain admitted. The independent oracle
and bootstrap parse agree over that handler/hint-free single-line safe profile,
including inherited tokenizer diagnostics and known/unknown node states.
Direct bootstrap callers still inherit the frozen parser's unsafe property
accumulator and remain explicit debt for a separate compiled-core
re-attestation epoch. Duplicate last-write behavior, repeated properties,
styles/themes, parser hints, keyword handlers, successful parsed nodes,
AST/KIR, public APIs, and frontend cutover remain absent, so this adds only
`kern-frontend-generic-property-admission-shadow: internal-oracle`;
`kern-frontend` remains `not-shipped`.

M4.165 composes and completely authenticates M4.164 exactly once and
re-observes the retained token stream through M4.159 exactly once. Over a
handler/hint-free LF-free line ending at EOF or an inline comment, native KERN
owns the repeated generic-property loop: every write, first-write property
order, last-write values, exact `DUPLICATE_PROP` coordinates, expression
shape, and quoted-metadata order. Quote order is authenticated through each
final property's monotonic quote-add generation, avoiding a host collection
primitive in native source. A dedicated pre-parse entry rejects every
identifier/adjacent-equals key inherited by an ordinary empty object before
snapshot capture. M4.164 property semantics and M4.162 remain unchanged; the
shared M4.164 safety scan now recognizes actual `//` tokens and consumes bare
values before classifying later key candidates. Styles/themes,
unexpected tokens, hints, keyword handlers, successful parsed nodes, AST/KIR,
public APIs, and frontend cutover remain absent, so this adds only
`kern-frontend-generic-property-loop-shadow: internal-oracle`;
`kern-frontend` remains `not-shipped`.

M4.166 extends that bounded shadow through theme-reference boundaries. Native
KERN replays the admitted property loop from authenticated retained tokens,
preserves ordered duplicate `$name` occurrences, resumes properties after each
theme, and fails closed before style or unexpected-token semantics. The fused
bootstrap comparison and separate property/theme limits prove only
`kern-frontend-generic-property-theme-refs-shadow: internal-oracle`; style
parsing, theme resolution, successful node construction, public APIs, and the
canonical frontend remain absent, so `kern-frontend` remains `not-shipped`.

M4.167 extends the integrated property/theme replay through style blocks.
Native KERN owns UTF-16-aware comma splitting, quote/escape/parenthesis state,
pair precedence, visible ordinary-object key behavior, integer-key ordering,
pseudo-style state, and exact cursor-bound style evidence. The fused bootstrap
comparison, independent oracle, mutation suite, and cumulative receipt prove
only `kern-frontend-generic-property-style-theme: internal-oracle`; handlers,
hints, successful node construction, public APIs, and canonical frontend
cutover remain absent, so `kern-frontend` remains `not-shipped`.

M4.168 extends that replay through the bootstrap parser's recoverable
`UNEXPECTED_TOKEN` path. Native KERN authenticates the complete M4.167
predecessor, reconstructs its retained stream, records exact warning fields,
projects only proven stray token kinds to whitespace, and replays later
property/theme/style semantics. The integrated envelope preserves source-order
interleaving with `DUPLICATE_PROP`; bounded failure, corruption, containment,
and fused bootstrap parity prove only
`kern-frontend-generic-property-style-theme-diagnostics: internal-oracle`.
Parenthesized source is explicitly excluded because bootstrap minification
changes its token stream before this fused proof boundary. Multiline input,
handlers, hints, node construction, public APIs, and canonical frontend cutover
remain absent, so `kern-frontend` remains `not-shipped`.

M4.169 extends the same authenticated single-line profile through evolved
parser hints. The fused registry snapshot now carries deeply frozen runtime
hint evidence. Native KERN gives an explicit runtime entry precedence even
when empty, falls back to the built-in `class name` hint only when that entry
is absent, consumes positional arguments across arbitrary retained token
kinds, applies the adjacent-equals guard to at most one bare identifier, and
masks exactly consumed UTF-16 spans before composing M4.168 once. Twelve
differential fixtures, bidirectional payload swaps, one-shot evidence,
mutation killers, and bounded failure/containment checks prove only
`kern-frontend-evolved-hints: internal-oracle`. Keyword handlers, multiline
input, successful node construction, AST/KIR, public APIs, and canonical
frontend cutover remain absent, so `kern-frontend` remains `not-shipped`.

M4.170 extends that authenticated single-line profile through all 26 closed
keyword-handler contracts. Native KERN owns handler-local cursor and write
decisions, preserves hint→handler→generic phase order, masks handler spans at
UTF-16 width, authenticates the residual token stream and generic continuation,
and projects ordered seed-collision diagnostics with bootstrap parity. Positive,
fallback, nested, numeric, Unicode, replay, tamper, bounds, and containment
evidence proves only `kern-frontend-keyword-handlers: internal-oracle`.
Multiline parseLines ownership, successful node construction, AST/KIR, public
APIs, and canonical frontend cutover remain absent, so `kern-frontend` remains
`not-shipped`.

M4.171 composes one admitted LF/CR-free, space-indented logical line into a
complete authenticated `ParsedLine`-shaped record. Native KERN binds the raw
line, inline-comment trim, optional `export fn` prefix, indentation, UTF-16 raw
length, exact location, and one complete current-runtime M4.170 envelope. The
strict consumer preserves quoted-property presence, separates styles,
pseudo-styles, and ordered themes from properties, and reconstructs the full
tokenizer, known-node, duplicate-property, and unexpected-token diagnostic
tape before fused bootstrap comparison. This proves only
`kern-frontend-successful-line-composition: internal-oracle`; cross-line
`parseLines`, decorators, multiline blocks, node/tree construction, KIR
emission, and public cutover remain absent, so `kern-frontend` remains
`not-shipped`.

The Phase 1 formatter promotes `kern-formatter` to `internal-product` with an
authenticated 24,203-byte KERN composition. TypeScript contributes only a
bounded `kern.formatter.physical-records.1` LF/CRLF/EOF witness; KERN validates
ordinal order, terminators, reconstruction, raw/quote/expression/style/comment
precedence, and the trailing-trivia policy. The production path is fused to
avoid immutable-list quadratic growth, while the explicit source tape remains
  the losslessness oracle. The gate proves 24 focused contracts, hard 1x/2x/4x
walls, 191/192 tracked-source idempotence, and 27 structural-KIR pairs. This
does not promote `kern-frontend`: semantic nodes, diagnostics, and source-to-KIR
remain bootstrap-owned.

The R1.4b ownership proof is visibly `BOOTSTRAP-DEPENDENT`: it proves an
acyclic, oracle-free assignment for the planned canonical path and binds the
current TypeScript authority to source evidence. It does not prove executable
handler-semantic ownership, runtime cutover, or self-hosting; those remain
blocked on the planned interpreter shadow and fixed-point gates.

## KERN 4.5 Manifest App Substrate

| Surface | Current status | Evidence |
| --- | --- | --- |
| `app`, `view`, `route`, and `policy` manifest declarations | Supported | `packages/core/tests/app-descriptor.test.ts` |
| Duplicate apps, routes, views, policies, and handlers | Fail-closed | `packages/core/tests/app-descriptor.test.ts`, `packages/core/tests/runner-source-executor.test.ts` |
| Unknown policies and unknown capabilities | Fail-closed | `packages/core/tests/app-descriptor.test.ts`, `packages/core/tests/runner-capability-plan.test.ts` |
| Source path escaping, absolute source paths, and missing source files | Fail-closed | `packages/core/tests/app-descriptor.test.ts` |
| Descriptor-selected view and route handler execution | Supported | `packages/core/tests/runner-source-executor.test.ts` |
| Descriptor-selected async route execution | Supported for the tested matrix | `packages/core/tests/runner-source-executor.test.ts` |
| Unsupported async class initialization | Fail-closed in descriptor-selected paths | `packages/core/tests/runner-source-executor.test.ts` |

## KERN 4.5 Native Runner Substrate

| Feature | Current status | Evidence |
| --- | --- | --- |
| Functions and same-file pure helper calls | Supported | `packages/core/tests/runner-source-executor.test.ts` |
| Explicit multi-file `use` / `from` imports for pure helpers and classes | Supported for host-resolved `.kern` files with explicit exports | `packages/core/tests/runner-source-executor.test.ts`, `packages/cli/tests/run.test.ts`, `examples/native-multifile` |
| Missing exports, duplicate aliases, import cycles, imported `fn main`, and path escapes | Fail-closed before stdout | `packages/core/tests/runner-source-executor.test.ts`, `packages/cli/tests/run.test.ts` |
| Scalar, record, array, and class-instance helper values | Supported in tested sync and descriptor async paths | `packages/core/tests/runner-source-executor.test.ts` |
| `let`, mutable `let`, and `assign` | Supported for portable values and tested class fields | `packages/core/tests/runner-source-executor.test.ts` |
| `if`, `branch`, `while`, `for`, and `each` | Supported for tested portable runner shapes | `packages/core/tests/runner-source-executor.test.ts`, `packages/core/tests/runner-capability-plan.test.ts` |
| Arrays and records | Supported for tested bindings, returns, arguments, reads, and iteration | `packages/core/tests/runner-source-executor.test.ts` |
| Classes, fields, constructors, methods, inheritance, and `super(...)` | Supported for tested portable sync and pure descriptor async paths | `packages/core/tests/runner-source-executor.test.ts` |
| Capability calls inside class methods or constructors | Fail-closed | `packages/core/tests/runner-source-executor.test.ts` |
| Async class field initialization and async explicit `super(...)` arguments | Outside the supported matrix; descriptor paths fail closed | `packages/core/tests/runner-source-executor.test.ts` |
| Side-effecting helper calls | Outside the supported matrix and rejected where detected | `packages/core/tests/runner-source-executor.test.ts` |
| `throw`, `try`, `catch`, and `finally` | Supported for tested explicit errors and cleanup paths | `packages/core/tests/runner-source-executor.test.ts` |

## KERN 4.5 Capability Substrate

| Capability family | Current status | Provider rule |
| --- | --- | --- |
| `storage.*` and `crypto.*` | Shipped sync | Explicit host injection required |
| `app-http.queryParam` | Shipped sync | Host adapter provides declared request input |
| `rag.retrieve`, `rag.promptContext`, and `rag.checkAnswer` | Shipped sync | Explicit host injection required |
| `fs.*` and `net.fetch` | Async preview only | Explicit bounded async provider and opt-in required |
| `llm.complete` | Shipped async | Explicit bounded async provider required |
| `rag.retrieveAsync`, `rag.answer`, and `rag.ingest` | Shipped async | Explicit bounded async provider required |

Requirements are checked before execution. Unknown, undeclared, missing,
unsupported, and unprovided capabilities reject before application code can
continue. These providers remain host implementations. Runtime contract v1
freezes their invocation boundary without claiming a KERN-authored semantic
runtime.

## Reference App

`examples/kern-5-preview-app` is the maintained preview app for the current
substrate. Its manifest, view, route behavior, RAG query path, and grounding
guard are authored in `.kern`. `server.mjs` remains explicit host glue for HTTP,
filesystem source loading, request facts, local retrieval, deterministic model
output, and JSON transport framing.

## Explicit Exclusions

Until their ownership rows and gates are promoted, KERN 5.0 does not claim:

- a KERN-authored raw-source fact producer or broad nominal-checker cutover;
- a frozen versioned KIR/value/diagnostic contract or public/full KIR-to-runtime cutover beyond the sanctioned internal decoded-Module-KIR binder;
- a KERN-authored formatter, source frontend, compiler, or semantic interpreter;
- a clean Stage 0 to Stage 1 to Stage 2 fixed point;
- an exact packed-release/bootstrap proof;
- broad async class semantics, side-effecting helpers, or implicit host effects
  outside the tested 4.5 substrate.

No internal Alpha/Beta/RC status changes a package version or public npm tag.
