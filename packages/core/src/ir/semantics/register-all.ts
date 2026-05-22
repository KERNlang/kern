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

import { registerAssignContract } from './assign.js';
import { registerBranchContract } from './branch.js';
import { registerEachContract } from './each.js';
import { registerFmtContract } from './fmt.js';
import { registerForContract } from './for.js';
import { registerIfContract } from './if.js';
import { registerLambdaContract } from './lambda.js';
import { registerLetContract } from './let.js';
import { registerPrimitives } from './primitives.js';

export function registerAllContracts(): void {
  registerPrimitives();
  registerEachContract();
  registerBranchContract();
  registerIfContract();
  registerForContract();
  registerLambdaContract();
  registerLetContract();
  registerAssignContract();
  registerFmtContract();
}
