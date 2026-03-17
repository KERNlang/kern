/**
 * @kernlang/metrics — Language metrics and project context export
 */
export { collectLanguageMetrics, mergeMetrics, isEscapedStyleKey } from './metrics.js';
export type { LanguageMetrics, StyleMetrics, NodeTypeMetrics } from './metrics.js';
export { scanKernProject, projectToKern } from './context-export.js';
export type { ProjectSummary } from './context-export.js';
