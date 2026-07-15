import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const FILES = Object.freeze({
  disposition: 'packages/core/src/ir/semantics/internal-effect-machine-types.ts',
  engine: 'packages/core/src/runtime-envelope/source-runner-engine.ts',
  manifest: 'scripts/source-runner-convergence-manifest.json',
  runner: 'packages/core/src/runner.ts',
});

const REQUIRED_DEFERRED = Object.freeze({
  'iteration-budget': ['configuration', 'compatibility'],
  'non-root-environment': ['environment', 'legacy'],
  'runner-classes-state': ['environment', 'legacy'],
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

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',')
  );
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
  if (manifest.schemaVersion !== 1 || manifest.milestone !== 'KERN-5-R2-M3.24') {
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
  const deferredIds = manifest.deferred.map((item) => item?.id);
  if (new Set(deferredIds).size !== deferredIds.length) errors.push('manifest deferred ids must be unique');
  if (deferredIds.sort().join(',') !== Object.keys(REQUIRED_DEFERRED).sort().join(',')) {
    errors.push('manifest deferred ledger must match the audited blocker set exactly');
  }
  for (const [id, [kind, status]] of Object.entries(REQUIRED_DEFERRED)) {
    const item = manifest.deferred.find((candidate) => candidate?.id === id);
    if (
      !exactKeys(item, ['id', 'kind', 'status', 'followUp']) ||
      item.kind !== kind ||
      item.status !== status ||
      typeof item.followUp !== 'string' ||
      item.followUp.length === 0
    ) {
      errors.push(`manifest blocker ${id} has invalid kind, status, or follow-up`);
    }
  }
}

function validateRunner(text, errors) {
  const source = parseSource(FILES.runner, text);
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
    if (calls.includes(forbiddenCall)) errors.push(`${functionName} directly calls ${forbiddenCall}`);
    const makeEnvCalls = descendants(
      fn,
      (node) => ts.isCallExpression(node) && node.expression.getText() === 'makeEnv',
    );
    if (makeEnvCalls.length !== 1) {
      errors.push(`${functionName} must construct exactly one semantic environment`);
      continue;
    }
    const argument = makeEnvCalls[0].arguments[0];
    const names = ts.isObjectLiteralExpression(argument)
      ? argument.properties
          .filter((property) => ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
          .map((property) => property.name.getText().replaceAll(/['"]/g, ''))
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
}

function validateEngine(text, errors) {
  const source = parseSource(FILES.engine, text);
  if (
    descendants(
      source,
      (node) =>
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        hasIdentifierReceiver(node, 'process') &&
        propertyName(node) === 'env',
    ).length > 0 ||
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
  if (contents.runner) validateRunner(contents.runner, errors);
  if (contents.engine) validateEngine(contents.engine, errors);
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
