import { STRUCTURAL_KIR_NODE_CATALOG } from '../../packages/core/dist/kir-structural/catalog.generated.js';

import {
  handlerChildProfilesComplete,
  recursiveStatementNodeKinds,
} from './coverage-profile.mjs';

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function candidateCatalogRequirementsComplete(profile, fn) {
  return [...profile.statementNodeKinds].every((kind) => {
    const nodeCount = fn.nodeOccurrences.filter((observed) => observed === kind).length;
    if (nodeCount === 0) return true;
    const contract = STRUCTURAL_KIR_NODE_CATALOG.get(kind);
    return contract !== undefined && Object.entries(contract.properties).every(([name, property]) =>
      !property.required ||
      (!property.disposition.startsWith('excluded-') &&
        fn.propertyOccurrences.filter((observed) => observed === `${kind}.${name}`).length === nodeCount),
    );
  });
}

export function canonicalizerFunctionCompletes(profile, fn, profileLimits) {
  const requiredFacts = [
    fn.excludedProperties,
    fn.profileBlockers,
    fn.handlerChildProfiles,
    fn.nodeKinds,
    fn.expressionKinds,
    fn.propertyKeys,
  ];
  return requiredFacts.every(Array.isArray) &&
    fn.profileRows !== null &&
    fn.profileRows.nodes <= profileLimits.maxNodeRows &&
    fn.profileRows.properties <= profileLimits.maxPropertyRows &&
    fn.profileRows.values <= profileLimits.maxValueRows &&
    fn.excludedProperties.length === 0 &&
    fn.profileBlockers.length === 0 &&
    candidateCatalogRequirementsComplete(profile, fn) &&
    handlerChildProfilesComplete(profile, fn.handlerChildProfiles) &&
    fn.nodeKinds.every((kind) => profile.nodeKinds.has(kind)) &&
    fn.expressionKinds.every((kind) => profile.expressionKinds.has(kind)) &&
    fn.propertyKeys.every((propertyKey) => {
      const nodeKind = propertyKey.slice(0, propertyKey.indexOf('.'));
      return profile.baseNodeKinds.has(nodeKind) || profile.propertyKeys.has(propertyKey);
    });
}

export function canonicalizerCompletionProfile(base, families) {
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

export function rankCanonicalizerFamilies(policy, functions, profileLimits) {
  const baseProfile = canonicalizerCompletionProfile(policy.base, []);
  const ranking = policy.families.map((family) => {
    const profile = canonicalizerCompletionProfile(policy.base, [family]);
    const newlyComplete = functions.filter((fn) =>
      !canonicalizerFunctionCompletes(baseProfile, fn, profileLimits) &&
      canonicalizerFunctionCompletes(profile, fn, profileLimits),
    );
    const tools = new Set(newlyComplete.map(({ tool }) => tool));
    const occurrences = functions.reduce(
      (total, fn) => total + fn.nodeOccurrences.filter((kind) => family.nodeKinds.includes(kind)).length +
        fn.expressionOccurrences.filter((kind) => family.expressionKinds.includes(kind)).length +
        fn.propertyOccurrences.filter((key) => family.propertyKeys.includes(key)).length,
      0,
    );
    return {
      completeFunctions: newlyComplete.length,
      completeTools: tools.size,
      id: family.id,
      occurrences,
      witnesses: newlyComplete.map(({ id }) => id).sort(compareText),
    };
  }).sort((left, right) =>
    right.completeFunctions - left.completeFunctions ||
    right.completeTools - left.completeTools ||
    right.occurrences - left.occurrences ||
    compareText(left.id, right.id),
  );
  const winner = ranking[0]?.completeFunctions > 0 ? ranking[0] : null;
  return { ranking, winner };
}
