import { BOOLEAN_CONTRACT } from './boolean.js';
import { FUNCTION_CONTRACT } from './function.js';
import { LIST_CONTRACT } from './list.js';
import { NULL_CONTRACT, UNDEFINED_CONTRACT } from './nullish.js';
import { NUMBER_CONTRACT } from './number.js';
import { RECORD_CONTRACT } from './record.js';
import type { CoreTypeContractRegistry } from './schema.js';
import { STRING_CONTRACT } from './string.js';

export { BOOLEAN_CONTRACT } from './boolean.js';
export { FUNCTION_CONTRACT } from './function.js';
export { LIST_CONTRACT } from './list.js';
export { NULL_CONTRACT, UNDEFINED_CONTRACT } from './nullish.js';
export { NUMBER_CONTRACT } from './number.js';
export { RECORD_CONTRACT } from './record.js';
export type {
  CoreFixture,
  CoreFixtureError,
  CoreFixtureValue,
  CoreGraphEdge,
  CoreLowerings,
  CoreOperation,
  CoreOperationKind,
  CoreOperationReturns,
  CoreTypeContract,
  CoreTypeContractRegistry,
  CoreTypeKind,
  CoreTypeName,
} from './schema.js';
export {
  CORE_FIXTURE_FUNCTION,
  CORE_FIXTURE_UNDEFINED,
  CORE_TYPE_NAMES,
  contractToGraphEdges,
  isCoreFixtureFunction,
  isCoreFixtureUndefined,
} from './schema.js';
export {
  CoreContractEvaluationError,
  coreFixtureValueType,
  evaluateCoreContractOperation,
} from './semantics.js';
export { STRING_CONTRACT } from './string.js';

export const CORE_TYPE_CONTRACTS = {
  schemaVersion: 1,
  types: {
    String: STRING_CONTRACT,
    Boolean: BOOLEAN_CONTRACT,
    Number: NUMBER_CONTRACT,
    List: LIST_CONTRACT,
    Record: RECORD_CONTRACT,
    Function: FUNCTION_CONTRACT,
    Null: NULL_CONTRACT,
    Undefined: UNDEFINED_CONTRACT,
  },
} as const satisfies CoreTypeContractRegistry;
