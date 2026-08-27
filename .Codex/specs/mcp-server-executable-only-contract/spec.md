# MCP server executable-only package contract

**Status:** IMPLEMENTED AND VERIFIED
**Date:** 2026-08-27
**Initial confidence:** 0.97
**Revised confidence:** 0.99

## Executive Summary

`@kernlang/mcp-server` is an executable stdio server, not an import-safe library. Its current root export points at the executable entry, so the RT-1 package-owner scan imports it and retains the test process through its stdio listener. Make the package’s executable-only boundary explicit with an empty export map while preserving `bin.kern-mcp`, and add a focused metadata regression.

## Current State / Root Cause

- **VERIFIED:** The RT-1 owner oracle recursively visits package manifests, maps every `exports` target with a `dist`/`src` pair, and dynamically imports each pair before checking runtime-owner markers. Evidence: `scripts/kern-5-r1-runtime-owner/owner-oracle.test.mjs:109-132`.
- **VERIFIED:** `@kernlang/mcp-server` advertises `exports["."].default = "./dist/index.js"` and `bin.kern-mcp = "./dist/index.js"`. Evidence: `packages/mcp-server/package.json:8-16`.
- **VERIFIED:** The imported entry invokes `main()` at module evaluation, calls `server.connect(new StdioServerTransport())`, and does not close it. Evidence: `packages/mcp-server/src/index.ts:1401-1410`; SDK transport registers stdin listeners in `node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js:26-33`.
- **VERIFIED:** The release policy already excludes this package from import smoke and requires an executable surface for such exclusions. Evidence: `scripts/release/release-policy.json:66-68`; `scripts/release/offline-consumer.mjs:151-158`.

## What Already Works

- `bin.kern-mcp` starts `dist/index.js`; MCP integration tests spawn that path directly. Evidence: `packages/mcp-server/package.json:8-10`; `packages/mcp-server/tests/server.integration.test.ts:8-17`.
- README consumers use `npx @kernlang/mcp-server` / MCP command configuration, not an ESM import. Evidence: `README.md:250-269`; `packages/mcp-server/README.md:1-65`.
- No non-documentation production consumer imports `@kernlang/mcp-server`. Evidence: `rg -n "@kernlang/mcp-server" --glob '!node_modules/**' --glob '!README.md' --glob '!packages/mcp-server/**' .`, run 2026-08-27, returned only release-policy references.

## Contract (Verified)

> Verified against the listed source on 2026-08-27.

| Field / behavior | Contract | Evidence | Tag |
|---|---|---|---|
| `bin.kern-mcp` | CLI entry remains `./dist/index.js` | `packages/mcp-server/package.json:8-10` | VERIFIED |
| package root import | Not a supported public entry point | `scripts/release/release-policy.json:66-68`; `packages/mcp-server/src/index.ts:1401-1410` | VERIFIED |
| `exports` | Contains no JavaScript target | `packages/mcp-server/package.json:8-11`; `scripts/kern-5-r1-runtime-owner/owner-oracle.test.mjs:163-169` | VERIFIED |
| RT-1 discovery | May import every declared JavaScript package export | `scripts/kern-5-r1-runtime-owner/owner-oracle.test.mjs:104-132` | VERIFIED |

## Implementation Plan

1. Add a focused owner-oracle metadata test asserting that the MCP package keeps `bin.kern-mcp` but has no JavaScript export target.
2. Confirm the test is RED against the current root export.
3. Replace the MCP package export map with `{}`; keep the bin target unchanged.
4. Run the focused test, the complete R1 owner gate, MCP build/tests, release-policy tests, and scoped formatting checks.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/mcp-server/package.json` | Modify | Stop advertising an importable executable root while retaining its CLI bin. |
| `scripts/kern-5-r1-runtime-owner/owner-oracle.test.mjs` | Modify | Make the executable-only package contract a quick, discriminating regression. |

## Acceptance Criteria

- [x] Base RED captured: `node --test --test-name-pattern='MCP server remains executable-only' scripts/kern-5-r1-runtime-owner/owner-oracle.test.mjs` reported `{ subpath: '.', target: './dist/index.js' }` instead of `[]`.
- [x] Fixed contract: the same focused command passed with `bin.kern-mcp = ./dist/index.js` and no JavaScript export target.
- [x] `pnpm test:kern-5-r1-runtime-owner` exited 0; its owner test passed in 2.46 seconds and no retained R1 test process remained.
- [x] `pnpm --filter @kernlang/mcp-server build` and the rerun `pnpm --filter @kernlang/mcp-server test` passed; `pnpm test:release-policy` passed 168/168.
- [x] No canonicalizer transition WIP was changed by this implementation; it remained unstaged and was preserved throughout.

## Out of Scope

- Refactoring the MCP server into an importable library.
- Changing the CLI behavior, bin name, release import-smoke policy, RT-1 discovery algorithm, or any package version.

## Deploy Order

Publish the package manifest with the existing executable. Existing `npx` and configured `kern-mcp` consumers continue resolving the declared bin; unsupported root imports become explicitly rejected in the new package version. No compatible import skew is required because no live source consumer exists.

## Corrections Log

| Original claim | Reality | Impact |
|---|---|---|
| The dynamic import itself awaited forever. | `void main()` permits module evaluation to complete, but `StdioServerTransport.start()` attaches stdin listeners that retain the Node test process. | Fix the false importable contract instead of adding an import timeout. |
| Empty and absent `exports` are equivalent for an executable-only package. | Without `exports`, package-root resolution falls back to `main`, reopening the executable import; explicit `exports: {}` rejects the root import while preserving `bin`. | Keep the explicit empty export map. |
