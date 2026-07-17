import type { CanonicalValue } from '../canonical-value/types.js';
import {
  type PortableHandlerScalarKind,
  type PortableHandlerType,
  type PortableHandlerTypePosition,
  parsePortableHandlerType,
} from '../portable-handler-type.js';
import { StructuralKirError } from './types.js';

const SCALAR_KINDS: readonly PortableHandlerScalarKind[] = ['boolean', 'integer', 'text'];

function fail(path: string, message: string): never {
  throw new StructuralKirError('invalid-type', path, message);
}

function text(value: CanonicalValue, path: string): string {
  if (value.tag !== 'text') fail(path, 'expected semantic type text');
  return value.value;
}

function scalar(value: string): PortableHandlerScalarKind | null {
  return SCALAR_KINDS.includes(value as PortableHandlerScalarKind) ? (value as PortableHandlerScalarKind) : null;
}

export function projectHandlerType(
  source: unknown,
  position: PortableHandlerTypePosition,
  path: string,
): CanonicalValue {
  if (typeof source !== 'string') fail(path, 'expected handler type annotation text');
  const type = parsePortableHandlerType(source, position);
  if (type === null) fail(path, 'type is outside the portable runtime-handler domain');
  if (type.kind === 'list') {
    return {
      tag: 'record',
      value: [
        { key: 'element', value: { tag: 'text', value: type.element } },
        { key: 'kind', value: { tag: 'text', value: 'list' } },
      ],
    };
  }
  return {
    tag: 'record',
    value: [{ key: 'kind', value: { tag: 'text', value: type.kind } }],
  };
}

export function validateHandlerType(
  value: CanonicalValue,
  position: PortableHandlerTypePosition,
  path: string,
): PortableHandlerType {
  if (value.tag !== 'record') fail(path, 'expected semantic type record');
  if (value.value.length === 1 && value.value[0]?.key === 'kind') {
    const kind = text(value.value[0].value, `${path}.kind`);
    const scalarKind = scalar(kind);
    if (scalarKind !== null) return { kind: scalarKind };
    if (kind === 'void' && position === 'return') return { kind: 'void' };
    fail(`${path}.kind`, 'scalar type kind is outside the handler position domain');
  }
  if (value.value.length === 2 && value.value[0]?.key === 'element' && value.value[1]?.key === 'kind') {
    const element = scalar(text(value.value[0].value, `${path}.element`));
    if (element === null) fail(`${path}.element`, 'list element kind is outside the portable handler domain');
    if (text(value.value[1].value, `${path}.kind`) !== 'list') fail(`${path}.kind`, 'expected list type kind');
    return { element, kind: 'list' };
  }
  fail(path, 'expected exact semantic handler type fields');
}
