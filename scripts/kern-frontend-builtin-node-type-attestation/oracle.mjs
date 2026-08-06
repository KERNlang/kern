import { readFileSync } from 'node:fs';

import { normalizeNodeTypeTokenAdmissionOracle } from '../kern-frontend-node-type-token-admission/oracle.mjs';

const CATALOG = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

function independentCatalog(policy) {
  if (
    CATALOG === null || typeof CATALOG !== 'object' || Array.isArray(CATALOG) ||
    CATALOG.format !== policy.builtinNodeCatalogFormat || CATALOG.constant !== 'NODE_TYPES' ||
    CATALOG.sourcePath !== 'packages/core/src/spec.ts' || !Array.isArray(CATALOG.nodeTypes) ||
    CATALOG.nodeTypes.length === 0 || CATALOG.nodeTypes.length > policy.maxCatalogEntries ||
    CATALOG.nodeTypes.some((value) => typeof value !== 'string') ||
    new Set(CATALOG.nodeTypes).size !== CATALOG.nodeTypes.length
  ) throw new TypeError('independent built-in catalog is invalid');
  return CATALOG.nodeTypes;
}

export function normalizeBuiltinNodeTypeAttestationOracle(content, policy) {
  const inherited = normalizeNodeTypeTokenAdmissionOracle(content, policy);
  if ('status' in inherited) return failure(inherited.code, inherited.detail);
  const catalog = independentCatalog(policy);
  let attestation = 'none';
  let catalogIndex = null;
  if (inherited.decision.status === 'admitted') {
    catalogIndex = catalog.indexOf(inherited.decision.admittedType);
    attestation = catalogIndex === -1 ? 'unresolved' : 'builtin';
    if (catalogIndex === -1) catalogIndex = null;
  }
  return {
    attestation,
    catalogCount: catalog.length,
    catalogFormat: policy.builtinNodeCatalogFormat,
    catalogIndex,
    admittedType: inherited.decision.admittedType,
    format: policy.builtinNodeTypeAttestationFormat,
    inherited,
    sourceProfile: policy.builtinNodeTypeAttestationSourceProfile,
    status: inherited.decision.status,
  };
}
