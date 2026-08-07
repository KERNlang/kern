import { normalizeMutableNodeTypeRegistrySnapshotOracle } from '../kern-frontend-mutable-node-type-registry-snapshot/oracle.mjs';

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

export function normalizeKnownNodeWarningOracle(content, snapshot, policy) {
  const inherited = normalizeMutableNodeTypeRegistrySnapshotOracle(content, snapshot, policy);
  if (inherited.status === 'failure') return failure(inherited.code, inherited.detail);
  if (inherited.status === 'dropped') {
    return {
      admittedType: '',
      builtin: null,
      diagnostic: null,
      evolved: null,
      format: policy.knownNodeWarningFormat,
      inherited,
      multiline: null,
      parseEpoch: inherited.parseEpoch,
      runtimeInstance: inherited.runtimeInstance,
      sourceProfile: policy.knownNodeWarningSourceProfile,
      state: 'dropped',
      template: null,
      warning: null,
    };
  }
  const builtin = inherited.inherited.attestation === 'builtin';
  const known = builtin || inherited.evolved || inherited.multiline || inherited.template;
  return {
    admittedType: inherited.admittedType,
    builtin,
    diagnostic: known ? null : {
      code: policy.knownNodeWarningDiagnosticCode,
      col: 1,
      endCol: 1 + inherited.admittedType.length,
      line: 1,
      severity: policy.knownNodeWarningDiagnosticSeverity,
    },
    evolved: inherited.evolved,
    format: policy.knownNodeWarningFormat,
    inherited,
    multiline: inherited.multiline,
    parseEpoch: inherited.parseEpoch,
    runtimeInstance: inherited.runtimeInstance,
    sourceProfile: policy.knownNodeWarningSourceProfile,
    state: known ? 'known' : 'unknown',
    template: inherited.template,
    warning: !known,
  };
}
