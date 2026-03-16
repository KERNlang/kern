/**
 * kern-lang v2.0.0 — compatibility wrapper
 *
 * Re-exports all @kern/* packages for backwards compatibility.
 * For new projects, import from @kern/core + @kern/<target> directly.
 */

// Core (parser, types, config, spec, styles, codegen, utils)
export * from '@kern/core';

// Protocol (draft protocol for AI engines)
export * from '@kern/protocol';

// Transpilers
export { transpileTailwind, transpileNextjs, transpileWeb } from '@kern/react';
export { transpile } from '@kern/native';
export { transpileExpress } from '@kern/express';
export { transpileCliApp } from '@kern/cli';
export { transpileTerminal } from '@kern/terminal';

// Metrics + context export
export { collectLanguageMetrics, mergeMetrics, isEscapedStyleKey } from '@kern/metrics';
export type { LanguageMetrics, StyleMetrics, NodeTypeMetrics } from '@kern/metrics';
export { scanKernProject, projectToKern } from '@kern/metrics';
export type { ProjectSummary } from '@kern/metrics';
