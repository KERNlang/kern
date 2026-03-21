// ═══════════════════════════════════════════════════════════════════════
// KERN CWE-1427 Prompt Injection Benchmark
// ═══════════════════════════════════════════════════════════════════════
//
// 10 attack vectors from OWASP LLM01:2025 — each function contains
// exactly one known-vulnerable pattern. Run any SAST tool against this
// file and count how many it catches.
//
// Verify:
//   kern review examples/security-benchmark.ts
//   semgrep scan --config p/default --config p/javascript examples/security-benchmark.ts
//
// Expected: kern review → 10/10 | semgrep → 1/10
//
// References:
//   CWE-1427: https://cwe.mitre.org/data/definitions/1427.html
//   CWE-1426: https://cwe.mitre.org/data/definitions/1426.html
//   OWASP LLM01: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
//
// License: MIT — use freely for benchmarking any tool.
// ═══════════════════════════════════════════════════════════════════════

// 1. Indirect injection — DB-stored payload flows to LLM prompt
//    CWE-1427 | OWASP LLM01
async function indirectInjection(db: any, llm: any, userId: string) {
  const history = await db.query(`SELECT message FROM chat WHERE user_id = '${userId}'`);
  const prompt = `You are a helpful assistant. Previous messages: ${history.rows.map((r: any) => r.message).join('\n')}`;
  return llm.complete(prompt);
}

// 2. LLM output execution — AI response passed to eval
//    CWE-1427 + CWE-94 | OWASP LLM01 + LLM02
async function llmOutputExecution(llm: any) {
  const response = await llm.complete("What shell command should I run?");
  eval(response.text);
}

// 3. System prompt leakage — system instructions in return value
//    CWE-1427 + CWE-209 | OWASP LLM07
function systemPromptLeakage(userInput: string) {
  const systemPrompt = "You are a billing assistant. API key: sk-secret-12345";
  return `${systemPrompt}\n\nUser: ${userInput}`;
}

// 4. RAG poisoning — retrieval results unsanitized in prompt
//    CWE-1427 | OWASP LLM01 + LLM03
async function ragPoisoning(vectorDb: any, llm: any, userQuery: string) {
  const docs = await vectorDb.search(userQuery);
  const context = docs.map((d: any) => d.content).join('\n');
  const prompt = `Context:\n${context}\n\nQuestion: ${userQuery}`;
  return llm.complete(prompt);
}

// 5. Tool calling manipulation — LLM-returned tool calls executed without validation
//    CWE-1427 | OWASP LLM01 + LLM07
async function toolCallingManipulation(llm: any, userMessage: string) {
  const response = await llm.complete({
    messages: [{ role: 'user', content: userMessage }],
    tools: [{ name: 'delete_account', params: { userId: 'string' } }],
  });
  if (response.tool_calls) {
    for (const call of response.tool_calls) {
      await executeTool(call.name, call.params);
    }
  }
}
async function executeTool(name: string, params: any) { /* dangerous: no allowlist */ }

// 6. Encoding bypass — decoded content enters prompt without re-sanitization
//    CWE-1427 | OWASP LLM01
function encodingBypass(userInput: string, llm: any) {
  const decoded = Buffer.from(userInput, 'base64').toString('utf-8');
  const prompt = `Translate this: ${decoded}`;
  return llm.complete(prompt);
}

// 7. Delimiter injection — user input in delimiter-structured prompt
//    CWE-1427 | OWASP LLM01
function delimiterInjection(userInput: string) {
  return `<|system|>You are helpful<|end|>\n<|user|>${userInput}<|end|>`;
}

// 8. Unsanitized history — raw user messages spread into LLM call
//    CWE-1427 | OWASP LLM01
async function unsanitizedHistory(messages: Array<{role: string, content: string}>, llm: any) {
  const userMessages = messages.filter(m => m.role === 'user');
  return llm.complete({ messages: [{ role: 'system', content: 'Be helpful' }, ...userMessages] });
}

// 9. JSON output manipulation — parsing LLM output without schema validation
//    CWE-1426 | OWASP LLM02
async function jsonOutputManipulation(llm: any, userInput: string) {
  const response = await llm.complete(`Return JSON for: ${userInput}`);
  const data = JSON.parse(response.text);
  return data;
}

// 10. Missing output validation — LLM response used in logic unvalidated
//     CWE-1426 | OWASP LLM02
async function missingOutputValidation(llm: any, description: string) {
  const response = await llm.complete(`Write TypeScript: ${description}`);
  return response.text;
}

// ═══════════════════════════════════════════════════════════════════════
// SAFE PATTERNS (should NOT trigger — false positive check)
// ═══════════════════════════════════════════════════════════════════════

// Safe: DB result sanitized before prompt
async function safeDbToPrompt(db: any, llm: any) {
  const data = await db.query('SELECT bio FROM users WHERE id = 1');
  const prompt = `Summarize: ${sanitizeForPrompt(data.bio)}`;
  return llm.complete(prompt);
}

// Safe: LLM output validated with schema before use
async function safeStructuredOutput(llm: any) {
  const response = await llm.complete('Return JSON');
  const raw = JSON.parse(response.text);
  const validated = ResponseSchema.parse(raw);
  if (validated.proceed) { deploy(); }
}

// Safe: Tool calls validated against allowlist
// NOTE: kern currently false-positives on this pattern (tracking issue #XX)
async function safeToolExecution(llm: any) {
  const response = await llm.complete({ messages: [], tools: [] });
  for (const call of response.tool_calls) {
    if (allowedTools.has(call.name)) {
      await executeTool(call.name, call.params);
    }
  }
}

// Safe: History sanitized before LLM call
async function safeChatHistory(userMsg: string, llm: any) {
  const messages: any[] = [];
  messages.push({ role: 'user', content: sanitizeForPrompt(userMsg) });
  return llm.complete({ messages });
}

// Safe: Decoded content re-sanitized
function safeDecoding(encoded: string, llm: any) {
  const decoded = atob(encoded);
  const prompt = `Analyze: ${sanitizeForPrompt(decoded)}`;
  return llm.complete(prompt);
}

// Stubs for type checking
declare function sanitizeForPrompt(s: any): string;
declare function deploy(): void;
declare const ResponseSchema: { parse(d: any): any };
declare const allowedTools: Set<string>;

export {
  indirectInjection,
  llmOutputExecution,
  systemPromptLeakage,
  ragPoisoning,
  toolCallingManipulation,
  encodingBypass,
  delimiterInjection,
  unsanitizedHistory,
  jsonOutputManipulation,
  missingOutputValidation,
  safeDbToPrompt,
  safeStructuredOutput,
  safeToolExecution,
  safeChatHistory,
  safeDecoding,
};
