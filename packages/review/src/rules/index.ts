/**
 * Rule layer loader — reads config.target and returns active review rules.
 *
 * Layers:
 *   [base]     Always active — universal TS/KERN rules
 *   [react]    Active when target = nextjs | tailwind | web | native
 *   [vue]      Active when target = vue | nuxt
 *   [express]  Active when target = express
 *   [nextjs]   Active when target = nextjs (on top of react)
 */

import type { ReviewRule } from '../types.js';
import { baseRules } from './base.js';
import { securityRules } from './security.js';
import { securityV2Rules } from './security-v2.js';
import { securityV3Rules } from './security-v3.js';
import { securityV4Rules } from './security-v4.js';
import { deadLogicRules } from './dead-logic.js';
import { reactRules } from './react.js';
import { vueRules } from './vue.js';
import { nextjsRules } from './nextjs.js';
import { expressRules } from './express.js';
import { nullSafetyRules } from './null-safety.js';

const REACT_TARGETS = new Set(['nextjs', 'tailwind', 'web', 'native']);
const VUE_TARGETS = new Set(['vue', 'nuxt']);

/**
 * Get all active review rules for a given target.
 * Base + security + dead-logic + null-safety are always active; framework rules activate by target.
 */
export function getActiveRules(target?: string): ReviewRule[] {
  const rules: ReviewRule[] = [...baseRules, ...securityRules, ...securityV2Rules, ...securityV3Rules, ...securityV4Rules, ...deadLogicRules, ...nullSafetyRules];

  if (target && REACT_TARGETS.has(target)) {
    rules.push(...reactRules);
  }

  if (target && VUE_TARGETS.has(target)) {
    rules.push(...vueRules);
  }

  if (target === 'nextjs') {
    rules.push(...nextjsRules);
  }

  if (target === 'express') {
    rules.push(...expressRules);
  }

  return rules;
}
