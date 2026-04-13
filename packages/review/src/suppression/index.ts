/**
 * Suppression module — inline comments + config-level rule suppression.
 */

export { applySuppression } from './apply-suppression.js';
export { configDirectives, isConceptRule, parseDirectives } from './parse-directives.js';
export type { StrictMode, SuppressionDirective, SuppressionResult } from './types.js';
