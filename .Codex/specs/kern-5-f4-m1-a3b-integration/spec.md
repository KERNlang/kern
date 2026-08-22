# KERN 5 F4-A3b Authenticated Source-Form Integration

**Status:** IMPLEMENTED AND LOCALLY VERIFIED — MERGE PENDING
**Date:** 2026-08-22
**Baseline:** `origin/main` `db9c2829026514a95a8f5b9016ee9a3f2e8d2bcc`
**Confidence:** 0.99

## Executive Summary

Integrate the A3a receipt-neutral keyword normalization kernel into the public
F1 -> F2B -> F3 -> one-root-F4 document path. A3b admits only scalar writes
that have authenticated source provenance and a constitution property row.
Synthesized controls and internal collection aggregates are consumed but do
not become public property occurrences. The 26-form evidence is an executable
test manifest, not a new field in the frozen document receipt.

The document remains the 17-field `kern.frontend.f4-document.2` receipt, the
private root call remains ABI 109, and the policy format remains
`kern.frontend.f4-declarations-policy.4`. Composition source hashes and the
full policy-byte/cache identity change atomically.

## Current State and Root Cause

- **[VERIFIED]** A3a owns the 26-form normalization decisions in private KERN
  `normalizekeywordhandlerwrites`; the shadow adapter is its only production
  caller and preserves the 52-fixture receipt digest.
- **[VERIFIED]** F4 authenticates the 26-row keyword catalog but does not call
  the normalization kernel. Its explicit property scan accepts only
  `name=value`, so positional source forms reach ordinary invalid-property and
  missing-property handling.
- **[VERIFIED]** F1 already transports an exact raw-source partition with kind,
  flag, start, and end geometry. F3 authenticates the logical-line and record
  boundaries. A3b therefore needs no shadow receipt or host tokenizer.
- **[VERIFIED]** A3a structured `fn`, `let`, `import`, and `params` writes
  currently reuse a whole-tail range. That is not sufficient provenance for
  an F4 occurrence or expression boundary.
- **[VERIFIED]** `bindings-v1`, `params-items-v1`, and `middleware-list` have no
  scalar constitution representation. `__firstClassSyntax`,
  `__firstClassImport`, and `__firstClassBindings` are internal controls, not
  constitution properties.
- **[VERIFIED]** `normalizekeywordhandlerwrites` has exactly one production
  caller, `keyword-handlers-simple.kern`. Other references are containment and
  mutation tests. Its private empty-array result currently conflates invalid
  input and write-limit exhaustion.
- **[DECIDED]** A3b is scalar-subset admission. It does not invent source spans,
  expose host objects, register internal aggregate kinds, or perform A7/C15
  import-graph projection.

## Tribunal and Plan Challenge

The required adversarial tribunal at
`~/.agon/runs/tribunal-1787372997814-t3yi5s` selected the AGAINST position.
It corrected the initial plan in four material ways:

1. provenance must distinguish authored scalars from synthesized/internal
   writes instead of assigning every write a fabricated range;
2. intentionally rejected forms still consume prospective diagnostic,
   fact-byte, and work budgets;
3. `.2` has no proven extension slot, so the 26-row classification belongs in
   test evidence rather than a public receipt field; and
4. the private result envelope may change only after enumerating and adapting
   its sole production caller while retaining the exact shadow receipt digest.

**[DECIDED]** No unresolved tribunal dependency feeds the RED oracle. Exact
structured spans, a discriminated kernel result, and shared occurrence
admission are implementation targets driven by the RED-at-base.

## Contract

### A3b-C1 — Authenticated F1 token adapter

F4 constructs the normalizer input only from already authenticated source,
F1 arrays/tape, and F3 logical-line/record geometry. For each logical line it:

1. selects the exact F1 record interval owned by that logical line;
2. converts ordinary record kind IDs to the A3a token-kind names and uses the
   exact source slice as the token value;
3. stitches F1 quoted or expression opener/continuation/closer records,
   including authenticated physical newline records, into one logical token;
4. decodes quoted escapes exactly as `tokenizeLineInternal`, trims the body of
   expression tokens, strips the `$` prefix from theme references, and strips
   only the delimiters from style tokens; and
5. expresses every token start/end relative to the logical content passed to
   the kernel while retaining exact absolute source geometry for projection.

Any impossible record role, missing composite boundary, non-monotone span,
record/logical-line mismatch, or reconstructed-source mismatch is atomic
`F4_AUTHORITY_DRIFT`. F4 must not call `observeretainedtokenstream`, another
shadow handler, parser-core, a host tokenizer, or a second source-form parser.

### A3b-C2 — Discriminated private kernel result

Evolve the private kernel result from its ambiguous empty-array sentinel to a
closed scalar envelope with status `success`, `invalid`, or `limit`:

1. status;
2. resolved type;
3. initial cursor;
4. final cursor;
5. write count;
6. normalization work delta; and
7. for every write: name, internal kind, scalar value, relative start,
   relative end, and provenance class.

The provenance classes are exactly:

- `authored-scalar`: the authored slice is already the scalar value spelling;
- `authored-normalized-scalar`: a closed kernel rule maps the exact authored
  slice to the scalar value, such as `GET` to `get`, a quoted value to decoded
  text, or the keyword `codegen` to boolean `true`;
- `synthetic-control`: an internal control such as `__firstClassSyntax`;
- `internal-aggregate`: `bindings-v1`, `params-items-v1`, or
  `middleware-list`.

`success` includes valid no-op/rewind results with zero writes. `invalid` is
reserved for malformed private input geometry and becomes
`F4_AUTHORITY_DRIFT` in the authenticated F4 path. `limit` is prospective and
becomes atomic `F4_LIMIT`. The shadow adapter maps the new success envelope
back to its unchanged fields and maps invalid/limit to its existing failure
behavior. Its ordered 52-fixture receipt SHA-256 remains
`e9e0bb42cbd47fe3563421fcb0a7e89a3e0b98edcc7f758d9e6ddd73859c5eb0`.

### A3b-C3 — Exact structured provenance

The existing structured handler path must return or preserve exact relative
bounds from the same parse that produced each scalar write. It must not locate
a value later with whole-document substring search.

For every projected write, the test manifest supplies a closed decoding rule
that maps the exact authored slice to the emitted scalar value. A span is
invalid if it is merely non-overlapping, covers the whole structured tail when
a smaller authored component exists, or slices text unrelated to the write.

Structured aggregate and synthetic-control writes retain their triggering
bounds only for internal validation; those bounds never create an occurrence.
This contract may split the existing structured KERN source to keep all
handwritten files below 500 lines, but it must not introduce a second grammar.

### A3b-C4 — Scalar occurrence projection

Only `authored-scalar` and `authored-normalized-scalar` writes with a matching
constitution property row become ordinary 13-field F4 property occurrences.
They use the existing constitution schema kind, required flag, disposition,
and value tape. Duplicate/effective-value behavior remains ordered
last-write-wins with the existing `DUPLICATE_PROP` diagnostic.

The public occurrence representation remains one of `bare`, `quoted`, or
`expression`:

- a positional/raw authored scalar is `bare`;
- a quoted authored value is `quoted`;
- an authored `{{...}}` value is `expression`.

A normalized bare write with disposition `lowered-expression` is parsed by
the existing local F2 path using an identity source-boundary map. This is a
semantic extension of the existing `.2` fields, not a new representation.
The decoder must require `decodedSource` to equal the authenticated authored
slice and require every identity boundary and absolute node span to bind to
that slice. Existing explicit bare expressions remain rejected unless they
arrive through this authenticated normalized-write path.

`synthetic-control` and `internal-aggregate` writes are consumed but never
become occurrences, facts, diagnostics, presence rows, bindings, or public
receipt metadata. In particular, A3b does not project import bindings into the
F4 binding tape; that remains A7/C15 work.

### A3b-C5 — Residual explicit properties

The kernel final cursor owns one contiguous normalized prefix. F4 resumes its
existing explicit property scan at that authenticated cursor, so trailing
`name=value`, quoted, expression, and duplicate properties retain their
current semantics and source spans. Consumed positional tokens must not also
emit invalid-property facts. A no-op/rewind success resumes at the existing
initial cursor and therefore retains the current malformed/fallback behavior.

### A3b-C6 — Shared prospective admission

Normalized and explicit occurrences use one KERN-owned admission helper and
one ordered occurrence-parts buffer. Before retaining a candidate, the helper
checks in this order:

1. valid 13-field framing and constitution binding;
2. `maxPropertyOccurrences` prospective count;
3. exact UTF-8 bytes of the framed occurrence against the occurrence tape's
   `maxEncodedBytes` ledger; and
4. the fixed occurrence-admission work debit against `maxWorkSteps`.

Only an `ok` result may push the framed row and update count, bytes, and work.
Normalized rejected values use the existing prospective fact/diagnostic
funnels. Required-presence diagnostics remain post-scan and retain C14 order.
Every candidate unit is atomic: a limit returns `F4_LIMIT` with all ordinary
receipt partitions empty. Authority/prerequisite/F3 drift retains precedence.

Before invoking the kernel, F4 prospectively debits a deterministic linear
normalization budget based on logical-content scalars plus authenticated input
records. The kernel prospectively checks its configured write cap before each
private write retention and returns its exact additional candidate-write
delta. A3b does not claim literal CPU-instruction metering; it claims a bounded
linear F4 work ledger over authenticated input geometry.

### A3b-C7 — Canonical 26-form matrix

Each row below runs through public `runDocument`, real F1/F2B/F3, and exactly
one root F4 invocation. The fixture is nested under a valid module root so the
source-form result is not confused with root/attachment validity.

| Form | Projected normalized writes | Internal-only writes | Expected status |
| --- | --- | --- | --- |
| `fn` | `name`, `params`, `returns`, `async` | `__firstClassSyntax` | rejected: excluded host type |
| `let` | `name`, `type`, `value` | none | rejected: excluded host type |
| `return` | `value` | none | classified |
| `throw` | `value` | none | classified |
| `do` | `value` | none | classified |
| `if` | `cond` | none | classified |
| `while` | `cond` | none | classified |
| `doc` | `text` | none | classified |
| `theme` | `name` | none | classified |
| `import` | `names`, `from` | `__firstClassImport`, `__firstClassBindings`/`bindings-v1` | classified |
| `island` | `kind`, `name` | none | classified |
| `route` | `method`, `path`; trailing `name` remains explicit | none | classified |
| `params` | none | `items`/`params-items-v1` | classified empty scalar subset |
| `auth` | `mode` | none | classified |
| `validate` | `schema` | none | classified |
| `error` | `status` as unknown plus `message` | none | rejected: unknown and missing required |
| `derive` | `name` | none | rejected: missing required `expr` |
| `guard` | `name` | none | classified |
| `effect` | `name` | none | classified |
| `strategy` | `name` | none | classified |
| `trigger` | `kind` | none | classified |
| `respond` | `status`; trailing `json` remains explicit | none | rejected: excluded host expression |
| `expect` | `codegen`; trailing `contains` remains explicit | none | classified |
| `rule` | `id`; trailing `severity` remains explicit | none | classified |
| `message` | `template` | none | classified |
| `middleware` | none | `names`/`middleware-list` | rejected: missing required `name` |

The matrix must assert exact ordered occurrences, presence, diagnostics, facts,
expression evidence, and status. It must not weaken a rejection to a generic
`status !== classified` assertion. The six rejected forms consume their real
prospective fact, diagnostic-byte, and work budgets.

### A3b-C8 — Focused seam evidence and M3 boundary

In addition to the 26 canonical positives, A3b covers one discriminating case
for each of: invalid rewind/no-op, malformed structured input, multiline raw
expression, quoted escapes, astral text, trailing explicit property, normalized
plus explicit duplicate, internal aggregate exclusion, exact occurrence cap,
exact UTF-8 byte cap, work cap, and F1/F3 mutation precedence.
These categories are grouped into nine executable tests because single public
receipts intentionally prove several adjacent properties together (for
example authored spans plus quoted/residual writes, and count plus byte/work
limits). Together with the 26 per-form leaves, that yields the reported
`35/35` focused result; the category list is not an additive leaf count.

M3 retains large-input scaling, all 52 A3a fixtures through public F4,
multi-form tails, every policy-limit cross-product, exhaustive malformed
mutation campaigns, and complete 26-form adversarial combinations. M3 does not
reopen the scalar projection or canonical per-form semantics frozen here.

### A3b-C9 — Frozen public contracts

A3b changes no:

- document field count or `kern.frontend.f4-document.2` identity;
- document private ABI 109;
- policy format `.4`;
- F1, F2, F2B, or F3 public receipt or policy;
- authority JSON or generated authority rows;
- F4B module-set ABI/format; or
- terminal fitness/promotion row.

The full F4 composition descriptor list, policy bytes/SHA-256, and cache
identity change atomically with all new/changed KERN sources.

## Implementation Plan

1. Add RED-at-base tests for the canonical 26-form public matrix, exact
   authored provenance, private status split, internal exclusions, residual
   properties, normalized bare expression evidence, prospective caps, and
   mutation precedence.
2. Evolve the neutral kernel envelope and structured provenance while adapting
   the sole shadow caller; retain the exact 52-fixture shadow receipt digest.
3. Add an F1/F3-to-normalizer adapter and shared occurrence admission in new
   bounded KERN helper modules; keep the near-limit semantic source below 500
   lines by extraction rather than compression.
4. Integrate cached per-line normalization before explicit residual scanning,
   then extend expression evidence/decoder checks for authenticated normalized
   bare local expressions.
5. Update only composition SHA descriptors and containment checks required by
   the new sources. Regenerate no authority data.
6. Run focused REDs, A3a parity, keyword-handler package, expression/decoder/
   C13/A5/A6 adjacency, full F4, lint, build, consistency, exact policy pins,
   deterministic authority zero-diff, and `git diff --check`.
7. Run automatic-risk independent Agon review with the actual primary engine,
   fix verified blockers, and make granular Agon-signed commits. This execution
   has an explicit project-owner instruction to push the complete slice once
   to `main`; verify that remote SHA after the authorized push.

## Blast Radius

| Area | Expected action |
| --- | --- |
| This satellite spec | Add. |
| A3a normalizer and structured KERN sources | Evolve private status/provenance/exact-range contract; split if needed. |
| Keyword shadow adapter/tests | Adapt private envelope; prove byte-identical public receipt digest. |
| New F4 normalization/occurrence helpers | Add authenticated token adapter and shared prospective admission. |
| F4 semantic/expression KERN | Integrate cached normalized writes and bare local-expression evidence. |
| F4 decoder | Bind normalized bare local evidence to exact authenticated source geometry. |
| F4 policy validation/policy | Add/order/pin new composition sources only. |
| F4 tests | Add public matrix, provenance, cap, mutation, and containment evidence. |
| Parent F4 spec and completion goal | Update only after reviewed local acceptance. |

All touched handwritten files remain below 500 lines. Existing oversized files
must not grow; generated files, lockfiles, and authority data remain unchanged.

## Acceptance Criteria

- **[A3b-A1]** F1 raw partitions plus F3 geometry reconstruct the exact A3a
  token view, including quoted/escaped, expression, astral, and multiline
  composite cases; every adapter mutation fails closed.
- **[A3b-A2]** The private kernel has the exact closed status/provenance shape,
  its caller inventory remains one production adapter, and the 52-fixture
  public shadow receipt digest is unchanged.
- **[A3b-A3]** Every projected write has a source slice that passes its exact
  authored decoding rule. Whole-tail or unrelated non-overlapping ranges fail
  the oracle.
- **[A3b-A4]** The canonical table passes exactly 20 classified and six
  rejected public receipts with exact ordered ordinary partitions.
- **[A3b-A5]** Internal controls/aggregates create no occurrence, presence,
  binding, fact, diagnostic, or public metadata row; import graph semantics are
  unchanged.
- **[A3b-A6]** Normalized bare lowered expressions create sealed local F2
  evidence whose decoded source, identity boundaries, and absolute spans bind
  exactly to the authenticated authored slice; forged representation/source/
  boundary mutations are rejected.
- **[A3b-A7]** Normalized and explicit occurrences share one prospective
  admission funnel. Exact cap passes; cap-minus-one yields atomic `F4_LIMIT`.
  Structural canaries reject any direct occurrence retention bypass.
- **[A3b-A8]** Invalid/private drift, write limit, F1 drift, F3 drift, and
  ordinary semantic rejection retain their exact distinct outcomes and
  precedence.
- **[A3b-A9]** Public `runDocument` remains a two-argument API and invokes one
  F1, one F2B, one F3, and one root F4. Private seams never fabricate receipts.
- **[A3b-A10]** Document `.2`, ABI 109, policy `.4`, F4B, authorities, and
  generated authority bytes remain frozen; exact composition pins validate.
- **[A3b-A11]** All focused/adjacent/full gates and automatic-risk independent
  review pass with no unresolved verified blocker.
- **[A3b-A12]** Parent status may mark F4-A3 locally implemented/verified only
  after this matrix passes. F4 overall, terminal rows, and completion
  percentage remain unpromoted pending A7-A10/C15/scale.

## Local Acceptance Evidence

- **[A3b-E1 VERIFIED]** The focused public-path matrix passes `35/35`, including
  the 26 canonical forms, authenticated source spans, local expression
  evidence, occurrence count/UTF-8/work boundaries, drift precedence, and the
  private write-cap structural canary.
- **[A3b-E2 VERIFIED]** The adjacent document, expression, eligibility,
  C13-LOCAL, A5, A6, and resource set passes `246/246`. The C13 invalid-child
  byte fixture intentionally uses property-free detached children so its
  facts ledger remains the first exact UTF-8 boundary after A3b began exposing
  authenticated positional occurrences.
- **[A3b-E3 VERIFIED]** The complete F4 declarations wall passes `458/458`, the
  complete keyword-handler gate passes `23/23` plus its regression wall, root
  `pnpm build`, lint, repository consistency, all `41/41` policy pins, and
  deterministic authority regeneration are green on the reviewed candidate.
- **[A3b-E4 REVIEWED]** Automatic-risk role-lens review completed `2/2` with no
  verified blocker. Its diagnostic-byte needs-check was adjudicated against
  the independent E17/resource-limit byte oracles and A3b occurrence-byte
  boundary; no production change was required. F4 remains unaccepted and
  unpromoted outside this bounded A3b evidence.

## Kill Switches

Stop and respec if implementation requires:

1. a public document/ABI/policy-format change or an alleged `.2` extension;
2. consuming a retained-token or keyword-handler shadow receipt in F4;
3. a host tokenizer/parser or a second independent source-form grammar;
4. fabricating a source span for a synthesized/internal write;
5. exposing internal aggregate encodings as ordinary scalar values;
6. projecting import bindings or graph semantics before A7/C15;
7. weakening any intentional rejection or resource limit to generic failure;
8. changing the 52-fixture shadow receipt digest;
9. adding changeable operational policy as a source literal;
10. a handwritten touched source at or above 500 lines; or
11. promoting F4/terminal status from this bounded semantic slice.

## Deploy Order

RED/spec, private-kernel evolution, and F4 integration may be granular local
commits, but the entire A3b feature is pushed once only under the recorded
project-owner authorization for this slice. Private envelope changes, the
adapted shadow caller, F4 composition, policy SHA pins, decoder semantics, and
tests land atomically. A following slice starts from a fresh
`origin/main` only after the remote main SHA is verified.

## Corrections Log

| Rejected claim | Decided correction |
| --- | --- |
| Every A3a write is an F4 occurrence. | Only authored scalar classes with constitution rows project. |
| Non-overlapping structured spans prove provenance. | Each span must decode from its exact authored slice. |
| Internal collection encodings can be serialized as strings. | They remain consumed internal aggregates until their owning later contract. |
| All 26 positive normalizer fixtures must classify. | Canonical F4 semantics are exactly 20 classified and six intentionally rejected. |
| Rejected forms cost zero bytes/work. | Their admitted fact/diagnostic evidence is prospectively metered. |
| A test matrix can ride in a `.2` extension field. | The matrix is test-only; `.2` remains 17 fields. |
| `[]` is a sufficient private failure result. | The kernel distinguishes success, invalid, and limit after caller audit. |
| Whole-tail structured ranges are permanently acceptable. | Exact per-write source provenance is required before projection. |
| A3b must complete import binding graphs. | A3b consumes internal bindings without projection; A7/C15 owns graph semantics. |
| M3 may decide basic source-form semantics later. | A3b freezes one canonical case per form; M3 owns exhaustive adversarial expansion. |
