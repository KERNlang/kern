/**
 * kern-lang v2.0.0 — compatibility wrapper
 *
 * Re-exports all @kernlang/* packages for backwards compatibility.
 * For new projects, import from @kernlang/core + @kernlang/<target> directly.
 */

// Core (parser, types, config, spec, styles, codegen, utils)
export * from '@kernlang/core';

// Protocol (draft protocol for AI engines)
export * from '@kernlang/protocol';

// Transpilers
export { transpileTailwind, transpileNextjs, transpileWeb } from '@kernlang/react';
export { transpile } from '@kernlang/native';
export { transpileExpress } from '@kernlang/express';
export { transpileCliApp } from '@kernlang/cli';
export { transpileTerminal } from '@kernlang/terminal';

// Metrics + context export
export { collectLanguageMetrics, mergeMetrics, isEscapedStyleKey } from '@kernlang/metrics';
export type { LanguageMetrics, StyleMetrics, NodeTypeMetrics } from '@kernlang/metrics';
export { scanKernProject, projectToKern } from '@kernlang/metrics';
export type { ProjectSummary } from '@kernlang/metrics';
