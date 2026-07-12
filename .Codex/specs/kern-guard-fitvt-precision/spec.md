# KERN Guard FitVT Precision

**Status:** COMPLETE
**Date:** 2026-07-12
**Confidence:** 0.98

## Executive Summary

FitVT PR 27 exposed false positives in KERN Guard's built-in Python fallback,
FastAPI response-contract rule, duplicate-route analysis, and dotenv secret
heuristic. The fix belongs in KERN because the incorrect classifications come
from reusable detector limitations rather than FitVT behavior. This change adds
FitVT-derived regression fixtures, enriches additive route concept metadata,
and preserves true-positive behavior.

## Current State / Root Cause

- **VERIFIED:** The fallback scans raw physical lines for route decorators, so
  decorators inside triple-quoted strings are emitted as live routes
  (`packages/review/src/python-fallback/index.ts:39-45,94-105`).
- **VERIFIED:** The fallback collects the full decorator only for status codes;
  route paths and `response_model` are parsed from the first physical line
  (`packages/review/src/python-fallback/index.ts:94-105`).
- **VERIFIED:** The fallback emits route concepts but no FastAPI
  `include_router` mount concepts, so duplicate-route comparisons lose effective
  prefixes (`packages/review/src/python-fallback/index.ts:94-140`; `rg -n
  "include_router" packages/review/src/python-fallback` returned no hits on
  2026-07-12).
- **VERIFIED:** The tree-sitter mapper reads decorator `response_model` but does
  not surface handler return annotations, `response_class`, or
  `include_in_schema` (`packages/review-python/src/mapper/extractors/entrypoint.ts:44-105`).
- **VERIFIED:** `missing-response-model` fires solely on absent
  `payload.responseModel`, including non-JSON and schema-excluded routes
  (`packages/review/src/concept-rules/missing-response-model.ts:14-34`).
- **VERIFIED:** Placeholder-file recognition only accepts exact names such as
  `.env.example`, not `.env.prod.example`; placeholder values do not accept the
  `CHANGE_ME_*` convention (`packages/review/src/config-files/env.ts:60-68,141-147`).
- **VERIFIED:** The secret-key heuristic flags numeric policy keys containing
  words such as `TOKEN` or `PASSWORD` (`packages/review/src/config-files/env.ts:52-54,227-244`).

## What Already Works

- Tree-sitter route extraction already ignores docstring text structurally and
  supports multiline decorator source spans.
- Graph-wide route collection already joins emitted route-mount concepts with
  route files (`packages/review/src/concept-rules/cross-stack-utils.ts:143-180`).
- `ignored-error` already distinguishes narrow non-builtin exceptions and
  documented no-op catches in both Python extractors. This change will not
  weaken that rule.
- `boundary-mutation` is intentionally advisory and remains unchanged.

## Contract (Verified)

> Verified against `packages/core/src/concepts.ts`, both Python route mappers,
> and `packages/review/src/concept-rules/missing-response-model.ts` on 2026-07-12.

| Field / Behavior | Type | Evidence | Tag |
|---|---|---|---|
| `responseModel` | `string | undefined` | `packages/core/src/concepts.ts:48-53` | VERIFIED |
| `responseClass` | additive `string | undefined` | Both Python mappers can extract decorator or return-type evidence | VERIFIED |
| `includeInSchema` | additive `boolean | undefined` | FastAPI decorator keyword; `false` excludes OpenAPI contract | VERIFIED |
| Effective route path | mount prefix plus declared path | `packages/review/src/concept-rules/cross-stack-utils.ts:143-180` | VERIFIED |

## Implementation Plan

1. Add failing regression tests for docstrings, multiline decorators, router
   mounts, inferred return annotations, raw response classes, schema exclusion,
   dotenv filename variants, placeholders, and numeric policy settings.
2. Add a small Python fallback lexical mask so string contents are not treated
   as executable lines, then parse full decorators and `include_router` mounts.
3. Add optional `responseClass` and `includeInSchema` route metadata and populate
   it in both Python mappers. Infer `responseModel` from handler return
   annotations unless `response_model=None` explicitly disables inference.
4. Make `missing-response-model` skip proven non-JSON or schema-excluded routes
   and test-only files while preserving warnings for unmodeled JSON routes.
5. Refine dotenv placeholder-file/value recognition and suppress numeric policy
   metadata without suppressing numeric values assigned directly to credential
   keys.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/concepts.ts` | Modify | Add optional route evidence fields |
| `packages/review/src/python-fallback/**` | Modify/add | Correct fallback lexical and route extraction |
| `packages/review-python/src/mapper/extractors/entrypoint.ts` | Modify | Emit equivalent route evidence from tree-sitter |
| `packages/review/src/concept-rules/missing-response-model.ts` | Modify | Consume proven route evidence |
| `packages/review/src/config-files/env.ts` | Modify | Correct example and policy heuristics |
| `packages/review*/tests/**` | Modify/add | FitVT-derived regressions and true-positive guards |

## Acceptance Criteria

- [x] Fallback extraction emits no routes from Python strings or docstrings.
- [x] Fallback extraction reads multiline route path and response model.
- [x] Fallback extraction emits route mounts that produce distinct effective
      paths for FitVT-style routers.
- [x] Both extractors recognize FastAPI-inferred return models.
- [x] `missing-response-model` remains silent for non-JSON response classes,
      `include_in_schema=False`, and test-only routes.
- [x] `missing-response-model` still fires for production JSON routes with no
      explicit or inferred model.
- [x] `.env.prod.example`, `CHANGE_ME_*`, and numeric policy metadata do not
      produce `env/possible-secret` findings.
- [x] Direct numeric credentials such as `PASSWORD=123456` still produce a
      finding.
- [x] Package tests, build/type checks, repository gate, and Agon review pass.

## Verification Evidence

- **VERIFIED:** FitVT live scan resolved 400 Python files and emitted zero
  `duplicate-route` findings.
- **VERIFIED:** FitVT `.env.prod.example` emitted zero findings.
- **VERIFIED:** The only FitVT `missing-response-model` result is the unresolved
  runtime JSON route `/health/email-stats` in `app/api/health.py`; it remains
  intentionally conservative rather than being suppressed as an example.
- **VERIFIED:** Regressions cover relative imports, keyword argument order,
  nested keyword expressions, mount-level schema exclusion, response classes,
  inferred return types, docstrings, and Windows-style paths.

## Out of Scope

- Weakening or suppressing `boundary-mutation` globally.
- Blanket suppression of `ignored-error` for builtin exceptions.
- Reclassifying arbitrary `JSONResponse` routes as modeled.
- Changing FastAPI application behavior or FitVT source.

## Deploy Order

The optional concept fields, both producers, and their consuming rule ship in
one KERN monorepo release. Additive fields are ignored by older consumers; old
producers leave them undefined, which preserves the existing conservative rule
behavior during version skew.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| All duplicate-route false positives came from missing prefix expansion | The graph collector already expands prefixes when mount concepts exist; the fallback fails to emit those concepts | Limit the fix to fallback production and lexical precision |
| Unmounted routers could be suppressed in graph mode | Runtime routers may be registered indirectly and still require a response contract | Suppress only files proven to be tests or examples; retain unresolved runtime warnings |
| The first `include_router` argument identifies the router | FastAPI accepts `router=` after other keywords, whose values can contain nested `router=` or `prefix=` text | Parse only top-level call arguments in both Python extractors |
