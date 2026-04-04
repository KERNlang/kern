import type { IRNode, KernTarget, ResolvedKernConfig, TranspileResult } from '@kernlang/core';
import { parse, resolveConfig, serializeIR } from '@kernlang/core';
import { transpileExpress } from '@kernlang/express';
import { transpileFastAPI } from '@kernlang/fastapi';
import { transpile as transpileNative } from '@kernlang/native';
import { transpileNextjs, transpileTailwind, transpileWeb } from '@kernlang/react';
import { transpileInk, transpileTerminal } from '@kernlang/terminal';
import { transpileNuxt, transpileVue } from '@kernlang/vue';

export interface CompileResult {
  ir: string | null;
  output: string | null;
  artifacts: Array<{ path: string; content: string; type: string }>;
  stats: { irTokens: number; outputTokens: number; reduction: number } | null;
  error: { message: string; line: number; col: number; codeFrame: string } | null;
}

function dispatch(target: KernTarget, ast: IRNode, config: ResolvedKernConfig): TranspileResult {
  switch (target) {
    case 'native':
      return transpileNative(ast, config);
    case 'web':
      return transpileWeb(ast, config);
    case 'tailwind':
      return transpileTailwind(ast, config);
    case 'nextjs':
      return transpileNextjs(ast, config);
    case 'express':
      return transpileExpress(ast, config);
    case 'fastapi':
      return transpileFastAPI(ast, config);
    case 'terminal':
      return transpileTerminal(ast, config);
    case 'ink':
      return transpileInk(ast, config);
    case 'vue':
      return transpileVue(ast, config);
    case 'nuxt':
      return transpileNuxt(ast, config);
    case 'cli':
      throw new Error('CLI target is only available in the KERN CLI tool. Try "express" or "terminal" instead.');
    default:
      throw new Error(`Unknown target: ${target}`);
  }
}

export function compile(source: string, target: KernTarget): CompileResult {
  try {
    const ast = parse(source);
    const ir = serializeIR(ast);
    const config = resolveConfig({ target });
    const result = dispatch(target, ast, config);

    return {
      ir,
      output: result.code,
      artifacts: (result.artifacts ?? []).map((a) => ({
        path: a.path,
        content: a.content,
        type: a.type,
      })),
      stats: {
        irTokens: result.irTokenCount,
        outputTokens: result.tsTokenCount,
        reduction: result.tokenReduction,
      },
      error: null,
    };
  } catch (err: unknown) {
    const error = err as Error & { line?: number; col?: number };
    const message = error.message ?? String(err);
    // Extract code frame from the error message (KernParseError includes it after \n\n)
    const parts = message.split('\n\n');
    const mainMessage = parts[0];
    const codeFrame = parts.slice(1).join('\n\n');

    return {
      ir: null,
      output: null,
      artifacts: [],
      stats: null,
      error: {
        message: mainMessage,
        line: error.line ?? 0,
        col: error.col ?? 0,
        codeFrame,
      },
    };
  }
}
