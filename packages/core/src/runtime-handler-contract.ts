import { isPortableBindingName } from './ir/semantics/portable-scalar-domain.js';
import { type PortableHandlerType, parsePortableHandlerType } from './portable-handler-type.js';
import type { IRNode } from './types.js';

export interface KernRuntimeHandlerParameter {
  readonly annotation?: string;
  readonly name: string;
}

export interface KernRuntimeHandlerSignature {
  readonly parameters: readonly KernRuntimeHandlerParameter[];
  readonly returns?: string;
}

export type KernRuntimeHandlerAdmittedType = PortableHandlerType;

export function admitKernRuntimeHandlerSignature(
  signature: KernRuntimeHandlerSignature,
): readonly KernRuntimeHandlerAdmittedType[] | null {
  const parameters = signature.parameters.map(({ annotation }) => parsePortableHandlerType(annotation, 'parameter'));
  const returns = parsePortableHandlerType(signature.returns, 'return');
  if (parameters.some((type) => type === null) || returns === null) return null;
  return [...(parameters as KernRuntimeHandlerAdmittedType[]), returns];
}

function trueProp(value: unknown): boolean {
  return value === true || value === 'true';
}

function legacyParameters(raw: string): readonly KernRuntimeHandlerParameter[] | undefined {
  if (raw.trim() === '') return [];
  const parameters: KernRuntimeHandlerParameter[] = [];
  for (const part of raw.split(',')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_]*(?:\[\])?))?$/.exec(part.trim());
    if (!match || !isPortableBindingName(match[1])) return undefined;
    parameters.push({
      ...(match[2] === undefined ? {} : { annotation: match[2] }),
      name: match[1],
    });
  }
  return parameters;
}

export function inspectKernRuntimeHandlerSignature(fn: IRNode): KernRuntimeHandlerSignature | undefined {
  const children = (fn.children ?? []).filter((node) => node.type === 'param');
  const legacy = typeof fn.props?.params === 'string' ? fn.props.params : '';
  if (children.length > 0 && legacy.trim() !== '') return undefined;
  const parameters: readonly KernRuntimeHandlerParameter[] | undefined =
    children.length > 0
      ? children
          .map((parameter) => {
            if (
              (parameter.children ?? []).length > 0 ||
              parameter.props?.value !== undefined ||
              parameter.props?.default !== undefined ||
              trueProp(parameter.props?.optional) ||
              trueProp(parameter.props?.variadic) ||
              !isPortableBindingName(parameter.props?.name)
            ) {
              return undefined;
            }
            const annotation = parameter.props?.type;
            return {
              ...(typeof annotation === 'string' ? { annotation } : {}),
              name: parameter.props.name,
            };
          })
          .filter((parameter): parameter is KernRuntimeHandlerParameter => parameter !== undefined)
      : legacyParameters(legacy);
  if (parameters === undefined || (parameters.length !== children.length && children.length > 0)) return undefined;
  if (new Set(parameters.map(({ name }) => name)).size !== parameters.length) return undefined;
  const returns = fn.props?.returns;
  return {
    parameters,
    ...(typeof returns === 'string' ? { returns } : {}),
  };
}
