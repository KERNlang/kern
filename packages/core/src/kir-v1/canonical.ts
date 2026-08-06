import { createHash } from 'node:crypto';

import { decodeCanonicalValue, encodeCanonicalValue } from '../canonical-value/canonical.js';
import { type CanonicalValue, CanonicalValueDecodeError } from '../canonical-value/types.js';
import { decodeKirEvidence } from '../kir-evidence/canonical.js';
import { KIR_EVIDENCE_FORMAT, KirEvidenceError } from '../kir-evidence/types.js';
import { decodeModuleKir } from '../kir-structural/module-canonical.js';
import { MODULE_KIR_ARTIFACT_FORMAT, ModuleKirError } from '../kir-structural/module-types.js';
import { StructuralKirError } from '../kir-structural/types.js';
import {
  KIR_V1_COMPONENT_KINDS,
  KIR_V1_FORMAT,
  KIR_V1_PROFILE,
  type KirV1Artifact,
  type KirV1CodecOptions,
  KirV1Error,
  type KirV1ErrorCode,
  type KirV1Input,
  type KirV1Sources,
} from './types.js';

export { KIR_V1_FORMAT, KIR_V1_PROFILE, KirV1Error } from './types.js';

interface ParsedComponent {
  readonly format: string;
  readonly kind: (typeof KIR_V1_COMPONENT_KINDS)[number];
  readonly payload: Uint8Array;
  readonly sha256: string;
}

function fail(code: KirV1ErrorCode, path: string, message: string): never {
  throw new KirV1Error(code, path, message);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string, path: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/u.test(value)) fail('invalid-payload', path, 'expected non-empty lowercase even-length hex');
  return Uint8Array.from(value.match(/[0-9a-f]{2}/gu) as string[], (pair) => Number.parseInt(pair, 16));
}

function exact(value: CanonicalValue, keys: readonly string[], path: string): Map<string, CanonicalValue> {
  if (
    value.tag !== 'record' ||
    value.value.length !== keys.length ||
    value.value.some((entry, index) => entry.key !== keys[index])
  ) {
    fail('invalid-kir-v1', path, `expected fields ${keys.join(',')}`);
  }
  return new Map(value.value.map((entry) => [entry.key, entry.value]));
}

function field(record: Map<string, CanonicalValue>, key: string): CanonicalValue {
  const value = record.get(key);
  if (value === undefined) fail('invalid-kir-v1', '$', `missing field ${key}`);
  return value;
}

function text(value: CanonicalValue, path: string): string {
  if (value.tag !== 'text') fail('invalid-kir-v1', path, 'expected text');
  return value.value;
}

function componentValue(kind: ParsedComponent['kind'], format: string, payload: Uint8Array): CanonicalValue {
  return {
    tag: 'record',
    value: [
      { key: 'encoding', value: { tag: 'text', value: 'hex' } },
      { key: 'format', value: { tag: 'text', value: format } },
      { key: 'kind', value: { tag: 'text', value: kind } },
      { key: 'payload', value: { tag: 'text', value: toHex(payload) } },
      { key: 'sha256', value: { tag: 'text', value: sha256(payload) } },
    ],
  };
}

function artifactValue(input: KirV1Input): CanonicalValue {
  return {
    tag: 'record',
    value: [
      {
        key: 'components',
        value: {
          tag: 'list',
          value: [
            componentValue('semantic-module', MODULE_KIR_ARTIFACT_FORMAT, input.semanticBytes),
            componentValue('diagnostic-evidence', KIR_EVIDENCE_FORMAT, input.evidenceBytes),
          ],
        },
      },
      { key: 'format', value: { tag: 'text', value: KIR_V1_FORMAT } },
      { key: 'profile', value: { tag: 'text', value: KIR_V1_PROFILE } },
    ],
  };
}

function parseComponent(value: CanonicalValue, index: number): ParsedComponent {
  const path = `$.components[${index}]`;
  const component = exact(value, ['encoding', 'format', 'kind', 'payload', 'sha256'], path);
  if (text(field(component, 'encoding'), `${path}.encoding`) !== 'hex') {
    fail('invalid-component', `${path}.encoding`, 'expected hex');
  }
  const expectedKind = KIR_V1_COMPONENT_KINDS[index];
  const kind = text(field(component, 'kind'), `${path}.kind`);
  if (kind !== expectedKind) fail('invalid-components', `${path}.kind`, `expected ${expectedKind}`);
  const expectedFormat = index === 0 ? MODULE_KIR_ARTIFACT_FORMAT : KIR_EVIDENCE_FORMAT;
  const format = text(field(component, 'format'), `${path}.format`);
  if (format !== expectedFormat) fail('unsupported-kir-v1', `${path}.format`, `expected ${expectedFormat}`);
  const payload = fromHex(text(field(component, 'payload'), `${path}.payload`), `${path}.payload`);
  const digest = text(field(component, 'sha256'), `${path}.sha256`);
  if (!/^[0-9a-f]{64}$/u.test(digest)) fail('invalid-component', `${path}.sha256`, 'expected lowercase SHA-256');
  if (sha256(payload) !== digest) fail('digest-mismatch', `${path}.sha256`, 'payload digest mismatch');
  return { format, kind: kind as ParsedComponent['kind'], payload, sha256: digest };
}

function parseArtifact(value: CanonicalValue, sources: KirV1Sources, options: KirV1CodecOptions): KirV1Artifact {
  const artifact = exact(value, ['components', 'format', 'profile'], '$');
  if (text(field(artifact, 'format'), '$.format') !== KIR_V1_FORMAT) {
    fail('unsupported-kir-v1', '$.format', `expected ${KIR_V1_FORMAT}`);
  }
  if (text(field(artifact, 'profile'), '$.profile') !== KIR_V1_PROFILE) {
    fail('unsupported-kir-v1', '$.profile', `expected ${KIR_V1_PROFILE}`);
  }
  const componentsValue = field(artifact, 'components');
  if (componentsValue.tag !== 'list' || componentsValue.value.length !== KIR_V1_COMPONENT_KINDS.length) {
    fail('invalid-components', '$.components', 'expected exactly semantic-module,diagnostic-evidence');
  }
  const [semantic, evidence] = componentsValue.value.map(parseComponent) as [ParsedComponent, ParsedComponent];
  decodeModuleKir(semantic.payload, options.limits);
  decodeKirEvidence(evidence.payload, semantic.payload, sources, options);
  return {
    evidenceBytes: evidence.payload,
    evidenceSha256: evidence.sha256,
    format: KIR_V1_FORMAT,
    profile: KIR_V1_PROFILE,
    semanticBytes: semantic.payload,
    semanticSha256: semantic.sha256,
  };
}

function rethrow(error: unknown): never {
  if (error instanceof KirV1Error) throw error;
  if (
    error instanceof CanonicalValueDecodeError ||
    error instanceof ModuleKirError ||
    error instanceof KirEvidenceError ||
    error instanceof StructuralKirError
  ) {
    throw new KirV1Error('invalid-payload', '$.components', error.message);
  }
  throw new KirV1Error('invalid-kir-v1', '$', 'KIR v1 input cannot be decoded');
}

export function encodeKirV1(input: KirV1Input, sources: KirV1Sources, options: KirV1CodecOptions): Uint8Array {
  try {
    if (!(input.semanticBytes instanceof Uint8Array) || !(input.evidenceBytes instanceof Uint8Array)) {
      fail('invalid-kir-v1', '$', 'expected Uint8Array constituent payloads');
    }
    decodeModuleKir(input.semanticBytes, options.limits);
    decodeKirEvidence(input.evidenceBytes, input.semanticBytes, sources, options);
    return encodeCanonicalValue(artifactValue(input), options.limits);
  } catch (error) {
    return rethrow(error);
  }
}

export function decodeKirV1(input: Uint8Array, sources: KirV1Sources, options: KirV1CodecOptions): KirV1Artifact {
  try {
    return parseArtifact(decodeCanonicalValue(input, options.limits), sources, options);
  } catch (error) {
    return rethrow(error);
  }
}
