import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { STRUCTURAL_KIR_NODE_CATALOG } from '../../packages/core/dist/kir-structural/catalog.generated.js';
import { projectExpressionText } from '../../packages/core/dist/kir-structural/expression.js';
import { parseExpression } from '../../packages/core/dist/parser-expression.js';
import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
} from './coverage.mjs';
import {
  migrateFunctionFact,
  migrateLegacyFunctionForPrerequisite,
  sourceFunctionRoots,
} from './coverage-prerequisite.mjs';
import {
  loadPublishedCanonicalizerProjectionAnalysisM4133,
} from './projection-analysis-m4-133.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { loadPreM4135CoverageInputs } from './historical-parameter-sources.mjs';

const FORMAT = 'kern.kir-canonicalizer.remediation-analysis.1';
const PUBLISHED_DIGEST = '0023de4d890d0a1b25783f3a6f6ded2985285bb98664df210533744b6ac9e286';
const INPUT_COMMIT = '6222871ce7e8025a4654ff1b0d4c3a43afe3f494';
const PROJECTION_ANALYSIS_DIGEST =
  '89da63518b22003642eabba46177dce3e835d2fde82aebfb4ebe10bd3273bf0a';
const SUMMARY_URL = new URL('./remediation-analysis-m4-134.json', import.meta.url);
const QUOTESOURCE_ID =
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource';
const EXPRESSIONSOURCES_ID =
  'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources';
const CANONICALIZE_ID =
  'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize';
const EXPECTED_IDS = [QUOTESOURCE_ID, EXPRESSIONSOURCES_ID, CANONICALIZE_ID];
const CHARACTER_BLOCKERS = [
  'if.properties.cond.expression.text.character-u007f',
  'if.properties.cond.expression.text.character-u0080',
  'if.properties.cond.expression.text.character-u009f',
  'if.properties.cond.expression.text.character-u2028',
  'if.properties.cond.expression.text.character-u2029',
  'if.properties.cond.expression.text.character-ufeff',
];

function fail(message) {
  throw new TypeError(`coverage M4.134 remediation analysis rejection: ${message}`);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPlainReceiptData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('analysis data must contain only finite numbers');
    return;
  }
  if (typeof value !== 'object') fail('analysis data must contain only JSON values');
  if (seen.has(value)) fail('analysis data must not contain cycles or shared references');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail('analysis arrays must use the plain prototype');
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.some((key) => typeof key === 'symbol') ||
      ownKeys.length !== value.length + 1 ||
      Object.keys(value).length !== value.length
    ) {
      fail('analysis arrays must be dense and undecorated');
    }
    for (const [index, key] of Object.keys(value).entries()) {
      if (key !== String(index)) fail('analysis arrays must contain canonical indices');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('analysis arrays must contain plain enumerable data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    fail('analysis objects must use the plain prototype');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') fail('analysis objects must not contain symbol properties');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      fail('analysis objects must contain only plain enumerable data properties');
    }
    assertPlainReceiptData(descriptor.value, seen);
  }
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function expressionSource(value, path) {
  if (typeof value === 'string') return value;
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.__expr === true &&
    typeof value.code === 'string' &&
    Reflect.ownKeys(value).length === 2
  ) {
    return value.code;
  }
  fail(`malformed expression payload at ${path}`);
}

function classifyConstructor(node, id) {
  const call = node.argument;
  if (
    call?.kind !== 'call' ||
    call.optional !== false ||
    call.typeArgs !== undefined ||
    call.callee?.kind !== 'ident'
  ) {
    fail(`new expression in ${id} must be a plain constructor call`);
  }
  const name = call.callee.name;
  const arity = call.args.length;
  if (name === 'Map') {
    if (arity !== 0) fail(`Map constructor in ${id} must have arity zero`);
  } else if (name === 'Error') {
    if (
      arity !== 1 ||
      call.args[0]?.kind !== 'strLit' ||
      call.args[0].value !== 'KERN_CANONICALIZER_PROFILE'
    ) {
      fail(`Error constructor in ${id} must retain the exact profile message`);
    }
  } else {
    fail(`unexpected constructor ${String(name)} in ${id}`);
  }
  return { arity, name };
}

export function analyzeRemediationExpressionSourceM4134(source, id, path = '$') {
  let node;
  try {
    node = parseExpression(source);
  } catch {
    fail(`expression in ${id} must remain parseable at ${path}`);
  }
  if (node.kind === 'new') return classifyConstructor(node, id);
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object') continue;
    if (current.kind === 'new') {
      fail(`nested new expression in ${id} is outside the exact M4.134 population at ${path}`);
    }
    if (Array.isArray(current)) pending.push(...current);
    else pending.push(...Object.values(current));
  }
  try {
    projectExpressionText(source, path);
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'unknown';
    fail(`expression in ${id} retains unsupported structural shape ${code} at ${path}`);
  }
  return null;
}

function expressionInventory(root, id) {
  const occurrences = [];
  const sourceBlockers = new Set();
  function visitNode(node, path) {
    const contract = STRUCTURAL_KIR_NODE_CATALOG.get(node.type);
    for (const [key, value] of Object.entries(node.props ?? {})) {
      if (contract?.properties[key]?.disposition !== 'lowered-expression') continue;
      const expressionPath = `${path}.${node.type}.${key}`;
      const constructor = analyzeRemediationExpressionSourceM4134(
        expressionSource(value, expressionPath),
        id,
        expressionPath,
      );
      if (constructor !== null) {
        occurrences.push(constructor);
        sourceBlockers.add(`${node.type}.${key}:unknown-expression-kind`);
      }
    }
    (node.children ?? []).forEach((child, index) =>
      visitNode(child, `${path}.children[${index}]`));
  }
  visitNode(root, '$');
  const counts = new Map();
  for (const occurrence of occurrences) {
    const key = JSON.stringify(occurrence);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    constructors: [...counts]
      .map(([key, count]) => ({ ...JSON.parse(key), count }))
      .sort((left, right) => compareText(left.name, right.name) || left.arity - right.arity),
    sourceBlockers: [...sourceBlockers].sort(compareText),
  };
}

function candidateOrder(left, right) {
  return right.completeFunctions - left.completeFunctions ||
    right.parameterRows - left.parameterRows ||
    compareText(left.id, right.id);
}

function publishedHandoff(value) {
  assertPlainReceiptData(value);
  if (value === null || Array.isArray(value) || value.format !== FORMAT) {
    fail(`published format must be ${FORMAT}`);
  }
  const digest = createHash('sha256').update(canonicalBytes(value)).digest('hex');
  if (digest !== PUBLISHED_DIGEST) fail('receipt must match the exact published M4.134 analysis');
  return { digest, inputCommit: INPUT_COMMIT, record: structuredClone(value) };
}

export function measureCanonicalizerRemediationAnalysisM4134() {
  const projectionHandoff = loadPublishedCanonicalizerProjectionAnalysisM4133();
  if (projectionHandoff.digest !== PROJECTION_ANALYSIS_DIGEST) {
    fail('M4.133 input digest must remain exact');
  }
  const historical = loadPreM4135CoverageInputs(loadCoveragePolicy());
  const policy = historical.policy;
  const canonicalizerPolicy = loadCanonicalizerPolicy();
  const coverage = measureCanonicalizerCoverage(
    policy,
    canonicalizerPolicy,
    { sourceOverrides: historical.sourceOverrides },
  );
  const functionCount = coverage.functions.length;
  if (coverage.baseCompleteFunctions !== 104 || functionCount !== 112) {
    fail('live coverage must retain the exact 104/112 M4.133 frontier');
  }
  const roots = sourceFunctionRoots(policy, historical.sourceOverrides);
  const legacyFacts = coverage.functions
    .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
    .sort((left, right) => compareText(left.id, right.id));
  const legacyFactsById = new Map(legacyFacts.map((fact) => [fact.id, fact]));
  const liveIds = legacyFacts.map(({ id }) => id);
  if (JSON.stringify(liveIds) !== JSON.stringify(EXPECTED_IDS)) {
    fail('live legacy functions must match the exact M4.133 population');
  }

  const requirements = projectionHandoff.record.requirements.map((requirement) => {
    const root = roots.get(requirement.id);
    if (root === undefined) fail(`missing source root ${requirement.id}`);
    const migrated = migrateLegacyFunctionForPrerequisite(root);
    if (migrated.parameters.length !== requirement.parameterRows) {
      fail(`parameter rows changed for ${requirement.id}`);
    }
    const inventory = expressionInventory(migrated.root, requirement.id);
    if (requirement.id === QUOTESOURCE_ID) {
      const migratedFact = migrateFunctionFact(
        legacyFactsById.get(requirement.id),
        root,
        policy.base,
        canonicalizerPolicy,
      );
      const liveSourceBlockers = [
        ...new Set([...migratedFact.excludedProperties, ...migratedFact.profileBlockers]),
      ]
        .filter((reason) => !reason.startsWith('projection.'))
        .sort(compareText);
      if (
        requirement.outcome !== 'projected' ||
        JSON.stringify(requirement.canonicalSurfaceBlockers) !== JSON.stringify(CHARACTER_BLOCKERS) ||
        JSON.stringify(liveSourceBlockers) !== JSON.stringify(CHARACTER_BLOCKERS)
      ) {
        fail('quotesource must retain the exact six canonical-surface blockers');
      }
      if (inventory.constructors.length !== 0 || inventory.sourceBlockers.length !== 0) {
        fail('quotesource must not contain constructor expressions');
      }
      return {
        blockers: [...CHARACTER_BLOCKERS],
        id: requirement.id,
        outcome: 'canonical-surface',
        parameterRows: requirement.parameterRows,
        remediation: 'quotesource-code-point-rewrite',
        tool: requirement.tool,
      };
    }
    if (requirement.outcome !== 'unsupported' || requirement.projectionCode !== 'unknown-expression-kind') {
      fail(`${requirement.id} must retain unknown-expression-kind`);
    }
    if (inventory.constructors.length === 0) {
      fail(`${requirement.id} must retain its exact constructor population`);
    }
    return {
      constructors: inventory.constructors,
      id: requirement.id,
      outcome: 'unsupported-expression',
      parameterRows: requirement.parameterRows,
      projectionCode: requirement.projectionCode,
      remediation: 'bounded-new-expression-support',
      tool: requirement.tool,
    };
  });

  const constructorRequirements = requirements
    .filter(({ remediation }) => remediation === 'bounded-new-expression-support');
  const constructorCountsByShape = new Map();
  for (const requirement of constructorRequirements) {
    for (const constructor of requirement.constructors) {
      const key = JSON.stringify({ arity: constructor.arity, name: constructor.name });
      constructorCountsByShape.set(key, (constructorCountsByShape.get(key) ?? 0) + constructor.count);
    }
  }
  const constructors = [...constructorCountsByShape]
    .map(([key, count]) => ({ ...JSON.parse(key), count }))
    .sort((left, right) => compareText(left.name, right.name) || left.arity - right.arity);
  const quotesource = requirements.find(({ id }) => id === QUOTESOURCE_ID);
  const candidates = [
    {
      completeFunctions: constructorRequirements.length,
      constructors,
      id: 'bounded-new-expression-support',
      parameterRows: constructorRequirements.reduce((total, item) => total + item.parameterRows, 0),
      requiredContracts: [
        'kern-canonical-source-emission',
        'structural-expression-projection',
        'structural-expression-validation',
      ],
      witnesses: constructorRequirements.map(({ id }) => id),
    },
    {
      blockedCharacters: [...quotesource.blockers],
      completeFunctions: 1,
      id: 'quotesource-code-point-rewrite',
      parameterRows: quotesource.parameterRows,
      requiredContracts: [
        'portable-text-code-point-operation',
        'quotesource-source-rewrite',
      ],
      witnesses: [quotesource.id],
    },
  ].sort(candidateOrder);
  const analysis = {
    candidates,
    format: FORMAT,
    input: {
      baseCompleteFunctions: coverage.baseCompleteFunctions,
      functionCount,
      projectionAnalysisDigest: PROJECTION_ANALYSIS_DIGEST,
      residualFunctions: requirements.length,
    },
    requirements,
    selectedNextAction: structuredClone(candidates[0]),
    summary: {
      canonicalSurfaceFunctions: requirements.filter(
        ({ outcome }) => outcome === 'canonical-surface',
      ).length,
      constructorFunctions: constructorRequirements.length,
      constructorOccurrences: constructors.reduce((total, item) => total + item.count, 0),
      remediationCandidates: candidates.length,
    },
  };
  if (
    JSON.stringify(analysis.summary) !== JSON.stringify({
      canonicalSurfaceFunctions: 1,
      constructorFunctions: 2,
      constructorOccurrences: 21,
      remediationCandidates: 2,
    }) ||
    analysis.selectedNextAction.id !== 'bounded-new-expression-support' ||
    analysis.selectedNextAction.parameterRows !== 21
  ) {
    fail('measured remediation frontier must select exact bounded new-expression support');
  }
  assertPlainReceiptData(analysis);
  return analysis;
}

export function validatePublishedCanonicalizerRemediationAnalysisM4134(value) {
  return publishedHandoff(value);
}

export function loadPublishedCanonicalizerRemediationAnalysisM4134() {
  const path = fileURLToPath(SUMMARY_URL);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) fail('published receipt must exist');
  if (!stat.isFile() || realpathSync(path) !== path) {
    fail('published receipt must be a regular non-symlink file');
  }
  const source = readFileSync(path);
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    fail('published receipt must be valid JSON');
  }
  const result = publishedHandoff(parsed);
  if (!source.equals(canonicalBytes(result.record))) {
    fail('published receipt must use canonical JSON bytes');
  }
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerRemediationAnalysisM4134());
}
