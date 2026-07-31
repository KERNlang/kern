import { isDeepStrictEqual } from 'node:util';

import {
  M4150_CANDIDATE_PREDICATE,
  QUOTESOURCE_M4150_PATH,
} from './quotesource-rewrite-m4-150-target.mjs';

const QUOTESOURCE_ID =
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource';
const EXPECTED_QUEUE = {
  completeFunctions: 1,
  completeTools: 1,
  migratedParameterRows: 2,
  witnesses: [{
    id: QUOTESOURCE_ID,
    parameterRows: 2,
    profileRows: { nodes: 54, properties: 82, values: 932 },
    tool: 'canonicalizer',
  }],
};

function exactPlainObject(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).every((key) => typeof key === 'string') &&
    isDeepStrictEqual(Reflect.ownKeys(value).toSorted(), keys.toSorted());
}

export function formatM4150QuotesourceRewriteStatus(
  rewrite,
  coverage,
  prerequisite,
) {
  const fact = coverage?.functions?.find(({ id }) => id === QUOTESOURCE_ID);
  if (
    !exactPlainObject(rewrite, [
      'format', 'input', 'parameterMigration', 'selectedNextAction', 'source',
    ]) ||
    !exactPlainObject(rewrite.input, [
      'm4149Digest', 'm4149InputCommit', 'm4150InputCommit',
    ]) ||
    !exactPlainObject(rewrite.source, [
      'afterDigest', 'beforeDigest', 'path', 'predicate',
    ]) ||
    !exactPlainObject(rewrite.selectedNextAction, [
      'action', 'milestone', 'witness',
    ]) ||
    rewrite?.format !== 'kern.kir-canonicalizer.quotesource-rewrite.1' ||
    rewrite.input?.m4149Digest !==
      'bca47b2e75cd13cbbaa3b54e7e98e92f515e44f15cf92e3edea8c8c6bf59dc1d' ||
    rewrite.input?.m4149InputCommit !==
      '44ca4feda2901c16f79c7c5c40ede69394e60404' ||
    rewrite.input?.m4150InputCommit !==
      '864017b4200a6a3bc51b8d9e30cc61145eef6951' ||
    rewrite.source?.afterDigest !==
      '2073ed0c915c0375a43accc202e1c99ceacef84ec1972ef2fc6d25ebcdf7986a' ||
    rewrite.source?.beforeDigest !==
      'c32414ee7aa6f29d092dc21de5065f04c4054c54d070dd4d964763047170ee2f' ||
    rewrite.source?.path !== QUOTESOURCE_M4150_PATH ||
    rewrite.source?.predicate !== M4150_CANDIDATE_PREDICATE ||
    rewrite.selectedNextAction?.milestone !== 'M4.151' ||
    rewrite.selectedNextAction?.action !== 'consume-exact-parameter-queue' ||
    rewrite.selectedNextAction?.witness !== QUOTESOURCE_ID ||
    !isDeepStrictEqual(rewrite.parameterMigration, EXPECTED_QUEUE) ||
    coverage?.baseCompleteFunctions !== 111 ||
    coverage?.functions?.length !== 112 ||
    coverage?.canonicalizerDigest !==
      'd3671c6647993e13cc09e3ebb9ffb18a20009b27761d2d8bb29a2a64d093b8c2' ||
    coverage?.coveragePolicyDigest !==
      '45693b57321d2ab074be68657682524c6621f9081a94c32ecbd653534d0cf3bf' ||
    fact?.firstUnsupported?.value !== 'fn.params' ||
    !isDeepStrictEqual(fact?.excludedProperties, ['fn.params']) ||
    !isDeepStrictEqual(fact?.profileBlockers, []) ||
    prerequisite?.outcome !== 'parameter-ready' ||
    prerequisite.exhaustion !== null ||
    prerequisite.minimumFamilyCount !== null ||
    prerequisite.selectedPrerequisite !== null ||
    !isDeepStrictEqual(prerequisite.prerequisiteRanking, []) ||
    !isDeepStrictEqual(prerequisite.ranking, []) ||
    !isDeepStrictEqual(prerequisite.parameterMigration, EXPECTED_QUEUE)
  ) {
    throw new TypeError('M4.150 must publish the exact quotesource rewrite frontier');
  }
  return 'M4.150 applies the exact M4.149 quotesource neighbor-sentinel rewrite and clears ' +
    'all six canonical-surface blockers; the base remains 111/112 with only fn.params and ' +
    'exposes the exact 1-function/2-row parameter queue; M4.151 consumes it.';
}
