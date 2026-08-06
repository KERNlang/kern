import { makeEnv } from '../src/ir/semantics/index.js';
import type { InternalRuntimeAsyncOptions } from '../src/runtime-envelope/internal-engine.js';
import { INTERNAL_RUNTIME_ENVELOPE_FORMAT, type InternalRuntimeEnvelope } from '../src/runtime-envelope/types.js';
import type { IRNode } from '../src/types.js';
import {
  buildBranchQuotedPathFixture,
  buildCapabilityStorageGetFixture,
} from './kern-kir-runner-composed-special-fixtures.js';

export const COMPOSED_RUNNER_WITNESSES = [
  {
    id: 'assign',
    witnessId: 'kir-runtime-compose.assign.v1',
    semanticEnvelopeId: 'integer-seven',
    fixtureId: 'assign-rebind-seven',
    oracleId: 'exact-assign-result',
    excludedProperties: [],
  },
  {
    id: 'branch',
    witnessId: 'kir-runtime-compose.branch.v1',
    semanticEnvelopeId: 'quoted-path-seven',
    fixtureId: 'branch-quoted-path-seven',
    oracleId: 'exact-branch-result',
    excludedProperties: [],
  },
  {
    id: 'capability',
    witnessId: 'kir-runtime-compose.capability.v1',
    semanticEnvelopeId: 'storage-get-secret',
    fixtureId: 'capability-storage-get',
    oracleId: 'exact-capability-event-and-result',
    excludedProperties: ['input:excluded-host-expression'],
  },
  {
    id: 'do',
    witnessId: 'kir-runtime-compose.do.v1',
    semanticEnvelopeId: 'map-write-seven',
    fixtureId: 'do-map-set',
    oracleId: 'exact-map-result',
    excludedProperties: [],
  },
  {
    id: 'each',
    witnessId: 'kir-runtime-compose.each.v1',
    semanticEnvelopeId: 'array-sum-seven',
    fixtureId: 'each-array-sum-seven',
    oracleId: 'exact-each-sum',
    excludedProperties: ['key:excluded-host-expression', 'type:excluded-host-type'],
  },
  {
    id: 'expression-v1',
    witnessId: 'kir-runtime-compose.expression-v1.v1',
    semanticEnvelopeId: 'binary-seven',
    fixtureId: 'expression-v1-binary-seven',
    oracleId: 'exact-expression-v1-result',
    excludedProperties: ['type:excluded-host-type'],
  },
  {
    id: 'fmt',
    witnessId: 'kir-runtime-compose.fmt.v1',
    semanticEnvelopeId: 'formatted-value-seven',
    fixtureId: 'fmt-bound-value',
    oracleId: 'exact-formatted-text',
    excludedProperties: ['type:excluded-host-type'],
  },
  {
    id: 'for',
    witnessId: 'kir-runtime-compose.for.v1',
    semanticEnvelopeId: 'end-exclusive-sum-six',
    fixtureId: 'for-accumulate',
    oracleId: 'exact-for-sum',
    excludedProperties: [],
  },
  {
    id: 'if',
    witnessId: 'kir-runtime-compose.if.v1',
    semanticEnvelopeId: 'selected-seven',
    fixtureId: 'if-true-return',
    oracleId: 'exact-if-result',
    excludedProperties: [],
  },
  {
    id: 'lambda',
    witnessId: 'kir-runtime-compose.lambda.v1',
    semanticEnvelopeId: 'lambda-stdout-and-seven',
    fixtureId: 'lambda-list-map-stdout',
    oracleId: 'exact-lambda-stdout-and-result',
    excludedProperties: [],
  },
  {
    id: 'let',
    witnessId: 'kir-runtime-compose.let.v1',
    semanticEnvelopeId: 'bound-seven',
    fixtureId: 'let-bind-seven',
    oracleId: 'exact-let-result',
    excludedProperties: ['expr:excluded-host-expression', 'type:excluded-host-type'],
  },
  {
    id: 'print',
    witnessId: 'kir-runtime-compose.print.v1',
    semanticEnvelopeId: 'stdout-ready',
    fixtureId: 'print-ready',
    oracleId: 'exact-stdout-and-result',
    excludedProperties: [],
  },
  {
    id: 'return',
    witnessId: 'kir-runtime-compose.return.v1',
    semanticEnvelopeId: 'returned-eleven',
    fixtureId: 'return-eleven',
    oracleId: 'exact-return-result',
    excludedProperties: [],
  },
  {
    id: 'throw',
    witnessId: 'kir-runtime-compose.throw.v1',
    semanticEnvelopeId: 'uncaught-boom',
    fixtureId: 'throw-error',
    oracleId: 'exact-uncaught-throw',
    excludedProperties: [],
  },
  {
    id: 'try',
    witnessId: 'kir-runtime-compose.try.v1',
    semanticEnvelopeId: 'caught-boom',
    fixtureId: 'try-catch-error',
    oracleId: 'exact-caught-result',
    excludedProperties: [],
  },
  {
    id: 'while',
    witnessId: 'kir-runtime-compose.while.v1',
    semanticEnvelopeId: 'counter-three',
    fixtureId: 'while-increment',
    oracleId: 'exact-while-result',
    excludedProperties: [],
  },
] as const;

export type ComposedRunnerWitness = (typeof COMPOSED_RUNNER_WITNESSES)[number];

function success(
  value: InternalRuntimeEnvelope['result'],
  events: InternalRuntimeEnvelope['events'] = [],
): InternalRuntimeEnvelope {
  return {
    completion: { kind: 'return' },
    diagnostics: [],
    events,
    format: INTERNAL_RUNTIME_ENVELOPE_FORMAT,
    outcome: 'success',
    result: value,
  };
}

function integer(value: string): InternalRuntimeEnvelope['result'] {
  return { presence: 'value', value: { tag: 'integer', value } };
}

function text(value: string): InternalRuntimeEnvelope['result'] {
  return { presence: 'value', value: { tag: 'text', value } };
}

export const COMPOSED_RUNNER_ORACLES: Readonly<Record<ComposedRunnerWitness['oracleId'], InternalRuntimeEnvelope>> =
  Object.freeze({
    'exact-assign-result': success(integer('7')),
    'exact-branch-result': success(integer('7')),
    'exact-capability-event-and-result': success(text('secret'), [
      {
        input: { presence: 'absent' },
        namespace: 'storage',
        op: 'capability',
        operation: 'get',
        result: text('secret'),
      },
    ]),
    'exact-caught-result': success(text('boom')),
    'exact-each-sum': success(integer('7')),
    'exact-expression-v1-result': success(integer('7')),
    'exact-for-sum': success(integer('6')),
    'exact-formatted-text': success(text('value=7')),
    'exact-if-result': success(integer('7')),
    'exact-let-result': success(integer('7')),
    'exact-lambda-stdout-and-result': success(integer('7'), [{ op: 'stdout', text: '2,4,6' }]),
    'exact-map-result': success(integer('7')),
    'exact-return-result': success(integer('11')),
    'exact-stdout-and-result': success(text('done'), [{ op: 'stdout', text: 'ready' }]),
    'exact-uncaught-throw': {
      completion: { kind: 'error' },
      diagnostics: [{ category: 'runtime', code: 'uncaught-throw', phase: 'execution' }],
      events: [],
      format: INTERNAL_RUNTIME_ENVELOPE_FORMAT,
      outcome: 'failure',
      result: { presence: 'absent' },
    },
    'exact-while-result': success(integer('3')),
  });

function fixture(
  runnerId: ComposedRunnerWitness['id'],
  fixtureId: string,
  semanticEnvelopeId: ComposedRunnerWitness['semanticEnvelopeId'],
  oracleId: ComposedRunnerWitness['oracleId'],
  body: readonly IRNode[],
  controlBody: readonly IRNode[],
  returns: 'number' | 'string',
) {
  return {
    asyncHost: makeEnv(),
    body,
    controlBody,
    fixtureId,
    oracleId,
    returns,
    runnerId,
    semanticEnvelopeId,
    syncHost: makeEnv(),
  };
}

export type ComposedRunnerFixture = ReturnType<typeof fixture> & {
  readonly asyncOptions?: InternalRuntimeAsyncOptions;
};
export function buildComposedRunnerFixture(witness: ComposedRunnerWitness): ComposedRunnerFixture {
  switch (witness.fixtureId) {
    case 'assign-rebind-seven':
      return fixture(
        'assign',
        'assign-rebind-seven',
        'integer-seven',
        'exact-assign-result',
        [
          { type: 'let', props: { name: 'value', value: '1' } },
          { type: 'assign', props: { target: 'value', value: '7' } },
          { type: 'return', props: { value: 'value' } },
        ],
        [
          { type: 'let', props: { name: 'value', value: '1' } },
          { type: 'assign', props: { target: 'value', value: '8' } },
          { type: 'return', props: { value: 'value' } },
        ],
        'number',
      );
    case 'branch-quoted-path-seven':
      return buildBranchQuotedPathFixture();
    case 'capability-storage-get':
      return buildCapabilityStorageGetFixture();
    case 'do-map-set':
      return fixture(
        'do',
        'do-map-set',
        'map-write-seven',
        'exact-map-result',
        [
          { type: 'let', props: { name: 'values', value: 'new Map()' } },
          { type: 'do', props: { value: 'Map.set(values, "answer", 7)' } },
          { type: 'return', props: { value: 'Map.get(values, "answer")' } },
        ],
        [
          { type: 'let', props: { name: 'values', value: 'new Map()' } },
          { type: 'do', props: { value: 'Map.set(values, "answer", 8)' } },
          { type: 'return', props: { value: 'Map.get(values, "answer")' } },
        ],
        'number',
      );
    case 'each-array-sum-seven': {
      const body = (items: string): readonly IRNode[] => [
        { type: 'let', props: { name: 'items', value: items } },
        { type: 'let', props: { name: 'total', value: '0' } },
        {
          type: 'each',
          props: { in: 'items', name: 'item' },
          children: [{ type: 'assign', props: { op: '+=', target: 'total', value: 'item' } }],
        },
        { type: 'return', props: { value: 'total' } },
      ];
      return fixture(
        'each',
        'each-array-sum-seven',
        'array-sum-seven',
        'exact-each-sum',
        body('[3,4]'),
        body('[3,5]'),
        'number',
      );
    }
    case 'expression-v1-binary-seven':
      return fixture(
        'expression-v1',
        'expression-v1-binary-seven',
        'binary-seven',
        'exact-expression-v1-result',
        [
          { type: 'expression-v1', props: { expr: '1 + 6', name: 'answer' } },
          { type: 'return', props: { value: 'answer' } },
        ],
        [
          { type: 'expression-v1', props: { expr: '1 + 7', name: 'answer' } },
          { type: 'return', props: { value: 'answer' } },
        ],
        'number',
      );
    case 'fmt-bound-value':
      return fixture(
        'fmt',
        'fmt-bound-value',
        'formatted-value-seven',
        'exact-formatted-text',
        [
          { type: 'let', props: { name: 'value', value: '7' } },
          { type: 'fmt', props: { name: 'message', template: 'value=${value}' } },
          { type: 'return', props: { value: 'message' } },
        ],
        [
          { type: 'let', props: { name: 'value', value: '8' } },
          { type: 'fmt', props: { name: 'message', template: 'value=${value}' } },
          { type: 'return', props: { value: 'message' } },
        ],
        'string',
      );
    case 'for-accumulate':
      return fixture(
        'for',
        'for-accumulate',
        'end-exclusive-sum-six',
        'exact-for-sum',
        [
          { type: 'let', props: { name: 'total', value: '0' } },
          {
            type: 'for',
            props: { from: '1', name: 'index', to: '4' },
            children: [{ type: 'assign', props: { op: '+=', target: 'total', value: 'index' } }],
          },
          { type: 'return', props: { value: 'total' } },
        ],
        [
          { type: 'let', props: { name: 'total', value: '0' } },
          {
            type: 'for',
            props: { from: '1', name: 'index', to: '3' },
            children: [{ type: 'assign', props: { op: '+=', target: 'total', value: 'index' } }],
          },
          { type: 'return', props: { value: 'total' } },
        ],
        'number',
      );
    case 'if-true-return':
      return fixture(
        'if',
        'if-true-return',
        'selected-seven',
        'exact-if-result',
        [
          { type: 'if', props: { cond: 'true' }, children: [{ type: 'return', props: { value: '7' } }] },
          { type: 'return', props: { value: '9' } },
        ],
        [
          { type: 'if', props: { cond: 'false' }, children: [{ type: 'return', props: { value: '7' } }] },
          { type: 'return', props: { value: '9' } },
        ],
        'number',
      );
    case 'let-bind-seven':
      return fixture(
        'let',
        'let-bind-seven',
        'bound-seven',
        'exact-let-result',
        [
          { type: 'let', props: { name: 'answer', value: '7' } },
          { type: 'return', props: { value: 'answer' } },
        ],
        [
          { type: 'let', props: { name: 'answer', value: '8' } },
          { type: 'return', props: { value: 'answer' } },
        ],
        'number',
      );
    case 'lambda-list-map-stdout': {
      const body = (multiplier: string): readonly IRNode[] => [
        { type: 'lambda', props: { expr: `List.map([1,2,3], x => x * ${multiplier})` } },
        { type: 'return', props: { value: '7' } },
      ];
      return fixture(
        'lambda',
        'lambda-list-map-stdout',
        'lambda-stdout-and-seven',
        'exact-lambda-stdout-and-result',
        body('2'),
        body('3'),
        'number',
      );
    }
    case 'print-ready':
      return fixture(
        'print',
        'print-ready',
        'stdout-ready',
        'exact-stdout-and-result',
        [
          { type: 'print', props: { value: '"ready"' } },
          { type: 'return', props: { value: '"done"' } },
        ],
        [
          { type: 'print', props: { value: '"changed"' } },
          { type: 'return', props: { value: '"done"' } },
        ],
        'string',
      );
    case 'return-eleven':
      return fixture(
        'return',
        'return-eleven',
        'returned-eleven',
        'exact-return-result',
        [{ type: 'return', props: { value: '11' } }],
        [{ type: 'return', props: { value: '12' } }],
        'number',
      );
    case 'throw-error':
      return fixture(
        'throw',
        'throw-error',
        'uncaught-boom',
        'exact-uncaught-throw',
        [{ type: 'throw', props: { value: 'new Error("boom")' } }],
        [{ type: 'return', props: { value: '"safe"' } }],
        'string',
      );
    case 'try-catch-error':
      return fixture(
        'try',
        'try-catch-error',
        'caught-boom',
        'exact-caught-result',
        [
          {
            type: 'try',
            children: [
              { type: 'throw', props: { value: 'new Error("boom")' } },
              {
                type: 'catch',
                props: { name: 'error' },
                children: [{ type: 'return', props: { value: 'error.message' } }],
              },
            ],
          },
        ],
        [{ type: 'return', props: { value: '"safe"' } }],
        'string',
      );
    case 'while-increment':
      return fixture(
        'while',
        'while-increment',
        'counter-three',
        'exact-while-result',
        [
          { type: 'let', props: { name: 'counter', value: '0' } },
          {
            type: 'while',
            props: { cond: 'counter < 3' },
            children: [{ type: 'assign', props: { target: 'counter', value: 'counter + 1' } }],
          },
          { type: 'return', props: { value: 'counter' } },
        ],
        [
          { type: 'let', props: { name: 'counter', value: '0' } },
          {
            type: 'while',
            props: { cond: 'counter < 2' },
            children: [{ type: 'assign', props: { target: 'counter', value: 'counter + 1' } }],
          },
          { type: 'return', props: { value: 'counter' } },
        ],
        'number',
      );
  }
}
