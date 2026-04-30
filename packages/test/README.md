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
kern-test path/to/order.test.kern
kern-test path/to/tests --json
kern test path/to/order.test.kern
kern test path/to/tests
kern test path/to/tests --json
kern test path/to/tests --grep Order
kern test path/to/tests --bail
kern test path/to/tests --watch
kern test path/to/tests --format compact
kern test path/to/tests --coverage
kern test path/to/tests --min-coverage 80
kern test path/to/tests --max-warnings 4
kern test path/to/tests --write-baseline kern-test-baseline.json
kern test path/to/tests --baseline kern-test-baseline.json
kern test --list-rules
kern test --explain-rule no:unguardedEffects
kern test path/to/tests --pass-with-no-tests
kern test path/to/tests --fail-on-warn
```

`kern-test` is the standalone binary shipped by `@kernlang/test`. `kern test` is the integrated command from `@kernlang/cli`; it supports the same native runner flags plus `--watch` and the legacy MCP Jest generator fallback. Single-file `kern test <file.kern>` inputs keep that legacy generator behavior when the file has no native `test` nodes. Directory inputs discover `.kern` files that contain native `test` nodes and run them as one aggregate suite. This repo's `examples/native-test` directory includes machine, MCP safety, permission-gated tool, runtime-function, language-surface, array conformance, class/function conformance, collection/destructure conformance, advanced data conformance, control-flow conformance, effect recovery conformance, and route workflow conformance tests.

## KERN Syntax

```kern
test name="Order invariants" target="./order.kern"
  it name="reaches paid"
    expect machine=Order reaches=paid via=confirm,capture
    expect machine=Order from=confirmed reaches=paid via=capture maxSteps=1
    expect machine=Order transition=capture from=confirmed to=paid guarded=true

  it name="machine stays healthy"
    expect preset=machine

  it name="known migration debt stays visible"
    expect no=deadStates severity=warn

  it name="target still reaches core codegen"
    expect no=codegenErrors

  it name="KERN declaration shape stays stable"
    expect node=interface name=Order child=field count=3
    expect node=field name=status within=Order prop=type is=OrderState

  it name="computed constants stay sane"
    expect expr={{MAX_RETRIES > 0 && statuses.includes("paid")}}
    expect expr={{MAX_RETRIES}} equals=3
    expect expr={{status}} matches="^paid$"
    expect expr={{JSON.parse("not-json")}} throws=SyntaxError

  it name="order behavior is stable"
    fixture name=paidOrder value={{({ items: [{ price: 20, qty: 2 }, { price: 5, qty: 1 }] })}}
    fixture name=taxRate value=0.2
    expect fn=orderSubtotal with=paidOrder equals=45
    expect fn=addTax args={{[orderSubtotal(paidOrder), taxRate]}} equals=54
    expect derive=total equals=54

  it name="route workflow is stable"
    expect route="GET /api/users" with={{({ query: { role: "admin" } })}} returns={{adminUsers}}
    expect route="GET /api/users/:id" with={{({ params: { id: "missing" } })}} returns={{({ status: 404 })}}

  it name="effect recovery is stable"
    expect effect=fetchUsers returns={{users}}
    expect effect=loadFallback recovers=true fallback={{[]}}

  it name="suite covers target surface"
    expect preset=coverage
```

Presets expand into granular checks:

- `machine`: `deadStates`, `duplicateTransitions`
- `guard`: `invalidGuards`, `weakGuards`, `nonExhaustiveGuards`
- `coverage`: `untestedTransitions`, `untestedGuards`
- `apiSafety`: `duplicateRoutes`, `emptyRoutes`, `unvalidatedRoutes`, `unguardedEffects`, `uncheckedRoutePathParams`
- `mcpSafety`: `duplicateParams`, `invalidGuards`, `unguardedToolParams`, `missingPathGuards`, `ssrfRisks`
- `effects`: `unguardedEffects`, `sensitiveEffectsRequireAuth`, `effectWithoutCleanup`, `unrecoveredAsync`
- `strict`: broad structural safety sweep

Use `no=codegenErrors` as a smoke check when a suite should prove that valid KERN still reaches core code generation. It catches generator exceptions that parse/schema/semantic validation can miss.

Use `expect machine=<Name> transition=<Transition>` for direct machine-edge assertions. Add `from=`, `to=`, and `guarded=true|false` when the transition contract matters independently from a full path. Reachability assertions can also start at a non-initial state with `from=`, require states with `through=`, forbid states with `avoid=`/`avoids=`, and cap path length with `maxSteps=`.

Use `expect node=<type>` for KERN-native shape assertions over the target IR. Add `name=<name>` to narrow the node, `within=<ancestor-name-or-type>` to scope it under a parent declaration, `child=<type>` plus optional `childName=<name>` to assert direct children, `count=<n>` to assert cardinality, and `prop=<prop> is=<value>` to assert a KERN prop value. This is the preferred assertion when the invariant is about KERN declarations themselves, for example an interface field, machine state, class method, route param, or guard node.

Use `no=nonExhaustiveGuards` to scan target-side variant guards that declare `covers=...`, `over=<Union>`, or `union=<Union>`. This is useful when Guard/Sight should catch a newly-added union variant before any backend compiler runs. Use `no=emptyRoutes` when route declarations must carry executable behavior through `handler`, `respond`, `derive`, `fmt`, `branch`, `each`, `collect`, or `effect`.

Use `expect expr={{...}}` for small runtime assertions over referenced target-side `const`, `derive`, `let`, pure `fn`, constrained `class`, `mapLit`, `setLit`, structured `destructure`, and safe native array/data bindings such as `filter`, `map`, `find`, `reduce`, `slice`, `flatMap`, `sort`, `join`, `compact`, `pluck`, `unique`, `uniqueBy`, `groupBy`, `partition`, `indexBy`, `countBy`, `chunk`, `zip`, `range`, `take`, `drop`, `min`, `max`, `minBy`, `maxBy`, `sum`, `avg`, `sumBy`, `intersect`, and `collect`. Runtime branch bindings execute matching `path` children and return the first `respond` payload when present. Runtime `each` nodes execute eagerly so iteration-scoped `let`/`derive` children can prove loop behavior before codegen. Runtime `fn` handlers may use local statements, `if`, `return`, `throw`, and `async=true`/`await` over sandboxed values. Runtime `class` support covers fields, constructors, methods, and getters/setters with the same sandbox restrictions. Without a comparator, the expression must evaluate truthy. Add `equals=...` for deep equality, `matches="..."` for string/regex checks, or `throws=ErrorName` for expected exceptions.

Use `fixture name=<id> value={{...}}` or `fixture name=<id> expr={{...}}` to define scoped runtime data inside `test`, `describe`, or `it`. Fixtures are visible to descendant assertions and do not leak into sibling cases.

Use `expect fn=<name>` when the target KERN `fn` itself is the behavior under test. Add `with=<fixture-or-expression>` to pass one argument, or `args={{[...]}}` to spread an argument array into the function. Use `expect derive=<name>` to execute a target-side `derive` binding through the same runtime evaluator. Behavioral assertions support the same `equals=...`, `matches="..."`, and `throws=ErrorName` comparators as `expect expr={{...}}`. Failed behavior assertions report the generated call expression and fixture names so CI output points back to the KERN-native setup.

Use `expect route="METHOD /path"` to execute portable KERN route workflows before Express/FastAPI generation. Add `with={{...}}` (or `input={{...}}`) to provide `{ params, query, body, headers }`. Route workflow assertions currently execute target-side `derive`, `guard`, `branch`, `collect`, `each`, `destructure`, `partition`, deterministic `effect`/`recover`, and `respond` nodes. Use `returns={{...}}` for deep equality, or the same `equals=...`, `matches="..."`, and `throws=ErrorName` comparators as other runtime assertions. Handler blocks and non-expression effects remain backend/runtime-test territory until dedicated native mocks land.

Use `expect effect=<name>` for deterministic portable effects with `trigger expr={{...}}`. A successful trigger can be checked with `returns={{...}}`; recovery can be checked with `recovers=true fallback={{...}}`. Route workflow assertions execute the same deterministic effect/recover subset, including `effectName.result` references. Non-expression triggers such as `query=`, `url=`, and `call=` are intentionally not executed by the native runner yet.

Runtime assertions intentionally do not execute arbitrary application code. Multi-statement expressions and unsafe globals such as `process`, `require`, `eval`, `Function`, `fetch`, timers, and `WebSocket` are rejected before execution.

Use `preset=coverage` when Guard/Sight need a native signal for untested KERN surface. Machine transition coverage is driven by explicit `via=...` reachability assertions. Guard coverage passes when guards have explicit `expect guard=<name> exhaustive=true` assertions or a guard-wide assertion such as `expect preset=guard`.

Native effect checks follow same-file helper `fn` calls before classifying dangerous work, so a route/tool that calls `readSecret()` still gets flagged when `readSecret()` performs filesystem, database, network, shell, or email effects. They also recognize inline CLI permission gates shaped like a `checkPermission` function returning a `PermissionDecision` and returned from a tool factory. That lets KERN test AGON-style tool factories without forcing every permission check into a separate `guard` node.

Use `--coverage` to print native transition/guard coverage. Use `--min-coverage <pct>` to fail CI when combined machine-transition and guard coverage drops below the threshold. JSON summaries always include the same `coverage` object.

Use `severity=warn` for known migration debt that should stay visible without failing local runs. CI can promote warnings to failures with `kern test <file-or-dir> --fail-on-warn`.

Use `--grep <pattern>` to run only matching suites, cases, assertions, rule IDs, messages, or files. The CLI exits nonzero when a grep run matches zero assertions. Use `--bail` to stop after the first failed native assertion.

Use `--watch` during development to rerun native KERN tests when watched `.kern` files change. Directory inputs watch every `.kern` file under the directory. Single native test files watch the test file plus its current target files.

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
  formatNativeKernTestCoverage,
  formatNativeKernTestRunSummary,
  runNativeKernTestRun,
  runNativeKernTests,
} from '@kernlang/test';

const fileSummary = runNativeKernTests('order.test.kern', { grep: 'Order', bail: true });
const runSummary = runNativeKernTestRun('examples/native-test', { grep: /coverage|guard/i });
console.log(formatNativeKernTestRunSummary(runSummary));
console.log(formatNativeKernTestCoverage(runSummary.coverage));
```
