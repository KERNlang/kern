import type { CoreFixtureValue, CoreOperation } from '../src/core-contracts/index.js';
import {
  BOOLEAN_CONTRACT,
  CORE_FIXTURE_FUNCTION,
  CORE_FIXTURE_UNDEFINED,
  CORE_TYPE_CONTRACTS,
  CORE_TYPE_NAMES,
  CoreContractEvaluationError,
  contractToGraphEdges,
  coreFixtureValueType,
  evaluateCoreContractOperation,
  LIST_CONTRACT,
  NUMBER_CONTRACT,
  RECORD_CONTRACT,
  STRING_CONTRACT,
} from '../src/core-contracts/index.js';

describe('core type contracts registry', () => {
  it('exposes schemaVersion 1 and all builtin core types', () => {
    expect(CORE_TYPE_CONTRACTS.schemaVersion).toBe(1);
    expect(Object.keys(CORE_TYPE_CONTRACTS.types)).toEqual([...CORE_TYPE_NAMES]);

    for (const name of CORE_TYPE_NAMES) {
      const contract = CORE_TYPE_CONTRACTS.types[name];
      expect(contract.name).toBe(name);
      expect(contract.strict).toBe(true);
      expect(Array.isArray(contract.operations)).toBe(true);
    }
  });

  it('exposes behavior contracts for VM-backed core values', () => {
    expect(BOOLEAN_CONTRACT.operations.map((operation) => operation.id)).toEqual([
      'Boolean.not',
      'Boolean.and',
      'Boolean.or',
      'Boolean.equals',
      'Boolean.toString',
    ]);
    expect(STRING_CONTRACT.operations.map((operation) => operation.id)).toEqual([
      'String.length',
      'String.index',
      'String.includes',
      'String.startsWith',
      'String.endsWith',
      'String.slice',
      'String.trim',
      'String.lower',
      'String.upper',
      'String.concat',
      'String.equals',
      'String.lessThan',
      'String.lessThanOrEqual',
      'String.greaterThan',
      'String.greaterThanOrEqual',
      'String.toString',
    ]);
    expect(NUMBER_CONTRACT.operations.map((operation) => operation.id)).toEqual([
      'Number.negate',
      'Number.add',
      'Number.subtract',
      'Number.multiply',
      'Number.divide',
      'Number.remainder',
      'Number.power',
      'Number.lessThan',
      'Number.lessThanOrEqual',
      'Number.greaterThan',
      'Number.greaterThanOrEqual',
    ]);
    expect(LIST_CONTRACT.operations.map((operation) => operation.id)).toEqual(['List.length', 'List.index']);
    expect(RECORD_CONTRACT.operations.map((operation) => operation.id)).toEqual(['Record.get']);

    expect(CORE_TYPE_CONTRACTS.types.Function.operations).toHaveLength(0);
    expect(CORE_TYPE_CONTRACTS.types.Null.operations).toHaveLength(0);
    expect(CORE_TYPE_CONTRACTS.types.Undefined.operations).toHaveLength(0);
  });

  it('uses registry-level schemaVersion instead of operation version suffixes', () => {
    for (const contract of Object.values(CORE_TYPE_CONTRACTS.types)) {
      for (const operation of contract.operations) {
        expect(operation.id).not.toMatch(/@v\d+/);
      }
    }
  });

  it('keeps every operation graphable and fixture-backed', () => {
    for (const contract of [BOOLEAN_CONTRACT, STRING_CONTRACT, NUMBER_CONTRACT, LIST_CONTRACT, RECORD_CONTRACT]) {
      for (const operation of contract.operations) {
        expect(operation.args[0]).toBe(contract.name);
        expect(operation.fixtures.length).toBeGreaterThan(0);
        expect(operation.review.summary.length).toBeGreaterThan(0);
        expect(operation.review.graph).toContain(contract.name);
        expect(operation.lowers?.kern).toBeTruthy();
        expect(operation.lowers?.ts).toBeTruthy();
        expect(operation.lowers?.python).toBeTruthy();
      }
    }
  });
});

describe('core type contract fixtures', () => {
  it('evaluates Boolean operation fixtures including strict type errors', () => {
    for (const operation of BOOLEAN_CONTRACT.operations) {
      expectOperationFixtures(operation);
    }
  });

  it('evaluates String operation fixtures including strict type errors', () => {
    for (const operation of STRING_CONTRACT.operations) {
      expectOperationFixtures(operation);
    }
  });

  it('evaluates Number, List, and Record operation fixtures including strict errors', () => {
    for (const operation of [
      ...NUMBER_CONTRACT.operations,
      ...LIST_CONTRACT.operations,
      ...RECORD_CONTRACT.operations,
    ]) {
      expectOperationFixtures(operation);
    }
  });

  it('pins explicitly rejected strict signatures', () => {
    expectErrorFixture('Boolean.and', [true, 'true']);
    expectErrorFixture('String.concat', ['count:', 2]);
    expectErrorFixture('String.equals', ['kern', true]);
    expectErrorFixture('Number.add', [2, '3']);
    expectErrorFixture('List.index', [[10], '0']);
    expectErrorFixture('Record.get', [{ x: 1 }, 0]);
  });

  it('classifies all schema-level fixture value kinds for future contracts', () => {
    expect(coreFixtureValueType(null)).toBe('Null');
    expect(coreFixtureValueType(CORE_FIXTURE_UNDEFINED)).toBe('Undefined');
    expect(coreFixtureValueType(CORE_FIXTURE_FUNCTION)).toBe('Function');
    expect(coreFixtureValueType(JSON.parse(JSON.stringify(CORE_FIXTURE_UNDEFINED)))).toBe('Undefined');
    expect(coreFixtureValueType(JSON.parse(JSON.stringify(CORE_FIXTURE_FUNCTION)))).toBe('Function');
    expect(coreFixtureValueType(['x'])).toBe('List');
    expect(coreFixtureValueType({ key: 'value' })).toBe('Record');
    expect(coreFixtureValueType({ kind: 'Undefined' })).toBe('Record');
    expect(coreFixtureValueType({ error: 'strict-type', message: 'valid record value' })).toBe('Record');
  });

  it('uses unambiguous fixture result keys instead of overloading record-shaped values', () => {
    for (const operation of [...BOOLEAN_CONTRACT.operations, ...STRING_CONTRACT.operations]) {
      for (const fixture of operation.fixtures) {
        expect(Array.isArray(fixture)).toBe(false);
        expect('args' in fixture).toBe(true);
        expect('returns' in fixture !== 'throws' in fixture).toBe(true);
      }
    }
  });

  it('pins KERN-owned Unicode code-point string semantics', () => {
    expect(evaluateCoreContractOperation('String.length', ['𐐷'])).toBe(1);
    expect(evaluateCoreContractOperation('String.length', ['e\u0301'])).toBe(2);
    expect(evaluateCoreContractOperation('String.index', ['a𐐷b', 1])).toBe('𐐷');
    expect(evaluateCoreContractOperation('String.index', ['a𐐷b', 3])).toEqual(CORE_FIXTURE_UNDEFINED);
    expect(evaluateCoreContractOperation('String.slice', ['a𐐷b', 1, 2])).toBe('𐐷');
    expect(evaluateCoreContractOperation('String.slice', ['e\u0301x', 0, 2])).toBe('e\u0301');
    expect(evaluateCoreContractOperation('String.lessThan', ['a', '𐐷'])).toBe(true);
    expect(evaluateCoreContractOperation('String.greaterThan', ['𐐷', 'z'])).toBe(true);
  });

  it('rejects non-finite Number values without storing them in exported fixture data', () => {
    expect(() => evaluateCoreContractOperation('String.slice', ['abc', Number.POSITIVE_INFINITY, 2])).toThrow(
      'String.slice expects String, Number, Number.',
    );
    expect(() => evaluateCoreContractOperation('Number.add', [Number.NaN, 1])).toThrow(
      'Number.add expects Number, Number.',
    );
    expect(() => evaluateCoreContractOperation('Number.add', [1e308, 1e308])).toThrow(
      'Number.add result must be finite.',
    );
  });

  it('pins KERN Number and collection semantics', () => {
    expect(evaluateCoreContractOperation('Number.divide', [5, 2])).toBe(2.5);
    expect(() => evaluateCoreContractOperation('Number.divide', [1, 0])).toThrow('Number.divide division by zero.');
    expect(() => evaluateCoreContractOperation('Number.remainder', [1, 0])).toThrow(
      'Number.remainder division by zero.',
    );
    expect(evaluateCoreContractOperation('Number.remainder', [-5, 2])).toBe(-1);
    expect(evaluateCoreContractOperation('Number.remainder', [5, -2])).toBe(1);
    expect(evaluateCoreContractOperation('Number.power', [2, 10])).toBe(1024);
    expect(evaluateCoreContractOperation('Number.power', [-2, 3])).toBe(-8);
    expect(() => evaluateCoreContractOperation('Number.power', [2, -1])).toThrow(
      'portable: ** requires a safe-integer base and nonnegative safe-integer exponent',
    );
    expect(() => evaluateCoreContractOperation('Number.power', [2, 53])).toThrow(
      'portable: ** result exceeds the safe-integer domain',
    );
    expect(evaluateCoreContractOperation('List.length', [[1, 2, 3]])).toBe(3);
    expect(evaluateCoreContractOperation('List.index', [[null], 0])).toBeNull();
    expect(evaluateCoreContractOperation('List.index', [[10, 20], 2])).toEqual(CORE_FIXTURE_UNDEFINED);
    expect(evaluateCoreContractOperation('List.index', [[10, 20], -1])).toEqual(CORE_FIXTURE_UNDEFINED);
    expect(evaluateCoreContractOperation('Record.get', [{ x: 1 }, 'x'])).toBe(1);
    expect(evaluateCoreContractOperation('Record.get', [{ x: null }, 'x'])).toBeNull();
    expect(evaluateCoreContractOperation('Record.get', [{}, 'toString'])).toEqual(CORE_FIXTURE_UNDEFINED);
  });
});

describe('core type contract graph extraction', () => {
  it('derives type, lowering, fixture, and tag edges for String.includes', () => {
    const edges = contractToGraphEdges(STRING_CONTRACT);

    expect(
      hasEdge(edges, {
        from: 'String',
        relation: 'includes(String)',
        to: 'Boolean',
        operation: 'String.includes',
      }),
    ).toBe(true);
    expect(
      hasEdge(edges, {
        from: 'String.includes',
        relation: 'lowers.ts',
        to: '__kernStringIncludes($0, $1)',
        operation: 'String.includes',
      }),
    ).toBe(true);
    expect(
      hasEdge(edges, {
        from: 'String.includes',
        relation: 'lowers.python',
        to: '__kern_string_includes($0, $1)',
        operation: 'String.includes',
      }),
    ).toBe(true);
    expect(
      hasEdge(edges, {
        from: 'String.includes',
        relation: 'fixture',
        to: 'String.includes.fixture.0',
        operation: 'String.includes',
        index: 0,
      }),
    ).toBe(true);
  });

  it('derives a Boolean.not operation edge', () => {
    expect(
      hasEdge(contractToGraphEdges(BOOLEAN_CONTRACT), {
        from: 'Boolean',
        relation: 'not()',
        to: 'Boolean',
        operation: 'Boolean.not',
      }),
    ).toBe(true);
  });

  it('rejects operation ids that do not match the owning contract name', () => {
    expect(() =>
      contractToGraphEdges({
        ...STRING_CONTRACT,
        operations: [{ ...STRING_CONTRACT.operations[0], id: 'Boolean.length' }],
      }),
    ).toThrow('must be prefixed with String');
  });
});

function expectOperationFixtures(operation: CoreOperation): void {
  for (const fixture of operation.fixtures) {
    if ('throws' in fixture) {
      expect(() => evaluateCoreContractOperation(operation.id, fixture.args)).toThrow(fixture.throws.message);
      try {
        evaluateCoreContractOperation(operation.id, fixture.args);
      } catch (error) {
        expect(error).toBeInstanceOf(CoreContractEvaluationError);
        expect((error as CoreContractEvaluationError).code).toBe(fixture.throws.code);
      }
    } else {
      expect(evaluateCoreContractOperation(operation.id, fixture.args)).toEqual(fixture.returns);
    }
  }
}

function expectErrorFixture(operationId: string, expectedArgs: readonly CoreFixtureValue[]): void {
  const operation = [
    ...BOOLEAN_CONTRACT.operations,
    ...STRING_CONTRACT.operations,
    ...NUMBER_CONTRACT.operations,
    ...LIST_CONTRACT.operations,
    ...RECORD_CONTRACT.operations,
  ].find((operation) => operation.id === operationId);
  if (!operation) throw new Error(`Missing operation ${operationId}`);
  expect(
    operation.fixtures.some(
      (fixture) =>
        sameFixtureValueList(fixture.args, expectedArgs) &&
        'throws' in fixture &&
        fixture.throws.code === 'strict-type',
    ),
  ).toBe(true);
}

function sameFixtureValue(left: CoreFixtureValue, right: CoreFixtureValue): boolean {
  const leftKind = coreFixtureValueType(left);
  if (leftKind !== coreFixtureValueType(right)) return false;
  if (leftKind === 'Null' || leftKind === 'Undefined') return true;
  if (leftKind === 'List') {
    const leftArray = left as readonly CoreFixtureValue[];
    const rightArray = right as readonly CoreFixtureValue[];
    return (
      leftArray.length === rightArray.length &&
      leftArray.every((item, index) => sameFixtureValue(item, rightArray[index]))
    );
  }
  if (leftKind === 'Record') {
    const leftRecord = left as { readonly [key: string]: CoreFixtureValue };
    const rightRecord = right as { readonly [key: string]: CoreFixtureValue };
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return (
      sameStringList(leftKeys, rightKeys) &&
      leftKeys.every((key) => sameFixtureValue(leftRecord[key], rightRecord[key]))
    );
  }
  return left === right;
}

function sameFixtureValueList(left: readonly CoreFixtureValue[], right: readonly CoreFixtureValue[]): boolean {
  return left.length === right.length && left.every((item, index) => sameFixtureValue(item, right[index]));
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function hasEdge(
  edges: ReturnType<typeof contractToGraphEdges>,
  expected: {
    readonly from: string;
    readonly relation: string;
    readonly to: string;
    readonly operation?: string;
    readonly index?: number;
  },
): boolean {
  return edges.some(
    (edge) =>
      edge.from === expected.from &&
      edge.relation === expected.relation &&
      edge.to === expected.to &&
      edge.operation === expected.operation &&
      edge.index === expected.index,
  );
}
