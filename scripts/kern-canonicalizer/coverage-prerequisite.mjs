import { createHash } from 'node:crypto';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { isPortableBindingName } from '../../packages/core/dist/ir/semantics/portable-scalar-domain.js';

import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
  readCorpusMemberBytes,
} from './coverage.mjs';
import {
  canonicalProfileRowsForFunction,
  handlerChildProfilesForFunction,
  profileBlockersForFunction,
} from './coverage-profile.mjs';
import {
  canonicalizerCompletionProfile,
  canonicalizerFunctionCompletes,
} from './coverage-selection.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const FORMAT = 'kern.kir-canonicalizer.prerequisite-summary.3';
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
      !isPortableBindingName(parts[0]) ||
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
    !Array.isArray(sourceRoot.children)
  ) {
    fail('legacy function must be a function without direct parameter children');
  }
  const directParameters = sourceRoot.children.filter(({ type }) => type === 'param');
  if (directParameters.length > 0) {
    if (typeof sourceRoot.props?.params === 'string') {
      fail('legacy function must be a function without direct parameter children');
    }
    const firstNonParameter = sourceRoot.children
      .findIndex(({ type }) => type !== 'param');
    if (
      firstNonParameter === 0 ||
      sourceRoot.children.slice(firstNonParameter).some(({ type }) => type === 'param') ||
      directParameters.some((parameter) =>
        parameter === null ||
        typeof parameter !== 'object' ||
        !Array.isArray(parameter.children) ||
        parameter.children.length !== 0 ||
        parameter.props === null ||
        typeof parameter.props !== 'object' ||
        Array.isArray(parameter.props) ||
        Object.keys(parameter.props).sort().join(',') !== 'name,type' ||
        (parameter.__quotedProps?.length ?? 0) !== 0
      )
    ) {
      fail('direct parameters must be one exact canonical prefix');
    }
    const parameters = exactLegacyParameters(
      directParameters.map(({ props }) => `${props.name}:${props.type}`).join(','),
    );
    return { parameters, root: structuredClone(sourceRoot) };
  }
  const root = structuredClone(sourceRoot);
  const parameters = exactLegacyParameters(root.props?.params);
  delete root.props.params;
  if (Array.isArray(root.__quotedProps)) {
    root.__quotedProps = root.__quotedProps.filter((property) => property !== 'params');
    if (root.__quotedProps.length === 0) delete root.__quotedProps;
  }
  root.children = [
    ...parameters.map(({ name, type }) => ({ children: [], props: { name, type }, type: 'param' })),
    ...root.children,
  ];
  return { parameters, root };
}

export function sourceFunctionRoots(policy) {
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

export function migrateFunctionFact(fact, sourceRoot, base, canonicalizerPolicy) {
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

function closureRow(base, families, migrated, functions, profileLimits) {
  const profile = canonicalizerCompletionProfile(base, families);
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
  let evaluatedNonEmptyClosureCount = 0;
  for (let size = 1; size <= policy.families.length; size += 1) {
    const closures = combinations(policy.families, size)
      .map((families) => closureRow(policy.base, families, migrated, functions, profileLimits));
    evaluatedNonEmptyClosureCount += closures.length;
    const ranking = closures
      .filter(({ completeFunctions }) => completeFunctions > 0)
      .sort(closureOrder);
    if (ranking.length > 0) {
      return { evaluatedNonEmptyClosureCount, minimumFamilyCount: size, outcome: 'selected', ranking };
    }
  }
  return {
    evaluatedNonEmptyClosureCount,
    minimumFamilyCount: null,
    outcome: 'bounded-exhaustion',
    ranking: [],
  };
}

export function partitionMigratedFunctions(base, migrated, profileLimits) {
  const profile = canonicalizerCompletionProfile(base, []);
  const parameterReady = [];
  const residual = [];
  for (const fn of migrated) {
    const partition = canonicalizerFunctionCompletes(profile, fn, profileLimits)
      ? parameterReady
      : residual;
    partition.push(fn);
  }
  return { parameterReady, residual };
}

function parameterMigrationRow(parameterReady) {
  const witnesses = parameterReady
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
    migratedParameterRows: witnesses.reduce((total, { parameterRows }) => total + parameterRows, 0),
    witnesses,
  };
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

function boundedExhaustion(policy, residual, evaluatedNonEmptyClosureCount) {
  const assignments = residual
    .map((fn) => {
      const reasons = [...new Set([...fn.excludedProperties, ...fn.profileBlockers])].sort(compareText);
      if (reasons.length === 0) fail(`residual function ${fn.id} has no authenticated exhaustion reason`);
      return { id: fn.id, reasons };
    })
    .sort((left, right) => compareText(left.id, right.id));
  const counts = new Map();
  for (const { reasons } of assignments) {
    for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return {
    activeFamilies: policy.families.map(({ id }) => id),
    completingClosureCount: 0,
    evaluatedNonEmptyClosureCount,
    reasonAssignmentsDigest: createHash('sha256').update(JSON.stringify(assignments)).digest('hex'),
    reasonCounts: [...counts]
      .map(([id, count]) => ({ count, id }))
      .sort((left, right) => compareText(left.id, right.id)),
    residualFunctionCount: residual.length,
    scope: 'current-bounded-profile',
  };
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Reflect.ownKeys(value).every((key) => typeof key === 'string') &&
    JSON.stringify(Reflect.ownKeys(value).toSorted()) === JSON.stringify(keys);
}

function exactWitness(value, policy) {
  const match = typeof value?.id === 'string'
    ? /^(.*)#(0|[1-9][0-9]*):(.+)$/u.exec(value.id)
    : null;
  return exactKeys(value, ['id', 'parameterRows', 'profileRows', 'tool']) &&
    match !== null &&
    policy.corpus.some(({ path, tool }) => path === match[1] && tool === value.tool) &&
    (isPortableBindingName(match[3]) || match[3] === `fn-${match[2]}`) &&
    Number.isSafeInteger(value.parameterRows) && value.parameterRows > 0 &&
    exactKeys(value.profileRows, ['nodes', 'properties', 'values']) &&
    Object.values(value.profileRows).every((count) => Number.isSafeInteger(count) && count > 0);
}

function exactMigration(value, policy) {
  if (
    !exactKeys(value, ['completeFunctions', 'completeTools', 'migratedParameterRows', 'witnesses']) ||
    !Array.isArray(value.witnesses) || value.witnesses.some((witness) => !exactWitness(witness, policy)) ||
    value.witnesses.some(({ id }, index) => index > 0 && value.witnesses[index - 1].id >= id)
  ) return false;
  return value.completeFunctions === value.witnesses.length &&
    value.completeTools === new Set(value.witnesses.map(({ tool }) => tool)).size &&
    value.migratedParameterRows === value.witnesses.reduce((total, row) => total + row.parameterRows, 0);
}

function exactBaseline(value, policy) {
  const keys = [
    'baseCompleteFunctions', 'baseId', 'canonicalizerDigest', 'canonicalizerPolicyDigest',
    'compiledCoreDigest', 'corpusDigest', 'coverageImplementationDigest', 'coveragePolicyDigest',
    'familyRegistryDigest', 'functionCount', 'functionFactsDigest', 'legacyParameterBlockers',
    'profileDigest', 'toolCount',
  ];
  const digests = keys.filter((key) => key.endsWith('Digest'));
  return exactKeys(value, keys) && value.baseId === policy.base.id &&
    digests.every((key) => /^[0-9a-f]{64}$/u.test(value[key])) &&
    Number.isSafeInteger(value.functionCount) && value.functionCount > 0 &&
    Number.isSafeInteger(value.toolCount) && value.toolCount > 0 &&
    Number.isSafeInteger(value.baseCompleteFunctions) && value.baseCompleteFunctions >= 0 &&
    Number.isSafeInteger(value.legacyParameterBlockers) && value.legacyParameterBlockers >= 0 &&
    value.baseCompleteFunctions + value.legacyParameterBlockers <= value.functionCount &&
    value.toolCount <= new Set(policy.corpus.map(({ tool }) => tool)).size;
}

function exactPrerequisiteRow(value) {
  return exactKeys(value, ['catalogFacts', 'family', 'occurrences']) &&
    Number.isSafeInteger(value.catalogFacts) && value.catalogFacts > 0 &&
    typeof value.family === 'string' && value.family.length > 0 &&
    Number.isSafeInteger(value.occurrences) && value.occurrences > 0;
}

function exactClosureRow(value, familyCount, migratedIds, policy) {
  const familyIds = new Set(policy.families.map(({ id }) => id));
  if (
    !exactKeys(value, [
      'completeFunctions', 'completeTools', 'families', 'migratedParameterRows', 'occurrences', 'witnesses',
    ]) || !Array.isArray(value.families) || value.families.length !== familyCount ||
    value.families.some((family) => !familyIds.has(family)) ||
    JSON.stringify(value.families) !== JSON.stringify([...new Set(value.families)].sort(compareText)) ||
    !Array.isArray(value.witnesses) || value.witnesses.length === 0 ||
    value.witnesses.some((witness) => !exactWitness(witness, policy) || migratedIds.has(witness.id)) ||
    new Set(value.witnesses.map(({ id }) => id)).size !== value.witnesses.length ||
    !Number.isSafeInteger(value.occurrences) || value.occurrences < 1
  ) return false;
  return value.completeFunctions === value.witnesses.length &&
    value.completeTools === new Set(value.witnesses.map(({ tool }) => tool)).size &&
    value.migratedParameterRows === value.witnesses.reduce((total, row) => total + row.parameterRows, 0);
}

function validateCanonicalizerPrerequisiteSummaryAgainst(summary, policy, expected) {
  const keys = [
    'baseline', 'exhaustion', 'format', 'minimumFamilyCount', 'outcome', 'parameterMigration',
    'prerequisiteRanking', 'ranking', 'selectedPrerequisite',
  ];
  if (!exactKeys(summary, keys) || summary.format !== FORMAT) fail('invalid format-3 summary shape');
  if (
    !Array.isArray(summary.prerequisiteRanking) || !Array.isArray(summary.ranking) ||
    !exactBaseline(summary.baseline, policy) || !exactMigration(summary.parameterMigration, policy) ||
    summary.parameterMigration.completeFunctions > summary.baseline.legacyParameterBlockers ||
    summary.parameterMigration.completeTools > summary.baseline.toolCount
  ) {
    fail('format-3 rankings must be arrays');
  }
  if (summary.outcome === 'selected') {
    const migratedIds = new Set(summary.parameterMigration.witnesses.map(({ id }) => id));
    if (
      !Number.isSafeInteger(summary.minimumFamilyCount) || summary.minimumFamilyCount < 1 ||
      summary.selectedPrerequisite === null || summary.prerequisiteRanking.length === 0 ||
      summary.ranking.length === 0 || summary.exhaustion !== null ||
      summary.prerequisiteRanking.some((row) => !exactPrerequisiteRow(row)) ||
      new Set(summary.prerequisiteRanking.map(({ family }) => family)).size !==
        summary.prerequisiteRanking.length ||
      JSON.stringify(summary.selectedPrerequisite) !== JSON.stringify(summary.prerequisiteRanking[0]) ||
      summary.ranking.some((row) =>
        !exactClosureRow(row, summary.minimumFamilyCount, migratedIds, policy)) ||
      summary.ranking.some((row, index) => index > 0 && closureOrder(summary.ranking[index - 1], row) > 0) ||
      JSON.stringify(summary.prerequisiteRanking.map(({ family }) => family).sort(compareText)) !==
        JSON.stringify(summary.ranking[0].families)
    ) {
      fail('selected format-3 summary must contain a positive winning closure');
    }
  } else {
    if (
      summary.outcome !== 'bounded-exhaustion' || summary.minimumFamilyCount !== null ||
      summary.selectedPrerequisite !== null || summary.prerequisiteRanking.length !== 0 ||
      summary.ranking.length !== 0
    ) {
      fail('bounded-exhaustion format-3 summary must have a null selection and empty rankings');
    }
    const exhaustionKeys = [
      'activeFamilies', 'completingClosureCount', 'evaluatedNonEmptyClosureCount',
      'reasonAssignmentsDigest', 'reasonCounts', 'residualFunctionCount', 'scope',
    ];
    const exhaustion = summary.exhaustion;
    const expectedFamilies = policy.families.map(({ id }) => id);
    if (
      !exactKeys(exhaustion, exhaustionKeys) || exhaustion.scope !== 'current-bounded-profile' ||
      JSON.stringify(exhaustion.activeFamilies) !== JSON.stringify(expectedFamilies) ||
      exhaustion.completingClosureCount !== 0 ||
      exhaustion.evaluatedNonEmptyClosureCount !== (2 ** exhaustion.activeFamilies.length) - 1 ||
      !Number.isSafeInteger(exhaustion.residualFunctionCount) || exhaustion.residualFunctionCount < 1 ||
      !Number.isSafeInteger(summary.baseline?.legacyParameterBlockers) ||
      !Number.isSafeInteger(summary.parameterMigration?.completeFunctions) ||
      exhaustion.residualFunctionCount + summary.parameterMigration.completeFunctions !==
        summary.baseline.legacyParameterBlockers ||
      !/^[0-9a-f]{64}$/u.test(exhaustion.reasonAssignmentsDigest) ||
      !Array.isArray(exhaustion.reasonCounts) || exhaustion.reasonCounts.length === 0 ||
      exhaustion.reasonCounts.some((row, index) =>
        !exactKeys(row, ['count', 'id']) || !Number.isSafeInteger(row.count) || row.count < 1 ||
        row.count > exhaustion.residualFunctionCount || typeof row.id !== 'string' || row.id.length === 0 ||
        (index > 0 && compareText(exhaustion.reasonCounts[index - 1].id, row.id) >= 0))
    ) {
      fail('invalid bounded-exhaustion evidence');
    }
  }
  if (JSON.stringify(summary) !== JSON.stringify(expected)) fail('summary must match authenticated measurement');
  return summary;
}

function buildCanonicalizerPrerequisiteSummary(policy) {
  const receipt = measureCanonicalizerCoverage(policy);
  const canonicalizerPolicy = loadCanonicalizerPolicy();
  const roots = sourceFunctionRoots(policy);
  if (roots.size !== receipt.functions.length) fail('source functions must exactly match measured facts');
  const migrated = receipt.functions
    .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
    .map((fact) => migrateFunctionFact(fact, roots.get(fact.id), policy.base, canonicalizerPolicy));
  const { parameterReady, residual } = partitionMigratedFunctions(
    policy.base,
    migrated,
    canonicalizerPolicy.profileLimits,
  );
  const parameterMigration = parameterMigrationRow(parameterReady);
  if (residual.length === 0) fail('no residual functions remain after base-only parameter migration');
  const selection = selectClosures(policy, residual, receipt.functions, canonicalizerPolicy.profileLimits);
  const prerequisites = selection.outcome === 'selected'
    ? prerequisiteRanking(selection.ranking[0], policy, receipt.functions)
    : [];
  const summary = {
    baseline: {
      baseCompleteFunctions: receipt.baseCompleteFunctions,
      baseId: receipt.base.id,
      canonicalizerDigest: receipt.canonicalizerDigest,
      canonicalizerPolicyDigest: receipt.canonicalizerPolicyDigest,
      compiledCoreDigest: receipt.compiledCoreDigest,
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
    exhaustion: selection.outcome === 'bounded-exhaustion'
      ? boundedExhaustion(policy, residual, selection.evaluatedNonEmptyClosureCount)
      : null,
    format: FORMAT,
    minimumFamilyCount: selection.minimumFamilyCount,
    outcome: selection.outcome,
    parameterMigration,
    prerequisiteRanking: prerequisites,
    ranking: selection.ranking,
    selectedPrerequisite: prerequisites[0] ?? null,
  };
  return summary;
}

export function validateCanonicalizerPrerequisiteSummary(summary, policy = loadCoveragePolicy()) {
  return validateCanonicalizerPrerequisiteSummaryAgainst(
    summary, policy, buildCanonicalizerPrerequisiteSummary(policy),
  );
}

export function measureCanonicalizerPrerequisite() {
  const policy = loadCoveragePolicy();
  const summary = buildCanonicalizerPrerequisiteSummary(policy);
  return validateCanonicalizerPrerequisiteSummaryAgainst(summary, policy, summary);
}
