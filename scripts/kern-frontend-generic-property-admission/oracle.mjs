import { normalizeKnownNodeWarningOracle } from '../kern-frontend-known-node-warning/oracle.mjs';
import { normalizeRetainedTokenStreamOracle } from '../kern-frontend-retained-token-stream/oracle.mjs';

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

function propertyDecision(tokens, inherited) {
  const mutableSnapshot = inherited.inherited;
  const builtinAttestation = mutableSnapshot.inherited;
  const tokenAdmission = builtinAttestation.inherited;
  const cursorBefore = tokenAdmission.decision.cursorAfter;
  let cursor = cursorBefore;
  while (cursor < tokens.length && tokens[cursor].kind === 'whitespace') cursor += 1;
  const propertyIndex = cursor;
  if (
    cursor >= tokens.length ||
    tokens[cursor].kind !== 'identifier' ||
    cursor + 1 >= tokens.length ||
    tokens[cursor + 1].kind !== 'equals'
  ) {
    return {
      consumedValueTokenCount: 0,
      cursorAfter: cursor,
      cursorBefore,
      equalsIndex: null,
      key: '',
      propertyIndex: null,
      quoted: null,
      state: 'none',
      value: '',
      valueIndex: null,
      valueKind: 'none',
    };
  }

  const key = tokens[cursor].value;
  const equalsIndex = cursor + 1;
  cursor += 2;
  const valueIndex = cursor < tokens.length ? cursor : null;
  const token = tokens[cursor];
  if (token === undefined || token.kind === 'whitespace') {
    return {
      consumedValueTokenCount: 0,
      cursorAfter: cursor,
      cursorBefore,
      equalsIndex,
      key,
      propertyIndex,
      quoted: false,
      state: 'property',
      value: '',
      valueIndex,
      valueKind: 'empty',
    };
  }
  if (token.kind === 'quoted' || token.kind === 'expr') {
    return {
      consumedValueTokenCount: 1,
      cursorAfter: cursor + 1,
      cursorBefore,
      equalsIndex,
      key,
      propertyIndex,
      quoted: token.kind === 'quoted',
      state: 'property',
      value: token.value,
      valueIndex,
      valueKind: token.kind,
    };
  }

  let value = '';
  const start = cursor;
  while (cursor < tokens.length && !['whitespace', 'style', 'themeRef'].includes(tokens[cursor].kind)) {
    value += tokens[cursor].value;
    cursor += 1;
  }
  return {
    consumedValueTokenCount: cursor - start,
    cursorAfter: cursor,
    cursorBefore,
    equalsIndex,
    key,
    propertyIndex,
    quoted: false,
    state: 'property',
    value,
    valueIndex,
    valueKind: 'bare',
  };
}

export function normalizeGenericPropertyAdmissionOracle(content, snapshot, policy) {
  const inherited = normalizeKnownNodeWarningOracle(content, snapshot, policy);
  if (inherited.status === 'failure') return failure(inherited.code, inherited.detail);
  const stream = normalizeRetainedTokenStreamOracle(content, policy);
  if (stream.status === 'failure') return failure(stream.code, stream.detail);
  if (inherited.state === 'dropped') {
    return {
      admittedType: '',
      consumedValueTokenCount: 0,
      cursorAfter: 0,
      cursorBefore: 0,
      equalsIndex: null,
      format: policy.genericPropertyAdmissionFormat,
      inherited,
      key: '',
      knownState: 'dropped',
      parseEpoch: inherited.parseEpoch,
      propertyIndex: null,
      quoted: null,
      runtimeInstance: inherited.runtimeInstance,
      sourceProfile: policy.genericPropertyAdmissionSourceProfile,
      state: 'dropped',
      value: '',
      valueIndex: null,
      valueKind: 'none',
    };
  }
  return {
    admittedType: inherited.admittedType,
    ...propertyDecision(stream.tokens, inherited),
    format: policy.genericPropertyAdmissionFormat,
    inherited,
    knownState: inherited.state,
    parseEpoch: inherited.parseEpoch,
    runtimeInstance: inherited.runtimeInstance,
    sourceProfile: policy.genericPropertyAdmissionSourceProfile,
  };
}
