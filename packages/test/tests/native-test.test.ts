import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  discoverNativeKernTestFiles,
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
    expect(summary.results[2].message).toContain('performs database effect without guard/auth/validate');
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
    expect(summary.results[4].message).toContain('performs database effect without auth');
    expect(summary.results[5].message).toContain("path param 'id' is not declared, validated, or guarded");
    expect(summary.results[6].message).toContain('side-effect handler without cleanup');
    expect(summary.results[7].message).toContain('async handler without recover');
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

  test('directory runner fails clearly when no native test files exist', () => {
    writeFileSync(join(tmpDir, 'plain.kern'), 'const name=value value=1');

    const summary = runNativeKernTestRun(tmpDir);

    expect(summary.testFiles).toEqual([]);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(1);
    expect(formatNativeKernTestRunSummary(summary)).toContain('No native KERN test files found.');
  });
});
