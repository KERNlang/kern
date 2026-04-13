/**
 * LLM Provider — abstraction over OpenAI, Anthropic, and local models.
 *
 * Used only by `kern evolve discover` and `kern evolve backfill`.
 * Never called during compilation.
 */

export interface LLMProvider {
  name: string;
  complete(prompt: string): Promise<string>;
}

export interface LLMProviderOptions {
  provider?: 'openai' | 'anthropic' | 'ollama';
  model?: string;
  maxTokens?: number;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Create an LLM provider based on configuration.
 * Checks environment variables for API keys.
 */
export function createLLMProvider(options: LLMProviderOptions = {}): LLMProvider {
  const provider = options.provider || detectProvider();

  switch (provider) {
    case 'openai':
      return createOpenAIProvider(options);
    case 'anthropic':
      return createAnthropicProvider(options);
    case 'ollama':
      return createOllamaProvider(options);
    default:
      throw new Error(`No LLM provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or use --provider=ollama`);
  }
}

function detectProvider(): 'openai' | 'anthropic' | 'ollama' | null {
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

function createOpenAIProvider(options: LLMProviderOptions): LLMProvider {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const model = options.model || 'gpt-4o';
  const baseUrl = options.baseUrl || 'https://api.openai.com/v1';
  const maxTokens = options.maxTokens || 4096;

  return {
    name: `openai/${model}`,
    async complete(prompt: string): Promise<string> {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.2,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${text}`);
      }

      const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
      return data.choices[0]?.message?.content || '';
    },
  };
}

function createAnthropicProvider(options: LLMProviderOptions): LLMProvider {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const model = options.model || 'claude-sonnet-4-6';
  const maxTokens = options.maxTokens || 4096;

  return {
    name: `anthropic/${model}`,
    async complete(prompt: string): Promise<string> {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${text}`);
      }

      const data = (await response.json()) as { content: Array<{ text: string }> };
      return data.content[0]?.text || '';
    },
  };
}

function createOllamaProvider(options: LLMProviderOptions): LLMProvider {
  const model = options.model || 'llama3';
  const baseUrl = options.baseUrl || 'http://localhost:11434';

  return {
    name: `ollama/${model}`,
    async complete(prompt: string): Promise<string> {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama error ${response.status}: ${text}`);
      }

      const data = (await response.json()) as { response: string };
      return data.response || '';
    },
  };
}

/**
 * Track token usage for cost estimation.
 */
export class TokenBudget {
  private used = 0;

  constructor(public readonly limit: number) {}

  add(tokens: number): void {
    this.used += tokens;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }

  get exhausted(): boolean {
    return this.used >= this.limit;
  }

  get totalUsed(): number {
    return this.used;
  }

  toString(): string {
    return `${this.used}/${this.limit} tokens (${Math.round((this.used / this.limit) * 100)}%)`;
  }
}
