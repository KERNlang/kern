import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const FORMAT = 'kern.kir-canonicalizer.implementation-handoff.1';
const EXCEPTION_FLOW_IMPLEMENTATION_HANDOFF = Object.freeze({
  digest: 'c9f9d4610800ca53cdec00f5d519d6c1ebaa3e76d26734ebcc69cb3c21ff7753',
  source: readFileSync(
    new URL('./coverage-exception-flow-implementation-handoff.json', import.meta.url),
  ),
});

function fail(message) {
  throw new TypeError(`implementation handoff rejection: ${message}`);
}

function plainRecord(value, fields, label, seen) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be a record`);
  }
  if (seen.has(value)) fail(`${label} must not share object identity`);
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} must be a plain record`);
  }
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some((key) => typeof key !== 'string')) fail(`${label} contains symbol fields`);
  if (keys.some((key) => {
    const descriptor = descriptors[key];
    return descriptor.get || descriptor.set || !descriptor.enumerable;
  })) {
    fail(`${label} must be inspectable plain data`);
  }
  const actual = [...keys].sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly ${expected.join(',')}`);
  }
  return value;
}

function plainArray(value, length, label, seen) {
  if (!Array.isArray(value) || value.length !== length) {
    fail(`${label} must contain exactly ${length} items`);
  }
  if (seen.has(value)) fail(`${label} must not share object identity`);
  seen.add(value);
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${label} must be a plain array`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) fail(`${label} contains symbol fields`);
  const expectedKeys = Array.from({ length }, (_, index) => String(index));
  expectedKeys.push('length');
  const actualKeys = [...keys].sort();
  expectedKeys.sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail(`${label} must be dense and undecorated`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const items = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail(`${label} must be inspectable plain data`);
    }
    items.push(descriptor.value);
  }
  return items;
}

function text(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be non-empty text`);
  return value;
}

function sha256(value, label) {
  const digest = text(value, label);
  if (!/^[0-9a-f]{64}$/u.test(digest)) fail(`${label} must be lowercase SHA-256`);
  return digest;
}

function commit(value, label) {
  const objectId = text(value, label);
  if (!/^[0-9a-f]{40}$/u.test(objectId)) fail(`${label} must be a full lowercase git object id`);
  return objectId;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function implementationHandoffTargetIdentity(target) {
  return {
    bodyDigest: target.bodyDigest,
    functionOrdinal: target.functionOrdinal,
    id: target.id,
    name: target.name,
    path: target.path,
    sourceSha256: target.sourceSha256,
  };
}

function validateTarget(input, index, seen) {
  const label = `targets[${index}]`;
  const value = plainRecord(
    input,
    ['bodyDigest', 'functionOrdinal', 'id', 'name', 'path', 'sourceSha256'],
    label,
    seen,
  );
  return {
    bodyDigest: sha256(value.bodyDigest, `${label}.bodyDigest`),
    functionOrdinal: nonNegativeInteger(value.functionOrdinal, `${label}.functionOrdinal`),
    id: text(value.id, `${label}.id`),
    name: text(value.name, `${label}.name`),
    path: text(value.path, `${label}.path`),
    sourceSha256: sha256(value.sourceSha256, `${label}.sourceSha256`),
  };
}

export function validateCanonicalizerImplementationHandoff(input) {
  const seen = new WeakSet();
  const value = plainRecord(
    input,
    ['family', 'format', 'milestone', 'prerequisite', 'source', 'targets'],
    'handoff',
    seen,
  );
  if (value.format !== FORMAT) fail(`format must be ${FORMAT}`);
  const prerequisiteInput = plainRecord(
    value.prerequisite,
    ['digest', 'family'],
    'prerequisite',
    seen,
  );
  const sourceInput = plainRecord(
    value.source,
    [
      'canonicalizerSha256',
      'commit',
      'coverageImplementationDigest',
      'coveragePolicySha256',
      'coverageSummaryFormat',
      'coverageSummarySha256',
      'prerequisiteSummaryFormat',
      'prerequisiteSummarySha256',
    ],
    'source',
    seen,
  );
  const targetInputs = plainArray(value.targets, 2, 'targets', seen);
  const targets = targetInputs.map((target, index) => validateTarget(target, index, seen));
  if (
    new Set(targets.map(({ id }) => id)).size !== targets.length ||
    targets.some(({ id }, index) => index > 0 && targets[index - 1].id >= id)
  ) {
    fail('targets must be sorted and unique by id');
  }
  if (targets.some((target) =>
    target.id !== `${target.path}#${target.functionOrdinal}:${target.name}`)) {
    fail('target ids must match path, ordinal, and name');
  }
  const family = text(value.family, 'family');
  const prerequisiteFamily = text(prerequisiteInput.family, 'prerequisite.family');
  if (prerequisiteFamily !== family) fail('prerequisite family must match handoff family');
  return {
    family,
    format: FORMAT,
    milestone: text(value.milestone, 'milestone'),
    prerequisite: {
      digest: sha256(prerequisiteInput.digest, 'prerequisite.digest'),
      family: prerequisiteFamily,
    },
    source: {
      canonicalizerSha256: sha256(sourceInput.canonicalizerSha256, 'source.canonicalizerSha256'),
      commit: commit(sourceInput.commit, 'source.commit'),
      coverageImplementationDigest: sha256(
        sourceInput.coverageImplementationDigest,
        'source.coverageImplementationDigest',
      ),
      coveragePolicySha256: sha256(
        sourceInput.coveragePolicySha256,
        'source.coveragePolicySha256',
      ),
      coverageSummaryFormat: text(
        sourceInput.coverageSummaryFormat,
        'source.coverageSummaryFormat',
      ),
      coverageSummarySha256: sha256(
        sourceInput.coverageSummarySha256,
        'source.coverageSummarySha256',
      ),
      prerequisiteSummaryFormat: text(
        sourceInput.prerequisiteSummaryFormat,
        'source.prerequisiteSummaryFormat',
      ),
      prerequisiteSummarySha256: sha256(
        sourceInput.prerequisiteSummarySha256,
        'source.prerequisiteSummarySha256',
      ),
    },
    targets,
  };
}

function canonicalValidatedImplementationHandoffBytes(record) {
  return Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
}

export function canonicalImplementationHandoffBytes(input) {
  return canonicalValidatedImplementationHandoffBytes(
    validateCanonicalizerImplementationHandoff(input),
  );
}

export function validateCanonicalizerExceptionFlowImplementationHandoff(input) {
  const record = validateCanonicalizerImplementationHandoff(input);
  const digest = createHash('sha256')
    .update(canonicalValidatedImplementationHandoffBytes(record))
    .digest('hex');
  if (digest !== EXCEPTION_FLOW_IMPLEMENTATION_HANDOFF.digest) {
    fail('exception-flow handoff must match the exact published M4.139 implementation');
  }
  return { digest, record };
}

export function loadCanonicalizerExceptionFlowImplementationHandoff() {
  const parsed = JSON.parse(EXCEPTION_FLOW_IMPLEMENTATION_HANDOFF.source.toString('utf8'));
  const handoff = validateCanonicalizerExceptionFlowImplementationHandoff(parsed);
  if (!EXCEPTION_FLOW_IMPLEMENTATION_HANDOFF.source.equals(
    canonicalValidatedImplementationHandoffBytes(handoff.record),
  )) {
    fail('checked-in implementation handoff must use canonical JSON bytes');
  }
  return handoff;
}
