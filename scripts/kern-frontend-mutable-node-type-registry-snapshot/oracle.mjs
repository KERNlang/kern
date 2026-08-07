import { normalizeBuiltinNodeTypeAttestationOracle } from '../kern-frontend-builtin-node-type-attestation/oracle.mjs';

const DEFAULT_MULTILINE_TYPES = Object.freeze(['body', 'cleanup', 'doc', 'handler', 'logic', 'render']);

function failure(code) {
  return { code, detail: '', status: 'failure' };
}

function validNames(values, policy) {
  if (!Array.isArray(values) || values.length > policy.maxRegistryEntries) return false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (
      typeof value !== 'string' || value.length === 0 || [...value].length > policy.maxNameCodePoints ||
      Buffer.byteLength(value, 'utf8') > policy.maxNameBytes || (index > 0 && values[index - 1] >= value)
    ) return false;
  }
  return true;
}

export function normalizeMutableNodeTypeRegistrySnapshotOracle(content, snapshot, policy) {
  if (
    snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
    snapshot.format !== policy.runtimeRegistrySnapshotFormat || !Number.isSafeInteger(snapshot.runtimeInstance) ||
    snapshot.runtimeInstance <= 0 || !Number.isSafeInteger(snapshot.parseEpoch) || snapshot.parseEpoch <= 0 ||
    !validNames(snapshot.evolvedTypes, policy) || !validNames(snapshot.multilineTypes, policy) ||
    !validNames(snapshot.templateTypes, policy) ||
    DEFAULT_MULTILINE_TYPES.some((name) => !snapshot.multilineTypes.includes(name))
  ) return failure('REGISTRY_INVALID');

  const inherited = normalizeBuiltinNodeTypeAttestationOracle(content, policy);
  if (inherited.status === 'failure') return failure(inherited.code);
  let mutableAttestation = 'none';
  let evolved = false;
  let multiline = false;
  let template = false;
  if (inherited.status === 'admitted') {
    evolved = snapshot.evolvedTypes.includes(inherited.admittedType);
    multiline = snapshot.multilineTypes.includes(inherited.admittedType);
    template = snapshot.templateTypes.includes(inherited.admittedType);
    mutableAttestation = evolved || multiline || template ? 'registered' : 'unresolved';
  }
  return {
    admittedType: inherited.admittedType,
    evolved,
    format: policy.mutableNodeTypeRegistrySnapshotFormat,
    inherited,
    multiline,
    mutableAttestation,
    parseEpoch: snapshot.parseEpoch,
    runtimeInstance: snapshot.runtimeInstance,
    snapshotFormat: snapshot.format,
    sourceProfile: policy.mutableNodeTypeRegistrySnapshotSourceProfile,
    status: inherited.status,
    template,
  };
}
