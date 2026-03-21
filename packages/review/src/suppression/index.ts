/**
 * Suppression module — inline comments + config-level rule suppression.
 */

export type { SuppressionDirective, SuppressionResult, StrictMode } from './types.js';
export { parseDirectives, configDirectives, isConceptRule } from './parse-directives.js';
export { applySuppression } from './apply-suppression.js';
