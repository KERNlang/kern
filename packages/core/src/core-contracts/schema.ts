export const CORE_TYPE_NAMES = [
  'String',
  'Boolean',
  'Number',
  'List',
  'Record',
  'Function',
  'Null',
  'Undefined',
] as const;

export type CoreTypeName = (typeof CORE_TYPE_NAMES)[number];

export type CoreTypeKind = 'primitive' | 'collection' | 'callable' | 'record' | 'nullish';

export type CoreOperationKind = 'method' | 'property' | 'operator' | 'constructor' | 'coercion';

export type CoreLowerings = {
  /**
   * Target lowerings are semantic helper calls, not raw host snippets.
   * Each helper must enforce the same strict argument and return contract as
   * evaluateCoreContractOperation before using host operations internally.
   */
  readonly kern?: string;
  readonly ts?: string;
  readonly python?: string;
};

// Fixture data reserves this exact record shape for Undefined so JSON fixtures
// can distinguish null from undefined without overloading result records.
export const CORE_FIXTURE_UNDEFINED = { __kernFixture: 'Undefined' } as const;
export const CORE_FIXTURE_FUNCTION = { __kernFixture: 'Function' } as const;

export function isCoreFixtureUndefined(value: unknown): value is typeof CORE_FIXTURE_UNDEFINED {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    (value as { readonly __kernFixture?: unknown }).__kernFixture === 'Undefined'
  );
}

export function isCoreFixtureFunction(value: unknown): value is typeof CORE_FIXTURE_FUNCTION {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    (value as { readonly __kernFixture?: unknown }).__kernFixture === 'Function'
  );
}

export type CoreFixtureValue =
  | string
  | number
  | boolean
  | null
  | typeof CORE_FIXTURE_UNDEFINED
  | typeof CORE_FIXTURE_FUNCTION
  | readonly CoreFixtureValue[]
  | { readonly [key: string]: CoreFixtureValue };

export type CoreFixtureError = {
  readonly code: 'strict-type' | 'division-by-zero';
  readonly message: string;
};

export type CoreFixture =
  | {
      readonly args: readonly CoreFixtureValue[];
      readonly returns: CoreFixtureValue;
    }
  | {
      readonly args: readonly CoreFixtureValue[];
      readonly throws: CoreFixtureError;
    };

export type CoreOperationReturns = CoreTypeName | readonly CoreTypeName[];

export type CoreOperation = {
  readonly id: string;
  readonly kind: CoreOperationKind;
  readonly args: readonly CoreTypeName[];
  readonly returns: CoreOperationReturns;
  readonly lowers?: CoreLowerings;
  readonly fixtures: readonly CoreFixture[];
  readonly review: {
    readonly summary: string;
    readonly graph: readonly string[];
  };
};

export type CoreTypeContract = {
  readonly name: CoreTypeName;
  readonly kind: CoreTypeKind;
  readonly strict: true;
  readonly operations: readonly CoreOperation[];
};

export type CoreTypeContractRegistry = {
  readonly schemaVersion: 1;
  readonly types: { readonly [Name in CoreTypeName]: CoreTypeContract & { readonly name: Name } };
};

export type CoreGraphEdge = {
  readonly from: string;
  readonly relation: string;
  readonly to: string;
  readonly operation?: string;
  readonly index?: number;
};

export function contractToGraphEdges(contract: CoreTypeContract): CoreGraphEdge[] {
  const edges: CoreGraphEdge[] = [];

  for (const operation of contract.operations) {
    if (!operation.id.startsWith(`${contract.name}.`)) {
      throw new Error(`Core operation id ${operation.id} must be prefixed with ${contract.name}.`);
    }
    const methodName = operation.id.slice(contract.name.length + 1);
    const explicitArgs = operation.args.slice(1).join(', ');
    const operationRelation = `${methodName}(${explicitArgs})`;

    edges.push({
      from: contract.name,
      relation: operationRelation,
      to: formatReturnTypes(operation.returns),
      operation: operation.id,
    });

    operation.args.forEach((arg, index) => {
      edges.push({
        from: operation.id,
        relation: 'accepts',
        to: arg,
        operation: operation.id,
        index,
      });
    });

    for (const returnType of returnTypeNames(operation.returns)) {
      edges.push({
        from: operation.id,
        relation: 'returns',
        to: returnType,
        operation: operation.id,
      });
    }

    for (const target of ['kern', 'ts', 'python'] as const) {
      const lowering = operation.lowers?.[target];
      if (!lowering) continue;
      edges.push({
        from: operation.id,
        relation: `lowers.${target}`,
        to: lowering,
        operation: operation.id,
      });
    }

    operation.fixtures.forEach((_, index) => {
      edges.push({
        from: operation.id,
        relation: 'fixture',
        to: `${operation.id}.fixture.${index}`,
        operation: operation.id,
        index,
      });
    });

    for (const tag of operation.review.graph) {
      edges.push({
        from: operation.id,
        relation: 'tagged',
        to: tag,
        operation: operation.id,
      });
    }
  }

  return edges;
}

function returnTypeNames(returns: CoreOperationReturns): readonly CoreTypeName[] {
  return typeof returns === 'string' ? [returns] : returns;
}

function formatReturnTypes(returns: CoreOperationReturns): string {
  return returnTypeNames(returns).join(' | ');
}
