# KERN 5 M1.1 — F4A Line Eligibility

**Status:** DECIDED — implementation and acceptance review pending
**Date:** 2026-08-21
**Confidence:** 0.97

## Executive summary

**[M1.1-S1 VERIFIED]** F4A currently obtains immutable F1/F2B/F3 evidence,
then classifies each F3 logical line from the original source slice.  Its
property loop silently skips an ordinary token without `=` and its decorator
path accepts a prefix while ignoring malformed suffixes and every argument.
This satellite freezes an F4-owned, KERN-portable eligibility pass so those
lines have a deterministic structural outcome without delegating to the host
parser or changing F3 geometry, the 109-input ABI, or the 17-field `.2`
document receipt.  Evidence: `f4-declarations-semantic.kern:179-304`,
`f4-declarations-main.kern:168-188`, and `worker.mjs:201-246`.

**[M1.1-S2 VERIFIED]** The required outcome is narrow: ordinary bare tokens
and malformed decorator syntax reject with the existing `invalid-property`
fact plus the existing error diagnostic `UNEXPECTED_TOKEN`; valid unknown
properties, valid duplicate properties, and grammar-valid decorators retain
their already-owned contracts.  No fact or diagnostic vocabulary, receipt
field, F3 field, host parser call, or new default slot is introduced.
Evidence: `decoder.mjs:10-18`, `constitution.json:3075-3090`, and parent
contract [F4-C5–C6, C9, C14] in
`kern-5-f4-declarations-modules/spec.md:112-135,159-184`.

## Root cause and boundaries

**[M1.1-R1 VERIFIED]** F1 scans a whitespace-preceded `#` or `//` through the
physical line as trivia; F3 retains the raw scalar `sourceEndScalar` for a
non-comment logical line and passes `Text.slice(source, contentStart, end)`
to F4. Thus F4 sees comment bytes and must apply the frozen eligibility
comment rule itself; it may not alter F1 records, F3 roles, line spans,
decorator runs, parent edges, or raw-block rows. Evidence:
`f1-scan-main.kern:218-226`, `f3-line-tree-main.kern:260-285`, and
`prerequisite-transport.mjs:33-59`.

**[M1.1-R2 VERIFIED]** The legacy parser removes an inline `#` or `//` only
when it is at the start or preceded by space/tab and is outside a quoted
string, `{{…}}`, and `{…}` style body. It trims the removed suffix. That
normalization is source grammar, not a host semantic result: F4 shall express
the same scalar scan in portable KERN. Evidence:
`parser-core.ts:44-98,597-609`.

**[M1.1-R3 VERIFIED]** Native decorator syntax is
`(?:export\s+)?@IDENT(?:\.IDENT)*(?:\(RAW\))?` after that comment
normalization and ECMAScript outer trim, where `IDENT` is ASCII
`[A-Za-z_$][A-Za-z0-9_$]*`; `RAW` is the unconstrained text between the first
opening parenthesis and final closing parenthesis and is stored trimmed.
Trailing non-whitespace text, a malformed identifier path, an unmatched
parenthesis, and an unspaced comment suffix are invalid. The authoritative
grammar evidence is `parser-core.ts:159-176`.

**[M1.1-R5 VERIFIED]** The portable KERN grammar already has an exact
ECMAScript whitespace predicate: U+0009–U+000D, U+0020, U+00A0, U+1680,
U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, and U+FEFF.
`whitespace-trim.kern:19-21` and `style-block-helpers.kern:6-23` encode it
without host operations. F1 deliberately recognizes only ASCII SP/TAB as
trivia (`f1-scan-catalog.kern:31-35`) but transports every well-formed Unicode
scalar, so F4 receives those characters in raw logical-line slices.

**[M1.1-R4 VERIFIED]** The constitution owns `decorator.name` as required and
`decorator.args` as optional `string`, both `included-value`; therefore a
grammar-valid parenthesized argument occurrence is not optional output.
Evidence: `constitution.json:3075-3090`.

## Frozen contract

### Eligibility scan

**[M1.1-C1 DECIDED]** Before declaration/property emission for each F3 logical
line, F4A scans the raw F3 source slice using the comment rule in M1.1-R2 and
the exact ECMAScript whitespace set in M1.1-R5 for outer trim. All reported
offsets are original source-scalar offsets. The effective syntax slice excludes
the stripped comment and its immediately preceding trailing whitespace; it
never changes the F3 line's authenticated start/end fields. The `#`/`//`
comment delimiter remains ASCII SP/TAB-delimited only.

**[M1.1-C2 DECIDED]** An ordinary line is eligible only when every non-space
token consumed by the existing property token scanner has a nonempty name
followed by `=`. A bare token includes `stray`, `=value`, and a token left
after a valid property such as `module name=app stray`. For each such token,
F4A appends one structural fact
`invalid-property` with `propertyName` equal to the raw token and with the
exact token scalar interval, then emits one `UNEXPECTED_TOKEN` error over the
same interval. It continues local scanning, so all independently malformed
tokens are reported. Any such fact makes the ordinary result `rejected`.

**[M1.1-C3 DECIDED]** Required-property omission remains a constitution
property check in frozen authority order. For each absent required row F4A
emits the existing `missing-property` fact using the existing owner logical
line span. It additionally emits exactly one `UNEXPECTED_TOKEN` error for
each owner line having one or more required omissions, at that complete owner
line span. It does not invent a `MISSING_PROPERTY` diagnostic code or an
ordinary property occurrence for absence.

**[M1.1-C4 DECIDED]** A syntactically valid `name=value` whose
`kind.propertyName` has no constitution row remains exactly the existing
`unknown-property` fact and rejection outcome. It emits no new eligibility
diagnostic. A valid repeated property retains last-write-wins effective value,
one occurrence per source property, and the later-property `DUPLICATE_PROP`
warning; a bare token is never a duplicate occurrence.

### Decorator grammar and output

**[M1.1-C5 DECIDED]** F4A applies M1.1-R2/R3 to a line whose first admitted
form is `@` or `export` followed by one or more M1.1-R5 whitespace scalars and
`@`. It accepts
`export @trace.$x`, whitespace around the complete form, a comment stripped
under M1.1-R2, and optional raw parenthesized args. It must not call,
transport, compare against, or otherwise delegate classification to
`parseDocument`, `parseLines`, or a parser-shadow authority.

**[M1.1-C6 DECIDED]** A malformed decorator candidate produces one
`invalid-property` fact and one `UNEXPECTED_TOKEN` error, both over the
effective decorator syntax slice from M1.1-C1. It produces no `decorator`
declaration, property occurrence/presence/effective value, decorator row,
attachment, explicit-export effect, symbol export effect, or
`DROPPED_DECORATOR` warning. Its rejection is ordinary, never fatal.

**[M1.1-C7 DECIDED]** A grammar-valid decorator produces a `decorator.name`
occurrence/effective value exactly as today. When parentheses are present it
also produces exactly one `decorator.args` occurrence and effective value:
representation `bare`, raw/effective value equal to the native trimmed `RAW`,
and scalar value interval after trimming inside the parentheses (including a
zero-width interval for `@x()`). No parentheses means no `args` occurrence or
presence row. This follows the optional constitution row rather than a
default-value rule.

**[M1.1-C8 DECIDED]** Only a grammar-valid decorator then enters [F4-C9]. A
valid decorator with a non-`fn`, wrong-indent, orphan, or F3-dropped target
receives its existing decorator row with disposition `dropped`, one
`DROPPED_DECORATOR` **warning**, and no attachment/export effect. It remains
`classified` when no independent fact exists. A malformed candidate never
reaches this rule. F3's current `@`-only role remains immutable; `export @…`
is recognized by this F4 syntactic gate and uses the same immediate-successor
and indent proof, not a fabricated F3 run.

### Receipt, precedence, and portability

**[M1.1-C9 DECIDED]** The private root remains arity 109 with states ordered
`f1`, `f2b`, `f3`, legal vectors `AAA`, `FNN`, `AFN`, `AAF`, and the three F4
source/record/logical-line caps. The one public request invokes F4A exactly
once. This amendment adds no input or policy **format** version. Its changed
KERN composition must update the F4 composition pins and the complete policy
bytes/SHA/cache identity atomically; an old composition hash paired with new
policy bytes, or the converse, fails before ordinary receipt acceptance.
Evidence: `policy.json:2-13,72-84`, `worker.mjs:30-80,201-246`, and
`policy-validation.mjs:112-130`.

**[M1.1-C10 DECIDED]** The returned document remains exactly 17 strings in
`kern.frontend.f4-document.2` order: format, status, module ID, source
scalars, declarations, occurrences, presence, attachments, decorators,
symbols, bindings, diagnostics, facts, detached ordinals, expression evidence,
work steps, terminal seal. A rejection has facts and empty symbols/bindings;
fatal remains atomic. Evidence: `decoder.mjs:283-350` and
`f4-declarations-helpers.kern:351-380`.

**[M1.1-C11 DECIDED]** C14 remains unchanged: diagnostic producers are merged
in strictly increasing `(startScalar, phaseRank, ruleRank)` order without
deduplication. New M1.1 `UNEXPECTED_TOKEN` rows are property phase/rule rank
`(0,1)`; `DUPLICATE_PROP` remains `(0,0)` and `DROPPED_DECORATOR` `(2,0)`.
Equal/decreasing keys are `F4_AUTHORITY_DRIFT`, not host sorting or repair.

**[M1.1-C12 DECIDED]** Streaming applies only to the eligibility scan: it
charges one checked work step per source scalar inspected plus one per emitted
fact, diagnostic, occurrence, or effective update. The existing bounded
post-scan presence check remains responsible for required-property absence and
owner-line diagnostics before C14 merges all phase tapes. Both paths use the
existing `maxWorkSteps` fatal limit. The implementation may extract a
KERN helper to retain the under-500-line source rule, but may not perform an
unbounded host regex/parser pass or alter F1/F3 replay work.

**[M1.1-C13-LOCAL DECIDED]** C13-LOCAL owns every fact constructed directly by
F4A semantic/presence execution: bare token, malformed decorator, missing
property, unknown node, unknown property, property-admission rejection, invalid
child, and invalid module root. Before retention, each exact six-field row must
pass one KERN-owned prospective admission operation: exact `i<len>:` framing,
field-local UTF-8 facts-tape bytes, count, and admission work are checked against
`maxFacts`, `maxEncodedBytes`, and `maxWorkSteps`. A crossing is atomic
`F4_LIMIT`; an invalid constructed row is `F4_AUTHORITY_DRIFT`. Before the fact
fold, the root first checks `factCount > maxFacts`, then checks
`factBytes > maxEncodedBytes` only if the count passed; either failure is
`F4_LIMIT`, so no over-cap facts tape can be copied. Fact and diagnostic ledgers are
independent: C14 continues to count complete framed diagnostic rows separately.
No total document/envelope byte rule is introduced. Root arity remains 109,
document remains `.2`, and policy remains `.4`. See the dedicated C13-LOCAL
satellite at `.Codex/specs/kern-5-f4-m1-1-c13-closure/spec.md`.

**[M1.1-C13-GLOBAL DECIDED | OPEN M3 WORK]** Expression and path facts are
imported framed tapes (`expressionResult[3]` and `pathBindings[2]`), not
constructed-here C13-LOCAL rows. M3 must consume each with an advancing cursor,
validate frame and six-field row before retention or limit debit, then charge
framed count, field-local UTF-8 bytes, and work. Malformed expression transport
wins as `F4_F2B_DRIFT`; malformed path/internal provenance wins as
`F4_AUTHORITY_DRIFT`; only a valid next candidate crossing a cap is `F4_LIMIT`.
This preserves F4-R4 drift precedence and forbids re-scan/growing-prefix
accumulation. Evidence: `examples/kern-frontend/f4-declarations-semantic-tail.kernpart:1-18,72-91`
and parent F4-R1/R2 at `kern-5-f4-declarations-modules/spec.md:343-352`.

**[M1.1-C13 IMPLEMENTATION / ACCEPTANCE PARTIAL]** Current implementation and
focused acceptance cover bare-token, malformed-decorator, required-missing,
their eligibility diagnostics, and E18 property-phase cap precedence. C13-LOCAL
is the current unimplemented M1.1 closure slice; C13-GLOBAL remains named M3
work. Neither status claims that the eight local branches or imported expression/
path tapes have current end-to-end admission proof.

## Implementation options

| Option | Decision | Reason |
|---|---|---|
| A — KERN streaming lexical helper called by F4 semantic loop | **Selected** | Reuses authenticated raw slices, preserves 109/.2 and C2, and has scalar-linear bounded work. |
| B — change F3 to parse decorators/properties semantically | Rejected | Violates the frozen F3 geometry boundary and broadens F3 responsibility. |
| C — call the native TypeScript parser from F4 worker | Rejected | Violates C2 and would make host parser behavior authoritative. |

## Blast radius and implementation order

**[M1.1-B1 VERIFIED]** Consumers are the F4 KERN composition, worker transport
and decoder, the F4 policy's composition hashes, and F4 document tests; F1,
F2B, F3 receipt schemas and F4B are consumers that must remain byte/ABI
compatible. Evidence: `worker.mjs:201-271`, `policy.json:72-84`, and
`decoder.mjs:283-351`.

1. Add the KERN-private eligibility/comment/decorator helper(s), extracting
   only enough to keep handwritten files below 500 lines.
2. Wire fact/diagnostic/occurrence/effective outputs through the existing
   semantic loop and C14 phase tape; update exact composition hashes.
3. Add the hand-pinned tests below, then run focused F4 document/decoder gates
   before the applicable F4 suite.

## Binary acceptance matrix

| ID | Frozen fixture/assertion | Pass condition |
|---|---|---|
| E1 | `module name=app stray` | rejected; one `invalid-property` fact and one error `UNEXPECTED_TOKEN`, each `[16,21)`; no symbol/binding. |
| E2 | `module name=app stray other` | rejected; exactly two independently ordered fact/diagnostic pairs at the two token spans. |
| E3 | `fn export=true` with required `name` absent | rejected; `missing-property` fact in authority order and exactly one error `UNEXPECTED_TOKEN` over `[0,14)`. |
| E4 | `module name=app\n  app name=a\n    view` | exactly three `view` missing-property facts in authority order (`name`, `path`, `source`) and one owner-line `UNEXPECTED_TOKEN`; no invented diagnostic code. |
| E5 | `module name=app unknown=x` | rejected with existing `unknown-property` fact and no eligibility diagnostic. |
| E6 | `fn name=a name=b` | classified; two name occurrences, effective `b`, one later-span warning `DUPLICATE_PROP`, no fact. |
| E7 | `@trace.$x($arg, nested(call)) // note\nfn name=main` | classified; attached decorator; name plus args occurrence/effective values; args raw value `$arg, nested(call)`; comment has no output. |
| E8 | `export @trace\nfn name=main` | classified; attached row has explicit export true and function symbol exported true. |
| E9 | `@trace tail\nfn name=main` | rejected; one effective-slice `invalid-property` fact + error `UNEXPECTED_TOKEN`; no decorator declaration/row/attachment/export and no dropped warning. |
| E10 | `@bad..name\nfn name=main` and `@trace(foo\nfn name=main` | each has E9's atomic malformed-decorator semantic absence. |
| E11 | `@trace // note\nmodule name=app` | classified; exactly one dropped decorator warning and row; no fact. |
| E12 | two diagnostics sharing a start from controlled producer mutation | F4 fatal `F4_AUTHORITY_DRIFT`; no ordinary receipt fields. |
| E13 | F1/F2B/F3 failed-state vectors | existing precedence and exactly one F4A invocation stay unchanged; no new eligibility receipt escapes. |
| E14 | matching M1.1 helper/semantic pins and loader source guard | both current source SHA-256 values equal policy descriptors, and `loadComposition` verifies each composition descriptor before runtime execution; the focused suite does not install a mutable production-loader seam merely to forge skew. |
| E15 | `export\u00a0@trace`, `\ufeff@trace\u3000`, and `@trace(\u2009arg\u2009)` | all classify as valid decorators; export/outer/args use M1.1-R5 trim semantics while `@trace\u00a0// note` remains malformed because comment delimiters are ASCII-only. |
| E16 | `@trace()` | classified with exactly one zero-width `decorator.args` occurrence/effective value. |
| E17 | tested low `maxFacts`, `maxDiagnostics`, and `maxEncodedBytes` profile overrides | the E17 cases in `scripts/kern-frontend-f4-declarations/line-eligibility.test.mjs` return atomic `F4_LIMIT`. They prove the current bounded-leaf/fold paths, not universal C13 admission for every pre-existing fact family. Source inspection requires one generic Map-owned `f4balancedtapefold`, prospective bounded leaf admission, and rejects growing-prefix retention in eligibility and diagnostic merge paths. |
| E18 | `module name=app\n  page name=Home name=Dash name=Third route="/home"\n` (two `DUPLICATE_PROP` warnings followed by the `route` occurrence) | baseline and the exact two-warning count/byte ceilings classify; `maxDiagnostics=1` and `maxEncodedBytes=64` each return atomic `F4_LIMIT`, never `F4_AUTHORITY_DRIFT`. This closes the adjacent inherited property-phase cursor-before-status ordering under M1.1 cap acceptance. |

## Out of scope

- New parser diagnostics, facts, declaration IDs, status fields, severity
  categories, default-value semantics, or a document `.3` format.
- F3 role/run schema changes, parent-edge rewriting, stack flushing, target
  poisoning, or binary parser eligibility flags.
- F4B graph/link behavior and F5/KIR projection.

## Corrections log

**[M1.1-X1 VERIFIED]** Tribunal `1787308807268-ryjqnh` was degraded
(`ok:false`; Codex missing in both rounds; four of six responses). Its useful
silent-ignore finding was independently verified, but this specification does
not promote degraded votes to contract authority.

**[M1.1-X2 DECIDED]** Rejected tribunal inventions: `MISSING_PROPERTY`,
`DUPLICATE_PROPERTY`, `UNKNOWN_PROPERTY`, `malformed-decorator`, and
`duplicate-property` vocabulary; error-severity `DROPPED_DECORATOR`; an
unknown-property auxiliary bag; byte offsets; fact-before-diagnostic ordering
or deduplication; alphabetical required-field order; a strict literal-only
decorator-argument grammar; parser delegation; stack flushing/target poisoning;
new declaration ID/status/F3 fields; and a TypeScript/Python eligibility layer.
They contradict the closed decoder vocabulary, C5/C9/C14, constitution, or
current F3/F4 architecture cited above.

**[M1.1-X3 DECIDED]** This satellite resolves C6's former ambiguity by keeping
required omission facts in authority order while adding the one owner-line
`UNEXPECTED_TOKEN` diagnostic, and resolves malformed decorators as the
existing `invalid-property` fact plus existing `UNEXPECTED_TOKEN` error. It
does not reinterpret a grammar-valid bad target as malformed.

**[M1.1-X4 VERIFIED]** Nero run `nero-1787309599325-eresmh` correctly found
the policy-identity clarification incorporated in M1.1-C9. Its other
challenges are source-refuted: C14 merges buffered phase tapes after the
existing bounded presence check rather than flushing an owner line; `.2` is a
current candidate format whose composition/policy identity prevents silent
mixed-byte acceptance; malformed syntax is decided before target disposition
because `RAW` is unconstrained text; `invalid-property` is a fact while
`UNEXPECTED_TOKEN` is the sole new diagnostic; and native inline comments are
only whitespace-delimited `#`/`//`, not `/*…*/`, outside the scanner states in
M1.1-R2. Evidence: `parser-core.ts:44-98,159-176`,
`f4-declarations-semantic.kern:305-330,445-452`, and
`decoder.mjs:198-216,283-350`.

**[M1.1-X5 VERIFIED]** The prior satellite incorrectly described native
`export` separation and `RAW.trim()` as horizontal ASCII whitespace. The parser
uses `\s+` and `trim()` (`parser-core.ts:159-175`); M1.1-R5/C1/C5 now preserve
that legacy behavior while keeping the separate ASCII SP/TAB comment-boundary
rule from `parser-core.ts:93-98`.

**[M1.1-X6 DECIDED]** The prior E14 receipt-skew oracle implied a mutable
production loader seam that does not exist and must not be added for tests.
E14 now verifies the existing descriptor-before-runtime guard and exact pins;
the eligibility resource oracle is E17.
