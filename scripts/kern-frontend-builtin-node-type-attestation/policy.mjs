import { readFileSync } from 'node:fs';

import { loadBuiltinNodeCatalog } from './catalog.mjs';
import { loadFrontendNodeTypeTokenAdmissionPolicy } from '../kern-frontend-node-type-token-admission/policy.mjs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const RECORD_WIDTH = 16;
const AUTH_PAYLOAD_FIELDS = 12;
const M4159_RECORD_WIDTH = 10;

function fail(detail) {
  throw new TypeError(`frontend builtin-node attestation policy rejection: ${detail}`);
}

export function validateFrontendBuiltinNodeTypeAttestationPolicy(
  extension,
  admission = loadFrontendNodeTypeTokenAdmissionPolicy(),
  catalog = loadBuiltinNodeCatalog(),
) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) fail('policy must be a record');
  const keys = Object.keys(extension).sort();
  if (
    keys.length !== 4 || keys[0] !== 'catalogFormat' || keys[1] !== 'format' ||
    keys[2] !== 'maxCatalogEntries' || keys[3] !== 'sourceProfile'
  ) fail('policy must contain exactly catalogFormat,format,maxCatalogEntries,sourceProfile');
  if (extension.format !== 'kern.frontend.builtin-node-type-attestation-shadow.1') fail('format is unsupported');
  if (extension.catalogFormat !== 'kern.frontend.builtin-node-types.1') fail('catalogFormat is unsupported');
  if (extension.sourceProfile !== 'single-builtin-node-type-attestation-v1') fail('sourceProfile is unsupported');
  if (!Number.isSafeInteger(extension.maxCatalogEntries) || extension.maxCatalogEntries <= 0) {
    fail('maxCatalogEntries must be a positive safe integer');
  }
  if (catalog.length === 0 || catalog.length > extension.maxCatalogEntries) fail('catalog exceeds configured bound');
  const maxM4159Fields = 1 + (admission.maxStreamRecords + 2) * M4159_RECORD_WIDTH;
  const maxM4160Records = 4 + Math.ceil(maxM4159Fields / AUTH_PAYLOAD_FIELDS);
  const maxM4160Fields = 1 + maxM4160Records * RECORD_WIDTH;
  const maxM4161Fields = 1 + (2 + Math.ceil(maxM4160Fields / AUTH_PAYLOAD_FIELDS)) * RECORD_WIDTH;
  if (maxM4161Fields > admission.runtimeLimits.maxCollectionLength) fail('success envelope exceeds runtime collection');
  return {
    ...admission,
    builtinNodeCatalog: catalog,
    builtinNodeCatalogFormat: extension.catalogFormat,
    builtinNodeTypeAttestationFormat: extension.format,
    builtinNodeTypeAttestationSourceProfile: extension.sourceProfile,
    maxAdmissionEnvelopeFields: maxM4160Fields,
    maxAttestationEnvelopeFields: maxM4161Fields,
    maxCatalogEntries: extension.maxCatalogEntries,
  };
}

export function loadFrontendBuiltinNodeTypeAttestationPolicy() {
  return validateFrontendBuiltinNodeTypeAttestationPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}
