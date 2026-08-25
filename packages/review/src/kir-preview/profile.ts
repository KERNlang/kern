import { deepFreeze } from './canonical.js';
import type { KernReviewTargetProfile } from './types.js';

export const DEFAULT_KERN_REVIEW_TARGET_PROFILE: KernReviewTargetProfile = deepFreeze({
  format: 'kern.review.target-profile.1',
  id: 'kern.review.target.default.v1',
  version: 1,
  unsupportedCapabilities: ['browser/clipboardWrite'],
});
