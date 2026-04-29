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
kern test path/to/tests --grep Order
kern test path/to/tests --bail
kern test path/to/tests --format compact
kern test path/to/tests --max-warnings 4
kern test path/to/tests --write-baseline kern-test-baseline.json
kern test path/to/tests --baseline kern-test-baseline.json
kern test --list-rules
kern test --explain-rule no:unguardedEffects
kern test path/to/tests --pass-with-no-tests
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

  it name="suite covers target surface"
    expect preset=coverage
```

Presets expand into granular checks:

- `machine`: `deadStates`, `duplicateTransitions`
- `guard`: `invalidGuards`, `weakGuards`
- `coverage`: `untestedTransitions`, `untestedGuards`
- `apiSafety`: `duplicateRoutes`, `unvalidatedRoutes`, `unguardedEffects`, `uncheckedRoutePathParams`
- `mcpSafety`: `duplicateParams`, `invalidGuards`, `unguardedToolParams`, `missingPathGuards`, `ssrfRisks`
- `effects`: `unguardedEffects`, `sensitiveEffectsRequireAuth`, `effectWithoutCleanup`, `unrecoveredAsync`
- `strict`: broad structural safety sweep

Use `no=codegenErrors` as a smoke check when a suite should prove that valid KERN still reaches core code generation. It catches generator exceptions that parse/schema/semantic validation can miss.

Use `preset=coverage` when Guard/Sight need a native signal for untested KERN surface. Machine transition coverage is driven by explicit `via=...` reachability assertions. Guard coverage passes when guards have explicit `expect guard=<name> exhaustive=true` assertions or a guard-wide assertion such as `expect preset=guard`.

Use `severity=warn` for known migration debt that should stay visible without failing local runs. CI can promote warnings to failures with `kern test <file-or-dir> --fail-on-warn`.

Use `--grep <pattern>` to run only matching suites, cases, assertions, rule IDs, messages, or files. The CLI exits nonzero when a grep run matches zero assertions. Use `--bail` to stop after the first failed native assertion.

Use `--format compact` (or `--compact`) in CI when you only want the aggregate line plus warning/failure details. JSON output is unchanged by format flags.

Use `--max-warnings <n>` to enforce a warning budget during adoption. `--fail-on-warn` is equivalent to a zero-warning budget.

Use `--write-baseline <file>` to snapshot current warning debt, then `--baseline <file>` in CI to fail when warnings are added or removed. Baseline entries key on suite, case, rule ID, assertion, and message, not line number, so moving tests does not churn the file.

Use `--pass-with-no-tests` when wiring native tests into a repo before every package has `.test.kern` coverage. Without it, an empty native test run fails so missing tests stay visible.

Text and JSON results include stable `ruleId` values such as `machine:reaches`, `guard:exhaustive`, and `no:deadstates`. Guard and Sight should key off those IDs instead of display messages.

Use `--list-rules` and `--explain-rule <rule>` to inspect the native rule IDs that appear in text, JSON, and baselines.

## Library API

```ts
import {
  discoverNativeKernTestFiles,
  formatNativeKernTestRunSummary,
  runNativeKernTestRun,
  runNativeKernTests,
} from '@kernlang/test';

const fileSummary = runNativeKernTests('order.test.kern', { grep: 'Order', bail: true });
const runSummary = runNativeKernTestRun('examples/native-test', { grep: /coverage|guard/i });
console.log(formatNativeKernTestRunSummary(runSummary));
```

Runtime `expect expr={{...}}` assertions are intentionally not executed here yet. This package currently owns structural KERN assertions; generated/runtime test execution remains separate.
