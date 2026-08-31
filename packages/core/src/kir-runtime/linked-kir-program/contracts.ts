import type { KernKirLimits, KernKirValue } from '../contracts.js';

export const KERN_LINKED_KIR_PROGRAM_FORMAT = 'kern.linked-kir-program.v1' as const;

export type LinkedKernKirBinaryOperator = '&&' | '||' | '==' | '!=' | '<' | '<=' | '>' | '>=';

export type LinkedKernKirStaticType = 'boolean' | 'integer';

export interface LinkedKernKirTypeScope {
  readonly bindings: ReadonlySet<string>;
  readonly types: ReadonlyMap<string, LinkedKernKirStaticType>;
}

export type LinkedKernKirExpression =
  | { readonly kind: 'identifier'; readonly name: string }
  | {
      readonly kind: 'binary';
      readonly left: LinkedKernKirExpression;
      readonly op: LinkedKernKirBinaryOperator;
      readonly right: LinkedKernKirExpression;
    }
  | { readonly kind: 'literal'; readonly value: KernKirValue }
  | { readonly kind: 'list'; readonly items: readonly LinkedKernKirExpression[] }
  | {
      readonly kind: 'record';
      readonly entries: readonly { readonly key: string; readonly value: LinkedKernKirExpression }[];
    }
  | {
      readonly kind: 'member';
      readonly object: LinkedKernKirExpression;
      readonly optional: boolean;
      readonly property: string;
    }
  | {
      readonly kind: 'json-call';
      readonly operation: 'parse' | 'stringify';
      readonly argument: LinkedKernKirExpression;
    };

export type LinkedKernKirParameterType =
  | { readonly kind: 'boolean' | 'integer' | 'text' }
  | { readonly kind: 'list'; readonly element: 'boolean' | 'integer' | 'text' };

export type LinkedKernKirStatement =
  | { readonly kind: 'let'; readonly name: string; readonly value: LinkedKernKirExpression }
  | {
      readonly kind: 'capability';
      readonly input: LinkedKernKirExpression | undefined;
      readonly name: string;
      readonly namespace: string;
      readonly operation: string;
    }
  | { readonly kind: 'print'; readonly value: LinkedKernKirExpression }
  | { readonly kind: 'return'; readonly value: LinkedKernKirExpression }
  | {
      readonly kind: 'if';
      readonly condition: LinkedKernKirExpression;
      readonly thenBranch: readonly LinkedKernKirStatement[];
      readonly elseBranch: readonly LinkedKernKirStatement[] | undefined;
    };

export function linkedStatementsInvokeCapability(statements: readonly LinkedKernKirStatement[]): boolean {
  return statements.some((statement) => {
    if (statement.kind === 'capability') return true;
    if (statement.kind !== 'if') return false;
    return (
      linkedStatementsInvokeCapability(statement.thenBranch) ||
      (statement.elseBranch !== undefined && linkedStatementsInvokeCapability(statement.elseBranch))
    );
  });
}

export interface LinkedKernKirHandler {
  readonly parameters: readonly { readonly name: string; readonly type: LinkedKernKirParameterType }[];
  readonly returnType: LinkedKernKirParameterType;
  readonly statements: readonly LinkedKernKirStatement[];
}

export interface LinkedKernKirProgram {
  readonly format: typeof KERN_LINKED_KIR_PROGRAM_FORMAT;
  readonly entry: { readonly moduleId: string; readonly handlerName: string };
  readonly program: LinkedKernKirHandler;
  readonly projectionArtifactSha256: string;
  readonly sha256: string;
}

export type KernKirLinkCode =
  | 'projection-authentication-error'
  | 'handler-entry-not-found'
  | 'handler-entry-ambiguous'
  | 'handler-entry-unsupported'
  | 'handler-link-error';

export type LinkKernKirProgramResult =
  | { readonly outcome: 'success'; readonly program: LinkedKernKirProgram }
  | { readonly outcome: 'failure'; readonly code: KernKirLinkCode };

export interface LinkedKernKirEntry {
  readonly moduleId: string;
  readonly handlerName: string;
}

export type LinkedKernKirLimits = KernKirLimits;
