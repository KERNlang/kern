# KERN 5 F1 Production Physical Scanner

**Status:** READY TO BUILD

**Date:** 2026-08-15

**Baseline:** `8e4d4e79400dae07ae33a6f37727db7b7416d654`

**Corrective tribunal:**
`/Users/nicolascukas/.agon/runs/tribunal-1786787671528-oi9ml7-kern5-production-f1-contract`

**Nero challenge:**
`/Users/nicolascukas/.agon/runs/nero-1786788419463-66i9eg`

**Confidence:** 0.92 after resolving the adversarial challenge

## Executive Summary

The current `test:kern-frontend-f1` gate proves only that a nine-text-field
runtime result can transport 65,536 worst-case physical records. It does not
classify KERN source. This slice adds the missing production F1 scanner as an
authenticated composition of KERN modules, keeps every physical newline as an
independent record, and returns a private sealed tape that partitions the input
exactly in Unicode-scalar coordinates.

F1 remains lexical and physical. It does not compute indentation meaning,
logical lines, expression trees, declarations, modules, or KIR. The terminal
`test:kern-frontend` script remains absent.

## Current State / Root Cause

- **[VERIFIED]** The F1 contract says P0 transport is complete and production
  scanner contract extraction is next. Evidence:
  `.Codex/specs/kern-5-f1-document-scan/spec.md:1-25,412-454`.
- **[VERIFIED]** P0 returns exactly nine text fields, uses six-field
  scalar-length-framed records, and already proves atomic empty output on
  failure. Evidence:
  `.Codex/specs/kern-5-f1-document-scan/spec.md:108-126,199-259`.
- **[VERIFIED]** The live line tokenizer exposes eleven kinds:
  `identifier`, `number`, `equals`, `quoted`, `expr`, `style`, `themeRef`,
  `slash`, `comma`, `whitespace`, and `unknown`. Evidence:
  `packages/core/src/parser-tokenizer.ts:13-24`.
- **[VERIFIED]** The live parser separately recognizes whitespace-gated `#`
  and `//` comments outside quotes, style blocks, and expression blocks.
  Evidence: `packages/core/src/parser-core.ts:44-102`.
- **[VERIFIED]** The live parser separately owns physical-line stitching,
  comment-line skipping, and `<<<`/`>>>` multiline boundaries. Evidence:
  `packages/core/src/parser-core.ts:480-648`.
- **[VERIFIED]** Runtime `Text.length`, `Text.charAt`, and `Text.slice` use
  Unicode-scalar indexing and reject malformed UTF-16. Evidence:
  `packages/core/tests/runtime-envelope-effect-machine-text-cache.test.ts:27-56`.
- **[CORRECTED]** The previous next-slice tribunal assumed that F1 scanning was
  complete and chose F2. Reading the live F1 spec disproved that premise. F2 is
  deferred until this production F1 contract passes.

The root cause is a naming mismatch: `test:kern-frontend-f1` authenticates P0
transport but its phase name can be misread as semantic F1 completion. The new
semantic gate is therefore named `test:kern-frontend-f1-scan`; the existing P0
gate remains unchanged.

## What Already Works

- P0's 256-record chunks, eight-level balanced concatenation, strict decoder,
  encoded-envelope wall, and mutation matrix remain the transport substrate.
- The execution-local Text cache makes a 65,536-scalar KERN scan feasible.
- F0 already freezes the source/KIR surface and F1/F2/F3 boundaries; this slice
  adds no syntax or KIR kind.
- Existing TypeScript and frontend-shadow paths remain test oracles only. No
  production F1 module may import or call them.

## Contract

> Verified against the source cited above on 2026-08-15. All decisions below
> are private protocol decisions for F1/F3 and do not create a public API.

### Result envelope

The exported KERN handler returns the same nine positional text fields as P0:

| Position | Success | Failure | Tag |
| --- | --- | --- | --- |
| 0 | `kern.frontend.f1-scan.1` | same | DECIDED |
| 1 | `scanned` | `failure` | DECIDED |
| 2 | empty | framed `code,startScalar,endScalar` | DECIDED |
| 3 | canonical source-scalar count | same | DECIDED |
| 4 | record count | `0` | VERIFIED by P0 atomic shape |
| 5 | chunk count | `0` | VERIFIED by P0 atomic shape |
| 6 | maximum guest-list length | `0` | VERIFIED by P0 atomic shape |
| 7 | sealed record tape | empty | VERIFIED by P0 atomic shape |
| 8 | `eof:<source>:<records>:<chunks>:closed` | `failure` | VERIFIED by P0 seal shape |

The failure payload is three scalar-length-framed fields. The code vocabulary
is `ILL_FORMED_SOURCE`, `SOURCE_LIMIT`, `UNCLOSED_STRING`, `UNCLOSED_EXPR`,
`UNCLOSED_STYLE`, `UNEXPECTED_TOKEN`, `TRANSPORT_LIMIT`, and
`FORCED_LATE_FAILURE`. The forced failure exists only in the test entry point.

### Record vocabulary and flags

Each record retains P0's six fields:

```text
record = ordinal,class,kindCode,startScalar,endScalar,rawScalarLength:raw
```

`class` is `token` or `trivia`. `kindCode` is canonical unsigned decimal text
computed as `kindId * 8 + flags`. The three flag bits are `OPENER = 1`,
`CLOSER = 2`, and `CONTINUATION = 4`. Flags are zero for ordinary records.
This preserves P0 framing and gives F3 enough information to consume sliced
multiline composites without rescanning raw text.

The three bits are exhaustive protocol roles, not a general state bag. Escape
state affects where a composite closes but is not an emitted fact; malformed
state returns the atomic failure envelope and emits no record. No fourth flag
exists. The producer rejects any internal flags outside `0..7`, and the decoder
rejects any encoded `kindCode` whose quotient/remainder is not an admitted
kind/flag combination, so arithmetic cannot alias one kind into another.

| ID | Kind | Class |
| ---: | --- | --- |
| 0 | `identifier` | token |
| 1 | `number` | token |
| 2 | `equals` | token |
| 3 | `slash` | token |
| 4 | `comma` | token |
| 5 | `quoted` | token |
| 6 | `expr` | token |
| 7 | `style` | token |
| 8 | `themeRef` | token |
| 9 | `unknown` | token |
| 10 | `whitespace` | trivia |
| 11 | `newline` | trivia |
| 12 | `comment` | trivia |
| 13 | `fenceMarker` | trivia |
| 14 | `fenceBody` | trivia |

`eof` is a seal state, never a record. The decoder rejects unknown IDs,
impossible flags, class/ID disagreement, flags on non-composite kinds, or a
continuation without a preceding open composite.

### Physical dispositions

- Every LF or CRLF is exactly one `newline` record in every lexical state.
  Lone CR and BOM are `unknown`.
- Quote, expression, and fence segments never absorb a newline. The first
  segment has `OPENER`, middle segments have `CONTINUATION`, and the final
  segment has `CONTINUATION|CLOSER`; a same-line composite has
  `OPENER|CLOSER`.
- Both single- and double-quoted strings continue symmetrically. Backslash
  escapes the next scalar inside either quote form.
- `{{...}}` expression depth is nested-pair and quote aware. F1 does not parse
  the expression body.
- `{...}` style spans are line-local, close only on an unquoted `}`, and cover
  the adversarial `x={a:"}"}` case. An open style at newline fails atomically
  with `UNCLOSED_STYLE`.
- `#` and `//` begin a `comment` only at source start or after space/tab and
  only in base state. The marker and comment body form one record; the newline
  is separate. `url=http://x` is not a comment.
- `<<<` and `>>>` are recognized as physical `fenceMarker` records in base
  state without consulting mutable multiline node types. F3 decides whether a
  marker belongs to an admitted raw block. After an opener, same-line `>>>`
  closes; on later lines only a marker preceded solely by space/tab closes.
  Non-marker content inside the fence is `fenceBody`.
- Identifiers, numeric forms, theme references, slash paths, `=`, `,`, spaces,
  tabs, and unknown scalars follow the frozen line-token source rules. The raw
  span always includes source delimiters even where the TypeScript token value
  strips them.

The handler receives one complete immutable source string. P0 chunks are
output batching only; they are never input pages and never reset lexical state.
The scalar cursor may therefore inspect the next scalar before classifying CR
as lone `unknown` or the first half of one CRLF `newline`, including when the
result record happens to cross an output-chunk boundary.

### Failure precedence

Failures are atomic: one framed diagnostic, zero records/chunks/list length,
empty tape, zero events, and seal `failure`.

1. host/runtime text admission rejects ill-formed UTF-16;
2. `SOURCE_LIMIT` rejects more than 65,536 Unicode scalars before scanning;
3. a line-local style still open at newline returns `UNCLOSED_STYLE` at its
   opener span;
4. at EOF, the earliest still-open outer composite wins:
   `UNCLOSED_STRING`, `UNCLOSED_EXPR`, or `UNEXPECTED_TOKEN` for a fence.

This ordering is source-position based, not enum-priority based.

### Ownership and skew

- Production classification exists only in regular `.kern` modules, each
  below 500 lines. TypeScript may authenticate files, invoke the handler,
  decode framing, verify partition identity, and compare independent fixtures.
- The production import/call closure forbids `parser-*`, `typescript`,
  `parseInternal`, `parseDocument`, `tokenizeLineInternal`, KIR projection,
  frontend shadow receipts/sources, capabilities, and host handlers.
- This is a private boundary with no live consumer until F3. F1 lands first;
  F2 and F3 later consume the exact format. There is no version-skew window.
- F3 derives indentation width from leading `whitespace` record raw lengths,
  physical lines from `newline`, and composite state from kind flags. It does
  not need byte offsets, line/column fields, or a second lexical classification
  pass. Scalar spans plus raw records are deliberately the maximally lossless
  private representation.

## Implementation Options

### Selected: KERN state machine over P0 transport

Compose small KERN catalog, character-class, frame, batching, token, composite,
and entry modules. Scan once with a scalar cursor, reserve each record, and
commit chunks only after the full source closes successfully. Reuse P0's
balanced concatenation and numerical walls.

### Rejected: delegate line tokenization to TypeScript

This cannot establish KERN ownership and reproduces known quote-continuation,
CRLF, and fence-boundary discrepancies. Those discrepancies become explicit
anti-delegation fixtures.

### Rejected: swallow newlines inside composite records

That would force F3, source maps, and diagnostic consumers to rescan composite
raw text for physical terminators, duplicating F1 semantics across the seam.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `examples/kern-frontend/f1-scan-*.kern` | add | KERN-owned scanner composition, all files below 500 lines |
| `scripts/kern-frontend-f1-scan/policy.json` | add | Tunable limits, format, kind IDs, flags, and corpus geometry |
| `scripts/kern-frontend-f1-scan/decoder.mjs` | add | Independent strict tape/result decoder |
| `scripts/kern-frontend-f1-scan/fixtures.mjs` | add | Hand-authored bug fingerprints and valid/malformed corpus |
| `scripts/kern-frontend-f1-scan/mutations.mjs` | add | Killable contract mutations |
| `scripts/kern-frontend-f1-scan/worker.mjs` | add | Authenticate composition and invoke the real runtime |
| `scripts/kern-frontend-f1-scan/scan.test.mjs` | add | Focused RED/GREEN, fuzz, limits, and scaling oracle |
| `package.json` | edit | Add only `test:kern-frontend-f1-scan` |
| `scripts/kern-5-fitness-policy.json` | edit | Add current non-terminal F1 scan gate/ownership row |
| `scripts/kern-5-fitness.test.mjs` | edit | Bind new current gate and keep terminal script absent |
| F1 spec, goal, matrix, release train | edit | Correct P0/F1 status and record landed evidence |

## Acceptance Criteria

- [ ] **[F1S-A1]** RED at `8e4d4e79` is the missing
      `test:kern-frontend-f1-scan` script and production scanner assets; the P0
      gate remains green.
- [ ] **[F1S-A2]** The KERN composition alone returns all 15 kind IDs and every
      valid flag combination through the strict decoder.
- [ ] **[F1S-A3]** Every valid fixture partitions source exactly once in
      Unicode-scalar half-open spans, preserves raw delimiters and original
      LF/CRLF, reconstructs byte-identical source, and emits zero events.
- [ ] **[F1S-A4]** Bug-fingerprint fixtures prove symmetric single/double quote
      continuation, CRLF isolation, inline-versus-line-leading fence closure,
      whitespace-gated comments, `url=http://x`, astral scalars at chunk
      boundaries, nested expressions, and quote-gated style closure.
- [ ] **[F1S-A5]** Malformed source produces the exact first framed diagnostic
      and otherwise atomic empty output; exact-cap succeeds and cap-plus-one
      fails before classification.
- [ ] **[F1S-A6]** A frozen splitmix64 generator produces at least 10,000
      deterministic sources and proves partition identity, newline isolation,
      flag-state coherence, determinism, and decoder rejection of mutations.
- [ ] **[F1S-A7]** Mutations kill TypeScript/host/shadow delegation, constant or
      stale output, kind/class/flag drift, span drift, dropped/duplicated/
      reordered records, swallowed newline, marker drift, partial failure,
      changed module order, and permissive decoder behavior.
- [ ] **[F1S-A8]** Built and source import/call closure contains none of the
      forbidden authorities, and all authenticated source/policy digests are
      checked before invocation.
- [ ] **[F1S-A9]** 1x/2x/4x/8x corpora satisfy authenticated absolute and
      adjacent scaling walls while P0's full-cap transport, runtime envelope,
      source-runner convergence, canonicalizer, checker, formatter, lint, and
      full promoted KERN 5 fitness gates remain green.
- [ ] **[F1S-A10]** `test:kern-frontend-f1-scan` is current and
      `internal-oracle`; `test:kern-frontend` remains absent/planned and all six
      terminal ownership gates remain open.

## Out of Scope

- Indent/dedent meaning, logical continuation, decorators, tree attachment,
  expression parsing, declarations, module graphs, KIR projection, or public
  parser APIs.
- Promotion of `test:kern-frontend`, compiler work, fixed point, interpreter,
  canonical cutover, packed release, tag, or registry publication.
- Generated TypeScript/Python scanner parity; F7 owns final target promotion.

## Open Questions

No product question remains. The flag encoding and EOF precedence require the
mandatory adversarial spec challenge before implementation. Any unresolved
technical objection from that challenge reopens this section and caps
confidence below 0.90.

The Nero challenge returned `FLAWED` by assuming four unstated capabilities:
an extra emitted escape/error flag, streamed input chunks, block comments and
template literals, and byte offsets. None is in the frozen F1 contract. It did
expose two genuine ambiguities, now resolved above: only protocol-role flags are
emitted, and P0 chunks batch output rather than page input. No objection remains
unresolved.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| F1 scanning was current after `8e4d4e79`. | Only the P0 transport/falsification prerequisite is current. | Production F1, not F2, is the next slice. |
| Composite records could swallow physical newlines. | Downstream consumers would need to re-lex raw text. | Newlines are always separate and composite role is encoded in flags. |
| TypeScript behavior is one coherent lexical oracle. | Quote continuation, CRLF, and fence paths disagree. | Freeze a KERN contract and use the disagreements as delegation fingerprints. |
