import type { KernTarget } from '@kernlang/core';

/** Canonical output extension for a generated target's primary artifact. */
export function getOutputExtension(target: KernTarget): string {
  switch (target) {
    case 'fastapi':
    case 'python':
      return '.py';
    case 'go':
      return '.go';
    case 'vue':
    case 'nuxt':
      return '.vue';
    case 'lib':
    case 'express':
    case 'cli':
    case 'terminal':
    case 'mcp':
      return '.ts';
    default:
      return '.tsx';
  }
}
