import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { astWitnessMatches } from './ast-witness.mjs';

const ID = /^[a-z][a-z0-9-]{0,63}$/u;
const EXPECTED_CLAIMS = Object.freeze({
  runtimeCutover: false,
  kirV1Frozen: false,
  publicReaderExport: false,
  semanticSelfHosting: false,
});
const EXPECTED_FORBIDDEN_ROLES = Object.freeze(['bootstrap-authority', 'differential-oracle', 'internal-oracle']);
const EXPECTED_COMPONENTS = Object.freeze({
  'source-input': ['external-input', 'current'],
  'kern-frontend': ['planned-owner', 'planned'],
  'kir-reader-candidate': ['internal-data-boundary', 'internal-candidate'],
  'kern-interpreter': ['planned-semantic-owner', 'planned'],
  'host-capability-boundary': ['host-boundary', 'planned'],
  'ts-source-runtime': ['bootstrap-authority', 'current'],
  'ts-async-source-runtime': ['bootstrap-authority', 'current'],
  'reference-runner': ['differential-oracle', 'current'],
  'async-reference-runner': ['differential-oracle', 'current'],
  'cli-run': ['bootstrap-authority', 'current'],
  'kern-checker-v2': ['internal-oracle', 'current'],
  'kern-module-validator': ['internal-oracle', 'current'],
});
const EXPECTED_CONTRACTS = Object.freeze({
  'source-frontend': ['kern-frontend', 'planned'],
  'semantic-kir-reader': ['kir-reader-candidate', 'internal-candidate'],
  'semantic-execution': ['kern-interpreter', 'planned'],
  'host-capability-dispatch': ['host-capability-boundary', 'planned'],
});
const EXPECTED_CANONICAL_PATH = Object.freeze([
  'source-input',
  'kern-frontend',
  'kir-reader-candidate',
  'kern-interpreter',
  'host-capability-boundary',
]);
const EXPECTED_WITNESSES = Object.freeze({
  'sync-runtime-to-reference-runner': [
    'ts-source-runtime', 'reference-runner', 'packages/core/src/runner.ts',
    'assigned-imported-call:referenceRunSequence:referenceRunSequence:./ir/semantics/index.js:executeParsedKernHandler:trace',
  ],
  'async-runtime-to-async-reference-runner': [
    'ts-async-source-runtime', 'async-reference-runner', 'packages/core/src/runner.ts',
    'assigned-imported-call:asyncReferenceRunSequence:asyncReferenceRunSequence:./ir/semantics/async-reference-runner.js:executeKernSourceAsyncWithEntry:trace',
  ],
  'async-fallback-to-reference-runner': [
    'async-reference-runner', 'reference-runner',
    'packages/core/src/ir/semantics/async-reference-runner.ts',
    'returned-imported-call:referenceRun:referenceRun:./reference-runner.js:asyncReferenceRun',
  ],
  'cli-to-source-runtime': [
    'cli-run', 'ts-source-runtime', 'packages/cli/src/commands/run.ts',
    'returned-imported-call:executeKernSource:executeKernSourceFromRunner:@kernlang/core/runner:executeKernSource',
  ],
  'checker-to-cli': [
    'kern-checker-v2', 'cli-run', 'scripts/check-capstone-checker-subset.mjs',
    'call-array:spawnSync:1:CLI,run,MAIN_KERN:process.execPath',
  ],
  'validator-to-cli': [
    'kern-module-validator', 'cli-run', 'scripts/check-selfhost-validator.mjs',
    'call-array:spawnSync:1:CLI,run,MAIN_KERN:process.execPath',
  ],
});
const EXPECTED_CONTAINMENT_PATHS = Object.freeze([
  'packages/core/package.json',
  'packages/core/src/index.ts',
  'packages/core/src/runner.ts',
  'packages/core/src/runner-browser.ts',
]);
const EXPECTED_CONTAINMENT_ENTRYPOINTS = Object.freeze([
  'packages/core/src/index.ts',
  'packages/core/src/runner.ts',
  'packages/core/src/runner-browser.ts',
]);
const EXPECTED_READER_BINDING = Object.freeze([
  'packages/core/src/kir-reader-candidate/types.ts',
  "export const KIR_READER_CANDIDATE_FORMAT = 'kern.semantic-kir.probe.1' as const;",
  'kern.semantic-kir.probe.1',
  'internal-candidate',
]);

function fail(message) {
  throw new Error(`semantic ownership: ${message}`);
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} must contain exactly ${wanted.join(', ')}`);
  }
}

function text(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail(`${label} must be non-empty text`);
}

function id(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${label} must be a safe identifier`);
}

function uniqueRecords(values, keys, label) {
  if (!Array.isArray(values) || values.length === 0) fail(`${label} must be a non-empty array`);
  const ids = new Set();
  for (const [index, value] of values.entries()) {
    record(value, `${label}[${index}]`);
    exactKeys(value, keys, `${label}[${index}]`);
    id(value.id, `${label}[${index}].id`);
    if (ids.has(value.id)) fail(`${label} contains duplicate id ${value.id}`);
    ids.add(value.id);
  }
  return ids;
}

function sameMembers(actual, expected, label) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (
    actualSet.size !== actual.length ||
    expectedSet.size !== expected.length ||
    actualSet.size !== expectedSet.size ||
    [...actualSet].some((value) => !expectedSet.has(value))
  ) {
    fail(`${label} must contain exactly ${expected.join(', ')}`);
  }
}

function validateComponents(policy) {
  const ids = uniqueRecords(policy.components, ['id', 'role', 'status'], 'components');
  for (const component of policy.components) {
    id(component.role, `component ${component.id} role`);
    id(component.status, `component ${component.id} status`);
  }
  return ids;
}

function validateContracts(policy, componentIds) {
  uniqueRecords(policy.contracts, ['id', 'owner', 'status'], 'contracts');
  for (const contract of policy.contracts) {
    if (!componentIds.has(contract.owner)) fail(`contract ${contract.id} has unknown owner ${contract.owner}`);
    id(contract.status, `contract ${contract.id} status`);
  }
  const semantic = policy.contracts.find((contract) => contract.id === 'semantic-execution');
  if (!semantic) fail('semantic-execution contract is required');
  const owner = policy.components.find((component) => component.id === semantic.owner);
  if (owner.role !== 'planned-semantic-owner') {
    fail(`semantic-execution owner ${semantic.owner} must have role planned-semantic-owner`);
  }
}

function validateCanonicalGraph(policy, componentIds) {
  if (!componentIds.has(policy.canonicalSource) || !componentIds.has(policy.canonicalSink)) {
    fail('canonical source and sink must name components');
  }
  if (!Array.isArray(policy.canonicalEdges) || policy.canonicalEdges.length === 0) fail('canonicalEdges must be non-empty');
  const outgoing = new Map(policy.components.map(({ id: componentId }) => [componentId, []]));
  const indegree = new Map(policy.components.map(({ id: componentId }) => [componentId, 0]));
  const edgeIds = new Set();
  for (const [index, edge] of policy.canonicalEdges.entries()) {
    record(edge, `canonicalEdges[${index}]`);
    exactKeys(edge, ['from', 'to'], `canonicalEdges[${index}]`);
    if (!componentIds.has(edge.from) || !componentIds.has(edge.to)) fail(`canonical edge ${edge.from} -> ${edge.to} is dangling`);
    const edgeId = `${edge.from}->${edge.to}`;
    if (edgeIds.has(edgeId)) fail(`duplicate canonical edge ${edgeId}`);
    edgeIds.add(edgeId);
    outgoing.get(edge.from).push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to) + 1);
  }

  const reachable = new Set();
  const visiting = new Set();
  function visit(componentId) {
    if (visiting.has(componentId)) fail(`canonical graph contains a cycle at ${componentId}`);
    if (reachable.has(componentId)) return;
    visiting.add(componentId);
    for (const next of outgoing.get(componentId)) visit(next);
    visiting.delete(componentId);
    reachable.add(componentId);
  }
  visit(policy.canonicalSource);
  if (!reachable.has(policy.canonicalSink)) fail('canonical sink is unreachable');

  const canonicalIds = policy.components
    .filter((component) => !policy.forbiddenCanonicalRoles.includes(component.role))
    .map((component) => component.id);
  for (const componentId of canonicalIds) {
    if (!reachable.has(componentId)) fail(`canonical component ${componentId} is disconnected`);
  }
  for (const component of policy.components) {
    if (reachable.has(component.id) && policy.forbiddenCanonicalRoles.includes(component.role)) {
      fail(`canonical graph reaches forbidden ${component.role} ${component.id}`);
    }
  }
  if (indegree.get(policy.canonicalSource) !== 0) fail('canonical source must have no incoming edge');
  if (outgoing.get(policy.canonicalSink).length !== 0) fail('canonical sink must have no outgoing edge');
}

function parsedSource(source, sourcePath) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((sourceFile.parseDiagnostics ?? []).length > 0) fail(`cannot parse module graph source ${sourcePath}`);
  return sourceFile;
}

function validateWitnesses(policy, componentIds, readText) {
  uniqueRecords(policy.currentWitnesses, ['id', 'from', 'to', 'path', 'evidence'], 'currentWitnesses');
  for (const witness of policy.currentWitnesses) {
    if (!componentIds.has(witness.from) || !componentIds.has(witness.to)) fail(`witness ${witness.id} is dangling`);
    text(witness.path, `witness ${witness.id} path`);
    text(witness.evidence, `witness ${witness.id} evidence`);
    if (!astWitnessMatches(readText(witness.path), witness.path, witness.evidence)) {
      fail(`witness ${witness.id} source evidence drifted`);
    }
  }
}

function moduleSpecifiers(source, sourcePath) {
  const specifiers = [];
  const sourceFile = parsedSource(source, sourcePath);
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) fail(`non-literal module specifier in ${sourcePath}`);
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (!argument || !ts.isStringLiteral(argument)) fail(`non-literal dynamic import in ${sourcePath}`);
      specifiers.push(argument.text);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const [argument] = node.arguments;
      if (!argument || !ts.isStringLiteral(argument)) fail(`non-literal require in ${sourcePath}`);
      specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}

function resolveRelativeSource(fromPath, specifier, readText) {
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  if (resolved === '..' || resolved.startsWith('../') || path.posix.isAbsolute(resolved)) {
    fail(`static import ${specifier} from ${fromPath} escapes the repository`);
  }
  const candidates = resolved.endsWith('.js')
    ? [`${resolved.slice(0, -3)}.ts`, resolved]
    : [resolved, `${resolved}.ts`, `${resolved}/index.ts`];
  for (const candidate of candidates) {
    try {
      readText(candidate);
      return candidate;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'EISDIR' && error?.code !== 'EPERM') throw error;
    }
  }
  fail(`static import ${specifier} from ${fromPath} cannot be resolved`);
}

function resolveCoreSelfSource(specifier, readText) {
  const packageJson = JSON.parse(readText('packages/core/package.json'));
  const exportKey = specifier === '@kernlang/core' ? '.' : `./${specifier.slice('@kernlang/core/'.length)}`;
  const entry = packageJson.exports?.[exportKey];
  const target = typeof entry === 'string' ? entry : (entry?.default ?? entry?.import);
  if (typeof target !== 'string' || !target.startsWith('./dist/') || !target.endsWith('.js')) {
    fail(`core self-import ${specifier} has no bounded source export`);
  }
  const sourcePath = `packages/core/src/${target.slice('./dist/'.length, -3)}.ts`;
  try {
    readText(sourcePath);
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`core self-import ${specifier} cannot resolve ${sourcePath}`);
    throw error;
  }
  return sourcePath;
}

function coreExportEntrypoints(readText) {
  const packageJson = JSON.parse(readText('packages/core/package.json'));
  const entrypoints = [];
  for (const [exportKey, entry] of Object.entries(packageJson.exports ?? {})) {
    const target = typeof entry === 'string' ? entry : (entry?.default ?? entry?.import);
    if (typeof target !== 'string' || !target.startsWith('./dist/') || !target.endsWith('.js')) {
      fail(`core export ${exportKey} has no bounded source target`);
    }
    const sourcePath = `packages/core/src/${target.slice('./dist/'.length, -3)}.ts`;
    try {
      readText(sourcePath);
    } catch (error) {
      if (error?.code === 'ENOENT') fail(`core export ${exportKey} cannot resolve ${sourcePath}`);
      throw error;
    }
    entrypoints.push(sourcePath);
  }
  return entrypoints;
}

function validateStaticContainment(entrypoints, token, readText) {
  const visited = new Set();
  const stack = [...entrypoints, ...coreExportEntrypoints(readText)];
  while (stack.length > 0) {
    const sourcePath = stack.pop();
    if (visited.has(sourcePath)) continue;
    visited.add(sourcePath);
    if (sourcePath.includes(token)) fail(`reader candidate is reachable from ${sourcePath}`);
    const source = readText(sourcePath);
    for (const specifier of moduleSpecifiers(source, sourcePath)) {
      if (specifier.includes(token)) fail(`reader candidate is reachable through import ${specifier}`);
      const dependency = specifier.startsWith('.')
        ? resolveRelativeSource(sourcePath, specifier, readText)
        : specifier === '@kernlang/core' || specifier.startsWith('@kernlang/core/')
          ? resolveCoreSelfSource(specifier, readText)
          : undefined;
      if (dependency) stack.push(dependency);
    }
  }
}

function validateReaderBinding(policy, readText) {
  record(policy.readerBinding, 'readerBinding');
  exactKeys(policy.readerBinding, ['path', 'includes', 'format', 'status'], 'readerBinding');
  for (const [key, value] of Object.entries(policy.readerBinding)) text(value, `readerBinding ${key}`);
  if (!readText(policy.readerBinding.path).includes(policy.readerBinding.includes)) fail('reader binding source evidence drifted');
}

function validateContainment(policy, readText) {
  record(policy.readerContainment, 'readerContainment');
  exactKeys(policy.readerContainment, ['token', 'absentFrom', 'entrypoints'], 'readerContainment');
  text(policy.readerContainment.token, 'readerContainment token');
  if (!Array.isArray(policy.readerContainment.absentFrom) || policy.readerContainment.absentFrom.length === 0) {
    fail('readerContainment absentFrom must be non-empty');
  }
  for (const sourcePath of policy.readerContainment.absentFrom) {
    text(sourcePath, 'readerContainment path');
    if (readText(sourcePath).includes(policy.readerContainment.token)) {
      fail(`reader candidate escaped containment through ${sourcePath}`);
    }
  }
  if (!Array.isArray(policy.readerContainment.entrypoints) || policy.readerContainment.entrypoints.length === 0) {
    fail('readerContainment entrypoints must be non-empty');
  }
  validateStaticContainment(policy.readerContainment.entrypoints, policy.readerContainment.token, readText);
}

function validateFixedBoundary(policy) {
  sameMembers(policy.forbiddenCanonicalRoles, EXPECTED_FORBIDDEN_ROLES, 'forbiddenCanonicalRoles');
  if (policy.canonicalSource !== EXPECTED_CANONICAL_PATH[0]) fail('canonicalSource changed');
  if (policy.canonicalSink !== EXPECTED_CANONICAL_PATH.at(-1)) fail('canonicalSink changed');

  sameMembers(Object.keys(EXPECTED_COMPONENTS), policy.components.map(({ id: componentId }) => componentId), 'component ids');
  for (const component of policy.components) {
    const expected = EXPECTED_COMPONENTS[component.id];
    if (component.role !== expected[0] || component.status !== expected[1]) fail(`component ${component.id} classification changed`);
  }

  sameMembers(Object.keys(EXPECTED_CONTRACTS), policy.contracts.map(({ id: contractId }) => contractId), 'contract ids');
  for (const contract of policy.contracts) {
    const expected = EXPECTED_CONTRACTS[contract.id];
    if (contract.owner !== expected[0] || contract.status !== expected[1]) fail(`contract ${contract.id} ownership changed`);
  }

  const expectedEdges = EXPECTED_CANONICAL_PATH.slice(0, -1).map((from, index) => `${from}->${EXPECTED_CANONICAL_PATH[index + 1]}`);
  const actualEdges = policy.canonicalEdges.map(({ from, to }) => `${from}->${to}`);
  sameMembers(actualEdges, expectedEdges, 'canonical edges');

  sameMembers(Object.keys(EXPECTED_WITNESSES), policy.currentWitnesses.map(({ id: witnessId }) => witnessId), 'witness ids');
  for (const witness of policy.currentWitnesses) {
    const expected = EXPECTED_WITNESSES[witness.id];
    const actual = [witness.from, witness.to, witness.path, witness.evidence];
    if (actual.some((value, index) => value !== expected[index])) fail(`witness ${witness.id} definition changed`);
  }
  if (policy.readerContainment.token !== 'kir-reader-candidate') fail('reader containment token changed');
  sameMembers(policy.readerContainment.absentFrom, EXPECTED_CONTAINMENT_PATHS, 'reader containment paths');
  sameMembers(policy.readerContainment.entrypoints, EXPECTED_CONTAINMENT_ENTRYPOINTS, 'reader containment entrypoints');
  const readerBinding = [
    policy.readerBinding.path,
    policy.readerBinding.includes,
    policy.readerBinding.format,
    policy.readerBinding.status,
  ];
  if (readerBinding.some((value, index) => value !== EXPECTED_READER_BINDING[index])) fail('reader binding changed');
}

export function validateSemanticOwnership(policy, options = {}) {
  record(policy, 'policy');
  exactKeys(
    policy,
    [
      'schemaVersion', 'proofLabel', 'claims', 'forbiddenCanonicalRoles', 'canonicalSource', 'canonicalSink',
      'components', 'contracts', 'canonicalEdges', 'currentWitnesses', 'readerBinding', 'readerContainment',
    ],
    'policy',
  );
  if (policy.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (policy.proofLabel !== 'BOOTSTRAP-DEPENDENT') fail('proofLabel must be BOOTSTRAP-DEPENDENT');
  record(policy.claims, 'claims');
  exactKeys(policy.claims, Object.keys(EXPECTED_CLAIMS), 'claims');
  for (const [claim, expected] of Object.entries(EXPECTED_CLAIMS)) {
    if (policy.claims[claim] !== expected) fail(`${claim} must remain ${expected}`);
  }
  if (!Array.isArray(policy.forbiddenCanonicalRoles) || policy.forbiddenCanonicalRoles.length === 0) {
    fail('forbiddenCanonicalRoles must be non-empty');
  }
  const forbidden = new Set(policy.forbiddenCanonicalRoles);
  if (forbidden.size !== policy.forbiddenCanonicalRoles.length) fail('forbiddenCanonicalRoles must be unique');
  for (const role of forbidden) id(role, 'forbidden canonical role');
  id(policy.canonicalSource, 'canonicalSource');
  id(policy.canonicalSink, 'canonicalSink');

  const root = options.root ?? process.cwd();
  const readText = options.readText ?? ((sourcePath) => readFileSync(path.join(root, sourcePath), 'utf8'));
  const componentIds = validateComponents(policy);
  validateContracts(policy, componentIds);
  validateCanonicalGraph(policy, componentIds);
  validateFixedBoundary(policy);
  validateWitnesses(policy, componentIds, readText);
  validateReaderBinding(policy, readText);
  validateContainment(policy, readText);
  return policy;
}
