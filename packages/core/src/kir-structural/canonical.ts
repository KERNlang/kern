import { decodeCanonicalValue, encodeCanonicalValue } from '../canonical-value/canonical.js';
import { type CanonicalValue, CanonicalValueDecodeError, type CanonicalValueLimits } from '../canonical-value/types.js';
import { PORTABLE_HANDLER_TYPE_KINDS } from '../portable-handler-type.js';
import type { IRNode } from '../types.js';
import { STRUCTURAL_KIR_CONSTITUTION_FORMAT, STRUCTURAL_KIR_PROOF_LABEL } from './catalog.generated.js';
import { projectStructuralNode, validateStructuralNode } from './node.js';
import {
  STRUCTURAL_KIR_ARTIFACT_FORMAT,
  STRUCTURAL_KIR_TYPE_CATALOG_FORMAT,
  type StructuralKirArtifact,
  StructuralKirError,
  type StructuralKirNode,
} from './types.js';

function fail(code: ConstructorParameters<typeof StructuralKirError>[0], path: string, message: string): never {
  throw new StructuralKirError(code, path, message);
}

function nodeValue(node: StructuralKirNode): CanonicalValue {
  return {
    tag: 'record',
    value: [
      { key: 'children', value: { tag: 'list', value: node.children.map(nodeValue) } },
      { key: 'kind', value: { tag: 'text', value: node.kind } },
      { key: 'properties', value: { tag: 'record', value: node.properties } },
    ],
  };
}

function artifactValue(root: StructuralKirNode): CanonicalValue {
  return {
    tag: 'record',
    value: [
      { key: 'constitution', value: { tag: 'text', value: STRUCTURAL_KIR_CONSTITUTION_FORMAT } },
      { key: 'format', value: { tag: 'text', value: STRUCTURAL_KIR_ARTIFACT_FORMAT } },
      { key: 'proofLabel', value: { tag: 'text', value: STRUCTURAL_KIR_PROOF_LABEL } },
      { key: 'root', value: nodeValue(root) },
      {
        key: 'typeCatalog',
        value: {
          tag: 'record',
          value: [
            {
              key: 'admittedKinds',
              value: { tag: 'list', value: PORTABLE_HANDLER_TYPE_KINDS.map((kind) => ({ tag: 'text', value: kind })) },
            },
            { key: 'format', value: { tag: 'text', value: STRUCTURAL_KIR_TYPE_CATALOG_FORMAT } },
          ],
        },
      },
    ],
  };
}

function exact(value: CanonicalValue, keys: readonly string[], path: string): Map<string, CanonicalValue> {
  if (
    value.tag !== 'record' ||
    value.value.length !== keys.length ||
    value.value.some((entry, index) => entry.key !== keys[index])
  ) {
    fail('invalid-artifact', path, `expected fields ${keys.join(',')}`);
  }
  return new Map(value.value.map((entry) => [entry.key, entry.value]));
}

function field(record: Map<string, CanonicalValue>, name: string): CanonicalValue {
  const value = record.get(name);
  if (value === undefined) fail('invalid-artifact', `$.${name}`, `missing field ${name}`);
  return value;
}

function exactText(value: CanonicalValue, expected: string, codePath: string): void {
  if (value.tag !== 'text' || value.value !== expected) {
    fail('unsupported-version', codePath, `expected ${expected}`);
  }
}

function validateArtifact(value: CanonicalValue): StructuralKirArtifact {
  const artifact = exact(value, ['constitution', 'format', 'proofLabel', 'root', 'typeCatalog'], '$');
  exactText(field(artifact, 'constitution'), STRUCTURAL_KIR_CONSTITUTION_FORMAT, '$.constitution');
  exactText(field(artifact, 'format'), STRUCTURAL_KIR_ARTIFACT_FORMAT, '$.format');
  exactText(field(artifact, 'proofLabel'), STRUCTURAL_KIR_PROOF_LABEL, '$.proofLabel');
  const typeCatalog = exact(field(artifact, 'typeCatalog'), ['admittedKinds', 'format'], '$.typeCatalog');
  const admittedKinds = field(typeCatalog, 'admittedKinds');
  if (
    admittedKinds.tag !== 'list' ||
    admittedKinds.value.length !== PORTABLE_HANDLER_TYPE_KINDS.length ||
    admittedKinds.value.some((kind, index) => kind.tag !== 'text' || kind.value !== PORTABLE_HANDLER_TYPE_KINDS[index])
  ) {
    fail('invalid-artifact', '$.typeCatalog.admittedKinds', 'expected exact portable handler type catalog');
  }
  exactText(field(typeCatalog, 'format'), STRUCTURAL_KIR_TYPE_CATALOG_FORMAT, '$.typeCatalog.format');
  return {
    format: STRUCTURAL_KIR_ARTIFACT_FORMAT,
    constitution: STRUCTURAL_KIR_CONSTITUTION_FORMAT,
    proofLabel: STRUCTURAL_KIR_PROOF_LABEL,
    typeCatalog: { format: STRUCTURAL_KIR_TYPE_CATALOG_FORMAT, admittedKinds: PORTABLE_HANDLER_TYPE_KINDS },
    root: validateStructuralNode(field(artifact, 'root')),
  };
}

export function encodeStructuralKir(root: IRNode, limits: CanonicalValueLimits): Uint8Array {
  try {
    return encodeCanonicalValue(artifactValue(projectStructuralNode(root, limits)), limits);
  } catch (error) {
    if (error instanceof StructuralKirError || error instanceof CanonicalValueDecodeError) throw error;
    if (error instanceof RangeError)
      throw new CanonicalValueDecodeError('limit-depth', '$.root', 'structural artifact exceeds host-safe depth');
    fail('invalid-artifact', '$.root', 'structural artifact cannot be encoded');
  }
}

export function decodeStructuralKir(input: Uint8Array, limits: CanonicalValueLimits): StructuralKirArtifact {
  try {
    return validateArtifact(decodeCanonicalValue(input, limits));
  } catch (error) {
    if (error instanceof StructuralKirError || error instanceof CanonicalValueDecodeError) throw error;
    if (error instanceof RangeError)
      throw new CanonicalValueDecodeError('limit-depth', '$.root', 'structural artifact exceeds host-safe depth');
    fail('invalid-artifact', '$', 'structural artifact cannot be decoded');
  }
}
