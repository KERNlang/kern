import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

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

  test('runs checked-in native conformance examples', () => {
    const examplesDir = join(REPO_ROOT, 'examples/native-test');

    const summary = runNativeKernTestRun(examplesDir);
    const relativeFiles = summary.testFiles.map((file) => relative(REPO_ROOT, file));

    expect(summary.failed).toBe(0);
    expect(summary.total).toBeGreaterThan(0);
    expect(relativeFiles).toEqual(
      expect.arrayContaining([
        'examples/native-test/conformance-arrays.test.kern',
        'examples/native-test/conformance-bad-cases.test.kern',
        'examples/native-test/conformance-classes.test.kern',
        'examples/native-test/conformance-collections.test.kern',
        'examples/native-test/conformance-control-flow.test.kern',
        'examples/native-test/conformance-data-advanced.test.kern',
        'examples/native-test/conformance-effects.test.kern',
        'examples/native-test/conformance-guards.test.kern',
        'examples/native-test/conformance-mocks.test.kern',
        'examples/native-test/conformance-routes.test.kern',
        'examples/native-test/conformance-tools.test.kern',
        'examples/native-test/language-surface.test.kern',
        'examples/native-test/order.test.kern',
      ]),
    );
  });

  test('runs KERNlang native self-contract tests', () => {
    const selfTestDir = join(REPO_ROOT, 'packages/core/native-test');

    const summary = runNativeKernTestRun(selfTestDir);
    const relativeFiles = summary.testFiles.map((file) => relative(REPO_ROOT, file));

    expect(summary.failed).toBe(0);
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.coverage.percent).toBe(100);
    expect(relativeFiles).toEqual(
      expect.arrayContaining([
        'packages/core/native-test/kernlang-bad-cases.test.kern',
        'packages/core/native-test/kernlang-contracts.test.kern',
        'packages/core/native-test/kernlang-schema-bad.test.kern',
      ]),
    );
  });

  test('passes positive invariant assertions against intentionally bad KERN', () => {
    writeFileSync(
      join(tmpDir, 'bad.kern'),
      [
        'interface name=User',
        'interface name=User',
        'derive name=cycleA expr={{cycleB + 1}}',
        'derive name=cycleB expr={{cycleA + 1}}',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'bad.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Bad target" target="./bad.kern"',
        '  it name="detects expected native failures"',
        '    expect has=duplicateNames count=1 matches="User"',
        '    expect has=deriveCycles count=1 matches="cycleA.*cycleB|cycleB.*cycleA"',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(2);
    expect(summary.results.map((result) => result.ruleId)).toEqual(['has:duplicatenames', 'has:derivecycles']);
  });

  test('fails positive invariant assertions with incorrect expected counts', () => {
    writeFileSync(
      join(tmpDir, 'bad-count.kern'),
      ['interface name=User', 'interface name=User', 'interface name=Team', 'interface name=Team'].join('\n'),
    );
    const testFile = join(tmpDir, 'bad-count.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Bad count" target="./bad-count.kern"',
        '  it name="detects changed bad-case cardinality"',
        '    expect has=duplicateNames count=1 matches="User"',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].ruleId).toBe('has:duplicatenames');
    expect(summary.results[0].message).toContain('count 1, found 2');
  });

  test('rejects invalid positive invariant counts', () => {
    writeFileSync(join(tmpDir, 'valid-count.kern'), 'const name=ok value=true');
    const testFile = join(tmpDir, 'invalid-count.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Invalid count" target="./valid-count.kern"',
        '  it name="rejects negative count"',
        '    expect has=deriveCycles count=-1',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain('count must be a non-negative integer');
  });

  test('fails positive invariant assertions for unsupported invariants', () => {
    writeFileSync(join(tmpDir, 'valid.kern'), 'const name=ok value=true');
    const testFile = join(tmpDir, 'unknown.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Unknown invariant" target="./valid.kern"',
        '  it name="rejects unknown has"',
        '    expect has=notARealInvariant',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].ruleId).toBe('has:notarealinvariant');
    expect(summary.results[0].message).toContain('Unsupported native invariant');
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

  test('executes native array data bindings in runtime assertions', () => {
    writeFileSync(
      join(tmpDir, 'arrays.kern'),
      [
        'const name=users value={{[{ id: "u1", name: "Ada", active: true, role: "admin", score: 3, tags: ["core", "ops"] }, { id: "u2", name: "Grace", active: false, role: "member", score: 9, tags: ["api"] }, { id: "u3", name: "Lin", active: true, role: "member", score: 4, tags: ["lang"] }]}}',
        'const name=roles value={{["admin", "member", "admin"]}}',
        'const name=maybeValues value={{[0, "kern", false, "test", null]}}',
        'const name=nestedTags value={{[["core"], ["test", "guard"]]}}',
        'filter name=activeUsers in=users item=user where="user.active"',
        'map name=activeNames in=activeUsers item=user expr="user.name"',
        'find name=adminUser in=users item=user where="user.role === \'admin\'"',
        'some name=hasInactive in=users item=user where="!user.active"',
        'every name=activeHaveNames in=activeUsers item=user where="user.name.length > 0"',
        'findIndex name=linIndex in=users item=user where="user.name === \'Lin\'"',
        'reduce name=totalActiveScore in=activeUsers acc=sum item=user initial=0 expr="sum + user.score"',
        'slice name=firstTwo in=users start=0 end=2',
        'flatMap name=activeTags in=activeUsers item=user expr="user.tags"',
        'flat name=flatTags in=nestedTags',
        'at name=lastUser in=users index=-1',
        'sort name=scoreAsc in=users a=left b=right compare="left.score - right.score"',
        'reverse name=reverseActiveNames in=activeNames',
        'join name=activeCsv in=activeNames separator=","',
        'includes name=hasAda in=activeNames value="\'Ada\'"',
        'indexOf name=adaIndex in=activeNames value="\'Ada\'"',
        'lastIndexOf name=lastAdminRole in=roles value="\'admin\'"',
        'concat name=namesWithGuest in=activeNames with="[\'Guest\']"',
        'compact name=truthyValues in=maybeValues',
        'pluck name=userIds in=users prop=id',
        'unique name=uniqueRoles in=roles',
        'derive name=arraySummary expr={{activeUsers.length + ":" + activeCsv + ":" + totalActiveScore}}',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'arrays.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Array data bindings" target="./arrays.kern"',
        '  it name="executes KERN array primitives before codegen"',
        '    expect expr={{activeNames}} equals={{["Ada", "Lin"]}}',
        '    expect expr={{adminUser.id}} equals="u1"',
        '    expect expr={{hasInactive && activeHaveNames && linIndex === 2}}',
        '    expect expr={{totalActiveScore}} equals=7',
        '    expect expr={{firstTwo.map((user) => user.id)}} equals={{["u1", "u2"]}}',
        '    expect expr={{activeTags}} equals={{["core", "ops", "lang"]}}',
        '    expect expr={{flatTags}} equals={{["core", "test", "guard"]}}',
        '    expect expr={{lastUser.id}} equals="u3"',
        '    expect expr={{scoreAsc.map((user) => user.id)}} equals={{["u1", "u3", "u2"]}}',
        '    expect expr={{reverseActiveNames}} equals={{["Lin", "Ada"]}}',
        '    expect expr={{activeCsv}} equals="Ada,Lin"',
        '    expect expr={{hasAda && adaIndex === 0 && lastAdminRole === 2}}',
        '    expect expr={{namesWithGuest}} equals={{["Ada", "Lin", "Guest"]}}',
        '    expect expr={{truthyValues}} equals={{["kern", "test"]}}',
        '    expect expr={{userIds}} equals={{["u1", "u2", "u3"]}}',
        '    expect expr={{uniqueRoles}} equals={{["admin", "member"]}}',
        '    expect derive=arraySummary equals="2:Ada,Lin:7"',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(17);
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

  test('executes behavioral fn assertions with scoped fixtures', () => {
    writeFileSync(
      join(tmpDir, 'orders.kern'),
      [
        'fn name=orderSubtotal returns=number',
        '  param name=order type=object',
        '  handler <<<',
        '    return order.items.reduce((sum, item) => sum + item.price * item.qty, 0);',
        '  >>>',
        'fn name=addTax returns=number',
        '  param name=subtotal type=number',
        '  param name=rate type=number',
        '  handler <<<',
        '    return subtotal * (1 + rate);',
        '  >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'orders.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order behavior" target="./orders.kern"',
        '  fixture name=paidOrder value={{({ items: [{ price: 20, qty: 2 }, { price: 5, qty: 1 }] })}}',
        '  describe name="totals"',
        '    fixture name=taxRate value=0.2',
        '    it name="calculates subtotal and tax"',
        '      expect fn=orderSubtotal with=paidOrder equals=45',
        '      expect fn=addTax args={{[orderSubtotal(paidOrder), taxRate]}} equals=54',
        '      expect expr={{paidOrder.items.length}} equals=2',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(3);
    expect(summary.results.map((result) => result.ruleId)).toEqual(['runtime:behavior', 'runtime:behavior', 'expr']);
    expect(summary.results.map((result) => result.assertion)).toContain('fn orderSubtotal with paidOrder equals 45');
    expect(summary.results.map((result) => result.assertion)).toContain(
      'fn addTax args [orderSubtotal(paidOrder), taxRate] equals 54',
    );
  });

  test('executes behavioral derive assertions with fixtures', () => {
    writeFileSync(
      join(tmpDir, 'cart.kern'),
      [
        'fn name=sumItems returns=number',
        '  param name=items type="object[]"',
        '  handler <<<',
        '    return items.reduce((sum, item) => sum + item.price * item.qty, 0);',
        '  >>>',
        'derive name=subtotal expr={{sumItems(cart.items)}}',
        'derive name=total expr={{subtotal * (1 + taxRate)}}',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'cart.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Cart derives" target="./cart.kern"',
        '  fixture name=cart value={{({ items: [{ price: 10, qty: 3 }] })}}',
        '  fixture name=taxRate value=0.1',
        '  it name="computes derived totals"',
        '    expect derive=subtotal equals=30',
        '    expect derive=total equals=33',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(2);
    expect(summary.results.map((result) => result.assertion)).toContain('derive subtotal equals 30');
    expect(summary.results.map((result) => result.assertion)).toContain('derive total equals 33');
  });

  test('executes portable route workflow assertions with request input', () => {
    writeFileSync(
      join(tmpDir, 'users.kern'),
      [
        'const name=users value={{[{ id: "u1", name: "Ada", role: "admin", active: true }, { id: "u2", name: "Grace", role: "member", active: true }, { id: "u3", name: "Lin", role: "member", active: false }]}}',
        'server name=UsersAPI',
        '  route GET /api/users',
        '    params role:string',
        '    derive visible expr={{users.filter((user) => user.active)}}',
        '    branch name=roleSelection on=query.role',
        '      path value="admin"',
        '        collect name=result from=visible where={{item.role === "admin"}}',
        '        respond 200 json=result',
        '      path value="member"',
        '        collect name=result from=visible where={{item.role === "member"}}',
        '        respond 200 json=result',
        '    respond 200 json=visible',
        '  route GET /api/users/:id',
        '    derive user expr={{users.find((item) => item.id === params.id)}}',
        '    guard name=exists expr={{user}} else=404',
        '    respond 200 json=user',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'users.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="User route workflows" target="./users.kern"',
        '  it name="filters collection routes before codegen"',
        '    expect route="GET /api/users" with={{({ query: { role: "member" } })}} returns={{[{ id: "u2", name: "Grace", role: "member", active: true }]}}',
        '    expect route="GET /api/users" with={{({ query: { role: "guest" } })}} returns={{[{ id: "u1", name: "Ada", role: "admin", active: true }, { id: "u2", name: "Grace", role: "member", active: true }]}}',
        '  it name="checks path-param guard results"',
        '    expect route="GET /api/users/:id" with={{({ params: { id: "u1" } })}} returns={{({ id: "u1", name: "Ada", role: "admin", active: true })}}',
        '    expect route="GET /api/users/:id" with={{({ params: { id: "missing" } })}} returns={{({ status: 404 })}}',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(4);
    expect(summary.results.every((result) => result.ruleId === 'runtime:route')).toBe(true);
  });

  test('expands table-driven native cases for runtime assertions', () => {
    writeFileSync(
      join(tmpDir, 'table-users.kern'),
      [
        'const name=users value={{[{ id: "u1", name: "Ada", role: "admin", active: true }, { id: "u2", name: "Grace", role: "member", active: true }]}}',
        'fn name=pickName returns=string',
        '  param name=user type=object',
        '  handler <<<',
        '    return user.name;',
        '  >>>',
        'server name=UsersAPI',
        '  route GET /api/users',
        '    params role:string',
        '    branch name=roleSelection on=query.role',
        '      path value="admin"',
        '        collect name=result from=users where={{item.role === "admin"}}',
        '        respond 200 json=result',
        '      path value="member"',
        '        collect name=result from=users where={{item.role === "member"}}',
        '        respond 200 json=result',
        '    respond 200 json=users',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'table-users.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Table cases" target="./table-users.kern"',
        '  fixture name=ada value={{({ name: "Ada" })}}',
        '  it name="routes reuse one expect across cases"',
        '    case name=admin with={{({ query: { role: "admin" } })}} returns={{[{ id: "u1", name: "Ada", role: "admin", active: true }]}}',
        '    case name=member with={{({ query: { role: "member" } })}} returns={{[{ id: "u2", name: "Grace", role: "member", active: true }]}}',
        '    expect route="GET /api/users"',
        '  it name="expect-local cases override inputs"',
        '    expect fn=pickName',
        '      case name=fixture with={{ada}} equals="Ada"',
        '      case name=inline with={{({ name: "Lin" })}} equals="Lin"',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(4);
    expect(summary.results.map((result) => result.caseName)).toEqual([
      'routes reuse one expect across cases > admin',
      'routes reuse one expect across cases > member',
      'expect-local cases override inputs > fixture',
      'expect-local cases override inputs > inline',
    ]);
    expect(summary.results.map((result) => result.ruleId)).toEqual([
      'runtime:route',
      'runtime:route',
      'runtime:behavior',
      'runtime:behavior',
    ]);
  });

  test('executes deterministic effect and recover assertions before codegen', () => {
    writeFileSync(
      join(tmpDir, 'effects.kern'),
      [
        'const name=cachedUsers value={{[{ id: "u1", active: true }]}}',
        'effect name=loadUsers',
        '  trigger expr={{cachedUsers}}',
        '  recover fallback={{[]}}',
        'effect name=loadFallback',
        '  trigger expr={{JSON.parse("not-json")}}',
        '  recover retry=2 fallback={{[]}}',
        'effect name=loadBroken',
        '  trigger expr={{JSON.parse("not-json")}}',
        'server name=UsersAPI',
        '  route GET /api/users',
        '    effect name=fetchUsers',
        '      trigger expr={{JSON.parse("not-json")}}',
        '      recover retry=2 fallback={{[]}}',
        '    respond 200 json=fetchUsers.result',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'effects.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Effect workflows" target="./effects.kern"',
        '  it name="runs effect result and recovery"',
        '    expect effect=loadUsers returns={{cachedUsers}}',
        '    expect effect=loadFallback recovers=true fallback={{[]}}',
        '    expect effect=loadBroken throws=SyntaxError',
        '  it name="routes can recover effect results"',
        '    expect route="GET /api/users" returns={{[]}}',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(4);
    expect(summary.results.map((result) => result.ruleId)).toEqual([
      'runtime:effect',
      'runtime:effect',
      'runtime:effect',
      'runtime:route',
    ]);
  });

  test('effect recovery mismatches include first runtime value difference', () => {
    writeFileSync(
      join(tmpDir, 'effect-diff.kern'),
      [
        'effect name=loadFallback',
        '  trigger expr={{JSON.parse("not-json")}}',
        '  recover retry=2 fallback={{[]}}',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'effect-diff.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Effect diff" target="./effect-diff.kern"',
        '  it name="explains recovered mismatch"',
        '    expect effect=loadFallback recovers=true fallback={{[{ id: "u1" }]}}',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain('Runtime effect loadFallback expected');
    expect(summary.results[0].message).toContain('diff: at $[0]: missing item');
  });

  test('uses scoped native mocks for effect and route workflow assertions', () => {
    writeFileSync(
      join(tmpDir, 'mocked-effects.kern'),
      [
        'effect name=loadUsers',
        '  trigger query="SELECT * FROM users"',
        'server name=UsersAPI',
        '  route GET /api/users',
        '    effect name=fetchUsers',
        '      trigger url="/api/users"',
        '    respond 200 json=fetchUsers.result',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'mocked-effects.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Mocked effect workflows" target="./mocked-effects.kern"',
        '  fixture name=users value={{[{ id: "u1", name: "Ada" }]}}',
        '  it name="mocks top-level effect boundaries"',
        '    mock effect=loadUsers returns={{users}}',
        '    expect effect=loadUsers returns={{users}}',
        '    expect mock=loadUsers called=1',
        '  it name="mocks route-local effect boundaries"',
        '    mock effect=fetchUsers returns={{users}}',
        '    expect route="GET /api/users" returns={{users}}',
        '    expect mock=fetchUsers called=1',
        '  it name="mocks top-level effect failures"',
        '    mock effect=loadUsers throws=NetworkError',
        '    expect effect=loadUsers throws=NetworkError',
        '    expect mock=loadUsers called=1',
        '  it name="mocks route-local effect failures"',
        '    mock effect=fetchUsers throws=NetworkError',
        '    expect route="GET /api/users" throws=NetworkError',
        '    expect mock=fetchUsers called=1',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(8);
    expect(summary.results.map((result) => result.ruleId)).toEqual([
      'runtime:effect',
      'mock:called',
      'runtime:route',
      'mock:called',
      'runtime:effect',
      'mock:called',
      'runtime:route',
      'mock:called',
    ]);
  });

  test('counts mocked effect calls from actually executed route branches', () => {
    writeFileSync(
      join(tmpDir, 'branch-mocked-effects.kern'),
      [
        'server name=UsersAPI',
        '  route GET /api/users',
        '    params role:string',
        '    branch name=byRole on={{query.role}}',
        '      path value=admin',
        '        effect name=fetchUsers',
        '          trigger url="/api/users"',
        '        respond 200 json=fetchUsers.result',
        '      path value=guest',
        '        respond 200 json={{[]}}',
        '    respond 200 json={{[]}}',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'branch-mocked-effects.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Branch mock calls" target="./branch-mocked-effects.kern"',
        '  fixture name=users value={{[{ id: "u1", role: "admin" }]}}',
        '  it name="counts branch-local calls"',
        '    mock effect=fetchUsers returns={{users}}',
        '    expect route="GET /api/users" with={{({ query: { role: "guest" } })}} returns={{[]}}',
        '    expect mock=fetchUsers called=0',
        '    expect route="GET /api/users" with={{({ query: { role: "admin" } })}} returns={{users}}',
        '    expect mock=fetchUsers called=1',
        '    expect route="GET /api/users" with={{({ query: { role: "admin" } })}} returns={{users}}',
        '    expect mock=fetchUsers called=2',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.results.map((result) => result.ruleId)).toEqual([
      'runtime:route',
      'mock:called',
      'runtime:route',
      'mock:called',
      'runtime:route',
      'mock:called',
    ]);
  });

  test('executes native MCP tool workflow assertions with mocks and param defaults', () => {
    writeFileSync(
      join(tmpDir, 'tool-workflows.kern'),
      [
        'mcp name=Files',
        '  tool name=readFile',
        '    param name=filePath type=string required=true',
        '    effect name=readDisk',
        '      trigger url="/fs/read"',
        '    respond 200 json=readDisk.result',
        '  tool name=findUsers',
        '    param name=role type=string value="member"',
        '    derive users expr={{[{ id: "u1", role: "admin" }, { id: "u2", role: "member" }]}}',
        '    branch name=byRole on={{role}}',
        '      path value=admin',
        '        collect name=filtered from=users where={{item.role === "admin"}}',
        '        respond 200 json=filtered',
        '      path value=member',
        '        collect name=filtered from=users where={{item.role === "member"}}',
        '        respond 200 json=filtered',
        '    respond 200 json=users',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'tool-workflows.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Tool workflows" target="./tool-workflows.kern"',
        '  fixture name=fileBody value={{"hello"}}',
        '  it name="mocks tool-local effects"',
        '    mock effect=readDisk returns={{fileBody}}',
        '    expect tool=readFile with={{({ filePath: "/data/a.txt" })}} returns={{fileBody}}',
        '    expect mock=readDisk called=1',
        '  it name="runs declarative tool branches"',
        '    expect tool=findUsers with={{({ role: "admin" })}} returns={{[{ id: "u1", role: "admin" }]}}',
        '    expect tool=findUsers returns={{[{ id: "u2", role: "member" }]}}',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.results.map((result) => result.ruleId)).toEqual([
      'runtime:tool',
      'mock:called',
      'runtime:tool',
      'runtime:tool',
    ]);
  });

  test('executes safe handler-backed route and tool assertions', () => {
    writeFileSync(
      join(tmpDir, 'handler-workflows.kern'),
      [
        'const name=users value={{[{ id: "u1", role: "admin" }, { id: "u2", role: "member" }]}}',
        'server name=Api',
        '  route GET /api/users',
        '    handler <<<',
        '      if (query.role) return users.filter((user) => user.role === query.role);',
        '      return users;',
        '    >>>',
        '  route GET /api/users/:id',
        '    handler <<<',
        '      return users.find((user) => user.id === id);',
        '    >>>',
        'mcp name=Tools',
        '  tool name=readUser',
        '    param name=id type=string',
        '    handler <<<',
        '      return users.find((user) => user.id === id);',
        '    >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'handler-workflows.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Handler workflows" target="./handler-workflows.kern"',
        '  it name="runs safe route handlers"',
        '    expect route="GET /api/users" with={{({ query: { role: "admin" } })}} returns={{[{ id: "u1", role: "admin" }]}}',
        '    expect route="GET /api/users/:id" with={{({ params: { id: "u2" } })}} returns={{({ id: "u2", role: "member" })}}',
        '  it name="runs safe tool handlers"',
        '    expect tool=readUser with={{({ id: "u1" })}} returns={{({ id: "u1", role: "admin" })}}',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.results.map((result) => result.ruleId)).toEqual(['runtime:route', 'runtime:route', 'runtime:tool']);
  });

  test('rejects unsafe handler-backed workflow assertions before execution', () => {
    writeFileSync(
      join(tmpDir, 'unsafe-handler.kern'),
      [
        'mcp name=Files',
        '  tool name=readSecret',
        '    handler <<<',
        '      return process.env.SECRET;',
        '    >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'unsafe-handler.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Unsafe handler" target="./unsafe-handler.kern"',
        '  it name="rejects unsafe handler globals"',
        '    expect tool=readSecret returns={{"secret"}} severity=warn',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].ruleId).toBe('runtime:tool');
    expect(summary.results[0].severity).toBe('error');
    expect(summary.results[0].message).toContain('Runtime tool assertion cannot execute handler');
    expect(summary.results[0].message).toContain("unsupported token 'process'");
  });

  test('tool assertion failures include runtime expression context', () => {
    writeFileSync(
      join(tmpDir, 'tool-context.kern'),
      ['mcp name=Files', '  tool name=listUsers', '    respond 200 json={{[]}}'].join('\n'),
    );
    const testFile = join(tmpDir, 'tool-context.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Tool failure context" target="./tool-context.kern"',
        '  fixture name=users value={{[{ id: "u1" }]}}',
        '  it name="shows context"',
        '    expect tool=listUsers returns={{users}}',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain('expression: __kernTool_');
    expect(summary.results[0].message).toContain('fixtures: users, __kernTool_');
    expect(summary.results[0].message).toContain('diff: at $[0]: missing item');
  });

  test('executes native guard kinds in route and tool workflows', () => {
    writeFileSync(
      join(tmpDir, 'guard-runtime.kern'),
      [
        'mcp name=SafeTools',
        '  tool name=readFile',
        '    param name=filePath type=string required=true',
        '    guard type=pathContainment param=filePath allowlist="/data"',
        '    respond 200 json=filePath',
        '  tool name=search',
        '    param name=query type=string required=true',
        '    guard type=sanitize param=query pattern="[<>]" replacement=""',
        '    respond 200 json=query',
        '  tool name=listUsers',
        '    param name=limit type=number value=10',
        '    guard type=validate param=limit min=1 max=25',
        '    respond 200 json=limit',
        '  tool name=upload',
        '    param name=payload type=string required=true',
        '    guard type=sizeLimit param=payload maxBytes=4',
        '    respond 200 json=payload',
        '  tool name=secret',
        '    param name=token type=string required=false',
        '    guard type=auth param=token',
        '    respond 200 json={{"ok"}}',
        'server name=Api',
        '  route GET /items/:id',
        '    guard type=validate param=id regex="^item-"',
        '    respond 200 json=id',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'guard-runtime.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Guard runtime" target="./guard-runtime.kern"',
        '  it name="runs guard semantics before tool response"',
        '    expect tool=readFile with={{({ filePath: "/data/a.txt" })}} returns={{"/data/a.txt"}}',
        '    expect tool=readFile with={{({ filePath: "/etc/passwd" })}} throws=PathContainmentError',
        '    expect tool=search with={{({ query: "<hello>" })}} returns={{"hello"}}',
        '    expect tool=listUsers with={{({ limit: 20 })}} returns=20',
        '    expect tool=listUsers with={{({ limit: 99 })}} throws=ValidationError',
        '    expect tool=upload with={{({ payload: "12345" })}} throws=SizeLimitError',
        '    expect tool=secret with={{({ token: "ok" })}} returns={{"ok"}}',
        '    expect tool=secret with={{({})}} throws=AuthError',
        '  it name="runs guard semantics before route response"',
        '    expect route="GET /items/:id" with={{({ params: { id: "item-1" } })}} returns={{"item-1"}}',
        '    expect route="GET /items/:id" with={{({ params: { id: "bad" } })}} throws=ValidationError',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.results.map((result) => result.ruleId)).toEqual([
      'runtime:tool',
      'runtime:tool',
      'runtime:tool',
      'runtime:tool',
      'runtime:tool',
      'runtime:tool',
      'runtime:tool',
      'runtime:tool',
      'runtime:route',
      'runtime:route',
    ]);
  });

  test('reports undeclared native mock call-count assertions as configuration failures', () => {
    writeFileSync(join(tmpDir, 'undeclared-mock.kern'), ['effect name=loadUsers', '  trigger expr={{[]}}'].join('\n'));
    const testFile = join(tmpDir, 'undeclared-mock.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Undeclared mock" target="./undeclared-mock.kern"',
        '  it name="expects undeclared mock calls"',
        '    expect mock=loadUsers called=1',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].ruleId).toBe('mock:called');
    expect(summary.results[0].message).toContain('Runtime mock assertion target not found: loadUsers');
  });

  test('route assertion failures include runtime expression context', () => {
    writeFileSync(
      join(tmpDir, 'route-context.kern'),
      ['server name=UsersAPI', '  route GET /api/users', '    respond 200 json={{[]}}'].join('\n'),
    );
    const testFile = join(tmpDir, 'route-context.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Route failure context" target="./route-context.kern"',
        '  fixture name=users value={{[{ id: "u1" }]}}',
        '  it name="shows context"',
        '    expect route="GET /api/users" returns={{users}}',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);
    const output = formatNativeKernTestSummary(summary);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain('expression: __kernRoute_');
    expect(summary.results[0].message).toContain('fixtures: users, __kernRoute_');
    expect(summary.results[0].message).toContain('diff: at $[0]: missing item');
    expect(output).toContain('\n  diff: at $[0]: missing item');
  });

  test('reports mocked effect call-count mismatches without duplicate unused-mock noise', () => {
    writeFileSync(join(tmpDir, 'count-mismatch.kern'), ['effect name=loadUsers', '  trigger expr={{[]}}'].join('\n'));
    const testFile = join(tmpDir, 'count-mismatch.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Mock count mismatch" target="./count-mismatch.kern"',
        '  it name="expects call that never happened"',
        '    mock effect=loadUsers returns={{[]}}',
        '    expect mock=loadUsers called=1',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.results[0].ruleId).toBe('mock:called');
    expect(summary.results[0].message).toContain('expected called=1, received called=0');
  });

  test('reports unused scoped native effect mocks', () => {
    writeFileSync(join(tmpDir, 'unused-mock.kern'), ['effect name=loadUsers', '  trigger expr={{[]}}'].join('\n'));
    const testFile = join(tmpDir, 'unused-mock.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Unused mock" target="./unused-mock.kern"',
        '  it name="declares dead mock"',
        '    mock effect=loadUsers returns={{[]}}',
        '    expect expr={{true}}',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.results[1].ruleId).toBe('mock:unused');
    expect(summary.results[1].message).toContain('effect=loadUsers');
  });

  test('fixture scope does not leak between sibling test cases', () => {
    writeFileSync(
      join(tmpDir, 'math.kern'),
      [
        'fn name=identity returns=number',
        '  param name=value type=number',
        '  handler <<<',
        '    return value;',
        '  >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'math.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Fixture scopes" target="./math.kern"',
        '  it name="has local value"',
        '    fixture name=amount value=7',
        '    expect fn=identity with=amount equals=7',
        '  it name="does not see sibling fixture"',
        '    expect fn=identity with=amount equals=7',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.passed).toBe(1);
    expect(summary.results[1].message).toContain('amount is not defined');
  });

  test('executes multi-statement fn handlers in behavioral assertions', () => {
    writeFileSync(
      join(tmpDir, 'totals.kern'),
      [
        'fn name=discountedTotal returns=number',
        '  param name=order type=object',
        '  handler <<<',
        '    const subtotal = order.items.reduce((sum, item) => sum + item.price * item.qty, 0);',
        '    if (subtotal >= 50) {',
        '      return subtotal * 0.9;',
        '    }',
        '    return subtotal;',
        '  >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'totals.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Multi statement functions" target="./totals.kern"',
        '  fixture name=order value={{({ items: [{ price: 30, qty: 2 }] })}}',
        '  it name="executes function body"',
        '    expect fn=discountedTotal with=order equals=54',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(1);
  });

  test('executes const handler values, safe while loops, recursion, and TS-only syntax', () => {
    writeFileSync(
      join(tmpDir, 'agon-runtime.kern'),
      [
        'const name=DANGEROUS_COMMANDS type="string[]"',
        '  handler <<<',
        '    [',
        "      'rm -rf /',",
        "      'sudo ',",
        '    ] as const',
        '  >>>',
        'const name=SAFE_SHELL_WRAPPERS value={{ ["time", "timeout"] }}',
        'fn name=stripShellWrappers params="command:string" returns=string',
        '  handler <<<',
        '    let cmd = command.trim();',
        '    let changed = true;',
        '    while (changed) {',
        '      changed = false;',
        '      for (const wrapper of SAFE_SHELL_WRAPPERS) {',
        "        if (cmd.startsWith(wrapper + ' ')) {",
        '          cmd = cmd.slice(wrapper.length + 1).trim();',
        '          changed = true;',
        '        }',
        '      }',
        '    }',
        '    return cmd;',
        '  >>>',
        'fn name=isDangerousCommand params="command:string" returns=boolean',
        '  handler <<<',
        '    const lower: string = command.toLowerCase().trim();',
        '    return (DANGEROUS_COMMANDS as string[]).some((dangerous: string) => lower.includes(dangerous));',
        '  >>>',
        'fn name=isReadOnlyCommand params="command:string" returns=boolean',
        '  handler <<<',
        "    const stripped = stripShellWrappers(command).replace(/\\s+\\d*(?:>>?|<<?)\\s*\\S+/g, '').trim();",
        "    if (stripped.includes('|')) {",
        "      const parts = stripped.split('|').map((p: string) => p.trim());",
        '      return parts.every((p: string) => p && isReadOnlyCommand(p));',
        '    }',
        "    return stripped === 'cat file.txt' || stripped === 'grep pattern' || stripped === 'npm test';",
        '  >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'agon-runtime.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="AGON runtime surface" target="./agon-runtime.kern"',
        '  it name="runs AGON-style safe helpers"',
        '    expect expr={{DANGEROUS_COMMANDS.includes("rm -rf /")}}',
        '    expect fn=stripShellWrappers args={{["time timeout npm test"]}} equals="npm test"',
        '    expect fn=isDangerousCommand args={{["sudo rm file"]}} equals=true',
        '    expect fn=isReadOnlyCommand args={{["cat file.txt | grep pattern"]}} equals=true',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(4);
  });

  test('executes async fn handlers and awaited runtime expr assertions', () => {
    writeFileSync(
      join(tmpDir, 'async.kern'),
      [
        'fn name=loadTotal async=true returns=number',
        '  param name=amount type=number',
        '  handler <<<',
        '    const loaded = await Promise.resolve(amount);',
        '    return loaded + 5;',
        '  >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'async.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Async functions" target="./async.kern"',
        '  fixture name=amount value=7',
        '  it name="awaits behavior"',
        '    expect fn=loadTotal with=amount equals=12',
        '    expect expr={{await loadTotal(amount)}} equals=12',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(2);
  });

  test('supports throws assertions for sync and async behavioral functions', () => {
    writeFileSync(
      join(tmpDir, 'throws.kern'),
      [
        'fn name=requirePaid returns=boolean',
        '  param name=order type=object',
        '  handler <<<',
        '    if (order.status !== "paid") {',
        '      throw new TypeError("order is not paid");',
        '    }',
        '    return true;',
        '  >>>',
        'fn name=rejectLater async=true returns=boolean',
        '  handler <<<',
        '    await Promise.resolve(true);',
        '    throw new RangeError("async rejection");',
        '  >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'throws.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Throws behavior" target="./throws.kern"',
        '  fixture name=draftOrder value={{({ status: "draft" })}}',
        '  it name="checks sync and async failures"',
        '    expect fn=requirePaid with=draftOrder throws=TypeError',
        '    expect fn=rejectLater throws=RangeError',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(2);
  });

  test('behavioral assertion failures show call expression and fixture names', () => {
    writeFileSync(
      join(tmpDir, 'diagnostics.kern'),
      [
        'fn name=double returns=number',
        '  param name=value type=number',
        '  handler <<<',
        '    return value * 2;',
        '  >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'diagnostics.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Behavior diagnostics" target="./diagnostics.kern"',
        '  fixture name=amount value=4',
        '  it name="explains mismatch"',
        '    expect fn=double with=amount equals=9',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain('double(amount)');
    expect(summary.results[0].message).toContain('fixtures: amount');
    expect(summary.results[0].message).toContain('received 8');
    expect(summary.results[0].message).toContain('diff: at $: expected 9, received 8');
  });

  test('rejects unsafe tokens inside behavioral fn handlers before execution', () => {
    writeFileSync(
      join(tmpDir, 'unsafe-fn.kern'),
      ['fn name=readEnv returns=string', '  handler <<<', '    return process.env.SECRET;', '  >>>'].join('\n'),
    );
    const testFile = join(tmpDir, 'unsafe-fn.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Unsafe behavior" target="./unsafe-fn.kern"',
        '  it name="blocks process access"',
        '    expect fn=readEnv equals="secret"',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain("target binding 'readEnv': unsupported token 'process'");
  });

  test('rejects unsafe tokens inside runtime class methods before execution', () => {
    writeFileSync(
      join(tmpDir, 'unsafe-class.kern'),
      [
        'class name=Leaky',
        '  method name=secret returns=string',
        '    handler <<<',
        '      return process.env.SECRET;',
        '    >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'unsafe-class.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Unsafe class behavior" target="./unsafe-class.kern"',
        '  it name="blocks process access"',
        '    expect expr={{new Leaky().secret()}} equals="secret"',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain("target binding 'Leaky': unsupported token 'process'");
  });

  test('fails destructure runtime assertions when the source binding is missing', () => {
    writeFileSync(
      join(tmpDir, 'broken-destructure.kern'),
      ['destructure kind=const source=missingUsers', '  element name=firstUser index=0'].join('\n'),
    );
    const testFile = join(tmpDir, 'broken-destructure.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Broken destructure" target="./broken-destructure.kern"',
        '  it name="reports missing source"',
        '    expect expr={{firstUser.id}} equals="u1"',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain('missingUsers is not defined');
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

  test('asserts machine transitions and constrained reachability paths', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=confirmed',
        '  state name=paid',
        '  state name=refunded',
        '  state name=cancelled',
        '  transition name=confirm from=pending to=confirmed',
        '  transition name=capture from=confirmed to=paid guard="entity.confirmed === true"',
        '  transition name=refund from=paid to=refunded',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order machine shape" target="./order.kern"',
        '  it name="declares guarded capture transition"',
        '    expect machine=Order transition=capture from=confirmed to=paid guarded=true',
        '  it name="declares unguarded refund transition"',
        '    expect machine=Order transition=refund from=paid to=refunded guarded=false',
        '  it name="can start reachability from a non-initial state"',
        '    expect machine=Order from=confirmed reaches=paid via=capture',
        '  it name="happy path passes through paid without refund"',
        '    expect machine=Order reaches=refunded via=confirm,capture,refund through=paid avoid=cancelled maxSteps=3',
        '  it name="finds constrained path without explicit transitions"',
        '    expect machine=Order from=confirmed reaches=refunded through=confirmed,paid avoids=cancelled maxSteps=2',
        '  it name="allows zero-step reachability when start is target"',
        '    expect machine=Order from=paid reaches=paid maxSteps=0',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(6);
    expect(summary.results.map((result) => result.ruleId)).toEqual([
      'machine:transition',
      'machine:transition',
      'machine:reaches',
      'machine:reaches',
      'machine:reaches',
      'machine:reaches',
    ]);
  });

  test('fails constrained machine assertions with KERN-level messages', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=confirmed',
        '  state name=paid',
        '  transition name=confirm from=pending to=confirmed',
        '  transition name=capture from=confirmed to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order machine shape" target="./order.kern"',
        '  it name="catches transition drift"',
        '    expect machine=Order transition=capture from=pending to=paid guarded=true',
        '  it name="catches forbidden path states"',
        '    expect machine=Order reaches=paid via=confirm,capture avoid=confirmed',
        '  it name="catches too-long paths"',
        '    expect machine=Order reaches=paid via=confirm,capture maxSteps=1',
        '  it name="catches unknown start states"',
        '    expect machine=Order from=missing reaches=paid',
        '  it name="catches avoided start states"',
        '    expect machine=Order from=confirmed reaches=paid avoid=confirmed',
        '  it name="catches invalid max step values"',
        '    expect machine=Order reaches=paid maxSteps=-1',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(6);
    expect(summary.results[0].ruleId).toBe('machine:transition');
    expect(summary.results[0].message).toContain('did not match constraints');
    expect(summary.results[1].message).toContain('reaches avoided state confirmed');
    expect(summary.results[2].message).toContain('above maxSteps=1');
    expect(summary.results[3].message).toContain('State not found in machine Order: missing');
    expect(summary.results[4].message).toContain('starts at avoided state confirmed');
    expect(summary.results[5].message).toContain('maxSteps must be a non-negative integer');
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

  test('scans target variant guards for exhaustiveness without per-guard expect assertions', () => {
    writeFileSync(
      join(tmpDir, 'payment.kern'),
      [
        'union name=Payment discriminant=kind',
        '  variant name=card',
        '  variant name=paypal',
        '  variant name=wire',
        'union name=Notification discriminant=kind',
        '  variant name=email',
        '  variant name=sms',
        'guard name=ChargeCard kind=variant over=Payment covers=card,paypal',
        'guard name=InferPayment kind=variant covers=card,paypal',
        'guard name=VerifyPayment kind=variant over=Payment covers=card,paypal,wire',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'payment.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Payment guard surface" target="./payment.kern"',
        '  it name="all variant guards stay exhaustive"',
        '    expect no=nonExhaustiveGuards',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].ruleId).toBe('no:nonexhaustiveguards');
    expect(summary.results[0].message).toContain('guard ChargeCard');
    expect(summary.results[0].message).toContain('guard InferPayment');
    expect(summary.results[0].message).toContain('missing variants: wire');
    expect(summary.results[0].message).not.toContain('VerifyPayment');
  });

  test('infers target union for single-union variant guards', () => {
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
        'test name="Payment guard surface" target="./payment.kern"',
        '  it name="all variant guards stay exhaustive"',
        '    expect no=nonExhaustiveGuards',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain('guard ChargeCard');
    expect(summary.results[0].message).toContain('missing variants: paypal');
  });

  test('reports non-exhaustive guard union resolution failures', () => {
    writeFileSync(
      join(tmpDir, 'payment.kern'),
      [
        'union name=Payment discriminant=kind',
        '  variant name=card',
        '  variant name=paypal',
        'union name=Notification discriminant=kind',
        '  variant name=email',
        '  variant name=sms',
        'guard name=UnknownPayment kind=variant over=Missing covers=card',
        'guard name=AmbiguousVariant kind=variant',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'payment.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Payment guard surface" target="./payment.kern"',
        '  it name="all variant guards stay exhaustive"',
        '    expect no=nonExhaustiveGuards',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].message).toContain('references unknown union Missing');
    expect(summary.results[0].message).toContain('cannot infer union');
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

  test('fails on duplicate routes, empty routes, weak guards, unguarded effects, and raw handlers', () => {
    writeFileSync(
      join(tmpDir, 'api.kern'),
      [
        'server name=Api',
        '  route method=post path=/orders',
        '    handler <<<',
        '      await db.create(input);',
        '    >>>',
        '  route method=post path=/orders',
        '  route method=get path=/empty',
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
        '  it name="routes declare behavior"',
        '    expect no=emptyRoutes',
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

    expect(summary.failed).toBe(6);
    expect(summary.results[0].message).toContain('POST /orders');
    expect(summary.results[1].message).toContain('POST /orders');
    expect(summary.results[1].message).toContain('GET /empty');
    expect(summary.results[2].message).toContain('mutates without schema/validate/guard/auth');
    expect(summary.results[3].message).toContain('performs database query without guard/auth/validate/permission');
    expect(summary.results[4].message).toContain('has expr but no else/handler');
    expect(summary.results[5].message).toContain('Found raw handler escapes');
  });

  test('apiSafety preset includes empty route detection', () => {
    writeFileSync(join(tmpDir, 'api.kern'), ['server name=Api', '  route method=get path=/empty'].join('\n'));
    const testFile = join(tmpDir, 'api.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="API preset safety" target="./api.kern"',
        '  it name="routes are executable"',
        '    expect preset=apiSafety',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.passed).toBe(4);
    expect(summary.results[1].ruleId).toBe('no:emptyroutes');
    expect(summary.results[1].message).toContain('GET /empty');
  });

  test('does not flag routes with portable behavior nodes as empty', () => {
    writeFileSync(
      join(tmpDir, 'api.kern'),
      ['server name=Api', '  route method=get path=/orders', '    derive orders expr={{await db.orders.list()}}'].join(
        '\n',
      ),
    );
    const testFile = join(tmpDir, 'api.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="API behavior" target="./api.kern"',
        '  it name="routes declare executable nodes"',
        '    expect no=emptyRoutes',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(1);
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
    expect(summary.passed).toBe(9);
    expect(summary.results.map((result) => result.ruleId)).toEqual([
      'machine:reaches',
      'no:invalidguards',
      'no:weakguards',
      'no:nonexhaustiveguards',
      'no:untestedtransitions',
      'no:untestedguards',
      'no:untestedroutes',
      'no:untestedtools',
      'no:untestedeffects',
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

  test('does not count failed transition assertions as coverage', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=confirmed',
        '  state name=paid',
        '  transition name=confirm from=pending to=confirmed',
        '  transition name=capture from=confirmed to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order coverage" target="./order.kern"',
        '  it name="declares a broken capture contract"',
        '    expect machine=Order transition=capture from=pending to=paid',
        '  it name="all transitions have tests"',
        '    expect machine=Order no=untestedTransitions',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(2);
    expect(summary.results[0].ruleId).toBe('machine:transition');
    expect(summary.results[1].ruleId).toBe('no:untestedtransitions');
    expect(summary.results[1].message).toContain('Order.confirm');
    expect(summary.results[1].message).toContain('Order.capture');
  });

  test('does not count failed reachability paths as coverage', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=confirmed',
        '  state name=paid',
        '  transition name=confirm from=pending to=confirmed',
        '  transition name=capture from=confirmed to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order coverage" target="./order.kern"',
        '  it name="declares a broken path"',
        '    expect machine=Order reaches=paid via=capture',
        '  it name="all transitions have tests"',
        '    expect machine=Order no=untestedTransitions',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(2);
    expect(summary.results[0].ruleId).toBe('machine:reaches');
    expect(summary.results[1].ruleId).toBe('no:untestedtransitions');
    expect(summary.results[1].message).toContain('Order.confirm');
    expect(summary.results[1].message).toContain('Order.capture');
  });

  test('fails coverage when guards lack explicit workflow or guard-wide assertions', () => {
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
    expect(summary.results[1].message).toContain('route/tool workflow assertion');
    expect(summary.results[1].message).toContain('expect preset=guard');
  });

  test('counts guards executed by route and tool workflow assertions as covered', () => {
    writeFileSync(
      join(tmpDir, 'workflow-guard-coverage.kern'),
      [
        'server name=Api',
        '  route GET /items/:id',
        '    guard type=validate param=id regex="^item-"',
        '    respond 200 json=id',
        'mcp name=Tools',
        '  tool name=search',
        '    param name=query type=string required=true',
        '    guard type=sanitize param=query pattern="[<>]" replacement=""',
        '    respond 200 json=query',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'workflow-guard-coverage.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Workflow guard coverage" target="./workflow-guard-coverage.kern"',
        '  it name="covers guards through workflows"',
        '    expect route="GET /items/:id" with={{({ params: { id: "bad" } })}} throws=ValidationError',
        '    expect tool=search with={{({ query: "<hello>" })}} returns={{"hello"}}',
        '    expect preset=coverage',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.coverage.guards.total).toBe(2);
    expect(summary.coverage.guards.covered).toBe(2);
    expect(summary.coverage.guards.uncovered).toEqual([]);
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

  test('coverage preset fails when workflows lack native assertions', () => {
    writeFileSync(
      join(tmpDir, 'workflows.kern'),
      [
        'effect name=loadUsers',
        '  trigger expr={{[{ id: "u1" }]}}',
        'server name=Api',
        '  route GET /users',
        '    respond 200 json={{[]}}',
        'mcp name=Tools',
        '  tool name=search',
        '    respond 200 json={{[]}}',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'workflow-coverage.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Workflow coverage" target="./workflows.kern"',
        '  it name="requires source-level workflow tests"',
        '    expect preset=coverage',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(3);
    expect(summary.results.map((result) => result.ruleId)).toEqual([
      'no:untestedtransitions',
      'no:untestedguards',
      'no:untestedroutes',
      'no:untestedtools',
      'no:untestedeffects',
    ]);
    expect(summary.results[2].message).toContain('route GET /users');
    expect(summary.results[3].message).toContain('tool search');
    expect(summary.results[4].message).toContain('effect loadUsers');
  });

  test('reports native coverage metrics for routes tools and effects', () => {
    writeFileSync(
      join(tmpDir, 'workflow-metrics.kern'),
      [
        'effect name=loadUsers',
        '  trigger expr={{[{ id: "u1" }]}}',
        'effect name=saveUser',
        '  trigger expr={{true}}',
        'server name=Api',
        '  route GET /users',
        '    respond 200 json={{[]}}',
        '  route POST /users',
        '    respond 201 json={{({ ok: true })}}',
        'mcp name=Tools',
        '  tool name=search',
        '    respond 200 json={{[]}}',
        '  tool name=deleteUser',
        '    respond 200 json={{true}}',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'workflow-metrics.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Workflow metrics" target="./workflow-metrics.kern"',
        '  it name="covers one workflow from each kind"',
        '    expect route="GET /users" returns={{[]}}',
        '    expect tool=search returns={{[]}}',
        '    expect effect=loadUsers returns={{[{ id: "u1" }]}}',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);
    const output = formatNativeKernTestCoverage(summary.coverage);

    expect(summary.failed).toBe(0);
    expect(summary.coverage.total).toBe(6);
    expect(summary.coverage.covered).toBe(3);
    expect(summary.coverage.percent).toBe(50);
    expect(summary.coverage.routes.uncovered).toEqual(['route POST /users at line 8']);
    expect(summary.coverage.tools.uncovered).toEqual(['tool deleteUser at line 13']);
    expect(summary.coverage.effects.uncovered).toEqual(['effect saveUser at line 3']);
    expect(output).toContain('routes: 1/2 (50%)');
    expect(output).toContain('tools: 1/2 (50%)');
    expect(output).toContain('effects: 1/2 (50%)');
    expect(output).toContain('uncovered routes:');
    expect(output).toContain('uncovered tools:');
    expect(output).toContain('uncovered effects:');
  });

  test('counts effects executed by route and tool workflow assertions as covered', () => {
    writeFileSync(
      join(tmpDir, 'workflow-effect-coverage.kern'),
      [
        'server name=Api',
        '  route GET /users',
        '    effect name=fetchUsers',
        '      trigger expr={{[{ id: "u1" }]}}',
        '    respond 200 json=fetchUsers.result',
        'mcp name=Tools',
        '  tool name=readFile',
        '    effect name=readDisk',
        '      trigger url="/fs/read"',
        '    respond 200 json=readDisk.result',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'workflow-effect-coverage.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Workflow effect coverage" target="./workflow-effect-coverage.kern"',
        '  fixture name=fileBody value={{"hello"}}',
        '  it name="covers nested route and tool effects"',
        '    mock effect=readDisk returns={{fileBody}}',
        '    expect route="GET /users" returns={{[{ id: "u1" }]}}',
        '    expect tool=readFile returns={{fileBody}}',
        '    expect mock=readDisk called=1',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.coverage.effects.total).toBe(2);
    expect(summary.coverage.effects.covered).toBe(2);
    expect(summary.coverage.effects.uncovered).toEqual([]);
  });

  test('excludes coverage=false targets from aggregate native coverage', () => {
    writeFileSync(
      join(tmpDir, 'covered.kern'),
      ['server name=Api', '  route GET /ok', '    respond 200 json={{[]}}'].join('\n'),
    );
    writeFileSync(join(tmpDir, 'ignored.kern'), ['server name=Bad', '  route GET /empty'].join('\n'));
    const testFile = join(tmpDir, 'coverage-ignore.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Covered target" target="./covered.kern"',
        '  it name="covers route"',
        '    expect route="GET /ok" returns={{[]}}',
        'test name="Ignored bad target" target="./ignored.kern" coverage=false',
        '  it name="still asserts expected debt"',
        '    expect has=emptyRoutes matches="/empty"',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.targetFiles.map((file) => file.split('/').pop())).toEqual(['covered.kern', 'ignored.kern']);
    expect(summary.coverage.percent).toBe(100);
    expect(summary.coverage.total).toBe(1);
    expect(summary.coverage.routes.total).toBe(1);
    expect(summary.coverage.routes.uncovered).toEqual([]);
    expect(summary.coverage.targets.map((target) => target.file.split('/').pop())).toEqual(['covered.kern']);
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

  test('asserts generated core code substrings natively', () => {
    writeFileSync(
      join(tmpDir, 'codegen.kern'),
      [
        'fn name=retry returns=number',
        '  param name=attempts type=number value=3',
        '  handler <<<',
        '    return attempts;',
        '  >>>',
        'destructure kind=const source=user',
        '  binding name=id',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'codegen.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Codegen assertions" target="./codegen.kern"',
        '  it name="checks generated output"',
        '    expect codegen contains="function retry(attempts: number = 3): number {"',
        '    expect codegen contains="const { id } = user;"',
        '    expect codegen notContains="attempts: number = 0"',
        '    expect codegen matches="function retry\\\\([^)]+\\\\): number"',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.results.map((result) => result.ruleId)).toEqual(['codegen', 'codegen', 'codegen', 'codegen']);
  });

  test('reports generated core code mismatches', () => {
    writeFileSync(
      join(tmpDir, 'codegen-mismatch.kern'),
      ['fn name=retry returns=number', '  handler <<<', '    return 1;', '  >>>'].join('\n'),
    );
    const testFile = join(tmpDir, 'codegen-mismatch.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Codegen mismatch" target="./codegen-mismatch.kern"',
        '  it name="fails clearly"',
        '    expect codegen contains="function missing()"',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].ruleId).toBe('codegen');
    expect(summary.results[0].message).toContain('Generated code does not contain');
  });

  test('asserts decompiled KERN source and round-trip stability natively', () => {
    writeFileSync(
      join(tmpDir, 'roundtrip.kern'),
      [
        'param name=attempts type=number value=3',
        'param name=ts type=number value={{Date.now()}}',
        'param name=name type=string value="world"',
        `param name=kind type="'draft'|'done'"`,
        'param name=salutation type=string optional=true',
        'param name=parts type="string[]" variadic=true',
        'param type=Point',
        '  binding name=x',
        '  binding name=y',
        'destructure source=user',
        '  binding name=id',
        '  binding name=mail key=email',
        'destructure source=tuple',
        '  element name=second index=1',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'roundtrip.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Roundtrip assertions" target="./roundtrip.kern"',
        '  it name="checks decompiled source"',
        '    expect decompile contains="param name=attempts type=number value=3"',
        '    expect decompile contains="value={{Date.now()}}"',
        '    expect decompile contains="value=\\"world\\""',
        '    expect decompile contains="type=\\"\'draft\'|\'done\'\\""',
        '    expect decompile contains="optional=true"',
        '    expect decompile contains="variadic=true"',
        '    expect decompile contains="binding name=x"',
        '    expect decompile contains="element name=second index=1"',
        '    expect decompile notContains="kind=const"',
        '    expect roundtrip=true',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.results.map((result) => result.ruleId)).toEqual([
      'decompile',
      'decompile',
      'decompile',
      'decompile',
      'decompile',
      'decompile',
      'decompile',
      'decompile',
      'decompile',
      'roundtrip',
    ]);
  });

  test('reports decompiled KERN source mismatches', () => {
    writeFileSync(join(tmpDir, 'decompile-mismatch.kern'), 'param name=attempts type=number value=3');
    const testFile = join(tmpDir, 'decompile-mismatch.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Decompile mismatch" target="./decompile-mismatch.kern"',
        '  it name="fails clearly"',
        '    expect decompile contains="param name=missing"',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].ruleId).toBe('decompile');
    expect(summary.results[0].message).toContain('Decompiled KERN does not contain');
  });

  test('asserts TypeScript importer output and imported KERN roundtrip natively', () => {
    writeFileSync(join(tmpDir, 'target.kern'), 'const name=ok value=true');
    writeFileSync(
      join(tmpDir, 'fixture.ts'),
      [
        'export interface Bag {',
        '  [key: string]: number;',
        '}',
        'export function add(a: number, b: number): number;',
        'export function add(a: string, b: string): string;',
        'export function add(a: any, b: any): any {',
        '  return a + b;',
        '}',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'import.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Import assertions" target="./target.kern" coverage=false',
        '  it name="checks imported KERN"',
        '    expect import="./fixture.ts" contains="interface name=Bag export=true"',
        '    expect import=true from="./fixture.ts" contains="overload params=\\"a:number,b:number\\" returns=number"',
        '    expect import="./fixture.ts" notContains="TODO(unmapped)"',
        '    expect import="./fixture.ts" no=unmapped',
        '    expect import="./fixture.ts" unmapped=0',
        '    expect import="./fixture.ts" roundtrip=true',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.results.map((result) => result.ruleId)).toEqual([
      'import',
      'import',
      'import',
      'import',
      'import',
      'import',
    ]);
  });

  test('reports TypeScript importer assertion mismatches', () => {
    writeFileSync(join(tmpDir, 'fixture.ts'), 'export interface Bag { [key: string]: number }');
    const testFile = join(tmpDir, 'import-mismatch.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Import mismatch" coverage=false',
        '  it name="fails clearly"',
        '    expect import="./fixture.ts" contains="class name=Missing"',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].ruleId).toBe('import');
    expect(summary.results[0].message).toContain('Imported KERN does not contain');
  });

  test('reports unmapped TypeScript importer assertions', () => {
    writeFileSync(join(tmpDir, 'fixture.ts'), 'debugger;');
    const testFile = join(tmpDir, 'import-unmapped.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Import unmapped" coverage=false',
        '  it name="fails clearly"',
        '    expect import="./fixture.ts" no=unmapped',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].ruleId).toBe('import');
    expect(summary.results[0].message).toContain('expected no unmapped TypeScript');
    expect(summary.results[0].message).toContain('debugger');
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

  // Regression: bug 2 — fns whose handler is `lang=kern` must resolve at
  // runtime. Before the fix, the runner read `props.code` verbatim (raw KERN
  // source) and V8 threw ReferenceError because the symbol's binding had no
  // valid JS body. The runner now lowers kern handlers via
  // `emitNativeKernBodyTS` before evaluation.
  test('resolves fn symbols whose handler body is lang=kern', () => {
    writeFileSync(
      join(tmpDir, 'native-body.kern'),
      ['fn name=identity params="value:number" returns=number', '  handler lang=kern', '    return value="value"'].join(
        '\n',
      ),
    );
    const testFile = join(tmpDir, 'native-body.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="lang=kern fn body" target="./native-body.kern"',
        '  it name="executes the lowered body"',
        '    expect fn=identity args={{[7]}} equals=7',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(1);
    expect(summary.results[0].message ?? '').not.toMatch(/ReferenceError/);
  });

  // Regression: bug 1 — the legacy 100ms `RUNTIME_EXPR_TIMEOUT_MS` produced
  // non-deterministic flakes under CPU contention because cold-compile +
  // JIT routinely blew that budget. The default is now 1000ms (override
  // via `KERN_TEST_RUNTIME_TIMEOUT_MS`). This test exercises a small loop
  // that would have been flaky on the old budget but should always pass on
  // the new one.
  test('default runtime timeout absorbs short loop computations', () => {
    writeFileSync(
      join(tmpDir, 'loop.kern'),
      [
        'fn name=sumTo params="n:number" returns=number',
        '  handler <<<',
        '    let total = 0;',
        '    for (let i = 0; i < n; i++) total += i;',
        '    return total;',
        '  >>>',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'loop.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="loop budget" target="./loop.kern"',
        '  it name="finishes within default budget"',
        '    expect fn=sumTo args={{[5000]}} equals=12497500',
      ].join('\n'),
    );

    const summary = runNativeKernTests(testFile);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(1);
    expect(summary.results[0].message ?? '').not.toMatch(/timed out/i);
  });
});
