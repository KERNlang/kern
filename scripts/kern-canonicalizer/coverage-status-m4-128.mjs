export function formatM4128RuntimeBottleneckStatus(receipt) {
  if (
    receipt?.promotion?.combinedPromotionApproved !== false ||
    receipt.promotion.nextMilestone !== 'M4.129' ||
    receipt.diagnosis?.exactRecordfieldIterations !== 8_986 ||
    receipt.diagnosis?.recordfieldIterationsBeyondDeficit !== 3_244 ||
    receipt.diagnosis?.mechanism !==
      'two-full-value-table-recordfield-scans-during-assignment-target-validation' ||
    receipt.observations?.[0]?.phase !== 'second-recordfield-scan' ||
    receipt.observations?.[1]?.iterationBudget !== 52_023 ||
    receipt.observations?.[2]?.phase !== 'emission-in-progress' ||
    receipt.observations?.[3]?.outcome !== 'success'
  ) {
    throw new TypeError('M4.128 status requires the exact validate diagnosis');
  }
  return 'M4.128 attributes 8986 exact-floor iterations to two full recordfield scans ' +
    'during assignment-target validation, exceeding the 5742 promotion deficit by 3244; ' +
    'M4.129 folds target-kind authentication into the existing expression projection.';
}
