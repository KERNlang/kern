export function formatM4129RuntimeCostStatus(receipt) {
  if (
    receipt?.promotion?.promotionReady !== true ||
    receipt.promotion.nextMilestone !== 'M4.130' ||
    receipt.result?.exactFloor !== 45_908 ||
    receipt.result.promotionBudgetHeadroom !== 3_244 ||
    receipt.optimization?.recordfieldExecutions !== 0 ||
    receipt.optimization.typefieldTableProjectionExecutions !== 1 ||
    receipt.observations?.[0]?.outcome !== 'failure' ||
    receipt.observations?.[1]?.outcome !== 'success'
  ) {
    throw new TypeError('M4.129 status requires the exact validate runtime-cost evidence');
  }
  return 'M4.129 removes both assignment-target recordfield scans by reusing the authenticated ' +
    'type-field projection, reducing the exact floor to 45908 with 3244 promotion-budget ' +
    'headroom; M4.130 authenticates the combined KIR/profile promotion.';
}
