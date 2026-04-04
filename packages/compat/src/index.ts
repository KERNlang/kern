/**
 * kern-lang v2.0.0 — compatibility wrapper
 *
 * Re-exports all @kernlang/* packages for backwards compatibility.
 * For new projects, import from @kernlang/core + @kernlang/<target> directly.
 */

export { transpileCliApp } from '@kernlang/cli';
// Core (parser, types, config, spec, styles, codegen, utils)
export * from '@kernlang/core';
export { transpileExpress } from '@kernlang/express';
export { transpileFastAPI } from '@kernlang/fastapi';
export type { LanguageMetrics, NodeTypeMetrics, ProjectSummary, StyleMetrics } from '@kernlang/metrics';
// Metrics + context export
export {
  collectLanguageMetrics,
  isEscapedStyleKey,
  mergeMetrics,
  projectToKern,
  scanKernProject,
} from '@kernlang/metrics';
export { transpile } from '@kernlang/native';
// Protocol (draft protocol for AI engines)
export * from '@kernlang/protocol';
// Transpilers
export { transpileNextjs, transpileTailwind, transpileWeb } from '@kernlang/react';
export { transpileInk, transpileTerminal } from '@kernlang/terminal';
export { transpileNuxt, transpileVue } from '@kernlang/vue';
