/**
 * Sandboxed Generator — loads evolved codegen.js files in a restricted vm context.
 *
 * Security: Only approved helpers are available. No require, process, fs, or network.
 * The generator function signature matches core: (node: IRNode) => string[]
 */

import { createContext, Script } from 'vm';
import { readFileSync } from 'fs';
import type { IRNode } from '@kernlang/core';
import type { CodegenHelpers } from './evolved-types.js';

/**
 * Build the set of helpers available to sandboxed generators.
 * These mirror the private helpers in codegen-core.ts.
 */
function buildHelpers(): CodegenHelpers {
  return {
    capitalize: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),

    parseParamList: (params: string) => {
      return params.split(',').map(p => {
        const trimmed = p.trim();
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const paramPart = trimmed.slice(0, eqIdx);
          const defaultVal = trimmed.slice(eqIdx + 1);
          const colonIdx = paramPart.indexOf(':');
          if (colonIdx > 0) {
            return `${paramPart.slice(0, colonIdx)}: ${paramPart.slice(colonIdx + 1)} = ${defaultVal}`;
          }
          return `${paramPart} = ${defaultVal}`;
        }
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          return `${trimmed.slice(0, colonIdx)}: ${trimmed.slice(colonIdx + 1)}`;
        }
        return trimmed;
      }).join(', ');
    },

    dedent: (code: string) => {
      const lines = code.split('\n');
      const nonEmpty = lines.filter(l => l.trim().length > 0);
      if (nonEmpty.length === 0) return code;
      const min = Math.min(...nonEmpty.map(l => l.match(/^(\s*)/)?.[1].length ?? 0));
      return lines.map(l => l.slice(min)).join('\n');
    },

    kids: (node: IRNode, type?: string) => {
      const c = node.children || [];
      return type ? c.filter(n => n.type === type) : c;
    },

    firstChild: (node: IRNode, type: string) => {
      return (node.children || []).find(n => n.type === type);
    },

    p: (node: IRNode) => node.props || {},

    handlerCode: (node: IRNode) => {
      const handler = (node.children || []).find(n => n.type === 'handler');
      if (!handler) return '';
      const raw = (handler.props?.code as string) || '';
      // Dedent
      const lines = raw.split('\n');
      const nonEmpty = lines.filter(l => l.trim().length > 0);
      if (nonEmpty.length === 0) return raw;
      const min = Math.min(...nonEmpty.map(l => l.match(/^(\s*)/)?.[1].length ?? 0));
      return lines.map(l => l.slice(min)).join('\n');
    },

    exportPrefix: (node: IRNode) => {
      return (node.props || {}).export === 'false' ? '' : 'export ';
    },
  };
}

/**
 * Load a pre-compiled codegen.js file into a sandboxed vm context.
 * Returns a generator function: (node: IRNode) => string[]
 *
 * The sandbox only exposes:
 * - `helpers` — the CodegenHelpers object
 * - `exports` — the module's export target
 *
 * No require, process, fs, Buffer, setTimeout, fetch, or any global.
 */
export function loadSandboxedGenerator(jsPath: string): (node: IRNode) => string[] {
  const code = readFileSync(jsPath, 'utf-8');
  return compileSandboxedGenerator(code);
}

/**
 * Compile a codegen source string into a sandboxed generator function.
 * Used both for loading from disk and for validation dry-runs.
 */
export function compileSandboxedGenerator(code: string): (node: IRNode) => string[] {
  const helpers = buildHelpers();

  const sandbox = {
    exports: {} as Record<string, unknown>,
    module: { exports: {} as Record<string, unknown> },
    helpers,
    // Explicitly blocked — undefined, not missing (prevents prototype chain access)
    require: undefined,
    process: undefined,
    global: undefined,
    globalThis: undefined,
    Buffer: undefined,
    setTimeout: undefined,
    setInterval: undefined,
    fetch: undefined,
    console: undefined,
  };

  const ctx = createContext(sandbox, {
    name: 'kern-evolved-codegen',
    codeGeneration: { strings: false, wasm: false },
  });

  const script = new Script(code, { filename: 'evolved-codegen.js' });
  script.runInContext(ctx);

  // Support both `module.exports = fn` and `exports.default = fn` patterns
  const fn = (sandbox.module.exports as any).default
    || (sandbox.module.exports as any).generate
    || sandbox.module.exports
    || (sandbox.exports as any).default
    || (sandbox.exports as any).generate;

  if (typeof fn !== 'function') {
    throw new Error(
      'Evolved codegen must export a function: module.exports = function(node, helpers) { ... }'
    );
  }

  // Wrap to inject helpers as second argument
  return (node: IRNode): string[] => {
    const result = fn(node, helpers);
    if (!Array.isArray(result)) {
      throw new Error(`Evolved codegen must return string[], got ${typeof result}`);
    }
    return result;
  };
}

/** Get a fresh copy of codegen helpers (for testing). */
export function getCodegenHelpers(): CodegenHelpers {
  return buildHelpers();
}
