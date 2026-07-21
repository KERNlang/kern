import { createHash } from 'node:crypto';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';

import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
  readCorpusMemberBytes,
} from './coverage.mjs';
import {
  canonicalProfileRowsForFunction,
  handlerChildProfilesForFunction,
  profileBlockersForFunction,
  recursiveStatementNodeKinds,
} from './coverage-profile.mjs';
import { canonicalizerFunctionCompletes } from './coverage-selection.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const FORMAT = 'kern.kir-canonicalizer.prerequisite-summary.1';
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const PORTABLE_PARAMETER_TYPES = new Set([
  'boolean', 'boolean[]', 'number', 'number[]', 'string', 'string[]',
]);

function fail(message) {
  throw new TypeError(`coverage prerequisite rejection: ${message}`);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactLegacyParameters(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) fail('legacy parameters must be non-empty text');
  const names = new Set();
  return raw.split(',').map((entry) => {
    const parts = entry.split(':').map((part) => part.trim());
    if (
      parts.length !== 2 ||
      !IDENTIFIER.test(parts[0]) ||
      !PORTABLE_PARAMETER_TYPES.has(parts[1]) ||
      names.has(parts[0])
    ) {
      fail('legacy parameters must be unique portable name:type pairs');
    }
    names.add(parts[0]);
    return { name: parts[0], type: parts[1] };
  });
}

export function parseLegacyParametersForPrerequisite(raw) {
  return exactLegacyParameters(raw);
}

export function migrateLegacyFunctionForPrerequisite(sourceRoot) {
  if (
    sourceRoot === null ||
    typeof sourceRoot !== 'object' ||
    Array.isArray(sourceRoot) ||
    sourceRoot.type !== 'fn' ||
    !Array.isArray(sourceRoot.children) ||
    sourceRoot.children.some(({ type }) => type === 'param')
  ) {
    fail('legacy function must be a function without direct parameter children');
  }
  const root = structuredClone(sourceRoot);
  const parameters = exactLegacyParameters(root.props?.params);
  delete root.props.params;
  root.children = [
    ...parameters.map(({ name, type }) => ({ children: [], props: { name, type }, type: 'param' })),
    ...root.children,
  ];
  return { parameters, root };
}

function sourceFunctionRoots(policy) {
  const roots = new Map();
  for (const member of policy.corpus) {
    const source = readCorpusMemberBytes(member.path);
    if (createHash('sha256').update(source).digest('hex') !== member.digest) {
      fail(`corpus member ${member.path} changed during prerequisite measurement`);
    }
    const parsed = parseDocumentWithDiagnostics(source.toString('utf8'));
    if (parsed.diagnostics.some(({ severity }) => severity === 'error')) {
      fail(`corpus member ${member.path} has parse errors`);
    }
    (parsed.root.children ?? []).forEach((root, ordinal) => {
      if (root.type !== 'fn') return;
      const name = typeof root.props?.name === 'string' ? root.props.name : `fn-${ordinal}`;
      const id = `${member.path}#${ordinal}:${name}`;
      if (roots.has(id)) fail(`duplicate source function ${id}`);
      roots.set(id, root);
    });
  }
  return roots;
}

function projectionCode(error) {
  return typeof error?.code === 'string' && error.code.length > 0 ? error.code : 'projection-error';
}

function migrateFunctionFact(fact, sourceRoot, base, canonicalizerPolicy) {
  if (sourceRoot === undefined) fail(`missing source function ${fact.id}`);
  const { parameters, root } = migrateLegacyFunctionForPrerequisite(sourceRoot);
  let profileRows = null;
  let projectionBlocker = null;
  try {
    profileRows = canonicalProfileRowsForFunction(root, canonicalizerPolicy.kirLimits);
  } catch (error) {
    projectionBlocker = `projection.${projectionCode(error)}`;
  }
  const nodeOccurrences = [
    ...fact.nodeOccurrences,
    ...parameters.map(() => 'param'),
  ].sort(compareText);
  const propertyOccurrences = [
    ...fact.propertyOccurrences.filter((property) => property !== 'fn.params'),
    ...parameters.flatMap(() => ['param.name', 'param.type']),
  ].sort(compareText);
  return {
    ...fact,
    excludedProperties: [
      ...fact.excludedProperties.filter((property) => property !== 'fn.params'),
      ...(projectionBlocker === null ? [] : [projectionBlocker]),
    ].sort(compareText),
    handlerChildProfiles: handlerChildProfilesForFunction(root),
    nodeKinds: [...new Set(nodeOccurrences)].sort(compareText),
    nodeOccurrences,
    parameterRows: parameters.length,
    profileBlockers: profileBlockersForFunction(
      root,
      base,
      canonicalizerPolicy.profileLimits,
      profileRows,
    ),
    profileRows,
    propertyKeys: [...new Set(propertyOccurrences)].sort(compareText),
    propertyOccurrences,
  };
}

function combinations(values, size, start = 0, prefix = [], output = []) {
  if (prefix.length === size) {
    output.push(prefix);
    return output;
  }
  for (let index = start; index <= values.length - (size - prefix.length); index += 1) {
    combinations(values, size, index + 1, [...prefix, values[index]], output);
  }
  return output;
}

function familyOccurrences(family, functions) {
  return functions.reduce(
    (total, fn) => total +
      fn.nodeOccurrences.filter((kind) => family.nodeKinds.includes(kind)).length +
      fn.expressionOccurrences.filter((kind) => family.expressionKinds.includes(kind)).length +
      fn.propertyOccurrences.filter((key) => family.propertyKeys.includes(key)).length,
    0,
  );
}

function combinedProfile(base, families) {
  const baseNodes = new Set(base.nodeKinds);
  return {
    baseNodeKinds: baseNodes,
    expressionKinds: new Set([
      ...base.expressionKinds,
      ...families.flatMap(({ expressionKinds }) => expressionKinds),
    ]),
    nodeKinds: new Set([
      ...base.nodeKinds,
      ...families.flatMap(({ nodeKinds }) => nodeKinds),
    ]),
    propertyKeys: new Set(families.flatMap(({ propertyKeys }) => propertyKeys)),
    statementNodeKinds: new Set([
      ...recursiveStatementNodeKinds(base.nodeKinds),
      ...families.flatMap(({ nodeKinds }) => nodeKinds),
    ]),
  };
}

function closureRow(base, families, migrated, functions, profileLimits) {
  const profile = combinedProfile(base, families);
  const witnesses = migrated
    .filter((fn) => canonicalizerFunctionCompletes(profile, fn, profileLimits))
    .map((fn) => ({
      id: fn.id,
      parameterRows: fn.parameterRows,
      profileRows: fn.profileRows,
      tool: fn.tool,
    }))
    .sort((left, right) => compareText(left.id, right.id));
  return {
    completeFunctions: witnesses.length,
    completeTools: new Set(witnesses.map(({ tool }) => tool)).size,
    families: families.map(({ id }) => id).sort(compareText),
    migratedParameterRows: witnesses.reduce((total, { parameterRows }) => total + parameterRows, 0),
    occurrences: families.reduce((total, family) => total + familyOccurrences(family, functions), 0),
    witnesses,
  };
}

function closureOrder(left, right) {
  return right.completeFunctions - left.completeFunctions ||
    right.completeTools - left.completeTools ||
    right.occurrences - left.occurrences ||
    compareText(left.families.join('\u0000'), right.families.join('\u0000'));
}

function selectClosures(policy, migrated, functions, profileLimits) {
  for (let size = 1; size <= policy.families.length; size += 1) {
    const ranking = combinations(policy.families, size)
      .map((families) => closureRow(policy.base, families, migrated, functions, profileLimits))
      .filter(({ completeFunctions }) => completeFunctions > 0)
      .sort(closureOrder);
    if (ranking.length > 0) return { minimumFamilyCount: size, ranking };
  }
  fail('no active-family closure completes a counterfactual function');
}

function prerequisiteRanking(winningClosure, policy, functions) {
  return winningClosure.families
    .map((id) => {
      const family = policy.families.find((candidate) => candidate.id === id);
      if (family === undefined) fail(`missing winning family ${id}`);
      return {
        catalogFacts: family.nodeKinds.length + family.expressionKinds.length + family.propertyKeys.length,
        family: id,
        occurrences: familyOccurrences(family, functions),
      };
    })
    .sort((left, right) =>
      left.catalogFacts - right.catalogFacts ||
      right.occurrences - left.occurrences ||
      compareText(left.family, right.family));
}

export function measureCanonicalizerPrerequisite() {
  const receipt = measureCanonicalizerCoverage();
  const policy = loadCoveragePolicy();
  const canonicalizerPolicy = loadCanonicalizerPolicy();
  const roots = sourceFunctionRoots(policy);
  if (roots.size !== receipt.functions.length) fail('source functions must exactly match measured facts');
  const migrated = receipt.functions
    .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
    .map((fact) => migrateFunctionFact(fact, roots.get(fact.id), policy.base, canonicalizerPolicy));
  const selection = selectClosures(
    policy,
    migrated,
    receipt.functions,
    canonicalizerPolicy.profileLimits,
  );
  const prerequisites = prerequisiteRanking(selection.ranking[0], policy, receipt.functions);
  return {
    baseline: {
      baseCompleteFunctions: receipt.baseCompleteFunctions,
      baseId: receipt.base.id,
      canonicalizerDigest: receipt.canonicalizerDigest,
      corpusDigest: receipt.corpusDigest,
      coverageImplementationDigest: receipt.coverageImplementationDigest,
      coveragePolicyDigest: receipt.coveragePolicyDigest,
      familyRegistryDigest: receipt.familyRegistryDigest,
      functionCount: receipt.functions.length,
      functionFactsDigest: receipt.functionFactsDigest,
      legacyParameterBlockers: migrated.length,
      profileDigest: receipt.profileDigest,
      toolCount: new Set(receipt.corpus.map(({ tool }) => tool)).size,
    },
    format: FORMAT,
    minimumFamilyCount: selection.minimumFamilyCount,
    prerequisiteRanking: prerequisites,
    ranking: selection.ranking,
    selectedPrerequisite: prerequisites[0],
  };
}
