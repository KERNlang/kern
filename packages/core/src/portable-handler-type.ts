export const PORTABLE_HANDLER_TYPE_KINDS = Object.freeze(['boolean', 'integer', 'list', 'text', 'void'] as const);

export type PortableHandlerScalarKind = 'boolean' | 'integer' | 'text';
export type PortableHandlerTypeKind = (typeof PORTABLE_HANDLER_TYPE_KINDS)[number];
export type PortableHandlerTypePosition = 'parameter' | 'return';

export type PortableHandlerType =
  | { readonly kind: PortableHandlerScalarKind }
  | { readonly element: PortableHandlerScalarKind; readonly kind: 'list' }
  | { readonly kind: 'void' };

function scalarKind(annotation: string): PortableHandlerScalarKind | null {
  if (annotation === 'boolean') return 'boolean';
  if (annotation === 'number') return 'integer';
  if (annotation === 'string') return 'text';
  return null;
}

export function parsePortableHandlerType(
  annotation: string | undefined,
  position: PortableHandlerTypePosition,
): PortableHandlerType | null {
  if (annotation === undefined) return null;
  const value = annotation.trim();
  if (position === 'return' && value === 'void') return { kind: 'void' };
  if (value.endsWith('[]')) {
    const element = scalarKind(value.slice(0, -2));
    return element === null ? null : { element, kind: 'list' };
  }
  const kind = scalarKind(value);
  return kind === null ? null : { kind };
}
