import type { CanonicalValue } from '../canonical-value/types.js';
import {
  canonicalEachCollectionReferenceSource,
  classifyEachCollectionReference,
  type EachCollectionReference,
} from '../each-collection-reference.js';
import { StructuralKirError } from './types.js';

function fail(path: string, message: string): never {
  throw new StructuralKirError('invalid-property', path, message);
}

function referenceForSource(source: string, path: string): EachCollectionReference {
  let classification: ReturnType<typeof classifyEachCollectionReference>;
  try {
    classification = classifyEachCollectionReference(source);
  } catch {
    fail(path, 'each collection must be a canonical binding or record-array field reference');
  }
  if (classification.status !== 'reference') {
    fail(path, 'each collection must be a canonical binding or record-array field reference');
  }
  return classification.reference;
}

export function projectEachCollectionReference(value: unknown, path: string): CanonicalValue {
  if (typeof value !== 'string') fail(path, 'each collection reference must be text');
  const reference = referenceForSource(value, path);
  return {
    tag: 'record',
    value: [
      { key: 'form', value: { tag: 'text', value: reference.form } },
      { key: 'source', value: { tag: 'text', value: canonicalEachCollectionReferenceSource(reference) } },
    ],
  };
}

export function validateEachCollectionReference(value: CanonicalValue, path: string): EachCollectionReference {
  if (
    value.tag !== 'record' ||
    value.value.length !== 2 ||
    value.value[0]?.key !== 'form' ||
    value.value[1]?.key !== 'source'
  ) {
    fail(path, 'expected exact each collection-reference record');
  }
  const form = value.value[0].value;
  const source = value.value[1].value;
  if (form.tag !== 'text' || source.tag !== 'text') {
    fail(path, 'each collection-reference fields must be text');
  }
  if (form.value !== 'binding' && form.value !== 'record-array-field') {
    fail(`${path}.form`, 'unknown each collection-reference form');
  }
  const reference = referenceForSource(source.value, `${path}.source`);
  if (reference.form !== form.value || canonicalEachCollectionReferenceSource(reference) !== source.value) {
    fail(path, 'each collection-reference form or canonical source mismatched');
  }
  return reference;
}

export function inflateEachCollectionReference(value: CanonicalValue, path: string): string {
  return canonicalEachCollectionReferenceSource(validateEachCollectionReference(value, path));
}
