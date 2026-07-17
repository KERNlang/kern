import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as constructorSuper from './source-runner-class-constructor-super-convergence.mjs';
import * as frames from './source-runner-class-frame-convergence.mjs';
import * as classHelper from './source-runner-class-helper-convergence.mjs';
import * as inheritance from './source-runner-class-inheritance-convergence.mjs';
import * as superMethod from './source-runner-class-super-method-convergence.mjs';
import * as virtualMethod from './source-runner-class-virtual-method-convergence.mjs';
import { CLASS_GETTER_FILES, validateClassGetterManifest, validateClassGetterSlice } from './source-runner-class-getter-convergence.mjs';
import { exactKeys, REQUIRED_DEFERRED } from './source-runner-convergence-utils.mjs';
import { NON_ROOT_FILES, validateNonRootEnvironmentSlice } from './source-runner-non-root-convergence.mjs';
const FILES = Object.freeze({
  ...NON_ROOT_FILES,
  ...constructorSuper.CLASS_CONSTRUCTOR_SUPER_FILES,
  ...frames.CLASS_FRAME_FILES,
  ...classHelper.CLASS_HELPER_FILES,
  ...inheritance.CLASS_INHERITANCE_FILES,
  ...superMethod.CLASS_SUPER_METHOD_FILES,
  ...virtualMethod.CLASS_VIRTUAL_METHOD_FILES,
  ...CLASS_GETTER_FILES,
  classEligibility: 'packages/core/src/ir/semantics/internal-effect-machine-eligibility.ts',
  classEvaluator: 'packages/core/src/ir/semantics/portable-machine-evaluator.ts',
  classGraph: 'packages/core/src/ir/semantics/internal-effect-machine-class-graph.ts',
  classHelperGraph: 'packages/core/src/ir/semantics/internal-effect-machine-helper-graph.ts',
  classInstance: 'packages/core/src/ir/semantics/internal-effect-machine-class-instance.ts',
  classLeaf: 'packages/core/src/ir/semantics/internal-effect-machine-leaf.ts',
  classLeafResult: 'packages/core/src/ir/semantics/internal-effect-machine-leaf-result.ts',
  classPreflight: 'packages/core/src/ir/semantics/internal-effect-machine-class-preflight.ts',
  classRuntime: 'packages/core/src/ir/semantics/internal-effect-machine-class-runtime.ts',
  classScope: 'packages/core/src/ir/semantics/runner-machine-scope.ts',
  classShape: 'packages/core/src/ir/semantics/portable-machine-shape.ts',
  classTests: 'packages/core/tests/runtime-envelope-effect-machine-class-state.test.ts',
  classMethodTests: 'packages/core/tests/runtime-envelope-effect-machine-class-method.test.ts',
  cli: 'packages/cli/src/commands/run.ts',
  cliOptions: 'packages/cli/src/commands/run-options.ts',
  disposition: 'packages/core/src/ir/semantics/internal-effect-machine-types.ts',
  engine: 'packages/core/src/runtime-envelope/source-runner-engine.ts',
  manifest: 'scripts/source-runner-convergence-manifest.json',
  runner: 'packages/core/src/runner.ts',
});
function parseSource(name, text) {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function findFunction(source, name) {
  let result;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
function callsIn(node) {
  const calls = [];
  function visit(child) {
    if (ts.isCallExpression(child)) calls.push(child.expression.getText());
    ts.forEachChild(child, visit);
  }
  visit(node);
  return calls;
}
function descendants(node, predicate) {
  const found = [];
  function visit(child) {
    if (predicate(child)) found.push(child);
    ts.forEachChild(child, visit);
  }
  visit(node);
  return found;
}
function propertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
}
function propertyReceiver(node) {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression : undefined;
}
function hasIdentifierReceiver(node, name) {
  const receiver = propertyReceiver(node);
  return receiver !== undefined && ts.isIdentifier(receiver) && receiver.text === name;
}
function validateManifest(text, errors) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    errors.push(`manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!exactKeys(manifest, ['schemaVersion', 'milestone', 'owned', 'deferred'])) {
    errors.push('manifest top-level schema drifted');
    return;
  }
  if (manifest.schemaVersion !== 1 || manifest.milestone !== 'KERN-5-R2-M3.31b2b2') {
    errors.push('manifest schemaVersion or milestone is invalid');
  }
  if (!Array.isArray(manifest.owned) || !Array.isArray(manifest.deferred)) {
    errors.push('manifest owned and deferred fields must be arrays');
    return;
  }
  const ownedDo = manifest.owned.find((item) => item?.id === 'do');
  if (
    !exactKeys(ownedDo, ['id', 'kind', 'status', 'evidence']) ||
    ownedDo.kind !== 'node' ||
    ownedDo.status !== 'unified' ||
    ownedDo.evidence !== 'packages/core/tests/runtime-envelope-effect-machine-do.test.ts'
  ) {
    errors.push('manifest must contain exactly one evidenced unified do owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'do').length !== 1) errors.push('manifest do owner is duplicated');
  const ownedExpression = manifest.owned.find((item) => item?.id === 'expression-v1');
  if (
    !exactKeys(ownedExpression, ['id', 'kind', 'status', 'evidence']) ||
    ownedExpression.kind !== 'node' ||
    ownedExpression.status !== 'unified' ||
    ownedExpression.evidence !== 'packages/core/tests/runtime-envelope-effect-machine-expression-v1.test.ts'
  ) {
    errors.push('manifest must contain exactly one evidenced unified expression-v1 owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'expression-v1').length !== 1) {
    errors.push('manifest expression-v1 owner is duplicated');
  }
  const ownedEach = manifest.owned.find((item) => item?.id === 'each-pair-entry');
  if (
    !exactKeys(ownedEach, ['id', 'kind', 'status', 'evidence']) ||
    ownedEach.kind !== 'node' ||
    ownedEach.status !== 'unified' ||
    ownedEach.evidence !== 'packages/core/tests/runtime-envelope-effect-machine-each.test.ts'
  ) {
    errors.push('manifest must contain exactly one evidenced unified pair/entry each owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'each-pair-entry').length !== 1) {
    errors.push('manifest pair/entry each owner is duplicated');
  }
  const ownedLambda = manifest.owned.find((item) => item?.id === 'lambda');
  if (
    !exactKeys(ownedLambda, ['id', 'kind', 'status', 'evidence']) ||
    ownedLambda.kind !== 'node' ||
    ownedLambda.status !== 'unified' ||
    ownedLambda.evidence !== 'packages/core/tests/runtime-envelope-effect-machine-lambda.test.ts'
  ) {
    errors.push('manifest must contain exactly one evidenced unified lambda owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'lambda').length !== 1) {
    errors.push('manifest lambda owner is duplicated');
  }
  const ownedHelpers = manifest.owned.find((item) => item?.id === 'helper-functions');
  if (
    !exactKeys(ownedHelpers, ['id', 'kind', 'status', 'evidence']) ||
    ownedHelpers.kind !== 'environment' ||
    ownedHelpers.status !== 'unified' ||
    ownedHelpers.evidence !== 'packages/core/tests/runtime-envelope-effect-machine-helper.test.ts'
  ) {
    errors.push('manifest must contain exactly one evidenced unified helper-functions owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'helper-functions').length !== 1) {
    errors.push('manifest helper-functions owner is duplicated');
  }
  const ownedBudget = manifest.owned.find((item) => item?.id === 'iteration-budget');
  if (
    !exactKeys(ownedBudget, ['id', 'kind', 'status', 'evidence']) ||
    ownedBudget.kind !== 'configuration' ||
    ownedBudget.status !== 'unified' ||
    ownedBudget.evidence !== 'packages/core/tests/runner-iteration-budget.test.ts'
  ) {
    errors.push('manifest must contain exactly one evidenced unified iteration-budget owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'iteration-budget').length !== 1) {
    errors.push('manifest iteration-budget owner is duplicated');
  }
  const ownedClassMethods = manifest.owned.find((item) => item?.id === 'runner-class-direct-methods');
  if (
    !exactKeys(ownedClassMethods, ['id', 'kind', 'status', 'evidence']) ||
    ownedClassMethods.kind !== 'environment' ||
    ownedClassMethods.status !== 'unified' ||
    ownedClassMethods.evidence !== 'packages/core/tests/runtime-envelope-effect-machine-class-method.test.ts'
  ) {
    errors.push('manifest must contain exactly one evidenced unified runner-class-direct-methods owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'runner-class-direct-methods').length !== 1) {
    errors.push('manifest runner-class-direct-methods owner is duplicated');
  }
  const ownedNonRoot = manifest.owned.find((item) => item?.id === 'non-root-environment');
  if (
    !exactKeys(ownedNonRoot, ['id', 'kind', 'status', 'evidence']) ||
    ownedNonRoot.kind !== 'environment' ||
    ownedNonRoot.status !== 'unified' ||
    ownedNonRoot.evidence !== 'packages/core/tests/runtime-envelope-effect-machine-non-root.test.ts'
  ) {
    errors.push('manifest must contain exactly one evidenced unified non-root-environment owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'non-root-environment').length !== 1) {
    errors.push('manifest non-root-environment owner is duplicated');
  }
  validateClassGetterManifest(manifest, errors);
  inheritance.validateClassInheritanceManifest(manifest, errors);
  frames.validateClassFrameManifest(manifest, errors);
  constructorSuper.validateClassConstructorSuperManifest(manifest, errors);
  superMethod.validateClassSuperMethodManifest(manifest, errors);
  virtualMethod.validateClassVirtualMethodManifest(manifest, errors);
  classHelper.validateClassHelperManifest(manifest, errors);
  const deferredIds = manifest.deferred.map((item) => item?.id);
  if (new Set(deferredIds).size !== deferredIds.length) errors.push('manifest deferred ids must be unique');
  if (deferredIds.sort().join(',') !== Object.keys(REQUIRED_DEFERRED).sort().join(',')) {
    errors.push('manifest deferred ledger must match the audited blocker set exactly');
  }
  for (const [id, [kind, status]] of Object.entries(REQUIRED_DEFERRED)) {
    const item = manifest.deferred.find((candidate) => candidate?.id === id);
    if (!exactKeys(item, ['id', 'kind', 'status', 'followUp']) || item.kind !== kind || item.status !== status || typeof item.followUp !== 'string' || item.followUp.length === 0) {
      errors.push(`manifest blocker ${id} has invalid kind, status, or follow-up`);
    }
  }
  const classState = manifest.deferred.find((item) => item?.id === 'runner-classes-state');
  if (
    classState?.followUp !==
    'M3.31b2b3-reverse-helper-class-M3.31b2c-effect-pre-super-and-M3.31c-module-ownership'
  ) {
    errors.push('manifest must keep remaining class behavior as the exact M3.31b2/c follow-up');
  }
}

function validateClassStateSlice(
  eligibilityText,
  evaluatorText,
  graphText,
  helperGraphText,
  instanceText,
  leafText,
  leafResultText,
  preflightText,
  runtimeText,
  scopeText,
  shapeText,
  testsText,
  methodTestsText,
  engineText,
  errors,
) {
  const eligibility = parseSource(FILES.classEligibility, eligibilityText);
  const eligibilityCalls = descendants(eligibility, (node) => ts.isCallExpression(node) && node.expression.getText() === 'internalMachineClassGraphClaims');
  if (eligibilityCalls.length !== 2) {
    errors.push('direct and source eligibility must both require the exact class graph claim');
  }
  for (const forbidden of ['portable-reference-body', 'portable-reference-evaluator', 'async-reference-runner']) {
    if (graphText.includes(forbidden) || runtimeText.includes(forbidden)) {
      errors.push(`machine class ownership imports forbidden compatibility owner ${forbidden}`);
    }
  }
  for (const required of [
    'assertInternalMachineClassGraph',
    'assertInternalMachineClassUsage',
    'allocation must occur in the root sequence',
    'field mutation must occur in the root sequence',
    'assertInternalMachineClassInheritance',
  ]) {
    if (!graphText.includes(required)) errors.push(`machine class graph is missing ${required}`);
  }
  for (const required of [
    'helper calls in class-owned expressions are outside this slice',
    'prepareInternalMachineClassInstance',
    'evalInternalMachineClassMethod',
  ]) {
    if (!runtimeText.includes(required)) errors.push(`machine class runtime is missing ${required}`);
  }
  for (const required of ['classInstanceOwner', 'owner === INTERNAL_MACHINE_PREFLIGHT_CLASS_OWNER', 'internalMachineClassReceiver']) {
    if (!instanceText.includes(required)) errors.push(`machine class instance ownership is missing ${required}`);
  }
  for (const required of ['assertMethod', 'internalMachineClassMethodForCall']) {
    if (!graphText.includes(required)) errors.push(`machine class method graph is missing ${required}`);
  }
  if (!shapeText.includes('export function assertPortableMachineClassMethodCallShape')) {
    errors.push('machine class method calls are missing their whole-leaf shape owner');
  }
  if (!evaluatorText.includes('classMethod(node') || !evaluatorText.includes('evalInternalMachineClassMethod(node, env, evaluate)')) {
    errors.push('portable machine evaluator does not dispatch the admitted class-method leaf');
  }
  if (
    !leafText.includes('assertInternalMachinePrintShape(node, env)') ||
    !leafResultText.includes('assertPortableMachineClassMethodCallShape(value, env)')
  ) {
    errors.push('machine print leaves do not admit exact direct class-method calls');
  }
  for (const required of ['methodEntries: new Map(binding.methods)', 'mapMatchesSnapshot', 'binding.methods.values()']) {
    if (!scopeText.includes(required)) errors.push(`machine class method metadata ownership is missing ${required}`);
  }
  const preflight = parseSource(FILES.classPreflight, preflightText);
  const deferredClassPreflight = findFunction(preflight, 'preflightDeferredInternalMachineClassLet');
  const scalarDelegates = deferredClassPreflight ? descendants(deferredClassPreflight, (node) => ts.isIdentifier(node) && node.text === 'assertDeferredMachineScalarPreflight') : [];
  if (scalarDelegates.length !== 1) {
    errors.push('machine class preflight must delegate deferred scalar validation');
  }
  if (!engineText.includes('internalMachineClassGraphHasClasses')) {
    errors.push('source selector does not preflight the admitted class slice before execution');
  }
  for (const oracle of [
    'selects and executes construction plus own-field read/write on the machine',
    'routes inheritance to compatibility before provider dispatch',
    'preserves receiver state across async suspension and isolates parallel runs',
    'selects machine when the linked root function map contains the entry function',
    'rejects deferred constructor %s before provider dispatch',
    'rejects a deferred constructor read before own-field initialization',
    'rejects deferred %s class field reads before provider dispatch',
    'routes nested class mutation to compatibility before provider dispatch',
  ]) {
    if (!testsText.includes(oracle)) errors.push(`machine class oracle is missing: ${oracle}`);
  }
  for (const oracle of [
    'selects and executes pure direct methods on the machine',
    'owns the linked public source path without changing compatibility output',
    'preserves direct method dispatch across async suspension',
    'snapshots admitted direct method bodies before async suspension',
    'routes %s to compatibility before provider dispatch',
    'owns deferred method arguments through the resumable class frame',
    'rejects a caller-forged receiver during admission',
    'rejects method metadata changed after linker ownership',
  ]) {
    if (!methodTestsText.includes(oracle)) errors.push(`machine class method oracle is missing: ${oracle}`);
  }
}

function validateRunner(text, errors) {
  const source = parseSource(FILES.runner, text);
  const runnerOptions = descendants(source, (node) => ts.isInterfaceDeclaration(node) && node.name.text === 'ExecuteKernSourceOptions')[0];
  const budgetMembers = runnerOptions?.members.filter((member) => member.name?.getText() === 'iterationBudget') ?? [];
  const budgetMember = budgetMembers[0];
  if (
    budgetMembers.length !== 1 ||
    !ts.isPropertySignature(budgetMember) ||
    budgetMember.questionToken === undefined ||
    budgetMember.type?.kind !== ts.SyntaxKind.NumberKeyword ||
    !budgetMember.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword)
  ) {
    errors.push('ExecuteKernSourceOptions must expose one readonly optional numeric iterationBudget');
  }
  const contracts = [
    ['executeParsedKernHandler', 'executeSourceRunnerSync', 'referenceRunSequence'],
    ['executeKernSourceAsyncWithEntry', 'executeSourceRunnerAsync', 'asyncReferenceRunSequence'],
  ];
  for (const [functionName, selectorCall, forbiddenCall] of contracts) {
    const fn = findFunction(source, functionName);
    if (!fn) {
      errors.push(`runner function ${functionName} is missing`);
      continue;
    }
    const calls = callsIn(fn);
    if (calls.filter((name) => name === selectorCall).length !== 1) {
      errors.push(`${functionName} must call ${selectorCall} exactly once`);
    }
    const selectorCalls = descendants(fn, (node) => ts.isCallExpression(node) && node.expression.getText() === selectorCall);
    const selectorOptions = selectorCalls[0]?.arguments[2];
    const budgetProperties = selectorOptions && ts.isObjectLiteralExpression(selectorOptions) ? selectorOptions.properties.filter((property) => property.name?.getText() === 'iterationBudget') : [];
    if (budgetProperties.length !== 1 || !ts.isPropertyAssignment(budgetProperties[0]) || budgetProperties[0].initializer.getText() !== 'options.iterationBudget') {
      errors.push(`${functionName} must forward options.iterationBudget exactly once to ${selectorCall}`);
    }
    if (calls.includes(forbiddenCall)) errors.push(`${functionName} directly calls ${forbiddenCall}`);
    const makeEnvCalls = descendants(fn, (node) => ts.isCallExpression(node) && node.expression.getText() === 'makeEnv');
    if (makeEnvCalls.length !== 1) {
      errors.push(`${functionName} must construct exactly one semantic environment`);
      continue;
    }
    const argument = makeEnvCalls[0].arguments[0];
    const names = ts.isObjectLiteralExpression(argument)
      ? argument.properties.filter((property) => ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)).map((property) => property.name.getText().replaceAll(/['"]/g, ''))
      : [];
    for (const required of ['runnerFunctions', 'runnerClasses', 'runnerCallStack', 'runnerCallCache']) {
      if (!names.includes(required)) errors.push(`${functionName} does not initialize owned ${required} through makeEnv`);
    }
    const unsafeAssignment = descendants(
      fn,
      (node) =>
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        hasIdentifierReceiver(node.left, 'env') &&
        ['runnerFunctions', 'runnerClasses', 'runnerCallStack', 'runnerCallCache'].includes(propertyName(node.left)),
    );
    if (unsafeAssignment.length > 0) errors.push(`${functionName} replaces owned runner metadata after makeEnv`);
  }
  const asyncFn = findFunction(source, 'executeKernSourceAsyncWithEntry');
  const syncOptions = asyncFn ? descendants(asyncFn, (node) => ts.isVariableDeclaration(node) && node.name.getText() === 'syncOptions')[0]?.initializer : undefined;
  const delegatedBudget = syncOptions && ts.isObjectLiteralExpression(syncOptions) ? syncOptions.properties.filter((property) => property.name?.getText() === 'iterationBudget') : [];
  if (delegatedBudget.length !== 1 || !ts.isPropertyAssignment(delegatedBudget[0]) || delegatedBudget[0].initializer.getText() !== 'options.iterationBudget') {
    errors.push('executeKernSourceAsyncWithEntry must forward iterationBudget through sync delegation');
  }
}

function validateCli(text, optionsText, errors) {
  const source = parseSource(FILES.cli, text);
  const optionsSource = parseSource(FILES.cliOptions, optionsText);
  const contracts = [
    ['executeKernSource', 'executeKernSourceFromRunner', 'options.iterationBudget'],
    ['executeKernSourceAsync', 'executeKernSourceAsyncFromRunner', 'options.iterationBudget'],
    ['runRun', 'executeKernSource', 'parsed.iterationBudget'],
    ['runRun', 'executeKernSourceAsync', 'parsed.iterationBudget'],
  ];
  for (const [functionName, callName, expected] of contracts) {
    const fn = findFunction(source, functionName);
    const calls = fn ? descendants(fn, (node) => ts.isCallExpression(node) && node.expression.getText() === callName) : [];
    const options = calls[0]?.arguments.at(-1);
    const budgetProperties = options && ts.isObjectLiteralExpression(options) ? options.properties.filter((property) => property.name?.getText() === 'iterationBudget') : [];
    if (calls.length !== 1 || budgetProperties.length !== 1 || !ts.isPropertyAssignment(budgetProperties[0]) || budgetProperties[0].initializer.getText() !== expected) {
      errors.push(`${functionName} must forward ${expected} exactly once to ${callName}`);
    }
  }
  const parseFn = findFunction(source, 'parseRunArgs');
  if (!parseFn || callsIn(parseFn).filter((call) => call === 'parseIterationBudget').length !== 1) {
    errors.push('parseRunArgs must parse iterationBudget exactly once');
  }
  const budgetParser = findFunction(optionsSource, 'parseIterationBudget');
  if (!budgetParser || callsIn(budgetParser).filter((call) => call === 'parsePositiveSafeInteger').length !== 1 || descendants(budgetParser, ts.isNumericLiteral).length > 0) {
    errors.push('parseIterationBudget must delegate to the positive-safe-integer parser without a default');
  }
}

function validateEngine(text, errors) {
  const source = parseSource(FILES.engine, text);
  if (
    descendants(source, (node) => (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && hasIdentifierReceiver(node, 'process') && propertyName(node) === 'env').length > 0 ||
    descendants(source, (node) => ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword).length > 0
  ) {
    errors.push('engine contains a public environment switch or an any escape');
  }
  if (descendants(source, (node) => ts.isNumericLiteral(node) && node.text === '10000').length > 0) {
    errors.push('engine embeds the historical iteration threshold');
  }
  for (const [name, machineCall, legacyCall] of [
    ['executeSourceRunnerSync', 'runInternalRuntimeEngineSync', 'runSourceRunnerLegacySync'],
    ['executeSourceRunnerAsync', 'runInternalRuntimeEngineAsync', 'runSourceRunnerLegacyAsync'],
  ]) {
    const fn = findFunction(source, name);
    if (!fn) {
      errors.push(`engine function ${name} is missing`);
      continue;
    }
    const calls = callsIn(fn);
    for (const required of ['selectedEngine', machineCall, legacyCall]) {
      if (calls.filter((call) => call === required).length !== 1) errors.push(`${name} must call ${required} exactly once`);
    }
    if (descendants(fn, ts.isTryStatement).length > 0) errors.push(`${name} may not catch and retry execution`);
  }
}

function validateDisposition(text, errors) {
  for (const [node, status] of [
    ['do', 'unified'],
    ['each', 'unified'],
    ["'expression-v1'", 'unified'],
    ['lambda', 'unified'],
  ]) {
    const pattern = new RegExp(`${node.replaceAll('-', '\\-')}\\s*:\\s*['\"]${status}['\"]`);
    if (!pattern.test(text)) errors.push(`machine disposition for ${node} must remain ${status}`);
  }
}

export function validateSourceRunnerConvergence(readText) {
  const errors = [];
  const contents = {};
  for (const [key, file] of Object.entries(FILES)) {
    try {
      contents[key] = readText(file);
    } catch (error) {
      errors.push(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (contents.manifest) validateManifest(contents.manifest, errors);
  if (contents.classEligibility && contents.classEvaluator && contents.classGraph && contents.classHelperGraph && contents.classInstance && contents.classLeaf && contents.classLeafResult && contents.classPreflight && contents.classRuntime && contents.classScope && contents.classShape && contents.classTests && contents.classMethodTests && contents.sourceAdmission) {
    validateClassStateSlice(
      contents.classEligibility,
      contents.classEvaluator,
      contents.classGraph,
      contents.classHelperGraph,
      contents.classInstance,
      contents.classLeaf,
      contents.classLeafResult,
      contents.classPreflight,
      contents.classRuntime,
      contents.classScope,
      contents.classShape,
      contents.classTests,
      contents.classMethodTests,
      contents.sourceAdmission,
      errors,
    );
  }
  if (contents.runner) validateRunner(contents.runner, errors);
  if (contents.cli && contents.cliOptions) validateCli(contents.cli, contents.cliOptions, errors);
  if (contents.engine) validateEngine(contents.engine, errors);
  validateNonRootEnvironmentSlice(contents, errors);
  validateClassGetterSlice(contents, errors);
  inheritance.validateClassInheritanceSlice(contents, errors);
  frames.validateClassFrameSlice(contents, errors);
  constructorSuper.validateClassConstructorSuperSlice(contents, errors);
  superMethod.validateClassSuperMethodSlice(contents, errors);
  virtualMethod.validateClassVirtualMethodSlice(contents, errors);
  classHelper.validateClassHelperSlice(contents, errors);
  if (contents.disposition) validateDisposition(contents.disposition, errors);
  return errors;
}
function runCli() {
  const root = process.cwd();
  const errors = validateSourceRunnerConvergence((file) => fs.readFileSync(path.join(root, file), 'utf8'));
  if (errors.length > 0) {
    console.error(`Source-runner convergence guard failed:\n- ${errors.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('Source-runner convergence guard passed.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) runCli();
