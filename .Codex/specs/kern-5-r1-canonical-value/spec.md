# KERN 5 R1.5b Bounded Canonical Value Reader

**Status:** COMPLETE
**Date:** 2026-07-12
**Confidence:** 0.97
**Depends on:** R1.5a commit `2a0aaa8bc69a4ff09585af946513410688d8903a`
**Tribunal:** `tribunal-1783823399158-5lv417` (`claude,codex,agy`, 3/3)

## Executive Summary

R1.5b extracts a separately versioned, browser-safe canonical value reader at
`kern.canonical-value.r1.5b.1`. It consumes `Uint8Array`, rejects malformed
UTF-8 and noncanonical JSON, validates a closed portable data domain, and
requires every resource ceiling from the caller. It remains internal and does
not replace, rename, export, or adapt the seven-node semantic-KIR probe.

This slice creates the bounded wire/value foundation that R1.5c can consume
when it closes module/node writer-reader parity. It is not KIR v1 and does not
change runtime behavior. **VERIFIED tribunal decision**

## Current State and Root Cause

1. `decodeKirReaderCandidate` accepts an already-decoded JavaScript string and
   calls `JSON.parse` before any byte/depth/resource accounting. **VERIFIED**
2. Candidate validation recursively accepts unbounded strings, collections,
   values, expressions, nodes, modules, and diagnostics. **VERIFIED**
3. Integer admission calls `Number`/`Number.isSafeInteger`; regex admission
   calls the current host `RegExp`. **VERIFIED**
4. The value union lacks map and error data and includes expression, regex, and
   negative-zero probe shapes that are not eligible for this portable profile.
   **VERIFIED**
5. The probe remains internal, unexported, and unused by runtime entrypoints;
   mutating it now would conflate the value foundation with R1.5c node parity.
   **VERIFIED tribunal conclusion**

## Contract

| Behavior | R1.5b contract | Tag |
|---|---|---|
| Format | Exact envelope `{ format, value }` with format `kern.canonical-value.r1.5b.1`; exact keys only | VERIFIED design decision |
| Input | `Uint8Array` only; configured byte ceiling checked before decoding; UTF-8 decode is fatal | VERIFIED design decision |
| Canonical bytes | UTF-8 canonical JSON, code-point-sorted object keys, no insignificant whitespace, exactly one terminal LF | VERIFIED design decision |
| Tags | Closed set: `null`, `bool`, `text`, `int`, `decimal`, `list`, `record`, `map`, `error` | VERIFIED tribunal decision |
| Integer | Text `0|-?[1-9][0-9]*`; no host-number conversion; configured digit ceiling | VERIFIED tribunal decision |
| Decimal | Text `-?(0|[1-9][0-9]*)\.[0-9]+`; no exponent or negative zero; configured integer/fraction/total ceilings; scale is identity (`1.0` and `1.00` differ) | VERIFIED tribunal decision |
| Record | Ordered entry array with unique well-formed text keys strictly sorted by Unicode code point | VERIFIED tribunal decision |
| Map | Ordered entry array with unique scalar keys (`null/bool/text/int/decimal`) strictly sorted by canonical key bytes | VERIFIED tribunal decision |
| Error data | `{ code, message, details }`; code is a portable identifier, message is text, details is a value or JSON null | VERIFIED tribunal decision |
| Limits | Caller supplies positive-safe-integer `maxBytes`, `maxDepth`, `maxNodes`, `maxStringBytes`, `maxCollectionLength`, `maxRecordFields`, `maxMapEntries`, `maxIntegerDigits`, `maxFractionDigits`, and `maxDecimalChars`; `maxDepth` bounds both JSON lexical nesting and semantic value nesting | VERIFIED tribunal decision |
| Failure | Typed `CanonicalValueDecodeError` contains stable code, byte offset only for byte-preflight failures, structural path, and non-host-derived message; no partial value escapes | VERIFIED design decision |
| Host exclusion | JSON numbers, regex, expressions, operators, functions, `undefined`, bigint, negative-zero tags, unknown fields/tags, and fallback normalization reject | VERIFIED tribunal decision |
| Encoder input | Plain objects (`Object.prototype` or null) and dense plain arrays only; accessors, symbols, extra array fields, class instances, proxies that cannot be inspected, and sparse arrays reject | VERIFIED audit hardening |
| Exposure | Internal source only; absent from package/runtime/browser public barrels | VERIFIED design decision |

Failure precedence is fixed: input type, `maxBytes`, terminal-LF/BOM checks,
fatal UTF-8 decode, lexical JSON depth, JSON parse, envelope version, semantic
shape/resource validation, then canonical-byte equality. The lexical scan runs
only after successful fatal decode and counts every `{`/`[` outside strings,
including the envelope. Semantic depth starts at one for the root tagged value;
`maxNodes` counts every tagged value, including map keys and non-null error
details. Collection, record, and map ceilings count their entry arrays. Every
string field, including the format identifier, tag, keys, code, and message,
is bounded by UTF-8 byte length. **VERIFIED audit hardening**

Canonical JSON uses code-point-sorted object fields, dense arrays in supplied
order, raw well-formed non-ASCII text, the short JSON escapes for quote,
backslash, backspace, tab, LF, form feed, and carriage return, and lowercase
`\\u00xx` for the remaining U+0000..U+001F controls. Slash and other printable
characters are not escaped. There is no insignificant whitespace and exactly
one terminal LF. A map key is encoded as its standalone tagged scalar JSON—no
envelope and no LF—and compared as unsigned bytes, with a shorter exact prefix
first; equal bytes are duplicates. **VERIFIED audit hardening**

## Rejected Options

### Replace or rename the semantic-KIR probe

Rejected. The probe covers seven of 302 source nodes and no runtime contract.
Changing it would imply KIR compatibility before R1.5c closes writer parity.

### Admit regex or expression/operator values

Rejected. Host `RegExp` and the mismatched reader/writer operator vocabulary are
known portability blockers. They need a separate grammar and cross-engine
oracle, not a host validation call.

The earlier release-train wording that assigned operator/regex profiles to
R1.5b is withdrawn. R1.5c must either freeze their portable grammar as part of
node parity or keep the affected catalog rows explicitly excluded. **VERIFIED
scope correction**

### Hardcode one resource budget

Rejected. KIR, diagnostics, and runtime values will have different deployment
profiles. The API requires an explicit complete limit object with no defaults.

### Admit exponent decimals

Rejected. Multiple exponent spellings denote the same mathematical value and
would defeat byte-canonical identity without a separately frozen decimal
normalization algebra.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/canonical-value/types.ts` | add | Internal format, limits, value, and typed error contracts |
| `packages/core/src/canonical-value/utf8.ts` | add | Bounded lexical preflight and strict UTF-8 boundary |
| `packages/core/src/canonical-value/validate.ts` | add | Closed portable value validation and resource counters |
| `packages/core/src/canonical-value/canonical.ts` | add | Canonical encode/decode and byte equality |
| `packages/core/tests/canonical-value.test.ts` | add | Hostile UTF-8/value/order/limit/mutation oracle |
| `scripts/check-canonical-value.mjs` | add | Built-source containment and visible R1.5b gate |
| release policy/matrix/package/docs | modify | Promote only the internal canonical-value gate |

No existing reader, writer, parser, runtime, public export, or default path is
modified. Every handwritten source file remains below 500 lines.

## Acceptance Criteria

- [x] Base R1.5a is RED because the canonical-value module and gate are absent.
- [x] Strict UTF-8 rejects overlong, truncated, invalid continuation, surrogate,
      BOM, and malformed JSON bytes before returning a value.
- [x] Missing/partial/unsafe limit objects reject; every configured limit has a
      boundary-pass and boundary-plus-one failure fixture.
- [x] All nine tags round-trip byte-identically; unknown tags/fields and JSON
      numeric payloads reject.
- [x] Integers and decimals never use host numeric conversion and reject leading
      zeros, exponent forms, negative zero, excess digits, and malformed text.
- [x] Record/map duplicates and noncanonical order reject; map scalar key types
      remain distinct and canonical-key byte order is enforced.
- [x] Regex, expression, operator, location, diagnostic, and node-shaped values
      reject or remain outside this format.
- [x] Mutations disabling fatal UTF-8, byte/depth/node/string/collection bounds,
      exact fields, canonical re-encode equality, duplicate detection, or
      unknown-version rejection fail.
- [x] Existing KIR probe/reader/eligibility gates remain unchanged and green;
      `ALPHA-NO-GO` and absent `test:kern-ir` remain true.
- [x] Full `fitness:kern-5`, then Agon review with exactly
      `claude,codex,agy`, pass before commit/push.

## Closure Evidence

- `pnpm fitness:kern-5` passed on the final implementation, including build,
  workspace tests, cross-target conformance, native KERN, browser, app, prior
  KIR, canonical-value, and diff-hygiene gates.
- Final Agon review:
  `review-1783833823166-4vys61-kern-5-r1-5b-canonical-value-fin` with exactly
  `claude,codex,agy`; 3/3 succeeded and zero findings were verified.
- Earlier review findings drove bounded dense-array snapshots, descriptor-only
  plain-data snapshots, allocation-free UTF-8 string measurement, complete AST
  module-edge traversal, exact input precedence, and encode/decode depth parity.
- The remaining review needs-check about `limit-bytes` offset is intentionally
  closed: `maxBytes` is the zero-based offset of the first forbidden byte.

## Out of Scope / Explicit Non-Claims

- KIR v1 node/module schema, writer integration, or KIR reader replacement.
- Regex, expressions, operators, source locations, or diagnostic evidence.
- Runtime trace, handler, scheduler, capability, or completion ABI.
- Public export, package compatibility promise, Alpha acceptance, or runtime
  semantic cutover.

## Deploy and Rollback

R1.5b ships as an internal source module and release oracle. Rollback deletes
the module/gate; the R1.5a inventory, semantic-KIR probe, KERN 4.5 runtime, and
all public package surfaces remain unchanged.
