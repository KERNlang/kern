import type { CanonicalValue } from '../canonical-value/types.js';
import { StructuralKirError } from './types.js';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const NUMBER_SOURCE = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

export type BranchPathValueForm = 'quoted-text' | 'unquoted-expression';

export interface BranchPathValue {
  readonly form: BranchPathValueForm;
  readonly source: string;
}

function fail(path: string, message: string): never {
  throw new StructuralKirError('invalid-property', path, message);
}

function validUnquotedSource(source: string): boolean {
  return (
    IDENTIFIER.test(source) ||
    (NUMBER_SOURCE.test(source) && !/^-0(?:\.0+)?$/u.test(source) && Number.isFinite(Number(source)))
  );
}

function validateSource(form: BranchPathValueForm, source: string, path: string): void {
  if (form === 'unquoted-expression' && !validUnquotedSource(source)) {
    fail(path, 'unquoted branch path must be an identifier or canonical finite-number source');
  }
}

export function projectBranchPathValue(value: unknown, quoted: boolean, path: string): CanonicalValue {
  if (typeof value !== 'string') fail(path, 'branch path value must be text');
  const form: BranchPathValueForm = quoted ? 'quoted-text' : 'unquoted-expression';
  validateSource(form, value, path);
  return {
    tag: 'record',
    value: [
      { key: 'form', value: { tag: 'text', value: form } },
      { key: 'source', value: { tag: 'text', value } },
    ],
  };
}

export function validateBranchPathValue(value: CanonicalValue, path: string): BranchPathValue {
  if (
    value.tag !== 'record' ||
    value.value.length !== 2 ||
    value.value[0]?.key !== 'form' ||
    value.value[1]?.key !== 'source'
  ) {
    fail(path, 'expected exact branch path provenance record');
  }
  const formValue = value.value[0].value;
  const sourceValue = value.value[1].value;
  if (formValue.tag !== 'text' || sourceValue.tag !== 'text') {
    fail(path, 'branch path provenance fields must be text');
  }
  if (formValue.value !== 'quoted-text' && formValue.value !== 'unquoted-expression') {
    fail(`${path}.form`, 'unknown branch path provenance form');
  }
  validateSource(formValue.value, sourceValue.value, `${path}.source`);
  return { form: formValue.value, source: sourceValue.value };
}

export function inflateBranchPathValue(
  value: CanonicalValue,
  path: string,
): {
  readonly quoted: boolean;
  readonly source: string;
} {
  const decoded = validateBranchPathValue(value, path);
  return { quoted: decoded.form === 'quoted-text', source: decoded.source };
}
