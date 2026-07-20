const MAX_CAPABILITY_TIMEOUT_MS = 3_600_000;

export const RUN_USAGE =
  'Usage: kern run [--capabilities | --async-preview] [--iteration-budget <steps>] [--fs-root <dir> [--fs-write-root <dir>]] [--allow-net <origin>] [--llm-response <text> | --llm-provider openai [--llm-model <model>] [--llm-base-url <url>]] [--capability-timeout-ms <ms>] <file.kern>\n' +
  '  RAG async ops (rag.retrieveAsync, rag.answer, rag.ingest) and llm.complete run by default without --async-preview.\n' +
  '  --async-preview is required only for fs.* and net.fetch.\n' +
  '  --capability-timeout-ms bounds each async capability provider call (execute/async-preview only; 1..3600000, defaults to 30000).\n' +
  '  --iteration-budget supplies a caller-owned positive safe-integer machine loop budget (execute/async-preview only).';

export interface ParsedLlmProviderOptions {
  readonly provider: 'openai';
  readonly model?: string;
  readonly baseUrl?: string;
}

export type ParsedRunArgs =
  | {
      readonly mode: 'execute';
      readonly fileArg: string;
      readonly llmResponse?: string;
      readonly llmProvider?: ParsedLlmProviderOptions;
      readonly capabilityTimeoutMs?: number;
      readonly iterationBudget?: number;
    }
  | {
      readonly mode: 'capabilities';
      readonly fileArg: string;
      readonly fsRoot?: string;
      readonly fsWriteRoot?: string;
      readonly netAllowedOrigins: readonly string[];
      readonly llmResponse?: string;
      readonly llmProvider?: ParsedLlmProviderOptions;
    }
  | {
      readonly mode: 'async-preview';
      readonly fileArg: string;
      readonly fsRoot?: string;
      readonly fsWriteRoot?: string;
      readonly netAllowedOrigins: readonly string[];
      readonly llmResponse?: string;
      readonly llmProvider?: ParsedLlmProviderOptions;
      readonly capabilityTimeoutMs?: number;
      readonly iterationBudget?: number;
    };

function parsePositiveSafeInteger(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseCapabilityTimeoutMs(value: string): number | undefined {
  const parsed = parsePositiveSafeInteger(value);
  return parsed !== undefined && parsed <= MAX_CAPABILITY_TIMEOUT_MS ? parsed : undefined;
}

export function parseIterationBudget(value: string): number | undefined {
  return parsePositiveSafeInteger(value);
}
