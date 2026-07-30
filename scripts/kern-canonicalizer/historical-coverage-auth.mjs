import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const AUTHENTICATED_HISTORICAL_BASES = new WeakSet();
const AUTHENTICATED_HISTORICAL_POLICIES = new WeakSet();
const HISTORICAL_POLICY_DIGESTS = new Set([
  '0285747660651cab2ee1029456dc40c190c42d2515937fa6d3534247df363b54',
  '04a61b18126cac0ddd723fef2686ae2f77c0bba6501c11dee6756fc3c0b0d400',
  '2091c8c213efd5b006bc22f183f47bd7a651ec21779efe66b1670b1019fbaaf0',
  '254f089ec5d7c0162144aaf78114d33ed603c5cca04ae484f53111c7a83e5d9c',
  'bb64551fcdbacd85759a86f9cd7703ffe7fa14505cfe1a935223d7fe2b953534',
  'dcc9cc2db3478bd92370a373cf519ef192365bc8181bc5c726a9cce5bd4d80d6',
]);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mark(policy) {
  if (!object(policy) || !object(policy.base)) {
    throw new TypeError('historical coverage authentication requires a policy with a base');
  }
  AUTHENTICATED_HISTORICAL_BASES.add(policy.base);
  AUTHENTICATED_HISTORICAL_POLICIES.add(policy);
  return policy;
}

export function authenticateHistoricalCoveragePolicy(policy, policySource) {
  let parsed;
  const source = Buffer.from(policySource);
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    throw new TypeError('historical coverage authentication requires canonical archived JSON');
  }
  const digest = createHash('sha256').update(source).digest('hex');
  if (!HISTORICAL_POLICY_DIGESTS.has(digest) || !isDeepStrictEqual(policy, parsed)) {
    throw new TypeError('historical coverage authentication requires exact archived policy bytes');
  }
  return mark(policy);
}

export function carryHistoricalCoverageAuthentication(source, target) {
  if (!isAuthenticatedHistoricalCoveragePolicy(source)) return target;
  const exact = Reflect.ownKeys(target).length === 1
    ? isDeepStrictEqual(target.base, source.base)
    : isDeepStrictEqual(target, source);
  if (!exact) {
    throw new TypeError('historical coverage authentication cannot carry across policy drift');
  }
  return mark(target);
}

export function isAuthenticatedHistoricalCoverageBase(base) {
  return object(base) && AUTHENTICATED_HISTORICAL_BASES.has(base);
}

export function isAuthenticatedHistoricalCoveragePolicy(policy) {
  return object(policy) && AUTHENTICATED_HISTORICAL_POLICIES.has(policy);
}
