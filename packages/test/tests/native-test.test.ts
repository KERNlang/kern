import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  checkNativeKernTestBaseline,
  createNativeKernTestBaseline,
  discoverNativeKernTestFiles,
  formatNativeKernTestCoverage,
  formatNativeKernTestRunSummary,
  formatNativeKernTestSummary,
  runNativeKernTestRun,
  runNativeKernTests,
} from '../src/index.js';

describe('native kern test runner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kern-native-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('passes machine reachability and derive-cycle assertions', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=confirmed',
        '  state name=paid',
        '  transition name=confirm from=pending to=confirmed',
        '  transition name=capture from=confirmed to=paid',
        '  transition name=reset from="confirmed|paid" to=pending',
        'derive name=subtotal expr={{itemsTotal}}',
        'derive name=tax expr={{subtotal * taxRate}}',
        'derive name=total expr={{subtotal + tax}}',
        'union name=Payment discriminant=kind',
        '  variant name=card',
        '  variant name=paypal',
        'guard name=ChargeCard kind=variant covers=card,paypal',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="reaches paid"',
        '    expect machine=Order reaches=paid via=confirm,capture',
        '  it name="derive graph stays acyclic"',
        '    expect no=deriveCycles',
        '  it name="schema stays valid"',
        '    expect no=schemaViolations',
        '  it name="semantic checks accept multi-source transitions"',
        '    expect no=semanticViolations',
        '  it name="charge guard covers payment variants"',
        '    expect guard=ChargeCard exhaustive=true over=Payment',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.total).toBe(5);
    expect(summary.passed).toBe(5);
    expect(summary.failed).toBe(0);
    expect(formatNativeKernTestSummary(summary)).toContain('PASS Order invariants > reaches paid');
  });

  test('executes runtime expr assertions against target const and derive bindings', () => {
    writeFileSync(
      join(tmpDir, 'runtime.kern'),
      [
        'const name=base value=2',
        'const name=tax value=3',
        'const name=status value="paid"',
        'const name=states value={{["pending", "paid"]}}',
        'derive name=total expr={{base + tax}}',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'runtime.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Runtime assertions" target="./runtime.kern"',
        '  it name="evaluates pure expressions"',
        '    expect expr={{total === 5 && status === "paid" && states.includes("paid")}}',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.total).toBe(1);
    expect(summary.passed).toBe(1);
    expect(summary.results[0].ruleId).toBe('expr');
  });

  test('supports runtime expr equals, matches, and throws comparators', () => {
    writeFileSync(
      join(tmpDir, 'runtime.kern'),
      [
        'const name=count value=3',
        'const name=status value="paid"',
        'const name=states value={{["pending", "paid"]}}',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'runtime.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Runtime assertions" target="./runtime.kern"',
        '  it name="compares values"',
        '    expect expr={{count + 2}} equals=5',
        '    expect expr={{status}} equals="paid"',
        '    expect expr={{states}} equals={{["pending", "paid"]}}',
        '  it name="matches strings"',
        '    expect expr={{status}} matches="^pa"',
        '  it name="checks expected exceptions"',
        '    expect expr={{JSON.parse("not-json")}} throws=SyntaxError',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.total).toBe(5);
    expect(summary.passed).toBe(5);
    expect(summary.failed).toBe(0);
    expect(summary.results.map((result) => result.assertion)).toContain('expr count + 2 equals 5');
    expect(summary.results.map((result) => result.assertion)).toContain('expr status matches ^pa');
    expect(summary.results.map((result) => result.assertion)).toContain(
      'expr JSON.parse("not-json") throws SyntaxError',
    );
  });

  test('executes simple pure fn handlers in runtime expr assertions', () => {
    writeFileSync(
      join(tmpDir, 'functions.kern'),
      [
        'const name=base value=10',
        'fn name=add returns=number',
        '  param name=a type=number',
        '  param name=b type=number',
        '  handler <<<',
        '    return a + b;',
        '  >>>',
        'fn name=withBase params="value:number" returns=number',
        '  handler <<<',
        '    return add(value, base);',
        '  >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'functions.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Function runtime" target="./functions.kern"',
        '  it name="calls pure functions"',
        '    expect expr={{add(2, 3)}} equals=5',
        '    expect expr={{withBase(7)}} equals=17',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(2);
    expect(summary.results.map((result) => result.assertion)).toContain('expr add(2, 3) equals 5');
  });

  test('runtime expr reads quoted JS string literal defaults as literal source', () => {
    writeFileSync(
      join(tmpDir, 'runtime.kern'),
      ['const name=LOCAL_CONFIG_NAME type=string value="\'.agon.json\'"'].join('\n'),
    );
    const testFile = join(tmpDir, 'runtime.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Runtime assertions" target="./runtime.kern"',
        '  it name="checks AGON-style quoted literal source"',
        '    expect expr={{LOCAL_CONFIG_NAME}} equals=".agon.json"',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(1);
  });

  test('fails false runtime expr assertions with custom message', () => {
    writeFileSync(join(tmpDir, 'runtime.kern'), ['const name=total value=5'].join('\n'));
    const testFile = join(tmpDir, 'runtime.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Runtime assertions" target="./runtime.kern"',
        '  it name="detects mismatches"',
        '    expect expr={{total === 6}} message="total must match"',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain('total must match');
  });

  test('runtime expr assertions ignore unrelated duplicate bindings', () => {
    writeFileSync(
      join(tmpDir, 'runtime.kern'),
      ['const name=answer value=42', 'const name=unused value=1', 'const name=unused value=2'].join('\n'),
    );
    const testFile = join(tmpDir, 'runtime.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Runtime assertions" target="./runtime.kern"',
        '  it name="only materializes referenced bindings"',
        '    expect expr={{answer === 42}}',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.passed).toBe(1);
  });

  test('rejects unsafe runtime expr assertions before execution', () => {
    const testFile = join(tmpDir, 'runtime.test.kern');
    writeFileSync(
      testFile,
      [
        'const name=ok value=true',
        'test name="Runtime assertions"',
        '  it name="blocks process access"',
        '    expect expr={{process.exit(1)}}',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain("unsupported token 'process'");
  });

  test('fails when a declared transition path does not reach the target state', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=confirmed',
        '  state name=paid',
        '  transition name=confirm from=pending to=confirmed',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="reaches paid"',
        '    expect machine=Order reaches=paid via=confirm,capture',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain('Transition capture is not reachable');
  });

  test('fails on derive cycles', () => {
    writeFileSync(
      join(tmpDir, 'derived.kern'),
      ['derive name=a expr={{b + 1}}', 'derive name=b expr={{a + 1}}'].join('\n'),
    );
    const testFile = join(tmpDir, 'derived.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Derive invariants" target="./derived.kern"',
        '  it name="has no cycles"',
        '    expect no=cycles',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain('Found derive cycle');
  });

  test('fails on unreachable states and duplicate transitions', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  state name=orphaned',
        '  transition name=capture from=pending to=paid',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="has no dead states"',
        '    expect machine=Order no=deadStates',
        '  it name="has no duplicate transitions"',
        '    expect machine=Order no=duplicateTransitions',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(2);
    expect(summary.results[0].message).toContain('orphaned');
    expect(summary.results[1].message).toContain("transition 'capture' is duplicated");
  });

  test('fails when a guard is not exhaustive over a union', () => {
    writeFileSync(
      join(tmpDir, 'payment.kern'),
      [
        'union name=Payment discriminant=kind',
        '  variant name=card',
        '  variant name=paypal',
        'guard name=ChargeCard kind=variant covers=card',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'payment.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Payment invariants" target="./payment.kern"',
        '  it name="charge guard is exhaustive"',
        '    expect guard=ChargeCard exhaustive=true over=Payment',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain('missing variants: paypal');
  });

  test('passes the broader safety invariant pack when guards and validation are present', () => {
    writeFileSync(
      join(tmpDir, 'api.kern'),
      [
        'server name=Api',
        '  route method=post path=/orders',
        '    validate schema=OrderInput',
        '    guard name=auth kind=auth',
        '    handler <<<',
        '      await db.create(input);',
        '    >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'api.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="API safety" target="./api.kern"',
        '  it name="routes stay unique"',
        '    expect no=duplicateRoutes',
        '  it name="mutating routes are guarded"',
        '    expect no=unvalidatedRoutes',
        '  it name="effects are guarded"',
        '    expect no=unguardedEffects',
        '  it name="guards are explicit"',
        '    expect no=weakGuards',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(4);
  });

  test('fails on duplicate routes, weak guards, unguarded effects, and raw handlers', () => {
    writeFileSync(
      join(tmpDir, 'api.kern'),
      [
        'server name=Api',
        '  route method=post path=/orders',
        '    handler <<<',
        '      await db.create(input);',
        '    >>>',
        '  route method=post path=/orders',
        '  route method=get path=/unsafe',
        '    guard name=hasUser expr={{user}}',
        '    handler <<<',
        '      await fetch(url);',
        '    >>>',
        'fn name=loadRemote',
        '  handler <<<',
        '    return fetch(url);',
        '  >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'api.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="API safety" target="./api.kern"',
        '  it name="routes stay unique"',
        '    expect no=duplicateRoutes',
        '  it name="mutating routes are guarded"',
        '    expect no=unvalidatedRoutes',
        '  it name="effects are guarded"',
        '    expect no=unguardedEffects',
        '  it name="guards are explicit"',
        '    expect no=weakGuards',
        '  it name="raw handler debt stays visible"',
        '    expect no=rawHandlers',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(5);
    expect(summary.results[0].message).toContain('POST /orders');
    expect(summary.results[1].message).toContain('mutates without schema/validate/guard/auth');
    expect(summary.results[2].message).toContain('performs database query without guard/auth/validate/permission');
    expect(summary.results[3].message).toContain('has expr but no else/handler');
    expect(summary.results[4].message).toContain('Found raw handler escapes');
  });

  test('fails on guard misconfigurations', () => {
    writeFileSync(
      join(tmpDir, 'mcp.kern'),
      [
        'mcp name=Files',
        '  tool name=readFile',
        '    param name=filePath type=string required=true',
        '    param name=maxResults type=number required=false',
        '    guard type=pathContainment param=path',
        '    guard type=pathContainment param=filePath',
        '    guard type=validate param=maxResults min=500 max=1',
        '    guard type=rateLimit maxRequests=0 windowMs=0',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'mcp.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="MCP guard safety" target="./mcp.kern"',
        '  it name="guards are configured"',
        '    expect no=invalidGuards',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain("references unknown param 'path'");
    expect(summary.results[0].message).toContain('path containment without allowlist/allow/root/roots');
    expect(summary.results[0].message).toContain('min 500 greater than max 1');
    expect(summary.results[0].message).toContain('maxRequests 0; expected > 0');
    expect(summary.results[0].message).toContain('windowMs 0; expected > 0');
  });

  test('passes the extended guard and effect invariant pack', () => {
    writeFileSync(
      join(tmpDir, 'safe.kern'),
      [
        'mcp name=Safe',
        '  tool name=readFile',
        '    param name=filePath type=string required=true',
        '    guard type=pathContainment param=filePath allowlist="/data"',
        '    guard type=auth',
        '    handler <<<',
        '      return await fs.readFile(filePath, "utf-8");',
        '    >>>',
        '  tool name=fetchAllowed',
        '    param name=url type=string required=true',
        '    guard type=urlAllowlist param=url allowlist="api.example.com"',
        '    guard type=auth',
        '    handler <<<',
        '      return await fetch(url);',
        '    >>>',
        'server name=Api',
        '  route method=get path=/items/:id',
        '    params id:string',
        'component name=Dashboard',
        '  effect deps=url',
        '    handler <<<',
        '      const controller = new AbortController();',
        '      fetch(url, { signal: controller.signal });',
        '    >>>',
        '    cleanup <<<',
        '      controller.abort();',
        '    >>>',
        'async name=loadRemote',
        '  handler <<<',
        '    await fetch(url);',
        '  >>>',
        '  recover',
        '    handler <<<',
        '      return null;',
        '    >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'safe.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Extended safety" target="./safe.kern"',
        '  it name="params stay unique"',
        '    expect no=duplicateParams',
        '  it name="tool params are guarded"',
        '    expect no=unguardedToolParams',
        '  it name="path params stay contained"',
        '    expect no=missingPathGuards',
        '  it name="network calls stay bounded"',
        '    expect no=ssrfRisks',
        '  it name="sensitive effects require auth"',
        '    expect no=sensitiveEffectsRequireAuth',
        '  it name="route path params are checked"',
        '    expect no=routePathParams',
        '  it name="effects clean up"',
        '    expect no=effectWithoutCleanup',
        '  it name="async blocks recover"',
        '    expect no=unrecoveredAsync',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(8);
  });

  test('treats inline permission gates as sensitive effect coverage', () => {
    writeFileSync(
      join(tmpDir, 'permission-tool.kern'),
      [
        'fn name=createBashTool returns=ToolHandler',
        '  handler <<<',
        '    function checkPermission(input: Record<string, unknown>, ctx: ToolContext): PermissionDecision {',
        "      if (ctx.permissionMode === 'auto') return { behavior: 'allow' };",
        "      return { behavior: 'ask' };",
        '    }',
        '    async function execute(input: Record<string, unknown>) {',
        "      const { readFileSync } = await import('node:fs');",
        "      return readFileSync(String(input.path), 'utf-8');",
        '    }',
        '    return { definition: {}, validate: () => null, checkPermission, execute };',
        '  >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'permission-tool.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Permission gated tool" target="./permission-tool.kern"',
        '  it name="sensitive effects are permission gated"',
        '    expect no=unguardedEffects',
        '    expect no=sensitiveEffectsRequireAuth',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(2);
  });

  test('fails on extended guard and effect invariant regressions', () => {
    writeFileSync(
      join(tmpDir, 'bad.kern'),
      [
        'mcp name=Bad',
        '  tool name=fetchRemote',
        '    param name=url type=string required=true',
        '    handler <<<',
        '      return await fetch(url);',
        '    >>>',
        '  tool name=readFile',
        '    param name=filePath type=string required=true',
        '    guard type=sanitize param=filePath',
        '    handler <<<',
        '      return await fs.readFile(filePath, "utf-8");',
        '    >>>',
        '  tool name=search',
        '    param name=query type=string required=true',
        '    param name=query type=string required=true',
        'server name=Api',
        '  route method=post path=/orders',
        '    validate schema=OrderInput',
        '    handler <<<',
        '      await db.create(input);',
        '    >>>',
        '  route method=get path=/items/:id',
        '    handler <<<',
        '      res.json({});',
        '    >>>',
        'component name=Dashboard',
        '  effect deps=window',
        '    handler <<<',
        '      window.addEventListener("resize", onResize);',
        '    >>>',
        'async name=loadRemote',
        '  handler <<<',
        '    await fetch(url);',
        '  >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'bad.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Extended safety" target="./bad.kern"',
        '  it name="params stay unique"',
        '    expect no=duplicateParams',
        '  it name="tool params are guarded"',
        '    expect no=unguardedToolParams',
        '  it name="path params stay contained"',
        '    expect no=missingPathGuards',
        '  it name="network calls stay bounded"',
        '    expect no=ssrfRisks',
        '  it name="sensitive effects require auth"',
        '    expect no=sensitiveEffectsRequireAuth',
        '  it name="route path params are checked"',
        '    expect no=routePathParams',
        '  it name="effects clean up"',
        '    expect no=effectWithoutCleanup',
        '  it name="async blocks recover"',
        '    expect no=unrecoveredAsync',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(8);
    expect(summary.results[0].message).toContain("duplicates param 'query'");
    expect(summary.results[1].message).toContain("requires param 'url' without a param-specific guard");
    expect(summary.results[2].message).toContain("path-like param 'filePath' lacks pathContainment guard");
    expect(summary.results[3].message).toContain('Found SSRF risks');
    expect(summary.results[4].message).toContain('performs database query without auth/permission');
    expect(summary.results[5].message).toContain("path param 'id' is not declared, validated, or guarded");
    expect(summary.results[6].message).toContain('side-effect handler without cleanup');
    expect(summary.results[7].message).toContain('async handler without recover');
  });

  test('classifies effects reached through same-file helper functions', () => {
    writeFileSync(
      join(tmpDir, 'indirect-effect.kern'),
      [
        'fn name=readSecret params="filePath:string" returns=string',
        '  handler <<<',
        '    return readFileSync(filePath, "utf-8");',
        '  >>>',
        'server name=Api',
        '  route method=get path=/secret',
        '    handler <<<',
        '      return readSecret(filePath);',
        '    >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'indirect-effect.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Indirect effects" target="./indirect-effect.kern"',
        '  it name="helper calls do not hide effects"',
        '    expect no=unguardedEffects',
        '    expect no=sensitiveEffectsRequireAuth',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(2);
    expect(summary.results[0].message).toContain('fn readSecret');
    expect(summary.results[0].message).toContain('route GET /secret');
    expect(summary.results[1].message).toContain('fn readSecret');
    expect(summary.results[1].message).toContain('route GET /secret');
  });

  test('expands native test presets into granular invariant results', () => {
    writeFileSync(
      join(tmpDir, 'mcp.kern'),
      [
        'mcp name=Files',
        '  tool name=readFile',
        '    param name=filePath type=string required=true',
        '    guard type=pathContainment param=filePath allowlist="/data"',
        '  tool name=fetchAllowed',
        '    param name=url type=string required=true',
        '    guard type=urlAllowlist param=url allowlist="api.example.com"',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'mcp.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="MCP safety" target="./mcp.kern"',
        '  it name="uses safety preset"',
        '    expect preset=mcpSafety',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(5);
    expect(summary.results.map((result) => result.ruleId)).toEqual([
      'no:duplicateparams',
      'no:invalidguards',
      'no:unguardedtoolparams',
      'no:missingpathguards',
      'no:ssrfrisks',
    ]);
    expect(summary.results.map((result) => result.assertion)).toEqual([
      'preset mcpSafety / no duplicateParams',
      'preset mcpSafety / no invalidGuards',
      'preset mcpSafety / no unguardedToolParams',
      'preset mcpSafety / no missingPathGuards',
      'preset mcpSafety / no ssrfRisks',
    ]);
  });

  test('fails invalid presets even when severity warn is requested', () => {
    writeFileSync(join(tmpDir, 'target.kern'), 'const name=value value=1');
    const testFile = join(tmpDir, 'target.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Preset configuration" target="./target.kern"',
        '  it name="rejects unknown preset"',
        '    expect preset=notReal severity=warn',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.warnings).toBe(0);
    expect(summary.results[0].severity).toBe('error');
    expect(summary.results[0].ruleId).toBe('preset:notreal');
    expect(summary.results[0].message).toContain('Unsupported native preset');
  });

  test('applies severity warn to each expanded preset invariant failure', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  state name=orphaned',
        '  transition name=capture from=pending to=paid',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Machine debt" target="./order.kern"',
        '  it name="keeps machine preset visible"',
        '    expect preset=machine severity=warn',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.warnings).toBe(2);
    expect(summary.results.map((result) => result.ruleId)).toEqual(['no:deadstates', 'no:duplicatetransitions']);
    expect(summary.results.every((result) => result.severity === 'warn')).toBe(true);
  });

  test('passes coverage preset when transitions and guards have native assertions', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=confirmed',
        '  state name=paid',
        '  transition name=confirm from=pending to=confirmed',
        '  transition name=capture from=confirmed to=paid',
        'union name=Payment discriminant=kind',
        '  variant name=card',
        '  variant name=paypal',
        'guard name=ChargeCard kind=variant covers=card,paypal',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order coverage" target="./order.kern"',
        '  it name="covers checkout transitions"',
        '    expect machine=Order reaches=paid via=confirm,capture',
        '  it name="guards have structural checks"',
        '    expect preset=guard',
        '  it name="suite covers target surface"',
        '    expect preset=coverage',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(5);
    expect(summary.results.map((result) => result.ruleId)).toEqual([
      'machine:reaches',
      'no:invalidguards',
      'no:weakguards',
      'no:untestedtransitions',
      'no:untestedguards',
    ]);
  });

  test('fails coverage when machine transitions are not exercised via explicit paths', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=confirmed',
        '  state name=paid',
        '  state name=refunded',
        '  transition name=confirm from=pending to=confirmed',
        '  transition name=capture from=confirmed to=paid',
        '  transition name=refund from=paid to=refunded',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order coverage" target="./order.kern"',
        '  it name="covers happy path"',
        '    expect machine=Order reaches=paid via=confirm,capture',
        '  it name="all transitions have tests"',
        '    expect machine=Order no=untestedTransitions',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[1].ruleId).toBe('no:untestedtransitions');
    expect(summary.results[1].message).toContain('Order.refund');
  });

  test('fails coverage when guards lack explicit or guard-wide assertions', () => {
    writeFileSync(
      join(tmpDir, 'payment.kern'),
      [
        'union name=Payment discriminant=kind',
        '  variant name=card',
        '  variant name=paypal',
        'guard name=ChargeCard kind=variant covers=card,paypal',
        'guard name=VerifyUser kind=variant covers=card,paypal',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'payment.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Payment coverage" target="./payment.kern"',
        '  it name="charge guard is exhaustive"',
        '    expect guard=ChargeCard exhaustive=true over=Payment',
        '  it name="guards all have tests"',
        '    expect no=untestedGuards',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[1].ruleId).toBe('no:untestedguards');
    expect(summary.results[1].message).toContain('guard VerifyUser');
    expect(summary.results[1].message).toContain('expect preset=guard');
  });

  test('reports native coverage metrics for transitions and guards', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=confirmed',
        '  state name=paid',
        '  state name=refunded',
        '  transition name=confirm from=pending to=confirmed',
        '  transition name=capture from=confirmed to=paid',
        '  transition name=refund from=paid to=refunded',
        'union name=Payment discriminant=kind',
        '  variant name=card',
        '  variant name=paypal',
        'guard name=ChargeCard kind=variant covers=card,paypal',
        'guard name=VerifyUser kind=variant covers=card,paypal',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'coverage.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Coverage report" target="./order.kern"',
        '  it name="covers happy path"',
        '    expect machine=Order reaches=paid via=confirm,capture',
        '  it name="charge guard is exhaustive"',
        '    expect guard=ChargeCard exhaustive=true over=Payment',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);
    const output = formatNativeKernTestCoverage(summary.coverage);

    expect(summary.failed).toBe(0);
    expect(summary.coverage.total).toBe(5);
    expect(summary.coverage.covered).toBe(3);
    expect(summary.coverage.percent).toBe(60);
    expect(summary.coverage.transitions.uncovered).toEqual(['Order.refund at line 8']);
    expect(summary.coverage.guards.uncovered).toEqual(['guard VerifyUser at line 13']);
    expect(output).toContain('coverage 3/5 (60%)');
    expect(output).toContain('uncovered transitions:');
    expect(output).toContain('Order.refund');
    expect(output).toContain('uncovered guards:');
    expect(output).toContain('guard VerifyUser');
  });

  test('passes language surface smoke for arrays classes and functions', () => {
    writeFileSync(
      join(tmpDir, 'language.kern'),
      [
        'type name=UserSelector alias="(user: User) => boolean"',
        'type name=UserPair alias="[User, User]"',
        'interface name=User',
        '  field name=id type=string',
        '  field name=name type=string',
        '  field name=active type=boolean',
        '  field name=role type=string',
        'const name=users type="User[]" value={{ [] }}',
        'filter name=activeUsers in=users item=user where="user.active" type="User[]"',
        'map name=userNames in=activeUsers item=user expr="user.name" type="string[]"',
        'find name=adminUser in=activeUsers item=user where="user.role === \'admin\'" type="User | undefined"',
        'reduce name=activeCount in=activeUsers acc=count item=user initial=0 expr="count + 1" type=number',
        'slice name=firstUsers in=activeUsers start=0 end=10 type="User[]"',
        'destructure kind=const source=activeUsers',
        '  element name=firstUser index=0',
        '  element name=secondUser index=1',
        'mapLit name=roleLabels type="Map<string, string>"',
        '  mapEntry key="admin" value="Administrator"',
        '  mapEntry key="member" value="Member"',
        'setLit name=allowedRoles type="Set<string>"',
        '  setItem value="admin"',
        '  setItem value="member"',
        'class name=UserDirectory export=true',
        '  field name=items type="User[]" private=true value={{ [] }}',
        '  constructor',
        '    param name=initial type="User[]" value={{ [] }}',
        '    handler <<<',
        '      this.items = initial;',
        '    >>>',
        '  method name=list returns="User[]"',
        '    handler <<<',
        '      return this.items;',
        '    >>>',
        '  method name=select generics="<T extends User>" params="items:T[]" returns="T[]"',
        '    handler <<<',
        '      return items.filter((item) => item.active);',
        '    >>>',
        'fn name=selectActive generics="<T extends User>" returns="T[]"',
        '  param name=items type="T[]"',
        '  param name=predicate type="(item: T) => boolean" value={{ (item) => item.active }}',
        '  handler <<<',
        '    return items.filter(predicate);',
        '  >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'language.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Language surface" target="./language.kern"',
        '  it name="arrays classes and functions stay schema valid"',
        '    expect no=schemaViolations',
        '  it name="arrays classes and functions stay semantically valid"',
        '    expect no=semanticViolations',
        '  it name="language surface names stay unique"',
        '    expect no=duplicateNames',
        '  it name="arrays classes and functions reach core codegen"',
        '    expect no=codegenErrors',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(4);
    expect(summary.results.map((result) => result.ruleId)).toEqual([
      'no:schemaviolations',
      'no:semanticviolations',
      'no:duplicatenames',
      'no:codegenerrors',
    ]);
  });

  test('asserts KERN node shape directly', () => {
    writeFileSync(
      join(tmpDir, 'language.kern'),
      [
        'interface name=User',
        '  field name=id type=string',
        '  field name=email type=string',
        'class name=UserDirectory',
        '  field name=items type="User[]" private=true',
        '  method name=list returns="User[]"',
        '    handler <<<',
        '      return this.items;',
        '    >>>',
        'fn name=selectActive returns="User[]"',
        '  param name=items type="User[]"',
        '  param name=limit type=number value=10',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'language.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="KERN shape" target="./language.kern"',
        '  it name="declares expected shapes"',
        '    expect node=interface name=User child=field count=2',
        '    expect node=field name=email within=User prop=type is=string',
        '    expect node=class name=UserDirectory child=method childName=list',
        '    expect node=param name=limit within=selectActive prop=type is=number',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(4);
    expect(summary.results.map((result) => result.ruleId)).toEqual([
      'kern:node',
      'kern:node',
      'kern:node',
      'kern:node',
    ]);
  });

  test('fails KERN node shape assertions with precise messages', () => {
    writeFileSync(
      join(tmpDir, 'language.kern'),
      ['interface name=User', '  field name=id type=string', 'class name=UserDirectory'].join('\n'),
    );
    const testFile = join(tmpDir, 'language.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="KERN shape" target="./language.kern"',
        '  it name="catches shape drift"',
        '    expect node=interface name=User child=field count=2',
        '    expect node=field name=id within=User prop=type is=number',
        '    expect node=class name=UserDirectory child=method childName=list',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(3);
    expect(summary.results[0].message).toContain('expected 2 child field');
    expect(summary.results[1].message).toContain('prop type expected number, found string');
    expect(summary.results[2].message).toContain('missing child method name=list');
  });

  test('fails on target codegen errors not caught by schema validation', () => {
    writeFileSync(
      join(tmpDir, 'broken.kern'),
      ['destructure source=user', '  binding name=id', 'destructure source=pair', '  element name=first'].join('\n'),
    );
    const testFile = join(tmpDir, 'broken.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Codegen smoke" target="./broken.kern"',
        '  it name="core generation stays healthy"',
        '    expect no=codegenErrors',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].ruleId).toBe('no:codegenerrors');
    expect(summary.results[0].message).toContain('Found codegen errors');
    expect(summary.results[0].message).toContain('numeric `index=`');
  });

  test('discovers and runs native test files under a directory', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    writeFileSync(
      join(tmpDir, 'order.test.kern'),
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="uses machine preset"',
        '    expect preset=machine',
      ].join('\n'),
    );
    writeFileSync(join(tmpDir, 'notes.kern'), ['const name=notATest value=1'].join('\n'));

    const files = discoverNativeKernTestFiles(tmpDir);
    const summary = runNativeKernTestRun(tmpDir);

    expect(files).toEqual([join(tmpDir, 'order.test.kern')]);
    expect(summary.testFiles).toEqual([join(tmpDir, 'order.test.kern')]);
    expect(summary.files).toHaveLength(1);
    expect(summary.passed).toBe(2);
    expect(summary.warnings).toBe(0);
    expect(summary.failed).toBe(0);
    expect(formatNativeKernTestRunSummary(summary)).toContain('2 passed, 0 warnings, 0 failed, 2 total');
  });

  test('runs repo-root smoke suites against nested package targets with compact output', () => {
    const modelsDir = join(tmpDir, 'packages', 'core', 'src', 'kern', 'models');
    const fsDir = join(tmpDir, 'packages', 'core', 'src', 'kern', 'forge');
    mkdirSync(modelsDir, { recursive: true });
    mkdirSync(fsDir, { recursive: true });
    writeFileSync(
      join(modelsDir, 'hash.kern'),
      [
        'fn name=hashInput params="input:string" returns=string export=true',
        '  handler <<<',
        "    return createHash('sha256').update(input).digest('hex');",
        '  >>>',
      ].join('\n'),
    );
    writeFileSync(
      join(fsDir, 'snapshot.kern'),
      [
        'fn name=readSnapshot params="path:string" returns=string export=true',
        '  handler <<<',
        "    return readFileSync(path, 'utf-8');",
        '  >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'repo-smoke.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Repo model smoke" target="./packages/core/src/kern/models/hash.kern"',
        '  it name="hash helper is not misclassified as database"',
        '    expect no=schemaViolations',
        '    expect no=codegenErrors',
        '    expect no=unguardedEffects',
        '    expect no=sensitiveEffectsRequireAuth',
        '',
        'test name="Repo filesystem smoke" target="./packages/core/src/kern/forge/snapshot.kern"',
        '  it name="filesystem read is reported precisely"',
        '    expect no=schemaViolations',
        '    expect no=codegenErrors',
        '    expect no=unguardedEffects severity=warn',
        '    expect no=sensitiveEffectsRequireAuth severity=warn',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);
    const compact = formatNativeKernTestSummary(summary, { format: 'compact' });
    const baseline = createNativeKernTestBaseline(summary);

    expect(summary.failed).toBe(0);
    expect(summary.warnings).toBe(2);
    expect(summary.passed).toBe(6);
    expect(summary.results.some((result) => result.message?.includes('database'))).toBe(false);
    expect(summary.results.find((result) => result.status === 'warning')?.message).toContain('filesystem read');
    expect(compact).toContain('6 passed, 2 warnings, 0 failed, 8 total');
    expect(compact).toContain('WARN Repo filesystem smoke');
    expect(compact).not.toContain('PASS Repo model smoke');
    expect(baseline.warnings.some((warning) => warning.message?.includes('at line <line>'))).toBe(true);
    expect(baseline.warnings.some((warning) => warning.message?.includes('at line 1'))).toBe(false);
  });

  test('classifies standalone database query helpers without broad update false positives', () => {
    writeFileSync(
      join(tmpDir, 'query.kern'),
      [
        'fn name=loadOrders params="tenantId:string" returns=any',
        '  handler <<<',
        '    return query(sql`select * from orders where tenant_id = ${tenantId}`);',
        '  >>>',
        'fn name=saveOrder params="input:any" returns=any',
        '  handler <<<',
        '    return update(input);',
        '  >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'query.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Database safety" target="./query.kern"',
        '  it name="query helpers are covered"',
        '    expect no=unguardedEffects',
        '    expect no=sensitiveEffectsRequireAuth',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(2);
    expect(summary.results[0].message).toContain('performs database query without guard/auth/validate/permission');
    expect(summary.results[0].message).toContain('fn saveOrder');
    expect(summary.results[1].message).toContain('performs database query without auth/permission');
    expect(summary.results[1].message).toContain('fn saveOrder');
  });

  test('compact directory summaries include failing files and elide passing files', () => {
    writeFileSync(
      join(tmpDir, 'pass.kern'),
      [
        'machine name=PassFlow',
        '  state name=pending initial=true',
        '  state name=paid',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    writeFileSync(
      join(tmpDir, 'pass.test.kern'),
      [
        'test name="Passing smoke" target="./pass.kern"',
        '  it name="reaches paid"',
        '    expect machine=PassFlow reaches=paid',
      ].join('\n'),
    );
    writeFileSync(
      join(tmpDir, 'fail.kern'),
      ['machine name=FailFlow', '  state name=pending initial=true', '  state name=paid'].join('\n'),
    );
    writeFileSync(
      join(tmpDir, 'fail.test.kern'),
      [
        'test name="Failing smoke" target="./fail.kern"',
        '  it name="reaches paid"',
        '    expect machine=FailFlow reaches=paid',
      ].join('\n'),
    );

    const summary = runNativeKernTestRun(tmpDir);
    const output = formatNativeKernTestRunSummary(summary, { format: 'compact' });

    expect(summary.failed).toBe(1);
    expect(output).toContain('1 passed, 0 warnings, 1 failed, 2 total');
    expect(output).toContain('fail.test.kern');
    expect(output).toContain('FAIL Failing smoke');
    expect(output).not.toContain('Passing smoke');
  });

  test('directory discovery skips generated and dependency folders', () => {
    mkdirSync(join(tmpDir, 'generated'));
    mkdirSync(join(tmpDir, 'node_modules'));
    writeFileSync(
      join(tmpDir, 'generated', 'bad.test.kern'),
      [
        'test name="Generated" target="../missing.kern"',
        '  it name="would fail if discovered"',
        '    expect no=schemaViolations',
      ].join('\n'),
    );
    writeFileSync(
      join(tmpDir, 'node_modules', 'bad.test.kern'),
      [
        'test name="Dependency" target="../missing.kern"',
        '  it name="would fail if discovered"',
        '    expect no=schemaViolations',
      ].join('\n'),
    );
    writeFileSync(join(tmpDir, 'target.kern'), 'const name=value value=1');
    writeFileSync(
      join(tmpDir, 'target.test.kern'),
      [
        'test name="Source" target="./target.kern"',
        '  it name="runs source test"',
        '    expect no=schemaViolations',
      ].join('\n'),
    );

    const files = discoverNativeKernTestFiles(tmpDir);
    const summary = runNativeKernTestRun(tmpDir);

    expect(files).toEqual([join(tmpDir, 'target.test.kern')]);
    expect(summary.testFiles).toEqual([join(tmpDir, 'target.test.kern')]);
    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(1);
  });

  test('downgrades failing assertions to warnings with severity warn', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  state name=orphaned',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="tracks dead states as debt"',
        '    expect machine=Order no=deadStates severity=warn',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);
    const output = formatNativeKernTestSummary(summary);

    expect(summary.passed).toBe(0);
    expect(summary.warnings).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.results[0].status).toBe('warning');
    expect(summary.results[0].severity).toBe('warn');
    expect(summary.results[0].ruleId).toBe('no:deadstates');
    expect(output).toContain('WARN Order invariants > tracks dead states as debt');
    expect(output).toContain('[no:deadstates]');
  });

  test('creates and checks warning baselines without line-number churn', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  state name=orphaned',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="tracks dead states as debt"',
        '    expect machine=Order no=deadStates severity=warn',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);
    const baseline = createNativeKernTestBaseline(summary);
    const check = checkNativeKernTestBaseline(summary, baseline);

    expect(baseline).toEqual({
      version: 1,
      warnings: [
        expect.objectContaining({
          suite: 'Order invariants',
          caseName: 'tracks dead states as debt',
          ruleId: 'no:deadstates',
        }),
      ],
    });
    expect(JSON.stringify(baseline)).not.toContain('"line"');
    expect(check.ok).toBe(true);
    expect(check.knownWarnings).toHaveLength(1);
    expect(check.newWarnings).toHaveLength(0);
    expect(check.staleWarnings).toHaveLength(0);
  });

  test('detects new and stale warning baseline entries', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  state name=orphaned',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="tracks dead states as debt"',
        '    expect machine=Order no=deadStates severity=warn',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);
    const check = checkNativeKernTestBaseline(summary, {
      version: 1,
      warnings: [
        {
          suite: 'Old suite',
          caseName: 'old case',
          ruleId: 'no:old',
          assertion: 'no old',
          message: 'old warning',
        },
      ],
    });

    expect(check.ok).toBe(false);
    expect(check.knownWarnings).toHaveLength(0);
    expect(check.newWarnings).toHaveLength(1);
    expect(check.staleWarnings).toHaveLength(1);
  });

  test('filters native assertion results with grep', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  state name=orphaned',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="has no dead states"',
        '    expect machine=Order no=deadStates',
        '  it name="has no duplicate transitions"',
        '    expect machine=Order no=duplicateTransitions',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile, { grep: 'duplicatetransitions' });

    expect(summary.total).toBe(1);
    expect(summary.results[0].ruleId).toBe('no:duplicatetransitions');
    expect(summary.failed).toBe(0);
  });

  test('bails after the first matching failed assertion', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  state name=orphaned',
        '  transition name=capture from=pending to=paid',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="has no dead states"',
        '    expect machine=Order no=deadStates',
        '  it name="has no duplicate transitions"',
        '    expect machine=Order no=duplicateTransitions',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile, { bail: true });

    expect(summary.total).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.results[0].ruleId).toBe('no:deadstates');
  });

  test('directory runner bails after the first failing file', () => {
    writeFileSync(
      join(tmpDir, 'bad.kern'),
      ['machine name=Bad', '  state name=pending initial=true', '  state name=orphaned'].join('\n'),
    );
    writeFileSync(
      join(tmpDir, 'bad.test.kern'),
      [
        'test name="Bad invariants" target="./bad.kern"',
        '  it name="has no dead states"',
        '    expect machine=Bad no=deadStates',
      ].join('\n'),
    );
    writeFileSync(join(tmpDir, 'good.kern'), 'const name=value value=1');
    writeFileSync(
      join(tmpDir, 'good.test.kern'),
      [
        'test name="Good invariants" target="./good.kern"',
        '  it name="stays valid"',
        '    expect no=schemaViolations',
      ].join('\n'),
    );

    const summary = runNativeKernTestRun(tmpDir, { bail: true });

    expect(summary.testFiles).toEqual([join(tmpDir, 'bad.test.kern')]);
    expect(summary.total).toBe(1);
    expect(summary.failed).toBe(1);
  });

  test('directory runner fails clearly when no native test files exist', () => {
    writeFileSync(join(tmpDir, 'plain.kern'), 'const name=value value=1');

    const summary = runNativeKernTestRun(tmpDir);

    expect(summary.testFiles).toEqual([]);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(1);
    expect(formatNativeKernTestRunSummary(summary)).toContain('No native KERN test files found.');
  });

  test('directory runner can pass when no native test files exist during adoption', () => {
    writeFileSync(join(tmpDir, 'plain.kern'), 'const name=value value=1');

    const summary = runNativeKernTestRun(tmpDir, { passWithNoTests: true });

    expect(summary.testFiles).toEqual([]);
    expect(summary.total).toBe(0);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(formatNativeKernTestRunSummary(summary)).toContain('0 passed, 0 warnings, 0 failed, 0 total');
  });
});
