// describe/expect/it are ambient — injected by scripts/node-test-globals.ts.
import { buildLLMRequest, type LLMBridgeConfig, parseWireResponse } from '../src/llm-bridge.js';

const cfg = (apiStyle: 'openai' | 'anthropic'): Required<LLMBridgeConfig> => ({
  apiKey: 'k-test',
  model: 'm-test',
  baseUrl: 'https://api.example.com/v1',
  apiStyle,
  timeout: 60_000,
  maxTokens: 1024,
  maxBatchTokens: 100_000,
  mineRules: [],
});

const MESSAGES = [
  { role: 'system' as const, content: 'You are a reviewer.' },
  { role: 'user' as const, content: 'Review this.' },
];

describe('buildLLMRequest', () => {
  it('openai style posts chat/completions with Bearer auth and inline system message', () => {
    const req = buildLLMRequest(MESSAGES, cfg('openai'));
    expect(req.url).toBe('https://api.example.com/v1/chat/completions');
    expect(req.headers.Authorization).toBe('Bearer k-test');
    expect(req.headers['x-api-key']).toBeUndefined();
    const body = JSON.parse(req.body);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a reviewer.' });
    expect(body.system).toBeUndefined();
    expect(body.max_tokens).toBe(1024);
  });

  it('anthropic style posts /messages with x-api-key and hoists system to top level', () => {
    const req = buildLLMRequest(MESSAGES, cfg('anthropic'));
    expect(req.url).toBe('https://api.example.com/v1/messages');
    expect(req.headers['x-api-key']).toBe('k-test');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    expect(req.headers.Authorization).toBeUndefined();
    const body = JSON.parse(req.body);
    expect(body.system).toBe('You are a reviewer.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Review this.' }]);
    expect(body.max_tokens).toBe(1024);
  });

  it('anthropic style omits the system field when no system message exists', () => {
    const req = buildLLMRequest([{ role: 'user', content: 'hi' }], cfg('anthropic'));
    const body = JSON.parse(req.body);
    expect('system' in body).toBe(false);
  });

  it('anthropic style joins multiple system messages', () => {
    const req = buildLLMRequest(
      [
        { role: 'system', content: 'A.' },
        { role: 'system', content: 'B.' },
        { role: 'user', content: 'go' },
      ],
      cfg('anthropic'),
    );
    expect(JSON.parse(req.body).system).toBe('A.\n\nB.');
  });
});

describe('parseWireResponse', () => {
  it('parses openai choices + usage', () => {
    const out = parseWireResponse(
      { choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 10, completion_tokens: 4 } },
      'openai',
    );
    expect(out).toEqual({ content: 'hello', promptTokens: 10, completionTokens: 4 });
  });

  it('parses anthropic text blocks + usage', () => {
    const out = parseWireResponse(
      {
        content: [
          { type: 'text', text: 'hel' },
          { type: 'thinking', text: 'IGNORED' },
          { type: 'text', text: 'lo' },
        ],
        usage: { input_tokens: 7, output_tokens: 3 },
      },
      'anthropic',
    );
    expect(out).toEqual({ content: 'hello', promptTokens: 7, completionTokens: 3 });
  });

  it('tolerates missing usage and empty content on both styles', () => {
    expect(parseWireResponse({ choices: [] }, 'openai')).toEqual({ content: '' });
    expect(parseWireResponse({}, 'anthropic')).toEqual({ content: '' });
  });
});
