import { createHash } from 'node:crypto';

import { reconstructHistoricalSource } from './historical-source.mjs';

const DIGEST = /^[0-9a-f]{64}$/u;
const CLAIM = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const STAGE_KEYS = Object.freeze(['claim', 'path', 'predecessorDigest', 'replacements', 'successorDigest']);

function fail(milestone, message) {
  throw new TypeError(`${milestone} historical transition chain rejection: ${message}`);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalPath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

function validateStage(stage, path, milestone, index) {
  const keys = stage && typeof stage === 'object' ? Reflect.ownKeys(stage) : [];
  if (
    stage === null ||
    typeof stage !== 'object' ||
    Array.isArray(stage) ||
    Object.getPrototypeOf(stage) !== Object.prototype ||
    keys.length !== STAGE_KEYS.length ||
    keys.some((key, keyIndex) => key !== STAGE_KEYS[keyIndex])
  ) {
    fail(milestone, `stages[${index}] must be exact plain transition data`);
  }
  if (!CLAIM.test(stage.claim)) fail(milestone, `stages[${index}].claim is invalid`);
  if (stage.path !== path) fail(milestone, `stages[${index}].path must remain ${path}`);
  if (!DIGEST.test(stage.successorDigest)) fail(milestone, `stages[${index}].successorDigest is invalid`);
  if (!DIGEST.test(stage.predecessorDigest)) fail(milestone, `stages[${index}].predecessorDigest is invalid`);
  if (!Array.isArray(stage.replacements) || stage.replacements.length === 0) {
    fail(milestone, `stages[${index}].replacements must be nonempty`);
  }
}

export function historicalTransitionStage({ claim, path, currentDigest, expectedDigest, replacements }) {
  return Object.freeze({
    claim,
    path,
    predecessorDigest: expectedDigest,
    replacements,
    successorDigest: currentDigest,
  });
}

export function reconstructHistoricalTransitionChain({
  currentSource,
  expectedTerminalDigest,
  milestone,
  path,
  stages,
}) {
  if (typeof milestone !== 'string' || milestone.length === 0) fail('historical', 'milestone is required');
  if (!canonicalPath(path)) fail(milestone, 'path must be normalized and relative');
  if (!Array.isArray(stages) || stages.length === 0) fail(milestone, 'stages must be nonempty');
  if (!DIGEST.test(expectedTerminalDigest)) fail(milestone, 'expectedTerminalDigest is invalid');
  let bytes = Buffer.from(currentSource);
  const claims = new Set();
  for (const [index, stage] of stages.entries()) {
    validateStage(stage, path, milestone, index);
    if (claims.has(stage.claim)) fail(milestone, `duplicate claim ${stage.claim}`);
    claims.add(stage.claim);
    const incomingDigest = digest(bytes);
    if (incomingDigest !== stage.successorDigest) {
      fail(milestone, `stage ${stage.claim} has a broken or misordered successor edge`);
    }
    bytes = reconstructHistoricalSource({
      currentSource: bytes,
      expectedDigest: stage.predecessorDigest,
      milestone: `${milestone} ${stage.claim}`,
      replacements: stage.replacements,
    });
  }
  if (digest(bytes) !== expectedTerminalDigest) fail(milestone, 'terminal digest does not match the complete chain');
  return bytes;
}

export function indexHistoricalTransitionStages(stageGroups, milestone) {
  if (!Array.isArray(stageGroups) || stageGroups.length === 0) fail(milestone, 'stage groups must be nonempty');
  const indexed = new Map();
  for (const [groupIndex, group] of stageGroups.entries()) {
    if (!Array.isArray(group)) fail(milestone, `stageGroups[${groupIndex}] must be an array`);
    for (const stage of group) {
      if (!canonicalPath(stage?.path)) fail(milestone, `stageGroups[${groupIndex}] has an invalid path`);
      const pathStages = indexed.get(stage.path) ?? [];
      if (pathStages.some((candidate) => candidate.claim === stage.claim)) {
        fail(milestone, `duplicate producer ${stage.claim} for ${stage.path}`);
      }
      pathStages.push(stage);
      indexed.set(stage.path, pathStages);
    }
  }
  return indexed;
}
