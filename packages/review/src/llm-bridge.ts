/**
 * LLM Bridge — calls an OpenAI-compatible LLM API for security review.
 *
 * Phase 3 of the security pipeline. Optional — requires API key.
 * Gracefully degrades when no key is available (CI/CD safe).
 *
 * Env vars:
 *   KERN_LLM_API_KEY   — API key (required for LLM review)
 *   KERN_LLM_MODEL     — Model name (default: gpt-4o-mini)
 *   KERN_LLM_BASE_URL  — Base URL (default: https://api.openai.com/v1)
 *
 * Supports: OpenAI, Anthropic (via proxy), Ollama, any OpenAI-compatible API.
 */

import type { InferResult, ReviewFinding } from './types.js';
import type { TaintResult } from './taint.js';
import { buildLLMPrompt, parseLLMResponse } from './llm-review.js';
import type { LLMGraphContext } from './llm-review.js';
import type { TemplateMatch } from './types.js';

// ── Config ───────────────────────────────────────────────────────────────

export interface LLMBridgeConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeout?: number;      // ms, default 30000
  maxTokens?: number;    // default 4096
}

function resolveConfig(override?: LLMBridgeConfig): Required<LLMBridgeConfig> & { available: boolean } {
  const apiKey = override?.apiKey || process.env.KERN_LLM_API_KEY || '';
  return {
    apiKey,
    model: override?.model || process.env.KERN_LLM_MODEL || 'gpt-4o-mini',
    baseUrl: (override?.baseUrl || process.env.KERN_LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    timeout: override?.timeout || 30_000,
    maxTokens: override?.maxTokens || 4096,
    available: apiKey.length > 0,
  };
}

/**
 * Check if LLM review is available (API key configured).
 */
export function isLLMAvailable(override?: LLMBridgeConfig): boolean {
  return resolveConfig(override).available;
}

// ── API Call ──────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  choices: Array<{
    message: { content: string };
  }>;
}

async function callLLM(messages: ChatMessage[], config: Required<LLMBridgeConfig>): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: config.maxTokens,
        temperature: 0.1, // Low temp for consistent analysis
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`LLM API error ${response.status}: ${text.substring(0, 200)}`);
    }

    const data = await response.json() as ChatResponse;
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

// ── Batch Review ─────────────────────────────────────────────────────────

export interface LLMReviewInput {
  filePath: string;
  inferred: InferResult[];
  templateMatches: TemplateMatch[];
  taintResults?: TaintResult[];
  graphContext?: LLMGraphContext;
}

/**
 * Run LLM security review on a batch of files.
 * Returns ReviewFinding[] merged from LLM responses.
 *
 * When API key is not available, returns empty array (CI/CD safe).
 */
export async function runLLMReview(
  inputs: LLMReviewInput[],
  configOverride?: LLMBridgeConfig,
): Promise<ReviewFinding[]> {
  const config = resolveConfig(configOverride);
  if (!config.available) return [];

  const allFindings: ReviewFinding[] = [];

  // Batch files into a single prompt when small enough, or process individually
  if (inputs.length <= 3) {
    // Small batch: single prompt with all files
    const findings = await reviewBatch(inputs, config);
    allFindings.push(...findings);
  } else {
    // Large batch: process in chunks of 3
    for (let i = 0; i < inputs.length; i += 3) {
      const chunk = inputs.slice(i, i + 3);
      const findings = await reviewBatch(chunk, config);
      allFindings.push(...findings);
    }
  }

  return allFindings;
}

async function reviewBatch(
  inputs: LLMReviewInput[],
  config: Required<LLMBridgeConfig>,
): Promise<ReviewFinding[]> {
  const allFindings: ReviewFinding[] = [];

  // Build combined prompt
  const parts: string[] = [];
  const allInferred: InferResult[] = [];

  for (const input of inputs) {
    const prompt = buildLLMPrompt(input.inferred, input.templateMatches, input.graphContext);
    parts.push(`// ── ${input.filePath} ──\n${prompt}`);
    allInferred.push(...input.inferred);

    // Add taint context if available
    if (input.taintResults && input.taintResults.length > 0) {
      parts.push(formatTaintContext(input.taintResults));
    }
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = parts.join('\n\n');

  try {
    const response = await callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], config);

    const findings = parseLLMResponse(response, allInferred);

    // Tag all findings as LLM-sourced
    for (const f of findings) {
      f.source = 'llm';
    }

    allFindings.push(...findings);
  } catch (err) {
    // Don't crash the pipeline on LLM failure — just report it
    allFindings.push({
      source: 'llm',
      ruleId: 'llm-error',
      severity: 'info',
      category: 'bug',
      message: `LLM review failed: ${(err as Error).message}`,
      primarySpan: { file: inputs[0]?.filePath || '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
      fingerprint: 'llm-error-0',
    });
  }

  return allFindings;
}

function buildSystemPrompt(): string {
  return `You are a security code reviewer specializing in TypeScript/Node.js applications.
You review KERN IR (an intermediate representation of TypeScript code) for security issues.

Focus on:
- Injection vulnerabilities (command, SQL, XSS, template)
- Authentication/authorization bypasses
- Data exposure and information leakage
- Insecure cryptographic practices
- Race conditions in async code
- Business logic flaws

When taint analysis results are provided, reason about:
- Whether the taint path is actually exploitable
- Whether the identified sanitizers are sufficient
- Edge cases where sanitization could be bypassed

Return ONLY a JSON array of findings. Schema:
[{"nodeAlias":"N3","severity":"warning","category":"bug","message":"...","evidence":"..."}]

Rules:
- Only report findings you are confident about (>70% sure)
- Include specific evidence from the code
- Explain HOW an attacker could exploit each issue
- Do NOT report style issues — only security-relevant findings
- Use aliases from the Valid aliases list ONLY`;
}

function formatTaintContext(results: TaintResult[]): string {
  const lines: string[] = ['', '// Taint analysis results:'];

  for (const r of results) {
    lines.push(`// fn ${r.fnName} (L${r.startLine}):`);
    for (const p of r.paths) {
      const status = p.sanitized ? `SANITIZED by ${p.sanitizer}` : 'UNSANITIZED';
      lines.push(`//   ${p.source.origin} → ${p.sink.name}() [${status}]`);
    }
  }

  lines.push('// Review these paths. Are the unsanitized ones exploitable? Are the sanitizers sufficient?');
  return lines.join('\n');
}
