export interface ClosurePowerRewriteLimits {
  /** Maximum `**` operators accepted in one raw closure block. */
  maxPowerOperators: number;
}

export const DEFAULT_CLOSURE_POWER_REWRITE_LIMITS: Readonly<ClosurePowerRewriteLimits> = Object.freeze({
  maxPowerOperators: 1_199,
});

export function assertClosurePowerRewriteLimits(
  limits: Readonly<ClosurePowerRewriteLimits>,
): asserts limits is Readonly<ClosurePowerRewriteLimits> {
  if (
    !Number.isSafeInteger(limits.maxPowerOperators) ||
    limits.maxPowerOperators < 0 ||
    limits.maxPowerOperators > DEFAULT_CLOSURE_POWER_REWRITE_LIMITS.maxPowerOperators
  ) {
    throw new RangeError(
      `maxPowerOperators must be a safe integer between 0 and ${DEFAULT_CLOSURE_POWER_REWRITE_LIMITS.maxPowerOperators}.`,
    );
  }
}

/** Iteratively enforce the portable-power policy without owning an AST runtime. */
export function isClosurePowerTreeWithinLimits<Node>(
  root: Node,
  isPowerOperator: (node: Node) => boolean,
  visitChildren: (node: Node, visit: (child: Node) => void) => void,
  limits: Readonly<ClosurePowerRewriteLimits> = DEFAULT_CLOSURE_POWER_REWRITE_LIMITS,
): boolean {
  assertClosurePowerRewriteLimits(limits);
  let powerOperators = 0;
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (isPowerOperator(node)) {
      powerOperators += 1;
      if (powerOperators > limits.maxPowerOperators) return false;
    }
    visitChildren(node, (child) => {
      stack.push(child);
    });
  }
  return true;
}
