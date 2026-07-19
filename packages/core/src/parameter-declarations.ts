import type { IRNode } from './types.js';

export const MIXED_PARAMETER_DECLARATION_MESSAGE =
  'Callable cannot combine legacy `params=` with structured `param` children.';

export interface MixedParameterDeclarationViolation {
  readonly rule: 'mixed-parameter-declarations';
  readonly nodeType: string;
  readonly message: typeof MIXED_PARAMETER_DECLARATION_MESSAGE;
  readonly line?: number;
  readonly col?: number;
}

export function hasMixedParameterDeclarations(node: IRNode): boolean {
  return (
    typeof node.props?.params === 'string' &&
    node.props.params.trim() !== '' &&
    node.children?.some((child) => child.type === 'param') === true
  );
}

export function mixedParameterDeclarationViolation(node: IRNode): MixedParameterDeclarationViolation | undefined {
  if (!hasMixedParameterDeclarations(node)) return undefined;
  return {
    rule: 'mixed-parameter-declarations',
    nodeType: node.type,
    message: MIXED_PARAMETER_DECLARATION_MESSAGE,
    line: node.loc?.line,
    col: node.loc?.col,
  };
}

export function assertNoMixedParameterDeclarations(node: IRNode): void {
  if (hasMixedParameterDeclarations(node)) throw new Error(MIXED_PARAMETER_DECLARATION_MESSAGE);
}
