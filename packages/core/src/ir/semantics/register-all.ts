/**
 * Explicit entry point that registers every contract Phase 1 ships. The
 * doc generator and the differential harness scripts call this once at
 * startup so a registry snapshot reflects the canonical set — production
 * code paths don't rely on test-side `beforeEach` to populate the registry.
 *
 * Adding a new contract: import the `register*Contract()` function here and
 * call it. Order matters only if one contract's preconditions depend on
 * another being present (no current callers do — primitives + each are
 * independent). Re-running `registerAllContracts()` after a partial reset
 * is a programming error and throws via `registerContract`'s idempotency
 * guard; callers that need to re-register (e.g. test teardown) must call
 * the per-contract `_resetXForTest()` helpers first.
 */

import { _resetAssignContractForTest, registerAssignContract } from './assign.js';
import { _resetBranchContractForTest, registerBranchContract } from './branch.js';
import { _resetCapabilityContractForTest, registerCapabilityContract } from './capability.js';
import { _resetEachContractForTest, registerEachContract } from './each.js';
import { _resetExpressionV1ContractForTest, registerExpressionV1Contract } from './expression-v1.js';
import { _resetFmtContractForTest, registerFmtContract } from './fmt.js';
import { _resetForContractForTest, registerForContract } from './for.js';
import { _resetIfContractForTest, registerIfContract } from './if.js';
import { _resetLambdaContractForTest, registerLambdaContract } from './lambda.js';
import { _resetLetContractForTest, registerLetContract } from './let.js';
import { _resetPrimitivesForTest, registerPrimitives } from './primitives.js';
import { _resetPrintContractForTest, registerPrintContract } from './print.js';
import { _resetTryContractForTest, registerTryContract } from './try.js';
import { _resetWhileContractForTest, registerWhileContract } from './while.js';

export function registerAllContracts(): void {
  registerPrimitives();
  registerEachContract();
  registerBranchContract();
  registerCapabilityContract();
  registerIfContract();
  registerForContract();
  registerLambdaContract();
  registerLetContract();
  registerAssignContract();
  registerFmtContract();
  registerWhileContract();
  registerTryContract();
  registerExpressionV1Contract();
  registerPrintContract();
}

export function resetAllContractRegistration(): void {
  _resetPrimitivesForTest();
  _resetEachContractForTest();
  _resetBranchContractForTest();
  _resetCapabilityContractForTest();
  _resetIfContractForTest();
  _resetForContractForTest();
  _resetLambdaContractForTest();
  _resetLetContractForTest();
  _resetAssignContractForTest();
  _resetFmtContractForTest();
  _resetWhileContractForTest();
  _resetTryContractForTest();
  _resetExpressionV1ContractForTest();
  _resetPrintContractForTest();
}
