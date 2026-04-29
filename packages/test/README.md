# @kernlang/test

Native KERN structural test runner.

Use it for KERN-level invariants that should be checked before generated code exists:

- machine reachability and transition hygiene
- derive graph cycles
- guard exhaustiveness and guard configuration
- API/MCP route and parameter safety
- unguarded effects and async recovery debt

## CLI

```sh
kern test path/to/order.test.kern
kern test path/to/tests
kern test path/to/tests --json
kern test path/to/tests --fail-on-warn
```

Single-file inputs keep the legacy `kern test <file.kern>` generator behavior when the file has no native `test` nodes. Directory inputs discover `.kern` files that contain native `test` nodes and run them as one aggregate suite. This repo's `examples/native-test` directory includes machine, MCP safety, and language-surface smoke tests for arrays, classes, and functions.

## KERN Syntax

```kern
test name="Order invariants" target="./order.kern"
  it name="reaches paid"
    expect machine=Order reaches=paid via=confirm,capture

  it name="machine stays healthy"
    expect preset=machine

  it name="known migration debt stays visible"
    expect no=deadStates severity=warn

  it name="target still reaches core codegen"
    expect no=codegenErrors
```

Presets expand into granular checks:

- `machine`: `deadStates`, `duplicateTransitions`
- `guard`: `invalidGuards`, `weakGuards`
- `apiSafety`: `duplicateRoutes`, `unvalidatedRoutes`, `unguardedEffects`, `uncheckedRoutePathParams`
- `mcpSafety`: `duplicateParams`, `invalidGuards`, `unguardedToolParams`, `missingPathGuards`, `ssrfRisks`
- `effects`: `unguardedEffects`, `sensitiveEffectsRequireAuth`, `effectWithoutCleanup`, `unrecoveredAsync`
- `strict`: broad structural safety sweep

Use `no=codegenErrors` as a smoke check when a suite should prove that valid KERN still reaches core code generation. It catches generator exceptions that parse/schema/semantic validation can miss.

Use `severity=warn` for known migration debt that should stay visible without failing local runs. CI can promote warnings to failures with `kern test <file-or-dir> --fail-on-warn`.

Text and JSON results include stable `ruleId` values such as `machine:reaches`, `guard:exhaustive`, and `no:deadstates`. Guard and Sight should key off those IDs instead of display messages.

## Library API

```ts
import {
  discoverNativeKernTestFiles,
  formatNativeKernTestRunSummary,
  runNativeKernTestRun,
  runNativeKernTests,
} from '@kernlang/test';

const fileSummary = runNativeKernTests('order.test.kern');
const runSummary = runNativeKernTestRun('examples/native-test');
console.log(formatNativeKernTestRunSummary(runSummary));
```

Runtime `expect expr={{...}}` assertions are intentionally not executed here yet. This package currently owns structural KERN assertions; generated/runtime test execution remains separate.
