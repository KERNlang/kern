export function formatM4127CombinedHeadroomStatus(receipt) {
  if (
    receipt?.promotion?.combinedPromotionApproved !== false ||
    receipt.promotion.disposition !==
      'production-headroom-authenticated-promotion-budget-no-go' ||
    receipt.limits?.candidateKir?.maxBytes !== 273_051 ||
    receipt.limits?.candidateKir?.maxDepth !== 98 ||
    receipt.limits?.candidateKir?.maxNodes !== 5_313 ||
    receipt.limits?.candidateProfile?.maxNodeRows !== 202 ||
    receipt.limits?.candidateProfile?.maxPropertyRows !== 308 ||
    receipt.limits?.candidateProfile?.maxValueRows !== 4_493 ||
    receipt.summary?.maxExactFloor !== 54_894 ||
    receipt.promotion.productionHeadroom !== 10_642 ||
    receipt.promotion.promotionBudgetDeficit !== 5_742
  ) {
    throw new TypeError('M4.127 status requires the exact combined headroom NO-GO');
  }
  return 'M4.127 authenticates combined KIR/profile structural safety and exact floor 54894 ' +
    'with 10642 production headroom, but misses the promotion budget by 5742; ' +
    'M4.128 investigates the runtime bottleneck.';
}
