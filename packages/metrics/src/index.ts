/**
 * @kernlang/metrics — Language metrics and project context export
 */

export type { ProjectSummary } from './context-export.js';
export { projectToKern, scanKernProject } from './context-export.js';
export type { LanguageMetrics, NodeTypeMetrics, StyleMetrics } from './metrics.js';
export { collectLanguageMetrics, isEscapedStyleKey, mergeMetrics } from './metrics.js';
