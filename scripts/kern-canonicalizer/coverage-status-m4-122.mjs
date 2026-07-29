export function formatM4122KirDepthHeadroomStatus(receipt) {
  if (
    receipt?.promotion?.kirDepthPromotionApproved !== true ||
    receipt.limits?.candidateKir?.maxDepth !== 77 ||
    receipt.summary?.witnessCount !== 1 ||
    !Number.isSafeInteger(receipt.summary.maxExactFloor) ||
    receipt.summary.maxExactFloor <= 0 ||
    !Number.isSafeInteger(receipt.summary.minimumPromotionHeadroom) ||
    receipt.summary.minimumPromotionHeadroom < 0
  ) {
    throw new TypeError('M4.122 status requires exact depth-77 GO evidence');
  }
  return `M4.122 authenticates maxDepth ${receipt.limits.candidateKir.maxDepth} across ` +
    `${receipt.summary.witnessCount} witness at exact floor ` +
    `${receipt.summary.maxExactFloor} with ` +
    `${receipt.summary.minimumPromotionHeadroom} promotion headroom; ` +
    'M4.123 promotes structural KIR depth.';
}
